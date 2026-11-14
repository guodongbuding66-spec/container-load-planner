import * as THREE from "three";
import { labelsOverlap, layoutSceneLabel, type LabelRect } from "./scene-labels";
import type { SceneSize } from "./camera-fit";
import type { ContainerSpec, PlacedBox } from "./types";

export type DimensionUnit = "mm" | "cm" | "m";
export type DimensionStyle = "dimensions" | "ruler";
export type DimensionColors = { lineColor?: string; textColor?: string };
export type DimensionBounds = { min: SceneSize; max: SceneSize };
export type ScreenPoint = { x: number; y: number; depth: number };
export type DimensionSegment = [ScreenPoint, ScreenPoint];
export type DimensionAnnotation = { axis: "L" | "W" | "H"; edgeId: string; normal: ScreenPoint; text: string; label: LabelRect; segments: DimensionSegment[]; measuredEdge: DimensionSegment; ticks: { text: string; label: LabelRect }[] };
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
export function projectDimensions(bounds: DimensionBounds, values: { L: number; W: number; H: number }, project: (point: SceneSize) => ScreenPoint, viewport: { width: number; height: number }, options: { unit?: DimensionUnit; fontSize?: number; style?: DimensionStyle; occupied?: LabelRect[]; bottomInset?: number; previousEdges?: Partial<Record<"L"|"W"|"H",string>> } = {}): DimensionAnnotation[] {
  if (viewport.width < 40 || viewport.height < 40 || [...bounds.min, ...bounds.max, ...Object.values(values)].some(n => !Number.isFinite(n)) || Object.values(values).some(n=>n<=0)) return [];
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
    L: [min[1],max[1]].flatMap(y => [min[2],max[2]].map(z => [[min[0],y,z],[max[0],y,z]] as [SceneSize,SceneSize])),
    W: [min[1],max[1]].flatMap(y => [min[0],max[0]].map(x => [[x,y,min[2]],[x,y,max[2]]] as [SceneSize,SceneSize])),
    H: [min[0],max[0]].flatMap(x => [min[2],max[2]].map(z => [[x,min[1],z],[x,max[1],z]] as [SceneSize,SceneSize])),
  };
  for (const axis of ["L","W","H"] as const) {
    const text=`${axis} ${formatDimension(values[axis],unit)}`,labelWidth=Math.min(text.length*font*.59+8,layoutViewport.width-16),labelHeight=font+4;
    const candidates = axisEdges[axis].map(([a,b],index) => {
      const start=project(a),end=project(b),dx=end.x-start.x,dy=end.y-start.y,length=Math.hypot(dx,dy);
      const mid={x:(start.x+end.x)/2,y:(start.y+end.y)/2,depth:0};
      let nx=-dy/length,ny=dx/length;
      if(nx*(mid.x-center.x)+ny*(mid.y-center.y)<0){nx=-nx;ny=-ny;}
      const distance=nx*(mid.x-center.x)+ny*(mid.y-center.y);
      // A valid exterior edge has every projected corner on its inward side.
      // Distance from the centre alone also selected edges inside the silhouette.
      const exterior=corners.every(p=>nx*(p.x-start.x)+ny*(p.y-start.y)<=.5);
      const padding=(Math.abs(nx)*labelWidth+Math.abs(ny)*labelHeight)/2;
      const labelCenter={x:mid.x+nx*(gap+padding+5),y:mid.y+ny*(gap+padding+5),depth:0};
      const desired={x:labelCenter.x-labelWidth/2,y:labelCenter.y-labelHeight/2,width:labelWidth,height:labelHeight};
      const outward=(r:LabelRect)=>nx*(r.x+(nx<0?r.width:0)-start.x)+ny*(r.y+(ny<0?r.height:0)-start.y)>=gap+1;
      const placements=[desired,...[font,font*2].flatMap(step=>[0,-.3,.3].map(slide=>({...desired,x:desired.x+nx*step+dx*slide,y:desired.y+ny*step+dy*slide})))];
      const label=placements.map(r=>layoutSceneLabel(r,layoutViewport,occupied)).find(r=>outward(r)&&!occupied.some(o=>labelsOverlap(r,o)));
      return {start,end,length,mid,nx,ny,distance,exterior,label,labelCenter,edgeId:`${axis}:${index}`};
    }).filter(c=>c.length>=2&&Number.isFinite(c.length+c.distance)&&c.start.depth>=-1&&c.end.depth>=-1&&c.start.depth<=1&&c.end.depth<=1&&c.exterior);
    // Prefer an edge with room for its horizontal label, then the outermost edge.
    candidates.sort((a,b)=>Number(!!b.label)-Number(!!a.label)||b.distance-a.distance||b.mid.y-a.mid.y);
    const previous=candidates.find(c=>c.edgeId===options.previousEdges?.[axis]);
    if(previous?.label&&candidates[0]?.label&&previous.distance>=candidates[0].distance-12)candidates.splice(0,0,previous);
    const c=candidates[0];if(!c)continue;
    const point=(p:ScreenPoint,n:number):ScreenPoint=>({x:p.x+c.nx*n,y:p.y+c.ny*n,depth:0});
    const a=point(c.start,gap),b=point(c.end,gap);
    const labelCenter=c.labelCenter;
    const label=c.label??layoutSceneLabel({x:labelCenter.x-labelWidth/2,y:labelCenter.y-labelHeight/2,width:labelWidth,height:labelHeight},layoutViewport,occupied);
    occupied.push(label);
    const tick=(p:ScreenPoint):DimensionSegment=>[{x:p.x-3,y:p.y-4,depth:0},{x:p.x+3,y:p.y+4,depth:0}];
    const segments:DimensionSegment[]=[[point(c.start,3),point(c.start,gap+5)],[point(c.end,3),point(c.end,gap+5)],[a,b],tick(a),tick(b)];
    // Connect a shifted label to the nearest point on its own ruler. A label
    // clamped far from a partly offscreen ruler must not create a diagonal across the scene.
    const actualCenter={x:label.x+label.width/2,y:label.y+label.height/2,depth:0};
    if(Math.hypot(actualCenter.x-labelCenter.x,actualCenter.y-labelCenter.y)>4){
      const dx=b.x-a.x,dy=b.y-a.y;
      const t=Math.max(0,Math.min(1,((actualCenter.x-a.x)*dx+(actualCenter.y-a.y)*dy)/(c.length*c.length)));
      const from={x:a.x+t*dx,y:a.y+t*dy,depth:0};
      const vx=actualCenter.x-from.x,vy=actualCenter.y-from.y;
      const inset=Math.min(label.width/(2*Math.abs(vx)),label.height/(2*Math.abs(vy)),1);
      const to={x:actualCenter.x-vx*inset,y:actualCenter.y-vy*inset,depth:0};
      if(vx*c.nx+vy*c.ny>0&&Math.hypot(to.x-from.x,to.y-from.y)<=font*2)segments.push([from,to]);
    }
    result.push({axis,edgeId:c.edgeId,normal:{x:c.nx,y:c.ny,depth:0},text,label,segments,measuredEdge:[c.start,c.end],ticks:[]});
  }
  // Tick values use actual 3D points, not screen-linear interpolation (which is
  // incorrect in perspective). Sparse, readable labels take priority over density.
  if(options.style==="ruler")for(const d of result){
    const index=Number(d.edgeId.split(":")[1]),[start,end]=axisEdges[d.axis][index],value=values[d.axis];
    const length=Math.hypot(d.measuredEdge[1].x-d.measuredEdge[0].x,d.measuredEdge[1].y-d.measuredEdge[0].y);
    const raw=value/Math.max(1,Math.floor(length/70)),power=10**Math.floor(Math.log10(raw));
    const step=[1,2,5,10].map(n=>n*power).find(n=>n>=raw)??power*10;
    const tickFont=Math.max(10,Math.round(font*.65)),nx=d.normal.x,ny=d.normal.y;
    for(let v=0;v<value;v+=step){
      const t=v/value,p=project(start.map((n,i)=>n+(end[i]-n)*t) as SceneSize);
      d.segments.push([{x:p.x+nx*(gap-3),y:p.y+ny*(gap-3),depth:0},{x:p.x+nx*(gap+4),y:p.y+ny*(gap+4),depth:0}]);
      const text=formatDimension(v,unit).split(" ")[0],width=text.length*tickFont*.6+4,height=tickFont+4;
      const distance=gap+6+(Math.abs(nx)*width+Math.abs(ny)*height)/2;
      const label={x:p.x+nx*distance-width/2,y:p.y+ny*distance-height/2,width,height};
      if(label.x<8||label.y<8||label.x+width>layoutViewport.width-8||label.y+height>layoutViewport.height-8||occupied.some(o=>labelsOverlap(label,o)))continue;
      d.ticks.push({text,label});occupied.push(label);
    }
  }
  return result;
}

export function cameraDimensionProjector(camera: THREE.Camera, viewport: {width:number;height:number}) {
  camera.updateMatrixWorld(true);
  return (point:SceneSize):ScreenPoint=>{const p=new THREE.Vector3(...point).project(camera);return {x:(p.x+1)*viewport.width/2,y:(1-p.y)*viewport.height/2,depth:p.z};};
}

/** No DOM-specific APIs: shared drawing primitives make the GPU overlay testable. */
export function paintDimensions(ctx: CanvasRenderingContext2D, dimensions: DimensionAnnotation[], fontSize: number, colors: DimensionColors = {}) {
  ctx.lineWidth=1.4;ctx.strokeStyle=colors.lineColor??DIMENSION_LINE_COLOR;ctx.lineCap="round";
  ctx.beginPath();for(const d of dimensions)for(const [a,b] of d.segments){ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);}ctx.stroke();
  ctx.font=`600 ${fontSize}px Arial, sans-serif`;ctx.textAlign="center";ctx.textBaseline="middle";
  for(const d of dimensions)for(const label of [{text:d.text,label:d.label,font:fontSize},...d.ticks.map(t=>({...t,font:Math.max(10,Math.round(fontSize*.65))}))]){
    ctx.font=`600 ${label.font}px Arial, sans-serif`;
    const x=label.label.x+label.label.width/2,y=label.label.y+label.label.height/2;ctx.lineWidth=3;ctx.strokeStyle="rgba(247,251,251,.95)";ctx.strokeText(label.text,x,y);ctx.fillStyle=colors.textColor??DIMENSION_TEXT_COLOR;ctx.fillText(label.text,x,y);
  }
}
