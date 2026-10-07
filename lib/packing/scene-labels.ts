import * as THREE from "three";

export const LABEL_RENDER_ORDER = 10000;
export function createSceneLabelMaterial(map: THREE.Texture) {
  return new THREE.MeshBasicMaterial({ map, transparent: true, depthTest: false, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
}
export type LabelRect = { x: number; y: number; width: number; height: number };
export function labelsOverlap(a: LabelRect, b: LabelRect, gap = 4) {
  return a.x < b.x + b.width + gap && a.x + a.width + gap > b.x && a.y < b.y + b.height + gap && a.y + a.height + gap > b.y;
}
/** Keep annotations inside the viewport, then find the nearest unoccupied spot. */
export function layoutSceneLabel(desired: LabelRect, viewport: { width: number; height: number }, occupied: LabelRect[]): LabelRect {
  const margin = 8;
  const width = Math.min(desired.width, Math.max(1, viewport.width - margin * 2));
  const height = Math.min(desired.height, Math.max(1, viewport.height - margin * 2));
  const clamp = (x: number, y: number): LabelRect => ({ x: Math.max(margin, Math.min(viewport.width - margin - width, x)), y: Math.max(margin, Math.min(viewport.height - margin - height, y)), width, height });
  const first = clamp(desired.x, desired.y);
  if (!occupied.some(r => labelsOverlap(first, r))) return first;
  const candidates: LabelRect[] = [];
  for (let row = -8; row <= 8; row++) for (let col = -2; col <= 2; col++) candidates.push(clamp(first.x + col * (width + 6), first.y + row * (height + 6)));
  candidates.sort((a, b) => (a.x - first.x) ** 2 + (a.y - first.y) ** 2 - (b.x - first.x) ** 2 - (b.y - first.y) ** 2);
  return candidates.find(r => !occupied.some(o => labelsOverlap(r, o))) ?? first;
}

const frames = new WeakMap<THREE.Camera, { time: number; occupied: LabelRect[] }>();
export function sceneLabelFrame(camera: THREE.Camera, time: number) {
  let frame = frames.get(camera);
  if (!frame || frame.time !== time) { frame = { time, occupied: [] }; frames.set(camera, frame); }
  return frame.occupied;
}

/** Place a screen-facing label at a fixed pixel size, for either camera projection. */
export function sceneLabelPose(camera: THREE.Camera, anchor: THREE.Vector3, viewport: { width: number; height: number }, rect: LabelRect, pixelHeight: number) {
  const forward = camera.getWorldDirection(new THREE.Vector3());
  const position = camera.getWorldPosition(new THREE.Vector3());
  const depth = Math.max(camera instanceof THREE.PerspectiveCamera ? camera.near * 2 : .1, anchor.clone().sub(position).dot(forward));
  const halfHeight = camera instanceof THREE.OrthographicCamera ? (camera.top - camera.bottom) / (2 * camera.zoom) : camera instanceof THREE.PerspectiveCamera ? depth * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) / camera.zoom : 1;
  const halfWidth = halfHeight * viewport.width / viewport.height;
  const x = ((rect.x + rect.width / 2) / viewport.width * 2 - 1) * halfWidth;
  const y = (1 - (rect.y + rect.height / 2) / viewport.height * 2) * halfHeight;
  position.addScaledVector(forward, depth).addScaledVector(new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion), x).addScaledVector(new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion), y);
  return { position, scale: halfHeight * 2 / viewport.height * Math.min(pixelHeight, rect.height) };
}
