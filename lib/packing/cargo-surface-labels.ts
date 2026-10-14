import * as THREE from 'three';
import {DecalGeometry} from 'three/addons/geometries/DecalGeometry.js';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {pointInPolygon,type V2} from './solid-math';
import type {LabelRect} from './scene-labels';

/** Static stickers cut from the cargo mesh, in the same normalized coordinates. */
export function cargoSurfaceLabelGeometry(source:THREE.BufferGeometry,dimensions:[number,number,number],aspect:number){
 if(dimensions.some(n=>!Number.isFinite(n)||n<=0)||!Number.isFinite(aspect)||aspect<=0||!source.getAttribute('position')?.count)return new THREE.BufferGeometry();
 const physical=source.index?source.toNonIndexed():source.clone();physical.scale(...dimensions);physical.computeVertexNormals();physical.computeBoundingBox();
 const material=new THREE.MeshBasicMaterial({side:THREE.DoubleSide}),mesh=new THREE.Mesh(physical,material),ray=new THREE.Raycaster(),patches:THREE.BufferGeometry[]=[];
 mesh.updateMatrixWorld();const size=new THREE.Vector3(...dimensions),distance=size.length()*2,minimum=Math.min(...dimensions),position=physical.getAttribute('position');
 const directions=[new THREE.Vector3(1,0,0),new THREE.Vector3(-1,0,0),new THREE.Vector3(0,1,0),new THREE.Vector3(0,-1,0),new THREE.Vector3(0,0,1),new THREE.Vector3(0,0,-1)];
 try{for(const direction of directions){
  const axis=[direction.x,direction.y,direction.z].findIndex(n=>n!==0),other=[0,1,2].filter(i=>i!==axis),candidates=[[0,0],[.28,.28],[.28,-.28],[-.28,.28],[-.28,-.28]];
  let sticker:THREE.BufferGeometry|undefined;
  for(const [a,b] of candidates){
   const origin=direction.clone().multiplyScalar(distance);origin.setComponent(other[0],a*size.getComponent(other[0]));origin.setComponent(other[1],b*size.getComponent(other[1]));ray.set(origin,direction.clone().negate());
   const hit=ray.intersectObject(mesh,false).find(h=>h.face&&h.face.normal.dot(direction)>.35);if(!hit?.face)continue;
   const normal=hit.face.normal.clone().normalize(),up=Math.abs(normal.y)>.9?new THREE.Vector3(0,0,-1):new THREE.Vector3(0,1,0),right=up.clone().cross(normal).normalize(),vertical=normal.clone().cross(right).normalize();
   const extent=(v:THREE.Vector3)=>Math.abs(v.x)*size.x+Math.abs(v.y)*size.y+Math.abs(v.z)*size.z,width=Math.min(extent(right)*.32,extent(vertical)*.16*aspect),rotation=new THREE.Euler().setFromRotationMatrix(new THREE.Matrix4().makeBasis(right,vertical,normal));
   // Filter rear-facing surfaces so a thin hollow wall does not receive an
   // accidental duplicate sticker on the inside of its bore.
   const front:number[]=[],u=new THREE.Vector3(),v=new THREE.Vector3(),w=new THREE.Vector3();
   for(let i=0;i+2<position.count;i+=3){u.fromBufferAttribute(position,i);v.fromBufferAttribute(position,i+1);w.fromBufferAttribute(position,i+2);if(v.clone().sub(u).cross(w.clone().sub(u)).normalize().dot(normal)>.25)for(const p of [u,v,w])front.push(p.x,p.y,p.z);}
   const frontGeometry=new THREE.BufferGeometry();frontGeometry.setAttribute('position',new THREE.Float32BufferAttribute(front,3));frontGeometry.computeVertexNormals();const target=new THREE.Mesh(frontGeometry,material);target.updateMatrixWorld();
   try{for(const factor of [1,.7,.45]){
    const candidate=new DecalGeometry(target,hit.point,rotation,new THREE.Vector3(width*factor,width*factor/aspect,minimum*.12)),uv=candidate.getAttribute('uv');let coverage=0;
    for(let i=0;i+2<uv.count;i+=3)coverage+=Math.abs((uv.getX(i+1)-uv.getX(i))*(uv.getY(i+2)-uv.getY(i))-(uv.getY(i+1)-uv.getY(i))*(uv.getX(i+2)-uv.getX(i)))/2;
    if(coverage>=.9){sticker=candidate;break;}candidate.dispose();
   }}finally{frontGeometry.dispose();}
   if(sticker)break;
  }
  if(sticker)patches.push(sticker);
 }
 const geometry=patches.length?mergeGeometries(patches,false)!:new THREE.BufferGeometry();geometry.scale(1/dimensions[0],1/dimensions[1],1/dimensions[2]);geometry.computeBoundingBox();geometry.computeBoundingSphere();geometry.name='cargo-surface-labels';return geometry;
 }finally{patches.forEach(p=>p.dispose());physical.dispose();material.dispose();}
}

export function createCargoLabelMaterial(map:THREE.Texture){return new THREE.MeshBasicMaterial({map,depthTest:true,depthWrite:false,toneMapped:false,side:THREE.FrontSide,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-2});}

/** A top-view sticker fits inside actual material; it never moves into a gap. */
export function cargoFootprintLabel(polygons:V2[][],bounds:LabelRect,aspect:number):LabelRect|null{
 const width=Math.min(bounds.width*.45,bounds.height*.16*aspect),height=width/aspect;
 for(const factor of [1,.8,.6,.45,.3,.2])for(const y of [0,.25,-.25,.375,-.375])for(const x of [0,.25,-.25,.375,-.375]){
  const w=width*factor,h=height*factor,cx=bounds.x+bounds.width*(x+.5),cy=bounds.y+bounds.height*(y+.5);let fits=true;
  for(let i=0;i<=4&&fits;i++)for(let j=0;j<=4;j++){const point:V2=[(cx-w/2+w*i/4-bounds.x)/bounds.width-.5,(cy-h/2+h*j/4-bounds.y)/bounds.height-.5];if(!polygons.some(poly=>pointInPolygon(point,poly))){fits=false;break;}}
  if(fits)return {x:cx-w/2,y:cy-h/2,width:w,height:h};
 }return null;
}
