import type { PackingResult, ProductInput } from "./types";
import { parseProductInput } from "./workspace-file";
export type PackagingRecord={id:string;name:string;revision:string;effectiveDate:string;notes:string;products:ProductInput[];createdAt:string};
export type FieldRecord={id:string;name:string;split:"calibration"|"acceptance";packagingSignature:string;settingsSignature?:string;container:PackingResult["container"];predicted:number;actual:number;minutes:number;reason:string;photos:string[];createdAt:string};
export function packagingSignature(products:ProductInput[]){return JSON.stringify(products.map(p=>[p.sku,p.length,p.width,p.height,p.weight,p.setCode??"",p.unitsPerSet??1,p.packaging?.revision??""]).sort((a,b)=>String(a[0]).localeCompare(String(b[0]))));}
export async function catalogStore<T>(bucket:"packaging"|"records",value?:T):Promise<T[]>{
  const db=await new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open("cargo-fit-catalog",1);r.onupgradeneeded=()=>{r.result.createObjectStore("packaging",{keyPath:"id"});r.result.createObjectStore("records",{keyPath:"id"});};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
  try{return await new Promise<T[]>((resolve,reject)=>{const tx=db.transaction(bucket,value?"readwrite":"readonly"),s=tx.objectStore(bucket);if(value)s.put(value);const r=s.getAll();tx.oncomplete=()=>resolve(r.result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});}finally{db.close();}
}
export function calibrationReport(records:FieldRecord[]){
  const train=records.filter(r=>r.split==="calibration"&&r.predicted>0),holdout=records.filter(r=>r.split==="acceptance"&&r.actual>0);
  // Stratify by measured container and packaging revision; never learn from acceptance samples.
  const key=(r:FieldRecord)=>`${r.packagingSignature}|${r.settingsSignature??"legacy"}|${r.container.length}/${r.container.width}/${r.container.height}/${r.container.doorWidth}/${r.container.doorHeight}`;
  const evaluate=holdout.map(r=>{const peers=train.filter(t=>key(t)===key(r));const factor=peers.length?peers.reduce((n,t)=>n+t.actual/t.predicted,0)/peers.length:1;const predicted=Math.floor(r.predicted*factor);return {id:r.id,name:r.name,predicted,actual:r.actual,errorPct:Math.abs(predicted-r.actual)/r.actual*100,trainingCount:peers.length};});
  return {trainingCount:train.length,acceptanceCount:holdout.length,evaluate,meanErrorPct:evaluate.length?evaluate.reduce((n,r)=>n+r.errorPct,0)/evaluate.length:null};
}

export function parseCatalog(text:string):{entries:PackagingRecord[];records:FieldRecord[]}{
  const raw=JSON.parse(text);if(raw?.format!=="cargo-fit-catalog"||raw.version!==1||!Array.isArray(raw.entries)||!Array.isArray(raw.records)||raw.entries.length>500||raw.records.length>500)throw Error("档案格式无效");
  const str=(s:unknown,max=2000)=>{if(typeof s!=="string"||s.length>max)throw Error("档案文字无效");return s;};
  const num=(n:unknown)=>{if(typeof n!=="number"||!Number.isFinite(n)||n<0)throw Error("档案数字无效");return n;};
  const entries:PackagingRecord[]=raw.entries.map((e:PackagingRecord)=>{if(!Array.isArray(e.products)||!e.products.length||e.products.length>1000)throw Error("包装箱规无效");const products=e.products.map(parseProductInput);if(products.some(p=>Math.min(p.length,p.width,p.height)<=0)||new Set(products.map(p=>p.id)).size!==products.length)throw Error("包装尺寸或标识无效");return {id:crypto.randomUUID(),name:str(e.name,100),revision:str(e.revision,100),effectiveDate:str(e.effectiveDate,10),notes:str(e.notes),createdAt:str(e.createdAt,40),products};});
  const records:FieldRecord[]=raw.records.map((r:FieldRecord)=>{if(!["calibration","acceptance"].includes(r.split)||!Array.isArray(r.photos)||r.photos.length>4||r.photos.some(p=>typeof p!=="string"||p.length>1500000||!/^data:image\/(png|jpeg|webp);base64,[A-Za-z\d+/=]+$/.test(p)))throw Error("实装记录或照片无效");for(const k of ["length","width","height","doorWidth","doorHeight","maxWeight"] as const)num(r.container?.[k]);const actual=num(r.actual);if(actual<=0||!Number.isInteger(actual))throw Error("实装数量无效");return {...r,id:crypto.randomUUID(),name:str(r.name,100),packagingSignature:str(r.packagingSignature,500000),settingsSignature:r.settingsSignature===undefined?undefined:str(r.settingsSignature,2000),reason:str(r.reason),createdAt:str(r.createdAt,40),actual,predicted:num(r.predicted),minutes:num(r.minutes)};});return {entries,records};
}
export async function importCatalog(text:string){
  const parsed=parseCatalog(text);
  await catalogStore("packaging"); // Create the database once before atomic multi-store import.
  const db=await new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open("cargo-fit-catalog",1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
  try{await new Promise<void>((resolve,reject)=>{const tx=db.transaction(["packaging","records"],"readwrite");parsed.entries.forEach(e=>tx.objectStore("packaging").add(e));parsed.records.forEach(r=>tx.objectStore("records").add(r));tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error);tx.onerror=()=>reject(tx.error);});}finally{db.close();}
}
