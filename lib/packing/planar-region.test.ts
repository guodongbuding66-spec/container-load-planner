import {expect,it} from 'vitest';
import {intersectRegion,pointInRegion,regionAreaBounds,triangulatedRegion,unionRegion,polygonRegion} from './planar-region';
import type {V2} from './solid-math';

it('recovers an identical hollow cap independently of the cap diagonal and triangle order',()=>{
 const outer:V2[]=[[0,0],[10,0],[10,10],[0,10]],inner:V2[]=[[3,3],[7,3],[7,7],[3,7]];
 const cap=(alternate:boolean)=>outer.flatMap((a,i)=>{const b=outer[(i+1)%4],c=inner[(i+1)%4],d=inner[i];return alternate?[[a,b,d],[b,c,d]]:[[a,b,c],[a,c,d]];});
 const a=triangulatedRegion(cap(false))!,b=triangulatedRegion(cap(true).reverse())!;
 expect(a).toBeTruthy();expect(b).toEqual(a);expect(pointInRegion([5,5],a)).toBe(false);expect(pointInRegion([1,5],a)).toBe(true);
 const area=regionAreaBounds(a);expect(area.lower).toBeCloseTo(84,8);expect(area.upper).toBeCloseTo(84,8);
 expect(intersectRegion(a,b)).toBe(a);
});
it('keeps separate planar islands and declines to cancel overlapping triangles',()=>{
 const a:V2[]=[[0,0],[2,0],[0,2]],b:V2[]=[[5,0],[7,0],[5,2]],islands=triangulatedRegion([a,b])!;
 const separatedArea=regionAreaBounds(islands);expect(separatedArea.lower).toBeLessThanOrEqual(4);expect(separatedArea.upper).toBeGreaterThanOrEqual(4);expect(separatedArea.upper-separatedArea.lower).toBeLessThan(.005);expect(pointInRegion([3,1],islands)).toBe(false);
 expect(triangulatedRegion([a,[[1,0],[3,0],[1,2]]])).toBeNull();
 const fallback=unionRegion([polygonRegion(a),polygonRegion([[1,0],[3,0],[1,2]])]),area=regionAreaBounds(fallback);
 expect(area.lower).toBeLessThanOrEqual(3.5);expect(area.upper).toBeGreaterThanOrEqual(3.5);expect(area.upper-area.lower).toBeLessThan(.005);
});
it('bounds a large tessellation within its analysis budget without overstating contact',()=>{
 const triangles=Array.from({length:1000},(_,i)=>polygonRegion([[i,0],[i+1,0],[i,1]])),area=regionAreaBounds(unionRegion(triangles),.0002,32);
 expect(area.lower).toBeLessThanOrEqual(500);expect(area.upper).toBeGreaterThanOrEqual(500);expect(area.complete).toBe(false);
 expect(Number.isFinite(area.lower)&&Number.isFinite(area.upper)).toBe(true);
});
