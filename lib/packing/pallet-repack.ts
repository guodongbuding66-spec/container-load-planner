import {cargoShapeOf} from "./cargo-shape";
import {DEFAULT_LOADING_RULES} from "./loading-rules";
import {rebuildPlacementLayers,restorePackingSnapshot,searchPalletContents} from "./engine";
import {betterPalletContent,editPalletContents,palletContentMeasures,palletContentsSourceKey,palletLocalBox,palletRepackFixedIds,palletWorldBox,type PalletRepackMeasures} from "./pallet-edit";
import {palletSearchFrame} from "./pallet-search-frame";
import {specificationForPallet} from "./pallet-specifications";
import {auditPackingResult} from "./result-audit";
import type {PackingResult,PlacedBox,PlacedPallet,ProductInput} from "./types";

export const MAX_LOCAL_REPACK_CARTONS=160;
export const LOCAL_REPACK_PASSES=4;
export type PalletRepackResult={sourceKey:string;positions:PlacedBox[];improved:boolean;palletId:string;attempts:number;feasible:number;rejected:number;issues:string[];fixedCount:number;movedCount:number;before:PalletRepackMeasures;after:PalletRepackMeasures;elapsedMs:number};
export {palletRepackFixedIds} from "./pallet-edit";
const pose=(b:PlacedBox)=>JSON.stringify([b.x,b.y,b.z,b.dx,b.dy,b.dz,b.orientation,b.orientationSigns]);
/** Match geometry to existing physical identities, keeping sparse kit numbers and item identities. */
function identify(candidate:PlacedBox[],old:PlacedBox[],fixed:Set<string>,p:PlacedPallet){
  const originals=new Map(old.map(b=>[b.id,b])),free=old.filter(b=>!fixed.has(b.id)),used=new Set<string>(),kitMap=new Map<string,number>();
  const oldKits=new Map<string,number[]>();
  for(const b of free)if(b.setCode){const numbers=oldKits.get(b.setCode)??[];if(!numbers.includes(b.setNumber!))numbers.push(b.setNumber!);oldKits.set(b.setCode,numbers);}
  for(const list of oldKits.values())list.sort((a,b)=>a-b);
  const mapped=candidate.map(b=>{
    if(fixed.has(b.id)){const original=originals.get(b.id)!;used.add(original.id);return original;}
    let kit:number|undefined;
    if(b.setCode){const key=`${b.setCode}/${b.setNumber}`;if(!kitMap.has(key)){const n=oldKits.get(b.setCode)?.shift();if(n===undefined)throw Error("Incomplete local kit mapping");kitMap.set(key,n);}kit=kitMap.get(key);}
    const original=free.find(a=>!used.has(a.id)&&a.productId===b.productId&&a.setCode===b.setCode&&(!b.setCode||a.setNumber===kit));
    if(!original)throw Error("Incomplete local carton mapping");used.add(original.id);
    const world=palletWorldBox({...b,z:b.z-p.dz},p);
    return {...original,x:world.x,y:world.y,z:world.z,dx:world.dx,dy:world.dy,dz:world.dz,orientation:world.orientation,orientationSigns:world.orientationSigns};
  });
  if(used.size!==old.length||mapped.length!==old.length)throw Error("Local repacking lost cargo");
  return mapped;
}

/** Search in a worker; returns a preview only. Applying must run the shared contents transaction again. */
export function repackPalletContents(plan:PackingResult,products:ProductInput[],id:string):PalletRepackResult{
  const started=performance.now(),p=plan.pallets?.find(p=>p.id===id);
  if(!plan.palletization||!p||plan.mode!=="mixed"||!plan.validation.valid)throw Error("局部重排需要有效预打托方案 / Local repacking requires a valid prebuilt pallet plan");
  if(p.locked)throw Error("请先解除整托锁定 / Unlock this pallet first");
  const cargo=plan.placements.filter(b=>b.palletIds?.length===1&&b.palletIds[0]===id);
  if(!cargo.length)throw Error("本托没有货物，请先从余量添加 / This pallet is empty; add cargo from the pool first");
  if(cargo.length>MAX_LOCAL_REPACK_CARTONS)throw Error("单托局部重排最多 160 箱 / Local repacking is limited to 160 cartons per pallet");
  const productIds=new Set(cargo.map(b=>b.productId));
  if(products.filter(q=>productIds.has(q.id)).some(q=>cargoShapeOf(q)!=="box"||q.solidModel))throw Error("局部重排首阶段仅支持普通长方体箱规 / This repacking stage supports rectangular cartons only");
  if(auditPackingResult(plan,products).hasErrors)throw Error("方案与当前订单不一致 / Plan and order data disagree");
  // Revalidate even a no-change result against current order, specification and geometry.
  const checked=restorePackingSnapshot({workflow:plan.workflow,mode:plan.mode,strategy:plan.strategy,palletBuild:plan.palletBuild,container:plan.container,clearance:plan.clearance,loadingRules:plan.loadingRules,products},plan);
  if(checked.placements.length!==plan.placements.length)throw Error("方案与当前订单不一致 / Plan and order data disagree");
  const fixed=palletRepackFixedIds(cargo,products),before=palletContentMeasures(p,cargo);
  const report:PalletRepackResult={sourceKey:palletContentsSourceKey(plan,products,id),positions:cargo,improved:false,palletId:id,attempts:0,feasible:0,rejected:0,issues:[],fixedCount:fixed.size,movedCount:0,before,after:before,elapsedMs:0};
  const reject=(message:string)=>{report.rejected++;if(report.issues.length<3&&!report.issues.includes(message))report.issues.push(message);};
  if(fixed.size===cargo.length){report.elapsedMs=performance.now()-started;return report;}
  const c=specificationForPallet(plan.palletization,p).config;
  const counts=new Map<string,number>();cargo.forEach(b=>counts.set(b.productId,(counts.get(b.productId)??0)+1));
  const quantities=products.filter(q=>productIds.has(q.id)).map(q=>({...q,quantity:counts.get(q.id)!}));
  const height=p.dz+before.cargoTopMm;
  const {base,container,products:localProducts}=palletSearchFrame(p,c,quantities,plan.strategy,height,c.weight+c.maxLoad);
  const fixedCargo=rebuildPlacementLayers(cargo.map(b=>{const local=palletLocalBox(b,p);return {...local,z:local.z+p.dz,palletIds:[base.id]};}),[base],localProducts,plan.loadingRules,container).filter(b=>fixed.has(b.id));
  for(let pass=0;pass<LOCAL_REPACK_PASSES;pass++){
    if(pass>0&&performance.now()-started>4000)break;
    report.attempts++;
    const candidate=searchPalletContents({palletBuildStage:true,mode:"mixed",strategy:plan.strategy,clearance:0,container,loadingRules:{...DEFAULT_LOADING_RULES,...plan.loadingRules,layout:"layers"},products:localProducts},base,fixedCargo,pass);
    if(candidate.length!==cargo.length){reject("未找到保持本托全部箱数的候选，原方案保留 / No full-quantity candidate found; original layout retained");continue;}
    try{
      const positions=identify(candidate,cargo,fixed,p),after=palletContentMeasures(p,positions);
      if(!betterPalletContent(after,report.after))continue;
      const result=editPalletContents(plan,products,id,{type:"repack",positions,sourceKey:report.sourceKey});
      report.feasible++;report.positions=result.placements.filter(b=>b.palletIds?.[0]===id);report.after=after;report.improved=true;
    }catch(e){reject(e instanceof Error?e.message:String(e));/* Never trim a failed carton or kit. */}
  }
  report.movedCount=report.positions.filter(b=>pose(b)!==pose(cargo.find(a=>a.id===b.id)!)).length;
  report.elapsedMs=performance.now()-started;
  return report;
}
