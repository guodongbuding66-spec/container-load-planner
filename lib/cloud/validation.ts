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
    const valid = mime === "image/jpeg" ? isValidJpeg(bytes)
      : mime === "image/png" ? isValidPng(bytes)
      : isValidWebp(bytes);
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

const MAX_IMAGE_DIM = 16384;
const MAX_IMAGE_PIXELS = 64_000_000;
const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[i] = c >>> 0;
  }
  return table;
})();

function u16be(b: Uint8Array, o: number) { return (b[o] << 8) | b[o + 1]; }
function u16le(b: Uint8Array, o: number) { return b[o] | (b[o + 1] << 8); }
function u32be(b: Uint8Array, o: number) { return ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0; }
function u32le(b: Uint8Array, o: number) { return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0; }
function ascii4(b: Uint8Array, o: number) { return String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]); }

function crc32Range(b: Uint8Array, start: number, end: number) {
  let c = 0xffffffff;
  for (let i = start; i < end; i++) c = CRC32_TABLE[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function validImageDimensions(width: number, height: number) {
  return width >= 1 && height >= 1 && width <= MAX_IMAGE_DIM && height <= MAX_IMAGE_DIM && width * height <= MAX_IMAGE_PIXELS;
}

function isValidPng(bytes: Uint8Array): boolean {
  if (bytes.length < 45) return false;
  for (let i = 0; i < 8; i++) if (bytes[i] !== PNG_SIG[i]) return false;
  let offset = 8;
  let sawIhdr = false;
  let sawIdat = false;
  while (offset + 12 <= bytes.length) {
    const chunkLen = u32be(bytes, offset);
    if (chunkLen > 0x7fffffff || offset + 12 + chunkLen > bytes.length) return false;
    const type = ascii4(bytes, offset + 4);
    if (!/^[A-Za-z]{4}$/.test(type)) return false;
    const expectedCrc = u32be(bytes, offset + 8 + chunkLen);
    if ((type === "IHDR" || type === "IEND") && crc32Range(bytes, offset + 4, offset + 8 + chunkLen) !== expectedCrc) return false;
    if (!sawIhdr) {
      if (type !== "IHDR" || chunkLen !== 13) return false;
      const width = u32be(bytes, offset + 8);
      const height = u32be(bytes, offset + 12);
      const bitDepth = bytes[offset + 16];
      const colorType = bytes[offset + 17];
      const compression = bytes[offset + 18];
      const filter = bytes[offset + 19];
      const interlace = bytes[offset + 20];
      if (!validImageDimensions(width, height)) return false;
      if (![1, 2, 4, 8, 16].includes(bitDepth) || ![0, 2, 3, 4, 6].includes(colorType)) return false;
      if (compression !== 0 || filter !== 0 || interlace > 1) return false;
      sawIhdr = true;
    } else if (type === "IDAT") {
      if (chunkLen > 0) sawIdat = true;
    } else if (type === "IEND") {
      return chunkLen === 0 && offset + 12 === bytes.length && sawIdat;
    }
    offset += 12 + chunkLen;
  }
  return false;
}

function isValidJpeg(bytes: Uint8Array): boolean {
  if (bytes.length < 16 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return false;
  let offset = 2;
  let hasSof = false;
  let hasSos = false;
  while (offset + 1 < bytes.length) {
    if (bytes[offset] !== 0xff) return false;
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.length) return false;
    const marker = bytes[offset++];
    if (marker === 0xd9) return hasSof && hasSos;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue;
    if (offset + 2 > bytes.length) return false;
    const segLen = u16be(bytes, offset);
    if (segLen < 2 || offset + segLen > bytes.length) return false;
    if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
      if (segLen < 7) return false;
      const height = u16be(bytes, offset + 3);
      const width = u16be(bytes, offset + 5);
      if (!validImageDimensions(width, height)) return false;
      hasSof = true;
    }
    offset += segLen;
    if (marker === 0xda) {
      hasSos = true;
      for (let i = offset; i + 1 < bytes.length; i++) {
        if (bytes[i] === 0xff && bytes[i + 1] === 0xd9) return hasSof;
      }
      return false;
    }
  }
  return false;
}

function isValidWebp(bytes: Uint8Array): boolean {
  if (bytes.length < 26 || ascii4(bytes, 0) !== "RIFF" || ascii4(bytes, 8) !== "WEBP") return false;
  const riffSize = u32le(bytes, 4);
  if (riffSize + 8 !== bytes.length) return false;
  const chunkType = ascii4(bytes, 12);
  const chunkSize = u32le(bytes, 16);
  if (chunkSize === 0 || 20 + chunkSize > bytes.length) return false;
  if (chunkType === "VP8 ") {
    if (chunkSize < 10 || bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) return false;
    const width = u16le(bytes, 26) & 0x3fff;
    const height = u16le(bytes, 28) & 0x3fff;
    return validImageDimensions(width, height);
  }
  if (chunkType === "VP8L") {
    if (chunkSize < 5 || bytes[20] !== 0x2f) return false;
    const bits = u32le(bytes, 21);
    const width = (bits & 0x3fff) + 1;
    const height = ((bits >>> 14) & 0x3fff) + 1;
    return validImageDimensions(width, height);
  }
  if (chunkType === "VP8X") {
    if (chunkSize < 10) return false;
    const width = 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16));
    const height = 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16));
    return validImageDimensions(width, height);
  }
  return false;
}
