"use client";
import {measureRegularSurfaceGap,regularSurfaceSpec,snapRegularSurface} from "../lib/packing/surface-inspection";
import { useMemo, useState } from "react";
import { EMPTY_SECTION, inspectBoxes, measureBoxGap, measurePoints, measureWall, sectionBox, snapBoxPoint, type BoundsBox, type MeasureMode, type Point3, type Section, type SnapMode, type WallSide } from "../lib/packing/inspection";
import type { PackingResult, PlacedBox } from "../lib/packing/types";
import { useTransportAppearance } from "./transport-appearance";
import {captureMeasurement,savedMeasureOverlays} from "../lib/packing/saved-measurements";
import {useSavedMeasurements} from "./use-saved-measurements";
import {deliveryPlanSignature} from "../lib/packing/delivery-identity";
import {inspectionPallets} from "../lib/packing/scene-view-scope";
type Inspection={basis:"envelope"|"surface";mode:MeasureMode;wall:WallSide;points:Point3[];snaps:SnapMode[];captures:BoundsBox[];boxes:PlacedBox[];locked:boolean;section:Section};
const empty=():Inspection=>({basis:"envelope",mode:"off",wall:"x-",points:[],snaps:[],captures:[],boxes:[],locked:false,section:{...EMPTY_SECTION}});
export function useSceneInspection(result:PackingResult|null,visibleProducts:Set<string>,visibleCount:number){
  const appearance=useTransportAppearance();
  const saved=useSavedMeasurements();
  const [state,setState]=useState<{plan:PackingResult|null;value:Inspection}>(()=>({plan:result,value:empty()}));
  const value=useMemo(()=>state.plan===result?state.value:empty(),[state,result]);
  const update=(patch:Partial<Inspection>)=>setState(previous=>({plan:result,value:{...(previous.plan===result?previous.value:empty()),...patch}}));
  const displayBoxes=useMemo(()=>result?inspectBoxes(result,visibleProducts,visibleCount,value.section):[],[result,visibleProducts,visibleCount,value.section]);
  const displayPallets=useMemo(()=>result?inspectionPallets(result,visibleCount,value.section,displayBoxes):[],[result,visibleCount,value.section,displayBoxes]);
  const validBoxes=value.boxes.filter(box=>box.supportOnly?displayPallets.some(p=>p.id===box.id)&&!!sectionBox(box,result!,value.section):displayBoxes.some(b=>b.id===box.id));
  const validPoints=validBoxes.length===value.boxes.length?value.points:[];
  const specs=value.basis==="surface"?validBoxes.map(box=>regularSurfaceSpec(box,result?.cargoDetails?.[box.productId]??{})):[];
  const supportsSolid=value.section.axis==="off"&&specs.length===2&&specs.every(Boolean);
  const measurement=value.mode==="points"&&validPoints.length===2&&(value.basis==="envelope"||supportsSolid)
    ?{...measurePoints(validPoints[0],validPoints[1]),basis:value.basis}
    :value.mode==="gap"&&validBoxes.length===2
      ?value.basis==="envelope"?measureBoxGap(validBoxes[0],validBoxes[1])
        :supportsSolid?{...measureRegularSurfaceGap(validBoxes[0],specs[0]!,validBoxes[1],specs[1]!),basis:"surface" as const}:null
      :value.mode==="wall"&&validBoxes[0]&&result?measureWall(validBoxes[0],result,value.wall):null;
  const pick=(box:PlacedBox,point?:Point3)=>{
    if(value.locked||value.mode==="off")return;
    const original=result?.placements.find(b=>b.id===box.id)??box;
    if(value.mode==="wall"){update({boxes:[original],points:[]});return;}
    if(value.mode==="gap"){
      if(value.basis==="surface"&&(value.section.axis!=="off"||!regularSurfaceSpec(original,result?.cargoDetails?.[original.productId]??{})))return;
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
  const saveMeasurement=(name:string)=>{if(!result||!measurement||value.mode==="off"||!saved.ready)return false;try{const ok=saved.add(captureMeasurement(result,value.mode,validBoxes,validPoints,value.snaps,value.wall,value.section,name,undefined,undefined,value.captures,value.mode!=="wall"&&supportsSolid?specs.map(spec=>spec!):undefined));if(ok)clear();return ok;}catch{saved.reject();return false;}};
  return {value,measurement,displayBoxes,displayPallets,saved,savedOverlays,saveMeasurement,pickedCount:value.mode==="points"?validPoints.length:validBoxes.length,update,pick,setBasis:(basis:Inspection["basis"])=>update({basis,points:[],snaps:[],captures:[],boxes:[],locked:false}),setMode:(mode:MeasureMode)=>update({mode,points:[],snaps:[],captures:[],boxes:[],locked:false}),clear};
}
export type SceneInspection=ReturnType<typeof useSceneInspection>;
