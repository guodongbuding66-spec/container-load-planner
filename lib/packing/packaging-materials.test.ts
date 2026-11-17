import { expect, it } from "vitest";
import { Vector3 } from "three";
import { createPackagingGeometry, packagingFaceUV } from "./packaging-materials";
import { packagingParts } from "./packaging";
import { BASE_PRESETS, ENCLOSURE_PRESETS, withBasePreset, withEnclosurePreset } from "./packaging-presets";
import { parseFloorPalletConfig } from "./floor-pallets";
import { DEFAULT_PALLET_BUILD } from "./loading-workflow";

it("maps lengthwise grain and cross-sectional end grain in physical millimeters", () => {
  expect(packagingFaceUV([1200, 22, 145], 1, "wood")).toMatchObject({u:0,v:2,surface:"face"});
  expect(packagingFaceUV([145, 22, 1200], 2, "wood")).toMatchObject({u:0,v:1,surface:"end"});
  expect(packagingFaceUV([1200, 22, 145], 2, "plywood")).toMatchObject({u:0,v:1,surface:"end"});
  expect(packagingFaceUV([1200, 22, 145], 1, "plywood")).toMatchObject({surface:"face"});
  const short = packagingFaceUV([600, 22, 145], 1, "wood");
  const long = packagingFaceUV([1200, 22, 145], 1, "wood");
  expect(long.tileU).toBe(short.tileU);
});

it("renders distinct face groups without changing nominal dimensions of thin or bevelled parts", () => {
  for (const [length, thickness, width] of [[1200, 22, 144], [306, 4, 30]]) {
    const g = createPackagingGeometry([length, thickness, width], "plywood");
    g.computeBoundingBox();
    expect(g.boundingBox?.getSize(new Vector3()).toArray()).toEqual([length, thickness, width]);
    expect(g.groups).toHaveLength(2);
    expect(g.groups.reduce((sum,group)=>sum+group.count,0)).toBe(g.getIndex()?.count);
    g.dispose();
  }
});

it("draws a low nine-block base with grid crosspieces without enlarging the packing envelope", () => {
  const legacy = {...DEFAULT_PALLET_BUILD.config, height:25};
  const base = parseFloorPalletConfig(withBasePreset(legacy,BASE_PRESETS.find(p=>p.id==="block-grid")!));
  const parts = packagingParts(base.length,base.width,base.height,base.packaging);
  expect(parts.filter(p=>p.kind==="block")).toHaveLength(9);
  expect(parts.filter(p=>p.kind==="board"&&p.z===0)).toHaveLength(9);
  expect(Math.max(...parts.map(p=>p.z+p.dz))).toBeCloseTo(25);
});

it("round-trips two equal, physically separate wall tiers and an open top", () => {
  const value=withEnclosurePreset({...DEFAULT_PALLET_BUILD.config,maxCargoHeight:360},ENCLOSURE_PRESETS.find(p=>p.id==="collar")!);
  const c=parseFloorPalletConfig(JSON.parse(JSON.stringify(value)));
  const parts=packagingParts(c.length,c.width,c.height,c.packaging,c.maxCargoHeight);
  expect(parts.filter(p=>p.kind==="wall"&&p.dz===180)).toHaveLength(8);
  expect(parts.some(p=>p.kind==="lid")).toBe(false);
  expect(Math.max(...parts.map(p=>p.z+p.dz))).toBe(c.height+360);
});
