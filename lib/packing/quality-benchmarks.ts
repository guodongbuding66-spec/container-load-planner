import {packLoadingWorkflow} from "./pack-loading";
import {ENGINE_VERSION} from "./engine";
import {auditPackingResult} from "./result-audit";
import {plannedWeightBreakdown} from "./weighing";
import {DEFAULT_PALLET_BUILD} from "./loading-workflow";
import type {PackingRequest,ProductInput} from "./types";
export const BENCHMARK_VERSION="business-2026-10-v1";
export type QualityCase={id:string;name:[string,string];proof:string;exactCount:number|null;request:PackingRequest};
export function qualityCases():QualityCase[]{
 const p:ProductInput={id:"a",sku:"A",name:"A",length:100,width:100,height:100,weight:10,quantity:100,priority:50,rotationPolicy:"fixed",allowedOrientations:["LWH"],stackable:true,maxStackLayers:0,maxTopLoadKg:100000,color:"#338877"};
 const r:PackingRequest={mode:"mixed",workflow:"direct",strategy:"maximum",clearance:0,practicalTargetUtilization:.95,products:[p],container:{id:"qa",name:"QA",length:400,width:300,height:200,doorWidth:300,doorHeight:200,maxWeight:100000}};
 return [
 {id:"grid",name:["整格体积上界","Volume grid bound"],proof:"24 cubes fill the volume; 24 is constructive and volume-optimal",exactCount:24,request:r},
 {id:"payload",name:["重量上界","Payload bound"],proof:"120 kg / 10 kg = 12 cubes, with a feasible grid witness",exactCount:12,request:{...r,container:{...r.container,maxWeight:120}}},
 {id:"door",name:["固定朝向门洞","Fixed-orientation door"],proof:"90 mm door cannot pass the fixed 100 mm carton",exactCount:0,request:{...r,container:{...r.container,doorWidth:90}}},
 {id:"kits",name:["两箱加一箱套装","Two-plus-one kits"],proof:"24 volume slots / 3 cartons = 8 whole kits",exactCount:24,request:{...r,products:[{...p,setCode:"KIT",unitsPerSet:2,quantity:20},{...p,id:"b",sku:"B",setCode:"KIT",unitsPerSet:1,quantity:10}]}},
 {id:"long-business",name:["工具房长条箱混装","Long shed carton mix"],proof:"feasible reference; global optimum unknown",exactCount:null,request:{...r,clearance:10,container:{id:"40hq",name:"40HQ",length:12032,width:2350,height:2700,doorWidth:2340,doorHeight:2597,maxWeight:28600},products:[{...p,sku:"SHED",length:2200,width:620,height:180,weight:42.5,quantity:36,rotationPolicy:"upright",allowedOrientations:undefined},{...p,id:"b",sku:"BED",length:1180,width:680,height:160,weight:28,quantity:56},{...p,id:"c",sku:"PARCEL",length:1060,width:570,height:450,weight:31,quantity:24}]}},
 {id:"pallet-loose",name:["整托与尾数散箱","Pallets and loose tails"],proof:"feasible reference; global optimum unknown",exactCount:null,request:{...r,workflow:"palletized",container:{...r.container,length:1400,width:1000,height:800,doorWidth:1000,doorHeight:800},products:[{...p,length:250,width:250,height:200,quantity:30},{...p,id:"b",sku:"B",length:400,width:200,height:200,quantity:20}],palletBuild:{...DEFAULT_PALLET_BUILD,maxPallets:4,mix:"mixed",looseQuantities:{a:2,b:2},config:{...DEFAULT_PALLET_BUILD.config,length:1000,width:1000,height:100,weight:20,maxCargoHeight:600}}}}
 ];
}
export type QualityRow={caseId:string;name:[string,string];strategy:"practical"|"maximum";proof:string;exactCount:number|null;loaded:number;sets:number;payloadKg:number;elapsedMs:number;valid:boolean;gapToProof:number|null;errors:string[];input?:{request:unknown;exactCount:number|null;proof:string};palletSearch?:import("./pallet-search").PalletSearchSummary};
export type QualityReport={format:"cargo-fit-quality-benchmarks";version:1;caseVersion:string;engineVersion:string;createdAt:string;complete:boolean;rows:QualityRow[];environment?:string};
export function runQualityCase(id:string,strategy:"practical"|"maximum"):QualityRow{
 const c=qualityCases().find(c=>c.id===id);if(!c||!["practical","maximum"].includes(strategy))throw Error("Unknown benchmark case or strategy");
 const start=performance.now(),p=packLoadingWorkflow({...structuredClone(c.request),strategy}),elapsedMs=performance.now()-start,a=auditPackingResult(p,c.request.products),w=plannedWeightBreakdown(p),errors:string[]=[];
 if(!p.validation.valid||a.hasErrors||!a.completeCoordinates||!w.consistent)errors.push("Plan validation failed");
 if(c.exactCount!==null&&p.metrics.loadedCount>c.exactCount)errors.push("Proved physical upper bound exceeded");
 return {input:JSON.parse(JSON.stringify({request:{...c.request,strategy},exactCount:c.exactCount,proof:c.proof})),caseId:id,name:c.name,strategy,proof:c.proof,exactCount:c.exactCount,loaded:p.metrics.loadedCount,sets:p.setSummaries.reduce((n,s)=>n+s.loadedSets,0),payloadKg:w.payloadKg,elapsedMs,valid:!errors.length,...(p.palletSearch?{palletSearch:p.palletSearch}:{}),gapToProof:c.exactCount===null?null:c.exactCount-p.metrics.loadedCount,errors};
}
export function qualityReport(rows:QualityRow[],environment=""):QualityReport{
 const expected=new Set(qualityCases().flatMap(c=>[`${c.id}/practical`,`${c.id}/maximum`])),actual=new Set(rows.map(r=>`${r.caseId}/${r.strategy}`));
 return {...(environment.trim()?{environment:environment.trim().slice(0,120)}:{}),format:"cargo-fit-quality-benchmarks",version:1,caseVersion:BENCHMARK_VERSION,engineVersion:ENGINE_VERSION,createdAt:new Date().toISOString(),complete:rows.length===expected.size&&actual.size===expected.size&&[...actual].every(k=>expected.has(k)),rows:[...rows]};
}
