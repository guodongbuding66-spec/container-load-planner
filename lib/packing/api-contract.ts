import { ENGINE_VERSION } from "./engine";
export { ENGINE_VERSION };
import { runHybridPackingOptimizer, type ComputeBudgetMode, type HybridSolverReport } from "./hybrid-solver";
import { packLoadingWorkflow } from "./pack-loading";
import { estimateAxleLoad, type VehicleAxleProfileId } from "./axle-load-estimator";
import { auditCartonBct, type EnvironmentProfileId, type FluteGradeId } from "./bct-estimator";
import { analyzeSecuringVoids } from "./securing-void-analyzer";
import type { PackingRequest, PackingResult } from "./types";

export const API_SCHEMA_VERSION = "cargo-fit-api-v3.2" as const;
export const LEGACY_API_SCHEMA_VERSIONS = ["cargo-fit-api-v3.1", "cargo-fit-api-v1.8", "cargo-fit-api-v1.2"] as const;

export interface CargoFitApiRequestV1 {
  schema: typeof API_SCHEMA_VERSION | (typeof LEGACY_API_SCHEMA_VERSIONS)[number];
  requestId?: string;
  request: PackingRequest;
  /** Optional hybrid compute mode (Direction 01). When omitted, runs standard single-pass workflow. */
  computeMode?: ComputeBudgetMode;
  customBudgetMs?: number;
  seed?: number;
  /** Optional engineering audit flags. */
  includeEngineeringAudit?: boolean;
  axleProfile?: VehicleAxleProfileId;
  fluteGrade?: FluteGradeId;
  envProfile?: EnvironmentProfileId;
}

export interface CargoFitApiResponseV1 {
  schema: string;
  engineVersion: string;
  requestId?: string;
  ok: boolean;
  elapsedMs: number;
  result?: PackingResult;
  hybridReport?: Omit<HybridSolverReport, "recommended" | "pareto">;
  engineeringAudit?: {
    axle: ReturnType<typeof estimateAxleLoad>;
    bct: ReturnType<typeof auditCartonBct>;
    securing: ReturnType<typeof analyzeSecuringVoids>;
  };
  error?: string;
}

function isSupportedSchema(schema: unknown): schema is CargoFitApiRequestV1["schema"] {
  return (
    schema === API_SCHEMA_VERSION ||
    (LEGACY_API_SCHEMA_VERSIONS as readonly string[]).includes(String(schema))
  );
}

/**
 * Deterministic in-process / serverless API execution entry point (Direction 22).
 * Invoked directly by REST handlers, SDKs, or the CargoFit MCP stdio server.
 */
export function executeCargoFitApiV1(payload: CargoFitApiRequestV1): CargoFitApiResponseV1 {
  const start = performance.now();
  try {
    if (!payload || !isSupportedSchema(payload.schema) || !payload.request) {
      return {
        schema: API_SCHEMA_VERSION,
        engineVersion: ENGINE_VERSION,
        requestId: payload?.requestId,
        ok: false,
        elapsedMs: Number((performance.now() - start).toFixed(2)),
        error: `Unsupported or missing schema; expected "${API_SCHEMA_VERSION}" (or legacy "${LEGACY_API_SCHEMA_VERSIONS.join('", "')}").`,
      };
    }

    let result: PackingResult;
    let hybridReport: CargoFitApiResponseV1["hybridReport"];

    if (payload.computeMode) {
      const report = runHybridPackingOptimizer(payload.request, {
        computeMode: payload.computeMode,
        customBudgetMs: payload.customBudgetMs,
        seed: payload.seed,
      });
      result = report.recommended;
      hybridReport = {
        computeMode: report.computeMode,
        budgetMs: report.budgetMs,
        elapsedMs: report.elapsedMs,
        seed: report.seed,
        totalRuns: report.totalRuns,
        candidatesEvaluated: report.candidatesEvaluated,
        validCandidates: report.validCandidates,
        oraclePassedCandidates: report.oraclePassedCandidates,
        beamCandidatesEvaluated: report.beamCandidatesEvaluated,
        exactBranchAndBoundChecked: report.exactBranchAndBoundChecked,
        exactNodesVisited: report.exactNodesVisited,
        featureProfile: report.featureProfile,
        strategyNodes: report.strategyNodes,
        brkgaGenerations: report.brkgaGenerations,
        saAcceptedMoves: report.saAcceptedMoves,
        summaries: report.summaries,
      };
    } else {
      result = packLoadingWorkflow(payload.request);
    }

    const engineeringAudit = payload.includeEngineeringAudit
      ? {
          axle: estimateAxleLoad(result, payload.axleProfile ?? "container-chassis"),
          bct: auditCartonBct(result, payload.fluteGrade ?? "bc-double", payload.envProfile ?? "ocean-30d"),
          securing: analyzeSecuringVoids(result),
        }
      : undefined;

    return {
      schema: payload.schema,
      engineVersion: ENGINE_VERSION,
      requestId: payload.requestId,
      ok: result.validation.valid,
      elapsedMs: Number((performance.now() - start).toFixed(2)),
      result,
      hybridReport,
      engineeringAudit,
    };
  } catch (err) {
    return {
      schema: API_SCHEMA_VERSION,
      engineVersion: ENGINE_VERSION,
      requestId: payload?.requestId,
      ok: false,
      elapsedMs: Number((performance.now() - start).toFixed(2)),
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** MCP Tool Descriptor ready for AI Agent / MCP Server binding. */
export const CARGOFIT_MCP_TOOL_DESCRIPTOR = {
  name: "cargofit_calculate_container_load",
  description:
    "Deterministic 3D container load planning, 4-mode hybrid LNS optimizer, and physical validation engine (axle load, McKee BCT crush risk, securing voids). Computes exact box coordinates, volume/weight utilization, palletization, and hard-constraint verification.",
  schemaVersion: API_SCHEMA_VERSION,
  inputSchema: {
    type: "object",
    required: ["schema", "request"],
    properties: {
      schema: { type: "string", enum: [API_SCHEMA_VERSION, ...LEGACY_API_SCHEMA_VERSIONS] },
      requestId: { type: "string" },
      computeMode: { type: "string", enum: ["fast", "standard", "deep", "extreme"] },
      customBudgetMs: { type: "number" },
      seed: { type: "number" },
      includeEngineeringAudit: { type: "boolean" },
      request: {
        type: "object",
        required: ["container", "products", "mode"],
      },
    },
  },
} as const;
