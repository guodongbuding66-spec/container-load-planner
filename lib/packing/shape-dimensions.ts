import { cargoShapeOf, cylinderAxisOf, parseShapeFields, type ShapeFields } from "./cargo-shape";
import type { CargoShape, ProductInput } from "./types";
import { fromMillimeters, toMillimeters, type LengthUnit } from "./units";

export type SizeKey = "length" | "width" | "height" | "diameter" | "diameter2" | "axialLength" | "topDiameter" | "topLength" | "verticalWall" | "horizontalWall" | "stepLength" | "stepHeight";
export type ShapeSizeDraft = Record<SizeKey,string>;
export type ShapeSizeOptions = { axis:"L"|"W"|"H"; elliptical:boolean; radialMode:"diameter"|"radius" };
export type SizeField = { key:SizeKey; code:string; zh:string; en:string; zero?:boolean };
const axes = ["L","W","H"] as const;
const keys = { L:"length",W:"width",H:"height" } as const;
export const isRoundShape = (shape:CargoShape) => shape==="cylinder"||shape==="frustum";
export const radialKeys = ["diameter","diameter2","topDiameter"] as const;
export const formatSize = (n:number) => Number.isFinite(n)?String(Number(n.toPrecision(12))):"";
export function sizeOptionsOf(p:ProductInput):ShapeSizeOptions {
  const axis=cylinderAxisOf(p),cross=axes.filter(a=>a!==axis);
  return {axis,elliptical:isRoundShape(cargoShapeOf(p))&&Math.abs(p[keys[cross[0]]]-p[keys[cross[1]]])>1e-6,radialMode:"diameter"};
}
export function sizeDraftOf(p:ProductInput,unit:LengthUnit,options=sizeOptionsOf(p)):ShapeSizeDraft {
  const cross=axes.filter(a=>a!==options.axis),factor=options.radialMode==="radius"?.5:1;
  const val=(n:number)=>formatSize(fromMillimeters(n,unit));
  return {length:val(p.length),width:val(p.width),height:val(p.height),
    diameter:val(p[keys[cross[0]]]*factor),diameter2:val(p[keys[cross[1]]]*factor),axialLength:val(p[keys[options.axis]]),
    topDiameter:val(p[keys[cross[0]]]*(p.shapeTopRatio??.5)*factor),topLength:val(p.length*(p.shapeTopRatio??.5)),
    verticalWall:val(p.length*(p.shapeWallRatio??.25)),horizontalWall:val(p.height*(p.shapeWallHeightRatio??.25)),
    stepLength:val(p.length*(p.shapeStepLengthRatio??.5)),stepHeight:val(p.height*(p.shapeStepHeightRatio??.5))};
}
export function switchRadialMode(d:ShapeSizeDraft,next:ShapeSizeOptions["radialMode"]):ShapeSizeDraft {
  const factor=next==="radius"?.5:2;
  return {...d,...Object.fromEntries(radialKeys.map(key=>[key,d[key].trim()&&Number.isFinite(Number(d[key]))?formatSize(Number(d[key])*factor):d[key]]))};
}
export function sizeFields(shape:CargoShape,options:ShapeSizeOptions):SizeField[] {
  if(isRoundShape(shape)){
    const radius=options.radialMode==="radius",cross=axes.filter(a=>a!==options.axis);
    return [{key:"diameter",code:radius?(options.elliptical?"r₁":"r"):(options.elliptical?"D₁":"D"),zh:options.elliptical?`第一${radius?"半径":"直径"}（${cross[0]}）`:radius?"半径 r":"直径 D",en:options.elliptical?`${radius?"Radius":"Diameter"} 1 (${cross[0]})`:radius?"Radius r":"Diameter D"},
      ...(options.elliptical?[{key:"diameter2" as const,code:radius?"r₂":"D₂",zh:`第二${radius?"半径":"直径"}（${cross[1]}）`,en:`${radius?"Radius":"Diameter"} 2 (${cross[1]})`}]:[]),
      {key:"axialLength",code:"h",zh:"轴向长度／高度 h",en:"Axial length / height h"},
      ...(shape==="frustum"?[{key:"topDiameter" as const,code:radius?"rₜ":"Dₜ",zh:radius?"顶部半径 rₜ":"顶部直径 Dₜ",en:radius?"Top radius rₜ":"Top diameter Dₜ",zero:true}]:[])];
  }
  const common:SizeField[]=shape.endsWith("-profile")?[
    {key:"length",code:"A",zh:"截面总宽 A",en:"Section width A"},{key:"height",code:"B",zh:"截面总高 B",en:"Section height B"},{key:"width",code:"C",zh:"延伸长度 C",en:"Extrusion length C"},
    {key:"verticalWall",code:"tᵥ",zh:"竖壁／腹板厚度 tᵥ",en:"Wall / web thickness tᵥ"},{key:"horizontalWall",code:"tₕ",zh:"横壁／翼板厚度 tₕ",en:"Base / flange thickness tₕ"},
  ]:[{key:"length",code:"L",zh:shape==="irregular"?"最大外接长 L":shape==="wedge"||shape==="trapezoid"?"底边长度 L":"总长 L",en:shape==="irregular"?"Bounding length L":shape==="wedge"||shape==="trapezoid"?"Base length L":"Overall length L"},
    {key:"width",code:"W",zh:shape==="irregular"?"最大外接宽 W":shape==="wedge"||shape==="trapezoid"?"棱柱长度 W":"总宽 W",en:shape==="irregular"?"Bounding width W":shape==="wedge"||shape==="trapezoid"?"Prism length W":"Overall width W"},
    {key:"height",code:"H",zh:shape==="irregular"?"最大外接高 H":"总高 H",en:shape==="irregular"?"Bounding height H":"Overall height H"}];
  if(shape==="trapezoid")common.push({key:"topLength",code:"b",zh:"顶边长度 b",en:"Top length b"});
  if(shape==="step")common.push({key:"stepLength",code:"a",zh:"高台长度 a",en:"Raised-section length a"},{key:"stepHeight",code:"h₁",zh:"低台高度 h₁",en:"Lower-level height h₁"});
  return common;
}
/** User-facing physical dimensions convert once into the existing canonical mm / ratio schema. */
export function resolveShapeSize(shape:CargoShape,d:ShapeSizeDraft,options:ShapeSizeOptions,unit:LengthUnit):ShapeFields & Pick<ProductInput,"length"|"width"|"height"> {
  const numeric=(key:SizeKey,zero=false)=>{const n=Number(d[key]);if(!d[key].trim()||!Number.isFinite(n)||(zero?n<0:n<=0))throw new Error("请输入有效的正数尺寸；圆锥顶径可为 0。");return toMillimeters(n,unit);};
  let length:number,width:number,height:number;
  const params:ShapeFields={cargoShape:shape};
  if(isRoundShape(shape)){
    const factor=options.radialMode==="radius"?2:1,cross=axes.filter(a=>a!==options.axis),size={L:0,W:0,H:0};
    size[options.axis]=numeric("axialLength");size[cross[0]]=numeric("diameter")*factor;size[cross[1]]=options.elliptical?numeric("diameter2")*factor:size[cross[0]];
    ({L:length,W:width,H:height}=size);params.shapeAxis=options.axis;
    if(shape==="frustum"){const top=numeric("topDiameter",true)*factor;if(top>size[cross[0]])throw new Error("顶部直径不能大于底部直径。");params.shapeTopRatio=top/size[cross[0]];}
  }else{
    length=numeric("length");width=numeric("width");height=numeric("height");
    if(shape==="trapezoid"){const top=numeric("topLength");if(top>length)throw new Error("顶边长度不能大于底边长度。");params.shapeTopRatio=top/length;}
    if(shape.endsWith("-profile")){
      const vertical=numeric("verticalWall"),horizontal=numeric("horizontalWall");
      if(vertical>=(shape==="u-profile"?length/2:length))throw new Error(shape==="u-profile"?"U 型竖壁厚度须小于截面总宽的一半。":"竖壁厚度须小于截面总宽。");
      if(horizontal>=height)throw new Error("横壁厚度须小于截面总高。");
      params.shapeWallRatio=vertical/length;params.shapeWallHeightRatio=horizontal/height;
    }
    if(shape==="step"){
      const stepLength=numeric("stepLength"),stepHeight=numeric("stepHeight");
      if(stepLength>=length||stepHeight>=height)throw new Error("高台长度和低台高度须分别小于总长、总高。");
      params.shapeStepLengthRatio=stepLength/length;params.shapeStepHeightRatio=stepHeight/height;
    }
  }
  if(![length,width,height,length*width*height].every(n=>Number.isFinite(n)&&n>0))throw new Error("尺寸换算后超出有效范围。");
  return {length,width,height,...parseShapeFields(params as Record<string,unknown>)};
}
