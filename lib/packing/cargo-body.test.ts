import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { pack, validatePacking, restorePackingSnapshot, improvePacking, getOrientations } from "./engine";
import { editPlan } from "./plan-edit";
import { analyzeEmptySpaces, probeEmptySpace } from "./free-space";
import { bearingLoads } from "./bearing";
import { auditAccess } from "./access";
import { palletizeThenPack } from "./palletize";
import { fieldPlanFingerprint } from "./execution";
import { cargoBodyParts, bodyTopPatches, bodyBottomPatches, bodyContactArea, bodiesOverlap, validOrientationSigns } from "./cargo-body";
import { cargoShapeGeometry } from "./cargo-shape-geometry";
import { parseProductInput } from "./workspace-file";
import { parseProductsCsv, buildPlacementCsv, parseCsvRecords, toCsvCell } from "./csv";
import { createSpreadsheetTemplate, parseSpreadsheet } from "./spreadsheet";
import { ORIENTATION_CODES } from "./loading-rules";
import type { ContainerSpec, ProductInput, PlacedBox, CargoShape } from "./types";

const container:ContainerSpec={id:"body",name:"Body",loadingAccess:"open",length:1000,width:1000,height:1000,doorWidth:1000,doorHeight:1000,maxWeight:1000};
const base:ProductInput={id:"body",sku:"BODY",name:"Body",length:1000,width:1000,height:1000,weight:10,quantity:1,priority:80,rotationPolicy:"fixed",allowedOrientations:["LWH"],stackable:true,minimumSupportRatio:1,maxStackLayers:0,color:"#338899"};
const small:ProductInput={...base,id:"small",sku:"SMALL",name:"Small",length:600,width:800,height:600,weight:5,priority:50};
const placed=(p:ProductInput,xyz=[0,0,0]):PlacedBox=>({id:p.id,productId:p.id,sku:p.sku,name:p.name,color:p.color,x:xyz[0],y:xyz[1],z:xyz[2],dx:p.length,dy:p.width,dz:p.height,orientation:"LWH",weight:p.weight,layer:xyz[2]?2:1});
const request=(products:ProductInput[],strategy:"practical"|"maximum"="maximum")=>({mode:"mixed" as const,strategy,container,clearance:0,products});

describe("profile cavities, real support and occupied volume",()=>{
  it.each(["practical","maximum"] as const)("loads into an L recess with real base support in %s",strategy=>{
    const l={...base,cargoShape:"l-profile" as const,shapeWallRatio:.2,shapeWallHeightRatio:.2,maxTopLoadKg:5};
    const plan=pack(request([l,small],strategy)),upper=plan.placements.find(b=>b.productId===small.id)!;
    expect(plan.validation).toEqual({valid:true,errors:[]});expect(plan.metrics.loadedCount).toBe(2);
    expect(upper.x).toBeGreaterThanOrEqual(200);expect(upper.z).toBe(200);expect(upper.layer).toBe(2);
    expect(plan.placements[0].productId).toBe(l.id);
    expect(plan.metrics.loadedVolume).toBeCloseTo(360e6+288e6,0);
    expect(bearingLoads(plan.placements,[l,small]).get(plan.placements[0].id)).toBe(5);
    const free=analyzeEmptySpaces(plan,2000);expect(free.truncated).toBe(false);
    expect(free.coveredVolume+plan.metrics.loadedVolume).toBeCloseTo(1e9,0);
    expect(auditAccess({...plan,delivery:{body:{customer:"",destination:"",stop:1},small:{customer:"",destination:"",stop:2}}}).issues.some(i=>i.id===plan.placements[0].id&&i.reason==="support")).toBe(true);
  });
  it("rejects ghost top support, forbidden ledge loads, collisions and overloads",()=>{
    const l={...base,cargoShape:"l-profile" as const,shapeWallRatio:.2,shapeWallHeightRatio:.2},lower=placed(l);
    const upper={...placed(small,[200,0,200])};
    expect(validatePacking([lower,upper],container,0,[l,small]).valid).toBe(true);
    expect(validatePacking([lower,{...upper,z:1000}],{...container,height:2000,doorHeight:2000},0,[l,small]).errors.some(e=>e.includes("支撑不足"))).toBe(true);
    expect(validatePacking([lower,upper],container,0,[{...l,stackable:false},small]).valid).toBe(false);
    expect(validatePacking([lower,upper],container,0,[{...l,maxTopLoadKg:4},small]).errors.some(e=>e.includes("超过允许承重"))).toBe(true);
    expect(validatePacking([lower,{...upper,x:100}],container,0,[l,small]).errors.some(e=>e.includes("重叠"))).toBe(true);
    expect(validatePacking([lower,upper],container,0,[{...l,allowedAboveSkus:[]},small]).valid).toBe(false);
  });
  it("checks a U cavity and a stepped ledge and offers a valid extra-carton witness",()=>{
    for(const cargoShape of ["u-profile","step"] as const){
      const p={...base,cargoShape},box={...small,length:400,width:1000,height:400};
      const plan=pack(request([p,{...box,quantity:0}])),free=analyzeEmptySpaces(plan);
      const probe=probeEmptySpace(plan,[p,box],box.id,free.spaces);
      expect(probe.status).toBe("fits");expect(probe.candidate!.layer).toBe(2);
      expect(probe.candidate!.z).toBe(cargoShape==="step"?500:250);
      expect(restorePackingSnapshot(request([p,box]),{...plan,placements:[...plan.placements,probe.candidate]}).validation.valid).toBe(true);
    }
  });
  it("uses the T stem footprint and excludes its internal stem/cap joint",()=>{
    const p={...base,cargoShape:"t-profile" as const},b=placed(p);
    expect(bodyTopPatches(b,p,750)).toEqual([]);
    expect(bodyBottomPatches(b,p).reduce((n,s)=>n+s.dx*s.dy,0)).toBe(250000);
    const below={...placed({...base,id:"support",length:250,height:100}),x:375},upper={...b,z:100,layer:2};
    expect(bodyContactArea(upper,below,p,{})).toBe(250000);
    expect(validatePacking([below,upper],{...container,height:1100,doorHeight:1100},0,[p,{...base,id:"support",length:250,height:100}]).valid).toBe(true);
  });
  it("keeps curved frustums conservative and accepts a zero-radius cone",()=>{
    const p={...base,cargoShape:"frustum" as const,shapeTopRatio:0},plan=pack(request([p]));
    expect(plan.metrics.loadedVolume).toBe(1e9);expect(analyzeEmptySpaces(plan).spaces).toEqual([]);
    expect(parseProductInput(p)).toMatchObject({shapeTopRatio:0,stackable:false});
    const g=cargoShapeGeometry(p),top=g.getAttribute("position");
    for(let i=0;i<top.count;i++)if(top.getY(i)>.49)expect(Math.hypot(top.getX(i),top.getZ(i))).toBeCloseTo(0,6);
    g.dispose();
  });
});

describe("asymmetric rotations and durable shape data",()=>{
  it.each(["l-profile","u-profile","t-profile","step"] as CargoShape[])("preserves %s mesh volume and collision blocks in all six orientations",cargoShape=>{
    const p={...base,cargoShape,shapeWallRatio:.2,shapeWallHeightRatio:.3,shapeStepLengthRatio:.4,shapeStepHeightRatio:.6};
    const expected=({"l-profile":.44,"u-profile":.58,"t-profile":.44,step:.76} as Record<string,number>)[cargoShape];
    expect(getOrientations({...p,allowedOrientations:[...ORIENTATION_CODES]})).toHaveLength(6);
    for(const orientation of ORIENTATION_CODES){
      const b={...placed(p),orientation},parts=cargoBodyParts(b,p);
      expect(parts.reduce((n,c)=>n+c.dx*c.dy*c.dz,0)/1e9).toBeCloseTo(expected,6);
      const g=cargoShapeGeometry(p,orientation),v=g.getAttribute("position"),index=g.getIndex();let signed=0;
      for(let i=0;i<(index?.count??v.count);i+=3){const a=new THREE.Vector3().fromBufferAttribute(v,index?index.getX(i):i),b=new THREE.Vector3().fromBufferAttribute(v,index?index.getX(i+1):i+1),c=new THREE.Vector3().fromBufferAttribute(v,index?index.getX(i+2):i+2);signed+=a.dot(b.cross(c))/6;}
      expect(Math.abs(signed)).toBeCloseTo(expected,6);
      // Every rendered vertex must touch the union of exact collision blocks.
      for(let i=0;i<v.count;i++){const x=(v.getX(i)+.5)*1000,y=(v.getZ(i)+.5)*1000,z=(v.getY(i)+.5)*1000;expect(parts.some(c=>x>=c.x-.001&&x<=c.x+c.dx+.001&&y>=c.y-.001&&y<=c.y+c.dy+.001&&z>=c.z-.001&&z<=c.z+c.dz+.001)).toBe(true);}
      g.dispose();
    }
  });
  it("preserves 180° and 270° turns, snapshot signs, locks and refinement",()=>{
    const p={...base,length:800,width:600,height:600,cargoShape:"l-profile" as const,allowedOrientations:["LWH","WLH"] as const};
    const product={...p,allowedOrientations:[...p.allowedOrientations]},req=request([product]);let plan=pack(req);
    const original=plan.placements[0];
    for(let turn=1;turn<=4;turn++){
      plan=editPlan(plan,[product],[original.id],"selection",{x:0,y:0,z:0},0,0,true);
      const b=plan.placements[0];expect(validOrientationSigns(b.orientation,b.orientationSigns)).toBe(true);
      const restored=restorePackingSnapshot(req,plan);expect(restored.placements[0].orientationSigns).toEqual(b.orientationSigns);
      if(turn===2){expect(b.orientationSigns).toEqual([-1,-1,1]);expect(cargoBodyParts(b,product)[0].x).toBe(600);expect(fieldPlanFingerprint(plan)).not.toBe(fieldPlanFingerprint({...plan,placements:[original]}));}
      if(turn===3)expect(b.orientationSigns).toEqual([-1,1,1]);
    }
    expect(cargoBodyParts(plan.placements[0],product)).toEqual(cargoBodyParts(original,product));
    const locked={...plan,placements:plan.placements.map(b=>({...b,locked:true}))};
    expect(()=>editPlan(locked,[product],[original.id],"selection",{x:0,y:0,z:0},0,0,true)).toThrow();
    expect(improvePacking(locked,[product]).validation.valid).toBe(true);
    expect(()=>restorePackingSnapshot(req,{...plan,placements:[{...original,orientationSigns:[-1,1,1]}]})).toThrow();
  });
  it("rotates an entire prepared pallet as a rigid body and preserves cavity cargo and load links",()=>{
    const l={...base,length:1200,width:800,height:600,cargoShape:"l-profile" as const,shapeWallRatio:.2,shapeWallHeightRatio:.2,allowedOrientations:["LWH","WLH"] as const};
    const profile={...l,allowedOrientations:[...l.allowedOrientations]},box={...small,length:600,width:800,height:400,allowedOrientations:["LWH","WLH"] as const},carton={...box,allowedOrientations:[...box.allowedOrientations]};
    const config={presetId:"custom",name:"Pallet",length:1200,width:800,height:100,weight:10,maxLoad:100,count:1,gap:0,layout:"auto" as const,allowFloorCargo:false};
    const req={...request([profile,carton]),container:{...container,length:800,width:1200,doorWidth:1200}},loaded=palletizeThenPack(req,config,"mixed",1).plan;
    expect(loaded.validation.valid).toBe(true);expect(loaded.metrics.loadedCount).toBe(2);expect(loaded.pallets![0].orientation).toBe("WLH");
    expect(loaded.placements.every(b=>b.palletIds?.[0]===loaded.pallets![0].id)).toBe(true);
    const a=loaded.placements.find(b=>b.productId===profile.id)!,b=loaded.placements.find(b=>b.productId===carton.id)!;
    expect(bodiesOverlap(a,b,profile,carton)).toBe(false);expect(bodyContactArea(b,a,carton,profile)).toBe(600*800);
    expect(restorePackingSnapshot(req,loaded).placements).toEqual(loaded.placements);
  });
  it("round-trips every parameter through manifest CSV, backup parser, result and coordinate CSV",()=>{
    const headers=["sku","name","length","width","height","weight","quantity","cargoShape","shapeWallRatio","shapeWallHeightRatio","shapeStepLengthRatio","shapeStepHeightRatio"];
    const row=["PROFILE","Profile",1000,1000,1000,10,1,"step",.2,.3,.4,.6];
    const p=parseProductsCsv([headers.join(","),row.map(toCsvCell).join(",")].join("\n"),["#338899"])[0];
    const values={cargoShape:"step",shapeWallRatio:.2,shapeWallHeightRatio:.3,shapeStepLengthRatio:.4,shapeStepHeightRatio:.6};
    expect(p).toMatchObject(values);expect(parseProductInput(JSON.parse(JSON.stringify(p)))).toMatchObject(values);
    const plan=pack(request([p]));expect(restorePackingSnapshot(request([p]),plan).cargoDetails?.[p.id]).toMatchObject(values);
    const csv=parseCsvRecords(buildPlacementCsv(plan));expect(csv[1]).toHaveLength(csv[0].length);expect(csv[1].slice(23,27)).toEqual(["0.2","0.3","0.4","0.6"]);
    for(const bad of [{shapeWallRatio:1},{shapeWallHeightRatio:NaN},{shapeStepLengthRatio:0},{shapeStepHeightRatio:Infinity}])expect(()=>parseProductInput({...p,...bad})).toThrow();
    expect(validatePacking(plan.placements,container,0,[{...p,shapeWallRatio:0}]).valid).toBe(false);
  });
  it("includes usable shape columns in the downloadable Excel template",async()=>{
    const sheet=await createSpreadsheetTemplate(),products=await parseSpreadsheet(sheet,["#338899"]);
    expect(products.length).toBeGreaterThan(0);
  });
  it("does not confuse overlapping envelopes with colliding solid bodies",()=>{
    const l={...base,cargoShape:"l-profile" as const,shapeWallRatio:.2,shapeWallHeightRatio:.2},b=placed(l);
    expect(bodiesOverlap(b,placed(small,[200,0,200]),l,small)).toBe(false);
    expect(bodiesOverlap(b,placed(small,[199,0,200]),l,small)).toBe(true);
  });
});
