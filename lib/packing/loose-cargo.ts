import type { PackingResult, PlacedBox, ProductInput } from "./types";

export type LooseQuantities = Record<string, number>;
export function parseLooseQuantities(value: unknown): LooseQuantities | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw Error("Invalid loose reservations / 散装预留格式无效");
  const entries = Object.entries(value);
  if (entries.length > 10000 || entries.some(([id,n])=>!id.trim() || id.length>120 || ["__proto__","constructor","prototype"].includes(id) || !Number.isSafeInteger(n) || n<0 || n>1000000)) throw Error("Invalid loose reservation quantity / 散装预留箱数须为 0–1000000 的整数");
  const positive=entries.filter(([,n])=>n>0).sort(([a],[b])=>a.localeCompare(b));
  return positive.length?Object.fromEntries(positive):undefined;
}

/** Allocation is explicit and whole-kit, before either loading stage. */
export function looseReservationErrors(value: LooseQuantities | undefined, products: readonly ProductInput[], only=false) {
  const errors: string[]=[], byId=new Map(products.map(p=>[p.id,p]));
  if (!value) return errors;
  if (only) errors.push("Loose reservations require vehicle loading / 只打托不接受散装预留，请清除预留或切换先打托后装柜");
  for (const [id,n] of Object.entries(value)) if (!byId.has(id) || n>byId.get(id)!.quantity) errors.push("Loose reservations exceed the order or refer to a deleted SKU / 散装预留超过订单箱数或引用了已删除的 SKU");
  const kits=new Map<string,ProductInput[]>();
  for (const p of products) if (p.setCode?.trim()) {const key=p.setCode.trim();kits.set(key,[...kits.get(key)??[],p]);}
  for (const kit of kits.values()) {
    const counts=kit.map(p=>(value[p.id]??0)/(p.unitsPerSet??1));
    if (counts.some(n=>!Number.isSafeInteger(n)||n!==counts[0])) errors.push("Reserve every kit component in equal whole-set quantities / 套装各组成 SKU 必须预留相同的完整套数");
  }
  return errors;
}

/** Conservative reserved envelopes: no interpenetration or cross-mode support. */
export function looseOutsideUnit(loose: PlacedBox, unit: PlacedBox, gap=0) {
  const eps=.0001, x=Math.min(loose.x+loose.dx,unit.x+unit.dx)-Math.max(loose.x,unit.x),y=Math.min(loose.y+loose.dy,unit.y+unit.dy)-Math.max(loose.y,unit.y),z=Math.min(loose.z+loose.dz,unit.z+unit.dz)-Math.max(loose.z,unit.z);
  if (x>eps && y>eps && z>=-eps) return false;
  const xGap=Math.max(loose.x-unit.x-unit.dx,unit.x-loose.x-loose.dx),yGap=Math.max(loose.y-unit.y-unit.dy,unit.y-loose.y-loose.dy);
  return z<=eps || Math.max(xGap,yGap)>=gap-eps;
}

export function looseManifest(plan: PackingResult) {
  const allocation=plan.palletization?.looseQuantities;
  if (!allocation) return [];
  const counts=new Map<string,{loose:number;palletized:number;weightKg:number}>();
  for(const b of plan.placements){const entry=counts.get(b.productId)??{loose:0,palletized:0,weightKg:0};if(b.palletIds?.length)entry.palletized++;else{entry.loose++;entry.weightKg+=b.weight;}counts.set(b.productId,entry);}
  return plan.summaries.map(s=>({productId:s.productId,sku:s.sku,reserved:allocation[s.productId]??0,...counts.get(s.productId)??{loose:0,palletized:0,weightKg:0},unloaded:s.unloaded}));
}
