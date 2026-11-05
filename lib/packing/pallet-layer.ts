import {quarterTurnOrientation,validOrientationSigns} from "./cargo-body";
import {cargoShapeOf,parseShapeFields,type ShapeFields} from "./cargo-shape";
import {ORIENTATION_CODES} from "./loading-rules";
import {normalizedSetCode,normalizedUnitsPerSet} from "./set-utils";
import type {OrientationCode,OrientationSigns,PlacedBox,ProductInput} from "./types";
export const MAX_LAYER_TEMPLATES=20,MAX_LAYER_ITEMS=500;
export type LayerProduct={sourceProductId:string;sku:string;length:number;width:number;height:number;setCode:string;unitsPerSet:number;shape?:ShapeFields};
export type LayerItem={product:number;x:number;y:number;z:number;orientation:OrientationCode;orientationSigns?:OrientationSigns;kit?:number;item?:number};
export type PalletLayerTemplate={version:1;id:string;name:string;revision:string;createdAt:string;sourcePallet:{length:number;width:number};products:LayerProduct[];items:LayerItem[]};
const EPS=.0001;
const fail=()=>{throw Error("层型模板格式或套装结构无效 / Invalid layer template or kit structure");};
const record=(v:unknown)=>{if(!v||typeof v!=="object"||Array.isArray(v))return fail();return v as Record<string,unknown>;};
const text=(v:unknown,max:number)=>{if(typeof v!=="string"||v.length>max)return fail();return v;};
const number=(v:unknown,min=0,max=100000)=>{if(typeof v!=="number"||!Number.isFinite(v)||v<min||v>max)return fail();return v;};
const integer=(v:unknown,min:number,max:number)=>{const n=number(v,min,max);if(!Number.isInteger(n))return fail();return n;};
export function layerItemSize(t:PalletLayerTemplate,item:LayerItem){const p=t.products[item.product],dims={L:p.length,W:p.width,H:p.height};return [...item.orientation].map(k=>dims[k as keyof typeof dims]) as [number,number,number];}
export function palletLayerBounds(t:PalletLayerTemplate){return t.items.reduce((a,b)=>{const [x,y,z]=layerItemSize(t,b);return {length:Math.max(a.length,b.x+x),width:Math.max(a.width,b.y+y),height:Math.max(a.height,b.z+z)};},{length:0,width:0,height:0});}
/** Rectangular legacy templates keep their original shape-free representation. */
export function layerProductShape(p:ShapeFields):ShapeFields|undefined{
 const cargoShape=cargoShapeOf(p);
 return cargoShape==="box"&&!p.solidModel?undefined:parseShapeFields({...p,cargoShape,protectionGap:undefined});
}
/** Keeps only raw layer data. Stored weights, cargo IDs and previous pass flags are never trusted. */
export function parsePalletLayerTemplates(value:unknown):PalletLayerTemplate[]{
 if(value===undefined)return [];if(!Array.isArray(value)||value.length>MAX_LAYER_TEMPLATES)return fail();const ids=new Set<string>();
 return value.map(raw=>{const v=record(raw),s=record(v.sourcePallet),id=text(v.id,100),name=text(v.name,80).trim(),revision=text(v.revision,80).trim(),createdAt=text(v.createdAt,40);
  if(v.version!==1||!/^[-a-zA-Z0-9_]{1,100}$/.test(id)||ids.has(id)||!name||!revision||!Number.isFinite(Date.parse(createdAt))||!Array.isArray(v.products)||!v.products.length||v.products.length>200||!Array.isArray(v.items)||!v.items.length||v.items.length>MAX_LAYER_ITEMS)return fail();ids.add(id);
  const productIds=new Set<string>(),products:LayerProduct[]=v.products.map(raw=>{const p=record(raw),sourceProductId=text(p.sourceProductId,120),sku=text(p.sku,80),setCode=text(p.setCode,80);if(!sourceProductId||!sku.trim()||productIds.has(sourceProductId)||setCode!==setCode.trim())return fail();productIds.add(sourceProductId);const shape=p.shape===undefined?undefined:layerProductShape(parseShapeFields(record(p.shape)));return {sourceProductId,sku,length:number(p.length,Number.MIN_VALUE),width:number(p.width,Number.MIN_VALUE),height:number(p.height,Number.MIN_VALUE),setCode,unitsPerSet:integer(p.unitsPerSet,1,99),...(shape?{shape}:{})};});
  const items:LayerItem[]=v.items.map(raw=>{const b=record(raw),orientation=b.orientation as OrientationCode;if(!ORIENTATION_CODES.includes(orientation)||!validOrientationSigns(orientation,b.orientationSigns))return fail();const product=integer(b.product,0,products.length-1),kit=b.kit===undefined?undefined:integer(b.kit,1,MAX_LAYER_ITEMS),item=b.item===undefined?undefined:integer(b.item,1,MAX_LAYER_ITEMS);if(products[product].setCode?kit===undefined||item===undefined:kit!==undefined||item!==undefined)return fail();return {product,x:number(b.x),y:number(b.y),z:number(b.z),orientation,...(b.orientationSigns===undefined?{}:{orientationSigns:[...b.orientationSigns as OrientationSigns] as OrientationSigns}),...(kit===undefined?{}:{kit,item})};});
  const result:PalletLayerTemplate={version:1,id,name,revision,createdAt,sourcePallet:{length:number(s.length,Number.MIN_VALUE),width:number(s.width,Number.MIN_VALUE)},products,items};
  if(products.some((_,i)=>!items.some(b=>b.product===i))||(["x","y","z"] as const).some(k=>Math.abs(Math.min(...items.map(b=>b[k])))>EPS)||Object.values(palletLayerBounds(result)).some(n=>n>100000))return fail();
  const groups=new Map<string,LayerItem[]>();for(const b of items)if(b.kit!==undefined){const key=`${products[b.product].setCode}/${b.kit}`;groups.set(key,[...groups.get(key)??[],b]);}
  for(const group of groups.values()){const numbers=group.map(b=>b.item!).sort((a,b)=>a-b);if(numbers.some((n,i)=>n!==i+1))return fail();const code=products[group[0].product].setCode;for(let i=0;i<products.length;i++)if(products[i].setCode===code){const entries=group.filter(b=>b.product===i);if(entries.length!==products[i].unitsPerSet)return fail();}}
  return result;
 });
}
export function resolveLayerProducts(t:PalletLayerTemplate,products:readonly ProductInput[]){
 const used=new Set<string>();const mapped=t.products.map(source=>{const sameId=products.find(p=>p.id===source.sourceProductId),candidates=sameId?[sameId]:products.filter(p=>p.sku===source.sku);if(candidates.length!==1)throw Error("层型 SKU 缺失或同名订单行不唯一 / Layer SKU is missing or ambiguous");const p=candidates[0];if(used.has(p.id)||p.sku!==source.sku||JSON.stringify(layerProductShape(p))!==JSON.stringify(source.shape)||[p.length-source.length,p.width-source.width,p.height-source.height].some(n=>Math.abs(n)>EPS)||normalizedSetCode(p)!==source.setCode||normalizedUnitsPerSet(p)!==source.unitsPerSet)throw Error("当前箱规、外形、SKU 或套装比例与层型不一致 / Current dimensions, geometry, SKU or kit ratio differ from the layer");used.add(p.id);return p;});
 for(const code of new Set(mapped.map(normalizedSetCode).filter(Boolean)))if(products.some(p=>normalizedSetCode(p)===code&&!mapped.some(m=>m.id===p.id)))throw Error("层型缺少当前套装组件 / Layer omits a current kit component");return mapped;
}
/** Produces local prototypes only; the complete-plan transaction assigns fresh carton / kit identities. */
export function palletLayerCopies(raw:PalletLayerTemplate,products:readonly ProductInput[],position:{x:number;y:number;z:number},turns:number,repeat:number,alternate180:boolean):PlacedBox[][]{
 const t=parsePalletLayerTemplates([raw])[0],mapped=resolveLayerProducts(t,products);if(![position.x,position.y,position.z].every(n=>Number.isFinite(n)&&n>=0&&n<=100000)||!Number.isInteger(turns)||turns<0||turns>3||!Number.isInteger(repeat)||repeat<1||repeat>20||typeof alternate180!=="boolean")throw Error("层型位置、旋转或重复次数无效 / Invalid layer position, rotation or repeat count");
 const bounds=palletLayerBounds(t);return Array.from({length:repeat},(_,copy)=>{
  const rotation=(turns+(alternate180&&copy%2?2:0))%4;return t.items.map(item=>{const p=mapped[item.product],[dx,dy,dz]=layerItemSize(t,item);let b:PlacedBox={id:"",productId:p.id,sku:p.sku,name:p.name,color:p.color,weight:p.weight,layer:1,x:item.x,y:item.y,z:item.z,dx,dy,dz,orientation:item.orientation,orientationSigns:item.orientationSigns,...(item.kit===undefined?{}:{setCode:normalizedSetCode(p),setNumber:item.kit,setItemNumber:item.item})};let length=bounds.length,width=bounds.width;for(let k=0;k<rotation;k++){b={...b,...quarterTurnOrientation(b),x:b.y,y:length-b.x-b.dx,dx:b.dy,dy:b.dx};[length,width]=[width,length];}return {...b,x:b.x+position.x,y:b.y+position.y,z:b.z+position.z+copy*bounds.height};});
 });
}
