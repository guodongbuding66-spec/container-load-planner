const encoder = new TextEncoder();
const algorithm = { name: "HMAC", hash: "SHA-256" };
const safeIp = /^[\dA-Fa-f.:]{3,45}$/;
const mac = (secret: string) => crypto.subtle.importKey("raw", encoder.encode(secret), algorithm, false, ["sign", "verify"]);

export async function signedProxyClient(ip: string, secret: string) {
  if (!safeIp.test(ip)) return null;
  const stamp = Date.now().toString();
  const bytes = new Uint8Array(await crypto.subtle.sign(algorithm.name, await mac(secret), encoder.encode(`${stamp}:${ip}`)));
  const signature = Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
  return `${stamp};${ip};${signature}`;
}

export async function verifyProxyClient(header: string | null, secret: string) {
  if (!header || header.length > 128) return null;
  const parts = header.split(";");
  if (parts.length !== 3) return null;
  const [stamp, ip, signature] = parts;
  if (!/^\d{13}$/.test(stamp) || Math.abs(Date.now() - Number(stamp)) > 60_000 ||
    !safeIp.test(ip) || !/^[0-9a-f]{64}$/.test(signature)) return null;
  const bytes = Uint8Array.from(signature.match(/../g)!, hex => Number.parseInt(hex, 16));
  return await crypto.subtle.verify(algorithm.name, await mac(secret), bytes, encoder.encode(`${stamp}:${ip}`)) ? ip : null;
}
