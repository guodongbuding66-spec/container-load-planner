import type { ProductInput } from "./types";

/**
 * Direction 07: Smart Pallet & Wooden Crate Economic Design System.
 * Evaluates Block, Brick, Pinwheel, and Interlocking layer patterns across standard
 * pallet footprints (EUR1, EUR2, GMA, Asia, ISO), enforces overhang & static/dynamic/rack
 * load ratings, computes timber BOM & cost, and ranks the most economical pallet solution.
 */
export type PalletLayerPattern = "block" | "brick" | "pinwheel" | "interlocking";

export interface StandardPalletCandidate {
  id: string;
  nameZh: string;
  nameEn: string;
  lengthMm: number;
  widthMm: number;
  deckHeightMm: number;
  tareKg: number;
  staticRatingKg: number;
  dynamicRatingKg: number;
  rackRatingKg: number;
  unitCostUsd: number;
  timberVolumeM3: number;
}

export const STANDARD_PALLET_CATALOG: readonly StandardPalletCandidate[] = [
  { id: "eur1", nameZh: "欧标 EUR 1 (1200×800)", nameEn: "EUR 1 (1200×800)", lengthMm: 1200, widthMm: 800, deckHeightMm: 144, tareKg: 25, staticRatingKg: 4000, dynamicRatingKg: 1500, rackRatingKg: 1000, unitCostUsd: 16.5, timberVolumeM3: 0.042 },
  { id: "eur2", nameZh: "欧标 EUR 2 (1200×1000)", nameEn: "EUR 2 (1200×1000)", lengthMm: 1200, widthMm: 1000, deckHeightMm: 144, tareKg: 30, staticRatingKg: 4500, dynamicRatingKg: 1500, rackRatingKg: 1200, unitCostUsd: 19.0, timberVolumeM3: 0.051 },
  { id: "gma", nameZh: "北美 GMA (1219×1016)", nameEn: "North America GMA (1219×1016)", lengthMm: 1219, widthMm: 1016, deckHeightMm: 145, tareKg: 28, staticRatingKg: 4200, dynamicRatingKg: 1400, rackRatingKg: 1100, unitCostUsd: 18.0, timberVolumeM3: 0.049 },
  { id: "asia", nameZh: "亚洲标准 (1100×1100)", nameEn: "Asia Standard (1100×1100)", lengthMm: 1100, widthMm: 1100, deckHeightMm: 140, tareKg: 26, staticRatingKg: 4000, dynamicRatingKg: 1500, rackRatingKg: 1000, unitCostUsd: 17.0, timberVolumeM3: 0.046 },
  { id: "iso", nameZh: "ISO 方形 (1067×1067)", nameEn: "ISO Square (1067×1067)", lengthMm: 1067, widthMm: 1067, deckHeightMm: 140, tareKg: 25, staticRatingKg: 3800, dynamicRatingKg: 1350, rackRatingKg: 950, unitCostUsd: 16.0, timberVolumeM3: 0.044 },
];

export interface PalletLayerBox {
  x: number;
  y: number;
  dx: number;
  dy: number;
  rotated: boolean;
}

export interface SmartPalletDesignOption {
  pallet: StandardPalletCandidate;
  bestPattern: PalletLayerPattern;
  patternLabelZh: string;
  patternLabelEn: string;
  cartonsPerLayer: number;
  layerLayout: PalletLayerBox[];
  layers: number;
  cartonsPerPallet: number;
  totalPalletHeightMm: number;
  cargoWeightPerPalletKg: number;
  grossPalletWeightKg: number;
  areaUtilizationPct: number;
  overhangMm: number;
  dynamicRatingOk: boolean;
  rackRatingOk: boolean;
  palletsNeededForOrder: number;
  palletsPer40Hq: number;
  totalPalletCostUsd: number;
  totalTimberM3: number;
  costPerCartonUsd: number;
}

export interface SmartPalletDesignReport {
  sku: string;
  orderQuantity: number;
  maxPalletHeightMm: number;
  maxOverhangMm: number;
  recommended: SmartPalletDesignOption | null;
  options: SmartPalletDesignOption[];
}

function buildGridBoxes(
  offsetX: number,
  offsetY: number,
  cols: number,
  rows: number,
  dx: number,
  dy: number,
  rotated: boolean,
): PalletLayerBox[] {
  const out: PalletLayerBox[] = [];
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      out.push({ x: offsetX + c * dx, y: offsetY + r * dy, dx, dy, rotated });
    }
  }
  return out;
}

function evaluateLayerPatterns(
  boxL: number,
  boxW: number,
  palL: number,
  palW: number,
): { pattern: PalletLayerPattern; count: number; zh: string; en: string; layout: PalletLayerBox[] } {
  // 1. Block (all same orientation)
  const c0 = Math.floor(palL / boxL);
  const r0 = Math.floor(palW / boxW);
  const block0 = c0 * r0;
  const c90 = Math.floor(palL / boxW);
  const r90 = Math.floor(palW / boxL);
  const block90 = c90 * r90;
  let best: { pattern: PalletLayerPattern; count: number; zh: string; en: string; layout: PalletLayerBox[] } = {
    pattern: "block",
    count: Math.max(block0, block90),
    zh: "规则齐排 (Block)",
    en: "Block Pattern",
    layout:
      block90 > block0
        ? buildGridBoxes(0, 0, c90, r90, boxW, boxL, true)
        : buildGridBoxes(0, 0, c0, r0, boxL, boxW, false),
  };

  // 2. Brick / Interlocking (split length into k strips of boxL + remaining strips of boxW)
  let bestBrick = 0;
  let bestBrickLayout: PalletLayerBox[] = [];
  for (let nL = 1; nL * boxL <= palL; nL++) {
    const remL = palL - nL * boxL;
    const rowsA = Math.floor(palW / boxW);
    const colsB = Math.floor(remL / boxW);
    const rowsB = Math.floor(palW / boxL);
    const total = nL * rowsA + colsB * rowsB;
    if (total > bestBrick) {
      bestBrick = total;
      bestBrickLayout = [
        ...buildGridBoxes(0, 0, nL, rowsA, boxL, boxW, false),
        ...buildGridBoxes(nL * boxL, 0, colsB, rowsB, boxW, boxL, true),
      ];
    }
  }
  for (let nW = 1; nW * boxW <= palL; nW++) {
    const remL = palL - nW * boxW;
    const rowsA = Math.floor(palW / boxL);
    const colsB = Math.floor(remL / boxL);
    const rowsB = Math.floor(palW / boxW);
    const total = nW * rowsA + colsB * rowsB;
    if (total > bestBrick) {
      bestBrick = total;
      bestBrickLayout = [
        ...buildGridBoxes(0, 0, nW, rowsA, boxW, boxL, true),
        ...buildGridBoxes(nW * boxW, 0, colsB, rowsB, boxL, boxW, false),
      ];
    }
  }
  if (bestBrick > best.count) {
    best = { pattern: "brick", count: bestBrick, zh: "砖式交错 (Brick)", en: "Brick Interlock", layout: bestBrickLayout };
  }

  // 3. Pinwheel (4-quadrant windmill check when boxL + boxW <= min(palL, palW))
  const cellSpan = boxL + boxW;
  const pinwheelFits = cellSpan <= palL && cellSpan <= palW;
  if (pinwheelFits) {
    const gx = Math.max(1, Math.floor(palL / cellSpan));
    const gy = Math.max(1, Math.floor(palW / cellSpan));
    const pinCount = 4 * gx * gy;
    if (pinCount >= best.count && pinCount > 0) {
      const pinLayout: PalletLayerBox[] = [];
      for (let ix = 0; ix < gx; ix++) {
        for (let iy = 0; iy < gy; iy++) {
          const ox = ix * cellSpan;
          const oy = iy * cellSpan;
          pinLayout.push(
            { x: ox, y: oy, dx: boxL, dy: boxW, rotated: false },
            { x: ox + boxL, y: oy, dx: boxW, dy: boxL, rotated: true },
            { x: ox + boxW, y: oy + boxL, dx: boxL, dy: boxW, rotated: false },
            { x: ox, y: oy + boxW, dx: boxW, dy: boxL, rotated: true },
          );
        }
      }
      best = { pattern: "pinwheel", count: pinCount, zh: "风车型锁边 (Pinwheel)", en: "Pinwheel Lock", layout: pinLayout };
    }
  }

  // 4. Interlocking alternate-layer bonus label when symmetric square-ish footprint allows 90° layer rotation
  if (best.pattern === "block" && block0 > 0 && block0 === block90 && palL === palW) {
    best = { pattern: "interlocking", count: best.count, zh: "纵横交错码垛 (Interlocking)", en: "Interlocking Cross-Tie", layout: best.layout };
  }

  return best;
}

/**
 * Evaluates all standard pallet sizes & layer patterns to find the most economical pallet design.
 */
export function designEconomicalPallet(
  product: ProductInput,
  maxPalletHeightMm = 2200,
  maxOverhangMm = 0,
): SmartPalletDesignReport {
  const options: SmartPalletDesignOption[] = [];

  for (const pal of STANDARD_PALLET_CATALOG) {
    const effL = pal.lengthMm + maxOverhangMm * 2;
    const effW = pal.widthMm + maxOverhangMm * 2;
    const pat = evaluateLayerPatterns(product.length, product.width, effL, effW);
    if (pat.count <= 0) continue;

    const usableH = Math.max(0, maxPalletHeightMm - pal.deckHeightMm);
    const maxLayersByHeight = Math.floor(usableH / Math.max(1, product.height));
    const maxLayersByRule = product.maxStackLayers > 0 ? Math.min(maxLayersByHeight, product.maxStackLayers) : maxLayersByHeight;
    const maxLayersByWeight = Math.floor(pal.dynamicRatingKg / Math.max(0.01, pat.count * product.weight));
    const layers = Math.max(1, Math.min(maxLayersByRule, Math.max(1, maxLayersByWeight)));

    const cartonsPerPallet = pat.count * layers;
    const cargoWeightPerPalletKg = Number((cartonsPerPallet * product.weight).toFixed(1));
    const grossPalletWeightKg = Number((cargoWeightPerPalletKg + pal.tareKg).toFixed(1));
    const totalPalletHeightMm = pal.deckHeightMm + layers * product.height;
    const areaUtilPct = Number(
      Math.min(100, ((pat.count * product.length * product.width) / (pal.lengthMm * pal.widthMm)) * 100).toFixed(1),
    );

    const palletsNeededForOrder = Math.ceil(Math.max(1, product.quantity) / Math.max(1, cartonsPerPallet));
    // Floor fit inside 40HQ (12032 x 2352 mm)
    const p40Long = Math.floor(12032 / pal.lengthMm) * Math.floor(2352 / pal.widthMm);
    const p40Cross = Math.floor(12032 / pal.widthMm) * Math.floor(2352 / pal.lengthMm);
    const palletsPer40Hq = Math.max(1, p40Long, p40Cross);

    const totalPalletCostUsd = Number((palletsNeededForOrder * pal.unitCostUsd).toFixed(2));
    const totalTimberM3 = Number((palletsNeededForOrder * pal.timberVolumeM3).toFixed(3));
    const costPerCartonUsd = Number((pal.unitCostUsd / Math.max(1, cartonsPerPallet)).toFixed(3));

    options.push({
      pallet: pal,
      bestPattern: pat.pattern,
      patternLabelZh: pat.zh,
      patternLabelEn: pat.en,
      cartonsPerLayer: pat.count,
      layerLayout: pat.layout,
      layers,
      cartonsPerPallet,
      totalPalletHeightMm,
      cargoWeightPerPalletKg,
      grossPalletWeightKg,
      areaUtilizationPct: areaUtilPct,
      overhangMm: maxOverhangMm,
      dynamicRatingOk: cargoWeightPerPalletKg <= pal.dynamicRatingKg,
      rackRatingOk: cargoWeightPerPalletKg <= pal.rackRatingKg,
      palletsNeededForOrder,
      palletsPer40Hq,
      totalPalletCostUsd,
      totalTimberM3,
      costPerCartonUsd,
    });
  }

  options.sort((a, b) => a.totalPalletCostUsd - b.totalPalletCostUsd || b.areaUtilizationPct - a.areaUtilizationPct);

  return {
    sku: product.sku,
    orderQuantity: product.quantity,
    maxPalletHeightMm,
    maxOverhangMm,
    recommended: options[0] ?? null,
    options,
  };
}

/* ==================== Direction 07 Complete Extension: Wooden Crate Structural BOM (1–8 Part Breakdown) ==================== */

export interface WoodenCrateBomPart {
  itemNo: number;
  partNumber: string;
  nameZh: string;
  nameEn: string;
  materialSpec: string;
  dimsMm: string;
  qty: number;
  unitWeightKg: number;
  subtotalWeightKg: number;
}

export interface WoodenCrateBomReport {
  innerDimsMm: [number, number, number];
  outerDimsMm: [number, number, number];
  cargoWeightKg: number;
  crateTareKg: number;
  grossCrateWeightKg: number;
  totalTimberM3: number;
  estimatedCrateCostUsd: number;
  ispm15Required: boolean;
  parts: WoodenCrateBomPart[];
}

/**
 * Generates an 8-item engineering wooden crate structural BOM (matching CAD exploded crate drawings).
 */
export function designWoodenCrateBom(
  innerLengthMm: number,
  innerWidthMm: number,
  innerHeightMm: number,
  cargoWeightKg: number,
): WoodenCrateBomReport {
  const L = Math.max(200, Math.round(innerLengthMm));
  const W = Math.max(200, Math.round(innerWidthMm));
  const H = Math.max(200, Math.round(innerHeightMm));
  const heavy = cargoWeightKg >= 800;
  const panelT = heavy ? 18 : 12;
  const skidH = heavy ? 100 : 85;
  const skidW = heavy ? 90 : 75;
  const postS = heavy ? 70 : 50;

  const outL = L + panelT * 2 + postS * 2;
  const outW = W + panelT * 2 + postS * 2;
  const outH = H + panelT * 2 + skidH;

  const skidCount = W >= 1100 ? 3 : 2;
  const crossBeamCount = Math.max(3, Math.ceil(L / 450));
  const pineDensityKgM3 = 520;
  const plyDensityKgM3 = 600;

  const makePart = (
    itemNo: number,
    partNumber: string,
    nameZh: string,
    nameEn: string,
    materialSpec: string,
    l: number,
    w: number,
    h: number,
    qty: number,
    density: number,
  ): WoodenCrateBomPart => {
    const volM3 = (l * w * h) / 1e9;
    const unitWeightKg = Number((volM3 * density).toFixed(2));
    return {
      itemNo,
      partNumber,
      nameZh,
      nameEn,
      materialSpec,
      dimsMm: `${Math.round(l)}×${Math.round(w)}×${Math.round(h)}`,
      qty,
      unitWeightKg,
      subtotalWeightKg: Number((unitWeightKg * qty).toFixed(2)),
    };
  };

  const parts: WoodenCrateBomPart[] = [
    makePart(1, "CRT-BASE-SKID", "底座纵梁滑木", "Base Runner Skids", "ISPM-15 松木实木", outL, skidW, skidH, skidCount, pineDensityKgM3),
    makePart(2, "CRT-BASE-DECK", "底板铺板", "Base Floor Deck", `${panelT}mm 胶合板`, outL, outW, panelT, 1, plyDensityKgM3),
    makePart(3, "CRT-CORNER-POST", "四角承重立柱", "Corner Vertical Posts", "ISPM-15 松木方", postS, postS, H, 4, pineDensityKgM3),
    makePart(4, "CRT-SIDE-PANEL", "左右侧板", "Side Sheathing Panels", `${panelT}mm 胶合板`, outL, panelT, H, 2, plyDensityKgM3),
    makePart(5, "CRT-END-PANEL", "两端封板", "End Sheathing Panels", `${panelT}mm 胶合板`, panelT, outW, H, 2, plyDensityKgM3),
    makePart(6, "CRT-CROSS-BEAM", "顶/侧加强横梁", "Top & Side Cross Beams", "ISPM-15 松木条", outW, postS, postS * 0.6, crossBeamCount, pineDensityKgM3),
    makePart(7, "CRT-TOP-LID", "顶盖面板", "Top Cover Panel", `${panelT}mm 胶合板`, outL, outW, panelT, 1, plyDensityKgM3),
    {
      itemNo: 8,
      partNumber: "CRT-FASTENER-KIT",
      nameZh: "包角铁片、螺栓与钢带组件",
      nameEn: "Corner Brackets, Bolts & Steel Strapping",
      materialSpec: "镀锌钢件 + PET/钢带",
      dimsMm: "标准紧固套装",
      qty: 1,
      unitWeightKg: heavy ? 4.8 : 2.4,
      subtotalWeightKg: heavy ? 4.8 : 2.4,
    },
  ];

  const crateTareKg = Number(parts.reduce((s, p) => s + p.subtotalWeightKg, 0).toFixed(1));
  const totalTimberM3 = Number(
    parts
      .slice(0, 7)
      .reduce((s, p) => s + p.subtotalWeightKg / 560, 0)
      .toFixed(3),
  );
  const estimatedCrateCostUsd = Number((totalTimberM3 * 360 + (heavy ? 24 : 14)).toFixed(2));

  return {
    innerDimsMm: [L, W, H],
    outerDimsMm: [outL, outW, outH],
    cargoWeightKg: Number(cargoWeightKg.toFixed(1)),
    crateTareKg,
    grossCrateWeightKg: Number((cargoWeightKg + crateTareKg).toFixed(1)),
    totalTimberM3,
    estimatedCrateCostUsd,
    ispm15Required: true,
    parts,
  };
}
