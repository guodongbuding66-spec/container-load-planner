import {containerAccessoryWeight,accessoryProductErrors} from "./container-accessories";
import {bodiesOverlap} from "./cargo-body";
import {availablePackingVolume,siteExclusionBoxes} from "./site-exclusions";
import { planCrateUnits, crateEvidence } from "./crate-bearing";
import { bodyVolumeRatio, validOrientationSigns } from "./cargo-body";
import { bearingLimit } from "./bearing";
import { ORIENTATION_CODES } from "./loading-rules";
import { collectSetGroups, normalizedSetCode, normalizedUnitsPerSet } from "./set-utils";
import { cargoShapeOf, shapeDetails } from "./cargo-shape";
import { getOrientations, MAX_VISIBLE_PLACEMENTS } from "./engine";
import { packagingReservedVolume, parsePackaging, placedPackagingParts } from "./packaging";
import { validatePalletizedCargo } from "./prebuilt-pallets";
import { independentPalletVolume } from "./pallet-specifications";
import type { PackingResult, ProductInput } from "./types";

export type AuditState = "pass" | "fail" | "unverified";
export type AuditCheckId = "records" | "products" | "dimensions" | "quantities" | "weight" | "volume" | "capacity" | "packaging" | "kits" | "strength";
export type AuditCheck = { id: AuditCheckId; state: AuditState; message: [string, string]; items: string[] };
export type ResultAudit = { checks: AuditCheck[]; hasErrors: boolean; completeCoordinates: boolean; passed: number; failed: number; unverified: number };

const EPS = .0001;
const near = (a: number, b: number) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a-b) <= .00001 + Math.max(Math.abs(a),Math.abs(b)) * 1e-9;
function canonical(value: unknown): string {
  if (value === undefined) return "";
  if (Array.isArray(value)) return "["+value.map(canonical).join(",")+"]";
  if (value && typeof value === "object") return "{"+Object.entries(value).filter(([,v])=>v!==undefined).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>JSON.stringify(k)+":"+canonical(v)).join(",")+"}";
  return JSON.stringify(value) ?? "";
}

/** Linear bookkeeping checks plus the existing rigid-unit validator; never treats missing strength data as verified. */
export function auditPackingResult(plan: PackingResult, products?: readonly ProductInput[]): ResultAudit {
  const checks: AuditCheck[] = [], boxes=plan.placements, pallets=plan.pallets??[], totals=plan.metrics;
  const full=totals.loadedCount===boxes.length;
  const bounded=plan.mode==="single"&&boxes.length===MAX_VISIBLE_PLACEMENTS&&totals.loadedCount>boxes.length;
  const add=(id:AuditCheckId,state:AuditState,zh:string,en:string,items:string[]=[])=>checks.push({id,state,message:[zh,en],items:[...new Set(items)].slice(0,8)});
  const completeState:AuditState=full?"pass":bounded?"unverified":"fail";
  const productMap=new Map((products??[]).map(p=>[p.id,p])), summaries=new Map(plan.summaries.map(s=>[s.productId,s]));
  const counts=new Map<string,number>();
  for(const b of boxes)counts.set(b.productId,(counts.get(b.productId)??0)+1);
  const allIds=[...boxes.map(b=>b.id),...pallets.map(p=>p.id)];
  const records=allIds.every(id=>typeof id==="string"&&id.trim().length>0)&&new Set(allIds).size===allIds.length&&summaries.size===plan.summaries.length&&(!products||productMap.size===products.length);
  add("records",records?"pass":"fail",records?"箱位、托盘和产品标识没有重复。":"发现缺失或重复的追踪标识。",records?"Placement, pallet and product identifiers are unique.":"Missing or duplicate tracking identifiers were found.");

  let sourceValid=true, volumeValid=true;
  const orientations=new Map<string,ReturnType<typeof getOrientations>>();
  const stale:string[]=[], volumes=new Map<string,number>();
  if(products){
    for(const p of products){
      try{
        const v=p.length*p.width*p.height*bodyVolumeRatio(p);volumes.set(p.id,v);
        orientations.set(p.id,getOrientations(p,false));
        if(!Number.isFinite(v)||v<=0||!Number.isFinite(p.weight)||p.weight<0)volumeValid=false;
        if(canonical(shapeDetails(p))!==canonical(plan.cargoDetails?.[p.id]??{}))stale.push(p.sku);
      }catch{volumeValid=false;stale.push(p.sku);}
    }
    for(const b of boxes){const p=productMap.get(b.productId);if(!p||p.sku!==b.sku||!near(p.weight,b.weight))stale.push(b.sku);}
    for(const s of plan.summaries){const p=productMap.get(s.productId);if(!p||p.sku!==s.sku)stale.push(s.sku);}
    stale.push(...accessoryProductErrors(plan.container,new Set(productMap.keys())));
    sourceValid=stale.length===0&&plan.summaries.length===products.length;
  }
  add("products",products?(sourceValid?"pass":"fail"):"unverified",products?(sourceValid?"箱位与当前 SKU、单箱重量和外形资料一致。":"箱位或外形资料与当前产品不一致。"):"缺少原始产品资料，未核对 SKU 与外形来源。",products?(sourceValid?"Placements match the current SKUs, unit weights and shape definitions.":"Placements or shape metadata differ from the current products."):"Original product inputs were not provided; SKU and shape provenance are unverified.",stale);

  const l=plan.container.length-plan.clearance*2,w=plan.container.width-plan.clearance*2,h=plan.container.height-plan.clearance;
  const outside:string[]=[];
  let excluded:ReturnType<typeof siteExclusionBoxes>=[];try{excluded=siteExclusionBoxes(plan.container,plan.clearance);}catch{outside.push("site-exclusions");}
  for(const b of boxes){
    const finite=[b.x,b.y,b.z,b.dx,b.dy,b.dz,b.weight].every(Number.isFinite);
    let valid=finite&&b.dx>0&&b.dy>0&&b.dz>0&&b.weight>=0&&b.x>=-EPS&&b.y>=-EPS&&b.z>=-EPS&&b.x+b.dx<=l+EPS&&b.y+b.dy<=w+EPS&&b.z+b.dz<=h+EPS&&ORIENTATION_CODES.some(code=>code===b.orientation)&&validOrientationSigns(b.orientation,b.orientationSigns);
    if(products){const p=productMap.get(b.productId);valid=valid&&!!p&&(orientations.get(p!.id)??[]).some(o=>near(o.dx,b.dx)&&near(o.dy,b.dy)&&near(o.dz,b.dz)&&((!p!.allowedOrientations&&cargoShapeOf(p!)==="box")||o.label===b.orientation));}
    if(valid&&excluded.some(z=>bodiesOverlap(b,z,productMap.get(b.productId)??plan.cargoDetails?.[b.productId],undefined)))valid=false;
    if(!valid)outside.push(b.id);
  }
  for(const p of pallets)if(![p.x,p.y,p.z,p.dx,p.dy,p.dz,p.weight].every(Number.isFinite)||p.dx<=0||p.dy<=0||p.dz<=0||p.weight<0||p.x< -EPS||p.y< -EPS||p.z< -EPS||p.x+p.dx>l+EPS||p.y+p.dy>w+EPS||p.z+(p.enclosureHeight??p.dz)>h+EPS)outside.push(p.id);
  add("dimensions",outside.length?"fail":completeState,outside.length?"发现无效尺寸、朝向或越界坐标。":full?"已记录箱位的尺寸、朝向与有效边界一致。":"仅核对已保存的箱位，尚未保存完整坐标。",outside.length?"Invalid dimensions, orientations or out-of-bounds positions were found.":full?"Recorded dimensions, orientations and usable bounds agree.":"Only saved placements were checked; the coordinate set is incomplete.",outside);

  let quantities=Number.isInteger(totals.loadedCount)&&totals.loadedCount>=0&&(full||bounded)&&near(totals.loadedCount,plan.summaries.reduce((n,s)=>n+s.loaded,0))&&near(totals.requestedCount,plan.summaries.reduce((n,s)=>n+s.requested,0));
  const countErrors:string[]=[];
  for(const s of plan.summaries){
    const n=counts.get(s.productId)??0,p=productMap.get(s.productId);
    if(![s.loaded,s.requested,s.unloaded].every(v=>Number.isInteger(v)&&v>=0)||s.loaded>s.requested||s.unloaded!==Math.max(0,s.requested-s.loaded)||(full?s.loaded!==n:s.loaded<n)||products&&plan.mode==="mixed"&&s.requested!==p?.quantity)countErrors.push(s.sku);
  }
  if([...counts.keys()].some(id=>!summaries.has(id)))quantities=false;
  quantities&&=countErrors.length===0;
  add("quantities",!quantities?"fail":completeState,!quantities?"箱位、SKU 明细和方案总箱数不一致。":full?"箱位、已装、未装和订单总数一致。":"汇总数量一致；部分容量结果尚无完整箱位。",!quantities?"Placements, SKU summaries and total counts disagree.":full?"Placements, loaded, unmet and requested counts agree.":"Summary counts agree; some capacity results have no complete coordinate set.",countErrors);

  let cargoWeight=0,cargoVolume=0;
  for(const s of plan.summaries){const p=productMap.get(s.productId);cargoWeight+=products&&p?s.loaded*p.weight:s.loadedWeight;cargoVolume+=products&&p?s.loaded*(volumes.get(p.id)??NaN):s.loadedVolume;}
  const tare=pallets.reduce((n,p)=>n+p.weight,0), recordedWeight=boxes.reduce((n,b)=>n+b.weight,0);
  const weight=near(totals.grossWeight,cargoWeight+tare+containerAccessoryWeight(plan.container))&&(!full||near(cargoWeight,recordedWeight))&&plan.summaries.every(s=>!products||near(s.loadedWeight,s.loaded*(productMap.get(s.productId)?.weight??NaN)));
  add("weight",weight?completeState:"fail",weight?"货物、包装自重与整柜附件计划重量分别核对，各计一次。":"货物重量、包装自重或总毛重不一致。",weight?"Cargo, packaging tare and container accessory planned mass agree; each is counted once.":"Cargo mass, packaging tare or total gross weight disagree.");

  let reserved=NaN;
  try{reserved=pallets.reduce((n,p)=>n+packagingReservedVolume(p),0);}catch{}
  const volume=volumeValid&&near(totals.loadedVolume,cargoVolume+reserved)&&plan.summaries.every(s=>!products||near(s.loadedVolume,s.loaded*(volumes.get(s.productId)??NaN)));
  add("volume",volume?products?completeState:"unverified":"fail",volume?"占用体积与 SKU 体积、底座及围护预留体积一致。":"货物体积、包装预留或占用体积不一致。",volume?"Occupied volume agrees with SKU volume and reserved base/enclosure volume.":"Cargo volume, reserved packaging or total occupied volume disagree.");

  let expectedVolume=NaN;
  try{expectedVolume=plan.palletization?.only?independentPalletVolume(plan.palletization,pallets):availablePackingVolume(plan.container,plan.clearance);}catch{}
  const capacity=expectedVolume>0&&plan.container.maxWeight>0&&near(totals.effectiveVolume,expectedVolume)&&near(totals.volumeUtilization,totals.loadedVolume/expectedVolume)&&near(totals.weightUtilization,totals.grossWeight/plan.container.maxWeight)&&totals.loadedVolume<=expectedVolume+.00001+expectedVolume*1e-9&&totals.grossWeight<=plan.container.maxWeight+.00001;
  add("capacity",capacity?"pass":"fail",capacity?"利用率、剩余容量与当前模式的统计基准一致。":"利用率或容量基准不一致，或已经超出容量。",capacity?"Utilization and capacity use the correct denominator for this workflow.":"Utilization or capacity denominators disagree, or capacity is exceeded.");

  const packageErrors:string[]=[];
  try{
    if(plan.palletization)packageErrors.push(...validatePalletizedCargo(boxes,pallets,plan.container,plan.clearance,plan.palletization,products));
    for(const p of pallets){
      if(p.packaging)parsePackaging(p.packaging);
      for(const b of placedPackagingParts(p))if(![b.x,b.y,b.z,b.dx,b.dy,b.dz].every(Number.isFinite)||b.dx<=0||b.dy<=0||b.dz<=0||b.x<p.x-EPS||b.y<p.y-EPS||b.z<p.z-EPS||b.x+b.dx>p.x+p.dx+EPS||b.y+b.dy>p.y+p.dy+EPS||b.z+b.dz>p.z+(p.enclosureHeight??p.dz)+EPS){packageErrors.push(p.id);break;}
    }
  }catch{packageErrors.push("Invalid packaging specification");}
  add("packaging",packageErrors.length?"fail":completeState,packageErrors.length?"包装模型、净空或整托关联不一致。":pallets.length?"包装结构、外尺寸、围护净空和整托归属一致。":"当前方案没有额外底座或围护包装。",packageErrors.length?"Packaging geometry, interior clearance or unit membership disagree.":pallets.length?"Packaging parts, exterior dimensions, interior clearance and unit membership agree.":"This plan has no additional base or enclosure packaging.",packageErrors);

  const kits=new Map<string,Map<number,{counts:Map<string,number>;positions:Set<number>}>>(), kitIssues:string[]=[];
  const kitSummaries=new Map(plan.setSummaries.map(s=>[s.setCode,s]));
  const sourceKits=products?collectSetGroups([...products]):undefined;
  if(kitSummaries.size!==plan.setSummaries.length||sourceKits&&(sourceKits.size!==kitSummaries.size||[...sourceKits.keys()].some(code=>!kitSummaries.has(code))))kitIssues.push("Kit definitions");
  for(const b of boxes){
    const p=productMap.get(b.productId);
    if(products&&(p?normalizedSetCode(p):"")!==(b.setCode??""))kitIssues.push(b.id);
    if(!b.setCode)continue;
    const summary=kitSummaries.get(b.setCode);
    if(!summary||!Number.isInteger(b.setNumber)||(b.setNumber??0)<1||(!plan.palletization?.editRevision&&(b.setNumber??0)>summary.loadedSets)||!Number.isInteger(b.setItemNumber)||(b.setItemNumber??0)<1||(b.setItemNumber??0)>summary.cartonsPerSet){kitIssues.push(b.id);continue;}
    const sets=kits.get(b.setCode)??new Map<number,{counts:Map<string,number>;positions:Set<number>}>(),group=sets.get(b.setNumber!)??{counts:new Map<string,number>(),positions:new Set<number>()};
    if(group.positions.has(b.setItemNumber!))kitIssues.push(b.id);
    group.positions.add(b.setItemNumber!);group.counts.set(b.productId,(group.counts.get(b.productId)??0)+1);sets.set(b.setNumber!,group);kits.set(b.setCode,sets);
  }
  for(const s of plan.setSummaries){
    const sets=kits.get(s.setCode)??new Map(),group=sourceKits?.get(s.setCode),items=new Map(s.items.map(i=>[i.productId,i]));
    if(!s.items.length||items.size!==s.items.length||s.componentCount!==items.size||group&&(group.length!==items.size||group.some(p=>items.get(p.id)?.unitsPerSet!==normalizedUnitsPerSet(p))))kitIssues.push(s.setCode);
    const requested=s.items.map(i=>Math.floor(i.requestedQuantity/i.unitsPerSet)),loaded=s.items.map(i=>Math.floor(i.loadedQuantity/i.unitsPerSet));
    if(s.cartonsPerSet!==s.items.reduce((n,i)=>n+i.unitsPerSet,0)||s.requestedCartons!==s.items.reduce((n,i)=>n+i.requestedQuantity,0)||s.loadedCartons!==s.items.reduce((n,i)=>n+i.loadedQuantity,0)||s.requestedSets!==Math.min(...requested)||s.loadedSets!==Math.min(...loaded)||s.unloadedSets!==Math.max(0,s.requestedSets-s.loadedSets)||s.requestQuantitiesAligned!==(requested.every(n=>n===requested[0])&&s.items.every(i=>i.requestedQuantity%i.unitsPerSet===0)))kitIssues.push(s.setCode);
    for(const i of s.items){const summary=summaries.get(i.productId);if(!Number.isInteger(i.unitsPerSet)||i.unitsPerSet<1||!summary||i.sku!==summary.sku||i.loadedQuantity!==summary.loaded||i.requestedQuantity!==summary.requested)kitIssues.push(s.setCode);}
    if(full&&sets.size!==s.loadedSets)kitIssues.push(s.setCode);
    if(full)for(const {counts,positions} of sets.values())if(counts.size!==items.size||positions.size!==s.cartonsPerSet||s.items.some(i=>(counts.get(i.productId)??0)!==i.unitsPerSet))kitIssues.push(s.setCode);
  }
  add("kits",kitIssues.length?"fail":completeState,kitIssues.length?"套号、套内箱数与套装汇总不一致。":plan.setSummaries.length?"逐套组成箱数与套装汇总一致。":"当前方案没有多箱套装。",kitIssues.length?"Kit numbers, component counts and kit summaries disagree.":plan.setSummaries.length?"Per-kit component counts agree with the kit summaries.":"This plan contains no multi-carton kits.",kitIssues);

  const missing=products?[...new Set(boxes.filter(b=>{const p=productMap.get(b.productId);return p&&p.stackable&&bearingLimit(b,p)===undefined;}).map(b=>b.sku))]:[];
  const crateUnits=planCrateUnits(plan),reviewedCrates=crateUnits.filter(u=>crateEvidence(u.config).state==="ready").length;
  const crates=pallets.some(p=>p.packaging&&p.packaging.enclosure!=="none");
  add("strength",!products||missing.length||crates?"unverified":"pass",crates?`木箱额定资料已核对 ${reviewedCrates}/${crateUnits.length}；结构承托尚未接入主求解器，仍按单层布置。`:missing.length?"部分允许承托的 SKU 缺少额定上压资料。":products?"允许承托的 SKU 已填写承重资料；材料强度仍以实测为准。":"缺少原始产品承重资料。",crates?`Reviewed crate rating evidence: ${reviewedCrates}/${crateUnits.length}; structural support is not integrated into the main solver, so crates remain floor-only.`:missing.length?"Some load-bearing SKUs have no declared top-load rating.":products?"Load-bearing SKU ratings are provided; material strength still depends on measured data.":"Original bearing data was not provided.",missing);
  if(!boxes.length)for(const check of checks)if(check.state==="pass"&&check.id!=="records"&&check.id!=="products")check.state="unverified";
  const failed=checks.filter(c=>c.state==="fail").length,unverified=checks.filter(c=>c.state==="unverified").length;
  return {checks,hasErrors:failed>0,completeCoordinates:full,passed:checks.length-failed-unverified,failed,unverified};
}
