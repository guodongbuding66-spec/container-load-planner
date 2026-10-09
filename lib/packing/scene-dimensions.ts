import * as THREE from "three";
import { layoutSceneLabel, type LabelRect } from "./scene-labels";
import type { SceneSize } from "./camera-fit";
import type { ContainerSpec, PlacedBox } from "./types";

export type DimensionUnit = "mm" | "cm" | "m";
export type DimensionBounds = { min: SceneSize; max: SceneSize };
export type ScreenPoint = { x: number; y: number; depth: number };
export type DimensionSegment = [ScreenPoint, ScreenPoint];
export type DimensionAnnotation = { axis: "L" | "W" | "H"; text: string; label: LabelRect; segments: DimensionSegment[]; measuredEdge: DimensionSegment };
export const DIMENSION_LINE_COLOR = "#467ee6";
export const DIMENSION_TEXT_COLOR = "#137d83";
export function sceneMeasurement(space: ContainerSpec, clearance: number, selected?: Pick<PlacedBox,"x"|"y"|"z"|"dx"|"dy"|"dz">) {
  const length=space.length-clearance*2,width=space.width-clearance*2,height=space.height-clearance,base=space.baseHeight??0;
  const scale=5.6/Math.max(length,width,height+base);
  const bounds:DimensionBounds=selected?{
    min:[(selected.x-length/2)*scale,(selected.z+base)*scale,(selected.y-width/2)*scale],
    max:[(selected.x+selected.dx-length/2)*scale,(selected.z+selected.dz+base)*scale,(selected.y+selected.dy-width/2)*scale],
  }:{min:[-space.length*scale/2,base*scale,-space.width*scale/2],max:[space.length*scale/2,(base+space.height)*scale,space.width*scale/2]};
  return {bounds,values:selected?{L:selected.dx,W:selected.dy,H:selected.dz}:{L:space.length,W:space.width,H:space.height}};
}
export function formatDimension(value: number, unit: DimensionUnit) {
  const divisor = unit === "mm" ? 1 : unit === "cm" ? 10 : 1000;
  return `${(value / divisor).toLocaleString("en-US", { useGrouping: false, maximumFractionDigits: unit === "m" ? 3 : 2 })} ${unit}`;
}

/** Length is X, width is Z, height is Y. Values stay in solver millimeters. */
export function projectDimensions(bounds: DimensionBounds, values: { L: number; W: number; H: number }, project: (point: SceneSize) => ScreenPoint, viewport: { width: number; height: number }, options: { unit?: DimensionUnit; fontSize?: number; occupied?: LabelRect[]; bottomInset?: number } = {}): DimensionAnnotation[] {
  if (viewport.width < 40 || viewport.height < 40 || [...bounds.min, ...bounds.max, ...Object.values(values)].some(n => !Number.isFinite(n))) return [];
  const { min, max } = bounds;
  const center = project(min.map((n,i) => (n + max[i]) / 2) as SceneSize);
  const corners = [min[0],max[0]].flatMap(x => [min[1],max[1]].flatMap(y => [min[2],max[2]].map(z => project([x,y,z]))));
  // A model behind the camera or entirely outside the viewport has no floating measures.
  if (!corners.some(p=>Number.isFinite(p.x+p.y+p.depth)&&p.depth>=-1&&p.depth<=1) || corners.every(p=>p.x<0) || corners.every(p=>p.x>viewport.width) || corners.every(p=>p.y<0) || corners.every(p=>p.y>viewport.height)) return [];
  const unit = options.unit ?? "mm", font = options.fontSize ?? 18, gap = 14;
  const occupied = [...(options.occupied ?? [])];
  const layoutViewport = { ...viewport, height: Math.max(40, viewport.height - (options.bottomInset ?? 0)) };
  const result: DimensionAnnotation[] = [];
  const axisEdges = {
    L: [min[2],max[2]].map(z => [[min[0],min[1],z],[max[0],min[1],z]] as [SceneSize,SceneSize]),
    W: [min[0],max[0]].map(x => [[x,min[1],min[2]],[x,min[1],max[2]]] as [SceneSize,SceneSize]),
    H: [min[0],max[0]].flatMap(x => [min[2],max[2]].map(z => [[x,min[1],z],[x,max[1],z]] as [SceneSize,SceneSize])),
  };
  for (const axis of ["L","W","H"] as const) {
    const candidates = axisEdges[axis].map(([a,b]) => {
      const start=project(a),end=project(b),dx=end.x-start.x,dy=end.y-start.y,length=Math.hypot(dx,dy);
      const mid={x:(start.x+end.x)/2,y:(start.y+end.y)/2,depth:0};
      let nx=-dy/length,ny=dx/length;
      if(nx*(mid.x-center.x)+ny*(mid.y-center.y)<0){nx=-nx;ny=-ny;}
      const distance=nx*(mid.x-center.x)+ny*(mid.y-center.y);
      return {start,end,length,mid,nx,ny,distance};
    }).filter(c=>c.length>=2&&Number.isFinite(c.length+c.distance)&&c.start.depth>=-1&&c.end.depth>=-1&&c.start.depth<=1&&c.end.depth<=1);
    // Prefer the outermost floor edge and vertical corner, rather than edges through cargo.
    candidates.sort((a,b)=>b.distance-a.distance);
    const c=candidates[0];if(!c)continue;
    const point=(p:ScreenPoint,n:number):ScreenPoint=>({x:p.x+c.nx*n,y:p.y+c.ny*n,depth:0});
    const a=point(c.start,gap),b=point(c.end,gap);
    const text=`${axis} ${formatDimension(values[axis],unit)}`,labelWidth=text.length*font*.59+8;
    const labelCenter=point(c.mid,gap+font/2+5);
    const label=layoutSceneLabel({x:labelCenter.x-labelWidth/2,y:labelCenter.y-font/2-2,width:labelWidth,height:font+4},layoutViewport,occupied);
    occupied.push(label);
    const tick=(p:ScreenPoint):DimensionSegment=>[{x:p.x-3,y:p.y-4,depth:0},{x:p.x+3,y:p.y+4,depth:0}];
    const segments:DimensionSegment[]=[[point(c.start,3),point(c.start,gap+5)],[point(c.end,3),point(c.end,gap+5)],[a,b],tick(a),tick(b)];
    // When a label needs edge/collision adjustment, retain a short leader to its own line.
    const actualCenter={x:label.x+label.width/2,y:label.y+label.height/2,depth:0};
    if(Math.hypot(actualCenter.x-labelCenter.x,actualCenter.y-labelCenter.y)>4)segments.push([point(c.mid,gap),actualCenter]);
    result.push({axis,text,label,segments,measuredEdge:[c.start,c.end]});
  }
  return result;
}

export function cameraDimensionProjector(camera: THREE.Camera, viewport: {width:number;height:number}) {
  camera.updateMatrixWorld(true);
  return (point:SceneSize):ScreenPoint=>{const p=new THREE.Vector3(...point).project(camera);return {x:(p.x+1)*viewport.width/2,y:(1-p.y)*viewport.height/2,depth:p.z};};
}

/** No DOM-specific APIs: shared drawing primitives make the GPU overlay testable. */
export function paintDimensions(ctx: CanvasRenderingContext2D, dimensions: DimensionAnnotation[], fontSize: number) {
  ctx.lineWidth=1.4;ctx.strokeStyle=DIMENSION_LINE_COLOR;ctx.lineCap="round";
  ctx.beginPath();for(const d of dimensions)for(const [a,b] of d.segments){ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);}ctx.stroke();
  ctx.font=`600 ${fontSize}px Arial, sans-serif`;ctx.textAlign="center";ctx.textBaseline="middle";
  for(const d of dimensions){const x=d.label.x+d.label.width/2,y=d.label.y+d.label.height/2;ctx.lineWidth=3;ctx.strokeStyle="rgba(247,251,251,.95)";ctx.strokeText(d.text,x,y);ctx.fillStyle=DIMENSION_TEXT_COLOR;ctx.fillText(d.text,x,y);}
}
