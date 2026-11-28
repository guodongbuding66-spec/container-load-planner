import {describe,it,expect} from "vitest";
import {designEconomicalPallet} from "./smart-pallet-designer";
import {SAMPLE_PRODUCTS} from "./presets";
const base={...SAMPLE_PRODUCTS[0],length:600,width:400,height:300,weight:10,quantity:1};
describe("Independent pallet design physical and order-cost invariants",()=>{
 it("does not recommend cargo taller than the total pallet height limit",()=>{
  expect(designEconomicalPallet({...base,height:3000},2200).options).toHaveLength(0);
 });
 it("does not stack a non-stackable carton",()=>{
  expect(designEconomicalPallet({...base,stackable:false},2200).options.every(o=>o.layers===1)).toBe(true);
 });
 it("treats an explicit zero top-load rating as no cargo above",()=>{
  expect(designEconomicalPallet({...base,maxTopLoadKg:0},2200).options.every(o=>o.layers===1)).toBe(true);
 });
 it("does not recommend even one carton exceeding every dynamic catalog rating",()=>{
  expect(designEconomicalPallet({...base,weight:2000},2200).recommended).toBeNull();
 });
 it("preserves fixed horizontal orientation",()=>{
  expect(designEconomicalPallet({...base,length:900,width:1150,rotationPolicy:"fixed"}).options).toHaveLength(0);
 });
 it("reports actual order packaging cost per carton, including a partial last pallet",()=>{
  const report=designEconomicalPallet(base);
  expect(report.options.length).toBeGreaterThan(0);
  for(const o of report.options)expect(o.costPerCartonUsd).toBeCloseTo(o.totalPalletCostUsd/base.quantity,3);
 });
 it("does not create payable pallets for zero order quantity",()=>{
  for(const o of designEconomicalPallet({...base,quantity:0}).options){expect(o.palletsNeededForOrder).toBe(0);expect(o.totalPalletCostUsd).toBe(0);}
 });
 it("rejects invalid geometry instead of creating a zero-height loading plan",()=>{
  expect(designEconomicalPallet({...base,height:0}).options).toHaveLength(0);
 });
 it("preserves full bottom support by default even when overhang is permitted",()=>{
  const report=designEconomicalPallet({...base,length:500,width:400},2200,100);
  for(const o of report.options)for(const b of o.layerLayout){
   expect(b.x).toBeGreaterThanOrEqual(-1e-6);expect(b.y).toBeGreaterThanOrEqual(-1e-6);
   expect(b.x+b.dx).toBeLessThanOrEqual(o.pallet.lengthMm+1e-6);expect(b.y+b.dy).toBeLessThanOrEqual(o.pallet.widthMm+1e-6);
  }
 });
 it("centers an explicitly permitted 80% supported overhanging layer",()=>{
  const option=designEconomicalPallet({...base,length:500,width:400,minimumSupportRatio:.8},2200,100).options.find(o=>o.pallet.id==="eur1");
  expect(option?.cartonsPerLayer).toBe(6);
  for(const b of option!.layerLayout){
   const area=Math.max(0,Math.min(b.x+b.dx,1200)-Math.max(b.x,0))*Math.max(0,Math.min(b.y+b.dy,800)-Math.max(b.y,0));
   expect(area/(b.dx*b.dy)).toBeGreaterThanOrEqual(.8-1e-6);
  }
 });

});
