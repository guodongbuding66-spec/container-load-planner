import type { Pool } from "pg";
import type Stripe from "stripe";
import { parseWorkspaceBackup } from "../packing/workspace-file";
import { actorFrom, forwardAuth, type CloudAuth } from "./auth.ts";
import { checkout, paymentWebhook, recheckOrder, sandboxOffers, sandboxOrders } from "./billing.ts";
import { CLOUD_API_VERSION, CLOUD_BASE, CLOUD_ORIGINS } from "./protocol.ts";
import { verifyProxyClient } from "./proxy.ts";
import { cloudData, one, readShared } from "./store.ts";
import { badInput, CloudFault, denied, email, jsonObject, missing, readCloudBody, unavailable, uuid, workspacePayload } from "./validation.ts";

export type CloudMode = "private" | "sandbox";
export type CloudRuntime = {
  auth: CloudAuth; pool: Pool; mode: CloudMode; trialDays: number; proxySecret?: string; sandboxEmails?: ReadonlySet<string>;
  stripe?: { api: Stripe; secret: string };
};

const headers = { "cache-control": "no-store, private", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer" };
function reply(body: unknown, status = 200) { return Response.json(body, { headers, status }); }

export async function cloudRequest(request: Request, path: string, runtime: CloudRuntime | null, origins: readonly string[]) {
  try {
    if (path === "/status" && request.method === "GET") {
      if (!runtime) return reply({ version: CLOUD_API_VERSION, enabled: false });
      try {
        const configuration = await one<{ mode: string }>(runtime.pool, "SELECT mode FROM cf_environment WHERE singleton");
        const enabled = configuration?.mode === runtime.mode;
        return reply({ version: CLOUD_API_VERSION, enabled, mode: enabled ? runtime.mode : undefined,
          sandbox: enabled && !!runtime.stripe && runtime.mode === "sandbox" });
      } catch { return reply({ version: CLOUD_API_VERSION, enabled: false }); }
    }
    if (request.method !== "POST") throw missing();
    const webhook = path === "/billing/webhook";
    const origin = request.headers.get("origin") ?? "";
    if (!webhook && !origins.includes(origin)) throw denied();
    if (!runtime) throw unavailable();
    const configuration = await one<{ mode: string }>(runtime.pool, "SELECT mode FROM cf_environment WHERE singleton");
    if (configuration?.mode !== runtime.mode) throw unavailable();
    if (webhook) {
      if (!runtime.stripe || runtime.mode !== "sandbox") throw unavailable();
      const raw = await readCloudBody(request, 256 * 1024);
      return reply(await paymentWebhook(runtime.pool, runtime.stripe.api, runtime.stripe.secret, raw, request.headers.get("stripe-signature")));
    }
    if (!request.headers.get("content-type")?.match(/^application\/json(?:;|$)/i)) throw badInput();
    if (path.startsWith("/auth/")) {
      const raw = jsonObject(await readCloudBody(request, 8192));
      if (runtime.sandboxEmails && raw.email !== undefined && !runtime.sandboxEmails.has(email(raw.email))) throw denied();
      let ip = request.headers.get("x-vercel-forwarded-for") ?? undefined;
      if (origin === CLOUD_ORIGINS[0] && runtime.proxySecret) {
        const verified = await verifyProxyClient(request.headers.get("x-cargofit-proxy-client"), runtime.proxySecret);
        if (!verified) throw denied();
        ip = verified;
      }
      return await forwardAuth(runtime.auth, path.slice("/auth".length), raw, request, origin, ip);
    }
    if (path === "/share") {
      const body = jsonObject(await readCloudBody(request, 1024));
      return reply(await readShared(runtime.pool, body.token));
    }
    if (path !== "/data") throw missing();
    const actor = await actorFrom(runtime.auth, request.headers);
    if (runtime.sandboxEmails && !runtime.sandboxEmails.has(actor.email)) throw denied();
    const body = jsonObject(await readCloudBody(request));
    if (body.action === "billing") {
      if (!runtime.stripe || runtime.mode !== "sandbox") throw unavailable();
      return reply({ offers: sandboxOffers(), orders: await sandboxOrders(runtime.pool, actor, uuid(body.orgId)) });
    }
    if (body.action === "recheck-order") {
      if (!runtime.stripe || runtime.mode !== "sandbox") throw unavailable();
      return reply(await recheckOrder(runtime.pool, runtime.stripe.api, actor, body));
    }
    if (body.action === "checkout") {
      if (!runtime.stripe || runtime.mode !== "sandbox") throw unavailable();
      return reply(await checkout(runtime.pool, runtime.stripe.api, actor, origin, body));
    }
    if (body.action === "create-project" || body.action === "save-revision") {
      const { bytes } = workspacePayload(body.payload);
      try { parseWorkspaceBackup(bytes.toString("utf8")); }
      catch { throw new CloudFault(400, "invalid-workspace"); }
    }
    return reply(await cloudData(runtime.pool, actor, body, runtime.trialDays));
  } catch (error) {
    return error instanceof CloudFault ? reply({ error: error.code }, error.status) : reply({ error: "unavailable" }, 503);
  }
}

export function cloudRoute(url: URL) {
  if (url.pathname === CLOUD_BASE) {
    const path = url.searchParams.get("route");
    return path && /^[a-z/-]+$/.test(path) ? "/" + path.replace(/^\/+/, "") : "";
  }
  return url.pathname.startsWith(CLOUD_BASE + "/") ? url.pathname.slice(CLOUD_BASE.length) : "";
}
