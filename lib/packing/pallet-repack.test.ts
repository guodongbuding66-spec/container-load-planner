import {afterEach,describe,expect,it,vi} from "vitest";
import * as engine from "./engine";
import {packLoadingWorkflow} from "./pack-loading";
import {DEFAULT_PALLET_BUILD} from "./loading-workflow";
import {editPalletContents,palletLocalBox,palletLocalDelta,palletOrderPool,palletWorldBox} from "./pallet-edit";
import {editPlan} from "./plan-edit";
import {inspectDeckSupports} from "./deck-support";
import {auditPackingResult} from "./result-audit";
import {buildPlacementCsv,buildDeckSupportCsv} from "./csv";
import {parseWorkspaceBackup,restoreWorkspacePlans,serializeWorkspaceBackup} from "./workspace-file";
import {palletRepackFixedIds,repackPalletContents} from "./pallet-repack";
import {DEFAULT_PACKAGING} from "./packaging";
import type {PackingRequest,PackingStrategy,ProductInput} from "./types";

const product:ProductInput={id:"p",sku:"P",name:"P",length:400,width:300,height:200,weight:10,quantity:20,priority:50,rotationPolicy:"upright",stackable:true,maxStackLayers:0,maxTopLoadKg:1000,color:"#338877"};
const config={...DEFAULT_PALLET_BUILD.config,length:800,width:600,height:100,maxCargoHeight:600,packaging:{...DEFAULT_PACKAGING,base:"solid" as const}};
function make(strategy:PackingStrategy="maximum"){
  return packLoadingWorkflow({workflow:"pallet-only",mode:"mixed",strategy,container:{id:"c",name:"C",length:5000,width:2500,height:2500,doorWidth:2500,doorHeight:2500,maxWeight:10000},clearance:0,products:[product],palletBuild:{...DEFAULT_PALLET_BUILD,maxPallets:2,config}});
}
function sparse(strategy:PackingStrategy="maximum"){
  const plan=make(strategy),p=plan.pallets![0],remove=plan.placements.filter(b=>b.palletIds?.[0]===p.id&&(()=>{const l=palletLocalBox(b,p);return l.x!==0||l.y!==0;})());
  return editPalletContents(plan,[product],p.id,{type:"remove",ids:remove.map(b=>b.id)});
}
afterEach(()=>vi.restoreAllMocks());
describe("single-pallet bounded repacking",()=>{
 it("converts scene drags into the same local offset as world/local box transforms for all four turns",()=>{
   const p=make().pallets![0],b={...make().placements[0],x:20,y:30,z:40},delta={x:70,y:-90,z:10};
   for(const q of [0,1,2,3] as const){const pallet={...p,orientation:q%2?"WLH" as const:"LWH" as const,quarterTurns:q,dx:q%2?600:800,dy:q%2?800:600},world=palletWorldBox(b,pallet),moved=palletLocalBox({...world,x:world.x+delta.x,y:world.y+delta.y,z:world.z+delta.z},pallet),expected=palletLocalDelta(delta,pallet);expect([moved.x-b.x,moved.y-b.y,moved.z-b.z]).toEqual([expected.x,expected.y,expected.z]);}
 });
 it.each(["practical","maximum"] as const)("lowers a sparse stack without borrowing order cargo or moving other pallets (%s)",strategy=>{
   let plan=sparse(strategy);const p=plan.pallets![0];plan=editPalletContents(plan,[product],p.id,{type:"lock-others",locked:true});
   const before=JSON.stringify(plan),next=repackPalletContents(plan,[product],p.id);
   expect(next.improved).toBe(true);expect(next.before.cargoTopMm).toBe(600);expect(next.after.cargoTopMm).toBe(200);expect(next.fixedCount).toBe(0);expect(next.attempts).toBe(4);
   const applied=editPalletContents(plan,[product],p.id,{type:"repack",positions:next.positions,sourceKey:next.sourceKey});
   expect(applied.pallets).toEqual(plan.pallets);expect(applied.placements.filter(b=>b.palletIds?.[0]!==p.id)).toEqual(plan.placements.filter(b=>b.palletIds?.[0]!==p.id));
   expect(applied.placements.map(b=>b.id).sort()).toEqual(plan.placements.map(b=>b.id).sort());expect(applied.metrics.grossWeight).toBe(plan.metrics.grossWeight);expect(palletOrderPool(applied,[product])).toEqual(palletOrderPool(plan,[product]));
   expect(JSON.stringify(plan)).toBe(before);expect(applied.palletization?.editRevision).toBe((plan.palletization?.editRevision??0)+1);
 });
 it("retains the support closure of a locked upper carton",()=>{
   const plan=sparse(),p=plan.pallets![0],cargo=plan.placements.filter(b=>b.palletIds?.[0]===p.id),top=cargo.reduce((a,b)=>a.z>b.z?a:b);
   const locked=editPalletContents(plan,[product],p.id,{type:"lock-cargo",ids:[top.id],locked:true}),fixed=palletRepackFixedIds(locked.placements.filter(b=>b.palletIds?.[0]===p.id),[product]);
   expect(fixed.size).toBe(3);const r=repackPalletContents(locked,[product],p.id);expect(r.improved).toBe(false);expect(r.fixedCount).toBe(3);expect(r.attempts).toBe(0);expect(r.positions).toEqual(locked.placements.filter(b=>b.palletIds?.[0]===p.id));
 });
 it("rejects changed identity, lost cartons and locked whole units atomically",()=>{
   const plan=sparse(),p=plan.pallets![0],before=JSON.stringify(plan),r=repackPalletContents(plan,[product],p.id);
   expect(()=>editPalletContents(plan,[product],p.id,{type:"repack",positions:r.positions.slice(1),sourceKey:r.sourceKey})).toThrow(/全部/);
   expect(()=>editPalletContents(plan,[product],p.id,{type:"repack",positions:r.positions.map((b,i)=>i?b:{...b,weight:1}),sourceKey:r.sourceKey})).toThrow(/身份/);
   const locked=editPalletContents(plan,[product],p.id,{type:"lock",locked:true});expect(()=>repackPalletContents(locked,[product],p.id)).toThrow(/锁定/);
   expect(JSON.stringify(plan)).toBe(before);
 });
 it("keeps locked floor cargo fixed while compacting only the free remainder",()=>{
   const plan=sparse(),p=plan.pallets![0],bottom=plan.placements.find(b=>b.palletIds?.[0]===p.id&&b.z===100)!;
   const locked=editPalletContents(plan,[product],p.id,{type:"lock-cargo",ids:[bottom.id],locked:true}),r=repackPalletContents(locked,[product],p.id);
   expect(r.improved).toBe(true);expect(r.fixedCount).toBe(1);expect(r.after.cargoTopMm).toBe(200);expect(r.positions.find(b=>b.id===bottom.id)).toEqual(locked.placements.find(b=>b.id===bottom.id));
 });
 it("keeps original positions on an equal score and does not manufacture a history revision",()=>{
   const plan=make(),p=plan.pallets![0],before=JSON.stringify(plan),r=repackPalletContents(plan,[product],p.id);
   expect(r.improved).toBe(false);expect(r.positions).toEqual(plan.placements.filter(b=>b.palletIds?.[0]===p.id));expect(JSON.stringify(plan)).toBe(before);
   expect(()=>editPalletContents(plan,[product],p.id,{type:"repack",positions:r.positions,sourceKey:r.sourceKey})).toThrow(/未发现更优/);
 });
 it("invalidates previews after another unit, locks or current order inputs change",()=>{
   const plan=sparse(),p=plan.pallets![0],r=repackPalletContents(plan,[product],p.id),changed=editPalletContents(plan,[product],p.id,{type:"lock-others",locked:true});
   expect(()=>editPalletContents(changed,[product],p.id,{type:"repack",positions:r.positions,sourceKey:r.sourceKey})).toThrow(/已失效/);
   expect(()=>editPalletContents(plan,[{...product,quantity:21}],p.id,{type:"repack",positions:r.positions,sourceKey:r.sourceKey})).toThrow(/已失效|不一致/);
 });
 it("rejects a forged improved preview that would move a retained supporter",()=>{
   const plan=sparse(),p=plan.pallets![0],top=plan.placements.filter(b=>b.palletIds?.[0]===p.id).reduce((a,b)=>a.z>b.z?a:b),locked=editPalletContents(plan,[product],p.id,{type:"lock-cargo",ids:[top.id],locked:true});
   const r=repackPalletContents(locked,[product],p.id),positions=r.positions.map(b=>b.id===top.id?b:{...b,x:b.x+1});
   expect(()=>editPalletContents(locked,[product],p.id,{type:"repack",positions,sourceKey:r.sourceKey})).toThrow(/支撑链/);
 });
 it("preserves sparse 1:2 kit numbers and every physical item ID when reassociating search geometry",()=>{
   const a={...product,id:"a",sku:"A",length:200,width:300,quantity:3,setCode:"KIT",unitsPerSet:1},b={...a,id:"b",sku:"B",quantity:6,unitsPerSet:2},products=[a,b];
   const req:PackingRequest={workflow:"pallet-only",mode:"mixed",strategy:"maximum",container:make().container,clearance:0,products,palletBuild:{...DEFAULT_PALLET_BUILD,maxPallets:1,config}};
   const original=packLoadingWorkflow(req),p=original.pallets![0],placements=original.placements.map(b=>({...b,x:(b.setItemNumber!-1)*200,y:0,z:100+(b.setNumber!-1)*200,setNumber:[2,7,11][b.setNumber!-1]}));
   const plan=engine.restorePackingSnapshot(req,{...original,placements:engine.rebuildPlacementLayers(placements,original.pallets!,products),palletization:{...original.palletization,editRevision:1}}),r=repackPalletContents(plan,products,p.id);
   expect(r.improved).toBe(true);expect(r.before.cargoTopMm).toBe(600);expect(r.after.cargoTopMm).toBe(400);
   const trace=(boxes:typeof placements)=>boxes.map(b=>[b.id,b.productId,b.weight,b.setCode,b.setNumber,b.setItemNumber]).sort((a,b)=>String(a[0]).localeCompare(String(b[0])));
   expect(trace(r.positions as typeof placements)).toEqual(trace(plan.placements as typeof placements));
   const locked=editPalletContents(plan,products,p.id,{type:"lock-cargo",ids:[plan.placements.find(b=>b.setNumber===11)!.id],locked:true}),fixed=palletRepackFixedIds(locked.placements,products);
   expect(fixed.size).toBe(9);expect(repackPalletContents(locked,products,p.id).fixedCount).toBe(9);
 });
 it("respects crate insets while reducing cargo height without shrinking the enclosure",()=>{
   const c={...config,length:1000,width:800,packaging:{...DEFAULT_PACKAGING,base:"solid" as const,enclosure:"panel" as const,wallThickness:50}};
   const original=packLoadingWorkflow({workflow:"pallet-only",mode:"mixed",strategy:"maximum",container:make().container,clearance:0,products:[product],palletBuild:{...DEFAULT_PALLET_BUILD,maxPallets:1,config:c}}),p=original.pallets![0];
   const plan=editPalletContents(original,[product],p.id,{type:"remove",ids:original.placements.filter(b=>b.x!==50||b.y!==50).map(b=>b.id)}),r=repackPalletContents(plan,[product],p.id);
   expect(r.improved).toBe(true);expect(r.after.cargoTopMm).toBe(200);expect(r.after.unitHeightMm).toBe(r.before.unitHeightMm);expect(r.positions.every(b=>b.x>=50&&b.y>=50&&b.x+b.dx<=950&&b.y+b.dy<=750)).toBe(true);
 });
 it.each([0,1,2,3])("uses asymmetric supports in the original pallet axes after %s quarter turns",turns=>{
   const c={...config,maxCargoHeight:650,packaging:{...config.packaging,deckSupports:[{id:"wood",name:"QA wood",x:0,y:0,dx:400,dy:600,dz:50,weightKg:5,maxLoadKg:100,source:"QA synthetic",revision:"r1"}]}};
   const original=packLoadingWorkflow({workflow:"palletized",mode:"mixed",strategy:"maximum",container:{id:"c",name:"C",length:6000,width:3000,height:2500,doorWidth:3000,doorHeight:2500,maxWeight:10000},clearance:0,products:[product],palletBuild:{...DEFAULT_PALLET_BUILD,maxPallets:2,config:c}}),p=original.pallets![0];
   let plan=editPalletContents(original,[product],p.id,{type:"remove",ids:original.placements.filter(b=>b.palletIds?.[0]===p.id&&(b.x!==p.x||b.y!==p.y)).map(b=>b.id)});
   const ids=plan.placements.filter(b=>b.palletIds?.[0]===p.id).map(b=>b.id);plan=editPlan(plan,[product],ids,"pallet",{x:3000-p.x,y:1500-p.y,z:0},0,0);
   for(let n=0;n<turns;n++)plan=editPlan(plan,[product],ids,"pallet",{x:0,y:0,z:0},0,0,true);
   const r=repackPalletContents(plan,[product],p.id);expect(r.improved).toBe(true);
   const next=editPalletContents(plan,[product],p.id,{type:"repack",positions:r.positions,sourceKey:r.sourceKey});
   expect(next.metrics.grossWeight).toBe(plan.metrics.grossWeight);expect(next.pallets).toEqual(plan.pallets);expect(inspectDeckSupports(next,[product]).every(s=>s.state==="pass")).toBe(true);expect(auditPackingResult(next,[product]).hasErrors).toBe(false);
 });
 it("never accepts a partial search result or treats bounded failure as cargo loss",()=>{
   const plan=sparse(),p=plan.pallets![0],before=JSON.stringify(plan);vi.spyOn(engine,"searchPalletContents").mockReturnValue([]);
   const r=repackPalletContents(plan,[product],p.id);expect(r.improved).toBe(false);expect(r.rejected).toBe(4);expect(r.issues[0]).toMatch(/全部箱数/);expect(JSON.stringify(plan)).toBe(before);
 });
 it("rejects complete lower candidates that fail physical support in the full plan",()=>{
   const plan=sparse(),p=plan.pallets![0],before=JSON.stringify(plan),cargo=plan.placements.filter(b=>b.palletIds?.[0]===p.id);
   vi.spyOn(engine,"searchPalletContents").mockReturnValue(cargo.map((b,i)=>({...b,x:i%2*400,y:Math.floor(i/2)*300,z:101})));
   const r=repackPalletContents(plan,[product],p.id);expect(r.improved).toBe(false);expect(r.rejected).toBe(4);expect(r.issues.length).toBeGreaterThan(0);expect(r.positions).toEqual(cargo);expect(JSON.stringify(plan)).toBe(before);
 });
 it("enforces a zero support rating instead of using its top to lower cargo",()=>{
   const c={...config,packaging:{...config.packaging,deckSupports:[{id:"wood",name:"QA wood",x:0,y:0,dx:400,dy:600,dz:50,weightKg:5,maxLoadKg:0,source:"QA synthetic",revision:"r1"}]}};
   const original=packLoadingWorkflow({workflow:"pallet-only",mode:"mixed",strategy:"maximum",container:make().container,clearance:0,products:[product],palletBuild:{...DEFAULT_PALLET_BUILD,maxPallets:2,config:c}}),p=original.pallets![0];
   const plan=editPalletContents(original,[product],p.id,{type:"remove",ids:original.placements.filter(b=>b.palletIds?.[0]===p.id&&b.y!==0).map(b=>b.id)}),r=repackPalletContents(plan,[product],p.id);
   expect(r.improved).toBe(true);expect(r.after.cargoTopMm).toBe(400);
   const next=editPalletContents(plan,[product],p.id,{type:"repack",positions:r.positions,sourceKey:r.sourceKey});expect(inspectDeckSupports(next,[product]).every(s=>s.loadKg===0&&s.limitKg===0&&s.state==="pass")).toBe(true);
 });
 it("preserves one allowed world orientation on a turned pallet",()=>{
   let plan=sparse();const p=plan.pallets![0],ids=plan.placements.filter(b=>b.palletIds?.[0]===p.id).map(b=>b.id);
   const other=plan.pallets![1];plan=editPalletContents(plan,[product],other.id,{type:"remove",ids:plan.placements.filter(b=>b.palletIds?.[0]===other.id).map(b=>b.id)});
   // The inspection area is widened only for this independent software fixture.
   const req:PackingRequest={workflow:"palletized",mode:"mixed",strategy:plan.strategy,container:{id:"c",name:"C",length:6000,width:3000,height:2500,doorWidth:3000,doorHeight:2500,maxWeight:10000},clearance:0,products:[product],palletBuild:plan.palletBuild};
   plan=engine.restorePackingSnapshot(req,{...plan,workflow:"palletized",palletization:{...plan.palletization,only:false}});plan=editPlan(plan,[product],ids,"pallet",{x:3000,y:1500,z:0},0,0,true);
   // Only WLH is now permitted; local search must invert the whole-pallet turn.
   const fixed={...product,allowedOrientations:["WLH"] as ("LWH"|"WLH")[]};
   const r=repackPalletContents(plan,[fixed],p.id);expect(r.improved).toBe(true);
   expect(r.positions.every(b=>fixed.allowedOrientations.includes(b.orientation as "LWH"|"WLH"))).toBe(true);expect(editPalletContents(plan,[fixed],p.id,{type:"repack",positions:r.positions,sourceKey:r.sourceKey}).validation.valid).toBe(true);
 });
 it("rebuilds an elevated unit in local axes without moving its supporting lower pallet",()=>{
   const products=[{...product,quantity:24}],original=packLoadingWorkflow({workflow:"palletized",mode:"mixed",strategy:"maximum",container:{id:"c",name:"C",length:800,width:600,height:2000,doorWidth:600,doorHeight:2000,maxWeight:10000},clearance:0,products,palletBuild:{...DEFAULT_PALLET_BUILD,config,maxPallets:2,stackLayers:2,maxTopLoadKg:1000}}),upper=original.pallets!.reduce((a,b)=>a.z>b.z?a:b);
   expect(upper.z).toBeGreaterThan(0);
   const plan=editPalletContents(original,products,upper.id,{type:"remove",ids:original.placements.filter(b=>b.palletIds?.[0]===upper.id&&(()=>{const local=palletLocalBox(b,upper);return local.x!==0||local.y!==0;})()).map(b=>b.id)}),r=repackPalletContents(plan,products,upper.id);
   expect(r.improved).toBe(true);expect(r.after.cargoTopMm).toBe(200);
   const next=editPalletContents(plan,products,upper.id,{type:"repack",positions:r.positions,sourceKey:r.sourceKey});expect(next.pallets).toEqual(plan.pallets);expect(next.placements.filter(b=>b.palletIds?.[0]!==upper.id)).toEqual(plan.placements.filter(b=>b.palletIds?.[0]!==upper.id));expect(next.metrics.grossWeight).toBe(plan.metrics.grossWeight);
 });
 it("checks empty pallets, unsupported shapes, budgets and current invalid data before search",()=>{
   const plan=sparse(),p=plan.pallets![0],empty=editPalletContents(plan,[product],p.id,{type:"remove",ids:plan.placements.filter(b=>b.palletIds?.[0]===p.id).map(b=>b.id)});
   expect(()=>repackPalletContents(empty,[product],p.id)).toThrow(/没有货物/);
   expect(()=>repackPalletContents(plan,[{...product,cargoShape:"cylinder"}],p.id)).toThrow(/长方体/);
   expect(()=>repackPalletContents({...plan,placements:Array.from({length:161},(_,i)=>({...plan.placements[0],id:`overflow-${i}`,palletIds:[p.id]}))},[product],p.id)).toThrow(/160/);
   expect(()=>repackPalletContents(plan,[{...product,weight:11}],p.id)).toThrow();
 });
 it("round-trips the adopted geometry, stock and edit revision through dual-strategy backup and CSV",()=>{
   const plan=sparse(),p=plan.pallets![0],r=repackPalletContents(plan,[product],p.id),next=editPalletContents(plan,[product],p.id,{type:"repack",positions:r.positions,sourceKey:r.sourceKey});
   const inputs={workflow:plan.workflow,palletBuild:plan.palletBuild,mode:plan.mode,strategy:plan.strategy,practicalTargetPercent:95,container:plan.container,clearance:0,products:[product],customContainers:[],targetVolumePercent:85,targetWeightPercent:85,lengthUnit:"mm" as const,weightUnit:"kg" as const};
   const file=serializeWorkspaceBackup(inputs,next.engineVersion,{...next,strategyPlans:{maximum:next}}),restored=restoreWorkspacePlans(file,parseWorkspaceBackup(file))!;
   expect(restored.placements).toEqual(next.placements);expect(restored.pallets).toEqual(next.pallets);expect(restored.palletization?.editRevision).toBe(next.palletization?.editRevision);expect(restored.metrics.grossWeight).toBe(next.metrics.grossWeight);
   expect(buildPlacementCsv(next).split("\r\n")).toHaveLength(next.placements.length+next.pallets!.length+1);expect(buildDeckSupportCsv(next,[product])).toContain("Engine");
 });
});
