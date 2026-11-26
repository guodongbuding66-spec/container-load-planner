import type { ContainerSpec, ProductInput } from "./types";
import {getOrientations} from "./engine";

export interface OogItemAnalysis {
  sku: string;
  overHeightMm: number;
  overWidthMm: number;
  overLengthMm: number;
  isOog: boolean;
  recommendedEquipment: "Standard" | "40OT (Open Top)" | "40FR (Flat Rack)";
  estimatedLostSlots: number;
  recommendedLashingStraps: number;
  lashingNoteZh: string;
  lashingNoteEn: string;
}

export interface OogReport {
  hasOogCargo: boolean;
  maxOverHeightMm: number;
  maxOverWidthMm: number;
  maxOverLengthMm: number;
  totalEstimatedLostSlots: number;
  recommendedEquipment: "Standard" | "40OT (Open Top)" | "40FR (Flat Rack)";
  items: OogItemAnalysis[];
}

export function analyzeOogCargo(
  container: ContainerSpec,
  products: readonly ProductInput[],
): OogReport {
  const items: OogItemAnalysis[] = products
    .filter((p) => p.quantity > 0)
    .map((p) => {
      const orientations = getOrientations(p,false).map(o=>({overHeightMm:Math.max(0,o.dz-container.height),overWidthMm:Math.max(0,o.dy-container.width),overLengthMm:Math.max(0,o.dx-container.length)}));
      const rank = (o: typeof orientations[number]) => o.overWidthMm>0||o.overLengthMm>0?2:o.overHeightMm>0?1:0;
      const total = (o: typeof orientations[number]) => o.overHeightMm+o.overWidthMm+o.overLengthMm;
      const {overHeightMm,overWidthMm,overLengthMm}=orientations.sort((a,b)=>rank(a)-rank(b)||total(a)-total(b))[0];
      const isOog = overHeightMm > 0 || overWidthMm > 0 || overLengthMm > 0;

      let recommendedEquipment: OogItemAnalysis["recommendedEquipment"] = "Standard";
      if (overWidthMm > 0 || overLengthMm > 0) {
        recommendedEquipment = "40FR (Flat Rack)";
      } else if (overHeightMm > 0) {
        recommendedEquipment = "40OT (Open Top)";
      }

      // Standard maritime OOG lost-slot heuristic:
      // OH adds 1 slot above; OW adds 1 slot per protruding side (+1 above if OH); OL adds 1 slot.
      let lostSlots = 0;
      if (overHeightMm > 0) lostSlots += 1;
      if (overWidthMm > 0) lostSlots += overWidthMm > 300 ? 2 : 1;
      if (overLengthMm > 0) lostSlots += 1;

      // Securing: 1 lashing pair (2 straps, 5T LC each) per 2,500 kg, min 4 straps for OOG
      const totalItemWt = p.weight * p.quantity;
      const straps = isOog ? Math.max(4, Math.ceil(totalItemWt / 2500) * 2) : 0;

      const lashingNoteZh = isOog
        ? `建议至少使用 ${straps} 条 5T 棘轮绑带（拉绳仰角 30°–60°），底部加防滑胶垫并申请船东 OOG 审批。`
        : "尺寸包络可适配常规柜；仍需核对门洞、限重及搬运方式。";
      const lashingNoteEn = isOog
        ? `Use at least ${straps} × 5T lashing straps (30°–60° angle), anti-slip mats, and submit carrier OOG approval.`
        : "Fits the standard interior envelope; verify door, payload and handling separately.";

      return {
        sku: p.sku,
        overHeightMm,
        overWidthMm,
        overLengthMm,
        isOog,
        recommendedEquipment,
        estimatedLostSlots: lostSlots,
        recommendedLashingStraps: straps,
        lashingNoteZh,
        lashingNoteEn,
      };
    });

  const maxOverHeightMm = items.reduce((m, i) => Math.max(m, i.overHeightMm), 0);
  const maxOverWidthMm = items.reduce((m, i) => Math.max(m, i.overWidthMm), 0);
  const maxOverLengthMm = items.reduce((m, i) => Math.max(m, i.overLengthMm), 0);
  const totalEstimatedLostSlots = items.reduce((m, i) => Math.max(m, i.estimatedLostSlots), 0);
  const hasOogCargo = items.some((i) => i.isOog);
  const recommendedEquipment: OogReport["recommendedEquipment"] =
    maxOverWidthMm > 0 || maxOverLengthMm > 0
      ? "40FR (Flat Rack)"
      : maxOverHeightMm > 0
        ? "40OT (Open Top)"
        : "Standard";

  return {
    hasOogCargo,
    maxOverHeightMm,
    maxOverWidthMm,
    maxOverLengthMm,
    totalEstimatedLostSlots,
    recommendedEquipment,
    items,
  };
}
