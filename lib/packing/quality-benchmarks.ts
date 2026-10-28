import {packLoadingWorkflow} from "./pack-loading";
import {ENGINE_VERSION} from "./engine";
import {auditPackingResult} from "./result-audit";
import {plannedWeightBreakdown} from "./weighing";
import {DEFAULT_PALLET_BUILD} from "./loading-workflow";
import {CONTAINER_PRESETS} from "./presets";
import type {PackingRequest,ProductInput} from "./types";
export const BENCHMARK_VERSION="business-2026-10-v3";
export type QualityCase={id:string;name:[string,string];proof:string;exactCount:number|null;request:PackingRequest};
export function qualityCases():QualityCase[]{
 const p:ProductInput={id:"a",sku:"A",name:"A",length:100,width:100,height:100,weight:10,quantity:100,priority:50,rotationPolicy:"fixed",allowedOrientations:["LWH"],stackable:true,maxStackLayers:0,maxTopLoadKg:100000,color:"#338877"};
 const r:PackingRequest={mode:"mixed",workflow:"direct",strategy:"maximum",clearance:0,practicalTargetUtilization:.95,products:[p],container:{id:"qa",name:"QA",length:400,width:300,height:200,doorWidth:300,doorHeight:200,maxWeight:100000}};
 const large={...structuredClone(DEFAULT_PALLET_BUILD.config),name:"Large registered pallet",length:2743,width:2233,height:60,maxCargoHeight:2527};
 const tailBase={...structuredClone(DEFAULT_PALLET_BUILD.config),name:"SKU A pallet",length:800,width:1000,height:100,maxCargoHeight:400};
 return [
 {id:"grid",name:["整格体积上界","Volume grid bound"],proof:"24 cubes fill the volume; 24 is constructive and volume-optimal",exactCount:24,request:r},
 {id:"payload",name:["重量上界","Payload bound"],proof:"120 kg / 10 kg = 12 cubes, with a feasible grid witness",exactCount:12,request:{...r,container:{...r.container,maxWeight:120}}},
 {id:"door",name:["固定朝向门洞","Fixed-orientation door"],proof:"90 mm door cannot pass the fixed 100 mm carton",exactCount:0,request:{...r,container:{...r.container,doorWidth:90}}},
 {id:"kits",name:["两箱加一箱套装","Two-plus-one kits"],proof:"24 volume slots / 3 cartons = 8 whole kits",exactCount:24,request:{...r,products:[{...p,setCode:"KIT",unitsPerSet:2,quantity:20},{...p,id:"b",sku:"B",setCode:"KIT",unitsPerSet:1,quantity:10}]}},
 {id:"long-business",name:["工具房长条箱混装","Long shed carton mix"],proof:"feasible reference; global optimum unknown",exactCount:null,request:{...r,clearance:10,container:{id:"40hq",name:"40HQ",length:12032,width:2350,height:2700,doorWidth:2340,doorHeight:2597,maxWeight:28600},products:[{...p,sku:"SHED",length:2200,width:620,height:180,weight:42.5,quantity:36,rotationPolicy:"upright",allowedOrientations:undefined},{...p,id:"b",sku:"BED",length:1180,width:680,height:160,weight:28,quantity:56},{...p,id:"c",sku:"PARCEL",length:1060,width:570,height:450,weight:31,quantity:24}]}},
 {id:"pallet-loose",name:["整托与尾数散箱","Pallets and loose tails"],proof:"feasible reference; global optimum unknown",exactCount:null,request:{...r,workflow:"palletized",container:{...r.container,length:1400,width:1000,height:800,doorWidth:1000,doorHeight:800},products:[{...p,length:250,width:250,height:200,quantity:30},{...p,id:"b",sku:"B",length:400,width:200,height:200,quantity:20}],palletBuild:{...DEFAULT_PALLET_BUILD,maxPallets:4,mix:"mixed",looseQuantities:{a:2,b:2},config:{...DEFAULT_PALLET_BUILD.config,length:1000,width:1000,height:100,weight:20,maxCargoHeight:600}}}},
 {id:"compact-stock",name:["小包装库存与整托排序","Compact stock and unit loading order"],proof:"At most 23 cartons per unit by 1000 / 42 kg. Small-base stock is 13; 14 floor units require at least one large base and occupy at least 13*1800*1100+2743*2233 mm², exceeding the net floor. A validated 13-small-unit witness attains 299 cartons. No stacked units or loose cargo.",exactCount:299,request:{...r,workflow:"palletized",clearance:10,container:{...CONTAINER_PRESETS[2]},products:[{...p,sku:"LONG",length:1640,width:545,height:120,weight:42,quantity:596,rotationPolicy:"upright",allowedOrientations:undefined,maxTopLoadKg:undefined}],palletBuild:{...structuredClone(DEFAULT_PALLET_BUILD),selection:"compact",config:large,additionalSpecs:[{id:"small",config:{...structuredClone(large),name:"Small registered pallet",length:1800,width:1100},maxPallets:13,stackLayers:1,maxTopLoadKg:0}]}}},
 {id:"joint-tails",name:["两组余货与共享地板空隙","Joint tails in a shared floor strip"],proof:"The original order contains 12 A + 12 B = 24 cartons, an absolute demand bound. Two SKU-specific pallets each hold 8 cartons; the shared 400 mm floor strip holds the remaining 4 A + 4 B. A validated witness reaches all 24 without adding packaging stock or cross-supporting pallets and loose cargo.",exactCount:24,request:{...r,workflow:"palletized",container:{...r.container,length:2000,width:1000,height:1000,doorWidth:1000,doorHeight:1000,maxWeight:10000},products:[{...p,length:400,width:400,height:200,quantity:12},{...p,id:"b",sku:"B",length:400,width:400,height:200,quantity:12}],palletBuild:{...structuredClone(DEFAULT_PALLET_BUILD),config:tailBase,maxPallets:2,primaryRule:{maxPallets:1,productIds:["a"]},additionalSpecs:[{id:"sku-b",config:{...structuredClone(tailBase),name:"SKU B pallet"},productIds:["b"],maxPallets:1,stackLayers:1,maxTopLoadKg:0}],looseQuantities:{a:4,b:4}}}}
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
