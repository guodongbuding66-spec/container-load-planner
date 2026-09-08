/// <reference lib="webworker" />
import { allocateFleet, type FleetOption } from "./fleet";
import type { PackingRequest } from "./types";
self.onmessage = (event: MessageEvent<{request: PackingRequest; options: FleetOption[]; limit: number; objective: "count" | "cost"}>) => {
  const {request,options,limit,objective}=event.data;
  try {
    const result=allocateFleet(request,options,limit,objective,result=>self.postMessage({type:"progress",result}));
    self.postMessage({type:"result",result});
  } catch(error) { self.postMessage({type:"error",message:error instanceof Error?error.message:"多柜分配失败"}); }
};
export {};
