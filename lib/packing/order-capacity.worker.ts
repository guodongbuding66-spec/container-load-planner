/// <reference lib="webworker" />
import {runOrderCapacityTrial,type OrderCapacityTrial} from "./order-capacity";
self.onmessage=(e:MessageEvent<OrderCapacityTrial>)=>{try{self.postMessage({plan:runOrderCapacityTrial(e.data)});}catch(error){self.postMessage({error:error instanceof Error?error.message:String(error)});}};
