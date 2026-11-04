/// <reference lib="webworker" />
import {allocateFleet} from "./fleet";
import type {PreparedFleetTail} from "./fleet-tail";
let batch:{trials:PreparedFleetTail["trials"];index:number}|null=null;
self.onmessage=(event:MessageEvent<{trials?:PreparedFleetTail["trials"];type?:"next"}>)=>{
 try{
  if(event.data.trials){
   if(!Array.isArray(event.data.trials)||event.data.trials.length<1||event.data.trials.length>64||batch)throw Error("Invalid fleet tail batch");
   batch={trials:event.data.trials,index:0};
  }else if(event.data.type!=="next")throw Error("Invalid fleet tail acknowledgement");
  if(!batch||batch.index>=batch.trials.length)return;
  const index=batch.index++,v=batch.trials[index].value,result=allocateFleet(v.request,v.options,v.limit,v.objective,undefined,v.pricing);
  // The main thread independently reviews this result before acknowledging the next one.
  self.postMessage({index,result});
 }catch(error){batch=null;self.postMessage({error:error instanceof Error?error.message:"Fleet tail trial failed"});}
};
export {};
