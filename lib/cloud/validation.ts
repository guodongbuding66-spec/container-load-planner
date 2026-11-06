import { Buffer } from "node:buffer";
import { createHash, randomBytes } from "node:crypto";
import { MAX_CLOUD_BODY_BYTES, MAX_CLOUD_FILE_BYTES, MAX_CLOUD_PHOTO_BYTES, type ArchiveKind } from "./protocol.ts";

export class CloudFault extends Error {
  constructor(readonly status: number, readonly code: string) {
    super(code);
  }
}
export const badInput = () => new CloudFault(400, "invalid-input");
export const denied = () => new CloudFault(403, "forbidden");
export const missing = () => new CloudFault(404, "not-found");
export const unavailable = () => new CloudFault(503, "unavailable");
export const sha256 = (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex");
export const newToken = () => Buffer.from(randomBytes(32)).toString("base64url");
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const TOKEN = /^[A-Za-z0-9_-]{43}$/;
export const text = (raw: unknown, max: number) => {
  if (typeof raw !== "string" || !raw.trim() || raw.length > max || /[\u0000-\u001f\u007f]/u.test(raw)) throw badInput();
  return raw.trim();
};
export const uuid = (raw: unknown) => {
  if (typeof raw !== "string" || !UUID.test(raw)) throw badInput();
  return raw.toLowerCase();
};
export const token = (raw: unknown) => {
  if (typeof raw !== "string" || !TOKEN.test(raw)) throw badInput();
  return raw;
};
export const email = (raw: unknown) => {
  const value = text(raw, 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/u.test(value)) throw badInput();
  return value;
};
export const role = (raw: unknown) => {
  if (raw !== "editor" && raw !== "viewer") throw badInput();
  return raw;
};
export function object(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw badInput();
  return raw as Record<string, unknown>;
}
export function jsonObject(raw: string) {
  try { return object(JSON.parse(raw)); }
  catch { throw badInput(); }
}

export async function readCloudBody(request: Request, max = MAX_CLOUD_BODY_BYTES) {
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > max) throw new CloudFault(413, "file-too-large");
  if (!request.body) return "";
  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let size = 0;
  const parts: string[] = [];
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > max) {
        await reader.cancel().catch(() => {});
        throw new CloudFault(413, "file-too-large");
      }
      parts.push(decoder.decode(value, { stream: true }));
    }
    parts.push(decoder.decode());
    return parts.join("");
  } catch (error) {
    if (error instanceof CloudFault) throw error;
    throw badInput();
  } finally {
    reader.releaseLock();
  }
}

const ARCHIVES = {
  field: ["cargo-fit-field-records"],
  weighing: ["cargo-fit-weighing", "cargo-fit-unit-weighing"],
  operations: ["cargo-fit-operations"],
  "fleet-handoff": ["cargo-fit-fleet-field"],
} as const;

function boundedText(raw: unknown) {
  if (typeof raw !== "string" || !raw) throw badInput();
  const bytes = Buffer.from(raw, "utf8");
  if (bytes.length > MAX_CLOUD_FILE_BYTES) throw new CloudFault(413, "file-too-large");
  return bytes;
}

export function workspacePayload(raw: unknown) {
  const bytes = boundedText(raw);
  const data = jsonObject(bytes.toString());
  const inputs = object(data.inputs);
  if (data.format !== "cargo-fit-workspace" || data.version !== 1 ||
    !Array.isArray(inputs.products) || !inputs.products.length || inputs.products.length > 4000 ||
    !inputs.container || typeof inputs.container !== "object") throw new CloudFault(400, "invalid-workspace");
  return { bytes, sha: sha256(bytes) };
}

export function assetPayload(raw: Record<string, unknown>) {
  const name = text(raw.name, 120);
  if (/[/\\]/u.test(name)) throw badInput();
  if (raw.kind === "photo") {
    const mime = raw.mime;
    if (mime !== "image/jpeg" && mime !== "image/png" && mime !== "image/webp") throw badInput();
    if (typeof raw.payload !== "string" || raw.payload.length > Math.ceil(MAX_CLOUD_PHOTO_BYTES / 3) * 4 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(raw.payload)) throw badInput();
    const bytes = Buffer.from(raw.payload, "base64");
    if (bytes.length > MAX_CLOUD_PHOTO_BYTES || bytes.toString("base64") !== raw.payload) throw badInput();
    const valid = mime === "image/jpeg" ? bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
      : mime === "image/png" ? bytes.length > 8 && bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))
      : bytes.length > 12 && bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP";
    if (!valid) throw badInput();
    return { name, kind: raw.kind, mime, bytes, sha: sha256(bytes) };
  }
  const kind = raw.kind as Exclude<ArchiveKind, "photo">;
  if (typeof kind !== "string" || !Object.hasOwn(ARCHIVES, kind)) throw badInput();
  const bytes = boundedText(raw.payload);
  const data = jsonObject(bytes.toString());
  if (!(ARCHIVES[kind] as readonly unknown[]).includes(data.format) || !Number.isSafeInteger(data.version) || data.version !== 1) throw badInput();
  return { name, kind, mime: "application/json", bytes, sha: sha256(bytes) };
}
