import { expect,it } from "vitest";
import { cratePreview } from "./crate-preview";
import { planCrateUnits,proposeCrateColumn,reviewCrateStack } from "./crate-bearing";
import { DEFAULT_PALLET_BUILD } from "./loading-workflow";
import { DEFAULT_PACKAGING } from "./packaging";
import { packLoadingWorkflow } from "./pack-loading";
import { projectModelPreview } from "./model-preview";
import type { ProductInput } from "./types";
const product:ProductInput={id:"p",sku:"P",name:"P",length:400,width:300,height:200,weight:10,quantity:2,priority:50,rotationPolicy:"fixed",stackable:false,maxStackLayers:0,color:"#338877"};
function make(offset=0){const p=packLoadingWorkflow({workflow:"pallet-only",mode:"mixed",clearance:0,container:{id:"c",name:"C",length:600,width:500,height:1000,doorWidth:500,doorHeight:1000,maxWeight:1000},products:[product],palletBuild:{...DEFAULT_PALLET_BUILD,maxPallets:2,config:{...DEFAULT_PALLET_BUILD.config,length:600,width:500,height:100,maxCargoHeight:200,packaging:{...DEFAULT_PACKAGING,base:"corner-feet",enclosure:"frame"}}}}),units=proposeCrateColumn(planCrateUnits(p),[{x:offset,y:0}]);return {p,units,report:reviewCrateStack(units)};}
it("centers translated packaging including negative offsets and the complete upper lid",()=>{
  const {p,units,report}=make(-100),before=JSON.stringify(p),data=cratePreview(units,report,units[1].pallet.id,"L1W1")!;
  expect(data.size).toEqual([700,660,500]);expect(data.offset).toEqual([-250,-0,-250]);expect(data.highlights).toHaveLength(4);expect(data.highlights[3].z+data.highlights[3].dz).toBe(660);expect(JSON.stringify(p)).toBe(before);
  for(const part of [...data.projectionParts,...data.projectionHighlights])expect([...part.position,...part.size].every(Number.isFinite)).toBe(true);
});
it("colors missing evidence gray and a misaligned corner red",()=>{
  const a=make(),b=make(1);expect(cratePreview(a.units,a.report,a.units[1].pallet.id,"L0W0")!.color).toBe("#7b8490");expect(cratePreview(b.units,b.report,b.units[1].pallet.id,"L0W0")!.color).toBe("#b63b36");
});
it("changes the selected physical path without copying cargo into the structural view",()=>{
  const {units,report}=make(),a=cratePreview(units,report,units[0].pallet.id,"L0W0")!,b=cratePreview(units,report,units[0].pallet.id,"L1W1")!;
  expect(a.highlights[0].x).toBe(0);expect(b.highlights[0].x).toBe(570);expect(a.parts.every(p=>p.unitId.startsWith("floor-pallet"))).toBe(true);expect(a.parts).toHaveLength(b.parts.length);
});
it("fits all physical parts and highlighted cap corners within CPU orthographic views",()=>{
  const {units,report}=make(),data=cratePreview(units,report,units[0].pallet.id,"L1W1")!;
  for(const direction of [[0,1,0],[0,0,1],[1,0,0],[.4,.4,1]] as [number,number,number][]){const view=projectModelPreview([...data.projectionParts,...data.projectionHighlights],{size:data.size,origin:[0,0,0]},direction,660,360);expect(view.faces.length).toBeGreaterThan(0);for(const face of view.faces)for(const point of face.points.split(" ")){const [x,y]=point.split(",").map(Number);expect(x).toBeGreaterThanOrEqual(0);expect(x).toBeLessThanOrEqual(660);expect(y).toBeGreaterThanOrEqual(0);expect(y).toBeLessThanOrEqual(360);}}
});
it("does not construct a preview for non-finite geometry",()=>{
  const {units,report}=make();units[0].pallet.x=NaN;expect(cratePreview(units,report,units[0].pallet.id,"L0W0")).toBeNull();
});
