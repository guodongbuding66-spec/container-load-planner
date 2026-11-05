/// <reference lib="webworker" />
import {prepareFleetOptimization,solveFleetOptimizationTrial,type PreparedFleetOptimization,type FleetOptimizationSettings,type FleetOptimizationSpec} from "./fleet-optimization";
import type {FleetSnapshot} from "./fleet-tail";
let prepared:PreparedFleetOptimization|undefined,index=0;
self.onmessage=(event:MessageEvent<{type:string;source?:FleetSnapshot;settings?:FleetOptimizationSettings;index?:number;spec?:FleetOptimizationSpec}>)=>{
 try{
  const data=event.data;
  if(data.type==="initialize"){
   if(prepared||!data.source||!data.settings)throw Error("Invalid optimization initialization");
   prepared=prepareFleetOptimization(data.source,data.settings);self.postMessage({type:"ready"});return;
  }
  if(data.type!=="solve"||!prepared||data.index!==index||index>=64||!data.spec)throw Error("Invalid optimization acknowledgement");
  const result=solveFleetOptimizationTrial(prepared,data.spec);self.postMessage({type:"result",index:index++,result});
 }catch(error){prepared=undefined;self.postMessage({type:"error",message:error instanceof Error?error.message:"Fleet optimization failed"});}
};
export {};
