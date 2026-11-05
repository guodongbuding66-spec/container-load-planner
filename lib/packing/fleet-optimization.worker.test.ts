import {afterEach,expect,it,vi} from "vitest";
import {fleetTailFixture} from "../../tests/fleet-tail-fixture";
import {prepareFleetOptimization,type FleetOptimizationSettings} from "./fleet-optimization";
afterEach(()=>{vi.unstubAllGlobals();vi.resetModules();});
const settings:FleetOptimizationSettings={mode:"reallocate",keepPrefix:0,cartonBudget:4,comparePackaging:false,rework:{dismantle:0,rebuild:0,source:"QA free work"}};
it("initializes once and solves exactly one explicitly acknowledged vector",async()=>{
 const worker={onmessage:null as ((e:MessageEvent)=>void)|null,postMessage:vi.fn()};vi.stubGlobal("self",worker);await import("./fleet-optimization.worker");const source=fleetTailFixture(),p=prepareFleetOptimization(source,settings);
 worker.onmessage!({data:{type:"initialize",source,settings}} as MessageEvent);expect(worker.postMessage).toHaveBeenCalledExactlyOnceWith({type:"ready"});worker.onmessage!({data:{type:"solve",index:0,spec:p.seeds[0]}} as MessageEvent);expect(worker.postMessage).toHaveBeenCalledTimes(2);expect(worker.postMessage.mock.calls[1][0]).toMatchObject({type:"result",index:0,result:{complete:true}});
 worker.onmessage!({data:{type:"solve",index:0,spec:p.seeds[0]}} as MessageEvent);expect(worker.postMessage.mock.calls.at(-1)![0]).toMatchObject({type:"error"});
});
it("rejects solving before source initialization",async()=>{
 const worker={onmessage:null as ((e:MessageEvent)=>void)|null,postMessage:vi.fn()};vi.stubGlobal("self",worker);await import("./fleet-optimization.worker");worker.onmessage!({data:{type:"solve",index:0,spec:{units:[1],selection:"ordered"}}} as MessageEvent);expect(worker.postMessage).toHaveBeenCalledExactlyOnceWith({type:"error",message:"Invalid optimization acknowledgement"});
});
