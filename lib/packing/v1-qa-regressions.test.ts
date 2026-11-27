import {describe,expect,it} from "vitest";
import {pack,validateContainerInput} from "./engine";
import {arrangeFloorPallets} from "./floor-pallets";
import {analyzePinwheelPallets} from "./trade-optimizers";
import {availablePackingVolume} from "./site-exclusions";
import {parseProductInput,parseWorkspaceBackup} from "./workspace-file";
import {analyzeOogCargo} from "./oog-calculator";
import {SAMPLE_PRODUCTS,CONTAINER_PRESETS} from "./presets";
import type {ContainerSpec,ProductInput} from "./types";
const c:ContainerSpec={id:"qa",name:"QA",length:2000,width:1200,height:1200,doorWidth:1200,doorHeight:1200,maxWeight:100000,rearDoorClearanceMm:500};
const p:ProductInput={...SAMPLE_PRODUCTS[0],id:"qa",sku:"QA",length:500,width:400,height:300,quantity:100,weight:10,rotationPolicy:"fixed",stackable:true,maxStackLayers:0};
describe("V1 independent release regressions",()=>{
  it("uses the same rear buffer for volume, carton solver and floor pallets",()=>{
    expect(availablePackingVolume(c,0)).toBe(2160000000);
    const plan=pack({container:c,products:[p],clearance:0,strategy:"maximum",mode:"mixed"});
    expect(plan.validation.valid).toBe(true);expect(plan.placements.length).toBe(36);
    const pallets=arrangeFloorPallets(c,0,{presetId:"qa",name:"QA",length:500,width:600,height:100,weight:10,maxLoad:1000,count:0,gap:0,layout:"long",allowFloorCargo:false});
    expect(pallets).toHaveLength(6);expect(pallets.every(b=>b.x+b.dx<=1500)).toBe(true);
    expect(validateContainerInput({...c,rearDoorClearanceMm:2000},0)).not.toBeNull();
    expect(availablePackingVolume({...c,loadingAccess:"open"},0)).toBe(2880000000);
  });
  it("preserves new inputs in workspace backup parsing",()=>{
    expect(parseProductInput({...p,nestingDeltaHeightMm:100}).nestingDeltaHeightMm).toBe(100);
    const inputs={mode:"mixed",strategy:"maximum",practicalTargetPercent:85,container:c,clearance:0,products:[p],customContainers:[],targetVolumePercent:90,targetWeightPercent:90,lengthUnit:"mm",weightUnit:"kg"};
    expect(parseWorkspaceBackup(JSON.stringify({format:"cargo-fit-workspace",version:1,inputs})).container.rearDoorClearanceMm).toBe(500);
  });
  it("returns coordinates even when aligned pallet layout is optimal",()=>{
    const a=analyzePinwheelPallets({...c,rearDoorClearanceMm:0},500,500);
    expect(a.pinwheelCount).toBe(8);expect(a.placements).toHaveLength(8);
  });
  it("evaluates permitted rotations for OOG screening",()=>{
    const ct=CONTAINER_PRESETS[0],prod={...p,length:1000,width:ct.width+100,height:500,quantity:1};
    expect(analyzeOogCargo(ct,[{...prod,rotationPolicy:"upright"}]).hasOogCargo).toBe(false);
    expect(analyzeOogCargo(ct,[prod]).hasOogCargo).toBe(true);
  });
  it("retains original dimensions and prevents fictitious nested capacity",()=>{
    const noBuf={...c,rearDoorClearanceMm:0};
    for(const mode of ["mixed","single"] as const){
      const plan=pack({container:noBuf,products:[{...p,nestingDeltaHeightMm:100}],clearance:0,strategy:"maximum",mode});
      expect(plan.validation.valid).toBe(true);
      expect(plan.placements).toHaveLength(48);
      expect(plan.placements.every(b=>b.dz===300)).toBe(true);
      expect(plan.metrics.volumeUtilization).toBeLessThanOrEqual(1);
    }
  });
});
