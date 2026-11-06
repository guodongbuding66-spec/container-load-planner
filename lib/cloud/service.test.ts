import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { Buffer } from "node:buffer";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { getMigrations } from "better-auth/db/migration";
import type { Pool } from "pg";
import type Stripe from "stripe";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { cloudAuthOptions, createCloudAuth } from "./auth";
import { createSandboxStripe } from "./billing";
import { createCloudPool } from "./db";
import { CLOUD_BASE, CLOUD_ORIGINS } from "./protocol";
import { signedProxyClient } from "./proxy";
import { CLOUD_MIGRATION } from "./schema";
import { cloudRequest, cloudRoute, type CloudRuntime } from "./service";

const [pages, vercel] = CLOUD_ORIGINS;
const TEST_SECRET = "whsec_cargofit_isolated_fixture";
const PASSWORD = "fixture-passphrase-2026";
const mail = new Map<string, string>();
const payload = readFileSync(new URL("../../docs/field-upgrades/evidence/v0.79.0-field-workspace-fixture.json", import.meta.url), "utf8");
const key = () => randomUUID();
let db: PGlite, socket: PGLiteSocketServer, pool: Pool, runtime: CloudRuntime;
type Host = typeof CLOUD_ORIGINS[number];
type Me = { user: { email: string }; orgs: { id: string; role: string }[] };
const bearer = (response: Response) => response.headers.getSetCookie().find(row => row.includes("session_token="))?.split(";")[0] ?? "";
let testIp = 1;
const nextUser = () => `qa-${key()}@example.test`;

function request(path: string, body?: object, host: string = pages, cookie = "", service: CloudRuntime | null = runtime) {
  const request = new Request(host + CLOUD_BASE + path, { method: body ? "POST" : "GET",
    headers: { origin: host, "content-type": "application/json", cookie, "x-vercel-forwarded-for": `192.0.2.${testIp++}` },
    ...(body ? { body: JSON.stringify(body) } : {}) });
  return cloudRequest(request, cloudRoute(new URL(request.url)), service, CLOUD_ORIGINS);
}
const auth = (route: string, body: object, host: Host = pages, cookie = "") => request("/auth" + route, body, host, cookie);
const api = (action: string, body: object, cookie: string, host: Host = pages) => request("/data", { ...body, action }, host, cookie);
async function login(email: string, host: Host = pages, password = PASSWORD) {
  const response = await auth("/sign-in/email", { email, password }, host);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ ok: true });
  const cookie = bearer(response);
  expect(cookie).toMatch(/^__Secure-cargofit\./);
  expect(response.headers.getSetCookie()[0]).toMatch(/HttpOnly/);
  return cookie;
}
async function account(email = nextUser()) {
  expect((await auth("/email-otp/send-verification-otp", { email })).status).toBe(200);
  const otp = mail.get(`sign-in/${email}`);
  expect(otp).toMatch(/^\d{8}$/);
  const verified = await auth("/sign-in/email-otp", { email, otp, name: "QA Owner" });
  expect(verified.status).toBe(200);
  const cookie = bearer(verified);
  expect(cookie).toMatch(/^__Secure-cargofit\./);
  const me = await (await api("me", {}, cookie)).json() as Me;
  return { email, cookie, orgId: me.orgs[0].id };
}
async function otpSession(email: string, host: Host = vercel) {
  expect((await auth("/email-otp/send-verification-otp", { email }, host)).status).toBe(200);
  const response = await auth("/sign-in/email-otp", { email, otp: mail.get(`sign-in/${email}`) }, host);
  expect(response.status).toBe(200);
  return bearer(response);
}
async function createProject(actor: Awaited<ReturnType<typeof account>>, name = "QA private") {
  const response = await api("create-project", { orgId: actor.orgId, key: key(), name, payload }, actor.cookie);
  expect(response.status).toBe(200);
  return await response.json() as { projectId: string; resourceId: string };
}

beforeAll(async () => {
  db = await PGlite.create();
  await db.exec(CLOUD_MIGRATION);
  await db.exec("SET search_path=cargofit_cloud");
  socket = new PGLiteSocketServer({ db, port: 0, host: "127.0.0.1", maxConnections: 6 });
  await socket.start();
  pool = createCloudPool(`postgresql://postgres@${socket.getServerConn()}/postgres`);
  const settings = {
    origins: CLOUD_ORIGINS, secret: "fixture_6f915f833833254d590f213e_0a8bad1a7d0947a9", secure: true,
    async sendMail(data: { email: string; otp: string; type: string }) { mail.set(`${data.type}/${data.email}`, data.otp); },
  };
  await (await getMigrations(cloudAuthOptions(pool, settings))).runMigrations();
  await pool.query("INSERT INTO cf_environment(mode) VALUES('sandbox')");
  runtime = { pool, auth: createCloudAuth(pool, settings), trialDays: 14, mode: "sandbox",
    stripe: { api: createSandboxStripe("sk_test_fixture_no_network"), secret: TEST_SECRET } };
}, 35_000);
afterAll(async () => {
  await pool?.end();
  await socket?.stop();
  await db?.close();
});

describe("dual-origin account service", () => {
  it("fails closed when not configured and rejects cross-origin and guest writes", async () => {
    expect(await (await request("/status", undefined, pages, "", null)).json()).toEqual({ version: 1, enabled: false });
    expect(await (await request("/status")).json()).toEqual({ version: 1, enabled: true, mode: "sandbox", sandbox: true });
    expect((await request("/data", { action: "me" }, "https://outside.example.test")).status).toBe(403);
    expect((await api("me", {}, "")).status).toBe(401);
    expect((await request("/status", undefined, vercel, "", { ...runtime, mode: "private" })).status).toBe(200);
    expect(await (await request("/status", undefined, vercel, "", { ...runtime, mode: "private" })).json()).toEqual({ version: 1, enabled: false, sandbox: false });
  });

  it("requires email verification and resets or revokes sessions across both origins", async () => {
    const email = nextUser();
    const sent = await auth("/email-otp/send-verification-otp", { email, type: "email-verification" });
    expect(sent.status).toBe(200);
    expect(bearer(sent)).toBe("");
    expect((await auth("/sign-up/email", { email, password: PASSWORD })).status).toBe(404);
    expect((await auth("/sign-in/email", { email, password: PASSWORD })).status).toBe(401);
    const otp = mail.get(`sign-in/${email}`);
    expect(otp).toMatch(/^\d{8}$/);
    const incorrect = otp === "00000000" ? "00000001" : "00000000";
    expect((await auth("/sign-in/email-otp", { email, otp: incorrect })).status).toBe(400);
    const verified = await auth("/sign-in/email-otp", { email, otp, name: "Verification" });
    expect(verified.status).toBe(200);
    expect((await auth("/sign-in/email-otp", { email, otp })).status).toBe(400);
    const a = bearer(verified), b = await otpSession(email);
    expect(a).not.toBe(b);
    const meA = await (await api("me", {}, a)).json();
    const meB = await (await api("me", {}, b, vercel)).json();
    expect(meA).toEqual(meB);
    expect((await auth("/email-otp/request-password-reset", { email }, vercel)).status).toBe(200);
    const reset = mail.get(`forget-password/${email}`);
    expect(reset).toMatch(/^\d{8}$/);
    expect((await auth("/email-otp/reset-password", { email, otp: reset, password: PASSWORD + "new" }, vercel)).status).toBe(200);
    expect((await api("me", {}, a)).status).toBe(401);
    expect((await api("me", {}, b, vercel)).status).toBe(401);
    const fresh = await login(email, pages, PASSWORD + "new"), other = await login(email, vercel, PASSWORD + "new");
    expect((await auth("/revoke-sessions", {}, pages, fresh)).status).toBe(200);
    expect((await api("me", {}, other, vercel)).status).toBe(401);
  }, 20_000);

  it("requires a signed client IP from the Pages proxy and throttles repeated requests", async () => {
    const env = { ...runtime, proxySecret: "fixture_hmac_only_no_production_636e3a" };
    const email = nextUser();
    const ip = "192.0.2.200";
    const signature = await signedProxyClient(ip, env.proxySecret);
    expect(signature).toBeTruthy();
    async function send(client: string) {
      return cloudRequest(new Request(pages + CLOUD_BASE + "/auth/email-otp/send-verification-otp", {
        method: "POST", headers: { origin: pages, "content-type": "application/json", "x-cargofit-proxy-client": client },
        body: JSON.stringify({ email }),
      }), "/auth/email-otp/send-verification-otp", env, CLOUD_ORIGINS);
    }
    expect((await send("forged")).status).toBe(403);
    expect((await send(signature!.replace(ip, "192.0.2.201"))).status).toBe(403);
    const statuses = [];
    for (let i = 0; i < 6; i++) statuses.push((await send(signature!)).status);
    expect(statuses).toContain(200);
    expect(statuses.at(-1)).toBe(429);
  });

  it("checks tenant membership, version conflicts, idempotent quota and explicit pause", async () => {
    const owner = await account(), stranger = await account();
    const body = { orgId: owner.orgId, key: key(), name: "QA order", payload };
    const again = await otpSession(owner.email, vercel);
    const invalid = JSON.stringify({ format: "cargo-fit-workspace", version: 1, inputs: { products: [1], container: {} } });
    expect((await api("create-project", { ...body, payload: invalid, key: key() }, owner.cookie)).status).toBe(400);
    const [a, b] = await Promise.all([api("create-project", body, owner.cookie), api("create-project", body, again, vercel)]);
    expect([a.status, b.status]).toEqual([200, 200]);
    const first = await a.json() as { projectId: string; resourceId: string };
    expect(await b.json()).toEqual(first);
    expect((await api("create-project", { ...body, name: "Changed" }, owner.cookie)).status).toBe(409);
    expect((await api("projects", { orgId: owner.orgId }, stranger.cookie)).status).toBe(404);
    expect((await api("revision", { orgId: stranger.orgId, projectId: first.projectId, revisionId: first.resourceId }, stranger.cookie)).status).toBe(404);
    const write = { orgId: owner.orgId, projectId: first.projectId, expectedHead: first.resourceId, payload };
    const results = await Promise.all([api("save-revision", { ...write, key: key() }, owner.cookie), api("save-revision", { ...write, key: key() }, again, vercel)]);
    expect(results.map(row => row.status).sort()).toEqual([200, 409]);
    const info = await (await api("entitlements", { orgId: owner.orgId }, owner.cookie)).json();
    expect(info).toMatchObject({ usage: { projects: 1, writes: 2 } });
    expect((await api("set-paused", { orgId: owner.orgId, paused: true }, owner.cookie)).status).toBe(200);
    const blocked = await api("create-project", { ...body, key: key() }, again, vercel);
    expect(await blocked.json()).toEqual({ error: "writes-paused" });
    expect((await api("history", { orgId: owner.orgId, projectId: first.projectId }, again, vercel)).status).toBe(200);
  }, 20_000);

  it("keeps photos private while the selected revision share is expiring and revocable", async () => {
    const owner = await account(), stranger = await account();
    const first = await createProject(owner);
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl73WQAAAAASUVORK5CYII=", "base64");
    const asset = { orgId: owner.orgId, projectId: first.projectId, revisionId: first.resourceId };
    const response = await api("save-asset", { ...asset, key: key(), kind: "photo", name: "QA.png", mime: "image/png", payload: png.toString("base64") }, owner.cookie);
    expect(response.status).toBe(200);
    const { resourceId: assetId } = await response.json() as { resourceId: string };
    expect(await (await api("asset", { ...asset, assetId }, owner.cookie)).json()).toMatchObject({ payload: png.toString("base64"), bytes: png.length });
    expect((await api("asset", { ...asset, assetId }, stranger.cookie)).status).toBe(404);
    const share = await (await api("create-share", asset, owner.cookie)).json() as { token: string; id: string };
    const shared = await (await request("/share", { token: share.token }, vercel)).json();
    expect(shared).toMatchObject({ id: first.resourceId, payload });
    expect(shared).not.toHaveProperty("assets");
    await api("revoke-share", { ...asset, shareId: share.id }, owner.cookie);
    expect((await request("/share", { token: share.token }, vercel)).status).toBe(404);
    const secondShare = await (await api("create-share", asset, owner.cookie)).json() as { token: string; id: string };
    await pool.query("UPDATE cf_share SET expires_at=now()-interval '1 day' WHERE id=$1", [secondShare.id]);
    expect((await request("/share", { token: secondShare.token })).status).toBe(404);
  }, 20_000);

  it("limits team invitations by verified email, seats and server-owned roles", async () => {
    const owner = await account(), viewer = await account(), stranger = await account();
    const first = await createProject(owner);
    const body = { orgId: owner.orgId, email: viewer.email, role: "viewer" };
    expect((await api("invite", body, owner.cookie)).status).toBe(403);
    expect((await api("start-trial", { orgId: owner.orgId }, owner.cookie)).status).toBe(200);
    expect((await api("start-trial", { orgId: owner.orgId }, owner.cookie)).status).toBe(403);
    const { token } = await (await api("invite", body, owner.cookie)).json() as { token: string };
    expect((await api("join", { token }, stranger.cookie)).status).toBe(404);
    expect((await api("join", { token }, viewer.cookie)).status).toBe(200);
    expect((await api("join", { token }, viewer.cookie)).status).toBe(404);
    expect((await api("history", { orgId: owner.orgId, projectId: first.projectId }, viewer.cookie)).status).toBe(200);
    expect((await api("save-revision", { orgId: owner.orgId, projectId: first.projectId, expectedHead: first.resourceId, key: key(), payload }, viewer.cookie)).status).toBe(403);
    expect((await api("invite", { ...body, role: "owner" }, owner.cookie)).status).toBe(400);
    const members = await (await api("members", { orgId: owner.orgId }, owner.cookie)).json() as { email: string; id: string }[];
    const viewerId = members.find(row => row.email === viewer.email)!.id;
    await api("set-role", { orgId: owner.orgId, memberId: viewerId, role: "editor" }, owner.cookie);
    expect((await api("save-revision", { orgId: owner.orgId, projectId: first.projectId, expectedHead: first.resourceId, key: key(), payload }, viewer.cookie)).status).toBe(200);
    await api("remove-member", { orgId: owner.orgId, memberId: viewerId }, owner.cookie);
    expect((await api("projects", { orgId: owner.orgId }, viewer.cookie)).status).toBe(404);
  }, 20_000);
});

it("reconciles verified sandbox payments, duplicate and reordered events, and refunds without trusting return URLs", async () => {
  const stripe = runtime.stripe!.api;
  const owner = await account();
  const orgId = owner.orgId, requestKey = key();
  let session: Stripe.Checkout.Session;
  const construct = vi.spyOn(stripe.checkout.sessions, "create").mockImplementation(async params => {
    if (!params) throw Error("Missing checkout parameters");
    expect(params.line_items?.[0].price_data?.unit_amount).toBe(990);
    session = { id: "cs_test_fixture", object: "checkout.session", livemode: false, mode: "payment",
      client_reference_id: params.client_reference_id, metadata: params.metadata, expires_at: params.expires_at,
      amount_total: 990, currency: "usd", status: "open", payment_status: "unpaid", url: "https://checkout.stripe.com/c/pay/cs_test_fixture" } as Stripe.Checkout.Session;
    return session as Awaited<ReturnType<typeof stripe.checkout.sessions.create>>;
  });
  const retrieve = vi.spyOn(stripe.checkout.sessions, "retrieve").mockImplementation(async () => session as Awaited<ReturnType<typeof stripe.checkout.sessions.retrieve>>);
  const response = await api("checkout", { orgId, key: requestKey, plan: "pro", amount: 1, currency: "cny" }, owner.cookie);
  expect(response.status).toBe(200);
  const order = await response.json() as { id: string; url: string };
  expect(await (await api("checkout", { orgId, key: key(), plan: "pro" }, owner.cookie, vercel)).json()).toEqual(order);
  expect(construct).toHaveBeenCalledTimes(1);
  const getAccess = async () => (await api("entitlements", { orgId, checkoutResult: "success" }, owner.cookie, vercel)).json();
  expect(await getAccess()).toMatchObject({ plan: "free" });

  const notify = async (eventId: string, type = "checkout.session.completed", signature = true, live = false) => {
    const raw = JSON.stringify({ id: eventId, type, livemode: live, data: { object: { id: session.id, metadata: session.metadata } } });
    const signed = stripe.webhooks.generateTestHeaderString({ payload: raw, secret: TEST_SECRET });
    const request = new Request(vercel + CLOUD_BASE + "/billing/webhook", { method: "POST", body: raw,
      headers: { "stripe-signature": signature ? signed : "t=1,v1=bad" } });
    return cloudRequest(request, "/billing/webhook", runtime, CLOUD_ORIGINS);
  };
  expect((await notify("evt_bad_signature", undefined, false)).status).toBe(400);
  expect((await notify("evt_live", undefined, true, true)).status).toBe(400);
  expect((await notify("evt_unpaid")).status).toBe(200);
  expect(await getAccess()).toMatchObject({ plan: "free" });
  const pi = { id: "pi_fixture", livemode: false, metadata: session!.metadata,
    amount_received: 990, currency: "usd", status: "succeeded",
    latest_charge: { id: "ch_fixture", livemode: false, paid: true, captured: true, amount_captured: 990, amount_refunded: 0, currency: "usd",
      payment_intent: "pi_fixture", created: Math.floor(Date.now() / 1000), disputed: false },
  };
  session = { ...session!, payment_status: "paid", status: "complete", payment_intent: pi as unknown as Stripe.PaymentIntent };
  session.amount_total = 1;
  expect((await notify("evt_amount_changed")).status).toBe(400);
  expect((await api("recheck-order", { orgId, orderId: order.id }, owner.cookie, vercel)).status).toBe(400);
  session.amount_total = 990;
  expect((await api("recheck-order", { orgId, orderId: order.id }, owner.cookie, vercel)).status).toBe(200);
  expect((await notify("evt_paid")).status).toBe(200);
  const granted = await getAccess();
  expect(granted).toMatchObject({ plan: "pro", state: "active" });
  expect(await (await notify("evt_paid")).json()).toMatchObject({ duplicate: true });
  expect((await notify("evt_older_failed", "checkout.session.async_payment_failed")).status).toBe(200);
  expect(await getAccess()).toEqual(granted);
  pi.latest_charge.amount_refunded = 500;
  expect((await notify("evt_partial")).status).toBe(200);
  expect(await getAccess()).toEqual(granted);
  pi.latest_charge.amount_refunded = 990;
  expect((await notify("evt_refund")).status).toBe(200);
  expect(await getAccess()).toMatchObject({ plan: "free", state: "free" });
  pi.latest_charge.amount_refunded = 0;
  expect((await notify("evt_delayed")).status).toBe(200);
  expect(await getAccess()).toMatchObject({ plan: "free", state: "free" });
  expect(await (await api("billing", { orgId }, owner.cookie)).json()).toMatchObject({ orders: [{ id: order.id, state: "refunded", refunded: 990 }] });
  retrieve.mockRestore();
  construct.mockRestore();
}, 25_000);
