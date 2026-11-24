import {it,expect} from "vitest";
import {CONTAINER_PRESETS} from "./presets";
import {DEMO_PRODUCTS,DEMO_ACCESS,demoPalletBuild} from "./demo-order";
import {packLoadingWorkflow} from "./pack-loading";
import {reviewPlan} from "./plan-review";
it("checks the introductory palletized example with real access routes",()=>{
 const products=structuredClone(DEMO_PRODUCTS),build=demoPalletBuild();
 for(const strategy of ["practical","maximum"] as const){const plan=packLoadingWorkflow({workflow:"palletized",mode:"mixed",strategy,container:CONTAINER_PRESETS[2],clearance:10,products,palletBuild:build,accessConfig:DEMO_ACCESS});
  expect(plan.validation.valid).toBe(true);
  expect(plan.metrics.loadedCount).toBe(144);
  expect(plan.metrics.centerOfGravity.balanced).toBe(true);
  expect(reviewPlan(plan,products).checks.find(c=>c.id==="path")).toMatchObject({state:"pass"});
 }
},30000);
