"use client";
import {palletLoadEnvelope} from "../lib/packing/unit-envelope";
import type {MeasurementOverlay} from "../lib/packing/saved-measurements";
import {siteExclusionBoxes} from "../lib/packing/site-exclusions";
import { packagingReservations } from "../lib/packing/packaging";
import { inspectionPallets, isolatedBounds, selectedBounds } from "../lib/packing/scene-view-scope";
import { MARK_ASPECT, markLines } from "../lib/packing/shipping-mark";
import { cargoShapeOf } from "../lib/packing/cargo-shape";
import {cargoFootprintLabel} from "../lib/packing/cargo-surface-labels";
import { cargoShapeFootprints } from "../lib/packing/cargo-shape-geometry";
import type { OrientationCode } from "../lib/packing/types";
import { useMemo, useRef, useId } from "react";
import * as THREE from "three";
import { cameraDimensionProjector, projectDimensions, sceneMeasurement } from "../lib/packing/scene-dimensions";
import { calculateCameraViewFit } from "../lib/packing/camera-fit";
import { labelsOverlap, layoutSceneLabel, type LabelRect } from "../lib/packing/scene-labels";
import type { PackingResult, PlacedBox } from "../lib/packing/types";
import type { PlanEditor } from "./use-plan-editor";
import type { AnalysisRegion } from "./scene-analysis-overlay";
import { DimensionSvg } from "./dimension-svg";
import { useModelViewport } from "./use-model-viewport";
import { useTransportAppearance } from "./transport-appearance";
import { tr, useLanguage } from "./language";
import { EMPTY_SECTION, formatMeasure, inspectBoxes, sectionBox, type Point3, type Section } from "../lib/packing/inspection";

/** All visible footprints are retained; exact stacked duplicates collapse to their top box. */
export function topViewFootprints(placements:PlacedBox[],visibleProducts:Set<string>,visibleCount:number) {
  const map=new Map<string,PlacedBox>();
  for(const b of placements.slice(0,visibleCount))if(visibleProducts.has(b.productId)){
    const key=[b.x,b.y,b.dx,b.dy].join(":"),previous=map.get(key);
    if(!previous||b.z+b.dz>=previous.z+previous.dz)map.set(key,b);
  }
  return [...map.values()].sort((a,b)=>a.z+a.dz-b.z-b.dz);
}
export function LoadingSceneFallback({result,visibleProducts,visibleCount,selected,onSelect,onClearSelection,palletPicking=true,section=EMPTY_SECTION,manualMeasurement,manualMeasurements=[],editor,regions=[],heatColors}:{result:PackingResult;visibleProducts:Set<string>;visibleCount:number;selected:PlacedBox|null;onSelect:(box:PlacedBox,point?:Point3,add?:boolean)=>void;onClearSelection?:()=>void;palletPicking?:boolean;section?:Section;manualMeasurement?:MeasurementOverlay|null;manualMeasurements?:MeasurementOverlay[];editor?:PlanEditor;regions?:AnalysisRegion[];heatColors?:Map<string,string>}) {
  useLanguage();
  const drag=useRef<{x:number;y:number;rectangle:boolean;add:boolean}|null>(null),suppressClick=useRef(false);
  const appearance=useTransportAppearance(),{host,viewport}=useModelViewport({width:720,height:340});
  const clipId=useId();
  const originalBoxes=useMemo(()=>new Map(result.placements.map(b=>[b.id,b])),[result.placements]);
  const silhouettes=useMemo(()=>{const map=new Map<string,Array<Array<[number,number]>>>();for(const b of result.placements){const meta=result.cargoDetails?.[b.productId]??{};const key=`${b.productId}/${b.orientation}/${b.orientationSigns?.join("/")??""}`;if((meta.solidModel||cargoShapeOf(meta)!=="box")&&!map.has(key))map.set(key,cargoShapeFootprints(meta,b.orientation as OrientationCode,b.orientationSigns));}return map;},[result]);
  const space=result.container,base=space.baseHeight??0,scale=5.6/Math.max(space.length-result.clearance*2,space.width-result.clearance*2,space.height-result.clearance+base);
  const isolated = section.isolation !== "all";
  const cartons = useMemo(() => inspectBoxes(result, visibleProducts, visibleCount, section), [result, visibleProducts, visibleCount, section]);
  const pallets = useMemo(() => inspectionPallets(result, visibleCount, section, cartons), [result, visibleCount, section, cartons]);
  const target = isolatedBounds(result, section, cartons, pallets);
  const outer = sceneMeasurement(space, result.clearance);
  const measurement = sceneMeasurement(space, result.clearance, target ?? selectedBounds(result, selected));
  const bounds = target ? measurement.bounds : outer.bounds;
  const size = bounds.max.map((value, axis) => value - bounds.min[axis]) as [number,number,number];
  const origin = new THREE.Vector3((bounds.min[0] + bounds.max[0]) / 2, bounds.min[1], (bounds.min[2] + bounds.max[2]) / 2);
  const fit = calculateCameraViewFit(size, viewport, "top");
  const camera = new THREE.OrthographicCamera(-fit.orthographicHalfWidth, fit.orthographicHalfWidth, fit.orthographicHalfHeight, -fit.orthographicHalfHeight, fit.near, fit.far);
  camera.position.fromArray(fit.position).add(origin);
  camera.up.fromArray(fit.up);
  camera.lookAt(new THREE.Vector3(...fit.target).add(origin));
  camera.updateProjectionMatrix();
  const project = cameraDimensionProjector(camera, viewport);
  const corners = [project(outer.bounds.min), project(outer.bounds.max)];
  const footprints = useMemo(() => topViewFootprints(cartons, new Set(cartons.map(box => box.productId)), cartons.length), [cartons]);
  const offset=[-(space.length-result.clearance*2)*scale/2,base*scale,-(space.width-result.clearance*2)*scale/2];
  const rectFor=(b:{x:number;y:number;z:number;dx:number;dy:number;dz:number})=>{
    const a=project([b.x*scale+offset[0],b.z*scale+offset[1],b.y*scale+offset[2]]),c=project([(b.x+b.dx)*scale+offset[0],(b.z+b.dz)*scale+offset[1],(b.y+b.dy)*scale+offset[2]]);
    return {x:Math.min(a.x,c.x),y:Math.min(a.y,c.y),width:Math.abs(c.x-a.x),height:Math.abs(c.y-a.y)};
  };
  const dimensionOptions = {unit: appearance.dimensionUnit, fontSize: appearance.dimensionFontSize, style: appearance.dimensionStyle, bottomInset: 12};
  const outerDimensions = appearance.dimensions && selected && !isolated
    ? projectDimensions(outer.bounds, outer.values, project, viewport, dimensionOptions) : [];
  const occupied: LabelRect[] = outerDimensions.flatMap(d => [d.label, ...d.ticks.map(t => t.label)]);
  const dimensions = appearance.dimensions && (!isolated || target)
    ? projectDimensions(measurement.bounds, measurement.values, project, viewport,
      {...dimensionOptions, style: outerDimensions.length ? "dimensions" : appearance.dimensionStyle, occupied}) : [];
  occupied.push(...dimensions.flatMap(d => [d.label, ...d.ticks.map(t => t.label)]));
  const seen = new Set<string>();
  const measuredItems=[...(manualMeasurement?[manualMeasurement]:[]),...manualMeasurements].map(m=>{
    const measured={a:project([m.a[0]*scale+offset[0],m.a[2]*scale+offset[1],m.a[1]*scale+offset[2]]),b:project([m.b[0]*scale+offset[0],m.b[2]*scale+offset[1],m.b[1]*scale+offset[2]])};
    const label="label" in m&&typeof m.label==="string"&&m.label?m.label.slice(0,40)+" · ":"",text=label+(m.basis==="surface"?tr("实体直线距 · ","Solid point distance · "):"")+formatMeasure(m.distance,appearance.dimensionUnit,appearance.measurePrecision);
    const rect=layoutSceneLabel({x:(measured.a.x+measured.b.x)/2-text.length*4.5,y:(measured.a.y+measured.b.y)/2-30,width:text.length*9+12,height:24},viewport,occupied);
    if(rect&&appearance.dimensions)occupied.push(rect);return {measured,text,rect};
  });
  const labelBoxes=appearance.labels?footprints:appearance.skuSummaries?footprints.filter(b=>{if(seen.has(b.productId))return false;seen.add(b.productId);return true;}):[];
  const labelLimit=Math.max(16,Math.floor(viewport.width*viewport.height/(108*30)));
  const labels = [...labelBoxes].sort((a, b) => Number(b.id === selected?.id) - Number(a.id === selected?.id)).slice(0, labelLimit).flatMap(box => {
    const rect = rectFor(box);
    const mark = appearance.labels ? result.cargoDetails?.[box.productId]?.shippingMark : undefined;
    const lines = markLines(mark?.text ?? (mark?.image ? "" : box.sku));
    const points = silhouettes.get(`${box.productId}/${box.orientation}/${box.orientationSigns?.join("/") ?? ""}`) ?? [[[-.5,-.5],[.5,-.5],[.5,.5],[-.5,.5]]];
    const ratio = mark ? MARK_ASPECT : (box.sku.length * 7 + 12) / 20;
    const label = appearance.labels ? cargoFootprintLabel(points, rectFor(originalBoxes.get(box.id) ?? box), ratio)
      : layoutSceneLabel({x:rect.x+rect.width/2-box.sku.length*3.5,y:rect.y+rect.height/2-9,width:box.sku.length*7+12,height:20},viewport,occupied);
    if (!label || appearance.labels && (label.x < rect.x || label.y < rect.y || label.x + label.width > rect.x + rect.width || label.y + label.height > rect.y + rect.height) || occupied.some(other => labelsOverlap(label, other, appearance.labels ? 0 : 4))) return [];
    occupied.push(label);
    return [{ id: box.id, lines, image: mark?.image, label }];
  });
  return <div className="scene-fallback"><div ref={host} className="fallback-model-stage"><svg viewBox={`0 0 ${viewport.width} ${viewport.height}`} role="img" aria-label={tr("真实坐标俯视图", "Actual-coordinate top view")} onPointerDown={e=>{if(editor?.enabled&&editor.rectangle){drag.current={x:e.clientX,y:e.clientY,rectangle:true,add:e.shiftKey};e.currentTarget.setPointerCapture(e.pointerId);}}} onPointerUp={e=>{const start=drag.current;drag.current=null;if(!start||!editor)return;const svg=e.currentTarget,matrix=svg.getScreenCTM();if(!matrix)return;const point=svg.createSVGPoint();point.x=start.x;point.y=start.y;const a=point.matrixTransform(matrix.inverse());point.x=e.clientX;point.y=e.clientY;const b=point.matrixTransform(matrix.inverse());const moved=Math.hypot(e.clientX-start.x,e.clientY-start.y)>3;suppressClick.current=true;
      if(start.rectangle){const ids=inspectBoxes(result,visibleProducts,visibleCount,section).filter(box=>{const r=rectFor(box),x=r.x+r.width/2,y=r.y+r.height/2;return x>=Math.min(a.x,b.x)&&x<=Math.max(a.x,b.x)&&y>=Math.min(a.y,b.y)&&y<=Math.max(a.y,b.y);}).map(box=>box.id);editor.selectMany(ids,start.add);}else if(moved){const r=rectFor({x:0,y:0,z:0,dx:100,dy:100,dz:1});editor.move({x:(b.x-a.x)/r.width*100,y:(b.y-a.y)/r.height*100,z:0});}}} onPointerCancel={()=>{drag.current=null;}} onClick={event=>{if(event.target===event.currentTarget&&!editor?.rectangle)onClearSelection?.();}}>
    {!isolated&&<rect x={Math.min(corners[0].x,corners[1].x)} y={Math.min(corners[0].y,corners[1].y)} width={Math.abs(corners[1].x-corners[0].x)} height={Math.abs(corners[1].y-corners[0].y)} fill="none" stroke="#70939d" strokeWidth={2} pointerEvents="none"/>}
    {pallets.flatMap(p=>{const display=sectionBox(p,result,section);return display?[{original:p,display}]:[];}).map(({original:p,display})=><rect key={p.id} {...rectFor(display)} fill="#dbc099" stroke={selected?.id===p.id?"#da8c2e":"#b39670"} strokeWidth={selected?.id===p.id?3:1} role={palletPicking?"button":undefined} tabIndex={palletPicking?0:undefined} pointerEvents={palletPicking?"auto":"none"} aria-label={palletPicking?`${tr("托盘", "Pallet")} ${p.id}`:undefined} onClick={()=>onSelect({...p,productId:p.id,sku:p.name,color:"#d4af7b",layer:0,orientation:"LWH",supportOnly:true})} onKeyDown={e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();onSelect({...p,productId:p.id,sku:p.name,color:"#d4af7b",layer:0,orientation:"LWH",supportOnly:true});}}}/>)}
    {footprints.map(b=><rect key={b.id} {...rectFor(b)} fill={heatColors?.get(b.id)??b.color} fillOpacity={cargoShapeOf(result.cargoDetails?.[b.productId]??{})==="box"&&!result.cargoDetails?.[b.productId]?.solidModel?1:0} stroke={(editor?.enabled?editor.selected.some(s=>s.id===b.id):selected?.id===b.id)?"#da8c2e":"#ffffffaa"} strokeWidth={(editor?.enabled?editor.selected.some(s=>s.id===b.id):selected?.id===b.id)?3:1} role="button" tabIndex={0} aria-label={`${b.sku} ${b.id}`} onPointerDown={e=>{if(editor?.enabled&&!editor.rectangle&&!editor.disabled){editor.select(b.id,e.shiftKey);drag.current={x:e.clientX,y:e.clientY,rectangle:false,add:e.shiftKey};suppressClick.current=true;e.currentTarget.setPointerCapture(e.pointerId);}}} onClick={e=>{if(editor?.enabled){if(suppressClick.current){suppressClick.current=false;return;}onSelect(b,undefined,e.shiftKey);return;}const r=rectFor(b),svg=e.currentTarget.ownerSVGElement!,matrix=svg.getScreenCTM(),p=svg.createSVGPoint();p.x=e.clientX;p.y=e.clientY;const local=matrix?p.matrixTransform(matrix.inverse()):{x:r.x+r.width/2,y:r.y+r.height/2};onSelect(b,[b.x+(local.x-r.x)/r.width*b.dx,b.y+(local.y-r.y)/r.height*b.dy,b.z+b.dz]);}} onKeyDown={e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();onSelect(b,[b.x+b.dx/2,b.y+b.dy/2,b.z+b.dz],e.shiftKey);}}}/>)}
    <g className="fallback-cargo-shapes" pointerEvents="none">{footprints.map((b,i)=>{const source=originalBoxes.get(b.id)??b,meta=result.cargoDetails?.[b.productId]??{},shape=cargoShapeOf(meta),points=silhouettes.get(`${b.productId}/${b.orientation}/${b.orientationSigns?.join("/")??""}`);if((shape==="box"||shape==="irregular")&&!meta.solidModel||!points)return null;const id=`${clipId}-${i}`,polygons=points.map(outline=>outline.map(([x,y])=>{const p=project([(source.x+(x+.5)*source.dx)*scale+offset[0],source.z*scale+offset[1],(source.y+(y+.5)*source.dy)*scale+offset[2]]);return `${p.x},${p.y}`;}).join(" "));return <g key={b.id} data-cargo-shape={shape}><defs><clipPath id={id}><rect {...rectFor(b)}/></clipPath></defs><path clipPath={`url(#${id})`} d={polygons.map(polygon=>`M${polygon.split(" ").join("L")}Z`).join(" ")} fillRule="nonzero" fill={heatColors?.get(b.id)??b.color}/></g>;})}</g>
    <g className="fallback-site-regions" pointerEvents="none">{!isolated&&siteExclusionBoxes(result.container,result.clearance).flatMap(b=>{const display=sectionBox(b,result,section);return display?[<rect key={b.id} {...rectFor(display)} fill={b.color} fillOpacity={.4} stroke={b.color} strokeDasharray="6 3"><title>{tr("柜内障碍或禁占区","Site exclusion")} · {b.name}</title></rect>]:[];})}</g>
    <g className="fallback-packaging-walls" pointerEvents="none">{pallets.filter(p=>p.enclosureHeight).flatMap(p=>packagingReservations(p).filter(b=>b.kind==="wall").map((b,i)=><rect key={p.id+"-wall-"+i} {...rectFor(b)} fill={p.packaging?.color} fillOpacity={p.packaging?.opacity??.65} stroke={p.packaging?.color} strokeWidth={1}/>))}</g>
    <g className="fallback-measured-envelopes" pointerEvents="none">{pallets.filter(p=>p.measuredEnvelope).flatMap(p=>{const e=sectionBox(palletLoadEnvelope(p,result.placements.filter(b=>b.palletIds?.includes(p.id))),result,section);return e?[<rect key={p.id} {...rectFor(e)} fill="none" stroke="#b87522" strokeWidth={2} strokeDasharray="7 4"><title>{tr("实测保守装载包络","Measured conservative loading envelope")} · {p.id}</title></rect>]:[];})}</g>
    <g className="fallback-analysis-overlay" pointerEvents="none">{!isolated&&regions.map(b=><rect key={b.id} {...rectFor(b)} fill={b.color} fillOpacity={.16} stroke={b.color} strokeDasharray="6 4" strokeWidth={2}><title>{b.id} · {b.dx.toFixed(1)} × {b.dy.toFixed(1)} × {b.dz.toFixed(1)} mm · Z {b.z.toFixed(1)}</title></rect>)}</g>
    <g className="fallback-sku-labels" pointerEvents="none">{labels.map(({id,lines,image,label})=>{
      const imageHeight = image ? label.height * (lines.length ? .48 : .92) : 0;
      const textHeight = (label.height - imageHeight) / Math.max(1, lines.length);
      return <g key={id}>
        <rect {...label} rx={Math.min(3,label.height/8)} fill="#fffffa"/>
        {image && <image href={image} x={label.x+label.width*.04} y={label.y+label.height*.04} width={label.width*.92} height={imageHeight} preserveAspectRatio="xMidYMid meet"/>}
        {lines.map((line,index)=><text key={index} x={label.x+label.width/2} y={label.y+imageHeight+textHeight*(index+.72)} textAnchor="middle" fill="#376272" fontSize={Math.min(textHeight*.68,label.width/Math.max(1,line.length*.7))} fontFamily="Arial, sans-serif">{line}</text>)}
      </g>;
    })}</g>
    {!!outerDimensions.length&&<DimensionSvg dimensions={outerDimensions} fontSize={appearance.dimensionFontSize} lineColor={appearance.dimensionLineColor} textColor={appearance.dimensionTextColor}/>}
    {appearance.dimensions&&<DimensionSvg dimensions={dimensions} fontSize={appearance.dimensionFontSize} lineColor={outerDimensions.length?"#b57925":appearance.dimensionLineColor} textColor={outerDimensions.length?"#825515":appearance.dimensionTextColor}/>}
    {appearance.dimensions&&measuredItems.map(({measured,text,rect},i)=><g key={i} className="manual-measurement" pointerEvents="none"><title>{text}</title><line x1={measured.a.x} y1={measured.a.y} x2={measured.b.x} y2={measured.b.y} stroke={appearance.dimensionLineColor} strokeWidth={2}/>{[measured.a,measured.b].map((p,i)=><circle key={i} cx={p.x} cy={p.y} r={4} fill={appearance.dimensionLineColor}/>)}{rect&&<><rect {...rect} rx={4} fill="#f7fbfbef"/><text x={rect.x+rect.width/2} y={rect.y+17} fontSize={16} textAnchor="middle" fill={appearance.dimensionTextColor}>{text}</text></>}</g>)}
  </svg></div><strong>{tr("当前浏览器未启用 WebGL")}</strong><span>{tr("已切换为真实坐标俯视图；装柜计算、校验与导出不受影响。")}</span></div>;
}
