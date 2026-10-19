import {repackPalletContents} from "./pallet-repack";
self.onmessage=e=>{
  try{const {plan,products,id}=e.data;self.postMessage({ok:true,result:repackPalletContents(plan,products,id)});}
  catch(e){self.postMessage({ok:false,error:e instanceof Error?e.message:String(e)});}
};
