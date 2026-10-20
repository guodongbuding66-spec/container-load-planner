import {validateFleet,assertFleetSettings,fleetCanonical} from "./fleet-validation";
import {parseFleetPricing,type FleetPricing} from "./fleet-costs";
import {buildPlacementCsv,parseCsvRecords,toCsvCell} from "./csv";
import type {PackingRequest} from "./types";
import type {FleetOption,FleetResult} from "./fleet";
export type FleetBackup={format:"cargo-fit-fleet-v1";version:1;request:PackingRequest;options:FleetOption[];limit:number;objective:"count"|"cost";pricing?:FleetPricing;result:FleetResult};
export const MAX_FLEET_BYTES=50*1024*1024;
export function serializeFleetBackup(value:Omit<FleetBackup,"format"|"version">){
 assertFleetSettings(value.request,value.options,value.limit,value.objective,value.pricing);
 const check=validateFleet(value.request,value.result,value.options,value.limit);if(!check.valid)throw Error(check.errors.join("; "));
 if(fleetCanonical(value.pricing)!==fleetCanonical(value.result.pricing))throw Error("报价快照不一致 / Pricing snapshots disagree");
 return JSON.stringify({format:"cargo-fit-fleet-v1",version:1,...value},null,2);
}
export function parseFleetBackup(text:string,expected?:PackingRequest):FleetBackup{
 if(text.length>MAX_FLEET_BYTES||new TextEncoder().encode(text).length>MAX_FLEET_BYTES)throw Error("多柜文件超过 50 MB / Fleet file exceeds 50 MB");
 const v=JSON.parse(text) as FleetBackup;if(!v||v.format!=="cargo-fit-fleet-v1"||v.version!==1||!v.request||!v.result)throw Error("多柜备份格式无效 / Invalid fleet backup");
 if(expected&&fleetCanonical(v.request)!==fleetCanonical(expected))throw Error("多柜备份与当前订单或打托输入不同，请先恢复对应工作区 / Fleet backup differs from current order or packaging inputs; restore its workspace first");
 v.pricing=parseFleetPricing(v.pricing,v.request);assertFleetSettings(v.request,v.options,v.limit,v.objective,v.pricing);
 if(fleetCanonical(v.pricing)!==fleetCanonical(v.result.pricing))throw Error("报价快照不一致 / Pricing snapshots disagree");
 const check=validateFleet(v.request,v.result,v.options,v.limit);if(!check.valid)throw Error(check.errors.join("; "));return v;
}
export function buildFleetCoordinates(result:FleetResult){
 const sheets=result.loads.map(l=>parseCsvRecords(buildPlacementCsv(l.plan))),headers=[...new Set(sheets.flatMap(s=>s[0]))];
 const rows:string[][]=[];
 for(let i=0;i<sheets.length;i++){const [head,...records]=sheets[i],index=new Map(head.map((s,j)=>[s,j]));for(const row of records)rows.push([String(i+1),result.loads[i].plan.container.id,result.loads[i].plan.id,...headers.map(h=>index.has(h)?row[index.get(h)!]??"":"")]);}
 return [["柜号","柜型ID","方案ID",...headers],...rows].map(row=>row.map(toCsvCell).join(",")).join("\r\n");
}
export function buildFleetSummary(result:FleetResult){
 const rows:(string|number|null|undefined)[][]=[["记录类型","柜号","标识","需求或库存","已装或已用","未装或剩余","运费","包装费","已知费用小计","完整合计","币种"]];
 result.loads.forEach((l,i)=>rows.push(["container",i+1,l.plan.container.name,"",l.plan.metrics.loadedCount,"",l.cost||null,"","","",result.pricing?.currency]));
 result.inventory?.packages.forEach(p=>rows.push(["packaging-stock","",p.id,p.available,p.used,p.remaining]));
 result.inventory?.loose.filter(p=>p.reserved>0).forEach(p=>rows.push(["loose-reservation","",p.sku,p.reserved,p.used,p.remaining]));
 result.remaining.forEach(p=>rows.push(["unloaded","",p.sku,"","",p.quantity]));
 if(result.costs)rows.push(["freight-and-packaging","","","","","",result.costs.freight,result.costs.packaging,result.costs.knownSubtotal,result.costs.total,result.costs.currency]);
 return rows.map(row=>row.map(toCsvCell).join(",")).join("\r\n");
}
