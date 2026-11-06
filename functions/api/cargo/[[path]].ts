import { CLOUD_API_VERSION, CLOUD_BASE, CLOUD_ORIGINS, MAX_CLOUD_BODY_BYTES } from "../../../lib/cloud/protocol.ts";

import { signedProxyClient } from "../../../lib/cloud/proxy.ts";

type Env = { CARGOFIT_PROXY_SECRET?: string };
export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  const path = new URL(request.url).pathname;
  const allowed = path === CLOUD_BASE + "/status" || path === CLOUD_BASE + "/data" ||
    path === CLOUD_BASE + "/share" || path.startsWith(CLOUD_BASE + "/auth/");
  if (!allowed) return Response.json({ error: "not-found" }, { status: 404 });
  const headers = new Headers();
  for (const name of ["content-type", "origin"]) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  const cookies = request.headers.get("cookie")?.split(";").map(value => value.trim())
    .filter(value => /^(?:__Secure-|__Host-)?cargofit\.[A-Za-z0-9_.-]+=/i.test(value));
  if (cookies?.length) headers.set("cookie", cookies.join("; "));
  if (Number(request.headers.get("content-length") ?? 0) > MAX_CLOUD_BODY_BYTES)
    return Response.json({ error: "file-too-large" }, { status: 413 });
  try {
    const secret = env.CARGOFIT_PROXY_SECRET;
    if (path.startsWith(CLOUD_BASE + "/auth/")) {
      const signed = secret && await signedProxyClient(request.headers.get("cf-connecting-ip") ?? "", secret);
      if (!signed) return Response.json({ error: "unavailable" }, { status: 503, headers: { "cache-control": "no-store" } });
      headers.set("x-cargofit-proxy-client", signed);
    }
    const upstream = await fetch(new URL(path, CLOUD_ORIGINS[1]), {
      method: request.method, headers, body: request.body, redirect: "manual", cache: "no-store",
    });
    if (path === CLOUD_BASE + "/status" && !secret && upstream.ok) {
      await upstream.body?.cancel();
      return Response.json({ version: CLOUD_API_VERSION, enabled: false }, { headers: { "cache-control": "no-store" } });
    }
    const response = new Response(upstream.body, upstream);
    response.headers.set("cache-control", "no-store, private");
    return response;
  } catch {
    return Response.json({ error: "unavailable" }, { status: 503, headers: { "cache-control": "no-store" } });
  }
};
