import {
  executeCargoFitApiV1,
  type CargoFitApiRequestV1,
  type CargoFitApiResponseV1,
} from "../packing/api-contract";

/**
 * Direction 22: Official CargoFit TypeScript/JavaScript SDK & Webhook Contract.
 * Supports both local deterministic embedded engine execution and remote REST API invocation.
 */
export interface CargoFitWebhookEvent {
  eventId: string;
  eventType: "plan.calculated" | "plan.approved" | "plan.issued" | "crew.replan_requested";
  occurredAt: string;
  payload: Record<string, unknown>;
}

export interface CargoFitClientOptions {
  /** Omit baseUrl to run CargoFit's embedded deterministic engine locally with zero network dependency. */
  baseUrl?: string;
  apiKey?: string;
}

export class CargoFitClient {
  private readonly baseUrl?: string;
  private readonly apiKey?: string;

  constructor(options: CargoFitClientOptions = {}) {
    this.baseUrl = options.baseUrl?.replace(/\/$/, "");
    this.apiKey = options.apiKey;
  }

  /** Calculates a verified 3D container loading plan locally or via remote CargoFit API. */
  async calculatePlan(req: CargoFitApiRequestV1): Promise<CargoFitApiResponseV1> {
    if (this.baseUrl) {
      const res = await fetch(`${this.baseUrl}/api/v1/plan`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
        },
        body: JSON.stringify(req),
      });
      if (!res.ok) throw new Error(`CargoFit API error: HTTP ${res.status}`);
      return (await res.json()) as CargoFitApiResponseV1;
    }
    return executeCargoFitApiV1(req);
  }
}

/** Deterministic FNV-1a payload digest for lightweight Webhook integrity verification. */
export function computeWebhookDigest(secret: string, rawBody: string): string {
  const input = `${secret}:${rawBody}`;
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `cfv1=${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function verifyWebhookDigest(secret: string, rawBody: string, headerSignature: string): boolean {
  return computeWebhookDigest(secret, rawBody) === headerSignature;
}
