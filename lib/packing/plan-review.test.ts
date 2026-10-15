import { expect, it } from "vitest";
import { pack } from "./engine";
import { reviewPlan } from "./plan-review";
import { DEFAULT_ACCESS } from "./maneuver";
import type { ProductInput } from "./types";

const product: ProductInput = { id:"p", sku:"P", name:"P", length:100, width:100, height:100, weight:10, quantity:1, priority:50, rotationPolicy:"fixed", stackable:true, maxStackLayers:0, color:"#338877" };
const make = (p=product) => pack({mode:"mixed",strategy:"maximum",container:{id:"c",name:"C",length:300,width:300,height:300,doorWidth:300,doorHeight:300,maxWeight:100},clearance:0,products:[p]});
const check = (plan:ReturnType<typeof make>, id:string, products:ProductInput[]|undefined=[product]) => reviewPlan(plan,products).checks.find(c=>c.id===id)!;

it("keeps geometry passed while missing bearing ratings and securing remain unverified",()=>{
  const plan=make(),before=JSON.stringify(plan),review=reviewPlan(plan,[product]);
  expect(check(plan,"geometry").state).toBe("pass");expect(check(plan,"bearing").state).toBe("unverified");
  expect(check(plan,"path").state).toBe("unverified");expect(check(plan,"securing").state).toBe("unverified");
  expect(review.state).toBe("unverified");expect(JSON.stringify(plan)).toBe(before);
});
it("distinguishes data discrepancies, missing sources and actual static overload",()=>{
  const p={...product,maxTopLoadKg:5},plan=make(p),lower={...plan.placements[0],id:"lower",z:0},upper={...lower,id:"upper",z:100};
  plan.placements=[lower,upper];expect(check(plan,"bearing",[p]).state).toBe("fail");
  expect(check(plan,"data",[p]).state).toBe("fail");expect(reviewPlan(make()).checks.find(c=>c.id==="bearing")?.state).toBe("unverified");
});
it("separates declared straight access from unavailable handling-equipment verification",()=>{
  const plan=make();plan.delivery={p:{customer:"A",destination:"A",stop:1}};
  expect(check(plan,"path").state).toBe("pass");expect(check(plan,"path").model).toBe("straight-rear");
  expect(check(plan,"path").scope[0]).toContain("叉车");
  plan.container.doorHeight=50;expect(check(plan,"path").state).toBe("fail");
  plan.accessConfig={...DEFAULT_ACCESS,maneuver:true,budget:1};
  expect(check(plan,"path").state).toBe("unverified");expect(check(plan,"path").scope[0]).toContain("不等于绝对不可装");
});
it("does not claim vehicle access for pallet-only work or a partially saved coordinate plan",()=>{
  const plan=make();plan.workflow="pallet-only";expect(check(plan,"path").state).toBe("not-applicable");
  plan.workflow="direct";plan.metrics.loadedCount=2;
  expect(check(plan,"geometry").state).toBe("unverified");expect(check(plan,"path").state).toBe("unverified");
  plan.placements=[];expect(check(plan,"geometry").state).toBe("unverified");
});
it("marks skipped access work unverified when a complete snapshot exceeds the automatic budget",()=>{
  const plan=make(),box=plan.placements[0];
  plan.placements=Array.from({length:241},(_,i)=>({...box,id:`box-${i}`}));plan.metrics.loadedCount=241;
  expect(check(plan,"path").state).toBe("unverified");expect(check(plan,"path").model).toBe("review-budget");
});
it("keeps an enclosing crate's frame strength unverified even with carton ratings",()=>{
  const plan=make({...product,maxTopLoadKg:100});
  plan.pallets=[{id:"crate",presetId:"custom",name:"Crate",x:0,y:0,z:0,dx:200,dy:200,dz:20,enclosureHeight:220,weight:10,maxLoad:100,orientation:"LWH",packaging:{base:"solid",enclosure:"panel",material:"wood",color:"#a98765",opacity:1,deckBoards:5,runners:3,wallThickness:10,lid:true}}];
  expect(check(plan,"bearing",[{...product,maxTopLoadKg:100}]).state).toBe("unverified");expect(check(plan,"bearing").items).toContain("crate");
});
