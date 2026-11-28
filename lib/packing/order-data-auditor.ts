import { normalizedSetCode, normalizedUnitsPerSet } from "./set-utils";
import type { ContainerSpec, ProductInput } from "./types";

export type AuditSeverity = "error" | "warn";
export type AuditIssueCode =
  | "unit_mismatch_suspected"
  | "dimension_order_unusual"
  | "density_extreme"
  | "duplicate_sku"
  | "kit_ratio_mismatch"
  | "oversized_for_container"
  | "total_weight_over_payload";

export interface OrderAuditIssue {
  id: string;
  code: AuditIssueCode;
  severity: AuditSeverity;
  sku?: string;
  productId?: string;
  messageZh: string;
  messageEn: string;
  fixable?: boolean;
}

export interface OrderAuditSummary {
  issues: OrderAuditIssue[];
  errorCount: number;
  warnCount: number;
  healthy: boolean;
}

/**
 * Deterministic Order Data Anomaly & Sanity Auditor (Direction 11).
 * Catches unit confusion (mm vs cm/in), unusual L/W/H order, extreme density,
 * duplicate SKUs, non-integer kit ratios, oversized items, and payload exceedance.
 */
export function auditOrderInputs(
  products: readonly ProductInput[],
  container: ContainerSpec,
  clearance = 0,
): OrderAuditSummary {
  const issues: OrderAuditIssue[] = [];
  if (!products.length) {
    return { issues, errorCount: 0, warnCount: 0, healthy: true };
  }

  const maxDimList = products.map((p) => Math.max(p.length, p.width, p.height));
  const hasLargeMmItem = maxDimList.some((d) => d >= 500);
  const usableL = Math.max(1, container.length - clearance * 2);
  const usableW = Math.max(1, container.width - clearance * 2);
  const usableH = Math.max(1, container.height - clearance);

  // 1. Duplicate SKU check
  const skuCounts = new Map<string, number>();
  for (const p of products) {
    const key = p.sku.trim().toUpperCase();
    if (!key) continue;
    skuCounts.set(key, (skuCounts.get(key) ?? 0) + 1);
  }
  for (const [sku, count] of skuCounts) {
    if (count > 1) {
      issues.push({
        id: `dup-${sku}`,
        code: "duplicate_sku",
        severity: "warn",
        sku,
        messageZh: `检测到重复 SKU「${sku}」共 ${count} 行，请确认是否为不同客户批次或误重复导入。`,
        messageEn: `Duplicate SKU "${sku}" appears ${count} times; verify if intentional.`,
      });
    }
  }

  // 2. Per-SKU geometry, unit-confusion, density & container fit checks
  let totalOrderWeight = 0;
  for (const p of products) {
    totalOrderWeight += Math.max(0, p.weight) * Math.max(0, p.quantity);
    const maxD = Math.max(p.length, p.width, p.height);
    const minD = Math.min(p.length, p.width, p.height);

    // Suspected cm/in entered as mm
    if (hasLargeMmItem && maxD > 0 && maxD < 80) {
      issues.push({
        id: `unit-${p.id}`,
        code: "unit_mismatch_suspected",
        severity: "warn",
        sku: p.sku,
        productId: p.id,
        messageZh: `${p.sku} 最大边仅 ${maxD} mm，而同单存在 ≥500 mm 货物，疑似混淆了 cm / inch 与 mm。`,
        messageEn: `${p.sku} max edge is ${maxD} mm while other rows are ≥500 mm; check for cm/in vs mm mix-up.`,
      });
    } else if (maxD > 15000) {
      issues.push({
        id: `unit-huge-${p.id}`,
        code: "unit_mismatch_suspected",
        severity: "error",
        sku: p.sku,
        productId: p.id,
        messageZh: `${p.sku} 最大边达 ${maxD} mm（超 15 米），疑似多输了一位 0。`,
        messageEn: `${p.sku} max edge is ${maxD} mm (>15m); check for extra digit.`,
      });
    }

    // Unusual L < W
    if (p.length > 0 && p.width > 0 && p.width > p.length * 1.05 && p.rotationPolicy !== "fixed") {
      issues.push({
        id: `order-${p.id}`,
        code: "dimension_order_unusual",
        severity: "warn",
        sku: p.sku,
        productId: p.id,
        messageZh: `${p.sku} 外箱宽（${p.width}）大于长（${p.length}），建议核对长宽顺序。`,
        messageEn: `${p.sku} width (${p.width}) exceeds length (${p.length}); verify L/W order.`,
      });
    }

    // Density check (kg/m3)
    const volM3 = (p.length * p.width * p.height) / 1e9;
    if (volM3 > 0 && p.weight > 0) {
      const density = p.weight / volM3;
      if (density < 5) {
        issues.push({
          id: `dens-low-${p.id}`,
          code: "density_extreme",
          severity: "warn",
          sku: p.sku,
          productId: p.id,
          messageZh: `${p.sku} 体积密度仅 ${density.toFixed(1)} kg/m³（偏轻），请核对单箱毛重是否误填为单件净重或漏零。`,
          messageEn: `${p.sku} density is very low (${density.toFixed(1)} kg/m³); check gross weight.`,
        });
      } else if (density > 4500) {
        issues.push({
          id: `dens-high-${p.id}`,
          code: "density_extreme",
          severity: "warn",
          sku: p.sku,
          productId: p.id,
          messageZh: `${p.sku} 体积密度达 ${Math.round(density)} kg/m³（异常偏重），请核对是否将克(g)误填为千克(kg)。`,
          messageEn: `${p.sku} density is unusually high (${Math.round(density)} kg/m³); check g vs kg.`,
        });
      }
    }

    // Container fit quick check (sorted dims vs sorted container dims)
    if (minD > 0) {
      const boxSorted = [p.length, p.width, p.height].sort((a, b) => a - b);
      const ctnSorted = [usableL, usableW, usableH].sort((a, b) => a - b);
      if (boxSorted[0] > ctnSorted[0] || boxSorted[1] > ctnSorted[1] || boxSorted[2] > ctnSorted[2]) {
        issues.push({
          id: `fit-${p.id}`,
          code: "oversized_for_container",
          severity: "error",
          sku: p.sku,
          productId: p.id,
          messageZh: `${p.sku}（${p.length}×${p.width}×${p.height} mm）超出当前柜体可用净空（${usableL}×${usableW}×${usableH} mm），将无法装入。`,
          messageEn: `${p.sku} exceeds usable container dimensions (${usableL}×${usableW}×${usableH} mm).`,
        });
      }
    }
  }

  // 3. Kit ratio & complete-set divisibility check
  const kits = new Map<string, ProductInput[]>();
  for (const p of products) {
    const code = normalizedSetCode(p);
    if (code) kits.set(code, [...(kits.get(code) ?? []), p]);
  }
  for (const [code, members] of kits) {
    const setCounts = members.map((m) => m.quantity / normalizedUnitsPerSet(m));
    const allWholeAndEqual = setCounts.every((c) => Number.isInteger(c) && c === setCounts[0]);
    if (!allWholeAndEqual) {
      const minComplete = Math.floor(Math.min(...setCounts));
      issues.push({
        id: `kit-${code}`,
        code: "kit_ratio_mismatch",
        severity: "warn",
        sku: code,
        fixable: true,
        messageZh: `套装「${code}」各成员箱数与套内比例不完全匹配（当前最多配齐 ${minComplete} 完整套），存在无法成套尾箱。`,
        messageEn: `Kit "${code}" member quantities do not form equal whole sets (max ${minComplete} complete sets).`,
      });
    }
  }

  // 4. Total payload check
  if (totalOrderWeight > container.maxWeight) {
    const excessKg = Math.round(totalOrderWeight - container.maxWeight);
    issues.push({
      id: "payload-over",
      code: "total_weight_over_payload",
      severity: "warn",
      messageZh: `订单总毛重 ${Math.round(totalOrderWeight).toLocaleString()} kg 超过单柜最大净载重（${container.maxWeight.toLocaleString()} kg）约 ${excessKg.toLocaleString()} kg，计算时将触发限重截断或需分柜。`,
      messageEn: `Total order weight (${Math.round(totalOrderWeight).toLocaleString()} kg) exceeds container payload by ${excessKg.toLocaleString()} kg.`,
    });
  }

  const errorCount = issues.filter((i) => i.severity === "error").length;
  const warnCount = issues.filter((i) => i.severity === "warn").length;
  return {
    issues,
    errorCount,
    warnCount,
    healthy: issues.length === 0,
  };
}


/* ==================== Direction 11: Full 7-Check Packing List & Invoice Data Validator ==================== */
export interface ExtendedOrderRowInput {
  product: ProductInput;
  /** Optional declared net weight per carton (kg) from commercial invoice / packing list. */
  netWeightKg?: number;
  /** Optional declared total CBM for this line from packing list. */
  declaredTotalCbm?: number;
  /** Optional customer batch / PO number. */
  batchCode?: string;
}

export type ExtendedAuditCode =
  | AuditIssueCode
  | "net_exceeds_gross"
  | "cbm_dimension_mismatch"
  | "quantity_exceeds_physical_limit";

export interface ExtendedOrderAuditIssue {
  id: string;
  code: ExtendedAuditCode;
  severity: AuditSeverity;
  sku?: string;
  productId?: string;
  messageZh: string;
  messageEn: string;
  suggestedFixZh?: string;
  suggestedFixEn?: string;
}

export interface ExtendedOrderAuditSummary {
  issues: ExtendedOrderAuditIssue[];
  errorCount: number;
  warnCount: number;
  healthy: boolean;
}

/**
 * Full 7-Check Packing List Validator (Direction 11):
 * 1. cm/mm/inch unit confusion
 * 2. L/W/H order anomaly
 * 3. Net weight > Gross weight
 * 4. Declared CBM vs geometric L*W*H*qty mismatch (>5%)
 * 5. Kit / set-to-carton ratio error
 * 6. Duplicate SKU / duplicate order lines
 * 7. Carton quantity exceeding physical container capacity ceiling
 */
export function auditExtendedOrderRows(
  rows: readonly ExtendedOrderRowInput[],
  container: ContainerSpec,
  clearance = 0,
): ExtendedOrderAuditSummary {
  const base = auditOrderInputs(
    rows.map((r) => r.product),
    container,
    clearance,
  );
  const issues: ExtendedOrderAuditIssue[] = base.issues.map((i) => ({
    id: i.id,
    code: i.code,
    severity: i.severity,
    sku: i.sku,
    productId: i.productId,
    messageZh: i.messageZh,
    messageEn: i.messageEn,
  }));

  const containerVolM3 = (container.length * container.width * container.height) / 1e9;

  for (const row of rows) {
    const p = row.product;
    // Check 3: Net weight > Gross weight
    if (typeof row.netWeightKg === "number" && Number.isFinite(row.netWeightKg) && row.netWeightKg > p.weight) {
      issues.push({
        id: `net-gt-gross-${p.id}`,
        code: "net_exceeds_gross",
        severity: "error",
        sku: p.sku,
        productId: p.id,
        messageZh: `SKU「${p.sku}」净重（${row.netWeightKg} kg）大于毛重（${p.weight} kg），违反物理常识。`,
        messageEn: `SKU "${p.sku}" net weight (${row.netWeightKg} kg) exceeds gross weight (${p.weight} kg).`,
        suggestedFixZh: "互换毛净重列或按毛重 = 净重 + 外箱皮重修正。",
        suggestedFixEn: "Swap net/gross columns or set gross weight = net weight + carton tare.",
      });
    }

    // Check 4: Declared CBM vs geometric L*W*H*qty (>5% deviation)
    const computedCbm = (p.length * p.width * p.height * Math.max(0, p.quantity)) / 1e9;
    if (
      typeof row.declaredTotalCbm === "number" &&
      Number.isFinite(row.declaredTotalCbm) &&
      row.declaredTotalCbm > 0 &&
      computedCbm > 0
    ) {
      const relDiff = Math.abs(row.declaredTotalCbm - computedCbm) / computedCbm;
      if (relDiff > 0.05) {
        issues.push({
          id: `cbm-mismatch-${p.id}`,
          code: "cbm_dimension_mismatch",
          severity: "warn",
          sku: p.sku,
          productId: p.id,
          messageZh: `SKU「${p.sku}」单据申报体积 ${row.declaredTotalCbm.toFixed(3)} m³ 与几何计算 ${computedCbm.toFixed(3)} m³ 偏差 ${(relDiff * 100).toFixed(1)}%（>5%）。`,
          messageEn: `SKU "${p.sku}" declared CBM (${row.declaredTotalCbm.toFixed(3)} m³) deviates ${(relDiff * 100).toFixed(1)}% from geometric CBM (${computedCbm.toFixed(3)} m³).`,
          suggestedFixZh: "核对外箱尺寸单位（mm/cm/in）或装箱数量是否录入有误。",
          suggestedFixEn: "Verify carton dimension units (mm/cm/in) and line quantity.",
        });
      }
    }

    // Check 7: Quantity exceeds single-container physical volumetric ceiling
    const unitVolM3 = (p.length * p.width * p.height) / 1e9;
    if (unitVolM3 > 0 && containerVolM3 > 0) {
      const physicalMaxByVol = Math.floor(containerVolM3 / unitVolM3);
      if (p.quantity > physicalMaxByVol && physicalMaxByVol > 0) {
        issues.push({
          id: `qty-limit-${p.id}`,
          code: "quantity_exceeds_physical_limit",
          severity: "warn",
          sku: p.sku,
          productId: p.id,
          messageZh: `SKU「${p.sku}」计划数量 ${p.quantity} 箱超过单柜绝对几何体积上限（约 ${physicalMaxByVol} 箱），必须分多柜装运。`,
          messageEn: `SKU "${p.sku}" quantity (${p.quantity}) exceeds single-container absolute volume ceiling (~${physicalMaxByVol} cartons); multi-container split required.`,
          suggestedFixZh: "切换至「多柜全局联合优化」自动拆分多柜组合。",
          suggestedFixEn: "Use Global Fleet Optimization to split across multiple containers.",
        });
      }
    }
  }

  const errorCount = issues.filter((i) => i.severity === "error").length;
  const warnCount = issues.filter((i) => i.severity === "warn").length;
  return {
    issues,
    errorCount,
    warnCount,
    healthy: issues.length === 0,
  };
}

export interface OrderAutoFixResult {
  fixedProducts: ProductInput[];
  fixCount: number;
  changesZh: string[];
  changesEn: string[];
}

/**
 * Deterministic safe auto-fixer for common order-entry anomalies (Direction 11):
 * - Swaps L/W when width > length * 1.05 on rotatable cartons
 * - Converts suspected cm-entered rows only when their original unit is explicitly confirmed.
 * - Leaves solid-model and shaped cargo for model-aware manual review.
 * Always returns an explicit human-reviewable changelog; never mutates silently.
 */
export function autoFixOrderInputs(products: readonly ProductInput[], confirmedCentimeterProductIds: readonly string[] = []): OrderAutoFixResult {
  const confirmedCm = new Set(confirmedCentimeterProductIds);
  const hasLargeMmItem = products.some((p) => Math.max(p.length, p.width, p.height) >= 500);
  const changesZh: string[] = [];
  const changesEn: string[] = [];
  const fixedProducts = products.map((p) => {
    let next = { ...p };
    const maxD = Math.max(next.length, next.width, next.height);
    const simpleBox = !next.solidModel && (!next.cargoShape || next.cargoShape === "box");
    if (simpleBox && confirmedCm.has(p.id) && hasLargeMmItem && maxD > 0 && maxD < 80) {
      next = {
        ...next,
        length: Math.round(next.length * 10),
        width: Math.round(next.width * 10),
        height: Math.round(next.height * 10),
      };
      changesZh.push(`${p.sku}：已逐行确认原始单位为 cm，按 ×10 转为 ${next.length}×${next.width}×${next.height} mm`);
      changesEn.push(`${p.sku}: converted confirmed cm input ×10 to ${next.length}×${next.width}×${next.height} mm`);
    }
    if (simpleBox && next.length > 0 && next.width > 0 && next.width > next.length * 1.05 && next.rotationPolicy !== "fixed") {
      const oldL = next.length;
      const oldW = next.width;
      next = { ...next, length: oldW, width: oldL };
      changesZh.push(`${p.sku}：已互换长宽顺序（${oldL}×${oldW} → ${next.length}×${next.width} mm）`);
      changesEn.push(`${p.sku}: swapped L/W order (${oldL}×${oldW} → ${next.length}×${next.width} mm)`);
    }
    return next;
  });
  return {
    fixedProducts,
    fixCount: changesZh.length,
    changesZh,
    changesEn,
  };
}
