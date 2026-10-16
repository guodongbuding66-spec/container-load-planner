/** All dimensions are canonical mm and accessory weights are kg per carton. */
export type DimensionSize = { length: number; width: number; height: number };
export type DimensionAllowance = {
  source: string;
  batch: string;
  measuredAt: string;
  measured?: DimensionSize;
  increment: DimensionSize;
  incrementMode: "total" | "per-face";
  attachments: {
    sourceId: string;
    name: string;
    increment: DimensionSize;
    weightKg: number;
    dimensionsIncluded: boolean;
    weightIncluded: boolean;
  }[];
};
export const DIMENSION_AXES = ["length", "width", "height"] as const;
export const emptyDimensionAllowance = (): DimensionAllowance => ({ source: "", batch: "", measuredAt: "", increment: {length:0,width:0,height:0}, incrementMode:"total", attachments:[] });

export function parseDimensionAllowance(value: unknown): DimensionAllowance {
  const record = (v:unknown):Record<string,unknown> => { if(!v || typeof v!=="object" || Array.isArray(v))throw new Error("Invalid dimension allowance / 尺寸偏差格式无效");return v as Record<string,unknown>; };
  const text = (v:unknown,max=160) => { if(typeof v!=="string"||v.length>max)throw new Error("Invalid dimension source / 尺寸来源无效");return v.trim(); };
  const number = (v:unknown,min=0,max=100000) => { if(typeof v!=="number"||!Number.isFinite(v)||v<min||v>max)throw new Error("Invalid dimension or accessory weight / 尺寸或附件重量无效");return v; };
  const size = (v:unknown,min=0):DimensionSize => { const r=record(v);return {length:number(r.length,min),width:number(r.width,min),height:number(r.height,min)}; };
  const bool = (v:unknown) => {if(typeof v!=="boolean")throw new Error("Invalid inclusion flag / 已计入标记无效");return v;};
  const v=record(value);
  if(v.incrementMode!=="total"&&v.incrementMode!=="per-face")throw new Error("Invalid increment basis / 增量口径无效");
  const date=text(v.measuredAt,10);
  if(date&&(!/^\d{4}-\d{2}-\d{2}$/.test(date)||Number.isNaN(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date))throw new Error("Invalid measurement date / 实测日期无效");
  if(!Array.isArray(v.attachments)||v.attachments.length>12)throw new Error("At most 12 accessory sources / 最多 12 个附件来源");
  const seen=new Set<string>();
  const attachments=v.attachments.map(a=>{const r=record(a),sourceId=text(r.sourceId,80);if(!sourceId||seen.has(sourceId.toLowerCase()))throw new Error("Duplicate or empty accessory source / 附件来源重复或为空");seen.add(sourceId.toLowerCase());return {sourceId,name:text(r.name),increment:size(r.increment),weightKg:number(r.weightKg),dimensionsIncluded:bool(r.dimensionsIncluded),weightIncluded:bool(r.weightIncluded)};});
  return {source:text(v.source),batch:text(v.batch),measuredAt:date,...(v.measured===undefined?{}:{measured:size(v.measured,Number.MIN_VALUE)}),increment:size(v.increment),incrementMode:v.incrementMode,attachments};
}
