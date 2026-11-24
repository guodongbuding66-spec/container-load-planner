import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { OrbitControls } from "three-stdlib";
import { SceneCameraController } from "./scene-camera";
import type { CameraPresetView, CameraProjection } from "./camera-fit";
import { visibleDimensionSegments, cameraDimensionProjector, formatDimension, paintDimensions, projectDimensions, sceneMeasurement } from "./scene-dimensions";
import { labelsOverlap } from "./scene-labels";
import { TRANSPORT_PRESETS } from "./transport-library";
import { projectModelPreview } from "./model-preview";
import { transportSceneBounds } from "./transport-model";

const space = TRANSPORT_PRESETS.find(s=>s.id==="20gp")!;
const measurement = sceneMeasurement(space, 20);
const size = measurement.bounds.max.map((n,i)=>n-measurement.bounds.min[i]) as [number,number,number];
const viewports = [{width:320,height:245},{width:920,height:420},{width:2048,height:852}];
const projections:CameraProjection[]=["perspective","orthographic"];
const views:CameraPresetView[]=["perspective","top","side","door","bottom","rear","left"];

describe("engineering dimensions attached to actual measured edges",()=>{
  it("changes display units without changing solver dimensions",()=>{
    expect(formatDimension(2200,"mm")).toBe("2200 mm");
    expect(formatDimension(2200,"cm")).toBe("220 cm");
    expect(formatDimension(2200,"m")).toBe("2.2 m");
    expect(formatDimension(144,"m")).toBe("0.144 m");
    expect(formatDimension(620.5,"cm")).toBe("62.05 cm");
    expect(formatDimension(17500,"mm")).toBe("17500 mm");
  });

  it("measures entered inner dimensions and oriented cartons with clearance and base height",()=>{
    const target={...space,baseHeight:144},box={x:100,y:200,z:300,dx:2200,dy:620,dz:180};
    const original=JSON.stringify({target,box});
    const whole=sceneMeasurement(target,20),selected=sceneMeasurement(target,20,box);
    expect(whole.values).toEqual({L:target.length,W:target.width,H:target.height});
    expect(selected.values).toEqual({L:2200,W:620,H:180});
    const scale=5.6/Math.max(target.length-40,target.width-40,target.height-20+144);
    selected.bounds.min.forEach((n,i)=>expect(n).toBeCloseTo([(100-(target.length-40)/2)*scale,444*scale,(200-(target.width-40)/2)*scale][i],10));
    selected.bounds.max.forEach((n,i)=>expect(n-selected.bounds.min[i]).toBeCloseTo([2200,180,620][i]*scale,10));
    expect(JSON.stringify({target,box})).toBe(original);
  });

  it.each(projections.flatMap(projection=>views.flatMap(view=>viewports.map(viewport=>({projection,view,viewport})))))(
    "keeps marks attached and text readable in $projection / $view at $viewport",
    ({projection,view,viewport})=>{
      const rig=new SceneCameraController(),camera=rig.cameras[projection],controls=new OrbitControls(camera);
      rig.update({containerSize:size,viewport,view,projection},controls);
      const project=cameraDimensionProjector(camera,viewport);
      const marks=projectDimensions(measurement.bounds,measurement.values,project,viewport,{fontSize:26,bottomInset:12});
      // A directly facing axis lies inside the silhouette even in perspective.
      // Its foreshortened corner edges must not create misleading interior marks.
      const expected=view==="perspective"?["L","W","H"]:["top","bottom"].includes(view)?["L","W"]:["side","left"].includes(view)?["L","H"]:["W","H"];
      expect(marks.map(d=>d.axis).sort()).toEqual(expected.sort());
      const occupied:typeof marks[0]["label"][]=[];
      for(const mark of marks){
        expect(mark.text).toBe(`${mark.axis} ${formatDimension(measurement.values[mark.axis],"mm")}`);
        expect(mark.label.x).toBeGreaterThanOrEqual(8);expect(mark.label.y).toBeGreaterThanOrEqual(8);
        expect(mark.label.x+mark.label.width).toBeLessThanOrEqual(viewport.width-8);
        expect(mark.label.y+mark.label.height).toBeLessThanOrEqual(viewport.height-20);
        expect(occupied.some(r=>labelsOverlap(r,mark.label))).toBe(false);occupied.push(mark.label);
        // The measured edge remains on a real corner, and its line is exactly 14 screen pixels away.
        for(const endpoint of mark.measuredEdge){
          const corners=[measurement.bounds.min[0],measurement.bounds.max[0]].flatMap(x=>[measurement.bounds.min[1],measurement.bounds.max[1]].flatMap(y=>[measurement.bounds.min[2],measurement.bounds.max[2]].map(z=>project([x,y,z]))));
          expect(corners.some(p=>Math.hypot(p.x-endpoint.x,p.y-endpoint.y)<1e-8)).toBe(true);
        }
        mark.measuredEdge.forEach((p,i)=>expect(Math.hypot(mark.segments[2][i].x-p.x,mark.segments[2][i].y-p.y)).toBeCloseTo(14,8));
      }
      controls.dispose();
    },
  );

  it("handles rotations, zoom, small pallet heights and long trucks with stable font height",()=>{
    for(const target of TRANSPORT_PRESETS.filter(s=>["truck-17.5","20gp"].includes(s.id)).concat({...space,id:"thin-pallet",length:1200,width:800,height:144,baseHeight:0})){
      const m=sceneMeasurement(target,0),s=m.bounds.max.map((n,i)=>n-m.bounds.min[i]) as [number,number,number];
      for(const projection of projections)for(const viewport of viewports)for(const yaw of [.5,2,3.8,5.4])for(const zoom of [.6,1,1.5]){
        const rig=new SceneCameraController(),camera=rig.cameras[projection],controls=new OrbitControls(camera);
        rig.update({containerSize:s,viewport,view:"perspective",projection},controls);
        const center=new THREE.Vector3(0,s[1]/2,0),distance=camera.position.distanceTo(center);
        camera.position.copy(center).addScaledVector(new THREE.Vector3(Math.sin(yaw),.5,Math.cos(yaw)).normalize(),distance);
        camera.lookAt(center);camera.zoom=zoom;camera.updateProjectionMatrix();
        const marks=projectDimensions(m.bounds,m.values,cameraDimensionProjector(camera,viewport),viewport,{unit:"m",fontSize:22});
        expect(marks).toHaveLength(3);
        for(const mark of marks){expect(mark.label.height).toBe(26);expect(mark.segments.flat().every(p=>Number.isFinite(p.x+p.y))).toBe(true);expect(mark.text.endsWith(" m")).toBe(true);}
        controls.dispose();
      }
    }
  });

  it("avoids existing badges with leaders and suppresses detached offscreen/behind-camera marks",()=>{
    const viewport={width:720,height:340},rig=new SceneCameraController(),controls=new OrbitControls(rig.cameras.perspective);
    rig.update({containerSize:size,viewport,view:"perspective",projection:"perspective"},controls);
    const project=cameraDimensionProjector(rig.cameras.perspective,viewport),marks=projectDimensions(measurement.bounds,measurement.values,project,viewport);
    const relaid=projectDimensions(measurement.bounds,measurement.values,project,viewport,{occupied:marks.map(d=>d.label)});
    expect(relaid.every(d=>marks.every(m=>!labelsOverlap(d.label,m.label)))).toBe(true);
    expect(relaid.some(d=>d.segments.length===6)).toBe(true);
    expect(projectDimensions(measurement.bounds,measurement.values,p=>({...project(p),depth:2}),viewport)).toEqual([]);
    expect(projectDimensions(measurement.bounds,measurement.values,p=>({...project(p),x:project(p).x+3000}),viewport)).toEqual([]);
    controls.dispose();
  });

  it("keeps small preview labels clear of the WebGL note and reset control",()=>{
    const truck=TRANSPORT_PRESETS.find(s=>s.id==="truck-4.2")!;
    const pallet={...truck,length:1200,width:800,height:144};
    for(const target of [truck,pallet])for(const fontSize of [18,22,26])for(const yaw of [.72,1.32,2.72,4.72]){
      const viewport={width:285,height:245};
      const bounds=target===truck?transportSceneBounds(target,1,"model",0):{size:[target.length,target.height,target.width] as [number,number,number],origin:[0,0,0] as [number,number,number]};
      const {project}=projectModelPreview([],bounds,[Math.sin(yaw)*Math.cos(.42),Math.sin(.42),Math.cos(yaw)*Math.cos(.42)],viewport.width,viewport.height);
      const controls={x:0,y:0,width:viewport.width,height:40};
      const marks=projectDimensions({min:[-target.length/2,0,-target.width/2],max:[target.length/2,target.height,target.width/2]},{L:target.length,W:target.width,H:target.height},project,viewport,{occupied:[controls],bottomInset:25,fontSize,style:"ruler"});
      expect(marks).toHaveLength(3);
      for(const rect of marks.flatMap(d=>[d.label,...d.ticks.map(t=>t.label)]))expect(labelsOverlap(rect,controls)).toBe(false);
    }
  });

  it("paints blue edge lines and unboxed unit-bearing text, included in the canvas layer",()=>{
    const viewport={width:720,height:340},rig=new SceneCameraController(),controls=new OrbitControls(rig.cameras.perspective);
    rig.update({containerSize:size,viewport,view:"perspective",projection:"perspective"},controls);
    const marks=projectDimensions(measurement.bounds,measurement.values,cameraDimensionProjector(rig.cameras.perspective,viewport),viewport,{unit:"cm",fontSize:22});
    const text:string[]=[],segments:number[][]=[],strokeColors:string[]=[];
    const ctx={font:"",strokeStyle:"",fillStyle:"",beginPath(){},moveTo(x:number,y:number){segments.push([x,y]);},lineTo(x:number,y:number){segments.push([x,y]);},stroke(){strokeColors.push(this.strokeStyle);},strokeText(){},fillText(value:string){text.push(value);}};
    paintDimensions(ctx as unknown as CanvasRenderingContext2D,marks,22);
    expect(ctx.font).toBe("600 22px Arial, sans-serif");expect(ctx.fillStyle).toBe("#137d83");expect(strokeColors).toEqual(["#467ee6"]);
    expect(segments.length).toBeGreaterThanOrEqual(30);expect(text).toEqual(marks.map(d=>d.text));
    controls.dispose();
  });

  it.each(projections)("keeps all measured edges on the silhouette through a full orbit in %s",projection=>{
    const viewport={width:920,height:420},rig=new SceneCameraController(),camera=rig.cameras[projection],controls=new OrbitControls(camera);
    rig.update({containerSize:size,viewport,view:"perspective",projection},controls);
    const center=new THREE.Vector3(0,size[1]/2,0),distance=camera.position.distanceTo(center);
    let previousEdges:Partial<Record<"L"|"W"|"H",string>>={};
    for(const pitch of [-1.3,-.4,0,.4,1.3])for(let degrees=0;degrees<360;degrees+=3){
      const yaw=degrees*Math.PI/180;
      camera.position.copy(center).add(new THREE.Vector3(Math.sin(yaw)*Math.cos(pitch),Math.sin(pitch),Math.cos(yaw)*Math.cos(pitch)).multiplyScalar(distance));camera.lookAt(center);
      const project=cameraDimensionProjector(camera,viewport),marks=projectDimensions(measurement.bounds,measurement.values,project,viewport,{fontSize:18,style:"ruler",previousEdges});
      expect(marks.length).toBeGreaterThanOrEqual(2);
      const corners=[measurement.bounds.min[0],measurement.bounds.max[0]].flatMap(x=>[measurement.bounds.min[1],measurement.bounds.max[1]].flatMap(y=>[measurement.bounds.min[2],measurement.bounds.max[2]].map(z=>project([x,y,z]))));
      const labels=marks.flatMap(d=>[d.label,...d.ticks.map(t=>t.label)]);
      for(const d of marks){
        const [start]=d.measuredEdge,n=d.normal;
        for(const p of corners)expect(n.x*(p.x-start.x)+n.y*(p.y-start.y)).toBeLessThanOrEqual(.50001);
        for(const p of corners)expect(n.x*(p.x-d.segments[2][0].x)+n.y*(p.y-d.segments[2][0].y)).toBeLessThanOrEqual(-13.49999);
        expect(d.text).toBe(`${d.axis} ${formatDimension(measurement.values[d.axis],"mm")}`);
      }
      labels.forEach((r,i)=>expect(labels.slice(i+1).some(other=>labelsOverlap(r,other))).toBe(false));
      previousEdges=Object.fromEntries(marks.map(d=>[d.axis,d.edgeId]));
    }
    controls.dispose();
  });

  it("projects ruler ticks at physical distances and keeps unit-independent intervals",()=>{
    const viewport={width:1200,height:600},rig=new SceneCameraController(),camera=rig.cameras.perspective,controls=new OrbitControls(camera);
    rig.update({containerSize:size,viewport,view:"perspective",projection:"perspective"},controls);
    const project=cameraDimensionProjector(camera,viewport);
    const mm=projectDimensions(measurement.bounds,measurement.values,project,viewport,{style:"ruler"}),cm=projectDimensions(measurement.bounds,measurement.values,project,viewport,{style:"ruler",unit:"cm"});
    expect(mm.flatMap(d=>d.ticks).length).toBeGreaterThan(0);
    for(const d of mm){
      const same=cm.find(m=>m.axis===d.axis)!;expect(same.segments).toEqual(d.segments);
      // Every tick starts at a projection of a point on the measured 3D edge.
      const [a,b]=d.measuredEdge,coordinate=d.axis==="L"?0:d.axis==="W"?2:1;
      const worldA=new THREE.Vector3((a.x/viewport.width)*2-1,1-(a.y/viewport.height)*2,a.depth).unproject(camera),worldB=new THREE.Vector3((b.x/viewport.width)*2-1,1-(b.y/viewport.height)*2,b.depth).unproject(camera);
      for(const [tick] of d.segments.slice(5)){
        const onLine={x:tick.x-d.normal.x*11,y:tick.y-d.normal.y*11};
        const dx=b.x-a.x,dy=b.y-a.y,t=((onLine.x-a.x)*dx+(onLine.y-a.y)*dy)/(dx*dx+dy*dy),depth=a.depth+(b.depth-a.depth)*t;
        const world=new THREE.Vector3(onLine.x/viewport.width*2-1,1-onLine.y/viewport.height*2,depth).unproject(camera);
        for(const i of [0,1,2].filter(i=>i!==coordinate))expect(world.getComponent(i)).toBeCloseTo(worldA.getComponent(i),6);
        expect(world.getComponent(coordinate)).toBeGreaterThanOrEqual(Math.min(worldA.getComponent(coordinate),worldB.getComponent(coordinate))-1e-8);
        expect(world.getComponent(coordinate)).toBeLessThanOrEqual(Math.max(worldA.getComponent(coordinate),worldB.getComponent(coordinate))+1e-8);
      }
    }
    controls.dispose();
  });

  it("uses custom colours in the exported canvas and rejects invalid zero ruler ranges",()=>{
    const viewport={width:720,height:340},rig=new SceneCameraController(),controls=new OrbitControls(rig.cameras.perspective);
    rig.update({containerSize:size,viewport,view:"perspective",projection:"perspective"},controls);
    const project=cameraDimensionProjector(rig.cameras.perspective,viewport),marks=projectDimensions(measurement.bounds,measurement.values,project,viewport,{style:"ruler"});
    const strokes:string[]=[],fills:string[]=[];
    const ctx={save(){},restore(){},rect(){},clip(){},strokeStyle:"",fillStyle:"",beginPath(){},moveTo(){},lineTo(){},stroke(){strokes.push(this.strokeStyle);},strokeText(){},fillText(){fills.push(this.fillStyle);}};
    paintDimensions(ctx as unknown as CanvasRenderingContext2D,marks,18,{lineColor:"#ff6600",textColor:"#5522aa"});
    expect(strokes).toEqual(["#ff6600"]);expect(fills.length).toBeGreaterThan(3);expect(new Set(fills)).toEqual(new Set(["#5522aa"]));
    expect(projectDimensions(measurement.bounds,{...measurement.values,L:0},project,viewport,{style:"ruler"})).toEqual([]);
    controls.dispose();
  });
});

it("cuts rendered line tracks around dimension text while retaining physical measured segments",()=>{
 const viewport={width:920,height:420},rig=new SceneCameraController(),controls=new OrbitControls(rig.cameras.orthographic);
 rig.update({containerSize:size,viewport,view:"top",projection:"orthographic"},controls);
 const marks=projectDimensions(measurement.bounds,measurement.values,cameraDimensionProjector(rig.cameras.orthographic,viewport),viewport,{style:"ruler",fontSize:18});
 const physical=JSON.stringify(marks.map(d=>d.segments));
 const lines=visibleDimensionSegments(marks);
 for(const d of marks)for(const [a,b] of lines)for(let t=0;t<=1;t+=.1){
  const x=a.x+(b.x-a.x)*t,y=a.y+(b.y-a.y)*t;
  expect(x>d.label.x&&x<d.label.x+d.label.width&&y>d.label.y&&y<d.label.y+d.label.height).toBe(false);
 }
 expect(JSON.stringify(marks.map(d=>d.segments))).toBe(physical);controls.dispose();
});
