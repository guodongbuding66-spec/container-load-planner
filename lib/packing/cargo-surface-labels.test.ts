import {expect,it} from 'vitest';
import * as THREE from 'three';
import {cargoSurfaceLabelGeometry,cargoFootprintLabel} from './cargo-surface-labels';
import {cargoShapeGeometry,cargoShapeFootprints} from './cargo-shape-geometry';
import {defaultSolidModel} from './solid-model';
import {pointInPolygon} from './solid-math';

it.each(['tube','frustum','l-profile','u-profile','step','custom-prism'] as const)('cuts every %s sticker vertex from the actual surface rather than an envelope or billboard',kind=>{
 const shape={solidModel:defaultSolidModel(kind,[600,600,300])},source=cargoShapeGeometry(shape),labels=cargoSurfaceLabelGeometry(source,[600,300,600],3),points=source.getAttribute('position'),index=source.getIndex(),n=index?.count??points.count,triangles:THREE.Triangle[]=[];
 for(let i=0;i+2<n;i+=3)triangles.push(new THREE.Triangle(...[0,1,2].map(j=>new THREE.Vector3().fromBufferAttribute(points,index?index.getX(i+j):i+j)) as [THREE.Vector3,THREE.Vector3,THREE.Vector3]));
 try{const vertices=labels.getAttribute('position');expect(vertices.count).toBeGreaterThan(0);for(let i=0;i<vertices.count;i++){const p=new THREE.Vector3().fromBufferAttribute(vertices,i),closest=new THREE.Vector3();expect(Math.min(...triangles.map(t=>t.closestPointToPoint(p,closest).distanceTo(p)))).toBeLessThan(2e-6);expect([p.x,p.y,p.z].every(x=>Math.abs(x)<=.500001)).toBe(true);}expect(labels.getAttribute('uv').count).toBe(vertices.count);}finally{source.dispose();labels.dispose();}
});
it('keeps a top-view tube sticker entirely on material, and keeps its relative placement through resizing',()=>{
 const p={solidModel:defaultSolidModel('tube',[600,600,300])},polygons=cargoShapeFootprints(p,'LWH'),a=cargoFootprintLabel(polygons,{x:20,y:40,width:100,height:100},3)!,b=cargoFootprintLabel(polygons,{x:40,y:80,width:200,height:200},3)!;
 expect(a).toBeTruthy();expect(b.x).toBeCloseTo(a.x*2);expect(b.y).toBeCloseTo(a.y*2);expect(b.width).toBeCloseTo(a.width*2);expect(b.height).toBeCloseTo(a.height*2);
 for(let i=0;i<=10;i++)for(let j=0;j<=10;j++){const point:[number,number]=[(a.x+a.width*i/10-20)/100-.5,(a.y+a.height*j/10-40)/100-.5];expect(polygons.some(poly=>pointInPolygon(point,poly))).toBe(true);}
});
