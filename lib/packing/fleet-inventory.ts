import {parseLoadingWorkflow,parsePalletBuild} from "./loading-workflow";
import {palletSpecifications} from "./pallet-specifications";
import {looseReservationErrors} from "./loose-cargo";
import type {PackingRequest,ProductInput} from "./types";
import type {FleetLoad} from "./fleet";

export type FleetInventory={packages:{id:string;name:string;available:number;used:number;remaining:number}[];totalLimit:number;totalUsed:number;loose:{productId:string;sku:string;reserved:number;used:number;remaining:number}[]};
/** A committed container consumes physical units. Unselected trial units consume nothing. */
export function fleetPool(request:PackingRequest,loads:readonly FleetLoad[]=[]){
 const workflow=parseLoadingWorkflow(request.workflow,request.mode);
 if(request.mode!=="mixed"||workflow==="pallet-only"||workflow==="single-capacity")throw Error("多柜需要直接装柜或先打托后装柜 / Fleet allocation requires vehicle loading");
 const build=workflow==="palletized"?parsePalletBuild(request.palletBuild):undefined;
 const issues=looseReservationErrors(build?.looseQuantities,request.products);if(issues.length)throw Error(issues.join("; "));
 const loaded=new Map<string,number>(),looseUsed=new Map<string,number>(),packUsed=new Map<string,number>();
 for(const load of loads){
  for(const b of load.plan.placements){loaded.set(b.productId,(loaded.get(b.productId)??0)+1);if(build&&!b.palletIds?.length)looseUsed.set(b.productId,(looseUsed.get(b.productId)??0)+1);}
  for(const p of load.plan.pallets??[]){const id=p.specificationId??"primary";packUsed.set(id,(packUsed.get(id)??0)+1);}
 }
 const ids=new Set(request.products.map(p=>p.id));if([...loaded.keys()].some(id=>!ids.has(id)))throw Error("多柜方案包含未知订单行 / Unknown fleet order line");
 const products:ProductInput[]=request.products.map(p=>{const quantity=p.quantity-(loaded.get(p.id)??0);if(quantity<0)throw Error("跨柜装载超过原订单 / Fleet order quantity exceeded");return {...p,quantity};});
 if(!build)return {request:{...request,workflow,floorPallets:request.floorPallets,products},products,inventory:undefined};
 const specifications=palletSpecifications(build),specIds=new Set(specifications.map(s=>s.id));
 if([...packUsed.keys()].some(id=>!specIds.has(id)))throw Error("跨柜包装规格未知 / Unknown fleet packaging specification");
 const packages=specifications.map(s=>{const used=packUsed.get(s.id)??0;if(used>s.maxPallets)throw Error("跨柜包装库存超限 / Shared packaging stock exceeded");return {id:s.id,name:s.config.name,available:s.maxPallets,used,remaining:s.maxPallets-used};});
 const totalUsed=packages.reduce((n,p)=>n+p.used,0);if(totalUsed>build.maxPallets)throw Error("跨柜整托总上限超限 / Shared prepared-unit limit exceeded");
 const loose=request.products.map(p=>{const reserved=build.looseQuantities?.[p.id]??0,used=looseUsed.get(p.id)??0;if(used>reserved||(loaded.get(p.id)??0)-used>p.quantity-reserved)throw Error("跨柜散装或打托配额超限 / Shared loose or palletized allocation exceeded");return {productId:p.id,sku:p.sku,reserved,used,remaining:reserved-used};});
 const remainingLoose=Object.fromEntries(loose.filter(p=>p.remaining>0).map(p=>[p.productId,p.remaining]));
 const stock=new Map(packages.map(p=>[p.id,p.remaining]));
 const local={...build,maxPallets:Math.max(1,build.maxPallets-totalUsed),looseQuantities:Object.keys(remainingLoose).length?remainingLoose:undefined,primaryRule:{...build.primaryRule,maxPallets:stock.get("primary")!},additionalSpecs:build.additionalSpecs?.map(s=>({...s,maxPallets:stock.get(s.id)!}))};
 const inventory:FleetInventory={packages,totalLimit:build.maxPallets,totalUsed,loose};
 return {request:{...request,workflow,products,palletBuild:local,floorPallets:undefined},products,inventory};
}
