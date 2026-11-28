import { estimateAxleLoad } from "./axle-load-estimator";
import { analyzeSecuringVoids } from "./securing-void-analyzer";
import type { PackingResult } from "./types";

export interface PlanComparisonMetricRow {
  key: string;
  labelZh: string;
  labelEn: string;
  planAValue: string;
  planBValue: string;
  deltaLabel: string;
  winner: "A" | "B" | "tie";
}

export interface PlanComparisonReport {
  planALabel: string;
  planBLabel: string;
  rows: PlanComparisonMetricRow[];
}

function fmtDelta(diff: number, unit = "", digits = 1): string {
  if (Math.abs(diff) < 1e-6) return "0";
  const sign = diff > 0 ? "+" : "";
  return `${sign}${diff.toFixed(digits).replace(/\.0$/, "")}${unit}`;
}

export function comparePackingPlans(
  planA: PackingResult,
  planB: PackingResult,
  planALabel = planA.strategy === "practical" ? "现场易执行 (Practical)" : "高密度参考 (Maximum)",
  planBLabel = planB.strategy === "maximum" ? "高密度参考 (Maximum)" : "现场易执行 (Practical)",
): PlanComparisonReport {
  const secA = analyzeSecuringVoids(planA);
  const secB = analyzeSecuringVoids(planB);
  const axleA = estimateAxleLoad(planA, "container-chassis");
  const axleB = estimateAxleLoad(planB, "container-chassis");

  const palletsA = planA.pallets?.length ?? 0;
  const palletsB = planB.pallets?.length ?? 0;
  const volA = Number((planA.metrics.volumeUtilization * 100).toFixed(2));
  const volB = Number((planB.metrics.volumeUtilization * 100).toFixed(2));
  const wtA = Number(axleA.cargoWeightKg.toFixed(1));
  const wtB = Number(axleB.cargoWeightKg.toFixed(1));

  const rows: PlanComparisonMetricRow[] = [
    {
      key: "loadedCount",
      labelZh: "装入总箱数",
      labelEn: "Loaded Cartons",
      planAValue: `${planA.metrics.loadedCount}`,
      planBValue: `${planB.metrics.loadedCount}`,
      deltaLabel: fmtDelta(planB.metrics.loadedCount - planA.metrics.loadedCount, " 箱", 0),
      winner: planA.metrics.loadedCount === planB.metrics.loadedCount ? "tie" : planB.metrics.loadedCount > planA.metrics.loadedCount ? "B" : "A",
    },
    {
      key: "volumeUtil",
      labelZh: "体积利用率",
      labelEn: "Volume Utilization",
      planAValue: `${volA}%`,
      planBValue: `${volB}%`,
      deltaLabel: fmtDelta(volB - volA, "%", 2),
      winner: Math.abs(volA - volB) < 0.05 ? "tie" : volB > volA ? "B" : "A",
    },
    {
      key: "totalWeight",
      labelZh: "总货重",
      labelEn: "Total Payload",
      planAValue: `${wtA} kg`,
      planBValue: `${wtB} kg`,
      deltaLabel: fmtDelta(wtB - wtA, " kg", 1),
      winner: "tie",
    },
    {
      key: "pallets",
      labelZh: "托盘数量（越少越省）",
      labelEn: "Pallet Count (Lower Better)",
      planAValue: `${palletsA}`,
      planBValue: `${palletsB}`,
      deltaLabel: fmtDelta(palletsB - palletsA, "", 0),
      winner: palletsA === palletsB ? "tie" : palletsB < palletsA ? "B" : "A",
    },
    {
      key: "lateralOffset",
      labelZh: "左右重心偏移（越小越稳）",
      labelEn: "Lateral CoG Offset (Lower Better)",
      planAValue: `${axleA.lateralOffsetPct}% (${axleA.lateralOffsetMm} mm)`,
      planBValue: `${axleB.lateralOffsetPct}% (${axleB.lateralOffsetMm} mm)`,
      deltaLabel: fmtDelta(axleB.lateralOffsetPct - axleA.lateralOffsetPct, "%", 1),
      winner: Math.abs(axleA.lateralOffsetPct - axleB.lateralOffsetPct) < 0.2 ? "tie" : axleB.lateralOffsetPct < axleA.lateralOffsetPct ? "B" : "A",
    },
    {
      key: "airbags",
      labelZh: "建议充气袋数（越少越省）",
      labelEn: "Est. Dunnage Airbags (Lower Better)",
      planAValue: `${secA.airbagCount}`,
      planBValue: `${secB.airbagCount}`,
      deltaLabel: fmtDelta(secB.airbagCount - secA.airbagCount, "", 0),
      winner: secA.airbagCount === secB.airbagCount ? "tie" : secB.airbagCount < secA.airbagCount ? "B" : "A",
    },
    {
      key: "tailVoid",
      labelZh: "柜尾剩余纵向空隙",
      labelEn: "Tail-Gate Free Void",
      planAValue: `${secA.tailVoidLengthMm} mm`,
      planBValue: `${secB.tailVoidLengthMm} mm`,
      deltaLabel: fmtDelta(secB.tailVoidLengthMm - secA.tailVoidLengthMm, " mm", 0),
      winner: "tie",
    },
  ];

  return { planALabel, planBLabel, rows };
}

export function planComparisonToCsv(report: PlanComparisonReport): string {
  const lines = [`Metric,${report.planALabel},${report.planBLabel},Delta,Winner`];
  for (const r of report.rows) {
    lines.push([r.labelZh, r.planAValue, r.planBValue, r.deltaLabel, r.winner].map((s) => `"${String(s).replaceAll('"', '""')}"`).join(","));
  }
  return lines.join("\n");
}
