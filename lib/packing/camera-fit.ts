import * as THREE from "three";

export type SceneSize = [number, number, number];

export type CameraView = "free" | "perspective" | "top" | "side" | "door" | "bottom" | "rear" | "left";
export type CameraPresetView = Exclude<CameraView, "free">;
export type CameraProjection = "perspective" | "orthographic";

export type CameraFit = {
  target: [number, number, number];
  position: [number, number, number];
  up: [number, number, number];
  distance: number;
  near: number;
  far: number;
  minDistance: number;
  maxDistance: number;
  maximumProjectedFill: number;
  orthographicHalfWidth: number;
  orthographicHalfHeight: number;
};

const VIEW_BASIS: Record<CameraPresetView, { direction: [number, number, number]; up: [number, number, number] }> = {
  perspective: { direction: [0.32, 0.38, 1], up: [0, 1, 0] },
  top: { direction: [0, 1, 0], up: [0, 0, -1] },
  side: { direction: [0, 0, 1], up: [0, 1, 0] },
  door: { direction: [1, 0, 0], up: [0, 1, 0] },
  bottom: { direction: [0, -1, 0], up: [0, 0, 1] },
  rear: { direction: [-1, 0, 0], up: [0, 1, 0] },
  left: { direction: [0, 0, -1], up: [0, 1, 0] },
};

export function calculateCameraViewFit(
  containerSize: SceneSize,
  viewport: { width: number; height: number },
  view: CameraPresetView,
  fov = 34,
): CameraFit {
  const target = new THREE.Vector3(0, containerSize[1] / 2, 0);
  const basis = VIEW_BASIS[view];
  const direction = new THREE.Vector3(...basis.direction).normalize();
  const cameraUp = new THREE.Vector3(...basis.up).normalize();
  const forward = direction.clone().multiplyScalar(-1);
  const right = new THREE.Vector3().crossVectors(forward, cameraUp).normalize();
  const viewUp = new THREE.Vector3().crossVectors(right, forward).normalize();
  const corners: THREE.Vector3[] = [];
  let horizontalExtent = 0;
  let verticalExtent = 0;
  let depthExtent = 0;

  for (const x of [-containerSize[0] / 2, containerSize[0] / 2]) {
    for (const y of [-containerSize[1] / 2, containerSize[1] / 2]) {
      for (const z of [-containerSize[2] / 2, containerSize[2] / 2]) {
        const corner = new THREE.Vector3(x, y, z);
        corners.push(corner);
        horizontalExtent = Math.max(horizontalExtent, Math.abs(corner.dot(right)));
        verticalExtent = Math.max(verticalExtent, Math.abs(corner.dot(viewUp)));
        depthExtent = Math.max(depthExtent, Math.abs(corner.dot(direction)));
      }
    }
  }

  const verticalTangent = Math.tan(THREE.MathUtils.degToRad(fov / 2));
  const aspect = Math.max(0.1, Math.max(1, viewport.width) / Math.max(1, viewport.height));
  const horizontalTangent = verticalTangent * aspect;
  const orthographicHalfHeight = Math.max(verticalExtent, horizontalExtent / aspect) * 1.18;
  const orthographicHalfWidth = orthographicHalfHeight * aspect;
  const fitDistance = Math.max(
    verticalExtent / Math.max(0.01, verticalTangent),
    horizontalExtent / Math.max(0.01, horizontalTangent),
  );
  const distance = fitDistance * 1.18 + depthExtent;
  const position = target.clone().addScaledVector(direction, distance);
  let maximumProjectedFill = 0;

  for (const corner of corners) {
    const depth = Math.max(0.01, distance - corner.dot(direction));
    maximumProjectedFill = Math.max(
      maximumProjectedFill,
      Math.abs(corner.dot(right)) / (depth * horizontalTangent),
      Math.abs(corner.dot(viewUp)) / (depth * verticalTangent),
    );
  }

  return {
    target: [target.x, target.y, target.z],
    position: [position.x, position.y, position.z],
    up: [cameraUp.x, cameraUp.y, cameraUp.z],
    distance,
    near: Math.max(0.03, distance / 120),
    far: Math.max(80, distance * 12),
    minDistance: Math.max(1.8, distance * 0.42),
    maxDistance: Math.max(16, distance * 3.5),
    maximumProjectedFill,
    orthographicHalfWidth,
    orthographicHalfHeight,
  };
}

export function calculateCameraFit(
  containerSize: SceneSize,
  viewport: { width: number; height: number },
  fov = 34,
): CameraFit {
  return calculateCameraViewFit(containerSize, viewport, "perspective", fov);
}

