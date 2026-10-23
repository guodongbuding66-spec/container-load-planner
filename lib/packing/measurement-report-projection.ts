import {boxFeatures,type Point3} from "./inspection";
import {regularSurface} from "./surface-inspection";
import type {MeasurementReportEntry} from "./measurement-report";
export type ReportProjectionView="top"|"side"|"door";
export type ReportPlotRect={x:number;y:number;width:number;height:number};
/** Uses recorded targets and geometry only, including historical or clipped envelope snapshots. */
export function measurementReportProjection(entry:MeasurementReportEntry,view:ReportProjectionView,rect:ReportPlotRect){
  const axes=view==="top"?[0,1]:view==="side"?[0,2]:[1,2],seen=new Set<string>(),segments:[Point3,Point3][]=[];
  entry.record.targets.forEach((target,i)=>{
    const spec=entry.record.surface?.[i],key=JSON.stringify([target.id,target.bounds,spec]);if(seen.has(key))return;seen.add(key);
    if(spec)segments.push(...regularSurface(target.bounds,spec).edges);
    else {const v=boxFeatures(target.bounds,"vertex");for(let a=0;a<v.length;a++)for(let b=a+1;b<v.length;b++)if(v[a].filter((n,i)=>n!==v[b][i]).length===1)segments.push([v[a],v[b]]);}
  });
  const points=[...segments.flat(),entry.value.a,entry.value.b],lo=axes.map(a=>Math.min(...points.map(p=>p[a]))),hi=axes.map(a=>Math.max(...points.map(p=>p[a]))),sizes=hi.map((n,i)=>n-lo[i]),scale=Math.min((rect.width-70)/Math.max(sizes[0],1),(rect.height-80)/Math.max(sizes[1],1));
  const project=(p:Point3)=>({x:rect.x+rect.width/2+(p[axes[0]]-(lo[0]+hi[0])/2)*scale,y:rect.y+rect.height/2+(view==="top"?1:-1)*(p[axes[1]]-(lo[1]+hi[1])/2)*scale});
  return {segments:segments.map(([a,b])=>[project(a),project(b)]),a:project(entry.value.a),b:project(entry.value.b),axes:axes.map(i=>"XYZ"[i]).join(" / "),scale};
}
