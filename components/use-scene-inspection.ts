"use client";
import { useMemo, useState } from "react";
import { EMPTY_SECTION, inspectBoxes, measureBoxGap, measurePoints, measureWall, sectionBox, snapBoxPoint, type MeasureMode, type Point3, type Section, type WallSide } from "../lib/packing/inspection";
import type { PackingResult, PlacedBox } from "../lib/packing/types";
import { useTransportAppearance } from "./transport-appearance";
type Inspection={mode:MeasureMode;wall:WallSide;points:Point3[];boxes:PlacedBox[];locked:boolean;section:Section};
const empty=():Inspection=>({mode:"off",wall:"x-",points:[],boxes:[],locked:false,section:{...EMPTY_SECTION}});
export function useSceneInspection(result:PackingResult|null,visibleProducts:Set<string>,visibleCount:number){
  const appearance=useTransportAppearance();
  const [state,setState]=useState<{plan:PackingResult|null;value:Inspection}>(()=>({plan:result,value:empty()}));
  const value=useMemo(()=>state.plan===result?state.value:empty(),[state,result]);
  const update=(patch:Partial<Inspection>)=>setState(previous=>({plan:result,value:{...(previous.plan===result?previous.value:empty()),...patch}}));
  const displayBoxes=useMemo(()=>result?inspectBoxes(result,visibleProducts,visibleCount,value.section):[],[result,visibleProducts,visibleCount,value.section]);
  const validBoxes=value.boxes.filter(box=>box.supportOnly?!!result?.pallets?.some(p=>p.id===box.id)&&!!sectionBox(box,result!,value.section)&&(value.section.isolation!=="pallet"||value.section.target===box.id):displayBoxes.some(b=>b.id===box.id));
  const validPoints=validBoxes.length===value.boxes.length?value.points:[];
  const measurement=value.mode==="points"&&validPoints.length===2?measurePoints(validPoints[0],validPoints[1]):value.mode==="gap"&&validBoxes.length===2?measureBoxGap(validBoxes[0],validBoxes[1]):value.mode==="wall"&&validBoxes[0]&&result?measureWall(validBoxes[0],result,value.wall):null;
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
    const start=validPoints.length===1?validPoints:[],boxes=validPoints.length===1?validBoxes:[];
    update({points:[...start,snapBoxPoint(box,point,appearance.measureSnap)],boxes:[...boxes,original]});
  };
  return {value,measurement,displayBoxes,update,pick,setMode:(mode:MeasureMode)=>update({mode,points:[],boxes:[],locked:false}),clear:()=>update({points:[],boxes:[],locked:false})};
}
export type SceneInspection=ReturnType<typeof useSceneInspection>;
