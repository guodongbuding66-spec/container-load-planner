import {renderToStaticMarkup} from "react-dom/server";
import {expect,it} from "vitest";
import {PalletManifest} from "./pallet-manifest";
import {OrthographicViews} from "./orthographic-views";
import {packLoadingWorkflow} from "../lib/packing/pack-loading";
import {DEFAULT_PALLET_BUILD} from "../lib/packing/loading-workflow";
import {DEFAULT_PACKAGING} from "../lib/packing/packaging";
it("keeps cargo top, crate exterior and all three projection extents distinct without inflating pallet counts",()=>{
  const result=packLoadingWorkflow({workflow:"pallet-only",mode:"mixed",strategy:"maximum",clearance:0,
    container:{id:"t",name:"t",length:3000,width:1000,height:1000,doorWidth:1000,doorHeight:1000,maxWeight:2000},
    palletBuild:{...DEFAULT_PALLET_BUILD,config:{...DEFAULT_PALLET_BUILD.config,length:1000,width:800,height:100,weight:40,maxCargoHeight:400,packaging:{...DEFAULT_PACKAGING,enclosure:"panel",wallThickness:50}}},
    products:[{id:"c",sku:"C",name:"Carton",length:450,width:350,height:200,weight:10,quantity:9,priority:50,color:"#4488aa",rotationPolicy:"upright",stackable:true,maxStackLayers:0}]});
  const html=renderToStaticMarkup(<PalletManifest result={result}/>),rows=[...html.matchAll(/<tbody>([\s\S]*?)<\/tbody>/g)][0][1],cells=[...rows.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map(row=>[...row[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map(cell=>cell[1].replace(/<[^>]+>/g,"")));
  const headers=[...html.matchAll(/<th\b[^>]*>(.*?)<\/th>/g)].map(m=>m[1]),column=(label:string)=>headers.findIndex(h=>h.includes(label));
  expect(cells.map(c=>Number(c[column("整托外部总高")]))).toEqual([550,550]);expect(cells.map(c=>Number(c[column("已装最高 Z")]))).toEqual([500,300]);expect(cells.map(c=>Number(c[column("允许最高 Z")]))).toEqual([500,500]);
  const projections=renderToStaticMarkup(<OrthographicViews result={result} visibleProducts={new Set(["c"])} visibleCount={9} primaryCountLabel="9" renderPrintSvg activeView="perspective" onViewSelect={()=>{}}/>);
  expect(projections.match(/550 mm/g)).toHaveLength(4);
  expect(projections).toContain("2 个托盘");expect(projections).not.toContain("9 个托盘");
});
