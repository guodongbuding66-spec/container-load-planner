import * as THREE from "three";
import {
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
  viewport: { width: number; height: number };
  view: CameraView;
  projection: CameraProjection;
  focus?: { size: SceneSize; origin: SceneSize };
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
    const { containerSize, viewport, view, projection, focus } = request;
    const boundsKey = JSON.stringify([containerSize, viewport.width, viewport.height, projection, focus]);
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

    const size = focus?.size ?? containerSize;
    let fit: CameraFit;
    if (view === "free" && previous) {
      const direction = previous.camera.position.clone().sub(previous.controls.target).normalize();
      fit = calculateCameraDirectionFit(size, viewport, direction.toArray() as SceneSize, previous.camera.up.toArray() as SceneSize);
    } else {
      fit = calculateCameraViewFit(size, viewport, view === "free" ? "perspective" : view);
    }
    if (focus) {
      fit = {
        ...fit,
        position: fit.position.map((n, i) => n + focus.origin[i]) as SceneSize,
        target: fit.target.map((n, i) => n + focus.origin[i]) as SceneSize,
      };
    }

    // Drain pending damping before applying a preset so it cannot move the new pose.
    const damping = controls.enableDamping;
    controls.enableDamping = false;
    controls.update();
    const sceneFit = calculateCameraViewFit(containerSize, viewport, "perspective");
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
