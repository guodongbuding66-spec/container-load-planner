"use client";
import {regularSurfaceSpec,snapRegularSurface} from "../lib/packing/surface-inspection";
import { useMemo, useState } from "react";
import { EMPTY_SECTION, inspectBoxes, measureBoxGap, measurePoints, measureWall, sectionBox, snapBoxPoint, type BoundsBox, type MeasureMode, type Point3, type Section, type SnapMode, type WallSide } from "../lib/packing/inspection";
import type { PackingResult, PlacedBox } from "../lib/packing/types";
import { useTransportAppearance } from "./transport-appearance";
import {captureMeasurement,savedMeasureOverlays} from "../lib/packing/saved-measurements";
import {useSavedMeasurements} from "./use-saved-measurements";
import {deliveryPlanSignature} from "../lib/packing/delivery-identity";
type Inspection={basis:"envelope"|"surface";mode:MeasureMode;wall:WallSide;points:Point3[];snaps:SnapMode[];captures:BoundsBox[];boxes:PlacedBox[];locked:boolean;section:Section};
const empty=():Inspection=>({basis:"envelope",mode:"off",wall:"x-",points:[],snaps:[],captures:[],boxes:[],locked:false,section:{...EMPTY_SECTION}});
export function useSceneInspection(result:PackingResult|null,visibleProducts:Set<string>,visibleCount:number){
  const appearance=useTransportAppearance();
  const saved=useSavedMeasurements();
  const [state,setState]=useState<{plan:PackingResult|null;value:Inspection}>(()=>({plan:result,value:empty()}));
  const value=useMemo(()=>state.plan===result?state.value:empty(),[state,result]);
  const update=(patch:Partial<Inspection>)=>setState(previous=>({plan:result,value:{...(previous.plan===result?previous.value:empty()),...patch}}));
  const displayBoxes=useMemo(()=>result?inspectBoxes(result,visibleProducts,visibleCount,value.section):[],[result,visibleProducts,visibleCount,value.section]);
  const validBoxes=value.boxes.filter(box=>box.supportOnly?!!result?.pallets?.some(p=>p.id===box.id)&&!!sectionBox(box,result!,value.section)&&(value.section.isolation!=="pallet"||value.section.target===box.id):displayBoxes.some(b=>b.id===box.id));
  const validPoints=validBoxes.length===value.boxes.length?value.points:[];
  const measurement=value.mode==="points"&&validPoints.length===2?{...measurePoints(validPoints[0],validPoints[1]),basis:value.basis}:value.mode==="gap"&&validBoxes.length===2?measureBoxGap(validBoxes[0],validBoxes[1]):value.mode==="wall"&&validBoxes[0]&&result?measureWall(validBoxes[0],result,value.wall):null;
  const pick=(box:PlacedBox,point?:Point3)=>{
    if(value.locked||value.mode==="off")return;
    const original=result?.placements.find(b=>b.id===box.id)??box;
    if(value.mode==="wall"){update({boxes:[original],points:[]});return;}
    if(value.mode==="gap"){
      const previous=validBoxes.length===1?validBoxes:[];
      if(previous[0]?.id===original.id)return;
      update({boxes:[...previous,original],points:[]});return;
    }
    if(!point)return;
    const spec=value.basis==="surface"?regularSurfaceSpec(original,result?.cargoDetails?.[original.productId]??{}):null;
    if(value.basis==="surface"&&(!spec||value.section.axis!=="off"))return;
    const start=validPoints.length===1?validPoints:[],boxes=validPoints.length===1?validBoxes:[];
    update({points:[...start,spec?snapRegularSurface(original,spec,point,appearance.measureSnap):snapBoxPoint(box,point,appearance.measureSnap)],snaps:[...(start.length?value.snaps:[]),appearance.measureSnap],captures:[...(start.length?value.captures:[]),spec?original:box],boxes:[...boxes,original]});
  };
  const scope=useMemo(()=>result?deliveryPlanSignature(result):undefined,[result]);
  const savedOverlays=useMemo(()=>result?savedMeasureOverlays(saved.items,result,displayBoxes,value.section,visibleCount,scope):[],[saved.items,result,displayBoxes,value.section,visibleCount,scope]);
  const clear=()=>update({points:[],snaps:[],captures:[],boxes:[],locked:false});
  const saveMeasurement=(name:string)=>{if(!result||!measurement||value.mode==="off"||!saved.ready)return false;try{const ok=saved.add(captureMeasurement(result,value.mode,validBoxes,validPoints,value.snaps,value.wall,value.section,name,undefined,undefined,value.captures,value.mode==="points"&&value.basis==="surface"?validBoxes.map(b=>regularSurfaceSpec(b,result.cargoDetails?.[b.productId]??{})!):undefined));if(ok)clear();return ok;}catch{saved.reject();return false;}};
  return {value,measurement,displayBoxes,saved,savedOverlays,saveMeasurement,pickedCount:value.mode==="points"?validPoints.length:validBoxes.length,update,pick,setBasis:(basis:Inspection["basis"])=>update({basis,points:[],snaps:[],captures:[],boxes:[],locked:false}),setMode:(mode:MeasureMode)=>update({mode,points:[],snaps:[],captures:[],boxes:[],locked:false}),clear};
}
export type SceneInspection=ReturnType<typeof useSceneInspection>;
