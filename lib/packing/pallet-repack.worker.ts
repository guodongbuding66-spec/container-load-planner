import {repackPalletContents} from "./pallet-repack";
import {refillPalletContents} from "./pallet-refill";
import type {PackingResult,ProductInput} from "./types";
self.onmessage=(event:MessageEvent<{plan:PackingResult;products:ProductInput[];id:string;operation?:"refill"}>)=>{
  const {plan,products,id,operation}=event.data;
  try{
    const result=operation==="refill"?refillPalletContents(plan,products,id):repackPalletContents(plan,products,id);
    self.postMessage({ok:true,result});
  }catch(error){self.postMessage({ok:false,error:error instanceof Error?error.message:String(error)});}
};
