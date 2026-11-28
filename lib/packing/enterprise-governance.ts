/**
 * Direction 21: Enterprise Governance — Plan Approval Workflow,
 * Immutable Audit Trail, and Version Diff Snapshot (works offline & cloud-ready).
 */
export type ApprovalStatus = "draft" | "pending_review" | "approved" | "rejected" | "issued";

export interface AuditTrailEntry {
  id: string;
  timestamp: string;
  actor: string;
  role: "sales" | "planner" | "packaging_eng" | "warehouse" | "manager" | "admin";
  action: "create" | "submit_review" | "approve" | "reject" | "issue" | "export" | "replan_request";
  fromStatus?: ApprovalStatus;
  toStatus?: ApprovalStatus;
  note?: string;
}

export interface GovernedPlanRecord {
  planId: string;
  revision: number;
  title: string;
  status: ApprovalStatus;
  loadedCartons: number;
  volumeUtilPct: number;
  totalWeightKg: number;
  createdAt: string;
  updatedAt: string;
  auditTrail: AuditTrailEntry[];
}

const VALID_TRANSITIONS: Record<ApprovalStatus, ApprovalStatus[]> = {
  draft: ["pending_review"],
  pending_review: ["approved", "rejected", "draft"],
  approved: ["issued", "draft"],
  rejected: ["draft", "pending_review"],
  issued: [], // Issued plans are immutable; create a new revision instead
};

export function createGovernedPlanRecord(
  planId: string,
  title: string,
  metrics: { loadedCartons: number; volumeUtilPct: number; totalWeightKg: number },
  actor = "local-planner",
): GovernedPlanRecord {
  const now = new Date().toISOString();
  return {
    planId,
    revision: 1,
    title,
    status: "draft",
    loadedCartons: metrics.loadedCartons,
    volumeUtilPct: metrics.volumeUtilPct,
    totalWeightKg: metrics.totalWeightKg,
    createdAt: now,
    updatedAt: now,
    auditTrail: [
      {
        id: `aud-${planId}-1`,
        timestamp: now,
        actor,
        role: "planner",
        action: "create",
        toStatus: "draft",
        note: "Initial governed plan snapshot created.",
      },
    ],
  };
}

export function transitionApprovalStatus(
  record: GovernedPlanRecord,
  nextStatus: ApprovalStatus,
  actor: string,
  role: AuditTrailEntry["role"],
  note?: string,
): { ok: boolean; record: GovernedPlanRecord; errorZh?: string } {
  const allowed = VALID_TRANSITIONS[record.status] ?? [];
  if (!allowed.includes(nextStatus)) {
    return {
      ok: false,
      record,
      errorZh: `不允许从状态「${record.status}」直接变更为「${nextStatus}」${record.status === "issued" ? "（已签发版本不可修改，请新建修订版）" : ""}。`,
    };
  }
  const now = new Date().toISOString();
  const actionMap: Record<ApprovalStatus, AuditTrailEntry["action"]> = {
    draft: "create",
    pending_review: "submit_review",
    approved: "approve",
    rejected: "reject",
    issued: "issue",
  };
  const nextEntry: AuditTrailEntry = {
    id: `aud-${record.planId}-${record.auditTrail.length + 1}`,
    timestamp: now,
    actor,
    role,
    action: actionMap[nextStatus],
    fromStatus: record.status,
    toStatus: nextStatus,
    note,
  };
  return {
    ok: true,
    record: {
      ...record,
      status: nextStatus,
      updatedAt: now,
      auditTrail: [...record.auditTrail, nextEntry],
    },
  };
}

export interface PlanVersionDiff {
  fromRevision: number;
  toRevision: number;
  cartonsDelta: number;
  volumeUtilDeltaPct: number;
  weightDeltaKg: number;
  summaryZh: string;
}

export function diffGovernedPlans(prev: GovernedPlanRecord, next: GovernedPlanRecord): PlanVersionDiff {
  const cartonsDelta = next.loadedCartons - prev.loadedCartons;
  const volumeUtilDeltaPct = Number((next.volumeUtilPct - prev.volumeUtilPct).toFixed(2));
  const weightDeltaKg = Number((next.totalWeightKg - prev.totalWeightKg).toFixed(1));
  return {
    fromRevision: prev.revision,
    toRevision: next.revision,
    cartonsDelta,
    volumeUtilDeltaPct,
    weightDeltaKg,
    summaryZh: `版本 R${prev.revision} → R${next.revision}：装柜量 ${cartonsDelta >= 0 ? "+" : ""}${cartonsDelta} 箱，空间利用率 ${volumeUtilDeltaPct >= 0 ? "+" : ""}${volumeUtilDeltaPct}%，毛重 ${weightDeltaKg >= 0 ? "+" : ""}${weightDeltaKg} kg。`,
  };
}
