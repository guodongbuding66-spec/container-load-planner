import {expect,it} from "vitest";
import {fleetTailFixture} from "../../tests/fleet-tail-fixture";
import {restorePackingSnapshot} from "./engine";
import {allocateFleet,finishFleet} from "./fleet";
import {fleetPool} from "./fleet-inventory";
import {adoptFleetOptimization,createFleetOptimizationSearch,prepareFleetOptimization,reviewFleetOptimization,solveFleetOptimizationTrial,type FleetOptimizationSettings} from "./fleet-optimization";
import {parseFleetBackup,serializeFleetBackup} from "./fleet-file";
import type {PackingStrategy} from "./types";

const settings:FleetOptimizationSettings={mode:"fill-units",keepPrefix:0,cartonBudget:2,comparePackaging:false,rework:{dismantle:null,rebuild:4,source:"Packing bench quote"}};

function source(strategy:PackingStrategy="maximum",originalAtRear=false){
 const s=fleetTailFixture(strategy),request=s.request,build=request.palletBuild!;
 const first={...request.products[0],quantity:4},second={...first,id:"tail",sku:"SMALL",name:"Remaining cartons",quantity:2};
 request.products=[first,second];request.container.length=1700;request.practicalTargetUtilization=.95;
 build.looseQuantities=undefined;build.maxPallets=2;build.config.gap=0;
 build.primaryRule={maxPallets:1,productIds:[first.id]};
 build.additionalSpecs=[{id:"small",config:{...build.config,name:"Half pallet",length:500,weight:8},maxPallets:1,stackLayers:1,maxTopLoadKg:0,productIds:[second.id]}];
 s.limit=1;s.pricing={currency:"CNY",packaging:{primary:5,small:3}};
 const baseline=allocateFleet({...request,products:[first,{...second,quantity:0}]},s.options,1,"count",undefined,s.pricing).loads[0];
 const x=originalAtRear?700:0;
 const plan=restorePackingSnapshot(fleetPool(request).request,{...baseline.plan,
  pallets:baseline.plan.pallets!.map(p=>({...p,x:p.x+x,locked:true})),
  placements:baseline.plan.placements.map(b=>({...b,x:b.x+x,locked:true})),
 });
 s.result=finishFleet(request,[{...baseline,plan}],"Controlled partially committed load",s.pricing);
 return s;
}

it.each(["practical","maximum"] as const)("fills a floor gap with an intact unit under %s and replays the adopted fleet",strategy=>{
 const before=source(strategy),prepared=prepareFleetOptimization(before,settings),search=createFleetOptimizationSearch(prepared);
 for(let trial=search.next();trial;trial=search.next())search.accept(trial.index,solveFleetOptimizationTrial(prepared,trial.spec));
 const report=search.finish(),accepted=adoptFleetOptimization(prepared,report);
 expect(report.candidates[report.bestIndex!]).toMatchObject({loaded:6,packaging:2,loose:0,rebuilt:1,dismantled:0,reworkTotal:4,configuredTotal:112});
 const after=accepted.result.loads[0].plan,old=before.result.loads[0].plan;
 expect(after.pallets?.[0]).toEqual(old.pallets?.[0]);
 expect(after.pallets?.[1]).toMatchObject({specificationId:"small",x:1000,z:0});
 for(const carton of old.placements)expect(after.placements.find(b=>b.id===carton.id)).toEqual(carton);
 expect(accepted.request).toEqual(before.request);
 expect(parseFleetBackup(serializeFleetBackup(accepted)).result.complete).toBe(true);
},15_000);

it("keeps a front gap empty when the old pallet blocks straight entry",()=>{
 const prepared=prepareFleetOptimization(source("maximum",true),settings),spec={units:[2],selection:"ordered" as const};
 const result=solveFleetOptimizationTrial(prepared,spec);
 expect(result.loads[0].plan.placements).toHaveLength(4);
 expect(reviewFleetOptimization(prepared,spec,0,result).summary.improves).toBe(false);
});

it("preserves the unused loose quota and requires a preparation quote for cost priority",()=>{
 const before=source();before.objective="cost";
 expect(()=>prepareFleetOptimization(before,{...settings,rework:{...settings.rework,rebuild:null}})).toThrow(/quote/);
 expect(()=>prepareFleetOptimization(before,{...settings,keepPrefix:1})).toThrow(/remaining/);
 const request=before.request;request.palletBuild!.looseQuantities={tail:1};
 const load=before.result.loads[0];
 const local=fleetPool(request).request;
 const plan=restorePackingSnapshot(local,{...load.plan,palletBuild:local.palletBuild,palletization:{...load.plan.palletization!,looseQuantities:{tail:1}}});
 before.result=finishFleet(request,[{...load,plan}],"Test reservation",before.pricing);
 expect(prepareFleetOptimization(before,settings).groups).toMatchObject([{ceiling:1}]);
});
