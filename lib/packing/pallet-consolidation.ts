import {bodyVolumeRatio} from "./cargo-body";
import {deckSupportMass,palletEnvelopeTop} from "./deck-support";
import {packagingInterior} from "./packaging";
import {packagingGroupKey} from "./packaging-choice";
import {editPalletContents,MAX_CONSOLIDATION_CARTONS,MAX_CONSOLIDATION_PALLETS,MAX_ORDER_RELEASES,palletCartonPose,palletConsolidationUnits,palletContentsSourceKey,palletRepackFixedIds,palletWorldBox,selectedConsolidationUnits,type PalletConsolidationEdit,type PalletConsolidationMove,type PalletConsolidationStep,type PalletOrderConsolidationEdit} from "./pallet-edit";
import {matchPalletCargo,palletStockGroups,palletStockOptions,searchPalletAdditions} from "./pallet-search-frame";
import {MAX_CARTONS_PER_PALLET,specificationForPallet} from "./pallet-specifications";
import {auditPackingResult} from "./result-audit";
import type {PackingResult,PlacedBox,PlacedPallet,ProductInput} from "./types";

const SEARCH_BUDGET_MS=5500;
const SEARCH_TRIALS=24;
const ORDER_BUDGET_MS=15000;
const ORDER_GROUP_TRIALS=80;
const EPS=.0001;

type SelectedUnit=ReturnType<typeof selectedConsolidationUnits>[number];
type UnitChange={id:string;before:number;after:number;grossKg:number;heightMm:number};
type ConsolidationCandidate={edit:PalletConsolidationEdit;units:UnitChange[];tareSavedKg:number;kitsMoved:number};
export type PalletConsolidationResult={candidate:ConsolidationCandidate|null;issues:string[];reason?:"locked-cargo"|"no-fit";budgetReached:boolean};
type OrderDiagnostic = "compatibility"|"count"|"payload"|"space"|"layout";
type OrderCandidate={
  edit:PalletOrderConsolidationEdit;units:UnitChange[];beforePallets:number;afterPallets:number;
  cartons:number;changedCartons:number;tareSavedKg:number;
};
export type PalletOrderConsolidationResult={candidate:OrderCandidate|null;protectedPallets:number;trials:number;budgetReached:boolean;diagnostics?: Partial<Record<OrderDiagnostic,number>>};

function findMoves(plan:PackingResult,products:ProductInput[],donor:SelectedUnit,receivers:SelectedUnit[],pinned:ReadonlySet<string>,keepReceivers:boolean,pass:number,expired:()=>boolean){
  const productMap=new Map(products.map(p=>[p.id,p]));
  const fixed=receivers.map(unit=>({...unit,fixed:keepReceivers?unit.cargo:unit.cargo.filter(b=>pinned.has(b.id))}));
  let remaining=[...donor.cargo,...(keepReceivers?[]:receivers.flatMap(unit=>unit.cargo.filter(b=>!pinned.has(b.id))))];
  const originals=new Map(remaining.map(b=>[b.id,b]));
  const moves:PalletConsolidationMove[]=[];
  // Try a different receipt order and packing pass to avoid committing one greedy split.
  const ordered=[...fixed].sort((a,b)=>b.fixed.length-a.fixed.length||a.pallet.id.localeCompare(b.pallet.id));
  if(pass%2===1)ordered.reverse();
  for(const {pallet,fixed:anchors} of ordered){
    if(!remaining.length)break;
    if(expired())return null;
    const spec=specificationForPallet(plan.palletization!,pallet);
    const slots=Math.min(remaining.length,(spec.cartonLimit??MAX_CARTONS_PER_PALLET)-anchors.length);
    if(slots<=0)continue;
    const stock=new Map<string,number>();
    for(const box of remaining)stock.set(box.productId,(stock.get(box.productId)??0)+1);
    const single=plan.palletization!.mix==="single";
    const currentGroup=single&&anchors.length?packagingGroupKey(productMap.get(anchors[0].productId)!):undefined;
    const groups=palletStockGroups(products,stock,spec.productIds,currentGroup,slots);
    if(!groups.length)continue;
    const options=palletStockOptions(groups,single,slots);
    // Existing cartons are reassigned, so the vehicle's gross load can only decrease by the released tare.
    const positions=searchPalletAdditions(plan,pallet,products,anchors,options[pass%options.length],slots,pass,{spareKg:Infinity,removedId:donor.pallet.id});
    const assigned=matchPalletCargo(positions,remaining);
    const used=new Set(assigned.map(box=>box.id));
    remaining=remaining.filter(box=>!used.has(box.id));
    for(const box of assigned){
      const original=originals.get(box.id)!;
      const world=palletWorldBox(box,pallet);
      if(original.palletIds?.[0]!==pallet.id||JSON.stringify(palletCartonPose(original))!==JSON.stringify(palletCartonPose(world)))moves.push({cartonId:box.id,targetId:pallet.id,pose:palletCartonPose(box)});
    }
  }
  return remaining.length?null:moves;
}

function describeUnit(pallet:PlacedPallet,cargo:PlacedBox[]){
  return {grossKg:pallet.weight+cargo.reduce((sum,b)=>sum+b.weight,0),heightMm:palletEnvelopeTop(pallet,cargo)-pallet.z};
}

function requireValidPalletPlan(plan:PackingResult,products:ProductInput[]){
  if(!plan.palletization||plan.mode!=="mixed"||!plan.validation.valid||auditPackingResult(plan,products).hasErrors){
    throw Error("联合重排需要与订单一致的有效打托方案 / Consolidation requires a valid pallet plan matching the order");
  }
}

function validateRelease(plan:PackingResult,products:ProductInput[],id:string,step:PalletConsolidationStep){
  const edit:PalletConsolidationEdit={...step,type:"consolidate",sourceKey:palletContentsSourceKey(plan,products,id)};
  return {edit,result:editPalletContents(plan,products,id,edit)};
}

/** Refit the selected units only, validating a complete one-pallet reduction before offering adoption. */
export function consolidatePalletContents(plan:PackingResult,products:ProductInput[],id:string,palletIds:string[]):PalletConsolidationResult {
  const started=performance.now();
  requireValidPalletPlan(plan,products);
  const units=selectedConsolidationUnits(plan,id,palletIds);
  const donors=units.filter(unit=>unit.cargo.every(box=>!box.locked)).sort((a,b)=>a.cargo.length-b.cargo.length||b.pallet.z-a.pallet.z||a.pallet.id.localeCompare(b.pallet.id));
  const issues:string[]=[];
  if(!donors.length)return {candidate:null,issues,reason:"locked-cargo",budgetReached:false};
  const pins=new Set(units.flatMap(unit=>[...palletRepackFixedIds(unit.cargo,products)]));
  const expired=()=>performance.now()-started>SEARCH_BUDGET_MS;
  const kitById=new Map(units.flatMap(unit=>unit.cargo.filter(b=>b.setCode).map(b=>[b.id,JSON.stringify([b.setCode,b.setNumber])] as const)));
  let trials=0;
  for(let pass=0;pass<4;pass++)for(const keepReceivers of [true,false])for(const donor of donors){
    if(trials>=SEARCH_TRIALS||expired())return {candidate:null,issues,reason:"no-fit",budgetReached:true};
    trials++;
    const receivers=units.filter(unit=>unit!==donor);
    try{
      const moves=findMoves(plan,products,donor,receivers,pins,keepReceivers,pass,expired);
      if(!moves)continue;
      const {edit,result}=validateRelease(plan,products,id,{palletIds,releaseId:donor.pallet.id,moves});
      const resultUnits=new Map(palletConsolidationUnits(result).map(unit=>[unit.pallet.id,unit.cargo]));
      const changes=units.map(({pallet,cargo})=>{
        const after=resultUnits.get(pallet.id);
        return {id:pallet.id,before:cargo.length,after:after?.length??0,...(after?describeUnit(pallet,after):{grossKg:0,heightMm:0})};
      });
      const movedKits=new Set(moves.flatMap(move=>{const kit=kitById.get(move.cartonId);return kit?[kit]:[];}));
      return {candidate:{edit,units:changes,tareSavedKg:donor.pallet.weight,kitsMoved:movedKits.size},issues,budgetReached:false};
    }catch(error){
      const message=error instanceof Error?error.message:String(error);
      if(issues.length<3&&!issues.includes(message))issues.push(message);
    }
  }
  return {candidate:null,issues,reason:"no-fit",budgetReached:expired()};
}

function measureOrderUnits(plan:PackingResult,products:ProductInput[]){
  const byProduct=new Map(products.map(p=>[p.id,{group:packagingGroupKey(p),volume:p.length*p.width*p.height*bodyVolumeRatio(p)}]));
  const door=plan.palletization!.only||plan.container.loadingAccess==="open"?Infinity:plan.container.doorHeight-plan.clearance;
  return palletConsolidationUnits(plan).filter(({pallet})=>!pallet.locked&&!pallet.measuredEnvelope).map(unit=>{
    const {pallet,cargo}=unit;
    const spec=specificationForPallet(plan.palletization!,pallet);
    const {length,width,lid}=packagingInterior(spec.config);
    const height=Math.min((spec.config.maxCargoHeight||Infinity),door-pallet.dz-lid,plan.container.height-plan.clearance-pallet.z-pallet.dz-lid);
    const kg=cargo.reduce((sum,box)=>sum+box.weight,0);
    const volume=cargo.reduce((sum,box)=>sum+byProduct.get(box.productId)!.volume,0);
    const productIds=new Set(cargo.map(box=>box.productId));
    const currentGroup=plan.palletization!.mix==="single"&&cargo.length?byProduct.get(cargo[0].productId)!.group:undefined;
    const allowed=spec.productIds?new Set(spec.productIds):null;
    return {...unit,kg,volume,productIds,
      canReceive:(productId:string)=>(!allowed||allowed.has(productId))&&(!currentGroup||byProduct.get(productId)!.group===currentGroup),
      freeCartons:(spec.cartonLimit??MAX_CARTONS_PER_PALLET)-cargo.length,
      freeKg:pallet.maxLoad-deckSupportMass(pallet)-kg,
      freeVolume:length*width*Math.max(0,height)-volume};
  });
}

type OrderUnit=ReturnType<typeof measureOrderUnits>[number];

function canFitGroup(donor:OrderUnit,receivers:OrderUnit[]){
  const totals=receivers.reduce((sum,receiver)=>({
    cartons:sum.cartons+receiver.freeCartons,kg:sum.kg+receiver.freeKg,volume:sum.volume+receiver.freeVolume,
  }),{cartons:0,kg:0,volume:0});
  return donor.cargo.length<=totals.cartons&&donor.kg<=totals.kg+EPS&&
    donor.volume<=totals.volume+Math.max(1,donor.volume*1e-8)&&
    [...donor.productIds].every(productId=>receivers.some(unit=>unit.canReceive(productId)));
}

/** Relaxed aggregate bounds show which donors are ruled out before exact layout trials. */
function orderDiagnostics(units:OrderUnit[]) {
  const diagnostics: Partial<Record<OrderDiagnostic,number>>={};
  for(const donor of units){
    if(donor.cargo.length>MAX_CONSOLIDATION_CARTONS||donor.cargo.some(b=>b.locked))continue;
    const compatible=units.filter(receiver=>receiver!==donor&&(donor.cargo.length===0||[...donor.productIds].some(receiver.canReceive)));
    const receivers=compatible.filter(r=>r.freeCartons>0);
    const capacity=receivers.reduce((sum,r)=>({
      count:sum.count+r.freeCartons,
      kg:sum.kg+Math.max(0,r.freeKg),
      volume:sum.volume+Math.max(0,r.freeVolume),
    }),{count:0,kg:0,volume:0});
    let reason:OrderDiagnostic="layout";
    if(!compatible.length||[...donor.productIds].some(id=>!compatible.some(r=>r.canReceive(id))))reason="compatibility";
    else if(capacity.count<donor.cargo.length)reason="count";
    else if(capacity.kg+EPS<donor.kg)reason="payload";
    else if(capacity.volume+Math.max(1,donor.volume*1e-8)<donor.volume)reason="space";
    diagnostics[reason]=(diagnostics[reason]??0)+1;
  }
  return diagnostics;
}

function* orderGroups(donor:OrderUnit,units:OrderUnit[],expired:()=>boolean){
  const receivers=units.filter(unit=>unit!==donor&&(!donor.cargo.length||unit.freeCartons>0)&&
    unit.cargo.length+donor.cargo.length<=MAX_CONSOLIDATION_CARTONS&&
    (!donor.cargo.length||[...donor.productIds].some(unit.canReceive)));
  receivers.sort((a,b)=>b.freeVolume-a.freeVolume||b.freeCartons-a.freeCartons||b.freeKg-a.freeKg||a.pallet.id.localeCompare(b.pallet.id));
  for(const receiver of receivers){
    if(expired())return;
    if(canFitGroup(donor,[receiver]))yield [receiver];
  }
  // Probe different small groups as well as single receivers so tails can split at kit boundaries.
  const tested=new Set<string>();
  for(const first of receivers.slice(0,6)){
    const group=[first];
    let cartons=donor.cargo.length+first.cargo.length;
    for(const next of receivers){
      if(expired())return;
      if(next===first||cartons+next.cargo.length>MAX_CONSOLIDATION_CARTONS)continue;
      group.push(next);
      cartons+=next.cargo.length;
      const key=JSON.stringify(group.map(unit=>unit.pallet.id).sort());
      if(!tested.has(key)&&canFitGroup(donor,group)){
        tested.add(key);
        yield [...group];
      }
      if(group.length===MAX_CONSOLIDATION_PALLETS-1)break;
    }
  }
}

/** Search eligible tails order-wide, retaining each independently validated reduction in the preview. */
export function consolidatePalletOrder(plan:PackingResult,products:ProductInput[]):PalletOrderConsolidationResult{
  const started=performance.now();
  requireValidPalletPlan(plan,products);
  const initial=palletConsolidationUnits(plan);
  const protectedPallets=initial.filter(({pallet})=>pallet.locked||pallet.measuredEnvelope).length;
  const steps:PalletConsolidationStep[]=[];
  let current=plan,trials=0;
  const expired=()=>performance.now()-started>=ORDER_BUDGET_MS;
  const atLimit=()=>expired()||trials>=ORDER_GROUP_TRIALS||steps.length>=MAX_ORDER_RELEASES;
  while(!atLimit()){
    const units=measureOrderUnits(current,products);
    const donors=units.filter(unit=>unit.cargo.length<=MAX_CONSOLIDATION_CARTONS&&unit.cargo.every(b=>!b.locked))
      .sort((a,b)=>a.cargo.length-b.cargo.length||b.pallet.z-a.pallet.z||b.pallet.weight-a.pallet.weight||a.pallet.id.localeCompare(b.pallet.id));
    const before=current;
    search:for(const donor of donors){
      if(atLimit())break search;
      for(const receivers of orderGroups(donor,units,atLimit)){
        trials++;
        const pinned=new Set(receivers.flatMap(unit=>[...palletRepackFixedIds(unit.cargo,products)]));
        for(const [pass,keepReceivers] of [[0,true],[0,false],[1,true],[1,false]] as const){
          if(expired())break search;
          try{
            const moves=findMoves(current,products,donor,receivers,pinned,keepReceivers,pass,expired);
            if(!moves)continue;
            const releaseId=donor.pallet.id;
            const step={palletIds:[releaseId,...receivers.map(unit=>unit.pallet.id)],releaseId,moves};
            current=validateRelease(current,products,releaseId,step).result;
            steps.push(step);
            break search;
          }catch{
            // A locally fitting group can still violate the complete plan's supports or load limits.
          }
        }
      }
    }
    if(current===before)break;
  }
  const summary={protectedPallets,trials,budgetReached:atLimit()};
  if(!steps.length)return {...summary,candidate:null,diagnostics:orderDiagnostics(measureOrderUnits(plan,products))};
  const affected=new Set(steps.flatMap(step=>step.palletIds));
  const remaining=new Map(palletConsolidationUnits(current).map(unit=>[unit.pallet.id,unit]));
  const units=initial.filter(({pallet})=>affected.has(pallet.id)).map(({pallet,cargo})=>{
    const next=remaining.get(pallet.id);
    return {id:pallet.id,before:cargo.length,after:next?.cargo.length??0,...(next?describeUnit(next.pallet,next.cargo):{grossKg:0,heightMm:0})};
  });
  return {...summary,candidate:{
    edit:{sourceKey:palletContentsSourceKey(plan,products,null),steps},units,beforePallets:initial.length,afterPallets:remaining.size,
    cartons:current.metrics.loadedCount,changedCartons:new Set(steps.flatMap(step=>step.moves.map(move=>move.cartonId))).size,
    tareSavedKg:steps.reduce((sum,step)=>sum+initial.find(unit=>unit.pallet.id===step.releaseId)!.pallet.weight,0),
  }};
}
