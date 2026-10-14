import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { OrbitControls } from "three-stdlib";
import { TRANSPORT_PRESETS } from "./transport-library";
import { createTransportParts, DEFAULT_TRANSPARENCY, transportOpacity, transportSceneBounds } from "./transport-model";
import { projectModelPreview } from "./model-preview";
import { SceneCameraController } from "./scene-camera";
import type { CameraPresetView, CameraProjection } from "./camera-fit";

const truck = TRANSPORT_PRESETS.find(s => s.id === "truck-4.2")!;
describe("generic exterior transport geometry", () => {
  it("keeps every part outside usable cargo capacity for all presets", () => {
    for (const space of TRANSPORT_PRESETS) {
      const original = JSON.stringify(space), parts = createTransportParts(space);
      expect(parts.length).toBeGreaterThan(0);
      expect(parts.length).toBeLessThan(130);
      const cargoMin = [-space.length / 2, 0, -space.width / 2], cargoMax = [space.length / 2, space.height, space.width / 2];
      for (const p of parts) {
        expect(p.size.every(n => Number.isFinite(n) && n > 0), `${space.id}/${p.name}`).toBe(true);
        expect(p.position.every(Number.isFinite)).toBe(true);
        const overlaps = p.size.map((n,i) => Math.min(cargoMax[i],p.position[i]+n/2)-Math.max(cargoMin[i],p.position[i]-n/2));
        expect(overlaps.every(n => n > 1e-7), `${space.id}/${p.name} intrudes into cargo`).toBe(false);
      }
      expect(JSON.stringify(space)).toBe(original);
    }
  });
  it("distinguishes closed boxes, open-top, flat racks, flatbed trucks and reefers", () => {
    const names = (id:string) => createTransportParts(TRANSPORT_PRESETS.find(s=>s.id===id)!).map(p=>p.name);
    expect(names("20gp")).toEqual(expect.arrayContaining(["roof","rear-door","door-lock-rod","wall-rib"]));
    expect(names("20ot")).not.toContain("roof");
    expect(names("20fr")).toContain("rear-frame");
    expect(names("20fr")).not.toContain("side-wall");
    expect(names("truck-17.5")).toEqual(expect.arrayContaining(["cab","wheel","chassis"]));
    expect(names("truck-17.5")).not.toContain("side-wall");
    expect(names("20rf")).toContain("refrigeration-unit");
    expect(createTransportParts({...truck,length:NaN})).toEqual([]);
  });
  it("uses a semi-transparent default and handles slider endpoints", () => {
    expect(DEFAULT_TRANSPARENCY).toBe(65);
    expect(transportOpacity(DEFAULT_TRANSPARENCY)).toBeCloseTo(.35);
    expect(transportOpacity(0)).toBe(1);expect(transportOpacity(100)).toBe(0);
    expect(transportOpacity(-50)).toBe(1);expect(transportOpacity(150)).toBe(0);
    expect(transportOpacity(NaN)).toBeCloseTo(.35);
  });
  it("fits the complete truck, including cab and wheels, in both camera projections", () => {
    const bounds = transportSceneBounds(truck,.001,"model",0);
    expect(bounds.size[0]).toBeGreaterThan(truck.length*.001);
    expect(bounds.origin[1]).toBeLessThan(0);
    for (const projection of ["perspective","orthographic"] as CameraProjection[]) for (const view of ["perspective","top","side","door","bottom"] as CameraPresetView[]) for (const viewport of [{width:320,height:350},{width:1920,height:800}]) {
      const rig=new SceneCameraController(), camera=rig.cameras[projection], controls=new OrbitControls(camera);
      rig.update({containerSize:[truck.length*.001,truck.height*.001,truck.width*.001],sceneBounds:bounds,viewport,projection,view},controls);
      camera.updateMatrixWorld(true);
      for (const p of createTransportParts(truck)) for (const x of [-1,1]) for (const y of [-1,1]) for (const z of [-1,1]) {
        const v=new THREE.Vector3((p.position[0]+x*p.size[0]/2)*.001,(p.position[1]+y*p.size[1]/2)*.001,(p.position[2]+z*p.size[2]/2)*.001).project(camera);
        expect(Math.abs(v.x)).toBeLessThan(.86);expect(Math.abs(v.y)).toBeLessThan(.86);
        expect(v.z).toBeGreaterThan(-1);expect(v.z).toBeLessThan(1);
      }
      controls.dispose();
    }
    const wire=transportSceneBounds(truck,.001,"wireframe",0);
    expect(wire.origin).toEqual([0,0,0]);
    wire.size.forEach((n,i)=>expect(n).toBeCloseTo([4.2,2.3,2.3][i],10));
  });
  it("projects the same model geometry into finite, bounded SVG faces at opposing angles", () => {
    for (const space of TRANSPORT_PRESETS) for (const direction of [[1,.4,1],[-1,.4,-1],[.2,-1,1]] as [number,number,number][]) {
      const parts=createTransportParts(space),bounds=transportSceneBounds(space,1,"model",0);
      const {faces}=projectModelPreview(parts,bounds,direction,320,245);
      expect(faces.length).toBeGreaterThan(0);
      for (const face of faces) {
        expect(parts.some(p=>p.name===face.name)).toBe(true);
        expect(face.color).toMatch(/^#[0-9a-f]{6}$/);
        const pairs=face.points.split(" ").map(p=>p.split(",").map(Number));
        for (const [x,y] of pairs) {expect(x).toBeGreaterThan(0);expect(x).toBeLessThan(320);expect(y).toBeGreaterThan(0);expect(y).toBeLessThan(245);}
      }
    }
  }, 15000);
});
