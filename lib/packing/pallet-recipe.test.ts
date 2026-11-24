import {emptyCrateBearing} from "./crate-bearing";
import {emptyForkInterface} from "./fork-interface";
import {baseMeasurements} from "./packaging";
import { describe, expect, it } from "vitest";
import { oneLayerCrateFixture } from "../../tests/one-layer-crate-fixture";
import { palletHeightFixture } from "../../tests/pallet-height-fixture";
import { restorePackingSnapshot } from "./engine";
import { parsePalletBuild } from "./loading-workflow";
import { packLoadingWorkflow } from "./pack-loading";
import { packagingInterior } from "./packaging";
import { inspectPalletHeights, oneLayerPalletCeilings, withVehiclePalletHeights } from "./pallet-height";
import { canSuggestPalletSize, redesignPalletRecipeSpec, initialPalletRecipeCartons, previewPalletRecipe, withPalletRecipe, type PalletRecipeInput } from "./pallet-recipe";
import { palletSpecifications } from "./pallet-specifications";
import { validatePalletizedCargo } from "./prebuilt-pallets";
import type { PackingRequest } from "./types";

function input(request = oneLayerCrateFixture(), cartons = 20, groupKey = "sku:long"): PalletRecipeInput {
  return {request, spec:palletSpecifications(request.palletBuild!)[0], cartons, groupKey, mode:"suggest"};
}

describe("pallet recipes", () => {
  it.each(["practical", "maximum"] as const)("recovers the documented 1800 mm / 3-carton screenshot without reusing its structural consent in %s", strategy => {
    const request={...oneLayerCrateFixture(),strategy}, build=request.palletBuild!;
    Object.assign(build.config,{length:1800,width:1800,crateBearing:emptyCrateBearing(),forkInterface:emptyForkInterface(build.config)});
    build.primaryRule={maxPallets:50,cartonLimit:3,productIds:["long"]};build.selection="compact";
    const original=structuredClone(build), before=packLoadingWorkflow(request);
    expect(before.metrics).toMatchObject({loadedCount:18,grossWeight:906});
    expect(canSuggestPalletSize(build.config)).toBe(false);
    const spec=palletSpecifications(build)[0], fresh=redesignPalletRecipeSpec(spec);
    expect(initialPalletRecipeCartons(request,fresh)).toBe(23);
    const preview=previewPalletRecipe({...input(request,20),spec:fresh});
    expect(preview.layerCount).toBe(10);
    const next=withPalletRecipe(build,"primary",{config:preview.config,cartonLimit:20,redesigned:true});
    expect(build).toEqual(original);
    expect(next.additionalSpecs![0]).toEqual({...spec,id:"previous-primary",maxPallets:0});
    expect(next.config.crateBearing).toBeUndefined();expect(next.config.forkInterface).toBeUndefined();
    expect(next.primaryRule).toEqual({maxPallets:50,cartonLimit:20,productIds:["long"]});
    expect(palletSpecifications(next).reduce((n,s)=>n+s.maxPallets,0)).toBe(50);
    const after=packLoadingWorkflow({...request,palletBuild:parsePalletBuild(next)});
    expect(after.metrics).toMatchObject({loadedCount:280,grossWeight:12110});expect(after.validation.valid).toBe(true);
    expect(after.pallets).toHaveLength(14);
  });

  it("retains original measured parts and refuses redesign when their archive would exceed the specification limit", () => {
    const request=oneLayerCrateFixture(),build=request.palletBuild!,config=build.config;
    config.packaging!.measurements=baseMeasurements(config.length,config.width,config.height,config.packaging!);
    const spec=palletSpecifications(build)[0], original=structuredClone(spec), fresh=redesignPalletRecipeSpec(spec);
    expect(fresh.config.packaging!.measurements).toBeUndefined();expect(spec).toEqual(original);
    const patch={config:fresh.config,cartonLimit:20,redesigned:true};
    build.additionalSpecs=[{...spec,id:"second"}];
    const next=withPalletRecipe(build,"second",patch);
    expect(next.config).toEqual(config);expect(next.additionalSpecs![1]).toEqual({...spec,id:"previous-second",maxPallets:0});
    build.additionalSpecs=Array.from({length:7},(_,i)=>({...spec,id:`s${i}`}));
    expect(()=>withPalletRecipe(build,"primary",patch)).toThrow(/腾出/);
  });

  it.each(["practical", "maximum"] as const)("offers a usable inline recovery of the persisted one-layer inputs in %s", strategy => {
    const request = {...oneLayerCrateFixture(), strategy};
    const original = structuredClone(request);
    const before = packLoadingWorkflow(request);
    expect(oneLayerPalletCeilings(request,before).map(s=>s.id)).toEqual(["primary"]);
    const spec = palletSpecifications(request.palletBuild!)[0];
    const cartons = initialPalletRecipeCartons(request,spec)!;
    expect(cartons).toBe(23);
    const preview = previewPalletRecipe(input(request,cartons));
    const palletBuild = withPalletRecipe(request.palletBuild!,spec.id,{config:preview.config,cartonLimit:cartons});
    const next = {...request,palletBuild}, after = packLoadingWorkflow(next);
    expect(request).toEqual(original);
    expect(after.metrics).toMatchObject({requestedCount:596,loadedCount:322});
    expect(after.validation.valid).toBe(true);
    expect(oneLayerPalletCeilings(next,after)).toEqual([]);
    expect(restorePackingSnapshot(next,JSON.parse(JSON.stringify(after))).placements).toEqual(after.placements);
  });

  it("applies count and dimensions to the chosen specification without losing stock, eligibility or loose reservations", () => {
    const request = oneLayerCrateFixture(), build=request.palletBuild!;
    build.primaryRule={maxPallets:7,productIds:["long"],cartonLimit:5};
    build.looseQuantities={long:2};
    build.additionalSpecs=[{...palletSpecifications(build)[0],id:"second",maxPallets:3}];
    const config={...build.config,maxCargoHeight:1200};
    const primary=withPalletRecipe(build,"primary",{config,cartonLimit:20});
    expect(primary.primaryRule).toEqual({maxPallets:7,productIds:["long"],cartonLimit:20});
    expect(primary.additionalSpecs).toEqual(build.additionalSpecs);
    expect(primary.looseQuantities).toEqual({long:2});
    const second=withPalletRecipe(build,"second",{config,cartonLimit:20});
    expect(second.config).toEqual(build.config);
    expect(second.primaryRule).toEqual(build.primaryRule);
    expect(second.additionalSpecs![0]).toMatchObject({config,cartonLimit:20,maxPallets:3,productIds:["long"]});
    expect(()=>withPalletRecipe(build,"removed",{config})).toThrow(/已变化/);
  });

  it("seeds complete kits from remaining stock and payload, retaining an explicit carton count", () => {
    const request=oneLayerCrateFixture(), a=request.products[0];
    request.products=[{...a,quantity:14,setCode:"KIT",unitsPerSet:2,weight:300},
      {...a,id:"b",sku:"B",quantity:7,setCode:"KIT",unitsPerSet:1,weight:100}];
    request.palletBuild!.looseQuantities={long:2,b:1};
    const spec=palletSpecifications(request.palletBuild!)[0];
    expect(initialPalletRecipeCartons(request,spec)).toBe(3);
    expect(initialPalletRecipeCartons(request,{...spec,cartonLimit:6})).toBe(6);
    expect(initialPalletRecipeCartons(request,{...spec,config:{...spec.config,maxLoad:699}})).toBeUndefined();
    expect(initialPalletRecipeCartons(request,{...spec,productIds:["long"]})).toBeUndefined();
  });

  it.each(["practical", "maximum"] as const)("rebuilds the screenshot's 16-carton case in %s", strategy => {
    const request = {...oneLayerCrateFixture(), strategy};
    const before = packLoadingWorkflow(request);
    expect(before.metrics).toMatchObject({loadedCount:16, requestedCount:596, grossWeight:772});
    expect(before.pallets).toHaveLength(4);
    expect(before.pallets!.every(p => p.enclosureHeight === 180)).toBe(true);
    expect(inspectPalletHeights(request)[0]).toMatchObject({current:125, available:2532, crate:true});

    const preview = previewPalletRecipe(input(request));
    expect(preview).toMatchObject({height:1255, layerCount:10, orderCartons:596, grossWeight:865,
      config:{length:1700, width:1150, height:25, maxCargoHeight:1200, maxLoad:1000, weight:25}});
    expect(preview.placements).toHaveLength(20);
    expect(preview.placements[0]).toMatchObject({x:30,y:30,z:0});
    expect(request.palletBuild!.config.maxCargoHeight).toBe(125);
    const palletBuild = parsePalletBuild({...request.palletBuild!, config:preview.config, primaryRule:{maxPallets:50,cartonLimit:20}});
    const updated = {...request,palletBuild};
    const after = packLoadingWorkflow(updated);
    expect(after.validation.valid).toBe(true);
    expect(after.metrics).toMatchObject({loadedCount:280, requestedCount:596, grossWeight:12110});
    expect(after.pallets).toHaveLength(14);
    expect(after.pallets!.every(p => p.z===0 && p.enclosureHeight===1255 &&
      after.placements.filter(b=>b.palletIds?.includes(p.id)).length===20)).toBe(true);
    expect(restorePackingSnapshot(updated, JSON.parse(JSON.stringify(after))).placements).toEqual(after.placements);
  });

  it("respects edits to the physical dimensions and updates the preview", () => {
    const draft = input(), preview = previewPalletRecipe(draft);
    const spec = {...draft.spec, config:{...preview.config,maxCargoHeight:480},cartonLimit:20};
    const adjusted = previewPalletRecipe({...draft, spec, mode:"current"});
    expect(adjusted).toMatchObject({height:535, layerCount:4, sampleCartons:20});
    expect(adjusted.placements).toHaveLength(8);
    const result = packLoadingWorkflow({...draft.request,palletBuild:{...draft.request.palletBuild!,config:spec.config,primaryRule:{maxPallets:50,cartonLimit:20}}});
    expect(result.metrics.loadedCount).toBe(112);
  });

  it("enforces the adopted limit even on a larger base and retains a partial tail", () => {
    const request = palletHeightFixture();
    request.products[0].quantity=13;
    request.palletBuild!.config.maxCargoHeight=1200;
    request.palletBuild!.primaryRule={maxPallets:50,cartonLimit:5};
    const result=packLoadingWorkflow(request);
    const counts=result.pallets!.map(p=>result.placements.filter(b=>b.palletIds?.includes(p.id)).length);
    expect(counts.sort()).toEqual([3,5,5]);
    const tampered=structuredClone(result.palletization!);
    tampered.specifications![0].cartonLimit=4;
    expect(validatePalletizedCargo(result.placements,result.pallets!,result.container,result.clearance,tampered,request.products)).toContain("每托箱数超过设定上限 / Pallet exceeds its carton limit");
  });

  it("keeps kit components together with an exact cap and a partial pallet", () => {
    const request: PackingRequest = {...palletHeightFixture(), workflow:"pallet-only"};
    const a={...request.products[0],length:250,width:200,height:100,weight:5,quantity:6,setCode:"KIT",unitsPerSet:2};
    request.products=[a,{...a,id:"b",sku:"B",length:180,width:160,quantity:3,unitsPerSet:1}];
    const draft=input(request,6,"kit:KIT"), preview=previewPalletRecipe(draft);
    expect(preview.placements.filter(b=>b.productId===a.id)).toHaveLength(4);
    expect(preview.placements.filter(b=>b.productId==="b")).toHaveLength(2);
    expect(()=>previewPalletRecipe({...draft,cartons:5})).toThrow(/3 的倍数/);
    request.palletBuild={...request.palletBuild!,config:preview.config,primaryRule:{maxPallets:50,cartonLimit:6}};
    const plan=packLoadingWorkflow(request);
    expect(plan.metrics.loadedCount).toBe(9);
    expect(plan.setSummaries[0].loadedSets).toBe(3);
    expect(plan.pallets!.map(p=>plan.placements.filter(b=>b.palletIds?.includes(p.id)).length)).toEqual([6,3]);
  });

  it("previews an open pallet at the door limit, leaving a crate's fixed dimensions intact", () => {
    const crate = oneLayerCrateFixture().palletBuild!.config;
    const request = palletHeightFixture();
    request.palletBuild!.additionalSpecs=[{id:"crate",config:crate,maxPallets:5,stackLayers:1,maxTopLoadKg:0}];
    const adjusted=withVehiclePalletHeights(request.palletBuild!,["primary","crate"]);
    expect(adjusted.config.maxCargoHeight).toBe(0);
    expect(adjusted.additionalSpecs![0].config.maxCargoHeight).toBe(125);
    expect(request.palletBuild!.config.maxCargoHeight).toBe(120);
    const plan=packLoadingWorkflow({...request,palletBuild:adjusted});
    expect(plan.placements.some(b=>b.layer>1)).toBe(true);
  });

  it("honors supplied carton layers, cumulative bearing and rated payload", () => {
    const request=oneLayerCrateFixture();
    expect(()=>previewPalletRecipe(input(request,24))).toThrow(/超过每托承重/);
    request.container.length=2700;
    const oneLayer={...request,products:[{...request.products[0],maxStackLayers:1}]};
    expect(()=>previewPalletRecipe(input(oneLayer))).toThrow(/未找到目标尺寸/);
    const rating={...request,products:[{...request.products[0],maxTopLoadKg:0}]};
    expect(()=>previewPalletRecipe(input(rating))).toThrow(/未找到目标尺寸/);
  });

  it("preserves the physical limits of fixed crates and takes loose reservations into account", () => {
    const request=oneLayerCrateFixture();
    request.products[0].quantity=11;
    request.palletBuild!.looseQuantities={long:4};
    const draft=input(request);
    expect(previewPalletRecipe(draft).orderCartons).toBe(7);
    expect(previewPalletRecipe({...draft,mode:"current"}).sampleCartons).toBe(7);
    const spec={...draft.spec,config:{...draft.spec.config,maxCargoHeight:2600}};
    expect(()=>previewPalletRecipe({...draft,mode:"current",spec})).toThrow(/木箱外部总高/);
    expect(packagingInterior(draft.spec.config)).toMatchObject({crate:true,lid:30,inset:30});
  });

  it.each([0, 1.5, 1001, "20"])("rejects an invalid persisted limit %s", cartonLimit => {
    const {palletBuild}=oneLayerCrateFixture();
    expect(()=>parsePalletBuild({...palletBuild,primaryRule:{maxPallets:50,cartonLimit}})).toThrow(/每托箱数/);
  });
});

it.each(["practical","maximum"] as const)("retains two product-specific pallet recipes with loose cartons in %s",strategy=>{
 const request={...oneLayerCrateFixture(),strategy},p=request.products[0];
 request.products=[{...p,id:"shed",sku:"SHED-101",length:1100,width:550,height:120,weight:40,quantity:4,setCode:undefined},
 {...p,id:"bed",sku:"BED-205",length:600,width:400,height:160,weight:28,quantity:4,setCode:undefined},
 {...p,id:"parcel",sku:"PARCEL-310",length:300,width:300,height:300,weight:8,quantity:4,setCode:undefined}];
 let build={...request.palletBuild!,looseQuantities:{parcel:4},additionalSpecs:undefined,primaryRule:undefined};
 for(const id of ["shed","bed"]){
  const preview=previewPalletRecipe({request:{...request,palletBuild:build},spec:{...palletSpecifications(build)[0],productIds:[id]},groupKey:`sku:${id}`,cartons:2,mode:"suggest"});
  expect(preview.placements).toHaveLength(2);
  build=withPalletRecipe(build,"primary",{config:{...preview.config,name:id},cartonLimit:2,productIds:[id],automaticQuantity:true}) as typeof build;
 }
 const specs=palletSpecifications(build);expect(specs).toHaveLength(2);expect(specs.map(s=>s.productIds)).toEqual([["shed"],["bed"]]);
 const plan=packLoadingWorkflow({...request,palletBuild:parsePalletBuild(build)});
 expect(plan.validation.valid).toBe(true);expect(plan.metrics.loadedCount).toBe(12);
 expect(new Set(plan.pallets?.map(p=>p.specificationId)).size).toBe(2);
 expect(plan.placements.filter(p=>!p.palletIds?.length)).toHaveLength(4);
 expect(plan.placements.filter(p=>p.palletIds?.length)).toHaveLength(8);
 expect(plan.pallets).toHaveLength(4);
});
