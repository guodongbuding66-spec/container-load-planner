import * as THREE from 'three';
import {GLTFExporter} from 'three/addons/exporters/GLTFExporter.js';
import {cargoShapeGeometry} from './cargo-shape-geometry';
import {buildSolidModel,parseSolidModel,type SolidModel} from './solid-model';

/** glTF uses metres and Y-up; only the actual display mesh is exported. */
export async function exportCargoModel(model:SolidModel,format:'glb'|'gltf',color='#338899',name='Cargo model'):Promise<Blob>{
  const validated=parseSolidModel(model);if(!validated)throw Error('模型参数无效。');
  const built=buildSolidModel(validated),geometry=cargoShapeGeometry({solidModel:validated},'LWH'),material=new THREE.MeshStandardMaterial({color,roughness:.82}),mesh=new THREE.Mesh(geometry,material);
  mesh.name=name.slice(0,120);mesh.scale.set(built.size[0]/1000,built.size[2]/1000,built.size[1]/1000);mesh.position.set(built.size[0]/2000,built.size[2]/2000,built.size[1]/2000);mesh.updateMatrixWorld(true);
  mesh.userData={cargoFit:{version:1,units:'m',up:'Y',envelopeMillimeters:built.size,fixtureTareKg:built.fixtureWeight}};
  try{const exported=await new GLTFExporter().parseAsync(mesh,{binary:format==='glb'});return new Blob([exported instanceof ArrayBuffer?exported:JSON.stringify(exported)],{type:format==='glb'?'model/gltf-binary':'model/gltf+json'});}
  finally{geometry.dispose();material.dispose();}
}

export async function downloadCargoModel(model:SolidModel,format:'glb'|'gltf',color:string,name:string){
  const blob=await exportCargoModel(model,format,color,name),url=URL.createObjectURL(blob),link=document.createElement('a');
  link.href=url;link.download=`${name.replace(/[^\p{L}\p{N}_-]/gu,'_').slice(0,80)||'cargo-model'}.${format}`;link.click();setTimeout(()=>URL.revokeObjectURL(url),10000);
}
