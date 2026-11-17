import {palletEnvelopeTop} from "./deck-support";
import {MAX_VISIBLE_PLACEMENTS} from "./engine";
import {packagingGroupKey} from "./packaging-choice";
import {editPalletContents,palletContentsSourceKey,palletOrderPool} from "./pallet-edit";
import {palletStockGroups,palletStockOptions,searchPalletAdditions} from "./pallet-search-frame";
import {MAX_CARTONS_PER_PALLET,specificationForPallet} from "./pallet-specifications";
import {auditPackingResult} from "./result-audit";
import type {PackingResult,PlacedBox,ProductInput} from "./types";

const REFILL_PASSES=4;
const REFILL_BUDGET_MS=4000;
const DEFAULT_REFILL_CARTONS=64;

export type PalletRefillResult={
  sourceKey:string;
  additions:PlacedBox[];
  kits:number;
  unitHeightMm:number;
  grossKg:number;
  reason?:"no-order-stock"|"pallet-full"|"placement-limit"|"no-eligible-stock"|"no-fit";
  issues:string[];
  batchLimitReached:boolean;
};

/** The solver inserts each kit consecutively; shrink a rejected candidate at a whole-kit boundary. */
function smallerPrefix(boxes:PlacedBox[]){
  let count=Math.floor(boxes.length/2);
  const next=boxes[count];
  while(count>0&&next.setCode&&boxes[count-1].setCode===next.setCode&&boxes[count-1].setNumber===next.setNumber)count--;
  return boxes.slice(0,count);
}

/** Search around fixed cargo. A preview is returned only after the full plan accepts the additions. */
export function refillPalletContents(plan:PackingResult,products:ProductInput[],id:string):PalletRefillResult {
  const started=performance.now();
  const pallet=plan.pallets?.find(p=>p.id===id),palletization=plan.palletization;
  if(!palletization||!pallet||!plan.validation.valid||plan.mode!=="mixed")throw Error("自动补货需要有效的预打托方案 / Refilling requires a valid prebuilt pallet plan");
  if(pallet.locked)throw Error("请先解除整托锁定 / Unlock this pallet first");
  if(pallet.measuredEnvelope)throw Error("本托已录入实测包络，暂不可自动补货 / Automatic refill is paused for this pallet’s measured envelope");
  if(auditPackingResult(plan,products).hasErrors)throw Error("方案与当前订单不一致，请重新计算 / Plan and order data disagree; recalculate first");

  const spec=specificationForPallet(palletization,pallet);
  const cargo=plan.placements.filter(b=>b.palletIds?.[0]===id);
  const cargoKg=cargo.reduce((sum,b)=>sum+b.weight,0);
  const report:PalletRefillResult={sourceKey:palletContentsSourceKey(plan,products,id),additions:[],kits:0,
    unitHeightMm:palletEnvelopeTop(pallet,cargo)-pallet.z,grossKg:pallet.weight+cargoKg,issues:[],batchLimitReached:false};
  const pool=palletOrderPool(plan,products);
  if(pool.every(row=>row.remaining<=0))return {...report,reason:"no-order-stock"};
  if(spec.cartonLimit!==undefined&&cargo.length>=spec.cartonLimit)return {...report,reason:"pallet-full"};
  const slots=Math.min((spec.cartonLimit??MAX_CARTONS_PER_PALLET)-cargo.length,MAX_VISIBLE_PLACEMENTS-plan.placements.length);
  if(slots<=0)return {...report,reason:"placement-limit"};

  const unassignedLoose=new Map(Object.entries(palletization.looseQuantities??{}));
  for(const b of plan.placements)if(!b.palletIds?.length)unassignedLoose.set(b.productId,(unassignedLoose.get(b.productId)??0)-1);
  const stock=new Map(pool.map(row=>[row.productId,Math.max(0,row.remaining-Math.max(0,unassignedLoose.get(row.productId)??0))]));
  const single=palletization.mix==="single";
  const currentGroup=single&&cargo.length?packagingGroupKey(products.find(p=>p.id===cargo[0].productId)!):undefined;
  const groups=palletStockGroups(products,stock,spec.productIds,currentGroup,slots);
  if(!groups.length)return {...report,reason:"no-eligible-stock"};
  const additionLimit=Math.min(slots,Math.max(DEFAULT_REFILL_CARTONS,...groups.map(g=>g.size)));
  const searchOptions=palletStockOptions(groups,single,additionLimit);
  const greatestAvailable=Math.min(additionLimit,Math.max(...searchOptions.map(option=>option.reduce((sum,p)=>sum+p.quantity,0))));

  const spareKg=Math.max(0,plan.container.maxWeight-plan.metrics.grossWeight);
  for(let pass=0;pass<REFILL_PASSES;pass++){
    if(pass>0&&performance.now()-started>REFILL_BUDGET_MS)break;
    const stock=searchOptions[pass%searchOptions.length];
    let additions=searchPalletAdditions(plan,pallet,products,cargo,stock,additionLimit,pass,{spareKg});
    for(let check=0;check<3&&additions.length>report.additions.length;check++){
      if(check>0&&performance.now()-started>REFILL_BUDGET_MS)break;
      try {
        const edited=editPalletContents(plan,products,id,{type:"refill",additions,sourceKey:report.sourceKey});
        const prepared=edited.placements.filter(b=>b.palletIds?.[0]===id);
        report.additions=additions;
        report.unitHeightMm=palletEnvelopeTop(pallet,prepared)-pallet.z;
        report.grossKg=pallet.weight+prepared.reduce((sum,b)=>sum+b.weight,0);
        report.kits=new Set(additions.filter(b=>b.setCode).map(b=>`${b.setCode}/${b.setNumber}`)).size;
        break;
      }catch(error){
        const message=error instanceof Error?error.message:String(error);
        if(report.issues.length<3&&!report.issues.includes(message))report.issues.push(message);
        additions=smallerPrefix(additions);
      }
    }
    if(report.additions.length===greatestAvailable)break;
  }
  return report.additions.length?{...report,batchLimitReached:additionLimit<slots&&report.additions.length===additionLimit}:{...report,reason:"no-fit"};
}
