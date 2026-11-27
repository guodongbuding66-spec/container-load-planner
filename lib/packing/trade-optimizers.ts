import type { ContainerSpec, PackingResult, ProductInput } from "./types";
import {usableCargoLength} from "./site-exclusions";

/* ==================== M1: 一键凑满柜 (Gap-Fill Optimizer) ==================== */
export interface GapFillOptions {
  candidateSkuIds?: string[];
  strategy: "max_volume" | "max_value" | "balanced_ratio";
  targetUtilizationPct?: number;
  maxPayloadKg?: number;
  skuUnitPrices?: Record<string, number>;
  minAddIncrement?: Record<string, number>;
}

export interface GapFillSuggestion {
  productId: string;
  sku: string;
  currentQty: number;
  recommendedAddQty: number;
  newTotalQty: number;
  addedVolumeCbm: number;
  addedWeightKg: number;
  addedValueUsd: number;
}

export interface GapFillRecommendation {
  beforeVolumePct: number;
  afterVolumePct: number;
  beforeWeightPct: number;
  afterWeightPct: number;
  suggestions: GapFillSuggestion[];
  limitingFactor: "volume" | "weight" | "none";
  messageZh: string;
  messageEn: string;
}

export function suggestGapFill(
  plan: PackingResult,
  products: readonly ProductInput[],
  options: GapFillOptions,
): GapFillRecommendation {
  const targetPct = Math.min(98, Math.max(50, options.targetUtilizationPct ?? 94));
  const usableVolCbm =
    ((plan.container.length - 2 * plan.clearance) *
      (plan.container.width - 2 * plan.clearance) *
      (plan.container.height - plan.clearance)) /
    1e9;
  const maxWeightKg = options.maxPayloadKg ?? plan.container.maxWeight;
  const currentVolCbm = plan.metrics.loadedVolume / 1e9;
  const currentWeightKg = plan.metrics.grossWeight;

  const beforeVolumePct = usableVolCbm > 0 ? Number(((currentVolCbm / usableVolCbm) * 100).toFixed(1)) : 0;
  const beforeWeightPct = maxWeightKg > 0 ? Number(((currentWeightKg / maxWeightKg) * 100).toFixed(1)) : 0;

  let remVolCbm = Math.max(0, usableVolCbm * (targetPct / 100) - currentVolCbm);
  let remWeightKg = Math.max(0, maxWeightKg - currentWeightKg);

  const candidates = products.filter(
    (p) =>
      p.length > 0 &&
      p.width > 0 &&
      p.height > 0 &&
      (!options.candidateSkuIds || options.candidateSkuIds.length === 0 || options.candidateSkuIds.includes(p.id)),
  );

  if (!candidates.length || (remVolCbm <= 0.01 && remWeightKg <= 1)) {
    const limitingFactor = remWeightKg <= 1 ? "weight" : remVolCbm <= 0.01 ? "volume" : "none";
    return {
      beforeVolumePct,
      afterVolumePct: beforeVolumePct,
      beforeWeightPct,
      afterWeightPct: beforeWeightPct,
      suggestions: [],
      limitingFactor,
      messageZh: "当前集装箱空间或载重已接近目标上限，无需继续补单。",
      messageEn: "Container volume or payload is already near the target limit.",
    };
  }

  const ranked = [...candidates].sort((a, b) => {
    const volA = (a.length * a.width * a.height) / 1e9;
    const volB = (b.length * b.width * b.height) / 1e9;
    if (options.strategy === "max_value") {
      const valA = (options.skuUnitPrices?.[a.id] ?? 0) / Math.max(volA, 1e-6);
      const valB = (options.skuUnitPrices?.[b.id] ?? 0) / Math.max(volB, 1e-6);
      return valB - valA;
    }
    if (options.strategy === "balanced_ratio") {
      return b.quantity - a.quantity;
    }
    // max_volume: pack smaller/flexible cartons last or higher-yield cartons first
    return volB - volA;
  });

  const addMap = new Map<string, number>();
  let limitingFactor: "volume" | "weight" | "none" = "none";

  if (options.strategy === "balanced_ratio") {
    const totalQty = ranked.reduce((s, p) => s + Math.max(1, p.quantity), 0);
    const avgVol = ranked.reduce((s, p) => s + ((p.length * p.width * p.height) / 1e9) * (Math.max(1, p.quantity) / totalQty), 0);
    const avgWt = ranked.reduce((s, p) => s + p.weight * (Math.max(1, p.quantity) / totalQty), 0);
    const maxByVol = avgVol > 0 ? Math.floor((remVolCbm * 0.88) / avgVol) : 0;
    const maxByWt = avgWt > 0 ? Math.floor(remWeightKg / avgWt) : maxByVol;
    const totalAdd = Math.max(0, Math.min(maxByVol, maxByWt));
    limitingFactor = maxByWt < maxByVol ? "weight" : "volume";

    for (const p of ranked) {
      const inc = Math.max(1, options.minAddIncrement?.[p.id] ?? 1);
      const share = Math.floor((totalAdd * (Math.max(1, p.quantity) / totalQty)) / inc) * inc;
      if (share > 0) {
        const vol = ((p.length * p.width * p.height) / 1e9) * share;
        const wt = p.weight * share;
        if (vol <= remVolCbm && wt <= remWeightKg) {
          addMap.set(p.id, share);
          remVolCbm -= vol;
          remWeightKg -= wt;
        }
      }
    }
  } else {
    for (const p of ranked) {
      const unitVol = (p.length * p.width * p.height) / 1e9;
      const inc = Math.max(1, options.minAddIncrement?.[p.id] ?? 1);
      // Apply 0.88 practical packing efficiency factor on remaining void
      const byVol = unitVol > 0 ? Math.floor((remVolCbm * 0.88) / unitVol) : 0;
      const byWt = p.weight > 0 ? Math.floor(remWeightKg / p.weight) : byVol;
      const rawMax = Math.min(byVol, byWt);
      const addQty = Math.floor(rawMax / inc) * inc;
      if (byWt < byVol) limitingFactor = "weight";
      else if (limitingFactor === "none") limitingFactor = "volume";
      if (addQty > 0) {
        addMap.set(p.id, addQty);
        remVolCbm = Math.max(0, remVolCbm - unitVol * addQty);
        remWeightKg = Math.max(0, remWeightKg - p.weight * addQty);
      }
    }
  }

  const suggestions: GapFillSuggestion[] = [];
  let addedVolTotal = 0;
  let addedWtTotal = 0;

  for (const p of ranked) {
    const add = addMap.get(p.id) ?? 0;
    if (add <= 0) continue;
    const addedVolumeCbm = Number((((p.length * p.width * p.height) / 1e9) * add).toFixed(3));
    const addedWeightKg = Number((p.weight * add).toFixed(1));
    const addedValueUsd = Number(((options.skuUnitPrices?.[p.id] ?? 0) * add).toFixed(2));
    addedVolTotal += addedVolumeCbm;
    addedWtTotal += addedWeightKg;
    suggestions.push({
      productId: p.id,
      sku: p.sku,
      currentQty: p.quantity,
      recommendedAddQty: add,
      newTotalQty: p.quantity + add,
      addedVolumeCbm,
      addedWeightKg,
      addedValueUsd,
    });
  }

  const afterVolumePct = usableVolCbm > 0 ? Number((((currentVolCbm + addedVolTotal) / usableVolCbm) * 100).toFixed(1)) : beforeVolumePct;
  const afterWeightPct = maxWeightKg > 0 ? Number((((currentWeightKg + addedWtTotal) / maxWeightKg) * 100).toFixed(1)) : beforeWeightPct;

  const summaryPartsZh = suggestions.map((s) => `${s.sku} +${s.recommendedAddQty} 箱`).join("、");
  const summaryPartsEn = suggestions.map((s) => `${s.sku} +${s.recommendedAddQty} ctns`).join(", ");

  return {
    beforeVolumePct,
    afterVolumePct,
    beforeWeightPct,
    afterWeightPct,
    suggestions,
    limitingFactor,
    messageZh: suggestions.length
      ? `建议补单 ${summaryPartsZh}，可将体积利用率从 ${beforeVolumePct}% 提升至约 ${afterVolumePct}%（需点“应用并重算”以做 3D 终验）。`
      : "剩余空隙不足以按设定增量继续补单。",
    messageEn: suggestions.length
      ? `Add ${summaryPartsEn} to raise volume utilization from ${beforeVolumePct}% to ~${afterVolumePct}% (apply and recalculate for 3D verification).`
      : "Remaining space is too small for the requested increment.",
  };
}

/* ==================== M2: 风车式排托分析 (Pinwheel Pallet Layout) ==================== */
export interface PinwheelAnalysis {
  alignedLongCount: number;
  alignedCrossCount: number;
  pinwheelCount: number;
  gainOverAligned: number;
  requiresFourWayPallet: boolean;
  placements: Array<{ x: number; y: number; dx: number; dy: number; rotated: boolean }>;
}

export function analyzePinwheelPallets(
  container: ContainerSpec,
  palletL: number,
  palletW: number,
  clearance = 0,
): PinwheelAnalysis {
  const L = usableCargoLength(container,clearance);
  const W = Math.min(container.width, container.loadingAccess === "open" ? container.width : container.doorWidth) - 2 * clearance;
  if (L <= 0 || W <= 0 || palletL <= 0 || palletW <= 0) {
    return { alignedLongCount: 0, alignedCrossCount: 0, pinwheelCount: 0, gainOverAligned: 0, requiresFourWayPallet: false, placements: [] };
  }

  const alignedLongCount = Math.floor(L / palletL) * Math.floor(W / palletW);
  const alignedCrossCount = Math.floor(L / palletW) * Math.floor(W / palletL);
  const bestAligned = Math.max(alignedLongCount, alignedCrossCount);

  // Pinwheel / mixed-row DP along container length L:
  // Column type A: lengthwise (dx = palletL), fits floor(W / palletW) pallets
  // Column type B: crosswise (dx = palletW), fits floor(W / palletL) pallets
  // Interleaved pinwheel pair when palletL + palletW <= W: 2 pallets side-by-side (one LxW, one WxL)
  const placements: Array<{ x: number; y: number; dx: number; dy: number; rotated: boolean }> = [];

  let bestCount = bestAligned;
  let bestCols: Array<{ dx: number; items: Array<{ y: number; dx: number; dy: number; rotated: boolean }> }> = [];

  const colsA = Math.floor(W / palletW);
  const colsB = Math.floor(W / palletL);

  const maxA = Math.floor(L / palletL);
  for (let a = 0; a <= maxA; a++) {
    const remL = L - a * palletL;
    const b = Math.floor(remL / palletW);
    const total = a * colsA + b * colsB;
    if (total > bestCount) {
      bestCount = total;
      bestCols = [];
      for (let i = 0; i < a; i++) {
        const items = [];
        for (let j = 0; j < colsA; j++) items.push({ y: j * palletW, dx: palletL, dy: palletW, rotated: false });
        bestCols.push({ dx: palletL, items });
      }
      for (let i = 0; i < b; i++) {
        const items = [];
        for (let j = 0; j < colsB; j++) items.push({ y: j * palletL, dx: palletW, dy: palletL, rotated: true });
        bestCols.push({ dx: palletW, items });
      }
    }
  }

  // Also check classic 2-lane pinwheel (lane 1 along L with palletL, lane 2 along L with palletW when palletL + palletW <= W)
  if (palletL + palletW <= W) {
    const lane1 = Math.floor(L / palletL);
    const lane2 = Math.floor(L / palletW);
    const total = lane1 + lane2;
    if (total > bestCount) {
      bestCount = total;
      bestCols = [];
      for (let i = 0; i < lane1; i++) placements.push({ x: i * palletL, y: 0, dx: palletL, dy: palletW, rotated: false });
      for (let i = 0; i < lane2; i++) placements.push({ x: i * palletW, y: palletW, dx: palletW, dy: palletL, rotated: true });
    }
  }

  if (placements.length === 0 && bestCols.length > 0) {
    let cursorX = 0;
    for (const col of bestCols) {
      for (const item of col.items) {
        placements.push({ x: cursorX, y: item.y, dx: item.dx, dy: item.dy, rotated: item.rotated });
      }
      cursorX += col.dx;
    }
  }

  if (placements.length === 0 && bestAligned > 0) {
    const rotated = alignedCrossCount > alignedLongCount;
    const [dx,dy] = rotated ? [palletW,palletL] : [palletL,palletW];
    for (let x=0; x+dx<=L; x+=dx) for (let y=0; y+dy<=W; y+=dy) placements.push({x,y,dx,dy,rotated});
  }
  return {
    alignedLongCount,
    alignedCrossCount,
    pinwheelCount: bestCount,
    gainOverAligned: Math.max(0, bestCount - bestAligned),
    requiresFourWayPallet: bestCount > bestAligned,
    placements,
  };
}

/* ==================== M3: 纸箱尺寸反推与改箱增容优化器 (Carton Fit) ==================== */
export interface CartonTweakCandidate {
  lengthMm: number;
  widthMm: number;
  heightMm: number;
  deltaL: number;
  deltaW: number;
  deltaH: number;
  cartonsPerContainer: number;
  gainCartons: number;
  gainPercent: number;
  freightSavedPerCartonUsd?: number;
}

function quickContainerCapacity(l: number, w: number, h: number, weightKg: number, container: ContainerSpec, clearance: number): number {
  const L = usableCargoLength(container,clearance);
  const W = Math.min(container.width, container.loadingAccess === "open" ? container.width : container.doorWidth) - 2 * clearance;
  const H = Math.min(container.height, container.loadingAccess === "open" ? container.height : container.doorHeight) - clearance;
  if (l <= 0 || w <= 0 || h <= 0 || L <= 0 || W <= 0 || H <= 0) return 0;

  const orient1 = Math.floor(L / l) * Math.floor(W / w) * Math.floor(H / h);
  const orient2 = Math.floor(L / w) * Math.floor(W / l) * Math.floor(H / h);
  const byVol = Math.max(orient1, orient2);
  const byWeight = weightKg > 0 ? Math.floor(container.maxWeight / weightKg) : byVol;
  return Math.min(byVol, byWeight);
}

export function optimizeCartonDimensions(
  carton: { length: number; width: number; height: number; weight: number },
  container: ContainerSpec,
  clearance = 10,
  options: { maxDeltaMm?: number; stepMm?: number; containerFreightUsd?: number } = {},
): { baselineCount: number; candidates: CartonTweakCandidate[] } {
  const maxDelta = options.maxDeltaMm ?? 30;
  const step = Math.max(5, options.stepMm ?? 5);
  const baselineCount = quickContainerCapacity(carton.length, carton.width, carton.height, carton.weight, container, clearance);
  const results: CartonTweakCandidate[] = [];

  for (let dL = -maxDelta; dL <= 0; dL += step) {
    for (let dW = -maxDelta; dW <= 0; dW += step) {
      for (let dH = -maxDelta; dH <= 0; dH += step) {
        if (dL === 0 && dW === 0 && dH === 0) continue;
        // Prefer single-axis or two-axis practical edits
        const axesChanged = (dL !== 0 ? 1 : 0) + (dW !== 0 ? 1 : 0) + (dH !== 0 ? 1 : 0);
        if (axesChanged > 2) continue;

        const nl = carton.length + dL;
        const nw = carton.width + dW;
        const nh = carton.height + dH;
        if (nl < 50 || nw < 50 || nh < 50) continue;

        const count = quickContainerCapacity(nl, nw, nh, carton.weight, container, clearance);
        const gain = count - baselineCount;
        if (gain > 0) {
          const freightSavedPerCartonUsd =
            options.containerFreightUsd && baselineCount > 0 && count > 0
              ? Number((options.containerFreightUsd / baselineCount - options.containerFreightUsd / count).toFixed(2))
              : undefined;
          results.push({
            lengthMm: nl,
            widthMm: nw,
            heightMm: nh,
            deltaL: dL,
            deltaW: dW,
            deltaH: dH,
            cartonsPerContainer: count,
            gainCartons: gain,
            gainPercent: baselineCount > 0 ? Number(((gain / baselineCount) * 100).toFixed(1)) : 100,
            freightSavedPerCartonUsd,
          });
        }
      }
    }
  }

  // Sort by highest gain, then smallest total dimension reduction
  results.sort((a, b) => {
    if (b.gainCartons !== a.gainCartons) return b.gainCartons - a.gainCartons;
    const magA = Math.abs(a.deltaL) + Math.abs(a.deltaW) + Math.abs(a.deltaH);
    const magB = Math.abs(b.deltaL) + Math.abs(b.deltaW) + Math.abs(b.deltaH);
    return magA - magB;
  });

  // Deduplicate by cartonsPerContainer keeping minimal change
  const deduped: CartonTweakCandidate[] = [];
  const seenCounts = new Set<number>();
  for (const r of results) {
    if (seenCounts.has(r.cartonsPerContainer)) continue;
    seenCounts.add(r.cartonsPerContainer);
    deduped.push(r);
    if (deduped.length >= 5) break;
  }

  return { baselineCount, candidates: deduped };
}

/* ==================== M4: 多客户/多目的港 LIFO 复核与运费分摊 ==================== */
export type FreightSplitMethod = "cbm" | "wm" | "ldm";

export interface ConsigneeSplitRow {
  groupKey: string;
  customer: string;
  destination: string;
  unloadStop: number;
  cartons: number;
  volumeCbm: number;
  weightKg: number;
  ldmMeters: number;
  sharePercent: number;
  allocatedFreight: number;
  avgCenterXMm: number;
}

export interface ConsigneeSplitReport {
  method: FreightSplitMethod;
  totalFreight: number;
  currency: string;
  lifoCompliant: boolean;
  lifoNoteZh: string;
  lifoNoteEn: string;
  rows: ConsigneeSplitRow[];
}

export function calculateConsigneeFreightSplit(
  plan: PackingResult,
  products: readonly ProductInput[],
  totalFreight: number,
  currency = "USD",
  method: FreightSplitMethod = "cbm",
): ConsigneeSplitReport {
  const prodMap = new Map(products.map((p) => [p.id, p]));
  const buckets = new Map<
    string,
    {
      customer: string;
      destination: string;
      unloadStop: number;
      cartons: number;
      volumeCbm: number;
      weightKg: number;
      minX: number;
      maxX: number;
      sumCenterX: number;
    }
  >();

  for (const box of plan.placements) {
    const prod = prodMap.get(box.productId);
    const customer = prod?.orderLine?.customer?.trim() || "默认客户 / Default";
    const destination = prod?.orderLine?.destination?.trim() || "主目的港 / Main POD";
    const unloadStop = prod?.orderLine?.stop || 1;
    const key = `${unloadStop}::${customer}::${destination}`;
    const vol = (box.dx * box.dy * box.dz) / 1e9;
    const centerX = box.x + box.dx / 2;

    const existing = buckets.get(key);
    if (existing) {
      existing.cartons += 1;
      existing.volumeCbm += vol;
      existing.weightKg += box.weight;
      existing.minX = Math.min(existing.minX, box.x);
      existing.maxX = Math.max(existing.maxX, box.x + box.dx);
      existing.sumCenterX += centerX;
    } else {
      buckets.set(key, {
        customer,
        destination,
        unloadStop,
        cartons: 1,
        volumeCbm: vol,
        weightKg: box.weight,
        minX: box.x,
        maxX: box.x + box.dx,
        sumCenterX: centerX,
      });
    }
  }

  const rawRows = [...buckets.entries()].map(([groupKey, b]) => ({
    groupKey,
    customer: b.customer,
    destination: b.destination,
    unloadStop: b.unloadStop,
    cartons: b.cartons,
    volumeCbm: Number(b.volumeCbm.toFixed(4)),
    weightKg: Number(b.weightKg.toFixed(2)),
    ldmMeters: Number(((b.maxX - b.minX) / 1000).toFixed(2)),
    avgCenterXMm: Math.round(b.sumCenterX / Math.max(1, b.cartons)),
    basis:
      method === "wm"
        ? Math.max(b.volumeCbm, b.weightKg / 1000)
        : method === "ldm"
          ? Math.max(0.01, (b.maxX - b.minX) / 1000)
          : b.volumeCbm,
  }));

  rawRows.sort((a, b) => a.unloadStop - b.unloadStop || b.volumeCbm - a.volumeCbm);

  const totalBasis = rawRows.reduce((s, r) => s + r.basis, 0);
  let allocatedRunning = 0;

  const rows: ConsigneeSplitRow[] = rawRows.map((r, idx) => {
    const share = totalBasis > 0 ? r.basis / totalBasis : 0;
    const isLast = idx === rawRows.length - 1;
    const allocatedFreight = isLast
      ? Number(Math.max(0, totalFreight - allocatedRunning).toFixed(2))
      : Number((totalFreight * share).toFixed(2));
    allocatedRunning += allocatedFreight;

    return {
      groupKey: r.groupKey,
      customer: r.customer,
      destination: r.destination,
      unloadStop: r.unloadStop,
      cartons: r.cartons,
      volumeCbm: r.volumeCbm,
      weightKg: r.weightKg,
      ldmMeters: r.ldmMeters,
      sharePercent: Number((share * 100).toFixed(1)),
      allocatedFreight,
      avgCenterXMm: r.avgCenterXMm,
    };
  });

  // Check LIFO: stop 1 should have >= avgCenterXMm than stop 2 (closer to rear door x = container.length)
  let lifoCompliant = true;
  for (let i = 1; i < rows.length; i++) {
    if (rows[i].unloadStop > rows[i - 1].unloadStop && rows[i].avgCenterXMm > rows[i - 1].avgCenterXMm) {
      lifoCompliant = false;
      break;
    }
  }

  return {
    method,
    totalFreight,
    currency,
    lifoCompliant,
    lifoNoteZh: lifoCompliant
      ? "多站点卸货顺序（LIFO）满足“先卸靠门、后卸靠里”。"
      : "检测到后卸站点货物重心比先卸站点更靠柜门，建议调高先卸站点的装载优先级或启用分批隔离。",
    lifoNoteEn: lifoCompliant
      ? "Multi-stop LIFO order verified (first stop closest to door)."
      : "Later stop cargo is placed closer to the door than an earlier stop; adjust priorities or partition stops.",
    rows,
  };
}

/* ==================== M3 Mode B: 内件彩盒 → 外箱装率反推 (Unit to Master Carton) ==================== */
export interface UnitToCartonSpec {
  unitLengthMm: number;
  unitWidthMm: number;
  unitHeightMm: number;
  unitWeightKg: number;
  wallThicknessMm?: number;     // 双瓦楞壁厚默认 14 mm（双侧合计）
  maxCartonWeightKg?: number;   // 如 FBA 限重 22.5 kg
  maxCartonSideMm?: number;     // 如 FBA 单边限长 635 mm，默认 900 mm
  minPcsPerCarton?: number;
  maxPcsPerCarton?: number;
}

export interface MasterCartonCandidate {
  nx: number;
  ny: number;
  nz: number;
  pcsPerCarton: number;
  cartonLengthMm: number;
  cartonWidthMm: number;
  cartonHeightMm: number;
  cartonWeightKg: number;
  cartonsPerContainer: number;
  totalUnitsPerContainer: number;
  volumeUtilizationPct: number;
}

export function optimizeMasterCartonFromUnit(
  spec: UnitToCartonSpec,
  container: ContainerSpec,
  clearance = 10,
): MasterCartonCandidate[] {
  const wall = spec.wallThicknessMm ?? 14;
  const maxWt = spec.maxCartonWeightKg ?? 22.5;
  const maxSide = spec.maxCartonSideMm ?? 900;
  const minPcs = Math.max(1, spec.minPcsPerCarton ?? 4);
  const maxPcs = Math.max(minPcs, spec.maxPcsPerCarton ?? 24);
  const usableVolCbm =
    (usableCargoLength(container,clearance) *
      (container.width - 2 * clearance) *
      (container.height - clearance)) /
    1e9;

  if (spec.unitLengthMm <= 0 || spec.unitWidthMm <= 0 || spec.unitHeightMm <= 0 || spec.unitWeightKg < 0) {
    return [];
  }

  const candidates: MasterCartonCandidate[] = [];
  const seen = new Set<string>();

  for (let nx = 1; nx <= maxPcs; nx++) {
    for (let ny = 1; ny <= maxPcs; ny++) {
      if (nx * ny > maxPcs) break;
      for (let nz = 1; nz <= maxPcs; nz++) {
        const pcs = nx * ny * nz;
        if (pcs < minPcs) continue;
        if (pcs > maxPcs) break;

        const cL = Math.round(nx * spec.unitLengthMm + wall);
        const cW = Math.round(ny * spec.unitWidthMm + wall);
        const cH = Math.round(nz * spec.unitHeightMm + wall);
        if (Math.max(cL, cW, cH) > maxSide) continue;

        // Add ~0.6 kg tare weight for corrugated master carton
        const cWt = Number((pcs * spec.unitWeightKg + 0.6).toFixed(2));
        if (cWt > maxWt) continue;

        const key = `${cL}x${cW}x${cH}:${pcs}`;
        if (seen.has(key)) continue;
        seen.add(key);

        const cartonsPerContainer = quickContainerCapacity(cL, cW, cH, cWt, container, clearance);
        if (cartonsPerContainer <= 0) continue;
        const totalUnits = cartonsPerContainer * pcs;
        const usedVol = ((cL * cW * cH) / 1e9) * cartonsPerContainer;
        const volPct = usableVolCbm > 0 ? Number(((usedVol / usableVolCbm) * 100).toFixed(1)) : 0;

        candidates.push({
          nx,
          ny,
          nz,
          pcsPerCarton: pcs,
          cartonLengthMm: cL,
          cartonWidthMm: cW,
          cartonHeightMm: cH,
          cartonWeightKg: cWt,
          cartonsPerContainer,
          totalUnitsPerContainer: totalUnits,
          volumeUtilizationPct: volPct,
        });
      }
    }
  }

  candidates.sort((a, b) => b.totalUnitsPerContainer - a.totalUnitsPerContainer || b.volumeUtilizationPct - a.volumeUtilizationPct);
  return candidates.slice(0, 5);
}

/* ==================== M2 扩展: 托盘顶面叠放散箱 3D 坐标规划 ==================== */
export interface PalletTopLoosePlacement {
  palletId: string;
  productId: string;
  sku: string;
  x: number;
  y: number;
  z: number;
  dx: number;
  dy: number;
  dz: number;
  weightKg: number;
}

export function placeLooseOnPalletTops(
  plan: PackingResult,
  looseProducts: readonly ProductInput[],
): PalletTopLoosePlacement[] {
  const pallets = plan.pallets ?? [];
  if (!pallets.length || !looseProducts.length) return [];

  const ceilingMm = Math.min(
    plan.container.height,
    plan.container.loadingAccess === "open" ? plan.container.height : plan.container.doorHeight,
  ) - plan.clearance;

  const placed: PalletTopLoosePlacement[] = [];
  const remaining = new Map(looseProducts.map((pr) => [pr.id, Math.max(0, pr.quantity)]));

  for (const plt of pallets) {
    const onPallet = plan.placements.filter((b) => b.palletIds?.includes(plt.id));
    const currentTopZ = onPallet.reduce((m, b) => Math.max(m, b.z + b.dz), plt.z + plt.dz);
    const currentLoadKg = onPallet.reduce((sum, b) => sum + b.weight, 0);
    let remLoadKg = Math.max(0, plt.maxLoad - currentLoadKg);
    const availH = ceilingMm - currentTopZ;
    if (availH < 50 || remLoadKg <= 0) continue;

    for (const prod of looseProducts) {
      let qty = remaining.get(prod.id) ?? 0;
      if (qty <= 0 || prod.height > availH || prod.weight > remLoadKg) continue;

      const colsX = Math.floor(plt.dx / prod.length);
      const colsY = Math.floor(plt.dy / prod.width);
      const layersZ = Math.floor(availH / prod.height);
      if (colsX <= 0 || colsY <= 0 || layersZ <= 0) continue;

      for (let lz = 0; lz < layersZ && qty > 0; lz++) {
        for (let ix = 0; ix < colsX && qty > 0; ix++) {
          for (let iy = 0; iy < colsY && qty > 0; iy++) {
            if (prod.weight > remLoadKg) break;
            placed.push({
              palletId: plt.id,
              productId: prod.id,
              sku: prod.sku,
              x: Number((plt.x + ix * prod.length).toFixed(2)),
              y: Number((plt.y + iy * prod.width).toFixed(2)),
              z: Number((currentTopZ + lz * prod.height).toFixed(2)),
              dx: prod.length,
              dy: prod.width,
              dz: prod.height,
              weightKg: prod.weight,
            });
            remLoadKg -= prod.weight;
            qty -= 1;
          }
        }
      }
      remaining.set(prod.id, qty);
      break;
    }
  }
  return placed;
}
