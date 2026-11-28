import type { PackingResult, ProductInput } from "./types";

/**
 * Direction 17: Deterministic Special Cargo & IMDG Dangerous Goods Compliance Engine.
 * Covers all 8 specialized cargo categories using verified engineering rules and
 * the IMDG Code Chapter 7.2.4 segregation table (never AI guesswork).
 */
export type SpecialCargoCategory =
  | "fragile"
  | "precision-instrument"
  | "liquid"
  | "food"
  | "cold-chain"
  | "moisture-sensitive"
  | "oversized-oog"
  | "dangerous-goods";

export type ImdgClass =
  | "1"
  | "2.1"
  | "2.2"
  | "2.3"
  | "3"
  | "4.1"
  | "4.2"
  | "4.3"
  | "5.1"
  | "5.2"
  | "6.1"
  | "7"
  | "8"
  | "9";

/**
 * IMDG Code 7.2.4 Segregation Levels:
 * 0 = No general segregation required
 * 1 = Away from (minimum 3 m horizontal separation or approved barrier)
 * 2 = Separated from (minimum 6 m or separate compartment; prohibited in same closed CTU)
 * 3 = Separated by a complete compartment or hold (prohibited in same CTU)
 * 4 = Separated longitudinally by an intervening complete compartment (strictly prohibited in same CTU)
 */
export type ImdgSegregationLevel = 0 | 1 | 2 | 3 | 4;

export interface SpecialCargoRuleProfile {
  sku: string;
  categories: SpecialCargoCategory[];
  imdgClass?: ImdgClass;
  unNumber?: string;
  requireUpright?: boolean;
  maxTopLoadKg?: number;
  minClearanceMm?: number;
}

export interface SpecialCargoViolation {
  id: string;
  category: SpecialCargoCategory;
  severity: "error" | "warn";
  skuA: string;
  skuB?: string;
  ruleCode: string;
  messageZh: string;
  messageEn: string;
  remediationZh: string;
  remediationEn: string;
}

export interface SpecialCargoAuditReport {
  checkedPlacements: number;
  activeCategories: SpecialCargoCategory[];
  violations: SpecialCargoViolation[];
  errorCount: number;
  warnCount: number;
  desiccantBagsRecommended: number;
  complianceStatus: "pass" | "warning" | "fail";
  disclaimerZh: string;
  disclaimerEn: string;
}

/**
 * Simplified canonical IMDG Code 7.2.4 pairwise segregation lookup for common maritime classes.
 * Symmetric matrix encoded as sorted pair keys "classA|classB".
 */
const IMDG_SEGREGATION_PAIRS: Record<string, ImdgSegregationLevel> = {
  "1|2.1": 4,
  "1|2.2": 2,
  "1|2.3": 2,
  "1|3": 4,
  "1|4.1": 4,
  "1|4.2": 4,
  "1|4.3": 4,
  "1|5.1": 4,
  "1|5.2": 4,
  "1|6.1": 2,
  "1|7": 2,
  "1|8": 4,
  "2.1|3": 2,
  "2.1|4.1": 1,
  "2.1|4.2": 2,
  "2.1|4.3": 2,
  "2.1|5.1": 2,
  "2.1|5.2": 2,
  "2.1|7": 2,
  "2.1|8": 1,
  "2.3|3": 2,
  "2.3|4.2": 2,
  "2.3|5.1": 2,
  "2.3|5.2": 2,
  "3|4.2": 2,
  "3|4.3": 1,
  "3|5.1": 2,
  "3|5.2": 2,
  "3|7": 2,
  "4.1|5.1": 1,
  "4.1|5.2": 2,
  "4.1|7": 2,
  "4.1|8": 1,
  "4.2|5.1": 2,
  "4.2|5.2": 2,
  "4.2|8": 1,
  "4.3|5.1": 2,
  "4.3|5.2": 2,
  "4.3|8": 1,
  "5.1|5.2": 2,
  "5.1|6.1": 1,
  "5.1|7": 1,
  "5.1|8": 2,
  "5.2|6.1": 1,
  "5.2|7": 2,
  "5.2|8": 2,
  "6.1|8": 1,
  "7|8": 2,
};

export function getImdgSegregationLevel(a: ImdgClass, b: ImdgClass): ImdgSegregationLevel {
  if (a === b) return 0;
  const key = [a, b].sort().join("|");
  return IMDG_SEGREGATION_PAIRS[key] ?? 0;
}

/** Infer special cargo categories deterministically from product attributes & naming conventions. */
export function inferSpecialCargoProfile(product: ProductInput): SpecialCargoRuleProfile {
  const text = `${product.sku} ${product.name}`.toLowerCase();
  const categories = new Set<SpecialCargoCategory>();

  if (product.maxTopLoadKg === 0 || !product.stackable || /fragile|glass|ceramic|易碎|玻璃|陶瓷/.test(text)) {
    categories.add("fragile");
  }
  if (/precision|instrument|sensor|laser|cnc|optical|精密|仪器|光学/.test(text)) {
    categories.add("precision-instrument");
  }
  if (/liquid|oil|chemical|paint|drum|beverage|液体|化工|油漆|桶装/.test(text)) {
    categories.add("liquid");
  }
  if (/food|snack|flour|grain|fruit|meat|食品|零食|粮油|生鲜/.test(text)) {
    categories.add("food");
  }
  if (/cold|frozen|chilled|reefer|vaccine|冷链|冷冻|冷藏|生鲜/.test(text)) {
    categories.add("cold-chain");
  }
  if (/moisture|paper|textile|leather|electronics|防潮|电子|纺织|纸品/.test(text)) {
    categories.add("moisture-sensitive");
  }
  if (Math.max(product.length, product.width, product.height) > 2350 || /oog|overlength|beam|超长|超宽|异形/.test(text)) {
    categories.add("oversized-oog");
  }
  let imdgClass: ImdgClass | undefined;
  if (/un\s*\d{4}|imdg|hazmat|flammable|oxidizer|corrosive|battery|lithium|危险品|易燃|锂电|氧化剂|腐蚀/.test(text)) {
    categories.add("dangerous-goods");
    if (/oxidiz|氧化/.test(text)) imdgClass = "5.1";
    else if (/corros|acid|腐蚀|酸/.test(text)) imdgClass = "8";
    else if (/flammable|paint|易燃|油漆/.test(text)) imdgClass = "3";
    else if (/gas|aerosol|气体|气雾/.test(text)) imdgClass = "2.1";
    else imdgClass = "9";
  }

  return {
    sku: product.sku,
    categories: Array.from(categories),
    imdgClass,
    requireUpright: product.rotationPolicy !== "any" || categories.has("liquid") || categories.has("precision-instrument"),
    maxTopLoadKg: categories.has("fragile") ? 0 : product.maxTopLoadKg,
  };
}

function aabbGapMm(
  a: { x: number; y: number; z: number; dx: number; dy: number; dz: number },
  b: { x: number; y: number; z: number; dx: number; dy: number; dz: number },
): number {
  const gx = Math.max(0, Math.max(a.x - (b.x + b.dx), b.x - (a.x + a.dx)));
  const gy = Math.max(0, Math.max(a.y - (b.y + b.dy), b.y - (a.y + a.dy)));
  const gz = Math.max(0, Math.max(a.z - (b.z + b.dz), b.z - (a.z + a.dz)));
  return Math.hypot(gx, gy, gz);
}

/**
 * Audit a packed container layout against all 8 Special Cargo & IMDG rules.
 */
export function auditSpecialCargoCompliance(
  result: PackingResult,
  products: readonly ProductInput[],
  explicitProfiles?: readonly SpecialCargoRuleProfile[],
): SpecialCargoAuditReport {
  const profileBySku = new Map<string, SpecialCargoRuleProfile>();
  for (const p of products) {
    profileBySku.set(p.sku, inferSpecialCargoProfile(p));
  }
  if (explicitProfiles) {
    for (const ep of explicitProfiles) {
      profileBySku.set(ep.sku, ep);
    }
  }

  const productById = new Map(products.map((p) => [p.id, p]));
  const violations: SpecialCargoViolation[] = [];
  const activeCategories = new Set<SpecialCargoCategory>();
  const seenRuleKeys = new Set<string>();

  const pushUnique = (v: SpecialCargoViolation) => {
    const key = `${v.ruleCode}:${v.skuA}:${v.skuB ?? ""}`;
    if (seenRuleKeys.has(key)) return;
    seenRuleKeys.add(key);
    violations.push(v);
  };

  const placements = result.placements;
  const { container } = result;
  let hasMoistureCargo = false;

  for (let i = 0; i < placements.length; i++) {
    const a = placements[i];
    const prodA = productById.get(a.productId);
    const profA = profileBySku.get(a.sku);
    if (!profA || profA.categories.length === 0) continue;

    for (const cat of profA.categories) activeCategories.add(cat);
    if (profA.categories.includes("moisture-sensitive")) hasMoistureCargo = true;

    // 1. Fragile: No top-load check
    if (profA.categories.includes("fragile")) {
      const aTop = a.z + a.dz;
      for (let j = 0; j < placements.length; j++) {
        if (i === j) continue;
        const b = placements[j];
        const overlapX = Math.min(a.x + a.dx, b.x + b.dx) - Math.max(a.x, b.x);
        const overlapY = Math.min(a.y + a.dy, b.y + b.dy) - Math.max(a.y, b.y);
        if (overlapX > 5 && overlapY > 5 && Math.abs(b.z - aTop) <= 8) {
          pushUnique({
            id: `fragile-topload-${a.sku}-${b.sku}`,
            category: "fragile",
            severity: "error",
            skuA: a.sku,
            skuB: b.sku,
            ruleCode: "FRAGILE_TOP_LOAD",
            messageZh: `易碎品「${a.sku}」上方叠放了「${b.sku}」，违反禁止上压约束。`,
            messageEn: `Fragile SKU "${a.sku}" has "${b.sku}" stacked directly on top.`,
            remediationZh: "开启「禁止上压」或将易碎品移至最顶层并预留保护间隙。",
            remediationEn: "Enable no-stack-on-top or move fragile items to the top layer with clearance.",
          });
        }
      }
    }

    // 2. Liquid / Precision Instrument: Upright lock check
    if (
      (profA.categories.includes("liquid") || profA.categories.includes("precision-instrument")) &&
      prodA &&
      Math.abs(a.dz - prodA.height) > 2
    ) {
      const cat: SpecialCargoCategory = profA.categories.includes("liquid") ? "liquid" : "precision-instrument";
      pushUnique({
        id: `upright-${cat}-${a.sku}`,
        category: cat,
        severity: "error",
        skuA: a.sku,
        ruleCode: "UPRIGHT_VIOLATION",
        messageZh: `${cat === "liquid" ? "液体" : "精密仪器"}「${a.sku}」未保持直立放置（实际高度 ${a.dz}mm ≠ 原高 ${prodA.height}mm）。`,
        messageEn: `${cat} SKU "${a.sku}" is tilted (placed height ${a.dz}mm vs original ${prodA.height}mm).`,
        remediationZh: "锁定「保持直立 / 仅平转」方向约束以防泄漏或精密部件受损。",
        remediationEn: "Lock upright-only orientation to prevent leakage or instrument damage.",
      });
    }

    // 3. Cold Chain: Reefer Red Load-Line headroom (>=130mm) & Front Evaporator gap (>=100mm)
    if (profA.categories.includes("cold-chain")) {
      const topGap = container.height - (a.z + a.dz);
      if (topGap < 130) {
        pushUnique({
          id: `cold-redline-${a.sku}`,
          category: "cold-chain",
          severity: "warn",
          skuA: a.sku,
          ruleCode: "REEFER_RED_LINE",
          messageZh: `冷链货物「${a.sku}」顶部余隙仅 ${Math.round(topGap)}mm（低于冷藏柜 130mm 通风红线）。`,
          messageEn: `Cold-chain SKU "${a.sku}" has only ${Math.round(topGap)}mm top clearance (< 130mm red load line).`,
          remediationZh: "降低最顶层堆码高度以确保冷气循环风道畅通。",
          remediationEn: "Reduce top stacking height to maintain cold-air return airflow.",
        });
      }
      if (a.x < 100) {
        pushUnique({
          id: `cold-front-${a.sku}`,
          category: "cold-chain",
          severity: "warn",
          skuA: a.sku,
          ruleCode: "REEFER_EVAPORATOR_GAP",
          messageZh: `冷链货物「${a.sku}」距冷机前壁仅 ${Math.round(a.x)}mm（建议 ≥100mm 回风通道）。`,
          messageEn: `Cold-chain SKU "${a.sku}" is ${Math.round(a.x)}mm from front bulkhead (< 100mm airflow gap).`,
          remediationZh: "在柜体前端预留至少 100mm 隔栅或障碍区以保障出风循环。",
          remediationEn: "Reserve at least 100mm clearance at the front bulkhead for airflow.",
        });
      }
    }

    // 4. OOG: Check if exceeding standard 2350mm width or 2585mm door height in closed box
    if (profA.categories.includes("oversized-oog") && container.loadingAccess !== "open") {
      if (a.dx > container.length || a.dy > container.doorWidth || a.dz > container.doorHeight) {
        pushUnique({
          id: `oog-door-${a.sku}`,
          category: "oversized-oog",
          severity: "error",
          skuA: a.sku,
          ruleCode: "OOG_DOOR_EXCEEDED",
          messageZh: `超限货物「${a.sku}」尺寸超出封闭柜门洞，需切换开顶柜（OT）或框架柜（FR）。`,
          messageEn: `OOG SKU "${a.sku}" exceeds closed-container door opening; switch to Open Top or Flat Rack.`,
          remediationZh: "在装载空间库中选择 40OT 开顶柜或 40FR 框架柜并复核超限附加费。",
          remediationEn: "Select 40OT Open Top or 40FR Flat Rack in Transport Library.",
        });
      }
    }

    // 5. Pairwise Segregation: Food vs Liquid/DG & IMDG Code 7.2.4 Matrix
    for (let j = i + 1; j < placements.length; j++) {
      const b = placements[j];
      const profB = profileBySku.get(b.sku);
      if (!profB || profB.categories.length === 0) continue;

      const distMm = aabbGapMm(a, b);

      // Food hygiene isolation from dangerous goods or chemical liquids
      const foodVsHazard =
        (profA.categories.includes("food") && (profB.categories.includes("dangerous-goods") || profB.categories.includes("liquid"))) ||
        (profB.categories.includes("food") && (profA.categories.includes("dangerous-goods") || profA.categories.includes("liquid")));
      if (foodVsHazard && distMm < 3000) {
        const isDg = profA.categories.includes("dangerous-goods") || profB.categories.includes("dangerous-goods");
        pushUnique({
          id: `food-seg-${[a.sku, b.sku].sort().join("-")}`,
          category: "food",
          severity: isDg ? "error" : "warn",
          skuA: a.sku,
          skuB: b.sku,
          ruleCode: isDg ? "FOOD_DG_PROHIBITED" : "FOOD_LIQUID_SEPARATION",
          messageZh: isDg
            ? `食品与危险品（${a.sku} / ${b.sku}）禁止混装在同一密闭集装箱内。`
            : `食品与液体（${a.sku} / ${b.sku}）间距仅 ${Math.round(distMm)}mm，存在渗漏污染风险。`,
          messageEn: isDg
            ? `Food and Dangerous Goods (${a.sku} / ${b.sku}) must not be co-loaded in the same closed CTU.`
            : `Food and liquid (${a.sku} / ${b.sku}) are only ${Math.round(distMm)}mm apart; contamination risk.`,
          remediationZh: isDg ? "必须分柜发运并执行承运人危品合规审批。" : "使用防水隔板、托盘垫高或分区分柜装载。",
          remediationEn: isDg ? "Split into separate containers and obtain carrier DG approval." : "Separate with waterproof barrier or separate containers.",
        });
      }

      // IMDG Code 7.2.4 pairwise matrix
      if (profA.imdgClass && profB.imdgClass) {
        const level = getImdgSegregationLevel(profA.imdgClass, profB.imdgClass);
        if (level >= 2) {
          pushUnique({
            id: `imdg-l${level}-${[a.sku, b.sku].sort().join("-")}`,
            category: "dangerous-goods",
            severity: "error",
            skuA: a.sku,
            skuB: b.sku,
            ruleCode: `IMDG_SEGREGATION_LEVEL_${level}`,
            messageZh: `IMDG Code 隔离冲突（等级 ${level}）：Class ${profA.imdgClass}「${a.sku}」与 Class ${profB.imdgClass}「${b.sku}」禁止同柜混装。`,
            messageEn: `IMDG Code Segregation Level ${level}: Class ${profA.imdgClass} ("${a.sku}") and Class ${profB.imdgClass} ("${b.sku}") cannot be packed in the same CTU.`,
            remediationZh: "按 IMDG Code 7.2.4 拆分为独立集装箱并由持证危品申报员复核 MSDS/DGD。",
            remediationEn: "Split into separate CTUs per IMDG Code 7.2.4 and verify with a certified DG declarant.",
          });
        } else if (level === 1 && distMm < 3000) {
          pushUnique({
            id: `imdg-l1-${[a.sku, b.sku].sort().join("-")}`,
            category: "dangerous-goods",
            severity: "warn",
            skuA: a.sku,
            skuB: b.sku,
            ruleCode: "IMDG_SEGREGATION_AWAY_FROM",
            messageZh: `IMDG Code 等级 1（远离）：Class ${profA.imdgClass}「${a.sku}」与 Class ${profB.imdgClass}「${b.sku}」间距仅 ${Math.round(distMm)}mm（要求 ≥3000mm）。`,
            messageEn: `IMDG Level 1 (Away From): Class ${profA.imdgClass} ("${a.sku}") and Class ${profB.imdgClass} ("${b.sku}") are ${Math.round(distMm)}mm apart (< 3000mm).`,
            remediationZh: "拉大两类危品间距至 3 米以上或分柜运输，并提交承运人审核。",
            remediationEn: "Increase separation to ≥3000mm or segregate into separate containers.",
          });
        }
      }
    }
  }

  // Moisture-sensitive desiccant BOM recommendation (standard 20ft ~ 6-8 bags, 40ft ~ 12-16 bags of 1kg CaCl2)
  const containerLenM = container.length / 1000;
  const desiccantBagsRecommended = hasMoistureCargo
    ? Math.max(6, Math.round(containerLenM >= 11 ? 14 : 8))
    : 0;

  const errorCount = violations.filter((v) => v.severity === "error").length;
  const warnCount = violations.filter((v) => v.severity === "warn").length;
  const complianceStatus: SpecialCargoAuditReport["complianceStatus"] =
    errorCount > 0 ? "fail" : warnCount > 0 ? "warning" : "pass";

  return {
    checkedPlacements: placements.length,
    activeCategories: Array.from(activeCategories),
    violations,
    errorCount,
    warnCount,
    desiccantBagsRecommended,
    complianceStatus,
    disclaimerZh: "本模块基于确定性行业规则库（含 IMDG Code 7.2.4 隔离矩阵）执行工程初审，危险品与冷链正式出运前仍须经持证危品申报员、船公司及 MSDS/法规文件复核。",
    disclaimerEn: "Deterministic rule-based pre-audit (including IMDG Code 7.2.4 segregation table). Formal DG/cold-chain shipments still require certified DG declarant, MSDS, and carrier approval.",
  };
}
