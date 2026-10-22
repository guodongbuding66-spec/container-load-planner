import {describe,expect,it} from "vitest";
import {pack} from "./engine";
import {CONTAINER_PRESETS,SAMPLE_PRODUCTS} from "./presets";
import {EMPTY_SECTION,boxBounds,measureBoxGap,measureWall} from "./inspection";
import {captureMeasurement,MEASUREMENT_BYTES,mergeMeasurements,parseMeasurements,savedMeasureCurrent,savedMeasureOverlays,savedMeasureValue,sectionedMeasurement,serializeMeasurements,type SavedMeasurement} from "./saved-measurements";
const plan=pack({mode:"mixed",strategy:"practical",products:SAMPLE_PRODUCTS,container:CONTAINER_PRESETS.find(c=>c.id==="40HQ")??CONTAINER_PRESETS[2],clearance:10});
const box=plan.placements[0],other=plan.placements[1],section={...EMPTY_SECTION},now="2026-10-22T09:00:00.000Z";
const gap=(id="measure-1")=>captureMeasurement(plan,"gap",[box,other],[],"vertex","x-",section,"Gap",id,now);
const archive=(m:unknown[])=>JSON.stringify({format:"cargo-fit-measurements",version:1,measurements:m});
it("roundtrips full precision endpoints, source IDs and independent names without altering the plan",()=>{const before=JSON.stringify(plan),m=gap();expect(parseMeasurements(serializeMeasurements([m]))).toEqual([m]);expect(savedMeasureValue(m)).toEqual(measureBoxGap(box,other));expect(JSON.stringify(plan)).toBe(before);expect(m.targets[0].id).toBe(box.id);});
it("restores current records with a new transient solver ID but invalidates moved, switched or changed plans",()=>{const m=gap();expect(savedMeasureCurrent(m,{...plan,id:"new-transient-id"})).toBe(true);for(const p of [{...plan,strategy:"maximum" as const},{...plan,clearance:11},{...plan,container:{...plan.container,height:plan.container.height+1}},{...plan,placements:plan.placements.map((b,i)=>i===0?{...b,x:b.x+1}:b)},{...plan,cargoDetails:{...plan.cargoDetails,[box.productId]:{cargoShape:"cylinder" as const}}}])expect(savedMeasureCurrent(m,p)).toBe(false);});
it("checks target geometry even when an imported scope string was copied from the current plan",()=>{const m=gap();m.targets[0].source.x+=1;m.targets[0].bounds.x+=1;expect(savedMeasureCurrent(m,plan)).toBe(false);});
it.each(["x-","x+","y-","y+","z-","z+"] as const)("recomputes %s wall distances from physical wall boundaries including clearance",wall=>{const m=captureMeasurement(plan,"wall",[box],[],"face",wall,section,"",wall.replace("+","plus"),now);expect(savedMeasureValue(parseMeasurements(serializeMeasurements([m]))[0])).toEqual(measureWall(box,plan,wall));});
it("saves two points on the same box with different snap modes, independent of later preferences",()=>{const [lo,hi]=boxBounds(box),p=[lo[0],(lo[1]+hi[1])/2,(lo[2]+hi[2])/2] as [number,number,number];const m=captureMeasurement(plan,"points",[box,box],[lo,p],["vertex","face"],"x-",section,"",'points',now);expect(m.snaps).toEqual(["vertex","face"]);expect(savedMeasureValue(m).b).toEqual(p);expect(savedMeasureCurrent(m,plan)).toBe(true);});
it("marks artificial section features and hides their saved lines when the point is cut away",()=>{const cut={...section,axis:"x" as const,percent:1},end=[plan.container.length*.01-10,box.y,box.z] as [number,number,number];const m=captureMeasurement(plan,"points",[box,box],[[box.x,box.y,box.z],end],"vertex","x-",cut,"Cut",'cut',now);expect(sectionedMeasurement(m)).toBe(true);expect(savedMeasureOverlays([m],plan,plan.placements,section,116)).toHaveLength(1);expect(savedMeasureOverlays([m],plan,plan.placements,{...cut,percent:.5},116)).toHaveLength(0);});
it("honors visibility, SKU/playback display filters and stale scope without deleting saved records",()=>{const m=gap();expect(savedMeasureOverlays([m],plan,plan.placements,section,116)).toHaveLength(1);expect(savedMeasureOverlays([{...m,visible:false}],plan,plan.placements,section,116)).toHaveLength(0);expect(savedMeasureOverlays([m],plan,[box],section,1)).toHaveLength(0);expect(savedMeasureOverlays([m],{...plan,strategy:"maximum"},plan.placements,section,116)).toHaveLength(0);expect(m.visible).toBe(true);});
it("merges exact duplicates once and rejects conflicting IDs or overflow without mutating previous records",()=>{const one=gap(),before=serializeMeasurements([one]);expect(mergeMeasurements([one],[one])).toHaveLength(1);expect(()=>mergeMeasurements([one],[{...one,name:"different"}])).toThrow();const twenty=Array.from({length:20},(_,i)=>gap(`m-${i}`));expect(parseMeasurements(serializeMeasurements(twenty))).toHaveLength(20);expect(()=>mergeMeasurements(twenty,[gap("overflow")])).toThrow();expect(serializeMeasurements([one])).toBe(before);});
describe("invalid files preserve the caller's existing records",()=>{
  const mutations:Array<[string,(m:SavedMeasurement)=>unknown]>=[
    ["bad date",m=>({...m,createdAt:"2026-02-30T00:00:00.000Z"})],
    ["oversized name",m=>({...m,name:"x".repeat(81)})],
    ["nonfinite geometry",m=>({...m,targets:[{...m.targets[0],source:{...box,dx:Infinity}},m.targets[1]]})],
    ["negative dimension",m=>({...m,targets:[{...m.targets[0],source:{...box,dx:-1}},m.targets[1]]})],
    ["invalid scope",m=>({...m,scope:"untrusted"})],
    ["invalid visibility",m=>({...m,visible:"yes"})],
    ["duplicate gap target",m=>({...m,targets:[m.targets[0],m.targets[0]]})],
    ["missing target",m=>({...m,targets:[]})],
    ["invalid mode",m=>({...m,mode:"solid"})],
    ["outside captured bounds",m=>({...m,targets:[{...m.targets[0],bounds:{...box,x:box.x-1}},m.targets[1]]})],
    ["clipped gap",m=>({...m,targets:[{...m.targets[0],bounds:{...box,dx:box.dx/2}},m.targets[1]]})],
    ["invalid wall",m=>({...m,mode:"wall",targets:[m.targets[0]],wall:"left"})],
    ["points inside rather than on feature",m=>({...m,mode:"points",snaps:["vertex","face"],points:[[box.x+1,box.y+1,box.z+1],[box.x,box.y,box.z]]})],
  ];
  it.each(mutations)("rejects %s",(_,mutate)=>{const previous=[gap()];expect(()=>parseMeasurements(archive([mutate(gap())]))).toThrow();expect(previous).toEqual([gap()]);});
  it("rejects duplicate records, unsupported schemas and excessive raw bytes",()=>{expect(()=>parseMeasurements(archive([gap(),gap()]))).toThrow();expect(()=>parseMeasurements(archive([]).replace('"version":1','"version":2'))).toThrow();expect(()=>parseMeasurements(' '.repeat(MEASUREMENT_BYTES+1))).toThrow();expect(()=>parseMeasurements('{')).toThrow();});
});
