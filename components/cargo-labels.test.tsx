import {act} from 'react';
import {afterEach,expect,it,vi} from 'vitest';
import {createRoot,extend,_roots} from '@react-three/fiber';
import * as THREE from 'three';
import {CargoLabelInstances} from './scene-details';
import {LABEL_RENDER_ORDER} from '../lib/packing/scene-labels';
import type {PlacedBox} from '../lib/packing/types';
afterEach(()=>vi.unstubAllGlobals());
it('keeps irregular SKU labels camera-facing, above geometry, and updates the visible instance count',async()=>{
 extend({InstancedMesh:THREE.InstancedMesh});const ctx={font:'',fillStyle:'',textAlign:'',textBaseline:'',measureText:(s:string)=>({width:s.length*20}),fillRect(){},fillText(){}};
 vi.stubGlobal('document',{createElement:()=>({width:1,height:1,getContext:()=>ctx})});vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
 const canvas={style:{}} as HTMLCanvasElement,renderer={domElement:canvas,render(){},setPixelRatio(){},getPixelRatio(){return 1;},setSize(){}} as unknown as THREE.WebGLRenderer,camera=new THREE.PerspectiveCamera(45,2,.1,100);
 camera.position.set(8,6,7);camera.lookAt(0,0,0);camera.updateMatrixWorld();
 const root=createRoot(canvas);await root.configure({gl:renderer,camera,frameloop:'never',size:{width:920,height:420,top:0,left:0}});
 const boxes=[{id:'one',x:0,y:0,z:0,dx:600,dy:600,dz:300},{id:'two',x:600,y:0,z:0,dx:600,dy:600,dz:300}] as PlacedBox[],offset=new THREE.Vector3(-2,0,-1),store=_roots.get(canvas)!.store;
 const render=(count:number)=>root.render(<CargoLabelInstances sku="TUBE" boxes={boxes.slice(0,count)} scale={.002} offset={offset}/>);
 const frame=()=>{const state=store.getState();state.clock.elapsedTime++;for(const subscriber of state.internal.subscribers)subscriber.ref.current(state,1/60);};
 try{await act(async()=>render(2));frame();const mesh=store.getState().scene.getObjectByName('cargo-labels:TUBE') as THREE.InstancedMesh;
 expect(mesh.count).toBe(2);expect(mesh.renderOrder).toBe(LABEL_RENDER_ORDER);expect((mesh.material as THREE.Material).depthTest).toBe(false);expect((mesh.material as THREE.Material).depthWrite).toBe(false);
 const matrix=new THREE.Matrix4(),q=new THREE.Quaternion(),position=new THREE.Vector3(),scale=new THREE.Vector3();mesh.getMatrixAt(0,matrix);matrix.decompose(position,q,scale);expect(scale.y).toBeGreaterThan(0);expect(Math.abs(q.dot(camera.quaternion))).toBeCloseTo(1,5);
 camera.position.set(-8,6,7);camera.lookAt(0,0,0);camera.updateMatrixWorld();frame();mesh.getMatrixAt(0,matrix);matrix.decompose(position,q,scale);expect(Math.abs(q.dot(camera.quaternion))).toBeCloseTo(1,5);
 await act(async()=>render(1));expect((store.getState().scene.getObjectByName('cargo-labels:TUBE') as THREE.InstancedMesh).count).toBe(1);
 await act(async()=>root.render(null));expect(store.getState().scene.getObjectByName('cargo-labels:TUBE')).toBeUndefined();
 }finally{await act(async()=>root.unmount());_roots.delete(canvas);}
});
