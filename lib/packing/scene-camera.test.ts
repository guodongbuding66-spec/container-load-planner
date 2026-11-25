import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { OrbitControls } from "three-stdlib";
import { createRoot, _roots } from "@react-three/fiber";
import { SceneCameraController, type SceneCameraRequest } from "./scene-camera";
import type { CameraPresetView, CameraProjection, SceneSize } from "./camera-fit";

const size: SceneSize = [5.6, 1.25, 1.09];
const views: CameraPresetView[] = ["perspective", "top", "side", "door", "bottom", "rear", "left"];
const viewports = [{ width: 920, height: 420 }, { width: 2048, height: 852 }, { width: 390, height: 500 }];
const projections: CameraProjection[] = ["perspective", "orthographic"];

function expectVisible(camera: THREE.Camera, bounds: SceneSize = size, origin: SceneSize = [0, 0, 0]) {
  camera.updateMatrixWorld(true);
  const projected: THREE.Vector3[] = [];
  for (const x of [-bounds[0] / 2, bounds[0] / 2]) {
    for (const y of [0, bounds[1]]) {
      for (const z of [-bounds[2] / 2, bounds[2] / 2]) {
        const p = new THREE.Vector3(x + origin[0], y + origin[1], z + origin[2]).project(camera);
        expect(Math.abs(p.x)).toBeLessThan(0.86);
        expect(Math.abs(p.y)).toBeLessThan(0.86);
        expect(p.z).toBeGreaterThan(-1);
        expect(p.z).toBeLessThan(1);
        projected.push(p);
      }
    }
  }
  // A pixel-sized orthographic frustum would technically contain the model but make it tiny.
  expect(Math.max(...projected.flatMap(p => [Math.abs(p.x), Math.abs(p.y)]))).toBeGreaterThan(0.58);
}

describe("scene camera and real OrbitControls transitions", () => {
  it("prevents Fiber resize from replacing model-unit orthographic bounds with pixel bounds", async () => {
    const rig = new SceneCameraController();
    const camera = rig.cameras.orthographic;
    const controls = new OrbitControls(camera);
    const canvas = { style: {} } as HTMLCanvasElement;
    // No GPU drawing: use the real Fiber root/resize subscription with a renderer stub.
    const renderer = { domElement: canvas, render() {}, setPixelRatio() {}, setSize() {} } as unknown as THREE.WebGLRenderer;
    const root = createRoot(canvas);
    const request: SceneCameraRequest = { containerSize: size, viewport: viewports[0], view: "side", projection: "orthographic" };
    try {
      rig.update(request, controls);
      await root.configure({ gl: renderer, camera, frameloop: "never", size: { ...viewports[0], top: 0, left: 0 } });
      // Reproduce the old automatic-camera behavior before checking the guarded resize.
      camera.manual = false;
      await root.configure({ gl: renderer, camera, frameloop: "never", size: { ...viewports[1], top: 0, left: 0 } });
      expect(camera.right).toBe(viewports[1].width / 2);
      expect(camera.top).toBe(viewports[1].height / 2);
      camera.manual = true;
      rig.update({ ...request, viewport: viewports[1] }, controls);
      const bounds = [camera.left, camera.right, camera.top, camera.bottom];
      await root.configure({ gl: renderer, camera, frameloop: "never", size: { ...viewports[2], top: 0, left: 0 } });
      expect([camera.left, camera.right, camera.top, camera.bottom]).toEqual(bounds);
      rig.update({ ...request, viewport: viewports[2] }, controls);
      expectVisible(camera);
    } finally {
      controls.dispose();
      _roots.delete(canvas);
    }
  });

  it.each(projections.flatMap(projection => views.flatMap(view => viewports.map(viewport => ({ projection, view, viewport })))))(
    "keeps the full load visible in $projection / $view at $viewport",
    ({ projection, view, viewport }) => {
      const rig = new SceneCameraController();
      const camera = rig.cameras[projection];
      const controls = new OrbitControls(camera);
      controls.enableDamping = true;
      rig.update({ containerSize: size, viewport, view, projection }, controls);
      for (let frame = 0; frame < 12; frame++) controls.update();
      expect(camera.manual).toBe(true);
      expectVisible(camera);
      controls.dispose();
    },
  );

  it("does not jump, refit or clear zoom when a top-view drag starts", () => {
    const rig = new SceneCameraController();
    const camera = rig.cameras.orthographic;
    const controls = new OrbitControls(camera);
    const request: SceneCameraRequest = { containerSize: size, viewport: viewports[0], view: "top", projection: "orthographic" };
    rig.update(request, controls);
    camera.zoom = 2.4;
    camera.position.add(new THREE.Vector3(0.4, 0.2, -0.3));
    controls.target.add(new THREE.Vector3(0.4, 0, -0.3));
    camera.updateProjectionMatrix();
    controls.update();
    const pose = { position: camera.position.clone(), rotation: camera.quaternion.clone(), target: controls.target.clone(), matrix: camera.projectionMatrix.clone() };
    expect(rig.update({ ...request, view: "free" }, controls)).toBe(false);
    expect(camera.position.equals(pose.position)).toBe(true);
    expect(camera.quaternion.equals(pose.rotation)).toBe(true);
    expect(controls.target.equals(pose.target)).toBe(true);
    expect(camera.projectionMatrix.equals(pose.matrix)).toBe(true);
    expect(camera.zoom).toBe(2.4);
    controls.dispose();
  });

  it("preserves a free orbit direction while repeatedly switching projection", () => {
    const rig = new SceneCameraController();
    let projection: CameraProjection = "perspective";
    let controls = new OrbitControls(rig.cameras[projection]);
    const request = { containerSize: size, viewport: viewports[0], view: "perspective" as const, projection };
    rig.update(request, controls);
    const direction = new THREE.Vector3(-0.7, 0.25, 0.55).normalize();
    rig.cameras[projection].position.copy(controls.target).addScaledVector(direction, 8);
    controls.update();
    rig.update({ ...request, view: "free" }, controls);
    for (let turn = 0; turn < 8; turn++) {
      controls.dispose();
      projection = projection === "perspective" ? "orthographic" : "perspective";
      controls = new OrbitControls(rig.cameras[projection]);
      rig.update({ ...request, view: "free", projection }, controls);
      const camera = rig.cameras[projection];
      expect(camera.position.clone().sub(controls.target).normalize().dot(direction)).toBeCloseTo(1, 6);
      expect(camera.zoom).toBe(1);
      expectVisible(camera);
    }
    controls.dispose();
  });

  it("refits orthographic full-window and inline viewports after zoom and pan", () => {
    const rig = new SceneCameraController();
    const camera = rig.cameras.orthographic;
    let controls = new OrbitControls(camera);
    const request: SceneCameraRequest = { containerSize: size, viewport: viewports[0], view: "side", projection: "orthographic" };
    rig.update(request, controls);
    camera.zoom = 3.8;
    controls.target.x = 2;
    camera.updateProjectionMatrix();
    rig.update({ ...request, view: "free" }, controls);
    for (const viewport of [viewports[1], viewports[2], viewports[0]]) {
      controls.dispose();
      controls = new OrbitControls(camera);
      rig.update({ ...request, view: "free", viewport }, controls);
      expect(camera.zoom).toBe(1);
      expect((camera.right - camera.left) / (camera.top - camera.bottom)).toBeCloseTo(viewport.width / viewport.height, 6);
      expectVisible(camera);
    }
    controls.dispose();
  });

  it("returns from a focused carton to the complete orthographic container", () => {
    const rig = new SceneCameraController();
    const controls = new OrbitControls(rig.cameras.perspective);
    const focus = { size: [0.9, 0.08, 0.3] as SceneSize, origin: [1.8, 0.55, 0.25] as SceneSize };
    rig.update({ containerSize: size, viewport: viewports[1], view: "perspective", projection: "perspective", focus }, controls);
    expectVisible(rig.cameras.perspective, focus.size, focus.origin);
    controls.dispose();
    const orthographicControls = new OrbitControls(rig.cameras.orthographic);
    rig.update({ containerSize: size, viewport: viewports[1], view: "perspective", projection: "orthographic" }, orthographicControls);
    expectVisible(rig.cameras.orthographic);
    expect(orthographicControls.target.toArray()).toEqual([0, size[1] / 2, 0]);
    orthographicControls.dispose();
  });

  it("reserves caption rails without changing the physical target or resetting a free orbit",()=>{
    for(const projection of ["perspective","orthographic"] as const){
      const rig=new SceneCameraController(),camera=rig.cameras[projection],controls=new OrbitControls(camera),viewport={width:320,height:245};
      const request:SceneCameraRequest={containerSize:size,viewport,view:"perspective",projection};
      rig.update(request,controls);const distance=camera.position.distanceTo(controls.target),height=rig.cameras.orthographic.top-rig.cameras.orthographic.bottom;
      rig.update({...request,annotationPadding:52},controls);
      expect(controls.target.toArray()).toEqual([0,size[1]/2,0]);
      if(projection==="perspective")expect(camera.position.distanceTo(controls.target)).toBeGreaterThan(distance);
      else expect(rig.cameras.orthographic.top-rig.cameras.orthographic.bottom).toBeGreaterThan(height);
      const pose=camera.position.clone();expect(rig.update({...request,annotationPadding:52,view:"free"},controls)).toBe(false);
      expect(camera.position.distanceTo(pose)).toBeLessThan(1e-8);
      const projected=[-size[0]/2,size[0]/2].flatMap(x=>[0,size[1]].flatMap(y=>[-size[2]/2,size[2]/2].map(z=>new THREE.Vector3(x,y,z).project(camera))));
      const fill=Math.max(...projected.flatMap(p=>[Math.abs(p.x),Math.abs(p.y)]));
      expect(fill).toBeGreaterThan(.3);expect(fill).toBeLessThan(.85);controls.dispose();
    }
  });

  it("clears residual orbit damping and old zoom when selecting a preset", () => {
    const rig = new SceneCameraController();
    const camera = rig.cameras.orthographic;
    const controls = new OrbitControls(camera);
    controls.enableDamping = true;
    const request: SceneCameraRequest = { containerSize: size, viewport: viewports[0], view: "perspective", projection: "orthographic" };
    rig.update(request, controls);
    controls.setAzimuthalAngle(0.9);
    camera.zoom = 4;
    rig.update({ ...request, view: "free" }, controls);
    rig.update({ ...request, view: "door" }, controls);
    const position = camera.position.clone();
    for (let frame = 0; frame < 30; frame++) controls.update();
    expect(camera.position.distanceTo(position)).toBeLessThan(1e-8);
    expect(camera.zoom).toBe(1);
    expectVisible(camera);
    controls.dispose();
  });
});
