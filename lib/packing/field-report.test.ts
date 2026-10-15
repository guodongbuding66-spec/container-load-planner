import { afterEach, expect, it, vi } from "vitest";
import { runInNewContext } from "node:vm";
import { pack } from "./engine";
import { customerReport, offlineFieldHtml, planSvg } from "./field-report";
import { planProjection, projectionPath } from "./plan-projection";
import { reviewPlan } from "./plan-review";
import { defaultSolidModel } from "./solid-model";
import { downloadPdfGuide } from "./pdf-guide";
import type { ProductInput } from "./types";

const product:ProductInput={id:"p",sku:"P",name:"P",length:600,width:600,height:300,weight:10,quantity:2,priority:50,rotationPolicy:"fixed",stackable:true,maxStackLayers:0,color:"#338877",cargoShape:"tube",solidModel:defaultSolidModel("tube",[600,600,300])};
const make=()=>pack({mode:"mixed",strategy:"maximum",container:{id:"c",name:"C",length:1500,width:1200,height:1200,doorWidth:1200,doorHeight:1200,maxWeight:1000},clearance:0,products:[product]});
afterEach(()=>vi.unstubAllGlobals());

it("exports every original placement and all five review states to customer and offline reports",()=>{
  const plan=make(),before=JSON.stringify(plan),review=reviewPlan(plan,[product]);
  const customer=customerReport(plan,[product],{language:"zh",customer:"<customer>",order:"O",currency:"USD",freight:null});
  const offline=offlineFieldHtml(plan,[product]);
  for(const html of [customer,offline])for(const c of review.checks)expect(html).toContain(`data-review-check="${c.id}" data-review-state="${c.state}"`);
  expect(customer).toContain("&lt;customer&gt;");expect(customer.match(/data-cargo-projection="top"/g)).toHaveLength(plan.placements.length);
  expect(offline).toContain(`${plan.placements[1].x}/${plan.placements[1].y}/${plan.placements[1].z}`);
  expect(customer).not.toContain("全部通过");expect(JSON.stringify(plan)).toBe(before);
});
it("uses the same actual polygons in all report views and the offline progress map",()=>{
  const plan=make();
  for(const view of ["top","side","door"] as const){const projected=planProjection(plan,view);for(const s of projected.shapes)expect(planSvg(plan,view)).toContain(`d="${projectionPath(s.polygons,view,projected.height)}"`);}
  const script=offlineFieldHtml(plan,[product]).split("<script>")[1].split("let hash=")[0];
  const data=runInNewContext(`${script};data;`);
  expect(data.projection.paths).toHaveLength(plan.placements.length);
  const projection=planProjection(plan,"top");expect(data.projection.paths[0].d).toBe(projectionPath(projection.shapes[0].polygons,"top",projection.height));
  expect(data.projection.paths[0].d.split("M").length).toBeGreaterThan(20);
});
it("updates offline progress colours without replacing shapes or losing the complete map",()=>{
  const plan=make(),nodes=new Map<string,Record<string,unknown>>();
  const get=(id:string)=>{if(!nodes.has(id))nodes.set(id,{value:"box",setAttribute:vi.fn(),replaceChildren:vi.fn(),append:vi.fn()});return nodes.get(id)!;};
  const create=vi.fn((namespace:string,tag:string)=>({namespace,tag,setAttribute:vi.fn()}));
  runInNewContext(offlineFieldHtml(plan,[product]).split("<script>")[1].split("</script>")[0],{document:{getElementById:get,createElementNS:create},localStorage:{getItem:()=>null,setItem:()=>{}},setTimeout:()=>{},URL:{}});
  expect(create.mock.calls.every(c=>c[1]==="path")).toBe(true);
  expect(get("map").append).toHaveBeenCalledTimes(plan.placements.length);
  (get("next").onclick as ()=>void)();expect(get("progress").textContent).toContain("1 / 2");
  expect(get("map").append).toHaveBeenCalledTimes(plan.placements.length*2);
});
it("renders complete real-shape PDF projections and a separate review page",async()=>{
  const plan=make(),text:string[]=[],fill=vi.fn(),lineTo=vi.fn();
  const ctx={fillText:(value:string)=>text.push(value),measureText:(v:string)=>({width:v.length*15}),fillRect:vi.fn(),strokeRect:vi.fn(),beginPath:vi.fn(),moveTo:vi.fn(),lineTo,closePath:vi.fn(),stroke:vi.fn(),fill};
  vi.stubGlobal("document",{fonts:{ready:Promise.resolve()},createElement:(tag:string)=>tag==="canvas"?{getContext:()=>ctx,toBlob:(cb:(b:Blob)=>void)=>cb(new Blob([new Uint8Array([255,216,255,217])]))}:{click:vi.fn()}});
  vi.stubGlobal("URL",{createObjectURL:()=>"blob:test",revokeObjectURL:vi.fn()});vi.stubGlobal("setTimeout",vi.fn());
  await downloadPdfGuide(plan,"en",[product]);
  expect(text).toContain("Plan review");for(const c of reviewPlan(plan,[product]).checks)expect(text.some(t=>t.includes(c.id==="securing"?"Transport securing":c.id==="bearing"?"Bearing data":c.id==="path"?"Loading and unloading":c.id==="geometry"?"Geometry and placement":"Data consistency"))).toBe(true);
  expect(fill).toHaveBeenCalledTimes(plan.placements.length*3);expect(fill).toHaveBeenCalledWith("nonzero");expect(lineTo.mock.calls.length).toBeGreaterThan(100);
});
