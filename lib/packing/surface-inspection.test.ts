import {expect,it} from "vitest";
import {cargoShapeGeometry} from "./cargo-shape-geometry";
import {REGULAR_SURFACE_SHAPES,parseRegularSurfaceSpec,regularSurface,regularSurfaceFeatures,regularSurfaceSpec,snapRegularSurface} from "./surface-inspection";
import type {OrientationCode} from "./types";
import type {Point3} from "./inspection";
const box={x:10,y:20,z:30,dx:1000,dy:100,dz:1000,orientation:"LWH" as const};
const spec=(cargoShape="u-profile")=>parseRegularSurfaceSpec({profile:{cargoShape},orientation:"LWH"});
for(const shape of REGULAR_SURFACE_SHAPES)for(const orientation of ["LWH","LHW","WLH","WHL","HLW","HWL"] as OrientationCode[]){
  it(`${shape}/${orientation}: real vertices match displayed geometry and every pick lies on its boundary`,()=>{
    const s=parseRegularSurfaceSpec({profile:{cargoShape:shape,shapeWallRatio:.2,shapeWallHeightRatio:.3,shapeTopRatio:.6,shapeStepLengthRatio:.4,shapeStepHeightRatio:.7},orientation}),solid=regularSurface(box,s),geometry=cargoShapeGeometry(s.profile,orientation),positions=geometry.getAttribute("position");
    const displayed=Array.from({length:positions.count},(_,i)=>[box.x+(positions.getX(i)+.5)*box.dx,box.y+(positions.getZ(i)+.5)*box.dy,box.z+(positions.getY(i)+.5)*box.dz] as Point3);
    for(const vertex of solid.vertices)expect(Math.min(...displayed.map(p=>Math.hypot(...p.map((n,i)=>n-vertex[i]))))).toBeLessThan(.0001);
    for(const mode of ["vertex","edge","face"] as const)for(const point of regularSurfaceFeatures(box,s,mode))expect(Math.hypot(...point.map((n,i)=>n-snapRegularSurface(box,s,point,"face")[i]))).toBeLessThan(1e-7);
    geometry.dispose();
  });
}
it("U opening is 500 mm, not a bounding corner or a triangulation seam",()=>{const s=regularSurface(box,spec());expect(s.vertices).toHaveLength(16);expect(s.edges).toHaveLength(24);expect(s.faces).toHaveLength(10);expect(Math.hypot(...s.vertices[3].map((n,i)=>n-s.vertices[6][i]))).toBe(500);expect(snapRegularSurface(box,spec(),[510,70,1030],"face")).toEqual([760,70,1030]);});
it("wedge void projects to its actual slope in world millimetres",()=>{const b={...box,dx:100,dy:80,dz:1000},p:Point3=[110,60,1030],q=snapRegularSurface(b,spec("wedge"),p,"face");expect(q[0]).toBeCloseTo(10+100/101,8);expect(q[2]).toBeCloseTo(30+100000/101,8);expect(q[1]).toBe(60);});
it("face references lie inside caps even when a U mean is in empty space",()=>{for(const shape of ["u-profile","l-profile","t-profile","step"]){
 const thin=parseRegularSurfaceSpec({profile:{cargoShape:shape,shapeWallRatio:.000001,shapeWallHeightRatio:.000001,shapeStepLengthRatio:.000001,shapeStepHeightRatio:.000001},orientation:"LWH"});
 expect(()=>regularSurface(box,thin)).not.toThrow();
 }
 const s=regularSurface(box,spec());expect(s.references[0][0]<260||s.references[0][0]>760||s.references[0][2]<280).toBe(true);});
it("explicit proper rotation signs are preserved and inverted signs rejected",()=>{const s=parseRegularSurfaceSpec({profile:{cargoShape:"u-profile"},orientation:"LWH",orientationSigns:[-1,-1,1]});expect(regularSurface(box,s).vertices[0]).toEqual([1010,120,30]);expect(()=>parseRegularSurfaceSpec({...s,orientationSigns:[-1,1,1]})).toThrow();});
it.each(["cylinder","frustum","custom-prism","compound","mesh"])("%s never silently becomes a cuboid solid",cargoShape=>{expect(regularSurfaceSpec(box,{cargoShape:cargoShape as "cylinder"})).toBeNull();});
it("structural pallets and a box with model override cannot use an envelope as a solid",()=>{expect(regularSurfaceSpec({...box,supportOnly:true})).toBeNull();expect(regularSurfaceSpec(box,{cargoType:"pallet"})).toBeNull();expect(regularSurfaceSpec(box,{solidModel:{} as never})).toBeNull();});
it.each([{profile:{cargoShape:"u-profile",shapeWallRatio:.5},orientation:"LWH"},{profile:{cargoShape:"step",shapeStepLengthRatio:NaN},orientation:"LWH"},{profile:{cargoShape:"box"},orientation:"LLH"},{profile:{cargoShape:"box",solidModel:{}},orientation:"LWH"},{profile:{cargoShape:"box",cargoType:"pallet"},orientation:"LWH"}])("rejects malformed solid metadata %#",raw=>expect(()=>parseRegularSurfaceSpec(raw)).toThrow());
