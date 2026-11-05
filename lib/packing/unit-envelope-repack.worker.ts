import {repackMeasuredUnits} from "./unit-envelope-repack";
self.onmessage=event=>{try{const {plan,document,products,allowTurn}=event.data;self.postMessage({plan:repackMeasuredUnits(plan,document,products,allowTurn===true)});}catch(e){self.postMessage({error:e instanceof Error?e.message:String(e)});}};
