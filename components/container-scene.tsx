"use client";
import {siteExclusionBoxes} from "../lib/packing/site-exclusions";

import { visiblePlanPallets } from "../lib/packing/prebuilt-pallets";
import { cargoShapeOf } from "../lib/packing/cargo-shape";
import { cargoShapeGeometry } from "../lib/packing/cargo-shape-geometry";
import { Canvas, useThree } from "@react-three/fiber";
import { Box, DoorOpen, Eye, ScanLine, ImageDown, RotateCcw, Tag } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import * as THREE from "three";
import { boxFaceTexture, CargoSurfaceLabels, MetricLabel, PalletStructures, SelectionOutline } from "./scene-details";
import { SceneDimensions } from "./scene-dimensions";
import { DimensionControls } from "./dimension-controls";
import { LoadingSceneFallback } from "./loading-scene-fallback";
import { sceneMeasurement } from "../lib/packing/scene-dimensions";
import { palletParts, palletAnchors } from "../lib/packing/floor-pallets";
import { SceneFullscreen } from "./scene-fullscreen";
import {tr, useLanguage} from "./language";
import {
  type CameraProjection,
  type CameraPresetView,
  type CameraView,
  type SceneSize,
} from "../lib/packing/camera-fit";
import { SceneCameraController } from "../lib/packing/scene-camera";
import { SceneCameraRig } from "./scene-camera-rig";
import { TransportModel } from "./transport-model";
import { TransportModelControls, useTransportAppearance } from "./transport-appearance";
import { transportSceneBounds, type TransportDisplayMode } from "../lib/packing/transport-model";
import { detectRuntimePolicy } from "../lib/packing/runtime-policy";
import { supportsWebGL } from "../lib/packing/webgl-support";
import { analyzeEmptySpaces } from "../lib/packing/free-space";
import { analyzeLoads, type HeatMode } from "../lib/packing/load-analysis";
import { SceneSpacePanel } from "./scene-space-panel";
import { SceneLoadPanel } from "./scene-load-panel";
import { SceneAccessPanel } from "./scene-access-panel";
import { SceneEditPanel } from "./scene-edit-panel";
import { SceneEditHandles } from "./scene-edit-handles";
import { SceneAnalysisOverlay, type AnalysisRegion } from "./scene-analysis-overlay";
import type { PlanEditor } from "./use-plan-editor";
import type { PackingResult, ProductInput, PlacedBox, OrientationCode } from "../lib/packing/types";
import { EMPTY_SECTION, inspectBoxes, sectionBox, type Measurement, type Point3, type Section } from "../lib/packing/inspection";
import { useSceneInspection } from "./use-scene-inspection";
import { SceneInspector } from "./scene-inspector";
import { SceneWorkbench } from "./scene-workbench";
import { SceneMeasurement } from "./scene-measurement";
import { SectionGeometry } from "./section-geometry";

type Props = {
  editor?:PlanEditor;
  products?:ProductInput[];
  onAdopt?:(plan:PackingResult)=>void;
  presentation?: boolean;
  result: PackingResult | null;
  visibleProducts: Set<string>;
  visibleCount: number;
  onVisibleCountChange?: (count: number) => void;
  cameraView: CameraView;
  projectionMode: CameraProjection;
  onCameraViewChange: (view: CameraView) => void;
  onProjectionModeChange: (projection: CameraProjection) => void;
};

type InstanceGroup = {
  productId: string;
  sku: string;
  orientation: string;
  orientationSigns?: PlacedBox["orientationSigns"];
  cargoType?: ProductInput["cargoType"];
  cargoShape?: ProductInput["cargoShape"];
  solidModel?:ProductInput["solidModel"];
  shapeAxis?: ProductInput["shapeAxis"];
  shapeTopRatio?: number;
  shapeWallRatio?: number;
  shapeWallHeightRatio?: number;
  shapeStepLengthRatio?: number;
  shapeStepHeightRatio?: number;
  baseHeight?: number;
  color: string;
  boxes: PlacedBox[];
  sources: PlacedBox[];
};

const subscribeToClientReady = () => () => undefined;
const getClientReady = () => true;
const getServerNotReady = () => false;

function InstancedBoxes({ group, scale, offset, reducedRendering, labels, onSelect,collisionProxy=false }: { collisionProxy?:boolean;group: InstanceGroup; scale: number; offset: THREE.Vector3; reducedRendering: boolean; labels:boolean; onSelect:(box:PlacedBox,point?:Point3,add?:boolean)=>void }) {
  useLanguage();
  const meshRef = useRef<THREE.InstancedMesh>(null), baseRef = useRef<THREE.InstancedMesh>(null),labelRef=useRef<THREE.InstancedMesh>(null);
  const transform = useMemo(() => new THREE.Object3D(), []);
  const first=group.boxes[0],originalFirst=group.sources[0], shape=cargoShapeOf(group);
  const geometry=useMemo(()=>cargoShapeGeometry({cargoType:group.cargoType,cargoShape:group.cargoShape,shapeAxis:group.shapeAxis,shapeTopRatio:group.shapeTopRatio,shapeWallRatio:group.shapeWallRatio,shapeWallHeightRatio:group.shapeWallHeightRatio,shapeStepLengthRatio:group.shapeStepLengthRatio,shapeStepHeightRatio:group.shapeStepHeightRatio,solidModel:group.solidModel},group.orientation as OrientationCode,reducedRendering,group.orientationSigns,collisionProxy),[collisionProxy,group.solidModel,group.cargoType,group.cargoShape,group.shapeAxis,group.shapeTopRatio,group.shapeWallRatio,group.shapeWallHeightRatio,group.shapeStepLengthRatio,group.shapeStepHeightRatio,group.orientation,group.orientationSigns,reducedRendering]);
  useEffect(()=>()=>geometry.dispose(),[geometry]);
  const labelDimensions=useMemo<[number,number,number]>(()=>{const dims:[number,number,number]=[originalFirst.dx,originalFirst.dz,originalFirst.dy],a=originalFirst.orientation.indexOf("H");if(group.cargoType==="pallet")dims[a===0?0:a===1?2:1]-=group.baseHeight??0;return dims;},[originalFirst.dx,originalFirst.dy,originalFirst.dz,originalFirst.orientation,group.baseHeight,group.cargoType]);
  const materials = useMemo(() => {
    const dims=[first.dx,first.dz,first.dy], axis=first.orientation.indexOf("H");
    if(group.cargoType==="pallet")dims[axis===0?0:axis===1?2:1]=Math.max(1,dims[axis===0?0:axis===1?2:1]-(group.baseHeight??0));
    const textures=labels&&shape==="box"&&!group.solidModel?[boxFaceTexture(group.sku,group.color,dims[2],dims[1],group.orientation[2]),boxFaceTexture(group.sku,group.color,dims[0],dims[2]),boxFaceTexture(group.sku,group.color,dims[0],dims[1],group.orientation[2])]:[];
    const maps=[textures[0],textures[0],textures[1],textures[1],textures[2],textures[2]];
    return maps.map(map=>new THREE.MeshStandardMaterial({map:map??null,color:map?"white":group.color,roughness:.82,wireframe:collisionProxy||shape==="irregular",transparent:collisionProxy||shape==="irregular",opacity:collisionProxy?.75:shape==="irregular"?.6:1}));
  },[first.dx,first.dy,first.dz,first.orientation,group.baseHeight,group.cargoType,group.sku,group.color,group.orientation,group.solidModel,labels,shape,collisionProxy]);
  useEffect(()=>()=>{new Set(materials.map(m=>m.map)).forEach(t=>t?.dispose());materials.forEach(m=>m.dispose());},[materials]);
  const parts=useMemo(()=>group.cargoType!=="pallet"||!group.baseHeight?[]:group.sources.flatMap(box=>{
    const world=[box.dx,box.dy,box.dz];
    const l=world[box.orientation.indexOf("L")],w=world[box.orientation.indexOf("W")];
    return palletParts(l,w,group.baseHeight!).map(p=>{
      const positions={L:p.x,W:p.y,H:p.z},dimensions={L:p.dx,W:p.dy,H:p.dz};
      const letters=box.orientation.split("") as Array<"L"|"W"|"H">;
      return {x:box.x+positions[letters[0]],y:box.y+positions[letters[1]],z:box.z+positions[letters[2]],dx:dimensions[letters[0]],dy:dimensions[letters[1]],dz:dimensions[letters[2]],kind:p.kind};
    });
  }),[group.sources,group.baseHeight,group.cargoType]);
  useLayoutEffect(() => {
    if (!meshRef.current) return;
    group.boxes.forEach((clipped,index)=>{
      const box=shape==="box"&&!group.solidModel?clipped:group.sources[index];
      const dims=[box.dx,box.dz,box.dy], pos=[(box.x+box.dx/2)*scale+offset.x,(box.z+box.dz/2)*scale+offset.y,(box.y+box.dy/2)*scale+offset.z];
      const originalAxis=box.orientation.indexOf("H"), axis=originalAxis===0?0:originalAxis===1?2:1;
      const source=group.sources[index],sourcePosition=[source.x,source.z,source.y],displayPosition=[box.x,box.z,box.y];
      const base=group.cargoType==="pallet"?Math.max(0,Math.min(dims[axis],sourcePosition[axis]+(group.baseHeight??0)-displayPosition[axis])):0;
      dims[axis]-=base;pos[axis]+=base*scale/2;
      transform.position.set(...pos as [number,number,number]); transform.scale.set(...dims.map(d=>d*scale) as [number,number,number]);transform.updateMatrix();meshRef.current?.setMatrixAt(index,transform.matrix);labelRef.current?.setMatrixAt(index,transform.matrix);
    });
    meshRef.current.instanceMatrix.needsUpdate=true;meshRef.current.computeBoundingSphere();if(labelRef.current){labelRef.current.instanceMatrix.needsUpdate=true;labelRef.current.computeBoundingSphere();}
    if(baseRef.current){parts.forEach((p,i)=>{transform.position.set((p.x+p.dx/2)*scale+offset.x,(p.z+p.dz/2)*scale+offset.y,(p.y+p.dy/2)*scale+offset.z);transform.scale.set(p.dx*scale*.997,p.dz*scale*.995,p.dy*scale*.997);transform.updateMatrix();baseRef.current!.setMatrixAt(i,transform.matrix);baseRef.current!.setColorAt(i,new THREE.Color(p.kind==="block"?"#ac8151":"#d4af7b"));});baseRef.current.instanceMatrix.needsUpdate=true;if(baseRef.current.instanceColor)baseRef.current.instanceColor.needsUpdate=true;baseRef.current.computeBoundingSphere();}
  },[group.solidModel,group.boxes,group.sources,group.baseHeight,group.cargoType,parts,materials,offset,scale,transform,shape,labels]);
  return <><instancedMesh ref={meshRef} args={[geometry,materials,group.boxes.length]} castShadow={!reducedRendering} receiveShadow={!reducedRendering} onClick={e=>{if(e.delta>3)return;e.stopPropagation();if(e.instanceId!==undefined)onSelect(group.boxes[e.instanceId],e.point?[(e.point.x-offset.x)/scale,(e.point.z-offset.z)/scale,(e.point.y-offset.y)/scale]:undefined,e.shiftKey);}}></instancedMesh>{labels&&(group.solidModel||shape!=="box")&&<CargoSurfaceLabels sku={group.sku} source={geometry} dimensions={labelDimensions} count={group.boxes.length} instanceRef={labelRef}/>} {parts.length>0&&<instancedMesh ref={baseRef} args={[undefined,undefined,parts.length]}><boxGeometry/><meshStandardMaterial roughness={.92}/></instancedMesh>}</>;
}

function SceneCapture({ register }: { register: (capture: () => Promise<Blob>) => void }) {
  useLanguage();
  const { gl,scene,camera } = useThree();
  useEffect(()=>{register(()=>new Promise((resolve,reject)=>{gl.render(scene,camera);gl.domElement.toBlob(blob=>blob?resolve(blob):reject(new Error("Image export failed")),"image/png");}));},[gl,scene,camera,register]);
  return null;
}

function normalizedSceneSize(result: PackingResult): SceneSize {
  const effectiveLength = Math.max(1, result.container.length - result.clearance * 2);
  const effectiveWidth = Math.max(1, result.container.width - result.clearance * 2);
  const effectiveHeight = Math.max(1, result.container.height - result.clearance + (result.container.baseHeight ?? 0));
  const scale = 5.6 / Math.max(effectiveLength, effectiveWidth, effectiveHeight);
  return [effectiveLength * scale, effectiveHeight * scale, effectiveWidth * scale];
}

export function ContainerModel({ result, visibleProducts, visibleCount, reducedRendering, presentation, modelMode, transparency, labels, selected, onSelect, section=EMPTY_SECTION, manualMeasurement,editor,regions=[],heatColors,onDragging }: { result: PackingResult; visibleProducts: Set<string>; visibleCount: number; reducedRendering: boolean; presentation?: boolean; modelMode:TransportDisplayMode; transparency:number; labels:boolean; selected:PlacedBox|null;onSelect:(b:PlacedBox,point?:Point3,add?:boolean)=>void;section?:Section;manualMeasurement?:Measurement|null;editor?:PlanEditor;regions?:AnalysisRegion[];heatColors?:Map<string,string>;onDragging?:(v:boolean)=>void }) {
  useLanguage();
  const appearance=useTransportAppearance();
  const measurement=useMemo(()=>sceneMeasurement(result.container,result.clearance,selected??undefined),[result.container,result.clearance,selected]);
  const effective = {
    length: result.container.length - result.clearance * 2,
    width: result.container.width - result.clearance * 2,
    height: result.container.height - result.clearance,
  };
  const baseHeight = result.container.baseHeight ?? 0;
  const maxDimension = Math.max(effective.length, effective.width, effective.height + baseHeight);
  const scale = 5.6 / maxDimension;
  const offset = useMemo(
    () => new THREE.Vector3(-effective.length * scale * 0.5, baseHeight * scale, -effective.width * scale * 0.5),
    [baseHeight, effective.length, effective.width, scale],
  );
  const groups = useMemo(() => {
    const map = new Map<string, InstanceGroup>();
    const sources=new Map(result.placements.map(b=>[b.id,b]));
    for (const box of inspectBoxes(result,visibleProducts,visibleCount,section)) {
      const color=heatColors?.get(box.id)??box.color;
      const source=sources.get(box.id)!;
      const key = `${source.dx}:${source.dy}:${source.dz}:${box.productId}:${box.orientation}:${box.orientationSigns?.join("/")??""}:${box.dx}:${box.dy}:${box.dz}:${color}`;
      const meta = result.cargoDetails?.[box.productId];
      const current = map.get(key) ?? { productId: key, sku: box.sku, orientation: box.orientation, orientationSigns:box.orientationSigns, cargoType: meta?.cargoType,cargoShape:meta?.cargoShape,shapeAxis:meta?.shapeAxis,shapeTopRatio:meta?.shapeTopRatio,shapeWallRatio:meta?.shapeWallRatio,shapeWallHeightRatio:meta?.shapeWallHeightRatio,shapeStepLengthRatio:meta?.shapeStepLengthRatio,shapeStepHeightRatio:meta?.shapeStepHeightRatio,solidModel:meta?.solidModel, baseHeight: meta?.palletBaseHeight, color, boxes: [],sources:[] };
      current.boxes.push(box);
      current.sources.push(sources.get(box.id)!);
      map.set(key, current);
    }
    return [...map.values()];
  }, [result, visibleCount, visibleProducts,section,heatColors]);
  const annotations = useMemo(() => {
    const map = new Map<string, { sku:string; minX:number; maxX:number; maxY:number; minZ:number; maxZ:number }>();
    for (const group of groups) for (const b of group.boxes) {
      const current = map.get(b.productId) ?? {sku:b.sku,minX:Infinity,maxX:-Infinity,maxY:0,minZ:Infinity,maxZ:-Infinity};
      current.minX=Math.min(current.minX,b.x);current.maxX=Math.max(current.maxX,b.x+b.dx);current.maxY=Math.max(current.maxY,b.z+b.dz);current.minZ=Math.min(current.minZ,b.y);current.maxZ=Math.max(current.maxZ,b.y+b.dy);map.set(b.productId,current);
    }
    return [...map.entries()];
  }, [groups]);
  const size: [number, number, number] = [effective.length * scale, effective.height * scale, effective.width * scale];

  return (
    <group>
      <SectionGeometry result={result} section={section} scale={scale} offset={offset}>
      {result.workflow !== "pallet-only" && <group position={[0,baseHeight*scale,0]}><TransportModel space={result.container} scale={scale} mode={modelMode} transparency={transparency}/></group>}
      {baseHeight > 0 && (result.container.category !== "pallet" || modelMode === "wireframe") && <PalletStructures pallets={[{id:"space-base",presetId:result.container.id,name:result.container.name,x:0,y:0,z:-baseHeight,dx:effective.length,dy:effective.width,dz:baseHeight,weight:0,maxLoad:result.container.maxWeight,orientation:"LWH"}]} scale={scale} offset={offset}/>}
      <SceneAnalysisOverlay regions={siteExclusionBoxes(result.container,result.clearance).flatMap(b=>{const clipped=sectionBox(b,result,section);return clipped?[clipped]:[];})} scale={scale} offset={offset}/>
      <PalletStructures pallets={visiblePlanPallets(result,visibleCount).filter(p=>section.isolation!=="pallet"||section.target===p.id)} scale={scale} offset={offset} onSelect={p=>onSelect(palletAnchors([p])[0])}/>
      {groups.map((group) => (
        <InstancedBoxes key={group.productId} group={group} collisionProxy={appearance.collisionProxy} scale={scale} offset={offset} reducedRendering={reducedRendering} labels={labels} onSelect={onSelect} />
      ))}
      {editor?.enabled&&editor.selected.filter(b=>b.id!==selected?.id).map(b=><SelectionOutline key={b.id} box={b} scale={scale} offset={offset}/>)}
      {selected && sectionBox(selected,result,section) && <SelectionOutline box={sectionBox(selected,result,section)!} scale={scale} offset={offset}/>}
      </SectionGeometry>
      {siteExclusionBoxes(result.container,result.clearance).flatMap(b=>{const clipped=sectionBox(b,result,section);return clipped?[<MetricLabel key={b.id} text={`${tr("禁占区","Site exclusion")} · ${b.name}`} size={.11} position={[(clipped.x+clipped.dx/2)*scale+offset.x,(clipped.z+clipped.dz)*scale+offset.y+.08,(clipped.y+clipped.dy/2)*scale+offset.z]}/>]:[];})}
      {appearance.skuSummaries && annotations.map(([id,a])=><MetricLabel key={id} text={a.sku} size={.12} position={[(a.minX+a.maxX)/2*scale+offset.x,a.maxY*scale+offset.y+.15,(a.minZ+a.maxZ)/2*scale+offset.z]}/>)}
      {appearance.dimensions&&<SceneDimensions bounds={measurement.bounds} values={measurement.values} unit={appearance.dimensionUnit} fontSize={appearance.dimensionFontSize} style={appearance.dimensionStyle} lineColor={appearance.dimensionLineColor} textColor={appearance.dimensionTextColor}/>}
      {appearance.dimensions&&manualMeasurement&&<SceneMeasurement measurement={manualMeasurement} scale={scale} offset={offset}/>}
      <SceneAnalysisOverlay regions={regions} scale={scale} offset={offset}/>
      {editor?.enabled&&!editor.disabled&&onDragging&&<SceneEditHandles editor={editor} boxes={inspectBoxes(result,visibleProducts,visibleCount,section)} scale={scale} offset={offset} onDragging={onDragging}/>}
      {!presentation && modelMode === "wireframe" && <gridHelper args={[Math.max(size[0], size[2]) * 1.25, 16, "#91a6ab", "#d9e1e3"]} position={[0, -0.02, 0]} />}
    </group>
  );
}

const CAMERA_VIEWS: Array<{ id: CameraPresetView; label: string; icon: React.ReactNode }> = [
  { id: "perspective", label: "等轴测", icon: <Box size={13} /> },
  { id: "top", label: "俯视", icon: <ScanLine size={13} /> },
  { id: "side", label: "侧视", icon: <Eye size={13} /> },
  { id: "door", label: "箱门", icon: <DoorOpen size={13} /> },
  { id: "bottom", label: "底视", icon: <ScanLine size={13}/> },
  { id: "rear", label: "后视", icon: <DoorOpen size={13}/> },
  { id: "left", label: "左视", icon: <Eye size={13}/> },
];

export function ContainerScene({
  result:source,
  editor,products=[],onAdopt,
  presentation = false,
  visibleProducts,
  visibleCount,
  onVisibleCountChange,
  cameraView,
  projectionMode,
  onCameraViewChange,
  onProjectionModeChange,
}: Props) {
  useLanguage();
  const result=editor?.plan&&(editor.enabled||editor.changed)?editor.plan:source;
  const [tool,setTool]=useState("inspect"),[spaceOpen,setSpaceOpen]=useState(true),[gapId,setGapId]=useState(""),[heat,setHeat]=useState<HeatMode>("off"),[highlight,setHighlight]=useState<string[]>([]),[dragging,setDragging]=useState(false);
  const spaces=useMemo(()=>result&&tool==="space"&&spaceOpen?analyzeEmptySpaces(result):null,[result,tool,spaceOpen]);
  const loads=useMemo(()=>result&&products.length&&(heat!=="off"||tool==="load")?analyzeLoads(result,products):null,[result,products,heat,tool]);
  const heatColors=useMemo(()=>{const map=new Map<string,string>();if(loads&&result){const cartons=new Map(loads.boxes.map(c=>[c.id,c.color])),pallets=new Map(loads.pallets.map(p=>[p.id,p.color])),crates=new Map(loads.crates.map(p=>[p.id,p.color]));for(const b of result.placements){const color=heat==="top"?cartons.get(b.id):heat==="pallet"?b.palletIds?.map(id=>pallets.get(id)).find(Boolean):heat==="crate"?b.palletIds?.map(id=>crates.get(id)).find(Boolean):heat==="zone"?loads.zones.find(z=>b.x+b.dx/2>=z.x&&b.x+b.dx/2<=z.x+z.dx)?.color:undefined;if(color)map.set(b.id,color);}}return map;},[loads,result,heat]);
  const regions=useMemo<AnalysisRegion[]>(()=>{if(!result)return [];const gap=spaces?.spaces.find(s=>s.id===gapId);return [...(gap?[{...gap,color:"#177bbc"}]:[]),...(heat==="pallet"?(result.pallets??[]).map(p=>({...p,color:loads?.pallets.find(c=>c.id===p.id)?.color??"#7d8393"})):[]),...(heat==="zone"?(loads?.zones??[]).map(z=>({id:z.id,x:z.x,y:0,z:0,dx:z.dx,dy:result.container.width-2*result.clearance,dz:12,color:z.color})):[]),...[...siteExclusionBoxes(result.container,result.clearance),...result.placements,...palletAnchors(result.pallets??[])].filter(b=>highlight.includes(b.id)).map(b=>({...b,color:"#c23832"}))];},[result,spaces,gapId,heat,loads,highlight]);
  const appearance = useTransportAppearance();
  const cameraController = useMemo(() => new SceneCameraController(), []);
  const captureRef=useRef<(() => Promise<Blob>) | null>(null);
  const registerCapture=useMemo(()=> (capture: () => Promise<Blob>) => { captureRef.current=capture; },[]);
  const {labels,setLabels}=appearance;
  const inspection=useSceneInspection(result,visibleProducts,visibleCount);
  const [selection,setSelection]=useState<{planId:string;box:PlacedBox}|null>(null),[focusId,setFocusId]=useState<string|null>(null);
  const currentSelection=editor?.enabled&&editor.selected[0]?editor.selected[0]:selection&&selection.planId===result?.id?(selection.box.supportOnly?palletAnchors(result?.pallets??[]).find(p=>p.id===selection.box.id):result?.placements.find(b=>b.id===selection.box.id)):null;
  const selected=currentSelection&&(currentSelection.supportOnly?!!result&&!!sectionBox(currentSelection,result,inspection.value.section)&&(inspection.value.section.isolation!=="pallet"||inspection.value.section.target===currentSelection.id):inspection.displayBoxes.some(b=>b.id===currentSelection.id))?currentSelection:null;
  const selectBox=(box:PlacedBox,point?:Point3,add=false)=>{if(!result)return;if(editor?.enabled){if(!box.supportOnly&&!editor.rectangle)editor.select(box.id,add);return;}setSelection({planId:result.id,box});inspection.pick(box,point);};
  const focus=useMemo(()=>{if(!selected||!result||focusId!==selected.id||projectionMode!=="perspective"||(cameraView!=="perspective"&&cameraView!=="free"))return undefined;const l=result.container.length-result.clearance*2,w=result.container.width-result.clearance*2,h=result.container.height-result.clearance,base=result.container.baseHeight??0,scale=5.6/Math.max(l,w,h+base);return {size:[selected.dx*scale,selected.dz*scale,selected.dy*scale] as SceneSize,origin:[(selected.x+selected.dx/2-l/2)*scale,(selected.z+base)*scale,(selected.y+selected.dy/2-w/2)*scale] as SceneSize};},[selected,result,focusId,projectionMode,cameraView]);
  const [captureError,setCaptureError] = useState("");
  const saveImage=async()=>{ try { const blob=await captureRef.current?.();if(!blob)throw new Error(tr("图形尚未准备完成。", "Scene is not ready."));const url=URL.createObjectURL(blob);const link=document.createElement("a");link.href=url;link.download="CargoFit_3D.png";link.click();setTimeout(()=>URL.revokeObjectURL(url),10000);setCaptureError(""); } catch(e) {setCaptureError(e instanceof Error?e.message:"Image export failed");}};
  const clientReady = useSyncExternalStore(subscribeToClientReady, getClientReady, getServerNotReady);
  const webglSupported = clientReady ? supportsWebGL() : null;
  const reducedRendering = clientReady ? detectRuntimePolicy().reducedRendering : false;
  const containerSize = useMemo<SceneSize>(() => (result ? normalizedSceneSize(result) : [5.6, 1.25, 1.1]), [result]);
  const sceneBounds = useMemo(() => result ? transportSceneBounds(result.container,5.6/Math.max(result.container.length-result.clearance*2,result.container.width-result.clearance*2,result.container.height-result.clearance+(result.container.baseHeight??0)),appearance.mode) : undefined,[result,appearance.mode]);
  return (
    <SceneFullscreen toolbar={<div className="scene-header-controls"><div className="scene-quick-controls"><div className="scene-camera-controls">
            <div className="scene-projection-controls" role="toolbar" aria-label={tr("三维投影方式")}>
              <button type="button" disabled={webglSupported===false} className={projectionMode === "perspective" ? "active" : ""} aria-pressed={projectionMode === "perspective"} onClick={() => { setFocusId(null); onProjectionModeChange("perspective"); }}>{tr("透视投影")}</button>
              <button type="button" disabled={webglSupported===false} className={projectionMode === "orthographic" ? "active" : ""} aria-pressed={projectionMode === "orthographic"} onClick={() => { setFocusId(null); onProjectionModeChange("orthographic"); }}>{tr("正交投影")}</button>
            </div>
            <div className="scene-view-controls" role="toolbar" aria-label={tr("三维相机视角")}>
              {CAMERA_VIEWS.map((view) => (
                <button
                  type="button"
                  key={view.id}
                  disabled={webglSupported===false}
                  className={cameraView === view.id ? "active" : ""}
                  aria-pressed={cameraView === view.id}
                  onClick={() => { setFocusId(null); onCameraViewChange(view.id); }}
                >
                  {view.icon}
                  {tr(view.label)}
                </button>
              ))}
            </div>
          </div></div><div className="scene-tools" aria-label={tr("三维工具", "3D tools")}><button type="button" disabled={!result} aria-pressed={labels} title={tr("箱标贴附在货物表面，随货物旋转和缩放。","Labels are attached to cargo surfaces and follow their orientation and scale.")} onClick={()=>setLabels(!labels)}><Tag size={14}/>{tr("箱标","Labels")}</button><button type="button" disabled={!result} aria-pressed={appearance.skuSummaries} onClick={()=>appearance.setSkuSummaries(!appearance.skuSummaries)} title={tr("在货物上方显示每个 SKU 的汇总标签。","Show one summary label above each SKU.")}><Tag size={14}/>{tr("SKU 汇总","SKU summaries")}</button><button type="button" disabled={!result||!Object.values(result.cargoDetails??{}).some(p=>p.solidModel)} aria-pressed={appearance.collisionProxy} onClick={()=>appearance.updatePreferences({collisionProxy:!appearance.collisionProxy})}>{tr("碰撞体","Collision bodies")}</button><DimensionControls/><button type="button" onClick={()=>{setSelection(null);setFocusId(null);onCameraViewChange("perspective");onProjectionModeChange("perspective");}}><RotateCcw size={14}/>{tr("重置视图")}</button><button type="button" disabled={!webglSupported} onClick={()=>void saveImage()}><ImageDown size={14}/>{tr("保存图片")}</button></div>

{webglSupported!==false&&<TransportModelControls/>}</div>} fullscreenFooter={result&&onVisibleCountChange&&<footer className="scene-progress"><span>{tr("装载进度")}</span><input type="range" min={0} max={result.placements.length} value={visibleCount} aria-label={tr("三维装载进度", "3D loading progress")} onChange={e=>onVisibleCountChange(Number(e.target.value))}/><output>{visibleCount} / {result.placements.length} {tr("箱")}</output></footer>}>
{editor?.changed&&<p className="scene-draft-notice" role="status">{tr("正在预览编辑草稿；采用后更新指标与导出。","Previewing edit draft. Apply to update totals and exports.")}</p>}
<SceneWorkbench editor={editor} result={result} boxes={inspection.displayBoxes} selected={selected} onSelect={selectBox} inspector={result&&<><nav className="scene-inspector-tabs" aria-label={tr("三维工作台工具","Scene workbench tools")}>{[["inspect","属性与测量","Inspect & measure"],["edit","编辑","Edit"],["space","空隙","Gaps"],["load","承重","Loads"],["access","装卸","Access"]].map(([id,zh,en])=><button title={tr(zh,en)} key={id} disabled={id!=="inspect"&&(!products.length||result.metrics.loadedCount!==result.placements.length)||id==="edit"&&!editor||id==="space"&&result.workflow==="pallet-only"} aria-pressed={tool===id} onClick={()=>{setTool(id);if(id!=="edit"&&editor?.enabled)editor.update({enabled:false,rectangle:false});}}>{id==="inspect"?tr("属性","Info"):tr(zh,en)}</button>)}</nav>{tool==="edit"&&editor&&<SceneEditPanel editor={editor}/>} {tool==="space"&&<SceneSpacePanel plan={result} products={products} report={spaces} selected={gapId} onSelect={setGapId} onOpen={setSpaceOpen}/>} {tool==="load"&&<SceneLoadPanel report={loads} mode={heat} onMode={setHeat} selected={selected}/>} {tool==="access"&&<SceneAccessPanel key={result.id} plan={result} products={products} onAdopt={onAdopt} onHighlight={setHighlight} disabled={!!editor?.disabled||!!editor?.changed}/>} {tool==="inspect"&&<SceneInspector result={result} selected={selected} inspection={inspection} onClearSelection={()=>{setSelection(null);setFocusId(null);}} onFocus={webglSupported!==false&&selected?()=>{setFocusId(selected.id);onCameraViewChange("perspective");onProjectionModeChange("perspective");}:undefined}/>}</>}><div className="scene-shell" role="region" aria-label={tr("可交互三维装柜视图")}>
      {!result ? (
        <div className="scene-empty">
          <div className="scene-empty-cube" aria-hidden="true" />
          <strong>{tr("等待计算方案")}</strong>
          <span>{tr("填写左侧参数后，柜内真实摆放会显示在这里")}</span>
        </div>
      ) : webglSupported === null ? (
        <div className="scene-loading">{tr("正在检测三维图形能力…")}</div>
      ) : !webglSupported ? (
        <LoadingSceneFallback editor={editor?.enabled?editor:undefined} regions={regions} heatColors={heatColors} result={result} visibleProducts={visibleProducts} visibleCount={visibleCount} selected={selected} onSelect={selectBox} section={inspection.value.section} manualMeasurement={inspection.measurement}/>
      ) : (
        <>
          <div className="scene-canvas">
            <Canvas
              onCreated={({gl})=>{gl.localClippingEnabled=true;}}
              shadows={!reducedRendering}
              dpr={reducedRendering ? [1, 1.1] : [1, 1.6]}
              gl={{ antialias: !reducedRendering, alpha: true, powerPreference: reducedRendering ? "low-power" : "high-performance" }}
            >
              <color attach="background" args={["#eef4f5"]} />
              <ambientLight intensity={.8} />
              <hemisphereLight args={["#ffffff", "#61747a", .8]} />
              <directionalLight castShadow={!reducedRendering} position={[5, 9, 4]} intensity={2.1} shadow-mapSize-width={reducedRendering ? 256 : 1024} shadow-mapSize-height={reducedRendering ? 256 : 1024} />
              <ContainerModel editor={editor} onDragging={setDragging} regions={regions} heatColors={heatColors} result={result} visibleProducts={visibleProducts} visibleCount={visibleCount} reducedRendering={reducedRendering} presentation={presentation} modelMode={appearance.mode} transparency={appearance.transparency} labels={labels} selected={selected} onSelect={selectBox} section={inspection.value.section} manualMeasurement={inspection.measurement}/>
              <SceneCapture register={registerCapture}/>
              <SceneCameraRig
                enabled={!dragging&&!editor?.rectangle}
                controller={cameraController}
                containerSize={containerSize}
                sceneBounds={sceneBounds}
                view={cameraView}
                projection={projectionMode}
                focus={focus}
                onInteraction={() => onCameraViewChange("free")}
              />
            </Canvas>
          </div>

          {captureError && <p role="alert" className="scene-export-error">{captureError}</p>}
          {!presentation && <div className="scene-hint">
            <span>{tr("拖动旋转")}</span>
            <span>{tr("滚轮缩放")}</span>
            <span>{tr("右键平移")}</span>
          </div>}
          <div className="door-marker">{tr("箱门方向")}</div>
        </>
      )}
    </div></SceneWorkbench></SceneFullscreen>
  );
}
