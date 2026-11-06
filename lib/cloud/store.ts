import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { transaction, type Query } from "./db.ts";
import type { CloudAsset, CloudEntitlement, CloudOrg, CloudProject, CloudRevision, PlanCode, Role } from "./protocol.ts";
import { assetPayload, CloudFault, badInput, denied, email, missing, newToken, role, sha256, text, token, uuid, workspacePayload } from "./validation.ts";

export type Actor = { id: string; email: string; name: string };
export type Org = CloudOrg & { paused: boolean; trialUntil: Date | null };
const limits: Record<PlanCode, CloudEntitlement["limits"]> = {
  free: { projects: 3, writes: 20, bytes: 8 * 1024 ** 2, seats: 1 },
  pro: { projects: 25, writes: 200, bytes: 64 * 1024 ** 2, seats: 1 },
  team: { projects: 80, writes: 500, bytes: 192 * 1024 ** 2, seats: 5 },
};
const projectFields = 'id,name,head,version_count as versions,updated_at as "updatedAt"';
const revisionFields = 'id,parent_id as parent,sha256,size_bytes as bytes,created_at as "createdAt"';
const assetFields = 'id,kind,name,mime,sha256,size_bytes as bytes,created_at as "createdAt"';
const quota = (code = "quota-exceeded") => new CloudFault(403, code);
const conflict = (code = "revision-conflict") => new CloudFault(409, code);

export async function one<T extends Record<string, unknown>>(db: Query, sql: string, params: unknown[] = []) {
  return (await db.query<T>(sql, params)).rows[0];
}

export async function orgScope(db: Query, actor: Actor, id: string, write = false): Promise<Org> {
  const org = await one<{ id: string; name: string; paused: boolean; trialUntil: Date | null }>(db,
    `SELECT id,name,paused,trial_until as "trialUntil" FROM cf_org WHERE id=$1 ${write ? "FOR UPDATE" : "FOR SHARE"}`, [id]);
  if (!org) throw missing();
  const member = await one<{ role: Role }>(db, "SELECT role FROM cf_member WHERE org_id=$1 AND user_id=$2", [id, actor.id]);
  if (!member) throw missing();
  return { ...org, role: member.role };
}

export function requireOwner(org: Org) {
  if (org.role !== "owner") throw denied();
}

export async function audit(db: Query, org: string, kind: string, actor: string | null, order: string | null = null, detail = {}) {
  await db.query("INSERT INTO cf_entitlement_event(id,org_id,kind,actor_id,order_id,detail) VALUES($1,$2,$3,$4,$5,$6)",
    [randomUUID(), org, kind, actor, order, JSON.stringify(detail)]);
}

async function ensurePersonalOrg(db: Query, actor: Actor) {
  const known = await one(db, "SELECT 1 FROM cf_org WHERE owner_id=$1", [actor.id]);
  if (known) return;
  const org = await one<{ id: string }>(db, "INSERT INTO cf_org(id,owner_id,name) VALUES($1,$2,$3) ON CONFLICT(owner_id) DO NOTHING RETURNING id",
    [randomUUID(), actor.id, `${actor.name.slice(0, 64)} · CargoFit`]);
  if (org) await db.query("INSERT INTO cf_member(org_id,user_id,email,role) VALUES($1,$2,$3,'owner')", [org.id, actor.id, actor.email]);
}

export async function entitlement(db: Query, org: Org, trialDays: number): Promise<CloudEntitlement> {
  const paid = await one<{ plan: Exclude<PlanCode, "free">; until: Date }>(db, `
    SELECT plan,valid_until AS until FROM cf_order
    WHERE org_id=$1 AND state IN ('paid','partial_refund') AND valid_until>now()
    ORDER BY (plan='team') DESC, valid_until DESC LIMIT 1`, [org.id]);
  const trial = !!org.trialUntil && org.trialUntil.getTime() > Date.now();
  const plan = paid?.plan === "team" || trial ? "team" : paid?.plan ?? "free";
  const state = trial && paid?.plan !== "team" ? "trial" : paid ? "active" : "free";
  const until = (state === "trial" ? org.trialUntil : paid?.until)?.toISOString() ?? null;
  const usage = await one<CloudEntitlement["usage"]>(db, `
    SELECT (SELECT count(*)::int FROM cf_project WHERE org_id=$1) AS projects,
      (SELECT count(*)::int FROM cf_usage WHERE org_id=$1 AND period=to_char(now() AT TIME ZONE 'UTC','YYYY-MM')) AS writes,
      (SELECT COALESCE(sum(bytes),0)::int FROM cf_usage WHERE org_id=$1) AS bytes,
      (SELECT count(*)::int FROM cf_member WHERE org_id=$1) AS seats`, [org.id]);
  return { plan, state, until, paused: org.paused, trialDays, trialUsed: !!org.trialUntil, limits: limits[plan], usage };
}

async function project(db: Query, orgId: string, projectId: string) {
  const row = await one<CloudProject>(db, `SELECT ${projectFields} FROM cf_project WHERE org_id=$1 AND id=$2`, [orgId, projectId]);
  if (!row) throw missing();
  return row;
}

async function revision(db: Query, orgId: string, projectId: string, revisionId: string) {
  const row = await one<CloudRevision & { payload: string }>(db, `SELECT ${revisionFields},payload FROM cf_revision
    WHERE org_id=$1 AND project_id=$2 AND id=$3`, [orgId, projectId, revisionId]);
  if (!row) throw missing();
  if (sha256(row.payload) !== row.sha256) throw new CloudFault(500, "integrity-error");
  return row;
}

async function replay(db: Query, org: Org, actor: Actor, key: string, fingerprint: string) {
  const prior = await one<{ resourceId: string; projectId: string; fingerprint: string }>(db,
    'SELECT resource_id as "resourceId",project_id as "projectId",fingerprint FROM cf_usage WHERE org_id=$1 AND actor_id=$2 AND task_key=$3',
    [org.id, actor.id, key]);
  if (prior && prior.fingerprint !== fingerprint) throw conflict("request-conflict");
  return prior && { projectId: prior.projectId, resourceId: prior.resourceId };
}

async function limitWrite(db: Query, org: Org, size: number, trialDays: number, creating: boolean) {
  const { usage, limits } = await entitlement(db, org, trialDays);
  if (org.paused) throw quota("writes-paused");
  if (org.role === "editor" && usage.seats > limits.seats) throw quota("seat-limit");
  if (usage.writes >= limits.writes || usage.bytes + size > limits.bytes || creating && usage.projects >= limits.projects) throw quota();
}

async function recordWrite(db: Query, org: Org, actor: Actor, key: string, fingerprint: string, size: number, resourceId: string, projectId: string) {
  await db.query(`INSERT INTO cf_usage(org_id,actor_id,task_key,fingerprint,period,bytes,resource_id,project_id)
    VALUES($1,$2,$3,$4,to_char(now() AT TIME ZONE 'UTC','YYYY-MM'),$5,$6,$7)`, [org.id, actor.id, key, fingerprint, size, resourceId, projectId]);
  return { projectId, resourceId };
}

async function saveRevision(db: Query, org: Org, actor: Actor, body: Record<string, unknown>, trialDays: number) {
  const creating = body.action === "create-project";
  const name = creating ? text(body.name, 120) : null;
  const projectId = creating ? randomUUID() : uuid(body.projectId);
  const head = creating ? null : uuid(body.expectedHead);
  const key = uuid(body.key);
  const { bytes, sha } = workspacePayload(body.payload);
  const fingerprint = sha256(JSON.stringify([body.action, creating ? name : projectId, head, sha]));
  const prior = await replay(db, org, actor, key, fingerprint);
  if (prior) return prior;
  if (!creating && (await project(db, org.id, projectId)).head !== head) throw conflict();
  await limitWrite(db, org, bytes.length, trialDays, creating);
  if (creating) await db.query("INSERT INTO cf_project(id,org_id,name) VALUES($1,$2,$3)", [projectId, org.id, name]);
  const id = randomUUID();
  await db.query(`INSERT INTO cf_revision(id,org_id,project_id,parent_id,author_id,sha256,size_bytes,payload)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, [id, org.id, projectId, head, actor.id, sha, bytes.length, bytes.toString("utf8")]);
  await db.query("UPDATE cf_project SET head=$2,version_count=version_count+1,updated_at=now() WHERE id=$1", [projectId, id]);
  return recordWrite(db, org, actor, key, fingerprint, bytes.length, id, projectId);
}

async function saveAsset(db: Query, org: Org, actor: Actor, body: Record<string, unknown>, trialDays: number) {
  const projectId = uuid(body.projectId), revisionId = uuid(body.revisionId), key = uuid(body.key);
  const { kind, name, mime, bytes, sha } = assetPayload(body);
  const fingerprint = sha256(JSON.stringify(["save-asset", projectId, revisionId, kind, name, mime, sha]));
  const prior = await replay(db, org, actor, key, fingerprint);
  if (prior) return prior;
  const attached = await one(db, "SELECT 1 FROM cf_revision WHERE id=$1 AND project_id=$2 AND org_id=$3", [revisionId, projectId, org.id]);
  if (!attached) throw missing();
  await limitWrite(db, org, bytes.length, trialDays, false);
  const id = randomUUID();
  await db.query(`INSERT INTO cf_asset(id,org_id,project_id,revision_id,author_id,kind,name,mime,sha256,size_bytes,payload)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [id, org.id, projectId, revisionId, actor.id, kind, name, mime, sha, bytes.length, bytes]);
  return recordWrite(db, org, actor, key, fingerprint, bytes.length, id, projectId);
}

async function inviteMember(db: Query, org: Org, body: Record<string, unknown>, trialDays: number) {
  const target = email(body.email), memberRole = role(body.role);
  const { usage, limits } = await entitlement(db, org, trialDays);
  if (usage.seats >= limits.seats) throw quota("seat-limit");
  if (await one(db, "SELECT 1 FROM cf_member WHERE org_id=$1 AND email=$2", [org.id, target])) throw conflict("already-member");
  const invitation = newToken();
  await db.query("DELETE FROM cf_invite WHERE org_id=$1 AND (email=$2 OR expires_at<=now())", [org.id, target]);
  await db.query("INSERT INTO cf_invite(token_hash,org_id,email,role,expires_at) VALUES($1,$2,$3,$4,now()+interval '3 days')",
    [sha256(invitation), org.id, target, memberRole]);
  return { token: invitation };
}

async function join(db: Query, actor: Actor, raw: unknown, trialDays: number) {
  const hash = sha256(token(raw));
  const invitation = await one<{ orgId: string }>(db, 'SELECT org_id as "orgId" FROM cf_invite WHERE token_hash=$1 AND email=$2 AND expires_at>now()', [hash, actor.email]);
  if (!invitation) throw missing();
  const org = await one<Org>(db, 'SELECT id,name,paused,trial_until as "trialUntil" FROM cf_org WHERE id=$1 FOR UPDATE', [invitation.orgId]);
  if (!org) throw missing();
  const accepted = await one<{ role: "editor" | "viewer" }>(db,
    "DELETE FROM cf_invite WHERE token_hash=$1 AND email=$2 AND expires_at>now() RETURNING role", [hash, actor.email]);
  if (!accepted) throw missing();
  if (await one(db, "SELECT 1 FROM cf_member WHERE org_id=$1 AND user_id=$2", [org.id, actor.id])) return { orgId: org.id };
  const { usage, limits } = await entitlement(db, org, trialDays);
  if (usage.seats >= limits.seats) throw quota("seat-limit");
  await db.query("INSERT INTO cf_member(org_id,user_id,email,role) VALUES($1,$2,$3,$4)", [org.id, actor.id, actor.email, accepted.role]);
  return { orgId: org.id };
}

export function readShared(pool: Pool, raw: unknown) {
  const hash = sha256(token(raw));
  return transaction(pool, async db => {
    const share = await one<{ orgId: string; projectId: string; revisionId: string }>(db, `
      SELECT org_id AS "orgId",project_id AS "projectId",revision_id AS "revisionId"
      FROM cf_share WHERE token_hash=$1 AND expires_at>now() AND revoked_at IS NULL FOR SHARE`, [hash]);
    if (!share) throw missing();
    return revision(db, share.orgId, share.projectId, share.revisionId);
  });
}

const READ = new Set(["projects", "history", "revision", "assets", "asset", "entitlements", "members", "shares"]);
const EDIT = new Set(["create-project", "save-revision", "save-asset"]);
const OWNER = new Set(["start-trial", "set-paused", "invite", "set-role", "remove-member", "create-share", "revoke-share"]);

export function cloudData(pool: Pool, actor: Actor, body: Record<string, unknown>, trialDays: number) {
  const action = text(body.action, 40);
  return transaction(pool, async db => {
    if (action === "me") {
      await ensurePersonalOrg(db, actor);
      const { rows: orgs } = await db.query<CloudOrg>(`SELECT o.id,o.name,m.role FROM cf_member m JOIN cf_org o ON o.id=m.org_id
        WHERE m.user_id=$1 ORDER BY (m.role='owner') DESC,o.name,o.id`, [actor.id]);
      return { user: { name: actor.name, email: actor.email }, orgs };
    }
    if (action === "join") return join(db, actor, body.token, trialDays);
    const read = READ.has(action);
    if (!read && !EDIT.has(action) && !OWNER.has(action)) throw badInput();
    const org = await orgScope(db, actor, uuid(body.orgId), !read);
    if (OWNER.has(action)) requireOwner(org);
    if (EDIT.has(action) && org.role === "viewer") throw denied();
    switch (action) {
      case "entitlements": return entitlement(db, org, trialDays);
      case "projects": return (await db.query<CloudProject>(
        `SELECT ${projectFields} FROM cf_project WHERE org_id=$1 ORDER BY updated_at DESC,id`, [org.id])).rows;
      case "history": {
        const projectId = uuid(body.projectId);
        await project(db, org.id, projectId);
        const page = body.page ?? 0;
        if (typeof page !== "number" || !Number.isSafeInteger(page) || page < 0 || page > 50_000) throw badInput();
        return (await db.query<CloudRevision>(`SELECT ${revisionFields} FROM cf_revision WHERE org_id=$1 AND project_id=$2
          ORDER BY created_at DESC,id LIMIT 50 OFFSET $3`, [org.id, projectId, page * 50])).rows;
      }
      case "revision": return revision(db, org.id, uuid(body.projectId), uuid(body.revisionId));
      case "assets": return (await db.query<CloudAsset>(`SELECT ${assetFields} FROM cf_asset WHERE org_id=$1 AND project_id=$2 AND revision_id=$3
        ORDER BY created_at DESC,id LIMIT 500`, [org.id, uuid(body.projectId), uuid(body.revisionId)])).rows;
      case "asset": {
        const row = await one<CloudAsset & { payload: Uint8Array }>(db, `SELECT ${assetFields},payload FROM cf_asset
          WHERE org_id=$1 AND project_id=$2 AND revision_id=$3 AND id=$4`, [org.id, uuid(body.projectId), uuid(body.revisionId), uuid(body.assetId)]);
        if (!row) throw missing();
        if (sha256(row.payload) !== row.sha256) throw new CloudFault(500, "integrity-error");
        return { ...row, payload: Buffer.from(row.payload).toString("base64") };
      }
      case "create-project":
      case "save-revision": return saveRevision(db, org, actor, body, trialDays);
      case "save-asset": return saveAsset(db, org, actor, body, trialDays);
      case "members": {
        requireOwner(org);
        return (await db.query('SELECT user_id AS id,email,role FROM cf_member WHERE org_id=$1 ORDER BY (role=\'owner\') DESC,email', [org.id])).rows;
      }
      case "invite": return inviteMember(db, org, body, trialDays);
      case "set-role":
      case "remove-member": {
        const id = text(body.memberId, 100);
        const params = [org.id, id];
        const result = action === "remove-member"
          ? await one(db, "DELETE FROM cf_member WHERE org_id=$1 AND user_id=$2 AND role<>'owner' RETURNING user_id", params)
          : await one(db, "UPDATE cf_member SET role=$3 WHERE org_id=$1 AND user_id=$2 AND role<>'owner' RETURNING user_id", [...params, role(body.role)]);
        if (!result) throw missing();
        return { ok: true };
      }
      case "start-trial": {
        if (trialDays <= 0 || org.trialUntil) throw quota("trial-unavailable");
        await db.query("UPDATE cf_org SET trial_until=now()+($2*interval '1 day') WHERE id=$1", [org.id, trialDays]);
        await audit(db, org.id, "trial-started", actor.id);
        return { ok: true };
      }
      case "set-paused": {
        if (typeof body.paused !== "boolean") throw badInput();
        if (org.paused !== body.paused) {
          await db.query("UPDATE cf_org SET paused=$2 WHERE id=$1", [org.id, body.paused]);
          await audit(db, org.id, body.paused ? "writes-paused" : "writes-resumed", actor.id);
        }
        return { ok: true };
      }
      case "shares": {
        requireOwner(org);
        return (await db.query(`SELECT id,revision_id AS "revisionId",expires_at AS "expiresAt",revoked_at AS "revokedAt"
          FROM cf_share WHERE org_id=$1 AND project_id=$2 ORDER BY (revoked_at IS NULL AND expires_at>now()) DESC,expires_at DESC LIMIT 100`, [org.id, uuid(body.projectId)])).rows;
      }
      case "create-share": {
        const projectId = uuid(body.projectId), revisionId = uuid(body.revisionId);
        if (!await one(db, "SELECT 1 FROM cf_revision WHERE id=$1 AND project_id=$2 AND org_id=$3", [revisionId, projectId, org.id])) throw missing();
        const active = await one<{ count: number }>(db, "SELECT count(*)::int AS count FROM cf_share WHERE org_id=$1 AND project_id=$2 AND revoked_at IS NULL AND expires_at>now()", [org.id, projectId]);
        if ((active?.count ?? 0) >= 25) throw quota();
        const shareToken = newToken(), id = randomUUID();
        const share = await one<{ expiresAt: Date }>(db, `INSERT INTO cf_share(token_hash,id,org_id,project_id,revision_id,created_by,expires_at)
          VALUES($1,$2,$3,$4,$5,$6,now()+interval '7 days') RETURNING expires_at AS "expiresAt"`, [sha256(shareToken), id, org.id, projectId, revisionId, actor.id]);
        return { id, token: shareToken, expiresAt: share.expiresAt };
      }
      case "revoke-share": {
        const result = await one(db, `UPDATE cf_share SET revoked_at=COALESCE(revoked_at,now())
          WHERE org_id=$1 AND project_id=$2 AND id=$3 RETURNING id`, [org.id, uuid(body.projectId), uuid(body.shareId)]);
        if (!result) throw missing();
        return { ok: true };
      }
    }
  });
}
