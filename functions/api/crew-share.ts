/**
 * Optional Cloudflare Pages Function for 8-char short Crew View links.
 * Runs on Cloudflare Workers Free + KV Free Tier ($0/month: 100k reads/day, 1k writes/day, 1 GB storage).
 * Bind a KV namespace named `CREW_SHARE_KV` in Cloudflare Pages -> Settings -> Functions -> KV namespace bindings.
 * When unbound, returns 501 and the frontend seamlessly uses 100% zero-backend deflate-compressed #z= hash URLs.
 */

interface KVNamespaceLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

interface PagesContext {
  request: Request;
  env: { CREW_SHARE_KV?: KVNamespaceLike };
}

const TTL_SECONDS = 30 * 24 * 3600; // 30 days auto-expiry

function randomCode(len = 8): string {
  const alphabet = "23456789abcdefghjkmnpqrstuvwxyz";
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

export async function onRequestGet({ request, env }: PagesContext): Promise<Response> {
  if (!env.CREW_SHARE_KV) {
    return Response.json({ error: "KV_NOT_BOUND" }, { status: 501 });
  }
  const id = new URL(request.url).searchParams.get("id") || "";
  if (!/^[a-z0-9]{6,16}$/i.test(id)) {
    return Response.json({ error: "INVALID_ID" }, { status: 400 });
  }
  const raw = await env.CREW_SHARE_KV.get(`crew:${id}`);
  if (!raw) {
    return Response.json({ error: "NOT_FOUND" }, { status: 404 });
  }
  return new Response(raw, {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=300" },
  });
}

export async function onRequestPost({ request, env }: PagesContext): Promise<Response> {
  if (!env.CREW_SHARE_KV) {
    return Response.json({ error: "KV_NOT_BOUND" }, { status: 501 });
  }
  const body = await request.text();
  if (!body || body.length > 200_000) {
    return Response.json({ error: "PAYLOAD_TOO_LARGE" }, { status: 413 });
  }
  const id = randomCode(8);
  await env.CREW_SHARE_KV.put(`crew:${id}`, body, { expirationTtl: TTL_SECONDS });
  return Response.json({ id, expiresInDays: 30 }, { status: 201 });
}
