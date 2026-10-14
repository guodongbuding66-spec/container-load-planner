import {act} from 'react';
import {afterEach,expect,it,vi} from 'vitest';
import {createRoot,extend,_roots} from '@react-three/fiber';
import * as THREE from 'three';
import {ContainerModel} from './container-scene';
import {TransportAppearanceProvider} from './transport-appearance';
import {updateViewPreferences} from './view-preferences';
import {DEFAULT_VIEW_PREFERENCES} from '../lib/packing/view-preferences';
import {EMPTY_SECTION} from '../lib/packing/inspection';
import {defaultSolidModel} from '../lib/packing/solid-model';
import {pack} from '../lib/packing/engine';
afterEach(()=>{vi.unstubAllGlobals();updateViewPreferences(DEFAULT_VIEW_PREFERENCES);});
it('keeps curved stickers on the cargo through orbit, zoom, resizing, clipping, movement, playback and toggling',async()=>{
 extend({Group:THREE.Group,Mesh:THREE.Mesh,InstancedMesh:THREE.InstancedMesh,BoxGeometry:THREE.BoxGeometry,PlaneGeometry:THREE.PlaneGeometry,MeshBasicMaterial:THREE.MeshBasicMaterial,MeshStandardMaterial:THREE.MeshStandardMaterial,GridHelper:THREE.GridHelper});
 const ctx={font:'',fillStyle:'',textAlign:'',textBaseline:'',measureText:(s:string)=>({width:s.length*20}),fillRect(){},fillText(){}};
 vi.stubGlobal('document',{createElement:()=>({width:1,height:1,getContext:()=>ctx})});vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);updateViewPreferences({...DEFAULT_VIEW_PREFERENCES,dimensions:false});
 const canvas={style:{}} as HTMLCanvasElement,renderer={domElement:canvas,render(){},setPixelRatio(){},getPixelRatio(){return 1;},setSize(){}} as unknown as THREE.WebGLRenderer,camera=new THREE.PerspectiveCamera(45,2,.1,100);
 camera.position.set(8,6,7);camera.lookAt(0,0,0);camera.updateMatrixWorld();const root=createRoot(canvas);await root.configure({gl:renderer,camera,frameloop:'never',size:{width:920,height:420,top:0,left:0}});
 const p={id:'tube',sku:'TUBE',name:'Tube',length:600,width:600,height:300,solidModel:defaultSolidModel('tube',[600,600,300]),cargoShape:'tube' as const,quantity:2,weight:10,priority:1,rotationPolicy:'fixed' as const,stackable:true,maxStackLayers:0,color:'#338899'},plan=pack({mode:'mixed',strategy:'maximum',container:{id:'c',name:'C',length:1200,width:600,height:300,doorWidth:600,doorHeight:300,maxWeight:1000},products:[p],clearance:0}),store=_roots.get(canvas)!.store;
 const render=(count=2,labels=true,section=EMPTY_SECTION,result=plan)=>root.render(<TransportAppearanceProvider><ContainerModel result={result} visibleProducts={new Set(['tube'])} visibleCount={count} reducedRendering={false} modelMode="wireframe" transparency={65} labels={labels} selected={null} onSelect={()=>{}} section={section}/></TransportAppearanceProvider>);
 const sticker=()=>store.getState().scene.getObjectByName('cargo-surface-labels:TUBE') as THREE.InstancedMesh;
 const cargo=()=>store.getState().scene.getObjectsByProperty('isInstancedMesh',true).find(m=>(m as THREE.Mesh).geometry.name==='cargo-shape:tube') as THREE.InstancedMesh;
 const frame=()=>{const state=store.getState();state.clock.elapsedTime++;for(const subscriber of state.internal.subscribers)subscriber.ref.current(state,1/60);};
 try{await act(async()=>render());const label=sticker(),before=label.instanceMatrix.array.slice(),vertices=label.geometry.getAttribute('position').array.slice();expect(label.count).toBe(2);
 expect(label.instanceMatrix.array).toEqual(cargo().instanceMatrix.array);const material=label.material as THREE.Material;expect(material.depthTest).toBe(true);expect(material.depthWrite).toBe(false);expect(material.polygonOffset).toBe(true);expect(material.side).toBe(THREE.FrontSide);expect(label.parent?.name).toBe('section-geometry');
 for(const c of [new THREE.PerspectiveCamera(60,1,.1,100),new THREE.OrthographicCamera(-5,5,5,-5,.1,100)]){c.position.set(-8,6,7);c.lookAt(0,0,0);c.updateMatrixWorld();store.setState({camera:c});frame();c.zoom=3;c.updateProjectionMatrix();frame();expect(sticker().instanceMatrix.array).toEqual(before);expect(sticker().geometry.getAttribute('position').array).toEqual(vertices);}
 await act(async()=>{await root.configure({frameloop:'never',size:{width:640,height:340,top:0,left:0}});});frame();expect(sticker().instanceMatrix.array).toEqual(before);
 await act(async()=>render(2,true,{...EMPTY_SECTION,axis:'x',percent:80}));expect((sticker().material as THREE.Material).clippingPlanes).toHaveLength(1);expect(sticker().instanceMatrix.array).toEqual(cargo().instanceMatrix.array);
 const moved={...plan,placements:plan.placements.map(b=>({...b,x:b.x+20,y:b.y+10}))};await act(async()=>render(2,true,EMPTY_SECTION,moved));expect(sticker().instanceMatrix.array).toEqual(cargo().instanceMatrix.array);expect(sticker().instanceMatrix.array).not.toEqual(before);
 await act(async()=>render(1));expect(sticker().count).toBe(1);await act(async()=>render(1,false));expect(sticker()).toBeUndefined();
 }finally{await act(async()=>root.unmount());_roots.delete(canvas);}
});
