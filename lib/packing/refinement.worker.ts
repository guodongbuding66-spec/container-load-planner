/// <reference lib="webworker" />
import { improvePacking } from "./engine";
import type { PackingResult, ProductInput } from "./types";
self.onmessage=(e:MessageEvent<{plan:PackingResult;products:ProductInput[];start:number;passes:number}>)=>{
  let best=e.data.plan;
  try{for(let i=0;i<e.data.passes;i++){best=improvePacking(best,e.data.products,e.data.start+i);self.postMessage({type:"progress",plan:best,pass:e.data.start+i+1});}self.postMessage({type:"done",plan:best});}
  catch(e){self.postMessage({type:"error",message:e instanceof Error?e.message:"优化失败"});}
};export {};
