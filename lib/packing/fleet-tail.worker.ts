/// <reference lib="webworker" />
import {allocateFleet} from "./fleet";
import type {PreparedFleetTail} from "./fleet-tail";
self.onmessage=(event:MessageEvent<{trials:PreparedFleetTail["trials"]}>)=>{
 try{for(const [index,trial] of event.data.trials.entries()){
  const v=trial.value,result=allocateFleet(v.request,v.options,v.limit,v.objective,undefined,v.pricing);
  self.postMessage({index,result});
 }}catch(error){self.postMessage({error:error instanceof Error?error.message:"Fleet tail trial failed"});}
};
export {};
