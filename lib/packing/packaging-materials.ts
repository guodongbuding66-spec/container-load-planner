import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import type { PackagingSpec } from "./packaging";
import type { SceneSize } from "./camera-fit";

export type PackagingMaterial = PackagingSpec["material"];
type Surface = "face" | "end";
type Axis = 0 | 1 | 2;
const AXES: Axis[] = [0, 1, 2];
const TAU = 2 * Math.PI;
const TILE_WIDTH = 512;
const TILE_HEIGHT = 128;

export function packagingFaceUV(size: SceneSize, normal: Axis, material: PackagingMaterial) {
  const ranked = [...AXES].sort((a, b) => size[b] - size[a]);
  const [long, middle, thin] = ranked;
  const faceAxes = AXES.filter(axis => axis !== normal);
  if (material === "plywood" && normal !== thin) {
    return { u: faceAxes.find(axis => axis !== thin)!, v: thin, tileU: 560, tileV: 24, surface: "end" as const };
  }
  if (material === "wood" && normal === long) {
    return { u: middle, v: thin, tileU: 215, tileV: 215, surface: "end" as const };
  }
  const [u, v] = faceAxes.sort((a, b) => size[b] - size[a]);
  const [tileU, tileV] = material === "wood" || material === "plywood" ? [760, 176] : [160, 160];
  return { u, v, tileU, tileV, surface: "face" as const };
}

/** Assign physical UVs to each face. Changing a dimension exposes more texture instead of stretching it. */
export function createPackagingGeometry(size: SceneSize, material: PackagingMaterial) {
  const m = Math.min(...size);
  const g = m >= 5 ? new RoundedBoxGeometry(...size, 1, Math.min(1.7, m * .09)) : new THREE.BoxGeometry(...size);
  const positions = g.getAttribute("position");
  const uv = g.getAttribute("uv");
  const indices = g.getIndex();
  const surfaceIndices: [number[], number[]] = [[], []];
  g.groups.forEach((group, face) => {
    const normal = Math.floor(face / 2) as Axis;
    const { u, v, tileU, tileV, surface } = packagingFaceUV(size, normal, material);
    const seed = size[0] * .0069 + size[1] * .0037 + size[2] * .0143;
    const batch = surfaceIndices[surface === "face" ? 0 : 1];
    for (let n = group.start; n < group.start + group.count; n++) {
      const i = indices ? indices.getX(n) : n;
      batch.push(i);
      uv.setXY(i, positions.getComponent(i, u) / tileU + seed, positions.getComponent(i, v) / tileV + seed * .63);
    }
  });
  g.setIndex([...surfaceIndices[0], ...surfaceIndices[1]]);
  g.clearGroups();
  g.addGroup(0, surfaceIndices[0].length, 0);
  if (surfaceIndices[1].length) g.addGroup(surfaceIndices[0].length, surfaceIndices[1].length, 1);
  uv.needsUpdate = true;
  return g;
}

function hash(x: number, y: number) {
  const n = Math.imul(x + 1031, 374761393) + Math.imul(y + 8191, 668265263);
  return ((Math.imul(n ^ (n >>> 13), 1274126177) ^ (n >>> 16)) >>> 0) / 4294967295;
}
function tileNoise(u: number, v: number, columns: number, rows: number) {
  const x = u * columns, y = v * rows;
  const ix = Math.floor(x), iy = Math.floor(y);
  const a = x - ix, b = y - iy;
  const s = a * a * (3 - 2 * a), t = b * b * (3 - 2 * b);
  const wrap = (n: number, count: number) => (n % count + count) % count;
  const sample = (i: number, j: number) => hash(wrap(i, columns), wrap(j, rows));
  return (sample(ix, iy) * (1 - s) + sample(ix + 1, iy) * s) * (1 - t)
    + (sample(ix, iy + 1) * (1 - s) + sample(ix + 1, iy + 1) * s) * t;
}
function woodFiber(u: number, v: number, veneer: boolean) {
  const drift = tileNoise(u, v, 4, 5) * .034 + Math.sin(TAU * u) * .011;
  const warp = v + drift + tileNoise(u, v, 6, 7) * (veneer ? .022 : .012);
  const growth = tileNoise(u, warp, veneer ? 13 : 7, veneer ? 18 : 27);
  const fiber = tileNoise(u, warp, 35, 81);
  const pores = Math.pow(tileNoise(u, warp, 66, 101), 8);
  const earlywood = Math.pow((1 + Math.sin(TAU * (warp * (veneer ? 11 : 21) + growth * .24))) * .5, 7);
  return (growth - .5) * .21 + (fiber - .5) * .16 - pores * .17 - earlywood * .07;
}

function surfaceHeight(material: PackagingMaterial, surface: Surface, u: number, v: number) {
  if (material === "plywood" && surface === "end") {
    const veneer = Math.floor(v * 8);
    const seam = Math.pow(1 - (v * 8 % 1), 21);
    return (veneer % 2 ? -.18 : .04) - seam * .095 + woodFiber(u, v, true) * .28;
  }
  if (material === "wood" && surface === "end") {
    const p = Math.sin(TAU * (u - .12)) * .30;
    const q = Math.sin(TAU * (v + .18)) * .53;
    const radius = Math.hypot(p, q) + tileNoise(u, v, 5, 5) * .040;
    const ring = Math.pow((1 + Math.sin(TAU * radius * 19)) * .5, 6);
    return -.065 - ring * .13 + (tileNoise(u, v, 53, 49) - .5) * .12;
  }
  if (material === "wood" || material === "plywood") return woodFiber(u, v, material === "plywood");
  if (material === "plastic") {
    const grip = Math.pow((1 + Math.cos(TAU * u * 25) * Math.cos(TAU * v * 25)) * .5, 6);
    return grip * .12 + (tileNoise(u, v, 108, 64) - .5) * .10;
  }
  return (tileNoise(u, v, 23, 21) - .5) * .12 + (tileNoise(u, v, 62, 31) - .5) * .09;
}

type PixelMaps = [Uint8Array<ArrayBuffer>, Uint8Array<ArrayBuffer>, Uint8Array<ArrayBuffer>];
const pixelsBySurface = new Map<string, PixelMaps>();
function makeSurfaceMaps(material: PackagingMaterial, surface: Surface) {
  const key = material + surface;
  let pixels = pixelsBySurface.get(key);
  if (!pixels) {
    const [width, height] = [TILE_WIDTH, TILE_HEIGHT];
    const fields = new Float32Array(width * height);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      fields[y * width + x] = surfaceHeight(material, surface, x / width, y / height);
    }
    const count = width * height * 4;
    const color = new Uint8Array(count), normal = new Uint8Array(count), roughness = new Uint8Array(count);
    const value = (x: number, y: number) => fields[((y + height) % height) * width + (x + width) % width];
    const byte = (n: number) => Math.round(Math.max(0, Math.min(1, n)) * 255);
    const wood = material === "wood" || material === "plywood";
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4, v = value(x, y);
      const dx = (value(x - 1, y) - value(x + 1, y)) * .85;
      const dy = (value(x, y - 1) - value(x, y + 1)) * .85;
      const len = Math.hypot(dx, dy, 1);
      const tone = (wood ? .93 : .87) + v;
      color.set([byte(tone), byte(tone - (wood ? .033 : 0)), byte(tone - (wood ? .082 : 0)), 255], i);
      normal.set([byte(.5 + dx / len * .5), byte(.5 + dy / len * .5), byte(.5 + .5 / len), 255], i);
      const rough = byte((wood ? .79 : material === "plastic" ? .54 : .4) - v * .44);
      roughness.set([rough, rough, rough, 255], i);
    }
    pixels = [color, normal, roughness];
    pixelsBySurface.set(key, pixels);
  }
  return pixels.map((data, i) => {
    const texture = new THREE.DataTexture(data, TILE_WIDTH, TILE_HEIGHT);
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.colorSpace = i === 0 ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = true;
    texture.anisotropy = 4;
    texture.needsUpdate = true;
    return texture;
  });
}

export function createPackagingFinish(material: PackagingMaterial, opacity: number) {
  const surfaces: Surface[] = material === "wood" || material === "plywood" ? ["face", "end"] : ["face"];
  const textures: THREE.DataTexture[] = [];
  const materials = surfaces.map(surface => {
    const [map, normalMap, roughnessMap] = makeSurfaceMaps(material, surface);
    textures.push(map, normalMap, roughnessMap);
    return new THREE.MeshStandardMaterial({
      map, normalMap, roughnessMap, roughness: 1, metalness: material === "steel" ? .67 : 0,
      normalScale: new THREE.Vector2(.64, .64), opacity, transparent: opacity < 1, depthWrite: opacity === 1,
    });
  });
  return { materials, dispose: () => {
    materials.forEach(item => item.dispose());
    textures.forEach(item => item.dispose());
  } };
}
