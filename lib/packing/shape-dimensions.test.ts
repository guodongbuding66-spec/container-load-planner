import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { CargoShapeSizes } from "../../components/cargo-shape-sizes";
import { CargoModelPreview } from "../../components/cargo-model-preview";
import { CARGO_SHAPES, parseShapeFields } from "./cargo-shape";
import { ORIENTATION_CODES } from "./loading-rules";
import { sizeDraftOf, sizeOptionsOf, sizeFields, resolveShapeSize, switchRadialMode, type ShapeSizeOptions } from "./shape-dimensions";
import { previewMesh, previewProjection, previewDimensions, previewAnnotationLayout, orbitPreview, fitPreviewCamera, DEFAULT_PREVIEW_CAMERA } from "./shape-preview";
import { parseProductInput } from "./workspace-file";
import { parseProductsCsv, toCsvCell } from "./csv";
import { pack, restorePackingSnapshot } from "./engine";
import { translateUi } from "./translate-ui";
import type { ProductInput } from "./types";

const product:ProductInput={id:"shape",sku:"SHAPE",name:"Shape",length:2000,width:300,height:600,weight:10,quantity:1,priority:50,rotationPolicy:"fixed",allowedOrientations:["LWH"],stackable:false,maxStackLayers:0,color:"#338899"};
const circle:ShapeSizeOptions={axis:"H",elliptical:false,radialMode:"diameter"};
const roundDraft=()=>({...sizeDraftOf(product,"cm"),diameter:"62",diameter2:"18",axialLength:"500",topDiameter:"31"});

describe("physical shape size input",()=>{
  it.each(["L","W","H"] as const)("maps diameter and axial length to original %s without mixing them",axis=>{
    const p=resolveShapeSize("cylinder",roundDraft(),{...circle,axis},"cm");
    expect([p.length,p.width,p.height]).toEqual(axis==="L"?[5000,620,620]:axis==="W"?[620,5000,620]:[620,620,5000]);
    expect(p.shapeAxis).toBe(axis);
  });
  it("preserves physical sizes while switching diameter and radius, including the cone top",()=>{
    const d=roundDraft(),radius=switchRadialMode(d,"radius");
    expect(radius).toMatchObject({diameter:"31",diameter2:"9",topDiameter:"15.5",axialLength:"500"});
    expect(resolveShapeSize("frustum",radius,{...circle,radialMode:"radius"},"cm")).toEqual(resolveShapeSize("frustum",d,circle,"cm"));
    expect(switchRadialMode(radius,"diameter")).toEqual(d);
    expect(switchRadialMode({...d,diameter:"-"},"radius").diameter).toBe("-");
  });
  it("supports elliptical cross-sections and keeps the same taper ratio on both axes",()=>{
    const p=resolveShapeSize("frustum",roundDraft(),{...circle,axis:"L",elliptical:true},"cm");
    expect(p).toMatchObject({length:5000,width:620,height:180,shapeTopRatio:.5});
    expect(sizeOptionsOf({...product,...p}).elliptical).toBe(true);
    expect(resolveShapeSize("frustum",{...roundDraft(),topDiameter:"0"},circle,"cm").shapeTopRatio).toBe(0);
  });
  it.each(CARGO_SHAPES)("round-trips %s through inches and the canonical mm schema",cargoShape=>{
    const p={...product,cargoShape,shapeTopRatio:.35,shapeWallRatio:.0025,shapeWallHeightRatio:.15,shapeStepLengthRatio:.38,shapeStepHeightRatio:.62};
    const options=sizeOptionsOf(p),d=sizeDraftOf(p,"in",options),resolved=resolveShapeSize(cargoShape,d,options,"in");
    for(const key of ["length","width","height"] as const)expect(resolved[key]).toBeCloseTo(p[key],7);
    const restored=parseProductInput({...p,...resolved});
    expect(restored.cargoShape).toBe(cargoShape);
    if(cargoShape.endsWith("-profile"))expect(resolved.shapeWallRatio).toBeCloseTo(.0025,10);
    if(cargoShape==="step")expect(resolved.shapeStepHeightRatio).toBeCloseTo(.62,10);
  });
  it.each(["l-profile","u-profile","t-profile"] as const)("accepts realistic thin %s walls and uses their actual occupied volume",cargoShape=>{
    const d={...sizeDraftOf(product,"mm"),verticalWall:"1",horizontalWall:"2"};
    const p=parseProductInput({...product,...resolveShapeSize(cargoShape,d,circle,"mm")});
    expect(p.shapeWallRatio).toBe(.0005);expect(p.shapeWallHeightRatio).toBeCloseTo(2/600,12);
    const container={id:"exact",name:"Exact",length:2000,width:300,height:600,doorWidth:300,doorHeight:600,maxWeight:1000,loadingAccess:"open" as const};
    const request={mode:"mixed" as const,strategy:"maximum" as const,container,clearance:0,products:[p]},plan=pack(request);
    expect(plan.validation.valid).toBe(true);expect(plan.metrics.loadedCount).toBe(1);
    const expected=cargoShape==="u-profile"?2*2000*300+2*1*300*598:2*2000*300+1*300*598;
    expect(plan.metrics.loadedVolume).toBeCloseTo(expected,5);
    expect(restorePackingSnapshot(request,plan).validation.valid).toBe(true);
  });
  it("uses active dimensions only, so unused fields cannot block saving",()=>{
    const empty=Object.fromEntries(Object.keys(roundDraft()).map(k=>[k,""])) as ReturnType<typeof roundDraft>;
    expect(resolveShapeSize("cylinder",{...empty,diameter:"50",axialLength:"100"},circle,"mm")).toMatchObject({length:50,width:50,height:100});
    expect(resolveShapeSize("box",{...empty,length:"10",width:"20",height:"30"},circle,"mm")).toMatchObject({length:10,width:20,height:30});
  });
  it("converts trapezoid and step parameters from real sizes rather than percentages",()=>{
    const d={...sizeDraftOf(product,"cm"),topLength:"60",stepLength:"80",stepHeight:"12"};
    expect(resolveShapeSize("trapezoid",d,circle,"cm").shapeTopRatio).toBe(.3);
    expect(resolveShapeSize("step",d,circle,"cm")).toMatchObject({shapeStepLengthRatio:.4,shapeStepHeightRatio:.2});
  });
  it("blocks impossible sections and taper sizes with fully translated errors",()=>{
    const d=roundDraft(),cases:Array<()=>unknown>=[
      ()=>resolveShapeSize("frustum",{...d,topDiameter:"63"},circle,"cm"),
      ()=>resolveShapeSize("cylinder",{...d,diameter:""},circle,"cm"),
      ()=>resolveShapeSize("cylinder",{...d,axialLength:"1e309"},circle,"cm"),
      ()=>resolveShapeSize("cylinder",{...d,axialLength:"1e308"},circle,"in"),
      ()=>resolveShapeSize("trapezoid",{...d,topLength:"201"},circle,"cm"),
      ()=>resolveShapeSize("u-profile",{...d,verticalWall:"100"},circle,"cm"),
      ()=>resolveShapeSize("l-profile",{...d,verticalWall:"200"},circle,"cm"),
      ()=>resolveShapeSize("t-profile",{...d,horizontalWall:"60"},circle,"cm"),
      ()=>resolveShapeSize("step",{...d,stepHeight:"60"},circle,"cm"),
      ()=>parseShapeFields({cargoShape:"u-profile",shapeWallRatio:.5}),
      ()=>parseShapeFields({cargoShape:"trapezoid",shapeTopRatio:0}),
      ()=>parseShapeFields({cargoShape:"step",shapeStepLengthRatio:1}),
    ];
    for(const fail of cases){let message="";try{fail();}catch(e){message=(e as Error).message;}expect(message).not.toBe("");expect(translateUi(message,"en")).not.toMatch(/[\u4e00-\u9fff]/);}
  });
  it("round-trips thin wall ratios through CSV imports",()=>{
    const headers=["sku","name","length","width","height","weight","quantity","cargoShape","shapeWallRatio","shapeWallHeightRatio"],row=["THIN","Thin",2000,300,600,10,1,"u-profile",.0005,2/600];
    const p=parseProductsCsv([headers.join(","),row.map(toCsvCell).join(",")].join("\n"),["#338899"])[0];
    expect(p).toMatchObject({shapeWallRatio:.0005,shapeWallHeightRatio:2/600,cargoShape:"u-profile"});
  });
  it("shows two round dimensions instead of three unrelated envelope fields",()=>{
    expect(sizeFields("cylinder",circle).map(f=>f.key)).toEqual(["diameter","axialLength"]);
    expect(sizeFields("frustum",{...circle,elliptical:true,radialMode:"radius"}).map(f=>f.code)).toEqual(["r₁","r₂","h","rₜ"]);
    const html=renderToStaticMarkup(createElement(CargoShapeSizes,{shape:"cylinder",values:roundDraft(),options:circle,unit:"cm",onChange:()=>{},onOptions:()=>{},onFocus:()=>{}}));
    expect(html).toContain('aria-label="直径 D"');expect(html).toContain('aria-label="轴向长度／高度 h"');expect(html).not.toContain('aria-label="总长 L"');
  });
});

describe("interactive mesh preview and overlay dimensions",()=>{
  it("orbits real geometry while physical dimensions and orientations stay intact",()=>{
    const p={...product,cargoShape:"l-profile" as const},mesh=previewMesh(p,[p.length,p.width,p.height],"LWH"),before=JSON.stringify(mesh);
    const initial=previewProjection(mesh,DEFAULT_PREVIEW_CAMERA),after=previewProjection(mesh,orbitPreview(DEFAULT_PREVIEW_CAMERA,100,30));
    expect(initial.faces).not.toEqual(after.faces);expect(JSON.stringify(mesh)).toBe(before);expect(p.allowedOrientations).toEqual(["LWH"]);
  });
  it.each(CARGO_SHAPES)("keeps %s measurements attached to the correct geometry in all six orientations",cargoShape=>{
    const p={...product,cargoShape,shapeTopRatio:.35,shapeWallRatio:.2,shapeWallHeightRatio:.3,shapeStepLengthRatio:.4,shapeStepHeightRatio:.6},dimensions=[p.length,p.width,p.height],options=sizeOptionsOf(p),max=Math.max(...dimensions);
    for(const code of ORIENTATION_CODES){
      const mesh=previewMesh(p,dimensions,code),annotations=previewDimensions(p,dimensions,options,code,mesh);
      for(const a of annotations)expect(Math.hypot(...a.a.map((n,i)=>n-a.b[i]))*max).toBeCloseTo(a.value,5);
      expect(mesh.faces.every(f=>f.normal.every(Number.isFinite))).toBe(true);
      for(const [yaw,pitch] of [[0,0],[Math.PI/2,0],[0,Math.PI/2],[.7,.5],[2,-.8]]){
        const projected=previewProjection(mesh,fitPreviewCamera(mesh,{yaw,pitch,zoom:1}));
        expect(projected.faces.every(f=>!f.points.includes("NaN")&&!f.points.includes("Infinity"))).toBe(true);
        const labels=previewAnnotationLayout(annotations,projected.project);
        for(let i=0;i<labels.length;i++)for(let j=i+1;j<labels.length;j++)expect(Math.abs(labels[i].label.x-labels[j].label.x)>=34||Math.abs(labels[i].label.y-labels[j].label.y)>=22).toBe(true);
      }
    }
  });
  it("measures radii at half a diameter and keeps zero-top cones finite",()=>{
    const p={...product,cargoShape:"frustum" as const,shapeAxis:"L" as const,shapeTopRatio:0},dimensions=[5000,620,620],options={...circle,axis:"L" as const,radialMode:"radius" as const};
    const mesh=previewMesh(p,dimensions,"HWL"),annotations=previewDimensions(p,dimensions,options,"HWL",mesh);
    expect(annotations.map(a=>a.value)).toEqual([310,5000,0]);
    expect(mesh.faces.every(f=>f.normal.every(Number.isFinite))).toBe(true);
  });
  it("renders a focusable preview and screen annotations after the actual model faces",()=>{
    const p={...product,cargoShape:"u-profile" as const},html=renderToStaticMarkup(createElement(CargoModelPreview,{fields:p,dimensions:[2000,300,600],orientation:"LWH",options:circle,unit:"mm",onOrientationChange:()=>{}}));
    expect(html).toContain('tabindex="0"');expect(html).toContain('data-preview-shape="u-profile"');
    expect(html.indexOf('class="cargo-preview-dimensions"')).toBeGreaterThan(html.indexOf('class="cargo-preview-faces"'));
    expect(html).toContain('data-dimension-key="verticalWall"');
  });
});
