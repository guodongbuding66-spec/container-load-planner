import { expect, it } from "vitest";
import { pack } from "./engine";
import { defaultSolidModel } from "./solid-model";
import { pointInPolygon } from "./solid-math";
import { DEFAULT_PACKAGING } from "./packaging";
import { planProjection, shapePolygons } from "./plan-projection";
import type { ProductInput } from "./types";

export const product:ProductInput={id:"p",sku:"P",name:"P",length:600,width:600,height:300,weight:10,quantity:1,priority:50,rotationPolicy:"fixed",stackable:true,maxStackLayers:0,color:"#338877"};
const make=(p=product)=>pack({mode:"mixed",strategy:"maximum",container:{id:"c",name:"C",length:1500,width:1200,height:1200,doorWidth:1200,doorHeight:1200,maxWeight:1000},clearance:0,products:[p]});
const covered=(polys:[number,number][][],p:[number,number])=>polys.some(poly=>pointInPolygon(p,poly));

it("retains tube bores and concave U recesses in millimetre projections",()=>{
  for(const shape of ["tube","u-profile"] as const){
    const p={...product,cargoShape:shape,solidModel:defaultSolidModel(shape,[600,600,300])},plan=make(p),box=plan.placements[0];
    const view=shape==="tube"?"top":"side",polys=planProjection(plan,view).shapes[0].polygons;
    expect(covered(polys,[box.x+box.dx/2,(view==="top"?box.y:box.z)+(view==="top"?box.dy*.5:box.dz*.75)])).toBe(false);
    expect(covered(polys,[box.x+box.dx*.05,(view==="top"?box.y:box.z)+(view==="top"?box.dy:box.dz)*.5])).toBe(true);
  }
});
it("preserves signed asymmetric rotations and ordinary carton corners",()=>{
  const plan=make(),box=plan.placements[0];
  expect(shapePolygons(box,"top",plan.cargoDetails)[0]).toHaveLength(4);
  const details={p:{cargoShape:"wedge" as const}};
  const normal=shapePolygons(box,"side",details),flipped=shapePolygons({...box,orientationSigns:[-1,-1,1]},"side",details);
  expect(covered(normal,[box.x+box.dx*.9,box.z+box.dz*.9])).toBe(false);
  expect(covered(flipped,[box.x+box.dx*.9,box.z+box.dz*.9])).toBe(true);
});
it("projects a cross-rotated crate's real walls and lid through its full exterior height without adding tare",()=>{
  const plan=make();plan.pallets=[{id:"crate",name:"Crate",presetId:"c",orientation:"WLH",x:10,y:20,z:30,dx:800,dy:1000,dz:100,enclosureHeight:900,weight:40,maxLoad:500,packaging:{...DEFAULT_PACKAGING,enclosure:"panel",wallThickness:20,lid:true}}];
  const before=JSON.stringify(plan),shapes=planProjection(plan,"side").shapes.filter(s=>s.box.supportOnly);
  const points=shapes.flatMap(s=>s.polygons.flat());
  expect(Math.max(...points.map(p=>p[1]))).toBe(930);expect(Math.max(...points.map(p=>p[0]))).toBe(810);
  expect(shapes.every(s=>s.box.weight===0)).toBe(true);expect(JSON.stringify(plan)).toBe(before);
});
