/// <reference lib="webworker" />
import { deriveDimensionScenario, buildDimensionComparison } from "./dimension-scenarios";
import { packLoadingWorkflow } from "./pack-loading";
import type { PackingRequest, PackingResult } from "./types";
self.onmessage=(event:MessageEvent<{request:PackingRequest;nominal:PackingResult}>)=>{
  try{const {request,nominal}=event.data;const scenario=deriveDimensionScenario(request,"conservative");
    self.postMessage({type:"result",payload:buildDimensionComparison(request,nominal,packLoadingWorkflow(scenario.request))});
  }catch(e){self.postMessage({type:"error",message:e instanceof Error?e.message:String(e)});}
};
export {};
