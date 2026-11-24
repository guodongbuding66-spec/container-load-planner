import { describe, expect, it } from "vitest";
import { DEFAULT_PALLET_BUILD } from "./loading-workflow";
import { packLoadingWorkflow } from "./pack-loading";
import { palletPreviewInput, withPalletPreviewAppearance } from "./pallet-preview";
import { BASE_PRESETS, ENCLOSURE_PRESETS, withBasePreset, withEnclosurePreset } from "./packaging-presets";
import { projectionBoxes } from "./plan-projection";
import { capturePreparedPalletLayout } from "./prepared-pallet-layout";
import type { PackingRequest, PalletBuildOptions } from "./types";

const build: PalletBuildOptions = {
  ...DEFAULT_PALLET_BUILD,
  config: {
    ...DEFAULT_PALLET_BUILD.config, maxCargoHeight: 400,
    packaging: {...DEFAULT_PALLET_BUILD.config.packaging!, enclosure: "panel", opacity: .55},
  },
};
const request: PackingRequest = {
  workflow: "palletized", mode: "mixed", strategy: "practical", clearance: 10,
  container: {id:"test", name:"Vehicle", length:6000,width:2350,height:2400,doorWidth:2340,doorHeight:2290,maxWeight:20000},
  products:[{id:"box",sku:"BOX",name:"Carton",length:360,width:210,height:160,weight:7,quantity:12,priority:100,
    rotationPolicy:"upright",stackable:true,maxStackLayers:0,color:"#2f7f89"}],
};
const style: PalletBuildOptions = {...build,config:{...build.config,packaging:{...build.config.packaging!,opacity:.18,color:"#b49a63"}}};

describe("live pallet preview", () => {
  it("uses one worker request for color and opacity, and a new request for packaging dimensions", () => {
    expect(palletPreviewInput(request,build)).toBe(palletPreviewInput(request,style));
    expect(palletPreviewInput(request,build)).not.toBe(palletPreviewInput(request,{...build,config:{...build.config,height:100}}));
    expect(palletPreviewInput(request,build)).not.toBe(palletPreviewInput({...request,products:[{...request.products[0],quantity:9}]},build));
  });

  it("rebuilds the inspected package after base and enclosure presets change",()=>{
    const base=BASE_PRESETS.find(p=>p.id==="corner-feet")!;
    const enclosure=ENCLOSURE_PRESETS.find(p=>p.id==="frame-three")!;
    const config=withEnclosurePreset(withBasePreset(build.config,base),enclosure);
    const next=JSON.parse(palletPreviewInput(request,{...build,config})) as PackingRequest;
    const plan=packLoadingWorkflow(next);
    expect(plan.validation.valid).toBe(true);
    expect(plan.pallets?.[0].packaging).toMatchObject({base:"corner-feet",enclosure:"frame",railCount:3,lid:false});
  });

  it("applies a live finish to the same coordinates and both their solid and orthographic packaging", () => {
    const inspection=JSON.parse(palletPreviewInput(request,build)) as PackingRequest;
    const solved=packLoadingWorkflow(inspection);
    const displayed=withPalletPreviewAppearance(solved,style);
    expect(displayed.validation.valid).toBe(true);
    expect(displayed.id).toBe(solved.id);
    expect(displayed.placements).toBe(solved.placements);
    expect(displayed.pallets?.[0].packaging).toMatchObject({color:"#b49a63",opacity:.18});
    expect(displayed.palletization?.config.packaging?.opacity).toBe(.18);
    const drawing=projectionBoxes(displayed.pallets!,displayed.placements);
    expect(drawing.filter(box=>box.supportOnly).every(box=>box.displayOpacity===.18)).toBe(true);
    expect(drawing.filter(box=>!box.supportOnly).some(box=>box.displayOpacity!==undefined)).toBe(false);
    expect(capturePreparedPalletLayout(displayed)).toEqual(capturePreparedPalletLayout(solved));
  });
});
