import type { CrewSlicePayload } from "./crew-payload";

export type DiscrepancyKind = "damaged" | "shortage" | "relocated" | "dimension-mismatch" | "overweight";

export interface CrewDiscrepancy {
  id: string;
  timestamp: string;
  sku: string;
  kind: DiscrepancyKind;
  qtyDelta: number;
  note: string;
}

export interface CrewScanOutcome {
  ok: boolean;
  status: "matched" | "over-scan" | "unknown";
  matchedSku: string | null;
  scannedCount: number;
  plannedCount: number;
  nextCounts: Record<string, number>;
}

export const DISCREPANCY_LABELS: Record<DiscrepancyKind, readonly [string, string]> = {
  damaged: ["外箱破损", "Damaged carton"],
  shortage: ["少货／短装", "Shortage"],
  relocated: ["现场临时换位", "Relocated on site"],
  "dimension-mismatch": ["实测尺寸偏差", "Dimension mismatch"],
  overweight: ["单箱超重预警", "Overweight alert"],
};

export function aggregatePlannedSkus(payload: CrewSlicePayload): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const slice of payload.slices) {
    for (const item of slice.items) {
      totals[item.sku] = (totals[item.sku] ?? 0) + item.qty;
    }
  }
  return totals;
}

export function normalizeScanToken(raw: string): string {
  return raw
    .trim()
    .replace(/^(sku|item|barcode|code)\s*[:=#-]\s*/i, "")
    .trim();
}

export function applyCrewScan(
  currentCounts: Readonly<Record<string, number>>,
  plannedMap: Readonly<Record<string, number>>,
  rawToken: string,
): CrewScanOutcome {
  const token = normalizeScanToken(rawToken);
  if (!token) {
    return {
      ok: false,
      status: "unknown",
      matchedSku: null,
      scannedCount: 0,
      plannedCount: 0,
      nextCounts: { ...currentCounts },
    };
  }

  const lower = token.toLowerCase();
  const matchedSku = Object.keys(plannedMap).find((sku) => sku.toLowerCase() === lower) ?? null;
  if (!matchedSku) {
    return {
      ok: false,
      status: "unknown",
      matchedSku: null,
      scannedCount: 0,
      plannedCount: 0,
      nextCounts: { ...currentCounts },
    };
  }

  const plannedCount = plannedMap[matchedSku] ?? 0;
  const prev = currentCounts[matchedSku] ?? 0;
  if (prev >= plannedCount) {
    return {
      ok: false,
      status: "over-scan",
      matchedSku,
      scannedCount: prev,
      plannedCount,
      nextCounts: { ...currentCounts },
    };
  }

  const nextVal = prev + 1;
  return {
    ok: true,
    status: "matched",
    matchedSku,
    scannedCount: nextVal,
    plannedCount,
    nextCounts: { ...currentCounts, [matchedSku]: nextVal },
  };
}

function csvCell(v: string | number): string {
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

export function buildCrewAuditCsv(
  payload: CrewSlicePayload,
  containerNo: string,
  sealNo: string,
  scanCounts: Readonly<Record<string, number>>,
  discrepancies: readonly CrewDiscrepancy[],
): string {
  const plannedMap = aggregatePlannedSkus(payload);
  const lines: string[] = [
    ["RecordType", "ContainerNo", "SealNo", "SKU", "PlannedQty", "ScannedQty", "Variance", "DiscrepancyType", "Note", "Timestamp"].join(","),
  ];

  for (const [sku, planned] of Object.entries(plannedMap)) {
    const scanned = scanCounts[sku] ?? 0;
    const variance = scanned - planned;
    lines.push(
      ["SKU_SCAN", containerNo || "TBD", sealNo || "TBD", sku, planned, scanned, variance, "", "", ""].map(csvCell).join(","),
    );
  }

  for (const d of discrepancies) {
    lines.push(
      ["DISCREPANCY", containerNo || "TBD", sealNo || "TBD", d.sku, "", "", d.qtyDelta, d.kind, d.note, d.timestamp].map(csvCell).join(","),
    );
  }

  return lines.join("\n");
}
