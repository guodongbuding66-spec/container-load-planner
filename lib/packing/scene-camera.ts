import * as THREE from "three";
import {
  annotationFitScale,
  calculateCameraDirectionFit,
  calculateCameraViewFit,
  type CameraFit,
  type CameraProjection,
  type CameraView,
  type SceneSize,
} from "./camera-fit";

type SceneCamera = THREE.PerspectiveCamera | THREE.OrthographicCamera;
type CameraControls = {
  target: THREE.Vector3;
  enableDamping: boolean;
  minDistance: number;
  maxDistance: number;
  update: () => unknown;
};
export type SceneCameraRequest = {
  containerSize: SceneSize;
  sceneBounds?: { size: SceneSize; origin: SceneSize };
  viewport: { width: number; height: number };
  view: CameraView;
  projection: CameraProjection;
  focus?: { size: SceneSize; origin: SceneSize };
  annotationPadding?: number;
};

/** One owner for camera pose and projection; OrbitControls owns subsequent user motion. */
export class SceneCameraController {
  // Fiber's automatic orthographic resize uses pixels. Our frustum uses model units.
  readonly cameras = {
    perspective: Object.assign(new THREE.PerspectiveCamera(34), { manual: true }),
    orthographic: Object.assign(new THREE.OrthographicCamera(), { manual: true }),
  };
  private previous?: { key: string; boundsKey: string; camera: SceneCamera; controls: CameraControls };

  update(request: SceneCameraRequest, controls: CameraControls): boolean {
    const { containerSize, sceneBounds, viewport, view, projection, focus, annotationPadding=0 } = request;
    const boundsKey = JSON.stringify([containerSize, sceneBounds, viewport.width, viewport.height, projection, focus,annotationPadding]);
    const key = JSON.stringify([boundsKey, view]);
    const previous = this.previous;
    const camera = this.cameras[projection];
    const next = { key, boundsKey, camera, controls };
    if (previous?.key === key && previous.controls === controls) {
      this.previous = next;
      return false;
    }
    // A start event only marks the view as free. It must not reset pose, pan or zoom.
    if (view === "free" && previous?.boundsKey === boundsKey && previous.controls === controls) {
      this.previous = next;
      return false;
    }

    const envelope = focus ?? sceneBounds;
    const originalSize = envelope?.size ?? containerSize;
    const factor=annotationFitScale(viewport,annotationPadding);
    const size=originalSize.map(n=>n*factor) as SceneSize;
    let fit: CameraFit;
    if (view === "free" && previous) {
      const direction = previous.camera.position.clone().sub(previous.controls.target).normalize();
      fit = calculateCameraDirectionFit(size, viewport, direction.toArray() as SceneSize, previous.camera.up.toArray() as SceneSize);
    } else {
      fit = calculateCameraViewFit(size, viewport, view === "free" ? "perspective" : view);
    }
    if (envelope||factor!==1) {
      const origin=[...(envelope?.origin??[0,0,0])] as SceneSize;origin[1]+=(originalSize[1]-size[1])/2;
      fit = {
        ...fit,
        position: fit.position.map((n, i) => n + origin[i]) as SceneSize,
        target: fit.target.map((n, i) => n + origin[i]) as SceneSize,
      };
    }

    // Drain pending damping before applying a preset so it cannot move the new pose.
    const damping = controls.enableDamping;
    controls.enableDamping = false;
    controls.update();
    const sceneFit = calculateCameraViewFit(sceneBounds?.size ?? containerSize, viewport, "perspective");
    camera.near = Math.min(sceneFit.near, fit.near);
    camera.far = Math.max(sceneFit.far, fit.far);
    camera.zoom = 1;
    if (camera instanceof THREE.OrthographicCamera) {
      camera.left = -fit.orthographicHalfWidth;
      camera.right = fit.orthographicHalfWidth;
      camera.top = fit.orthographicHalfHeight;
      camera.bottom = -fit.orthographicHalfHeight;
    } else {
      camera.aspect = Math.max(1, viewport.width) / Math.max(1, viewport.height);
    }
    camera.position.fromArray(fit.position);
    camera.up.fromArray(fit.up);
    controls.target.fromArray(fit.target);
    controls.minDistance = focus ? Math.max(0.12, fit.distance * 0.25) : Math.min(sceneFit.minDistance, fit.minDistance);
    controls.maxDistance = Math.max(sceneFit.maxDistance, fit.maxDistance);
    camera.lookAt(controls.target);
    camera.updateProjectionMatrix();
    controls.update();
    controls.enableDamping = damping;
    camera.updateMatrixWorld(true);
    this.previous = next;
    return true;
  }
}
