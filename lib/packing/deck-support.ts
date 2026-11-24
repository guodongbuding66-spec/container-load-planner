import {bearingLoads} from "./bearing";
import type {FloorPalletConfig,PackingResult,PlacedBox,PlacedPallet,ProductInput} from "./types";

export const MAX_DECK_SUPPORTS=12;
export const DECK_SUPPORT_PREFIX="deck-support/";
export type DeckSupport={id:string;name:string;x:number;y:number;dx:number;dy:number;dz:number;weightKg:number|null;maxLoadKg:number|null;source:string;revision:string};
export function parseDeckSupports(value:unknown,draft=false):DeckSupport[]|undefined{
 if(value===undefined)return undefined;
 const fail=()=>{throw Error("Invalid deck support data / 托内支承件的标识、尺寸、重量或静载资料无效");};
 if(!Array.isArray(value)||value.length>MAX_DECK_SUPPORTS)return fail();
 const ids=new Set<string>();const rows=value.map(raw=>{
  if(!raw||typeof raw!=="object"||Array.isArray(raw))return fail();const s=raw as DeckSupport;
  if(typeof s.id!=="string"||!/^[-a-zA-Z0-9_]{1,80}$/.test(s.id)||ids.has(s.id)||typeof s.name!=="string"||!draft&&!s.name.trim()||s.name.length>100)return fail();
  if(![s.x,s.y,s.dx,s.dy,s.dz].every(n=>typeof n==="number"&&Number.isFinite(n)&&n>=0&&n<=100000)||Math.min(s.dx,s.dy,s.dz)<1)return fail();
  if(!draft&&s.weightKg===null)throw Error(`请填写第 ${ids.size+1} 个托内支承件的新增自重，或确认零自重`);
  if(!(draft&&s.weightKg===null)&&(typeof s.weightKg!=="number"||!Number.isFinite(s.weightKg)||s.weightKg<0||s.weightKg>10000))return fail();
  if(!(s.maxLoadKg===null||typeof s.maxLoadKg==="number"&&Number.isFinite(s.maxLoadKg)&&s.maxLoadKg>=0&&s.maxLoadKg<=100000))return fail();
  if(typeof s.source!=="string"||s.source.length>500||typeof s.revision!=="string"||s.revision.length>120)return fail();
  ids.add(s.id);return {id:s.id,name:s.name.trim(),x:s.x,y:s.y,dx:s.dx,dy:s.dy,dz:s.dz,weightKg:s.weightKg,maxLoadKg:s.maxLoadKg,source:s.source.trim(),revision:s.revision.trim()};
 });return rows.length?rows:undefined;
}
export const deckSupportMass=(p:Pick<FloorPalletConfig,"packaging">)=>p.packaging?.deckSupports?.reduce((n,s)=>n+(s.weightKg??NaN),0)??0;
/** Legacy tare excludes these separately entered pieces; complete tare is derived once. */
export const completePackagingTare=(c:Pick<FloorPalletConfig,"weight"|"packaging">)=>c.weight+deckSupportMass(c);
export const deckSupportHeight=(p:Pick<FloorPalletConfig,"packaging">)=>Math.max(0,...p.packaging?.deckSupports?.map(s=>s.dz)??[]);
export function assertDeckSupportStacking(config:FloorPalletConfig,layers:number,top:number){if(config.packaging?.deckSupports?.length&&(layers!==1||top!==0))throw Error("Deck supports currently require floor-only complete pallets / 托内支承件首阶段要求整托单层底置，上压为 0");}
/** Anchors have zero mass; their real mass is included once in the complete pallet tare. */
export function palletDeckSupportGeometry(pallets:readonly PlacedPallet[]){
 const boxes:PlacedBox[]=[],products:ProductInput[]=[];
 for(const p of pallets)for(const s of p.packaging?.deckSupports??[]){
  const cross=p.orientation==="WLH",length=cross?p.dy:p.dx,id=`${DECK_SUPPORT_PREFIX}${p.id}/${s.id}`;
  const evidence=(!p.packaging||["solid","corner-feet"].includes(p.packaging.base)||p.packaging.measurements?.source&&p.packaging.measurements.revision)?{source:s.source,revision:s.revision}:{source:"",revision:""};
  const r=rotateDeckRect(s,length,cross?p.dx:p.dy,palletQuarterTurns(p));
  const b:PlacedBox={id,productId:id,sku:s.name,name:s.name,x:p.x+r.x,y:p.y+r.y,z:p.z+p.dz,dx:r.dx,dy:r.dy,dz:s.dz,weight:0,color:"#348566",orientation:"LWH",layer:1,supportOnly:true,supportEvidence:evidence,palletIds:[p.id]};boxes.push(b);
  products.push({id,sku:b.sku,name:b.name,length:b.dx,width:b.dy,height:b.dz,weight:0,quantity:0,priority:0,rotationPolicy:"fixed",stackable:true,maxStackLayers:0,color:b.color,...(s.maxLoadKg===null?{}:{maxTopLoadKg:s.maxLoadKg})});
 }
 return {boxes,products};
}
export function palletEnvelopeTop(p:PlacedPallet,cargo:readonly PlacedBox[]=[]){return Math.max(p.z+p.dz+deckSupportHeight(p),p.z+(p.enclosureHeight??0),...cargo.map(b=>b.z+b.dz));}
export function inspectDeckSupports(plan:PackingResult,products:readonly ProductInput[]=[]){
 const fixed=palletDeckSupportGeometry(plan.pallets??[]);if(!fixed.boxes.length)return [];
 const complete=plan.placements.every(b=>products.some(p=>p.id===b.productId)),loads=bearingLoads([...fixed.boxes,...plan.placements],[...products,...fixed.products]);
 return (plan.pallets??[]).flatMap(p=>(p.packaging?.deckSupports??[]).map(s=>{
  const id=`${DECK_SUPPORT_PREFIX}${p.id}/${s.id}`,b=fixed.boxes.find(b=>b.id===id)!,loadKg=complete?loads.get(id)??0:undefined;
  const state:"pass"|"fail"|"unverified"=s.maxLoadKg!==null&&loadKg!==undefined&&loadKg>s.maxLoadKg+.00001?"fail":s.maxLoadKg===null||!b.supportEvidence?.source||!b.supportEvidence.revision||!complete?"unverified":"pass";
  return {id,palletId:p.id,name:s.name,weightKg:s.weightKg,limitKg:s.maxLoadKg,loadKg,state,source:s.source,revision:s.revision};
 }));
}
/** Four turns are needed for asymmetric attached pieces; old two-direction files retain their meaning. */
export function palletQuarterTurns(p:Pick<PlacedPallet,"orientation"|"quarterTurns">){return p.quarterTurns??(p.orientation==="WLH"?1:0);}
export function rotateDeckRect<T extends {x:number;y:number;dx:number;dy:number}>(b:T,length:number,width:number,times:number):T{
 let box={...b},l=length,w=width;for(let i=0;i<times;i++){box={...box,x:box.y,y:l-box.x-box.dx,dx:box.dy,dy:box.dx};[l,w]=[w,l];}return box;
}
