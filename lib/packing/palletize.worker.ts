import { palletizeThenPack } from "./palletize";
self.onmessage=e=>{try{const {request,config,mix,limit,build}=e.data;self.postMessage({ok:true,result:palletizeThenPack(request,config,mix,limit,build)});}catch(e){self.postMessage({ok:false,error:e instanceof Error?e.message:String(e)});}};
