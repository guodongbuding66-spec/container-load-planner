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
export type DimensionAnnotation = { axis: "L" | "W" | "H"; edgeId: string; normal: ScreenPoint; text: string; label: LabelRect; segments: DimensionSegment[]; leaders?: DimensionSegment[]; measuredEdge: DimensionSegment; ticks: { text: string; label: LabelRect }[] };
export const DIMENSION_LINE_COLOR = "#467ee6";
export const DIMENSION_TEXT_COLOR = "#137d83";
export const DIMENSION_LABEL_CLEARANCE = 10;

/** Projected box silhouettes have at most six vertices. */
function silhouette(points:ScreenPoint[]) {
 const sorted=[...points].sort((a,b)=>a.x-b.x||a.y-b.y),cross=(a:ScreenPoint,b:ScreenPoint,c:ScreenPoint)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
 const half=(list:ScreenPoint[])=>{const h:ScreenPoint[]=[];for(const p of list){while(h.length>1&&cross(h.at(-2)!,h.at(-1)!,p)<=0)h.pop();h.push(p);}return h;};
 return [...half(sorted).slice(0,-1),...half(sorted.reverse()).slice(0,-1)];
}
function outerCaption(r:LabelRect,hull:ScreenPoint[],clearance:number){
 if(r.x+r.width<=Math.min(...hull.map(p=>p.x))-clearance||r.x>=Math.max(...hull.map(p=>p.x))+clearance||r.y+r.height<=Math.min(...hull.map(p=>p.y))-clearance||r.y>=Math.max(...hull.map(p=>p.y))+clearance)return true;
 return hull.some((a,i)=>{const b=hull[(i+1)%hull.length],dx=b.x-a.x,dy=b.y-a.y,length=Math.hypot(dx,dy);if(length<1e-6)return false;
  const nx=dy/length,ny=-dx/length;return nx*(r.x+(nx<0?r.width:0)-a.x)+ny*(r.y+(ny<0?r.height:0)-a.y)>=clearance;
 });
}
/** Route a displaced caption around the model, never through its faces. */
function captionLeader(start:ScreenPoint,label:LabelRect,hull:ScreenPoint[]):DimensionSegment[]{
 const center={x:label.x+label.width/2,y:label.y+label.height/2,depth:0},vx=center.x-start.x,vy=center.y-start.y;
 const inset=Math.min((label.width/2+DIMENSION_LABEL_CLEARANCE)/Math.max(Math.abs(vx),1e-6),(label.height/2+DIMENSION_LABEL_CLEARANCE)/Math.max(Math.abs(vy),1e-6),1);
 const end={x:center.x-vx*inset,y:center.y-vy*inset,depth:0};
 const left=Math.min(...hull.map(p=>p.x))-16,right=Math.max(...hull.map(p=>p.x))+16,top=Math.min(...hull.map(p=>p.y))-16,bottom=Math.max(...hull.map(p=>p.y))+16;
 const nodes=[start,...[[left,top],[right,top],[right,bottom],[left,bottom]].map(([x,y])=>({x,y,depth:0})),end];
 const clear=(a:ScreenPoint,b:ScreenPoint)=>{
  let lo=0,hi=1;
  for(let i=0;i<hull.length;i++){
   const p=hull[i],q=hull[(i+1)%hull.length],nx=q.y-p.y,ny=p.x-q.x,length=Math.hypot(nx,ny);
   const from=nx*(a.x-p.x)+ny*(a.y-p.y)-2*length,delta=nx*(b.x-a.x)+ny*(b.y-a.y);
   if(Math.abs(delta)<1e-8){if(from>0)return true;continue;}
   const t=-from/delta;if(delta>0)hi=Math.min(hi,t);else lo=Math.max(lo,t);if(lo>hi)return true;
  }return false;
 };
 const distance=nodes.map(()=>Infinity),parent=nodes.map(()=>-1),visited=new Set<number>();distance[0]=0;
 for(let k=0;k<nodes.length;k++){
  const next=distance.reduce((best,d,i)=>!visited.has(i)&&d<(distance[best]??Infinity)?i:best,-1);if(next<0||!Number.isFinite(distance[next]))break;
  visited.add(next);if(next===nodes.length-1)break;
  nodes.forEach((n,i)=>{if(i===next||visited.has(i)||!clear(nodes[next],n))return;const cost=distance[next]+Math.hypot(n.x-nodes[next].x,n.y-nodes[next].y);if(cost<distance[i]){distance[i]=cost;parent[i]=next;}});
 }
 const path:DimensionSegment[]=[];for(let at=nodes.length-1;parent[at]>=0;at=parent[at])path.unshift([nodes[parent[at]],nodes[at]]);return path;
}
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
  const hull=silhouette(corners);
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
      const labelCenter={x:mid.x+nx*(gap+padding+(options.style==="ruler"?font+22:15)),y:mid.y+ny*(gap+padding+(options.style==="ruler"?font+22:15)),depth:0};
      const desired={x:labelCenter.x-labelWidth/2,y:labelCenter.y-labelHeight/2,width:labelWidth,height:labelHeight};
      const outward=(r:LabelRect)=>nx*(r.x+(nx<0?r.width:0)-start.x)+ny*(r.y+(ny<0?r.height:0)-start.y)>=gap+DIMENSION_LABEL_CLEARANCE;
      // A short, diagonal width edge may have no room at its midpoint. Its
      // caption can slide onto an outer viewport track, without moving the
      // physical measuring edge or clamping the text back into the model.
      const placements=[desired,...[font,font*2].flatMap(step=>[0,-.3,.3,-.8,.8].map(slide=>({...desired,x:desired.x+nx*step+dx*slide,y:desired.y+ny*step+dy*slide}))),
        ...[8,(layoutViewport.width-labelWidth)/2,layoutViewport.width-labelWidth-8].flatMap(x=>[...Array.from({length:Math.max(1,Math.floor((layoutViewport.height-16)/(labelHeight+10)))},(_,i)=>8+i*(labelHeight+10)),layoutViewport.height-labelHeight-8,...occupied.flatMap(r=>[r.y-labelHeight-4,r.y+r.height+4])].map(y=>({...desired,x,y})))];
      const places=placements.map(r=>layoutSceneLabel(r,layoutViewport,occupied));
      const available=(r:LabelRect)=>!occupied.some(o=>labelsOverlap(r,o));
      const ownLabel=places.find(r=>outward(r)&&available(r));
      const label=ownLabel??places.find(r=>outerCaption(r,hull,DIMENSION_LABEL_CLEARANCE)&&available(r));
      return {start,end,length,mid,nx,ny,distance,exterior,label,ownLabel,labelCenter,edgeId:`${axis}:${index}`};
    }).filter(c=>c.length>=2&&Number.isFinite(c.length+c.distance)&&c.start.depth>=-1&&c.end.depth>=-1&&c.start.depth<=1&&c.end.depth<=1&&c.exterior);
    // Prefer an edge with room for its horizontal label, then the outermost edge.
    candidates.sort((a,b)=>Number(!!b.label)-Number(!!a.label)||Number(!!b.ownLabel)-Number(!!a.ownLabel)||b.distance-a.distance||b.mid.y-a.mid.y);
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
    if(c.ownLabel&&Math.hypot(actualCenter.x-labelCenter.x,actualCenter.y-labelCenter.y)>4){
      const dx=b.x-a.x,dy=b.y-a.y;
      const t=Math.max(0,Math.min(1,((actualCenter.x-a.x)*dx+(actualCenter.y-a.y)*dy)/(c.length*c.length)));
      const from={x:a.x+t*dx,y:a.y+t*dy,depth:0};
      const vx=actualCenter.x-from.x,vy=actualCenter.y-from.y;
      const inset=Math.min(label.width/(2*Math.abs(vx)),label.height/(2*Math.abs(vy)),1);
      const to={x:actualCenter.x-vx*inset,y:actualCenter.y-vy*inset,depth:0};
      if(vx*c.nx+vy*c.ny>0&&Math.hypot(to.x-from.x,to.y-from.y)<=font*2)segments.push([from,to]);
    }
    const leaders=c.label&&!c.ownLabel?captionLeader(Math.hypot(actualCenter.x-a.x,actualCenter.y-a.y)<Math.hypot(actualCenter.x-b.x,actualCenter.y-b.y)?a:b,label,hull):undefined;
    result.push({axis,edgeId:c.edgeId,normal:{x:c.nx,y:c.ny,depth:0},text,label,segments,leaders,measuredEdge:[c.start,c.end],ticks:[]});
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
  // A diagonal or clamped ruler can cross another axis label. Clip its line
  // beneath text, and omit tick captions on any track. Keep physical tick positions.
  const intersects=(r:LabelRect,[a,b]:DimensionSegment)=>{
    let lo=0,hi=1;const dx=b.x-a.x,dy=b.y-a.y;
    for(const [p,q] of [[-dx,a.x-r.x],[dx,r.x+r.width-a.x],[-dy,a.y-r.y],[dy,r.y+r.height-a.y]]){
      if(Math.abs(p)<1e-9){if(q<0)return false;continue;}
      const t=q/p;if(p<0)lo=Math.max(lo,t);else hi=Math.min(hi,t);if(lo>hi)return false;
    }return true;
  };
  for(const d of result)d.ticks=d.ticks.filter(t=>!result.some(other=>other.segments.some(s=>intersects(t.label,s))));

  return result;
}


export function visibleDimensionSegments(dimensions:DimensionAnnotation[]):DimensionSegment[]{
 const clearance=DIMENSION_LABEL_CLEARANCE;
 const rects=dimensions.flatMap(d=>[d.label,...d.ticks.map(t=>t.label)]).map(r=>({x:r.x-clearance,y:r.y-clearance,width:r.width+clearance*2,height:r.height+clearance*2}));
 let segments=dimensions.flatMap(d=>[...d.segments,...(d.leaders??[])]);
 for(const r of rects)segments=segments.flatMap(segment=>{
  const [a,b]=segment,dx=b.x-a.x,dy=b.y-a.y;let lo=0,hi=1;
  for(const [p,q] of [[-dx,a.x-r.x],[dx,r.x+r.width-a.x],[-dy,a.y-r.y],[dy,r.y+r.height-a.y]]){
   if(Math.abs(p)<1e-9){if(q<0)return [segment];continue;}
   const t=q/p;if(p<0)lo=Math.max(lo,t);else hi=Math.min(hi,t);if(lo>hi)return [segment];
  }
  const at=(t:number)=>({x:a.x+t*dx,y:a.y+t*dy,depth:0});
  const parts:DimensionSegment[]=[];if(lo>0)parts.push([a,at(lo)]);if(hi<1)parts.push([at(hi),b]);return parts;
 });
 return segments;
}

export function cameraDimensionProjector(camera: THREE.Camera, viewport: {width:number;height:number}) {
  camera.updateMatrixWorld(true);
  return (point:SceneSize):ScreenPoint=>{const p=new THREE.Vector3(...point).project(camera);return {x:(p.x+1)*viewport.width/2,y:(1-p.y)*viewport.height/2,depth:p.z};};
}

/** No DOM-specific APIs: shared drawing primitives make the GPU overlay testable. */
export function paintDimensions(ctx: CanvasRenderingContext2D, dimensions: DimensionAnnotation[], fontSize: number, colors: DimensionColors = {}) {
  ctx.lineWidth=1.4;ctx.strokeStyle=colors.lineColor??DIMENSION_LINE_COLOR;ctx.lineCap="round";
  ctx.beginPath();for(const [a,b] of visibleDimensionSegments(dimensions)){ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);}ctx.stroke();
  ctx.font=`600 ${fontSize}px Arial, sans-serif`;ctx.textAlign="center";ctx.textBaseline="middle";
  for(const d of dimensions)for(const label of [{text:d.text,label:d.label,font:fontSize},...d.ticks.map(t=>({...t,font:Math.max(10,Math.round(fontSize*.65))}))]){
    ctx.font=`600 ${label.font}px Arial, sans-serif`;
    const x=label.label.x+label.label.width/2,y=label.label.y+label.label.height/2;ctx.lineWidth=3;ctx.strokeStyle="rgba(247,251,251,.95)";ctx.strokeText(label.text,x,y);ctx.fillStyle=colors.textColor??DIMENSION_TEXT_COLOR;ctx.fillText(label.text,x,y);
  }
}
