/// <reference lib="webworker" />
import { allocateFleet, compareFleets, proposeOrderTopUp, type FleetOption } from "./fleet";
import type {FleetPricing} from "./fleet-costs";
import type { PackingRequest } from "./types";
self.onmessage = (event: MessageEvent<{request: PackingRequest; options: FleetOption[]; limit: number; objective: "count" | "cost"; compare?: boolean; topUp?:number; pricing?:FleetPricing}>) => {
  const {request,options,limit,objective}=event.data;
  try {
    if(event.data.compare){
      const comparisons=compareFleets(request,options,limit,objective,comparisons=>self.postMessage({type:"comparisons",comparisons}),event.data.pricing);
      let proposal=null,proposalError="";
      // An optional top-up failure must not discard completed fleet schedules.
      try{if(event.data.topUp&&comparisons[0]?.result.complete)proposal=proposeOrderTopUp(request,comparisons[0].result,options,event.data.topUp,event.data.pricing);}
      catch(error){proposalError=error instanceof Error?error.message:"加货建议未完成";}
      self.postMessage({type:"comparison-result",comparisons,proposal,proposalError});return;
    }
    const result=allocateFleet(request,options,limit,objective,result=>self.postMessage({type:"progress",result}),event.data.pricing);
    self.postMessage({type:"result",result});
  } catch(error) { self.postMessage({type:"error",message:error instanceof Error?error.message:"多柜分配失败"}); }
};
export {};
