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
});
