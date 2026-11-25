import {it,expect} from "vitest";
import {CONTAINER_PRESETS,SAMPLE_PRODUCTS} from "./presets";
import {DEMO_PRODUCTS,DEMO_ACCESS,demoPalletBuild,isDemoOrder} from "./demo-order";
import {packLoadingWorkflow} from "./pack-loading";
import {reviewPlan} from "./plan-review";
it("checks the introductory palletized example with real access routes",()=>{
 const products=structuredClone(DEMO_PRODUCTS),build=demoPalletBuild();
 for(const strategy of ["practical","maximum"] as const){const plan=packLoadingWorkflow({workflow:"palletized",mode:"mixed",strategy,container:CONTAINER_PRESETS[2],clearance:10,products,palletBuild:build,accessConfig:DEMO_ACCESS});
  expect(plan.validation.valid).toBe(true);
  expect(plan.metrics.loadedCount).toBe(144);
  expect(plan.metrics.centerOfGravity.balanced).toBe(true);
  const review=reviewPlan(plan,products);
  expect(review.checks.find(c=>c.id==="path")).toMatchObject({state:"pass"});
  expect(review.failed).toBe(0);
  expect(review.checks.find(c=>c.id==="securing")).toMatchObject({state:"unverified"});
 }
},30000);
it("distinguishes the saved 116-carton legacy example without replacing its inputs",()=>{
 const legacy=structuredClone(SAMPLE_PRODUCTS),before=JSON.stringify(legacy);
 expect(legacy.reduce((sum,p)=>sum+p.quantity,0)).toBe(116);
 expect(isDemoOrder(legacy)).toBe(false);
 expect(isDemoOrder(structuredClone(DEMO_PRODUCTS))).toBe(true);
 expect(DEMO_PRODUCTS.reduce((sum,p)=>sum+p.quantity,0)).toBe(144);
 expect(JSON.stringify(legacy)).toBe(before);
});
