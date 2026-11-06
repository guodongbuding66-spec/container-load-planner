export const CLOUD_BASE = "/api/cargo";
export const CLOUD_ORIGINS = [
  "https://container-load-planner.pages.dev",
  "https://container-load-planner-gray.vercel.app",
] as const;
export const CLOUD_API_VERSION = 1;
export const MAX_CLOUD_FILE_BYTES = 2 * 1024 * 1024;
export const MAX_CLOUD_PHOTO_BYTES = 1_000_000;
export const MAX_CLOUD_BODY_BYTES = 3 * 1024 * 1024;

export type Role = "owner" | "editor" | "viewer";
export type PlanCode = "free" | "pro" | "team";
export type ArchiveKind = "field" | "weighing" | "operations" | "fleet-handoff" | "photo";
export type CloudProject = { id: string; name: string; head: string; versions: number; updatedAt: string };
export type CloudRevision = { id: string; parent: string | null; sha256: string; bytes: number; createdAt: string };
export type CloudAsset = { id: string; kind: ArchiveKind; name: string; mime: string; sha256: string; bytes: number; createdAt: string };
export type CloudOrg = { id: string; name: string; role: Role };
export type CloudSession = { user: { name: string; email: string }; orgs: CloudOrg[] };
export type CloudEntitlement = {
  plan: PlanCode;
  state: "free" | "trial" | "active";
  until: string | null;
  paused: boolean;
  trialDays: number;
  trialUsed: boolean;
  limits: { projects: number; writes: number; bytes: number; seats: number };
  usage: { projects: number; writes: number; bytes: number; seats: number };
};
export type SandboxOffer = { code: "pro" | "team"; amount: number; currency: "usd"; days: number };
export type CloudOrder = {
  id: string; plan: "pro" | "team"; amount: number; currency: string; refunded: number;
  state: "pending" | "paid" | "failed" | "expired" | "partial_refund" | "refunded" | "disputed";
  createdAt: string; validUntil: string | null;
};
