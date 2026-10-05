import type { ContainerSpec } from "./types";
import { CONTAINER_PRESETS } from "./presets";

export const REFERENCE_SPEC_NOTE = "参考规格；请按设备铭牌、实测净空和现场门洞核对后使用。";
const spec = (id: string, name: string, category: ContainerSpec["category"], length: number, width: number, height: number, maxWeight: number, loadingAccess: ContainerSpec["loadingAccess"] = "rear", baseHeight?: number): ContainerSpec => ({ id, name, category, length, width, height, doorWidth: width, doorHeight: height, maxWeight, loadingAccess, baseHeight, specificationNote: REFERENCE_SPEC_NOTE });
export const TRANSPORT_PRESETS: ContainerSpec[] = [
  ...CONTAINER_PRESETS.map(v => ({ ...v, category: "container" as const })),
  spec("45hq", "45HQ 高柜", "container", 13510, 2350, 2690, 27500),
  spec("20rf", "20RF 冷藏柜", "container", 5460, 2290, 2270, 27000),
  spec("40rh", "40RH 冷藏高柜", "container", 11580, 2290, 2560, 29000),
  spec("45rh", "45RH 冷藏高柜", "container", 13280, 2440, 2580, 28000),
  spec("20ot", "20OT 开顶柜", "container", 5900, 2350, 4000, 28000, "open"),
  spec("40ot", "40OT 开顶柜", "container", 12030, 2350, 4000, 28000, "open"),
  spec("20fr", "20FR 框架柜", "container", 5720, 2210, 4000, 28000, "open"),
  spec("40fr", "40FR 框架柜", "container", 11890, 2370, 4000, 40000, "open"),
  spec("truck-van", "小型厢式货车", "truck", 2500, 1300, 1200, 1000),
  spec("truck-3", "3 米货车", "truck", 3000, 1500, 1500, 1500),
  spec("truck-4.2", "4.2 米货车", "truck", 4200, 2300, 2300, 5000),
  spec("truck-5.2", "5.2 米货车", "truck", 5200, 2300, 2300, 8000),
  spec("truck-6.8", "6.8 米货车", "truck", 6800, 2400, 2400, 10000),
  spec("truck-7.6", "7.6 米货车", "truck", 7600, 2400, 2500, 12000),
  spec("truck-9.6", "9.6 米货车", "truck", 9600, 2450, 2500, 18000),
  spec("truck-13", "13 米半挂车", "truck", 13000, 2500, 2500, 30000),
  spec("truck-17.5", "17.5 米平板车", "truck", 17500, 2500, 2500, 30000, "open"),
  ...([ ["eur1", "EUR 1", 1200, 800], ["eur2", "EUR 2", 1200, 1000], ["gma", "GMA", 1219, 1016], ["asia", "亚洲托盘", 1100, 1100], ["iso", "ISO 托盘", 1067, 1067], ["au", "澳洲托盘", 1165, 1165], ["square", "方形托盘", 1200, 1200], ["half", "半托盘", 800, 600] ] as const).map(([id, name, l, w]) => spec(`pallet-${id}`, name, "pallet", l, w, id === "half" ? 1200 : 1800, 1500, "open", 144)),
  ...([ ["pag", "PAG 88 × 125", 3175, 2235], ["pmc", "PMC 96 × 125", 3175, 2438], ["pla", "PLA 60.4 × 125", 3175, 1534], ["88-108", "ULD 88 × 108", 2743, 2235], ["60-96", "ULD 60.4 × 96", 2438, 1534], ["47-60", "ULD 47 × 60.4", 1534, 1194] ] as const).map(([id, name, l, w]) => spec(`pallet-${id}`, name, "pallet", l, w, 1600, 3000, "open", 25)),
];
