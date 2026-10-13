import { describe, expect, it } from "vitest";
import { CARGO_SHAPES, cargoShapeOf, isRectilinearShape, parseShapeFields } from "./cargo-shape";
import { cargoShapeGeometry, cargoShapeFootprint } from "./cargo-shape-geometry";
import { ORIENTATION_CODES } from "./loading-rules";
import { pack, validatePacking, restorePackingSnapshot } from "./engine";
import { parseProductInput } from "./workspace-file";
import { parseProductsCsv, toCsvCell, buildPlacementCsv, parseCsvRecords } from "./csv";
import { analyzeEmptySpaces } from "./free-space";
import type { ContainerSpec, ProductInput } from "./types";
import * as THREE from "three";

const container:ContainerSpec={id:"shape-test",name:"Shape test",loadingAccess:"open",length:600,width:600,height:600,doorWidth:600,doorHeight:600,maxWeight:1000};
const product:ProductInput={id:"s",sku:"SHAPE",name:"shape",length:600,width:600,height:200,weight:10,quantity:3,priority:50,rotationPolicy:"fixed",allowedOrientations:["LWH"],stackable:true,maxStackLayers:0,color:"#338899"};

describe("non-cuboid occupied envelopes",()=>{
  it.each(["practical","maximum"] as const)("uses the same full envelope and no fictional top support in %s",strategy=>{
    const cuboid=pack({mode:"mixed",strategy,container,clearance:0,products:[product]});
    expect(cuboid.metrics.loadedCount).toBe(strategy==="practical"?2:3);
    for(const cargoShape of CARGO_SHAPES.filter(s=>s!=="box"&&!isRectilinearShape({cargoShape:s}))){
      const p={...product,cargoShape,maxTopLoadKg:999};
      const result=pack({mode:"mixed",strategy,container,clearance:0,products:[p]});
      expect(result.validation.valid).toBe(true);expect(result.metrics.loadedCount).toBe(1);
      expect(result.metrics.loadedVolume).toBe(600*600*200);
      expect(result.cargoDetails?.s.cargoShape).toBe(cargoShape);
      expect(p.stackable).toBe(true);expect(p.maxTopLoadKg).toBe(999);
      const b=result.placements[0],upper={...b,id:"upper",z:200,layer:2};
      expect(validatePacking([b,upper],container,0,[p],strategy).valid).toBe(false);
      expect(()=>restorePackingSnapshot({mode:"mixed",container,clearance:0,products:[p]}, {...result,placements:[b,upper]})).toThrow();
    }
  });
  it("never reports a sloping wedge interior as available space",()=>{
    const result=pack({mode:"mixed",strategy:"maximum",container:{...container,length:1000},clearance:0,products:[{...product,cargoShape:"wedge",quantity:1}]});
    const b=result.placements[0];
    for(const gap of analyzeEmptySpaces(result).spaces)expect(gap.x>=b.x+b.dx||gap.y>=b.y+b.dy||gap.z>=b.z+b.dz||gap.x+gap.dx<=b.x||gap.y+gap.dy<=b.y||gap.z+gap.dz<=b.z).toBe(true);
  });
  it("retains legacy cuboids and gives existing drum and roll families a cylinder model",()=>{
    expect(cargoShapeOf({})).toBe("box");expect(cargoShapeOf({cargoType:"drum"})).toBe("cylinder");
    expect(cargoShapeOf({cargoType:"roll",cargoShape:"box"})).toBe("box");
    expect(parseProductInput(product)).toMatchObject({stackable:true});
    const curved=parseProductInput({...product,cargoShape:"cylinder",maxTopLoadKg:500});
    expect(curved.maxTopLoadKg).toBe(500);
    expect(parseProductInput({...curved,cargoShape:"box",stackable:true})).toMatchObject({stackable:true,maxTopLoadKg:500});
  });
  it("rejects invalid shape data in calculations and backups",()=>{
    for(const bad of [{cargoShape:"sphere"},{shapeAxis:"X"},{shapeTopRatio:0},{shapeTopRatio:Infinity},{cargoType:"pallet",cargoShape:"wedge"}]){
      expect(()=>parseShapeFields(bad)).toThrow();
      expect(()=>parseProductInput({...product,...bad})).toThrow();
      expect(()=>pack({mode:"mixed",container,clearance:0,products:[{...product,...bad} as ProductInput]})).toThrow();
    }
  });
  it("round-trips import, snapshot and placement-export shape parameters",()=>{
    const headers=["sku","name","length","width","height","weight","quantity","cargoShape","shapeAxis","shapeTopRatio"];
    const row=["TRAP","Trapezoid",600,600,200,10,1,"trapezoid","W",.35];
    const p=parseProductsCsv([headers.join(","),row.map(toCsvCell).join(",")].join("\n"),["#338899"])[0];
    expect(p).toMatchObject({cargoShape:"trapezoid",shapeAxis:"W",shapeTopRatio:.35,stackable:false});
    expect(parseProductInput(JSON.parse(JSON.stringify(p)))).toMatchObject({cargoShape:"trapezoid",shapeTopRatio:.35});
    const request={mode:"mixed" as const,container,clearance:0,products:[p]},result=pack(request),restored=restorePackingSnapshot(request,result);
    expect(restored.cargoDetails?.[p.id]).toMatchObject({cargoShape:"trapezoid",shapeTopRatio:.35});
    const csv=parseCsvRecords(buildPlacementCsv(restored));expect(csv[1]).toHaveLength(csv[0].length);expect(csv[1].slice(20,23)).toEqual(["trapezoid","W","0.35"]);
  });
});

describe("real shape geometry and placement rotations",()=>{
  it("keeps every family and all six orientations within the exact occupied envelope",()=>{
    for(const cargoShape of CARGO_SHAPES)for(const code of ORIENTATION_CODES){
      const g=cargoShapeGeometry({cargoShape,shapeTopRatio:.25},code),size=g.boundingBox!.getSize(new THREE.Vector3());
      expect(size.toArray().every(n=>Math.abs(n-1)<1e-6)).toBe(true);
      expect(g.getAttribute("normal").array.every(Number.isFinite)).toBe(true);g.dispose();
    }
  });
  it("honours the original cylinder axis and rotates its real silhouette",()=>{
    expect(cargoShapeFootprint({cargoShape:"cylinder",shapeAxis:"H"},"LWH")).toHaveLength(12);
    expect(cargoShapeFootprint({cargoType:"roll"},"LWH")).toHaveLength(4);
    expect(cargoShapeFootprint({cargoShape:"wedge"},"LHW")).toHaveLength(3);
    expect(cargoShapeFootprint({cargoShape:"trapezoid",shapeTopRatio:.25},"LHW")).toHaveLength(4);
  });
});
