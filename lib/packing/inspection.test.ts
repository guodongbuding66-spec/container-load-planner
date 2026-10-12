import { describe, expect, it } from "vitest";
import { boxFeatures, EMPTY_SECTION, formatMeasure, inspectBoxes, measureBoxGap, measurePoints, measureWall, sectionBox, snapBoxPoint } from "./inspection";
import { parseViewPreferences, DEFAULT_VIEW_PREFERENCES } from "./view-preferences";
import type { PackingResult, PlacedBox } from "./types";
const first={x:100,y:200,z:300,dx:600,dy:400,dz:200};
const container={length:2000,width:1200,height:1000};
const physical={container,clearance:10} as PackingResult;
describe("real-coordinate measurement and view-only sectioning",()=>{
  it("snaps to real vertices, nearest edge points and the picked face point",()=>{
    expect(boxFeatures(first,"vertex")).toHaveLength(8);expect(boxFeatures(first,"edge")).toHaveLength(12);expect(boxFeatures(first,"face")).toHaveLength(6);
    expect(snapBoxPoint(first,[110,210,499],"vertex")).toEqual([100,200,500]);
    expect(snapBoxPoint(first,[350,208,499],"edge")).toEqual([350,200,500]);
    expect(snapBoxPoint(first,[350,410,500],"face")).toEqual([350,410,500]);
    expect(snapBoxPoint(first,[-100,900,500],"face")).toEqual([100,600,500]);
  });
  it("measures diagonal point distances and display precision without rounding coordinates",()=>{
    const m=measurePoints([0,0,0],[30.1234,40,120]);
    expect(m.distance).toBeCloseTo(Math.hypot(30.1234,40,120),10);expect(m.deltas).toEqual([30.1234,40,120]);
    expect(formatMeasure(1234.5678,"cm",3)).toBe("123.457 cm");expect(formatMeasure(1234.5678,"m",2)).toBe("1.23 m");expect(m.b[0]).toBe(30.1234);
  });
  it("uses nearest outer surfaces rather than centres for touching, overlapping and diagonal gaps",()=>{
    const m=measureBoxGap(first,{...first,x:800,y:700,z:300});
    expect(m.deltas).toEqual([100,100,0]);expect(m.distance).toBeCloseTo(Math.sqrt(20000));
    expect(m.a).toEqual([700,600,400]);expect(m.b).toEqual([800,700,400]);
    expect(measureBoxGap(first,{...first,x:700}).distance).toBe(0);
    expect(measureBoxGap(first,{...first,x:200}).distance).toBe(0);
  });
  it("includes safety clearance in the physical walls and measures height from the real floor",()=>{
    expect(measureWall(first,physical,"x-").distance).toBe(110);expect(measureWall(first,physical,"x+").distance).toBe(1290);
    expect(measureWall(first,physical,"y-").distance).toBe(210);expect(measureWall(first,physical,"y+").distance).toBe(590);
    expect(measureWall(first,physical,"z-").distance).toBe(300);expect(measureWall(first,physical,"z+").distance).toBe(500);
  });
  it.each(["x","y","z"] as const)("clips display boxes on %s without touching solver records",axis=>{
    const before=JSON.stringify(first),section={...EMPTY_SECTION,axis,percent:30};
    const display=sectionBox(first,physical,section),reverse=sectionBox(first,physical,{...section,reverse:true});
    expect(JSON.stringify(first)).toBe(before);
    if(display&&reverse){const key=axis==="x"?"dx":axis==="y"?"dy":"dz";expect(display[key]+reverse[key]).toBeCloseTo(first[key]);}
    expect(sectionBox(first,physical,{...section,percent:0})).toBeNull();
    expect(sectionBox(first,physical,{...section,percent:100})).toEqual(first);
  });
  it("isolates layer, pallet and complete set identities while preserving full-plan quantities",()=>{
    const placements=[{...first,id:"a",productId:"p",layer:1,setCode:"KIT",setNumber:1,palletIds:["pallet-a"]},{...first,id:"b",productId:"p",layer:2,setCode:"KIT",setNumber:2,palletIds:["pallet-b"]}] as PlacedBox[];
    const result={...physical,placements} as PackingResult,visible=new Set(["p"]),before=JSON.stringify(result);
    for(const section of [{...EMPTY_SECTION,isolation:"layer" as const,target:"1"},{...EMPTY_SECTION,isolation:"pallet" as const,target:"pallet-a"},{...EMPTY_SECTION,isolation:"set" as const,target:JSON.stringify(["KIT",1])}])expect(inspectBoxes(result,visible,2,section).map(b=>b.id)).toEqual(["a"]);
    expect(inspectBoxes(result,visible,0,EMPTY_SECTION)).toEqual([]);expect(inspectBoxes(result,new Set(),2,EMPTY_SECTION)).toEqual([]);
    expect(JSON.stringify(result)).toBe(before);
  });
  it("validates stored preferences, bounds panel widths and ignores malformed or injected values",()=>{
    expect(parseViewPreferences(null)).toEqual(DEFAULT_VIEW_PREFERENCES);
    const p=parseViewPreferences({dimensionLineColor:"#ab1234",dimensionTextColor:"url(javascript:bad)",leftWidth:99999,rightWidth:-1,measurePrecision:8,transparency:Infinity,labels:false,dimensionFontSize:100,measureSnap:"edge"});
    expect(p.dimensionLineColor).toBe("#ab1234");expect(p.dimensionTextColor).toBe(DEFAULT_VIEW_PREFERENCES.dimensionTextColor);
    expect(p.leftWidth).toBe(300);expect(p.rightWidth).toBe(220);expect(p.measurePrecision).toBe(3);expect(p.transparency).toBe(65);expect(p.labels).toBe(false);expect(p.dimensionFontSize).toBe(18);expect(p.measureSnap).toBe("edge");
  });
});
