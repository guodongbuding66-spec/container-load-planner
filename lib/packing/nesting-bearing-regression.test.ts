import {describe, expect, it} from "vitest";
import {pack, validatePacking} from "./engine";
import {CONTAINER_PRESETS, SAMPLE_PRODUCTS} from "./presets";
import type {PackingMode, PackingStrategy, ProductInput} from "./types";

const container = {...CONTAINER_PRESETS[0], length:1000,width:800,height:1200,doorWidth:800,doorHeight:1200,maxWeight:100000};
const nested:ProductInput = {...SAMPLE_PRODUCTS[0],id:"NEST-QA",sku:"NEST-QA",length:500,width:400,height:300,weight:10,quantity:1000,rotationPolicy:"fixed",stackable:true,maxStackLayers:0,nestingDeltaHeightMm:100};
const modes: PackingMode[] = ["single","mixed"];
const strategies: PackingStrategy[] = ["maximum","practical"];
for(const mode of modes) for(const strategy of strategies) describe(`${mode} ${strategy} nested cargo`,()=>{
 const solve=(product:ProductInput)=>pack({container,products:[product],clearance:0,mode,strategy,practicalTargetUtilization:0.95});
 it("uses incremental volume and retains nominal geometry",()=>{
   const r=solve(nested);
   expect(r.validation.valid).toBe(true);
   expect(r.placements).toHaveLength(strategy==="maximum"?40:37);
   expect(r.placements.every(b=>b.dz===300)).toBe(true);
 });
 it("zero top load forbids nested stacks",()=>{
   const r=solve({...nested,maxTopLoadKg:0});
   expect(r.validation.valid).toBe(true);
   expect(r.placements).toHaveLength(4);
   expect(r.placements.every(b=>b.z===0)).toBe(true);
 });
 it("propagates cumulative 20kg top load through each nested column",()=>{
   const r=solve({...nested,maxTopLoadKg:20});
   expect(r.validation.valid).toBe(true);
   expect(r.placements).toHaveLength(12);
   expect(Math.max(...r.placements.map(b=>b.layer))).toBe(3);
 });
 it("rejects a nested stack that exceeds the declared top load",()=>{
   const r=solve(nested);
   expect(validatePacking(r.placements,container,0,[{...nested,maxTopLoadKg:0}],strategy,mode).valid).toBe(false);
 });
 it("honors the direct above-SKU whitelist",()=>{
   const r=solve({...nested,allowedAboveSkus:[]});
   expect(r.validation.valid).toBe(true);
   expect(r.placements).toHaveLength(4);
 });
});
