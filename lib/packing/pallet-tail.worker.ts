/// <reference lib="webworker" />
import {runOrderCapacityTrial,type OrderCapacityTrial} from "./order-capacity";
self.onmessage=(e:MessageEvent<{trials:OrderCapacityTrial[]}>)=>{
 for(const [index,trial] of e.data.trials.entries()){
  try{self.postMessage({index,plan:runOrderCapacityTrial(trial)});}
  catch(error){self.postMessage({index,error:error instanceof Error?error.message:String(error)});}
 }
};
