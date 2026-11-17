import {palletEnvelopeTop} from "./deck-support";
import {packagingGroupKey} from "./packaging-choice";
import {editPalletContents,palletCartonPose,palletConsolidationUnits,palletContentsSourceKey,palletRepackFixedIds,palletWorldBox,selectedConsolidationUnits,type PalletConsolidationEdit,type PalletConsolidationMove} from "./pallet-edit";
import {matchPalletCargo,palletStockGroups,palletStockOptions,searchPalletAdditions} from "./pallet-search-frame";
import {MAX_CARTONS_PER_PALLET,specificationForPallet} from "./pallet-specifications";
import {auditPackingResult} from "./result-audit";
import type {PackingResult,PlacedBox,PlacedPallet,ProductInput} from "./types";

const SEARCH_BUDGET_MS=5500;
const SEARCH_TRIALS=24;

type SelectedUnit=ReturnType<typeof selectedConsolidationUnits>[number];
type UnitChange={id:string;before:number;after:number;grossKg:number;heightMm:number};
type ConsolidationCandidate={edit:PalletConsolidationEdit;units:UnitChange[];tareSavedKg:number;kitsMoved:number};
export type PalletConsolidationResult={candidate:ConsolidationCandidate|null;issues:string[];reason?:"locked-cargo"|"no-fit";budgetReached:boolean};

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

/** Refit the selected units only, validating a complete one-pallet reduction before offering adoption. */
export function consolidatePalletContents(plan:PackingResult,products:ProductInput[],id:string,palletIds:string[]):PalletConsolidationResult {
  const started=performance.now();
  if(!plan.palletization||plan.mode!=="mixed"||!plan.validation.valid||auditPackingResult(plan,products).hasErrors)throw Error("联合重排需要与订单一致的有效打托方案 / Consolidation requires a valid pallet plan matching the order");
  const units=selectedConsolidationUnits(plan,id,palletIds);
  const donors=units.filter(unit=>unit.cargo.every(box=>!box.locked)).sort((a,b)=>a.cargo.length-b.cargo.length||b.pallet.z-a.pallet.z||a.pallet.id.localeCompare(b.pallet.id));
  const issues:string[]=[];
  if(!donors.length)return {candidate:null,issues,reason:"locked-cargo",budgetReached:false};
  const pins=new Set(units.flatMap(unit=>[...palletRepackFixedIds(unit.cargo,products)]));
  const sourceKey=palletContentsSourceKey(plan,products,id);
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
      const edit:PalletConsolidationEdit={type:"consolidate",sourceKey,palletIds,releaseId:donor.pallet.id,moves};
      const result=editPalletContents(plan,products,id,edit);
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
