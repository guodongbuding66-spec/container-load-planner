import * as THREE from "three";
import type {PackagingPart} from "./packaging";
/** Physical part edges in world coordinates, independent of triangle/material groups. */
export function packagingWireframeGeometry(parts:readonly PackagingPart[],scale:number,offset:THREE.Vector3){
 const vertices:number[]=[];
 const edges=[[0,1],[1,3],[3,2],[2,0],[4,5],[5,7],[7,6],[6,4],[0,4],[1,5],[2,6],[3,7]];
 for(const p of parts){
  const corners=[0,1].flatMap(x=>[0,1].flatMap(z=>[0,1].map(y=>[(p.x+x*p.dx)*scale+offset.x,(p.z+z*p.dz)*scale+offset.y,(p.y+y*p.dy)*scale+offset.z])));
  for(const [a,b] of edges)vertices.push(...corners[a],...corners[b]);
 }
 const geometry=new THREE.BufferGeometry();geometry.setAttribute("position",new THREE.Float32BufferAttribute(vertices,3));geometry.computeBoundingSphere();return geometry;
}
