import { modelAnnotations } from "./model-annotations";
import { cargoShapeGeometry } from "./cargo-shape-geometry";
import { orientationAxes } from "./cargo-body";
import { cargoShapeOf, cylinderAxisOf, type ShapeFields } from "./cargo-shape";
import type { OrientationCode } from "./types";
import { sizeFields, type ShapeSizeOptions, type SizeKey } from "./shape-dimensions";

export type Vec3 = [number,number,number];
export type PreviewCamera = {yaw:number;pitch:number;zoom:number};
export const DEFAULT_PREVIEW_CAMERA:PreviewCamera={yaw:Math.PI/4,pitch:.42,zoom:1};
export type PreviewFace={points:Vec3[];normal:Vec3};
export type PreviewMesh={faces:PreviewFace[];radius:number;scale:Vec3};
const dot=(a:Vec3,b:Vec3)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
export function previewMesh(p:ShapeFields,dimensions:number[],orientation:OrientationCode,collisionProxy=false):PreviewMesh {
  const byAxis:{[k:string]:number}={L:dimensions[0],W:dimensions[1],H:dimensions[2]};
  const sizes=[byAxis[orientation[0]],byAxis[orientation[2]],byAxis[orientation[1]]].map(n=>Number.isFinite(n)&&n>0?n:1),max=Math.max(...sizes),scale=sizes.map(n=>n/max) as Vec3;
  const geometry=cargoShapeGeometry(p,orientation,false,undefined,collisionProxy),v=geometry.getAttribute("position"),normal=geometry.getAttribute("normal"),indices=geometry.getIndex(),faces:PreviewFace[]=[];
  for(let i=0;i<(indices?.count??v.count);i+=3){const ids=[0,1,2].map(j=>indices?indices.getX(i+j):i+j),a=ids[0];
    const n=[normal.getX(a)/Math.max(1e-12,scale[0]),normal.getY(a)/Math.max(1e-12,scale[1]),normal.getZ(a)/Math.max(1e-12,scale[2])],magnitude=Math.hypot(...n)||1;
    faces.push({points:ids.map(j=>[v.getX(j)*scale[0],v.getY(j)*scale[1],v.getZ(j)*scale[2]] as Vec3),normal:n.map(x=>x/magnitude) as Vec3});
  }
  geometry.dispose();return {faces,scale,radius:Math.hypot(...scale)/2};
}
export function cameraBasis(camera:PreviewCamera) {
  const sy=Math.sin(camera.yaw),cy=Math.cos(camera.yaw),sp=Math.sin(camera.pitch),cp=Math.cos(camera.pitch);
  return {direction:[sy*cp,sp,cy*cp] as Vec3,right:[cy,0,-sy] as Vec3,up:[-sy*sp,cp,-cy*sp] as Vec3};
}
export function previewProjection(mesh:PreviewMesh,camera:PreviewCamera,width=360,height=240) {
  const basis=cameraBasis(camera),scale=Math.min(width,height)*.34/Math.max(.01,mesh.radius)*camera.zoom;
  const project=(p:Vec3)=>({x:width/2+dot(p,basis.right)*scale,y:height/2-dot(p,basis.up)*scale,depth:dot(p,basis.direction)});
  const faces=mesh.faces.filter(f=>dot(f.normal,basis.direction)>1e-7).map(f=>{
    const points=f.points.map(project),light=Math.max(.25,.6+.3*dot(f.normal,[.3,.8,.4]));
    return {points:points.map(p=>`${p.x.toFixed(3)},${p.y.toFixed(3)}`).join(" "),depth:points.reduce((n,p)=>n+p.depth,0)/3,color:`rgb(${Math.round(72*light)},${Math.round(153*light)},${Math.round(165*light)})`};
  }).sort((a,b)=>a.depth-b.depth);
  return {faces,project,basis};
}
export function orbitPreview(camera:PreviewCamera,dx:number,dy:number):PreviewCamera {
  return {...camera,yaw:camera.yaw-dx*.012,pitch:Math.max(-Math.PI/2+.015,Math.min(Math.PI/2-.015,camera.pitch+dy*.012))};
}
export function zoomPreview(camera:PreviewCamera,factor:number):PreviewCamera {
  return {...camera,zoom:Math.max(.4,Math.min(64,camera.zoom*factor))};
}
export function fitPreviewCamera(mesh:PreviewMesh,camera:PreviewCamera):PreviewCamera {
  const {right,up}=cameraBasis(camera),points=mesh.faces.flatMap(f=>f.points),xs=points.map(p=>dot(p,right)),ys=points.map(p=>dot(p,up));
  const s=240*.34/Math.max(.01,mesh.radius),w=(Math.max(...xs)-Math.min(...xs))*s,h=(Math.max(...ys)-Math.min(...ys))*s;
  return {...camera,zoom:Math.max(.4,Math.min(64,Math.min(260/(w||1),168/(h||1))))};
}
export function pointInPreview(original:Vec3,mesh:PreviewMesh,orientation:OrientationCode):Vec3 {
  const axes=orientationAxes(orientation),world=axes.map(a=>(a.negative ? .5-original[a.original] : original[a.original]-.5));
  return [world[0]*mesh.scale[0],world[2]*mesh.scale[1],world[1]*mesh.scale[2]];
}
export function previewDimensions(p:ShapeFields,dimensions:number[],options:ShapeSizeOptions,orientation:OrientationCode,mesh:PreviewMesh,selectedPart?:string) {
  if(p.solidModel)return modelAnnotations(p.solidModel,dimensions,selectedPart).map(a=>({...a,a:pointInPreview(a.a,mesh,orientation),b:pointInPreview(a.b,mesh,orientation)}));
  const shape=cargoShapeOf(p),ratio=p.shapeTopRatio??.5,t=p.shapeWallRatio??.25,h=p.shapeWallHeightRatio??.25;
  const l=p.shapeStepLengthRatio??.5,z=p.shapeStepHeightRatio??.5;
  const ranges:Partial<Record<SizeKey,[Vec3,Vec3]>>={
    length:[[0,0,0],[1,0,0]],width:[[0,0,0],[0,1,0]],height:[[0,0,0],[0,0,1]],
    topLength:[[(1-ratio)/2,0,1],[(1+ratio)/2,0,1]],
    verticalWall:shape==="t-profile"?[[(1-t)/2,0,0],[(1+t)/2,0,0]]:[[0,0,1],[t,0,1]],
    horizontalWall:shape==="t-profile"?[[1,0,1-h],[1,0,1]]:shape==="u-profile"?[[.5,0,0],[.5,0,h]]:[[1,0,0],[1,0,h]],
    stepLength:[[0,0,1],[l,0,1]],stepHeight:[[1,0,0],[1,0,z]],
  };
  const values:Partial<Record<SizeKey,number>>={length:dimensions[0],width:dimensions[1],height:dimensions[2],topLength:dimensions[0]*ratio,verticalWall:dimensions[0]*t,horizontalWall:dimensions[2]*h,stepLength:dimensions[0]*l,stepHeight:dimensions[2]*z};
  if(shape==="cylinder"||shape==="frustum"){
    const axis="LWH".indexOf(cylinderAxisOf(p)),cross=[0,1,2].filter(a=>a!==axis),base=axis===0?1:0,factor=options.radialMode==="radius"?.5:1;
    const a:Vec3=[.5,.5,.5],b:Vec3=[.5,.5,.5];a[axis]=base;b[axis]=base;a[cross[0]]=options.radialMode==="radius"?.5:0;b[cross[0]]=1;ranges.diameter=[a,b];
    const c=[...a] as Vec3,d=[...b] as Vec3;c[cross[0]]=.5;d[cross[0]]=.5;c[cross[1]]=options.radialMode==="radius"?.5:0;d[cross[1]]=1;ranges.diameter2=[c,d];
    const e:Vec3=[.5,.5,.5],f:Vec3=[.5,.5,.5];e[axis]=0;f[axis]=1;e[cross[0]]=1;f[cross[0]]=1;ranges.axialLength=[e,f];
    const topA:Vec3=[.5,.5,.5],topB:Vec3=[.5,.5,.5];topA[axis]=1-base;topB[axis]=1-base;topA[cross[0]]=options.radialMode==="radius"?.5:(1-ratio)/2;topB[cross[0]]=(1+ratio)/2;ranges.topDiameter=[topA,topB];
    values.diameter=dimensions[cross[0]]*factor;values.diameter2=dimensions[cross[1]]*factor;values.axialLength=dimensions[axis];values.topDiameter=values.diameter*ratio;
  }
  return sizeFields(shape,options).map(field=>({...field,value:values[field.key]!,a:pointInPreview(ranges[field.key]![0],mesh,orientation),b:pointInPreview(ranges[field.key]![1],mesh,orientation)}));
}

/** Screen-space badges remain readable even when dimension segments become collinear. */
export function previewAnnotationLayout(annotations:ReturnType<typeof previewDimensions>,project:(p:Vec3)=>{x:number;y:number}) {
  const placed:Array<{x:number;y:number}>=[];
  return annotations.map(a=>{
    const start=project(a.a),end=project(a.b),mid={x:(start.x+end.x)/2,y:(start.y+end.y)/2};
    const cx=Math.max(24,Math.min(336,mid.x)),cy=Math.max(16,Math.min(224,mid.y)),candidates:Array<{x:number;y:number}>=[];
    // The nearest free screen position wins; model depth never affects badge visibility.
    for(let dy=-96;dy<=96;dy+=24)for(let dx=-108;dx<=108;dx+=36)candidates.push({x:Math.max(24,Math.min(336,cx+dx)),y:Math.max(16,Math.min(224,cy+dy-14))});
    candidates.sort((a,b)=>Math.hypot(a.x-cx,a.y-(cy-14))-Math.hypot(b.x-cx,b.y-(cy-14)));
    const label=candidates.find(p=>!(p.x>288&&p.y>184)&&placed.every(q=>Math.abs(p.x-q.x)>=34||Math.abs(p.y-q.y)>=22))??{x:cx,y:cy};
    placed.push(label);return {...a,start,end,mid,label};
  });
}
