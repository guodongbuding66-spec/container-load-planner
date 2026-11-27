import {expect,it} from "vitest";
import {DEMO_PRODUCTS} from "./demo-order";
import {DEFAULT_PALLET_BUILD,parsePalletBuild} from "./loading-workflow";
import {CONTAINER_PRESETS} from "./presets";
import {packLoadingWorkflow} from "./pack-loading";
import {palletSpecifications,MAX_PACKAGING_SPECIFICATIONS} from "./pallet-specifications";
import {withPalletRecipe} from "./pallet-recipe";
import type {PackingRequest} from "./types";

function fixture():PackingRequest {
 const build=structuredClone(DEFAULT_PALLET_BUILD);
 Object.assign(build.config,{length:1200,width:2300,height:144,weight:25,maxCargoHeight:1800,maxLoad:1000,gap:0});
 return {mode:"mixed",workflow:"palletized",strategy:"maximum",container:{...CONTAINER_PRESETS[2]},clearance:10,palletBuild:build,products:structuredClone(DEMO_PRODUCTS)};
}

it("sizing 18 SHED cartons retains the shared packaging and all 114 other cartons",()=>{
 const r=fixture(),original=structuredClone(r.palletBuild!);
 const patch={config:{...r.palletBuild!.config,length:2200,width:1240,maxCargoHeight:1620},cartonLimit:18,productIds:[r.products[0].id],automaticQuantity:true};
 const next=withPalletRecipe(r.palletBuild!,"primary",patch,r.products);
 expect(r.palletBuild).toEqual(original);
 const specs=palletSpecifications(next);
 expect(specs).toHaveLength(2);
 expect(specs.find(s=>s.productIds?.includes(r.products[1].id))?.config).toEqual(original.config);
 const plan=packLoadingWorkflow({...r,palletBuild:parsePalletBuild(next)});
 expect(plan.validation.valid).toBe(true);
 expect(plan.summaries.map(s=>s.loaded)).toEqual([30,66,48]);
 expect(plan.metrics.loadedCount).toBe(144);
});

it("successive product designs partition a shared fallback without stealing another SKU",()=>{
 const r=fixture();let build=r.palletBuild!;
 for(const product of r.products){
  build=withPalletRecipe(build,"primary",{config:{...build.config,name:product.sku},productIds:[product.id],cartonLimit:6,automaticQuantity:true},r.products);
 }
 const specs=palletSpecifications(build);
 expect(specs).toHaveLength(3);
 for(const p of r.products){
  const eligible=specs.filter(s=>s.maxPallets>0&&(!s.productIds||s.productIds.includes(p.id)));
  expect(eligible).toHaveLength(1);
  expect(eligible[0].config.name).toBe(p.sku);
 }
 expect(()=>parsePalletBuild(build)).not.toThrow();
});

it("refuses splitting at the specification cap without losing the saved shared design",()=>{
 const r=fixture(),build=r.palletBuild!,primary=palletSpecifications(build)[0];
 build.additionalSpecs=Array.from({length:MAX_PACKAGING_SPECIFICATIONS-1},(_,i)=>({...structuredClone(primary),id:`qa-${i}`,maxPallets:0}));
 const before=structuredClone(build);
 expect(()=>withPalletRecipe(build,"primary",{productIds:[r.products[0].id],cartonLimit:18},r.products)).toThrow(/规格|specification/);
 expect(build).toEqual(before);
});
