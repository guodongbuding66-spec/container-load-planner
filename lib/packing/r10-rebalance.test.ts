import {describe,it,expect} from "vitest";
import {pack,revisePackingResult} from "./engine";
import {rebalancePackingPlan} from "./rebalance-plan";
import {computeCenterOfGravity} from "./vgm-cog";
import type {ContainerSpec,ProductInput} from "./types";
const c:ContainerSpec={id:"r10",name:"R10",length:4000,width:2000,height:2000,doorWidth:2000,doorHeight:2000,maxWeight:10000};
const p:ProductInput={id:"a",sku:"a",name:"a",length:500,width:500,height:300,weight:10,quantity:4,priority:50,rotationPolicy:"fixed",stackable:true,maxStackLayers:0,color:"#123456"};
const make=()=>pack({container:c,products:[p],mode:"mixed",workflow:"direct",strategy:"maximum",clearance:10});
describe("Actual CoG position balancing",()=>{
 it("moves actual coordinates, preserves identities and validates supports and count",()=>{
  const plan=make(),before=JSON.stringify(plan),out=rebalancePackingPlan(plan,[p]);
  expect(out.changed).toBe(true);expect(out.after).toBeLessThan(out.before);expect(out.plan.validation.valid).toBe(true);
  expect(out.plan.metrics.loadedCount).toBe(4);expect(out.plan.metrics.grossWeight).toBe(40);
  expect(new Set(out.plan.placements.map(b=>b.id))).toEqual(new Set(plan.placements.map(b=>b.id)));
  expect(JSON.stringify(plan)).toBe(before);expect(out.plan.metrics.centerOfGravity.longitudinalRatio).toBeCloseTo(.5);
 });
 it("respects locked cargo and reports unchanged rather than fake success",()=>{
  const plan=make(),locked=revisePackingResult(plan,plan.placements.map(b=>({...b,locked:true})),[p]);
  const out=rebalancePackingPlan(locked,[p]);expect(out.changed).toBe(false);expect(out.reason).toBe("constrained");expect(out.plan).toBe(locked);
 });
 it("uses the same usable-space CG values in both result displays",()=>{
  const plan=make(),r=computeCenterOfGravity(plan);
  expect(r.cogXPct).toBeCloseTo(plan.metrics.centerOfGravity.longitudinalRatio*100,0);
  expect(r.cogXMm).toBe(Math.round(plan.metrics.centerOfGravity.x));
  expect(r.status==="balanced").toBe(plan.metrics.centerOfGravity.balanced);
 });
});
