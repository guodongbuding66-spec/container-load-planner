import type { PackingResult, ProductInput } from "./types";
import type { PreparedPalletLayout } from "./prepared-pallet-layout";
import { MAX_CSV_ROWS } from "./csv";
import { canonicalQualityInput } from "./quality-history";
import { parseProductInput } from "./workspace-file";
export type PackagingRecord={id:string;name:string;revision:string;effectiveDate:string;notes:string;products:ProductInput[];createdAt:string};
export type FieldRecord={id:string;name:string;split:"calibration"|"acceptance";packagingSignature:string;settingsSignature?:string;container:PackingResult["container"];predicted:number;actual:number;minutes:number;reason:string;photos:string[];createdAt:string};
export function packagingSignature(products:ProductInput[]){return JSON.stringify(products.map(p=>[p.sku,p.length,p.width,p.height,p.weight,p.setCode??"",p.unitsPerSet??1,p.packaging?.revision??""]).sort((a,b)=>String(a[0]).localeCompare(String(b[0]))));}

export const MAX_CATALOG_BYTES = 50 * 1024 * 1024;

function vehicleConditions(container: PackingResult["container"]) {
  const { length, width, height, doorWidth, doorHeight, maxWeight, category, loadingAccess, baseHeight, exclusions, engineering } = container;
  return { length, width, height, doorWidth, doorHeight, maxWeight, category, loadingAccess, baseHeight, exclusions, engineering };
}

/** A compact, versioned key for the conditions behind the recorded forecast. */
export async function fieldCalibrationSignature(plan: PackingResult, products: ProductInput[], preparedLayout?: PreparedPalletLayout) {
  const palletization = plan.palletization;
  const fallbackBuild = palletization && {
    config: palletization.config, mix: palletization.mix, stackLayers: palletization.stackLayers,
    maxTopLoadKg: palletization.maxTopLoadKg, specifications: palletization.specifications,
    looseQuantities: palletization.looseQuantities, selection: palletization.selection,
  };
  const measuredUnits = plan.pallets?.filter(p => p.measuredEnvelope).map(p => [p.specificationId, p.measuredEnvelope]);
  const editedLayout = palletization?.editRevision || (palletization?.manualPreparation && !preparedLayout) ? {
    cartons: plan.placements.map(p => [p.productId, p.x, p.y, p.z, p.orientation, p.orientationSigns, p.palletIds]),
    bases: plan.pallets?.map(p => [p.id, p.x, p.y, p.z, p.dx, p.dy, p.dz, p.specificationId]),
  } : undefined;
  const conditions = {
    engineVersion: plan.engineVersion,
    workflow: plan.workflow ?? (palletization ? palletization.only ? "pallet-only" : "palletized" : plan.mode === "single" ? "single-capacity" : "direct"),
    mode: plan.mode, strategy: plan.strategy, clearance: plan.clearance,
    practicalTarget: plan.practicalTargetUtilization, singleCartonLimit: plan.singleCartonLimit,
    container: vehicleConditions(plan.container), loadingRules: plan.loadingRules,
    floorPallets: plan.floorPallets, palletBuild: plan.palletBuild ?? fallbackBuild,
    preparedLayout: palletization?.manualPreparation ? preparedLayout : undefined,
    manualPreparation: palletization?.manualPreparation, editedLayout, measuredUnits,
    delivery: plan.delivery, access: plan.accessConfig, dimensionScenario: plan.dimensionScenario?.kind,
    products: products.map(p => ({
      ...p, name: undefined, color: undefined, shippingMark: undefined, source: undefined,
      orderLine: p.orderLine?.stop, packaging: p.packaging?.revision,
    })),
  };
  const json = canonicalQualityInput(JSON.parse(JSON.stringify(conditions)));
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(json));
  return `v2:${Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("")}`;
}

function calibrationKey(record: FieldRecord) {
  if (!record.settingsSignature || !/^v2:[0-9a-f]{64}$/.test(record.settingsSignature)) return null;
  const {length, width, height, doorWidth, doorHeight, maxWeight} = record.container;
  return JSON.stringify([record.settingsSignature, record.packagingSignature, length, width, height, doorWidth, doorHeight, maxWeight]);
}
export async function catalogStore<T>(bucket:"packaging"|"records",value?:T):Promise<T[]>{
  const db=await new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open("cargo-fit-catalog",1);r.onupgradeneeded=()=>{r.result.createObjectStore("packaging",{keyPath:"id"});r.result.createObjectStore("records",{keyPath:"id"});};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
  try{return await new Promise<T[]>((resolve,reject)=>{const tx=db.transaction(bucket,value?"readwrite":"readonly"),s=tx.objectStore(bucket);if(value)s.put(value);const r=s.getAll();tx.oncomplete=()=>resolve(r.result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});}finally{db.close();}
}
export function calibrationReport(records:FieldRecord[]){
  const keyed = records.map(record => ({record, key: calibrationKey(record)}));
  const groups = new Map<string, { count: number; ratio: number }>();
  let trainingCount = 0;
  for (const {record, key} of keyed) {
    if (!key || record.split !== "calibration" || record.predicted <= 0) continue;
    const group = groups.get(key) ?? {count: 0, ratio: 0};
    group.count++;
    group.ratio += record.actual / record.predicted;
    groups.set(key, group);
    trainingCount++;
  }
  const evaluate = keyed.filter(({record}) => record.split === "acceptance" && record.actual > 0).map(({record, key}) => {
    const group = key ? groups.get(key) : undefined;
    const predicted = group ? Math.floor(record.predicted * (group.ratio / group.count)) : record.predicted;
    return {
      id: record.id, name: record.name, predicted, actual: record.actual,
      errorPct: Math.abs(predicted - record.actual) / record.actual * 100,
      trainingCount: group?.count ?? 0, legacy: key === null,
    };
  });
  const comparable = evaluate.filter(record => !record.legacy);
  return {
    trainingCount, acceptanceCount: evaluate.length, legacyCount: keyed.filter(row => row.key === null).length,
    evaluate, meanErrorPct: comparable.length ? comparable.reduce((sum, record) => sum + record.errorPct, 0) / comparable.length : null,
  };
}

export function parseCatalog(text:string):{entries:PackagingRecord[];records:FieldRecord[]}{
  if (text.length > MAX_CATALOG_BYTES || new TextEncoder().encode(text).byteLength > MAX_CATALOG_BYTES) throw Error("档案文件超过 50 MB / Catalog archive exceeds 50 MB");
  const raw=JSON.parse(text);if(raw?.format!=="cargo-fit-catalog"||raw.version!==1||!Array.isArray(raw.entries)||!Array.isArray(raw.records)||raw.entries.length>500||raw.records.length>500)throw Error("档案格式无效");
  const str=(s:unknown,max=2000)=>{if(typeof s!=="string"||s.length>max)throw Error("档案文字无效");return s;};
  const num=(n:unknown)=>{if(typeof n!=="number"||!Number.isFinite(n)||n<0)throw Error("档案数字无效");return n;};
  const entries:PackagingRecord[]=raw.entries.map((e:PackagingRecord)=>{if(!Array.isArray(e.products)||!e.products.length||e.products.length>MAX_CSV_ROWS)throw Error("包装箱规无效");const products=e.products.map(parseProductInput);if(products.some(p=>Math.min(p.length,p.width,p.height)<=0)||new Set(products.map(p=>p.id)).size!==products.length)throw Error("包装尺寸或标识无效");return {id:crypto.randomUUID(),name:str(e.name,100),revision:str(e.revision,100),effectiveDate:str(e.effectiveDate,10),notes:str(e.notes),createdAt:str(e.createdAt,40),products};});
  const records:FieldRecord[]=raw.records.map((r:FieldRecord)=>{if(!["calibration","acceptance"].includes(r.split)||!Array.isArray(r.photos)||r.photos.length>4||r.photos.some(p=>typeof p!=="string"||p.length>1500000||!/^data:image\/(png|jpeg|webp);base64,[A-Za-z\d+/=]+$/.test(p)))throw Error("实装记录或照片无效");for(const k of ["length","width","height","doorWidth","doorHeight","maxWeight"] as const)num(r.container?.[k]);const actual=num(r.actual);if(actual<=0||!Number.isInteger(actual))throw Error("实装数量无效");return {...r,id:crypto.randomUUID(),name:str(r.name,100),packagingSignature:str(r.packagingSignature,MAX_CATALOG_BYTES),settingsSignature:r.settingsSignature===undefined?undefined:str(r.settingsSignature,MAX_CATALOG_BYTES),reason:str(r.reason),createdAt:str(r.createdAt,40),actual,predicted:num(r.predicted),minutes:num(r.minutes)};});return {entries,records};
}
export async function importCatalog(text:string){
  const parsed=parseCatalog(text);
  await catalogStore("packaging"); // Create the database once before atomic multi-store import.
  const db=await new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open("cargo-fit-catalog",1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
  try{await new Promise<void>((resolve,reject)=>{const tx=db.transaction(["packaging","records"],"readwrite");parsed.entries.forEach(e=>tx.objectStore("packaging").add(e));parsed.records.forEach(r=>tx.objectStore("records").add(r));tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error);tx.onerror=()=>reject(tx.error);});}finally{db.close();}
}
