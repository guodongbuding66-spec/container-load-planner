import {describe,expect,it} from "vitest";
import {CONTAINER_PRESETS} from "./presets";
import {DEFAULT_PALLET_BUILD} from "./loading-workflow";
import {DEFAULT_PACKAGING} from "./packaging";
import {editPalletContents,palletLocalBox} from "./pallet-edit";
import {packLoadingWorkflow} from "./pack-loading";
import {capturePreparedPalletLayout,palletPreparationRequest} from "./prepared-pallet-layout";
import {parseWorkspaceBackup,restoreWorkspacePlans,serializeWorkspaceBackup,type WorkspaceInputs} from "./workspace-file";
import type {PackingRequest,ProductInput} from "./types";

const carton:ProductInput={id:"a",sku:"BOX-A",name:"Carton",length:1000,width:450,height:150,weight:12,quantity:9,
  priority:50,color:"#25808b",rotationPolicy:"fixed",stackable:false,maxStackLayers:0};
const build={...DEFAULT_PALLET_BUILD,primaryRule:{maxPallets:10,cartonLimit:2},looseQuantities:{a:1},
  config:{...DEFAULT_PALLET_BUILD.config,length:1100,width:1000,height:25,gap:0,maxCargoHeight:350,
    packaging:{...DEFAULT_PACKAGING,enclosure:"panel" as const,wallThickness:20,lid:true},
    unitStacking:{enabled:true,maxLayers:4,maxTopLoadKg:1000}}};
const request:PackingRequest={workflow:"palletized",mode:"mixed",container:CONTAINER_PRESETS[2],clearance:10,products:[carton],palletBuild:build};

function approvedLayout(input=request,offset=40) {
  const preparation=palletPreparationRequest(input,input.palletBuild!);
  const preview=packLoadingWorkflow(preparation);
  const pallet=preview.pallets![0];
  const ids=preview.placements.filter(b=>b.palletIds?.includes(pallet.id)).map(b=>b.id);
  const edited=editPalletContents(preview,preparation.products,pallet.id,{type:"move",ids,delta:{x:offset,y:0,z:0}});
  return {preparation,preview,layout:capturePreparedPalletLayout(edited)};
}

describe("approved layouts from the pallet preview",()=>{
  it("keeps edited positions, every carton and the separately reserved loose carton through both solvers",()=>{
    const {layout}=approvedLayout();
    expect(layout.units).toHaveLength(4);
    for(const strategy of ["practical","maximum"] as const){
      const plan=packLoadingWorkflow({...request,strategy,preparedPalletLayout:layout});
      expect(plan.validation.valid).toBe(true);
      expect(plan.palletization?.manualPreparation).toBe(true);
      expect(plan.metrics.loadedCount).toBe(9);
      expect(plan.placements.filter(b=>!b.palletIds?.length)).toHaveLength(1);
      const offsets=plan.placements.filter(b=>b.palletIds?.length).map(b=>palletLocalBox(b,plan.pallets!.find(p=>p.id===b.palletIds![0])!).x);
      expect(offsets.filter(x=>x===60)).toHaveLength(2);
      expect(offsets.filter(x=>x===20)).toHaveLength(6);
    }
  });

  it("retains a ready-to-calculate layout and the currently verified plan in a workspace backup",()=>{
    const {layout}=approvedLayout();
    const inputs:WorkspaceInputs={...request,strategy:"practical",preparedPalletLayout:layout,practicalTargetPercent:88,
      customContainers:[],targetVolumePercent:85,targetWeightPercent:90,lengthUnit:"mm",weightUnit:"kg"};
    const loaded=packLoadingWorkflow({...request,preparedPalletLayout:layout});
    const file=serializeWorkspaceBackup(inputs,loaded.engineVersion,loaded);
    const restored=parseWorkspaceBackup(file);
    expect(restored.preparedPalletLayout).toEqual(layout);
    expect(restoreWorkspacePlans(file,restored)?.placements).toEqual(loaded.placements);
    const {placements,pallets}=packLoadingWorkflow({...request,preparedPalletLayout:restored.preparedPalletLayout});
    expect(placements).toEqual(loaded.placements);
    expect(pallets).toEqual(loaded.pallets);
  });

  it("stacks approved complete pallets when only one fit on the vehicle floor",()=>{
    const input={...request,products:[{...carton,quantity:8}],palletBuild:{...build,looseQuantities:undefined},
      container:{...request.container,length:1120,width:1030,doorWidth:1030}};
    const {layout}=approvedLayout(input);
    for(const strategy of ["practical","maximum"] as const){
      const plan=packLoadingWorkflow({...input,strategy,preparedPalletLayout:layout});
      expect(plan.metrics.loadedCount).toBe(8);
      expect(plan.pallets?.map(p=>p.z)).toEqual([0,395,790,1185]);
    }
  });

  it("validates every unit, including an unshippable unit outside the selected vehicle's capacity",()=>{
    const {layout}=approvedLayout();
    const last=layout.units.at(-1)!;
    last.cartons[1]={...last.cartons[1],x:last.cartons[0].x,y:last.cartons[0].y};
    const small={...request.container,length:1120,width:1030,doorWidth:1030,maxWeight:100};
    expect(()=>packLoadingWorkflow({...request,container:small,preparedPalletLayout:layout})).toThrow(/布置校验失败.*重叠/);
  });

  it("rejects stale stock, geometry, SKU and loose allocations without substituting automatic positions",()=>{
    const {layout}=approvedLayout();
    expect(()=>packLoadingWorkflow({...request,preparedPalletLayout:layout,palletBuild:{...build,primaryRule:{...build.primaryRule,maxPallets:3}}})).toThrow(/库存不足/);
    expect(()=>packLoadingWorkflow({...request,preparedPalletLayout:layout,palletBuild:{...build,config:{...build.config,length:1060}}})).toThrow(/超出托内空间/);
    expect(()=>packLoadingWorkflow({...request,preparedPalletLayout:layout,products:[{...carton,id:"renamed"}],palletBuild:{...build,looseQuantities:undefined}})).toThrow(/货物已删除/);
    expect(()=>packLoadingWorkflow({...request,preparedPalletLayout:layout,palletBuild:{...build,looseQuantities:{a:2}}})).toThrow(/超过当前待打托数量/);
  });

  it("retains complete kits and rejects a partial kit even when there is sufficient box stock",()=>{
    const products=[{...carton,quantity:2,setCode:"PAIR",unitsPerSet:1},{...carton,id:"b",sku:"BOX-B",quantity:2,setCode:"PAIR",unitsPerSet:1}];
    const input={...request,products,palletBuild:{...build,looseQuantities:undefined}};
    const {layout}=approvedLayout(input);
    const plan=packLoadingWorkflow({...input,preparedPalletLayout:layout});
    expect(plan.setSummaries[0]?.loadedSets).toBe(2);
    layout.units[0].cartons.pop();
    expect(()=>packLoadingWorkflow({...input,preparedPalletLayout:layout})).toThrow(/布置校验失败/);
  });
});
