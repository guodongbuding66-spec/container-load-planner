import {deckSupportHeight,palletQuarterTurns,rotateDeckRect} from "./deck-support";
import {layerProductShape,palletLayerCopies,parsePalletLayerTemplates,type PalletLayerTemplate} from "./pallet-layer";
import { MAX_VISIBLE_PLACEMENTS, pack, rebuildPlacementLayers, restorePackingSnapshot } from "./engine";
import { bearingStatus } from "./bearing";
import { bodyContactArea,quarterTurnOrientation } from "./cargo-body";
import { selectionBounds, type Delta } from "./plan-edit";
import { packagingInterior } from "./packaging";
import { specificationForPallet } from "./pallet-specifications";
import { auditPackingResult } from "./result-audit";
import { collectSetGroups, normalizedSetCode, normalizedUnitsPerSet } from "./set-utils";
import type { PackingResult, PlacedBox, PlacedPallet, ProductInput } from "./types";

export type PalletEdit =
  | {type:"move";ids:string[];delta:Delta}
  | {type:"rotate";ids:string[]}
  | {type:"remove";ids:string[]}
  | {type:"copy-layer";bottom:number}
  | {type:"transfer";ids:string[];targetId:string;position:Delta}
  | {type:"add";productId:string;position:Delta}
  | {type:"apply-layer";template:PalletLayerTemplate;position:Delta;turns:number;repeat:number;alternate180:boolean}
  | {type:"repack";positions:PlacedBox[];sourceKey:string}
  | {type:"lock"|"lock-others";locked:boolean}
  | {type:"lock-cargo";ids:string[];locked:boolean};
const EPS=.0001;
let serial=0;
function turn(box:PlacedBox,times:number){let b={...box};for(let i=0;i<times;i++)b={...b,dx:b.dy,dy:b.dx,...quarterTurnOrientation(b)};return b;}
/** Local X/Y follow the original pallet length/width; local Z=0 is the cargo deck surface. */
export function palletLocalBox(b:PlacedBox,p:PlacedPallet):PlacedBox {
  const times=palletQuarterTurns(p),local={...b,x:b.x-p.x,y:b.y-p.y,z:b.z-p.z-p.dz},r=rotateDeckRect(local,p.dx,p.dy,(4-times)%4),oriented=turn(local,(4-times)%4);
  return {...oriented,x:r.x,y:r.y};
}
export function palletWorldBox(b:PlacedBox,p:PlacedPallet):PlacedBox {
  const times=palletQuarterTurns(p),cross=p.orientation==="WLH",r=rotateDeckRect(b,cross?p.dy:p.dx,cross?p.dx:p.dy,times),oriented=turn(b,times);
  return {...oriented,x:p.x+r.x,y:p.y+r.y,z:p.z+p.dz+b.z,palletIds:[p.id]};
}
/** Scene drags use world axes; editing inputs use the original pallet axes. */
export function palletLocalDelta(delta:Delta,p:PlacedPallet):Delta{
  let result={...delta};for(let n=0;n<palletQuarterTurns(p);n++)result={x:-result.y,y:result.x,z:result.z};return result;
}
export type PalletRepackMeasures={cargoTopMm:number;unitHeightMm:number;lengthMm:number;widthMm:number;footprintMm2:number};
export function palletContentMeasures(p:PlacedPallet,cargo:PlacedBox[]):PalletRepackMeasures{
  const boxes=cargo.map(b=>palletLocalBox(b,p)),length=Math.max(...boxes.map(b=>b.x+b.dx))-Math.min(...boxes.map(b=>b.x)),width=Math.max(...boxes.map(b=>b.y+b.dy))-Math.min(...boxes.map(b=>b.y));
  const top=Math.max(deckSupportHeight(p),...boxes.map(b=>b.z+b.dz));
  return {cargoTopMm:top,unitHeightMm:Math.max(p.enclosureHeight??p.dz,p.dz+top),lengthMm:length,widthMm:width,footprintMm2:length*width};
}
export function betterPalletContent(a:PalletRepackMeasures,b:PalletRepackMeasures){return a.cargoTopMm<b.cargoTopMm-EPS||Math.abs(a.cargoTopMm-b.cargoTopMm)<EPS&&a.footprintMm2<b.footprintMm2-EPS;}
export const palletRepackSource=(plan:PackingResult,products:ProductInput[],id:string)=>JSON.stringify([id,plan.id,plan.createdAt,plan.workflow,plan.strategy,plan.palletization,plan.palletBuild,plan.container,plan.clearance,plan.loadingRules,plan.pallets,plan.placements,products]);
/** Retain complete kits and recursively all actual cargo supporters of locked cargo. */
export function palletRepackFixedIds(cargo:PlacedBox[],products:ProductInput[]){
  const rules=new Map(products.map(p=>[p.id,p])),fixed=new Set(cargo.filter(b=>b.locked).map(b=>b.id));
  let changed=true;
  while(changed){changed=false;for(const b of cargo){if(!fixed.has(b.id))continue;for(const a of cargo){if(fixed.has(a.id))continue;
    if(b.setCode&&a.setCode===b.setCode&&a.setNumber===b.setNumber||Math.abs(a.z+a.dz-b.z)<EPS&&bodyContactArea(b,a,rules.get(b.productId),rules.get(a.productId))>EPS){fixed.add(a.id);changed=true;}
  }}}
  return fixed;
}
export function palletLayers(plan:PackingResult,id:string){
  const p=plan.pallets?.find(p=>p.id===id);if(!p)return [];
  const cargo=plan.placements.filter(b=>b.palletIds?.includes(id)).map(b=>palletLocalBox(b,p));
  const groups=new Map<number,PlacedBox[]>();for(const b of cargo){const z=Math.round(b.z/EPS);groups.set(z,[...groups.get(z)??[],b]);}
  return [...groups.values()].map(boxes=>({bottom:boxes[0].z,top:Math.max(...boxes.map(b=>b.z+b.dz)),ids:boxes.map(b=>b.id)})).sort((a,b)=>a.bottom-b.bottom);
}
export function palletOrderPool(plan:PackingResult,products:readonly ProductInput[]){
  const counts=new Map<string,number>();for(const b of plan.placements)counts.set(b.productId,(counts.get(b.productId)??0)+1);
  return products.map(p=>{const loaded=counts.get(p.id)??0;return {productId:p.id,sku:p.sku,requested:p.quantity,loaded,remaining:p.quantity-loaded};});
}
function wholeKits(plan:PackingResult,boxes:PlacedBox[]){
  const ids=new Set(boxes.map(b=>b.id)),kits=new Set(boxes.filter(b=>b.setCode).map(b=>`${b.setCode}/${b.setNumber}`));
  return plan.placements.filter(b=>ids.has(b.id)||!!b.setCode&&kits.has(`${b.setCode}/${b.setNumber}`));
}
/** Capture a physical layer, expanding any cross-layer kit as one complete reusable block. */
export function capturePalletLayer(plan:PackingResult,products:ProductInput[],id:string,bottom:number,name:string,revision:string):PalletLayerTemplate {
 if(!plan.validation.valid||!plan.palletization||auditPackingResult(plan,products).hasErrors||!Number.isFinite(bottom))throw Error("请使用完整有效的托内方案 / A complete valid pallet plan is required");
 const p=plan.pallets?.find(p=>p.id===id);if(!p)throw Error("未找到托盘 / Pallet not found");
 const layer=plan.placements.filter(b=>b.palletIds?.includes(id)&&Math.abs(palletLocalBox(b,p).z-bottom)<EPS);if(!layer.length)throw Error("未找到所选物理层 / Physical layer not found");
 const selected=wholeKits(plan,layer);if(selected.some(b=>b.palletIds?.length!==1||b.palletIds[0]!==id))throw Error("层型套装跨托，不能拆开保存 / Layer kit spans pallets and cannot be split");
 const local=selected.map(b=>palletLocalBox(b,p)),bounds=selectionBounds(local)!,sources=[...new Set(local.map(b=>b.productId))].map(key=>products.find(p=>p.id===key)!);
 if(sources.some(p=>!p))throw Error("层型引用了缺失的订单行 / A layer references a missing order row");
 const config=specificationForPallet(plan.palletization,p).config,kits=new Map<string,number>();
 return parsePalletLayerTemplates([{version:1,id:`layer-${Date.now().toString(36)}-${++serial}`,name,revision,createdAt:new Date().toISOString(),sourcePallet:{length:config.length,width:config.width},products:sources.map(p=>({sourceProductId:p.id,sku:p.sku,length:p.length,width:p.width,height:p.height,setCode:normalizedSetCode(p),unitsPerSet:normalizedUnitsPerSet(p),shape:layerProductShape(p)})),items:local.map(b=>{const key=`${b.setCode}/${b.setNumber}`;if(b.setCode&&!kits.has(key))kits.set(key,kits.size+1);return {product:sources.findIndex(p=>p.id===b.productId),x:b.x-bounds.x,y:b.y-bounds.y,z:b.z-bounds.z,orientation:b.orientation,orientationSigns:b.orientationSigns,...(b.setCode?{kit:kits.get(key),item:b.setItemNumber}:{})};})}])[0];
}
const identity=(b:PlacedBox)=>JSON.stringify([b.id,b.productId,b.sku,b.weight,b.x,b.y,b.z,b.dx,b.dy,b.dz,b.orientation,b.orientationSigns,b.setCode,b.setNumber,b.setItemNumber,b.palletIds,b.locked]);
function validPoint(p:Delta){if(![p.x,p.y,p.z].every(Number.isFinite))throw new Error("坐标必须是有效数字 / Coordinates must be finite");}

/** One complete-plan transaction; neither the order nor the source snapshot is mutated. */
export function editPalletContents(plan:PackingResult,products:ProductInput[],id:string,action:PalletEdit):PackingResult {
  if(!plan.palletization||plan.mode!=="mixed"||!plan.validation.valid||plan.metrics.loadedCount!==plan.placements.length)throw new Error("托内编辑需要完整且有效的预打托方案 / A complete valid prebuilt plan is required");
  if(auditPackingResult(plan,products).hasErrors)throw new Error("方案与订单资料不一致，请重新计算 / Plan and order data disagree; recalculate first");
  const p=plan.pallets?.find(p=>p.id===id);if(!p)throw new Error("未找到托盘 / Pallet not found");
  const isLock=action.type==="lock"||action.type==="lock-others";
  if(p.locked&&!isLock)throw new Error("请先解除整托锁定 / Unlock this pallet first");
  let pallets=plan.pallets!,placements=[...plan.placements];
  const onPallet=plan.placements.filter(b=>b.palletIds?.length===1&&b.palletIds[0]===id);
  const ids="ids" in action?action.ids:[],selection=new Set(ids);
  let selected=onPallet.filter(b=>selection.has(b.id));
  if("ids" in action&&(!ids.length||new Set(ids).size!==ids.length||selected.length!==ids.length))throw new Error("请选择当前托内的箱体 / Select cargo on the current pallet");
  if(action.type==="remove"||action.type==="transfer")selected=wholeKits(plan,selected);
  if(!isLock&&action.type!=="add"&&action.type!=="copy-layer"&&action.type!=="apply-layer"&&action.type!=="lock-cargo"&&selected.some(b=>b.locked))throw new Error("请先解除箱位锁定 / Unlock selected cargo first");
  const selectedIds=new Set(selected.map(b=>b.id));
  const local=selected.map(b=>palletLocalBox(b,p));
  const usedIds=new Set(placements.map(b=>b.id));
  const newId=()=>{let value:string;do{value=`pallet-edit-${Date.now().toString(36)}-${++serial}`;}while(usedIds.has(value));usedIds.add(value);return value;};
  const cloneCargo=(boxes:PlacedBox[])=>{
    const next=new Map<string,number>(),sets=new Map<string,number>();
    for(const b of placements)if(b.setCode)next.set(b.setCode,Math.max(next.get(b.setCode)??0,b.setNumber??0));
    return boxes.map(b=>{let setNumber=b.setNumber;if(b.setCode){const key=`${b.setCode}/${b.setNumber}`;if(!sets.has(key)){const n=(next.get(b.setCode)??0)+1;next.set(b.setCode,n);sets.set(key,n);}setNumber=sets.get(key);}return {...b,id:newId(),locked:undefined,setNumber};});
  };
  if(action.type==="lock"||action.type==="lock-others"){
    pallets=pallets.map(q=>(action.type==="lock"?q.id===id:q.id!==id)?{...q,locked:action.locked}:q);
  }else if(action.type==="lock-cargo"){
    placements=placements.map(b=>selectedIds.has(b.id)?{...b,locked:action.locked}:b);
  }else if(action.type==="repack"){
    if(action.sourceKey!==palletRepackSource(plan,products,id))throw Error("局部重排预览已失效，请重新搜索 / Local repack preview is stale; search again");
    const next=new Map(action.positions.map(b=>[b.id,b]));
    if(next.size!==onPallet.length||next.size!==action.positions.length||onPallet.some(b=>!next.has(b.id)))throw Error("局部重排必须保留当前托内全部箱体 / Local repacking must retain every current carton");
    const immutable=(b:PlacedBox)=>JSON.stringify([b.id,b.productId,b.sku,b.name,b.color,b.weight,b.setCode,b.setNumber,b.setItemNumber,b.palletIds,b.locked]);
    for(const b of onPallet)if(immutable(b)!==immutable(next.get(b.id)!))throw Error("局部重排不能改变箱体身份、套号或重量 / Local repacking cannot change carton identity, kits or weight");
    const fixed=palletRepackFixedIds(onPallet,products);
    for(const b of onPallet)if(fixed.has(b.id)&&identity(b)!==identity(next.get(b.id)!))throw Error("固定箱位、支撑链及同套组件必须保留 / Fixed cargo, supporters and complete kits must remain unchanged");
    if(!betterPalletContent(palletContentMeasures(p,action.positions),palletContentMeasures(p,onPallet)))throw Error("未发现更优局部方案，原箱位保留 / No better local layout found; original positions retained");
    placements=placements.map(b=>next.get(b.id)??b);
  }else if(action.type==="remove"){
    placements=placements.filter(b=>!selectedIds.has(b.id));
  }else if(action.type==="move"||action.type==="rotate"){
    const bounds=selectionBounds(local)!;
    if(action.type==="move")validPoint(action.delta);
    const moved=new Map(local.map(b=>{const candidate=action.type==="move"?{...b,x:b.x+action.delta.x,y:b.y+action.delta.y,z:b.z+action.delta.z}:{...turn(b,1),x:bounds.x+b.y-bounds.y,y:bounds.y+bounds.dx-(b.x-bounds.x)-b.dx};return [b.id,palletWorldBox(candidate,p)];}));
    placements=placements.map(b=>moved.get(b.id)??b);
  }else if(action.type==="transfer"){
    validPoint(action.position);const target=pallets.find(q=>q.id===action.targetId);
    if(!target||target.id===id||target.locked)throw new Error("请选择另一张未锁定托盘 / Choose another unlocked pallet");
    const bounds=selectionBounds(local)!,moved=new Map(local.map(b=>[b.id,palletWorldBox({...b,x:b.x-bounds.x+action.position.x,y:b.y-bounds.y+action.position.y,z:b.z-bounds.z+action.position.z},target)]));
    placements=placements.map(b=>moved.get(b.id)??b);
  }else if(action.type==="copy-layer"){
    if(!Number.isFinite(action.bottom))throw new Error("层高无效 / Invalid layer height");
    const layer=onPallet.filter(b=>Math.abs(palletLocalBox(b,p).z-action.bottom)<EPS);
    if(!layer.length)throw new Error("未找到所选物理层 / Physical layer not found");
    const group=wholeKits(plan,layer).map(b=>palletLocalBox(b,p)),bounds=selectionBounds(group)!;
    placements.push(...cloneCargo(group).map(b=>palletWorldBox({...b,z:b.z+bounds.dz},p)));
  }else if(action.type==="apply-layer"){
    for(const copy of palletLayerCopies(action.template,products,action.position,action.turns,action.repeat,action.alternate180))placements.push(...cloneCargo(copy).map(b=>palletWorldBox(b,p)));
  }else if(action.type==="add"){
    validPoint(action.position);
    const product=products.find(q=>q.id===action.productId);if(!product)throw new Error("未找到 SKU / SKU not found");
    const code=normalizedSetCode(product),members=code?collectSetGroups(products).get(code)!:[product];
    const pool=palletOrderPool(plan,products);
    if(members.some(q=>pool.find(r=>r.productId===q.id)!.remaining<(code?normalizedUnitsPerSet(q):1)))throw new Error("订单余量不足一箱或完整套装 / Insufficient unassigned order quantity");
    const config=specificationForPallet(plan.palletization,p).config,inside=packagingInterior(config);
    const {x,y,z}=action.position,height=config.maxCargoHeight||plan.container.height-plan.clearance-p.z-p.dz;
    if(x<inside.inset-EPS||y<inside.inset-EPS||z<0||x>=config.length-inside.inset||y>=config.width-inside.inset||z>=height)throw new Error("添加起点超出托内净空 / Insertion origin is outside the pallet interior");
    const group=pack({palletBuildStage:true,mode:"mixed",strategy:plan.strategy,clearance:0,loadingRules:plan.loadingRules,container:{id:"pallet-edit",name:p.name,category:"pallet",loadingAccess:"open",length:config.length-inside.inset-x,width:config.width-inside.inset-y,height:height-z,doorWidth:config.width-inside.inset-y,doorHeight:height-z,maxWeight:p.maxLoad},products:members.map(q=>({...q,quantity:code?normalizedUnitsPerSet(q):1}))});
    const count=members.reduce((n,q)=>n+(code?normalizedUnitsPerSet(q):1),0);
    if(!group.validation.valid||group.placements.length!==count)throw new Error("完整一箱或整套无法放入指定区域 / The complete carton or kit does not fit at this origin");
    placements.push(...cloneCargo(group.placements).map(b=>palletWorldBox({...b,x:b.x+x,y:b.y+y,z:b.z+z},p)));
  }
  if(placements.length>MAX_VISIBLE_PLACEMENTS)throw new Error("超过箱位数量上限 / Placement limit exceeded");
  if(palletOrderPool({...plan,placements},products).some(p=>p.remaining<0))throw new Error("操作超过订单数量 / This edit exceeds order quantities");
  // Preserve all original carton identity and the position of every locked unit.
  const byId=new Map(placements.map(b=>[b.id,b])),sourceById=new Map(plan.placements.map(b=>[b.id,b]));
  const lockedIds=new Set(plan.pallets!.filter(q=>q.locked).map(q=>q.id));
  for(const old of plan.placements){const next=byId.get(old.id),lockedPallet=old.palletIds?.some(id=>lockedIds.has(id));
    if(lockedPallet&&(!next||identity(old)!==identity(next)))throw new Error("其他锁定托盘必须保持不变 / Other locked pallets must remain unchanged");
    if(old.locked&&action.type!=="lock-cargo"&&(!next||identity(old)!==identity(next)))throw new Error("锁定箱位必须保持不变 / Locked cargo must remain unchanged");
  }
  const candidate={...plan,pallets,placements:rebuildPlacementLayers(placements,pallets,products,plan.loadingRules,plan.container,plan.clearance),palletization:{...plan.palletization,selectionChoices:undefined,editRevision:(plan.palletization.editRevision??0)+1}};
  const result=restorePackingSnapshot({workflow:plan.workflow,mode:plan.mode,strategy:plan.strategy,palletBuild:plan.palletBuild,container:plan.container,clearance:plan.clearance,loadingRules:plan.loadingRules,practicalTargetUtilization:plan.practicalTargetUtilization,products},candidate);
  // A local contents edit cannot silently reassign neighbouring cargo to another unit.
  for(const b of result.placements){const expected=byId.get(b.id)!;if(JSON.stringify(b.palletIds)!==JSON.stringify(expected.palletIds))throw new Error("箱位失去目标托盘支撑 / Cargo lost support from its assigned pallet");
    const source=sourceById.get(b.id);if(source&&source.palletIds?.some(id=>lockedIds.has(id))&&identity(source)!==identity(b))throw new Error("锁定托盘发生变化 / A locked pallet changed");
  }
  if(action.type==="repack"){
    const resultById=new Map(result.placements.map(b=>[b.id,b])),state=(b:PlacedBox|undefined)=>b&&JSON.stringify(Object.entries(b).sort(([a],[c])=>a.localeCompare(c)));
    for(const old of plan.placements)if(!old.palletIds?.includes(id)&&state(old)!==state(resultById.get(old.id)))throw Error("局部重排不能改变其他整托 / Local repacking cannot change other pallets");
  }
  result.id=`pallet-revision-${Date.now()}-${++serial}`;
  result.warnings=["托内编辑已按完整订单重新校验；采用后请重新导出现场指导，旧版现场进度不能用于此方案。 / Pallet contents were revalidated against the complete order; re-export field instructions after applying. Previous progress belongs to the old plan."];
  if(result.palletization?.only)result.warnings.unshift("仅生成独立托盘；三维编组位置用于查看，不代表柜内箱位。 / Pallets only; inspection coordinates are not vehicle loading instructions.");
  if(result.pallets?.some(p=>p.packaging&&p.packaging.enclosure!=="none"))result.warnings.push("整托叠放已按所选模式复核：可堆叠预排检查尺寸与已填上压，额定模式另核对四角传力；动态和材料强度未核验。 / Unit tiers were rechecked in the selected mode: declared layouts check geometry and entered top loads; rated mode also checks four-path evidence. Dynamics and material strength remain unverified.");
  const unknown=bearingStatus(result.placements,products).unknownIds.length;
  if(unknown)result.warnings.push(`承重未核验：${unknown} 个受压箱体缺少当前朝向的额定资料。 / Bearing unverified: ${unknown} loaded cartons lack orientation-specific ratings.`);
  return result;
}
