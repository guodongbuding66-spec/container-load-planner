import { analyzeLoads } from "./load-analysis";
import type { PackingResult, ProductInput } from "./types";

export type EngineeringHeatmapKind = "topLoad" | "floorLoad" | "stability" | "supportArea";
export type HeatmapCellStatus = "empty" | "safe" | "caution" | "high" | "unverified";

export interface HeatmapCell {
  col: number;
  row: number;
  value: number; // metric value (ratio, kg/m2, slenderness, or support %)
  status: HeatmapCellStatus;
  color: string;
  label: string;
}

export interface EngineeringHeatmapGrid {
  kind: EngineeringHeatmapKind;
  cols: number;
  rows: number;
  unit: string;
  maxValue: number;
  minValue: number;
  unverifiedCount: number;
  highRiskCount: number;
  cells: HeatmapCell[];
}

export interface EngineeringHeatmapBundle {
  topLoad: EngineeringHeatmapGrid;
  floorLoad: EngineeringHeatmapGrid;
  stability: EngineeringHeatmapGrid;
  supportArea: EngineeringHeatmapGrid;
}

const COLOR_MAP: Record<HeatmapCellStatus, string> = {
  empty: "#e2e8f0",
  safe: "#2b8d83",
  caution: "#e4b649",
  high: "#dc2626",
  unverified: "#64748b",
};

/**
 * Computes 4 real top-down engineering heatmaps directly from placed coordinates,
 * bearing limits, pallet decks, and box weights (zero mock or synthetic values).
 */
export function computeEngineeringHeatmaps(
  plan: PackingResult,
  products: readonly ProductInput[],
  cols = 10,
  rows = 4,
): EngineeringHeatmapBundle {
  const usableL = Math.max(1, plan.container.length - plan.clearance * 2);
  const usableW = Math.max(1, plan.container.width - plan.clearance * 2);
  const cellL = usableL / cols;
  const cellW = usableW / rows;
  const cellAreaM2 = (cellL * cellW) / 1e6;

  const loads = analyzeLoads(plan, [...products]);
  const loadByBoxId = new Map(loads.boxes.map((b) => [b.id, b]));
  const boxes = plan.placements;
  const pallets = plan.pallets ?? [];

  // Precompute bottom support ratio (0..100%) for each placed box
  const supportRatioByBox = new Map<string, number>();
  const palletDecks = pallets.map((pl) => ({
    x: pl.x,
    y: pl.y,
    topZ: pl.z + pl.dz,
    dx: pl.dx,
    dy: pl.dy,
  }));

  for (let i = 0; i < boxes.length; i++) {
    const a = boxes[i];
    if (a.z <= 2) {
      supportRatioByBox.set(a.id, 100);
      continue;
    }
    let supported = 0;
    for (let j = 0; j < boxes.length; j++) {
      if (i === j) continue;
      const b = boxes[j];
      if (Math.abs(b.z + b.dz - a.z) <= 5) {
        const ox = Math.max(0, Math.min(a.x + a.dx, b.x + b.dx) - Math.max(a.x, b.x));
        const oy = Math.max(0, Math.min(a.y + a.dy, b.y + b.dy) - Math.max(a.y, b.y));
        supported += ox * oy;
      }
    }
    for (const pd of palletDecks) {
      if (Math.abs(pd.topZ - a.z) <= 5) {
        const ox = Math.max(0, Math.min(a.x + a.dx, pd.x + pd.dx) - Math.max(a.x, pd.x));
        const oy = Math.max(0, Math.min(a.y + a.dy, pd.y + pd.dy) - Math.max(a.y, pd.y));
        supported += ox * oy;
      }
    }
    const base = Math.max(1, a.dx * a.dy);
    supportRatioByBox.set(a.id, Math.min(100, Number(((supported / base) * 100).toFixed(1))));
  }

  const topCells: HeatmapCell[] = [];
  const floorCells: HeatmapCell[] = [];
  const stabCells: HeatmapCell[] = [];
  const supCells: HeatmapCell[] = [];

  for (let r = 0; r < rows; r++) {
    const y0 = r * cellW;
    const y1 = y0 + cellW;
    for (let c = 0; c < cols; c++) {
      const x0 = c * cellL;
      const x1 = x0 + cellL;

      let cellMassKg = 0;
      let maxTopRatio = -1;
      let hasUnverifiedTop = false;
      let hasAnyBox = false;
      let maxSlenderness = 0;
      let minSupportPct = 100;

      for (const b of boxes) {
        const ox = Math.max(0, Math.min(b.x + b.dx, x1) - Math.max(b.x, x0));
        const oy = Math.max(0, Math.min(b.y + b.dy, y1) - Math.max(b.y, y0));
        const overlap = ox * oy;
        if (overlap <= 1) continue;
        hasAnyBox = true;
        const frac = overlap / Math.max(1, b.dx * b.dy);
        cellMassKg += b.weight * frac;

        const lc = loadByBoxId.get(b.id);
        if (lc) {
          if (lc.status === "unknown") hasUnverifiedTop = true;
          else if (lc.ratio !== undefined) maxTopRatio = Math.max(maxTopRatio, lc.ratio);
        }

        const topZ = b.z + b.dz;
        const minFoot = Math.max(1, Math.min(b.dx, b.dy));
        maxSlenderness = Math.max(maxSlenderness, topZ / minFoot);

        const sup = supportRatioByBox.get(b.id) ?? 100;
        minSupportPct = Math.min(minSupportPct, sup);
      }

      // Include pallet tare mass on floor
      for (const pl of pallets) {
        const ox = Math.max(0, Math.min(pl.x + pl.dx, x1) - Math.max(pl.x, x0));
        const oy = Math.max(0, Math.min(pl.y + pl.dy, y1) - Math.max(pl.y, y0));
        if (ox * oy > 1) {
          cellMassKg += pl.weight * ((ox * oy) / Math.max(1, pl.dx * pl.dy));
        }
      }

      // 1. Top Load cell
      if (!hasAnyBox) {
        topCells.push({ col: c, row: r, value: 0, status: "empty", color: COLOR_MAP.empty, label: "空位" });
      } else if (hasUnverifiedTop && maxTopRatio < 0) {
        topCells.push({ col: c, row: r, value: 0, status: "unverified", color: COLOR_MAP.unverified, label: "缺抗压资料(未核验)" });
      } else {
        const pct = Number((Math.max(0, maxTopRatio) * 100).toFixed(1));
        const st: HeatmapCellStatus = pct > 100 ? "high" : pct > 75 ? "caution" : hasUnverifiedTop ? "unverified" : "safe";
        topCells.push({ col: c, row: r, value: pct, status: st, color: COLOR_MAP[st], label: `${pct}%` });
      }

      // 2. Floor Load cell (kg/m2)
      const kgPerM2 = Number((cellMassKg / Math.max(0.01, cellAreaM2)).toFixed(0));
      if (cellMassKg <= 0.01) {
        floorCells.push({ col: c, row: r, value: 0, status: "empty", color: COLOR_MAP.empty, label: "0 kg/m²" });
      } else {
        const st: HeatmapCellStatus = kgPerM2 > 2200 ? "high" : kgPerM2 > 1400 ? "caution" : "safe";
        floorCells.push({ col: c, row: r, value: kgPerM2, status: st, color: COLOR_MAP[st], label: `${kgPerM2} kg/m²` });
      }

      // 3. Stability Risk cell (slenderness ratio topZ / minFoot)
      if (!hasAnyBox) {
        stabCells.push({ col: c, row: r, value: 0, status: "empty", color: COLOR_MAP.empty, label: "空位" });
      } else {
        const sl = Number(maxSlenderness.toFixed(2));
        const st: HeatmapCellStatus = sl > 4.5 ? "high" : sl > 3.0 ? "caution" : "safe";
        stabCells.push({ col: c, row: r, value: sl, status: st, color: COLOR_MAP[st], label: `${sl}×` });
      }

      // 4. Support Area cell (min support % in column)
      if (!hasAnyBox) {
        supCells.push({ col: c, row: r, value: 100, status: "empty", color: COLOR_MAP.empty, label: "空位" });
      } else {
        const st: HeatmapCellStatus = minSupportPct < 75 ? "high" : minSupportPct < 92 ? "caution" : "safe";
        supCells.push({ col: c, row: r, value: minSupportPct, status: st, color: COLOR_MAP[st], label: `${minSupportPct}%` });
      }
    }
  }

  const wrap = (kind: EngineeringHeatmapKind, unit: string, cells: HeatmapCell[]): EngineeringHeatmapGrid => {
    const active = cells.filter((c) => c.status !== "empty");
    const vals = active.map((c) => c.value);
    return {
      kind,
      cols,
      rows,
      unit,
      maxValue: vals.length ? Math.max(...vals) : 0,
      minValue: vals.length ? Math.min(...vals) : 0,
      unverifiedCount: cells.filter((c) => c.status === "unverified").length,
      highRiskCount: cells.filter((c) => c.status === "high").length,
      cells,
    };
  };

  return {
    topLoad: wrap("topLoad", "%", topCells),
    floorLoad: wrap("floorLoad", "kg/m²", floorCells),
    stability: wrap("stability", "×", stabCells),
    supportArea: wrap("supportArea", "%", supCells),
  };
}
