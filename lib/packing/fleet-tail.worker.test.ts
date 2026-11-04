import {afterEach,expect,it,vi} from "vitest";
import {fleetTailFixture} from "../../tests/fleet-tail-fixture";
import {prepareFleetTail} from "./fleet-tail";
afterEach(()=>{vi.unstubAllGlobals();vi.resetModules();});
it("solves only one fleet until the reviewed result is acknowledged, then advances exactly once",async()=>{
 const worker={onmessage:null as ((e:MessageEvent)=>void)|null,postMessage:vi.fn()};vi.stubGlobal("self",worker);await import("./fleet-tail.worker");const p=prepareFleetTail(fleetTailFixture(),"row:p",2);
 worker.onmessage!({data:{trials:p.trials}} as MessageEvent);expect(worker.postMessage).toHaveBeenCalledOnce();expect(worker.postMessage.mock.calls[0][0]).toMatchObject({index:0,result:{complete:true}});
 worker.onmessage!({data:{type:"next"}} as MessageEvent);expect(worker.postMessage).toHaveBeenCalledTimes(2);expect(worker.postMessage.mock.calls[1][0]).toMatchObject({index:1,result:{complete:true}});
 worker.onmessage!({data:{type:"next"}} as MessageEvent);expect(worker.postMessage).toHaveBeenCalledTimes(2);
});
it("rejects oversized batches before starting the allocator",async()=>{
 const worker={onmessage:null as ((e:MessageEvent)=>void)|null,postMessage:vi.fn()};vi.stubGlobal("self",worker);await import("./fleet-tail.worker");worker.onmessage!({data:{trials:Array(65).fill(null)}} as MessageEvent);expect(worker.postMessage).toHaveBeenCalledExactlyOnceWith({error:"Invalid fleet tail batch"});
});
