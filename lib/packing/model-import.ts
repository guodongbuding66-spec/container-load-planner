import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { ConvexHull } from 'three/examples/jsm/math/ConvexHull.js';
import { SimplifyModifier } from 'three/examples/jsm/modifiers/SimplifyModifier.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { boxCell,orientFaces,planesOf,dot,type V3,type SolidCell } from './solid-math';
import { defaultModelPart,parseSolidModel,buildSolidModel,type SolidModel,type ModelPart } from './solid-model';
import type { LengthUnit } from './units';
import { isLengthUnit,toMillimeters } from './units';
import { parseCadMeshFile } from './cad-mesh-import';
export type ModelImportOptions={unit:LengthUnit;up:'X'|'Y'|'Z';separate:boolean;targetTriangles:number};
export type ModelImportResult={model:SolidModel;trianglesBefore:number;trianglesAfter:number;parts:number;closed:boolean;simplified:boolean;proxy:'convex-hull'|'bounding-box';size:V3};
function trianglesFrom(mesh:THREE.Mesh,options:ModelImportOptions,instance?:THREE.Matrix4){
 const geometry=mesh.geometry,matrix=instance?mesh.matrixWorld.clone().multiply(instance):mesh.matrixWorld;
 const p=geometry.getAttribute('position'),index=geometry.getIndex();if(p.count>600000||(index?.count??p.count)>600000)throw Error('输入超过 200000 个三角面，请先在建模软件中减面。');const vertices:V3[]=[],faces:number[][]=[],factor=toMillimeters(1,options.unit),map=options.up==='Y'?[0,2,1]:options.up==='X'?[1,2,0]:[0,1,2],reverse=(matrix.determinant()<0)!==(options.up==='Y');
 for(let i=0;i<p.count;i++){const v=mesh.getVertexPosition(i,new THREE.Vector3()).applyMatrix4(matrix),a=v.toArray();vertices.push(map.map(j=>a[j]*factor) as V3);}
 const start=geometry.drawRange.start,count=Math.min(index?.count??p.count,Number.isFinite(geometry.drawRange.count)?start+geometry.drawRange.count:Infinity);
 for(let i=start;i+2<count;i+=3){const f=[0,1,2].map(j=>index?index.getX(i+j):i+j);faces.push(reverse?[f[0],f[2],f[1]]:f);}
 return {vertices,faces};
}
function weld(vertices:V3[],faces:number[][]){const unique:V3[]=[],ids=new Map<string,number>(),lookup=vertices.map(p=>{const key=p.map(n=>n.toPrecision(12)).join('/');let i=ids.get(key);if(i===undefined){i=unique.length;ids.set(key,i);unique.push(p);}return i;});return {vertices:unique,faces:faces.map(f=>f.map(i=>lookup[i])).filter(f=>new Set(f).size===3)};}
function isClosed(faces:number[][]){const edges=new Map<string,{count:number;balance:number}>();for(const f of faces)for(let i=0;i<3;i++){const a=f[i],b=f[(i+1)%3],key=a<b?`${a}/${b}`:`${b}/${a}`,old=edges.get(key)??{count:0,balance:0};old.count++;old.balance+=a<b?1:-1;edges.set(key,old);}return edges.size>0&&[...edges.values()].every(e=>e.count===2&&e.balance===0);}
function hullOf(vertices:V3[]):{cell:SolidCell;coarse:boolean}{
 const min:[number,number,number]=[Infinity,Infinity,Infinity],max:[number,number,number]=[-Infinity,-Infinity,-Infinity];for(const p of vertices)for(let i=0;i<3;i++){min[i]=Math.min(min[i],p[i]);max[i]=Math.max(max[i],p[i]);}
 if(max.some((n,i)=>n-min[i]<=1e-6))throw Error('模型没有有效三维体积，请补充真实厚度。');
 let cell:SolidCell|undefined;
 if(vertices.length<=60000){const hull=new ConvexHull().setFromPoints(vertices.map(p=>new THREE.Vector3(...p))),v:V3[]=[],f:number[][]=[];for(const face of hull.faces){const indices:number[]=[],start=face.edge;let edge=start;do{indices.push(v.length);v.push(edge.vertex.point.toArray() as V3);edge=edge.next;}while(edge!==start);f.push(indices);}const w=weld(v,f);if(w.vertices.length<=2000&&w.faces.length<=4000){const candidate=orientFaces({vertices:w.vertices,faces:w.faces}),planes=planesOf(candidate);if(vertices.every(v=>planes.every(p=>dot(p.normal,v)<=p.offset+1e-5)))cell=candidate;}}
 return cell?{cell,coarse:false}:{cell:boxCell(min[0],min[1],min[2],max[0]-min[0],max[1]-min[1],max[2]-min[2]),coarse:true};
}
function simplify(vertices:V3[],faces:number[][],target:number){
 if(faces.length<=target)return {vertices,faces,simplified:false};
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(vertices.flat(),3));g.setIndex(faces.flat());g.computeVertexNormals();
 const targetVertices=Math.max(20,Math.floor(target/2));let reduced:THREE.BufferGeometry|undefined;
 try{reduced=new SimplifyModifier().modify(g,Math.max(0,vertices.length-targetVertices));const p=reduced.getAttribute('position'),index=reduced.getIndex(),v:V3[]=[],f:number[][]=[];for(let i=0;i<p.count;i++)v.push([p.getX(i),p.getY(i),p.getZ(i)]);for(let i=0;i+2<(index?.count??p.count);i+=3)f.push([0,1,2].map(j=>index?index.getX(i+j):i+j));if(f.length>target||f.length<4)throw Error('模型无法稳定简化，请先在建模软件中减面。');return {...weld(v,f),simplified:true};}finally{g.dispose();reduced?.dispose();}
}
/** Files stay local. Every dependency must be embedded or explicitly selected with the main file. */
export async function importCargoModel(files:File[],options:ModelImportOptions):Promise<ModelImportResult>{
 if(!isLengthUnit(options.unit)||!['X','Y','Z'].includes(options.up)||typeof options.separate!=='boolean')throw Error('模型单位或朝上轴无效。');
 if(!files.length||files.length>80||files.reduce((n,f)=>n+f.size,0)>50*1024*1024)throw Error('模型和依赖文件合计不能超过 50 MB。');
 const primary=files.filter(f=>/\.(glb|gltf|stl|obj|dxf)$/i.test(f.name));if(primary.length!==1)throw Error('请选择一个 GLB／glTF／STL／OBJ／DXF 主文件及其本地依赖文件。');
 if(primary[0].size>25*1024*1024||!Number.isInteger(options.targetTriangles)||options.targetTriangles<100||options.targetTriangles>12000)throw Error('主模型须小于 25 MB，目标面数须为 100–12000。');
 const byName=new Map<string,File>();for(const file of files){if(byName.has(file.name))throw Error('模型依赖文件不能有重复名称。');byName.set(file.name,file);}
 const isCadMesh=/\.(stl|obj|dxf)$/i.test(primary[0].name);
 const urls=new Map<string,string>();
 let draco:DRACOLoader|undefined;
 let root:THREE.Object3D|undefined;
 try{
  const chunks:Array<{vertices:V3[];faces:number[][];name:string}>=[];let trianglesBefore=0;
  const bytes=await primary[0].arrayBuffer();
  if(isCadMesh){
   const parsed=parseCadMeshFile(primary[0].name,bytes,{unit:options.unit,up:options.up});
   trianglesBefore=parsed.triangleCount;
   for(const c of parsed.chunks)chunks.push({name:c.name,vertices:c.vertices,faces:c.faces});
  }else{
   const manager=new THREE.LoadingManager();manager.setURLModifier(url=>{
    if(/^data:application\/(octet-stream|gltf-buffer);base64,/i.test(url))return url;
    if(/^blob:/.test(url)&&[...urls.values()].includes(url))return url;
    let name:string;try{name=decodeURIComponent(url).replaceAll('\\','/').split('/').at(-1)!;}catch{throw Error('模型依赖路径无效。');}
    const file=byName.get(name);if(!file||/^[a-z]+:\/\//i.test(url))throw Error(`请选择模型的本地依赖文件：${name}`);
    let blob=urls.get(name);if(!blob){blob=URL.createObjectURL(file);urls.set(name,blob);}return blob;
   });
   draco=new DRACOLoader();draco.setDecoderPath('/model-codecs/draco/');const loader=new GLTFLoader(manager).setDRACOLoader(draco).setMeshoptDecoder(MeshoptDecoder);
   loader.register(parser=>({name:"CARGOFIT_static_geometry",beforeRoot:()=>{parser.json.animations=[];parser.json.materials=(parser.json.materials??[]).map((m:{name?:string;doubleSided?:boolean})=>({name:m.name,doubleSided:m.doubleSided,pbrMetallicRoughness:{baseColorFactor:[1,1,1,1],metallicFactor:0,roughnessFactor:1}}));return null;}}));
   const gltf=await loader.parseAsync(/\.gltf$/i.test(primary[0].name)?new TextDecoder().decode(bytes):bytes,'');root=gltf.scene;root.updateMatrixWorld(true);
   root.traverse(node=>{const mesh=node as THREE.Mesh;if(!mesh.isMesh||!mesh.geometry)return;if((mesh as THREE.SkinnedMesh).isSkinnedMesh)(mesh as THREE.SkinnedMesh).skeleton.update();const count=(mesh as THREE.InstancedMesh).isInstancedMesh?(mesh as THREE.InstancedMesh).count:1;for(let i=0;i<count;i++){const instance=(mesh as THREE.InstancedMesh).isInstancedMesh?new THREE.Matrix4():undefined;if(instance)(mesh as THREE.InstancedMesh).getMatrixAt(i,instance);const data=trianglesFrom(mesh,options,instance);if(!data.faces.length)continue;trianglesBefore+=data.faces.length;if(trianglesBefore>200000)throw Error('输入超过 200000 个三角面，请先在建模软件中减面。');chunks.push({...data,name:mesh.name||primary[0].name});}});
  }
  if(!chunks.length)throw Error('文件没有可装载的三角网格。');
  const origin:V3=[Infinity,Infinity,Infinity];for(const c of chunks)for(const v of c.vertices)for(let i=0;i<3;i++)origin[i]=Math.min(origin[i],v[i]);for(const c of chunks)c.vertices=c.vertices.map(v=>v.map((n,i)=>n-origin[i]) as V3);
  let groups=chunks;if(!options.separate){const vertices:V3[]=[],faces:number[][]=[];for(const c of chunks){const offset=vertices.length;vertices.push(...c.vertices);faces.push(...c.faces.map(f=>f.map(i=>i+offset)));}groups=[{vertices,faces,name:primary[0].name}];}
  if(groups.length>24)throw Error('最多保留 24 个子网格，请选择合并后导入。');
  let trianglesAfter=0,simplified=false,coarse=false,closed=true;const target=Math.max(100,Math.floor(options.targetTriangles/groups.length));
  const parts:ModelPart[]=groups.map((g,i)=>{const original=weld(g.vertices,g.faces),hull=hullOf(original.vertices),actualClosed=isClosed(original.faces),small=simplify(original.vertices,original.faces,target);coarse||=hull.coarse;closed&&=actualClosed;simplified||=small.simplified;trianglesAfter+=small.faces.length;
   return {...defaultModelPart('mesh',[1,1,1],`mesh-${i+1}`),name:g.name.slice(0,120),mesh:{vertices:small.vertices,triangles:small.faces,proxy:hull.cell,filename:primary[0].name.slice(0,200),closed:actualClosed}};
  });
  const model=parseSolidModel({version:1,parts,restFaces:['L-','L+','W-','W+','H-','H+'],loadFaces:['L-','L+','W-','W+','H-','H+'],antiRoll:false})!,size=buildSolidModel(model).size;
  return {model,size,trianglesBefore,trianglesAfter,parts:parts.length,closed,simplified,proxy:coarse?'bounding-box':'convex-hull'};
 }finally{
  draco?.dispose();for(const url of urls.values())URL.revokeObjectURL(url);
  root?.traverse(node=>{const mesh=node as THREE.Mesh;if(!mesh.isMesh)return;mesh.geometry?.dispose();for(const material of Array.isArray(mesh.material)?mesh.material:[mesh.material]){if(!material)continue;for(const value of Object.values(material))if(value instanceof THREE.Texture){const image=value.image as {close?:()=>void};image?.close?.();value.dispose();}material.dispose();}});
 }
}
