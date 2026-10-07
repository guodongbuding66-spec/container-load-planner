import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { createSceneLabelMaterial, LABEL_RENDER_ORDER, labelsOverlap, layoutSceneLabel, sceneLabelFrame, sceneLabelPose, type LabelRect } from "./scene-labels";

describe("always visible screen-facing scene annotations", () => {
  it("draws labels after geometry without depth testing or depth writes", () => {
    const texture=new THREE.Texture(),material=createSceneLabelMaterial(texture);
    expect(material.depthTest).toBe(false);expect(material.depthWrite).toBe(false);
    expect(material.transparent).toBe(true);expect(material.toneMapped).toBe(false);
    expect(material.side).toBe(THREE.DoubleSide);expect(LABEL_RENDER_ORDER).toBeGreaterThan(10);
    material.dispose();texture.dispose();
  });
  it("keeps overlapping dimensions readable and inside small/large viewports", () => {
    for (const viewport of [{width:320,height:245},{width:1920,height:800}]) {
      const occupied:LabelRect[]=[];
      for (let n=0;n<12;n++) {
        const r=layoutSceneLabel({x:-40,y:viewport.height-10,width:110,height:22},viewport,occupied);
        expect(r.x).toBeGreaterThanOrEqual(8);expect(r.y).toBeGreaterThanOrEqual(8);
        expect(r.x+r.width).toBeLessThanOrEqual(viewport.width-8);expect(r.y+r.height).toBeLessThanOrEqual(viewport.height-8);
        expect(occupied.some(o=>labelsOverlap(r,o))).toBe(false);occupied.push(r);
      }
    }
  });
  it("shares collision positions during a frame and resets on the next frame per camera", () => {
    const a=new THREE.PerspectiveCamera(),b=new THREE.PerspectiveCamera();
    const r={x:10,y:10,width:70,height:22};sceneLabelFrame(a,1).push(r);
    expect(sceneLabelFrame(a,1)).toEqual([r]);expect(sceneLabelFrame(b,1)).toEqual([]);expect(sceneLabelFrame(a,2)).toEqual([]);
  });
  it("maintains exact pixel position and height after rotation and zoom in either projection", () => {
    for (const viewport of [{width:320,height:245},{width:1920,height:800}]) for (const ortho of [true,false]) for (const direction of [[1,.5,1],[-1,.3,-1],[0,1,.001],[.001,0,-1]]) for (const zoom of [.6,1,3]) {
      const aspect=viewport.width/viewport.height;
      const camera=ortho?new THREE.OrthographicCamera(-2*aspect,2*aspect,2,-2,.01,100):new THREE.PerspectiveCamera(38,aspect,.01,100);
      camera.position.fromArray(direction).normalize().multiplyScalar(8);camera.lookAt(0,0,0);camera.zoom=zoom;camera.updateProjectionMatrix();camera.updateMatrixWorld(true);
      const anchor=new THREE.Vector3(1,.5,-.7),rect={x:12,y:34,width:100,height:22};
      const pose=sceneLabelPose(camera,anchor,viewport,rect,22),projected=pose.position.clone().project(camera);
      expect((projected.x+1)*viewport.width/2).toBeCloseTo(rect.x+rect.width/2,6);
      expect((1-projected.y)*viewport.height/2).toBeCloseTo(rect.y+rect.height/2,6);
      const up=new THREE.Vector3(0,1,0).applyQuaternion(camera.quaternion).multiplyScalar(pose.scale/2);
      const top=pose.position.clone().add(up).project(camera),bottom=pose.position.clone().sub(up).project(camera);
      expect((top.y-bottom.y)*viewport.height/2).toBeCloseTo(22,6);
    }
  });
});
