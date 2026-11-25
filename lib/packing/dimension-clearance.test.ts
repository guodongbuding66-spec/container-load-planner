import {expect,it} from "vitest";
import {projectModelPreview} from "./model-preview";
import {projectDimensions,visibleDimensionSegments} from "./scene-dimensions";
import {transportSceneBounds} from "./transport-model";
import {TRANSPORT_PRESETS} from "./transport-library";

const truck=TRANSPORT_PRESETS.find(s=>s.id==="40hq")!;
const cases=[{...truck,length:12000},{...truck,length:1200,width:800,height:144,baseHeight:0}];
it("keeps dimension captions on an outer track clear of the measured edge and every visible blue line",()=>{
 for(const target of cases)for(const viewport of [{width:320,height:245},{width:390,height:300},{width:520,height:320},{width:680,height:420},{width:960,height:420}])for(const fontSize of [14,18,22,26]){
  const bounds=target.height===144?{size:[target.length,target.height,target.width] as [number,number,number],origin:[0,0,0] as [number,number,number]}:transportSceneBounds(target,1,"model",0);
  const {project}=projectModelPreview([],bounds,[Math.sin(.72)*Math.cos(.42),Math.sin(.42),Math.cos(.72)*Math.cos(.42)],viewport.width,viewport.height,undefined,fontSize*2+16);
  const marks=projectDimensions({min:[-target.length/2,0,-target.width/2],max:[target.length/2,target.height,target.width/2]},{L:target.length,W:target.width,H:target.height},project,viewport,{fontSize,style:"ruler",bottomInset:25,occupied:[{x:0,y:0,width:viewport.width,height:40}]});
  expect(marks).toHaveLength(3);
  const corners=[-target.length/2,target.length/2].flatMap(x=>[0,target.height].flatMap(y=>[-target.width/2,target.width/2].map(z=>project([x,y,z]))));
  const edges=corners.flatMap((a,i)=>corners.slice(i+1).flatMap(b=>[-1,1].map(sign=>{const length=Math.hypot(b.x-a.x,b.y-a.y);return {a,n:{x:sign*(b.y-a.y)/length,y:sign*(a.x-b.x)/length}};}))).filter(({a,n})=>corners.every(p=>n.x*(p.x-a.x)+n.y*(p.y-a.y)<=.00001));
  for(const mark of marks){
   const {label}=mark;


   const nearest=Math.max(Math.min(...corners.map(p=>p.x))-label.x-label.width,label.x-Math.max(...corners.map(p=>p.x)),Math.min(...corners.map(p=>p.y))-label.y-label.height,label.y-Math.max(...corners.map(p=>p.y)),...edges.map(({n,a})=>n.x*(label.x+(n.x<0?label.width:0)-a.x)+n.y*(label.y+(n.y<0?label.height:0)-a.y)));
   expect(nearest,`${target.length}×${target.width}×${target.height} ${viewport.width}px ${fontSize}px ${mark.axis}`).toBeGreaterThanOrEqual(10-1e-6);
  }
  for(const mark of marks)for(const [a,b] of visibleDimensionSegments(marks))for(let t=0;t<=1;t+=.02){
   const x=a.x+(b.x-a.x)*t,y=a.y+(b.y-a.y)*t,r=mark.label;
   expect(x>r.x-9.9&&x<r.x+r.width+9.9&&y>r.y-9.9&&y<r.y+r.height+9.9).toBe(false);
  }
 }
});
