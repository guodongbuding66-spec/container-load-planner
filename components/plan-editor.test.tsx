import { act, useState } from "react";
import { createRoot, extend, _roots } from "@react-three/fiber";
import * as THREE from "three";
import { afterEach, expect, it, vi } from "vitest";
import { usePlanEditor, type PlanEditor } from "./use-plan-editor";
import { SceneEditHandles } from "./scene-edit-handles";
import { pack, restorePackingSnapshot } from "../lib/packing/engine";
import type { PackingResult, ProductInput } from "../lib/packing/types";
afterEach(()=>vi.unstubAllGlobals());
it("shares validated drafts, undo/redo, selection and adoption, and drops drafts from obsolete plans",async()=>{
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);extend({Group:THREE.Group});
  const products:ProductInput[]=[{id:"p",sku:"P",name:"P",length:500,width:400,height:200,weight:10,quantity:2,priority:50,rotationPolicy:"upright",stackable:true,maxStackLayers:0,color:"#448877"}],request={products,mode:"mixed" as const,strategy:"practical" as const,container:{id:"test",name:"test",length:3000,width:2000,height:2000,doorWidth:2000,doorHeight:2000,maxWeight:2000},clearance:10};
  const raw=pack(request),source=restorePackingSnapshot(request,{strategy:"practical",placements:raw.placements.map((b,i)=>({...b,x:500+i*500,y:500,z:0,layer:1}))});
  const canvas={style:{}} as HTMLCanvasElement,renderer={domElement:canvas,render(){},setPixelRatio(){},getPixelRatio(){return 1;},setSize(){}} as unknown as THREE.WebGLRenderer,root=createRoot(canvas);await root.configure({gl:renderer,frameloop:"never",size:{width:800,height:400,top:0,left:0}});
  let editor!:PlanEditor,replace!:(plan:PackingResult)=>void,adopted:PackingResult|null=null;
  function Hook(){const [plan,setPlan]=useState(source);replace=setPlan;editor=usePlanEditor(plan,products,false,p=>{adopted=p;setPlan(p);});return <group/>;}
  try{await act(async()=>root.render(<Hook/>));await act(async()=>{editor.update({enabled:true});editor.selectMany(source.placements.map(b=>b.id));});
    await act(async()=>editor.move({x:0,y:100,z:0}));expect(editor.changed).toBe(true);expect(editor.undo).toHaveLength(1);const draft=editor.plan!;expect(draft.placements.every(b=>b.y===600)).toBe(true);
    await act(async()=>editor.update({enabled:false,rectangle:false}));expect(editor.plan).toBe(draft);expect(editor.changed).toBe(true);
    await act(async()=>editor.undoEdit());expect(editor.plan).toBe(source);await act(async()=>editor.redoEdit());expect(editor.plan).toBe(draft);
    await act(async()=>editor.move({x:0,y:0,z:100}));expect(editor.plan).toBe(draft);expect(editor.message).toBeTruthy();expect(editor.undo).toHaveLength(1);
    await act(async()=>editor.apply());expect(adopted).toBe(draft);expect(editor.changed).toBe(false);expect(editor.ids).toHaveLength(0);
    await act(async()=>{editor.update({enabled:true});editor.select(draft.placements[0].id);});await act(async()=>replace({...source,id:source.id}));expect(editor.enabled).toBe(false);expect(editor.undo).toHaveLength(0);expect(editor.selected).toHaveLength(0);
  }finally{await act(async()=>root.unmount());_roots.delete(canvas);}
});
it("mounts a real transform gizmo on a scene parent and converts Three X/Y/Z into physical X/Z/Y",async()=>{
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);extend({Group:THREE.Group});
  const documentStub={addEventListener(){},removeEventListener(){}};vi.stubGlobal("document",documentStub);
  const listeners=new Map<string,()=>void>();
  const canvas={style:{},ownerDocument:documentStub,addEventListener(type:string,handler:()=>void){if(type==="pointercancel")listeners.set(type,handler);},removeEventListener(type:string){if(type==="pointercancel")listeners.delete(type);},getBoundingClientRect(){return {left:0,top:0,width:800,height:400};}} as unknown as HTMLCanvasElement;
  const renderer={domElement:canvas,render(){},setPixelRatio(){},getPixelRatio(){return 1;},setSize(){}} as unknown as THREE.WebGLRenderer,root=createRoot(canvas);await root.configure({gl:renderer,frameloop:"never",size:{width:800,height:400,top:0,left:0}});
  const box={id:"a",productId:"a",sku:"A",name:"A",x:100,y:200,z:300,dx:500,dy:400,dz:200,weight:10,layer:1,color:"#448877",orientation:"LWH"};
  const moved=vi.fn(),drag=vi.fn(),editor={selected:[box],rectangle:false,grid:10,move:moved,selectMany:vi.fn()} as unknown as PlanEditor;
  try{await act(async()=>root.render(<SceneEditHandles editor={editor} boxes={[box]} scale={.01} offset={new THREE.Vector3(-5,1,-2)} onDragging={drag}/>));
    const scene=_roots.get(canvas)!.store.getState().scene,control=scene.getObjectByProperty("isTransformControls",true) as THREE.Object3D&{object:THREE.Object3D;dispatchEvent:(e:{type:string})=>void;translationSnap:number};
    expect(control).toBeDefined();expect(control.object.parent).not.toBeNull();expect(control.translationSnap).toBe(.1);
    await act(async()=>control.dispatchEvent({type:"mouseDown"}));control.object.position.add(new THREE.Vector3(.2,.3,.4));await act(async()=>control.dispatchEvent({type:"mouseUp"}));
    expect(moved.mock.calls[0][0].x).toBeCloseTo(20);expect(moved.mock.calls[0][0].y).toBeCloseTo(40);expect(moved.mock.calls[0][0].z).toBeCloseTo(30);expect(drag.mock.calls).toEqual([[true],[false]]);
    const anchor=control.object,before=anchor.position.clone();await act(async()=>control.dispatchEvent({type:"mouseDown"}));anchor.position.x+=.7;await act(async()=>listeners.get("pointercancel")!());expect(moved).toHaveBeenCalledTimes(1);expect(before.distanceTo(anchor.position)).toBe(0);expect(drag.mock.calls.at(-1)).toEqual([false]);
  }finally{await act(async()=>root.unmount());_roots.delete(canvas);}
});
