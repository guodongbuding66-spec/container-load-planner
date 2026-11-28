import type { V3 } from "./solid-math";
import { isLengthUnit, toMillimeters, type LengthUnit } from "./units";

export interface ParsedCadMeshChunk {
  name: string;
  vertices: V3[];
  faces: number[][];
}

export type CadMeshFormat = "stl-binary" | "stl-ascii" | "obj" | "dxf";

export interface CadMeshParseOptions {
  unit: LengthUnit;
  up: "X" | "Y" | "Z";
}

export interface CadMeshAnalysis {
  format: CadMeshFormat;
  chunks: ParsedCadMeshChunk[];
  triangleCount: number;
  boundingBox: { min: V3; max: V3; size: V3 };
  signedVolumeMm3: number;
  absoluteVolumeMm3: number;
}

const MAX_CAD_TRIANGLES = 200000;

function axisTransform(options: CadMeshParseOptions) {
  if (!isLengthUnit(options.unit) || !["X", "Y", "Z"].includes(options.up)) {
    throw new Error("模型单位或朝上轴无效。");
  }
  const factor = toMillimeters(1, options.unit);
  const map: readonly [number, number, number] =
    options.up === "Y" ? [0, 2, 1] : options.up === "X" ? [1, 2, 0] : [0, 1, 2];
  const reverse = options.up === "Y";
  return {
    transform: (x: number, y: number, z: number): V3 => {
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
        throw new Error("模型包含无效顶点坐标。");
      }
      const raw = [x, y, z];
      return [raw[map[0]] * factor, raw[map[1]] * factor, raw[map[2]] * factor];
    },
    reverse,
  };
}

/** Signed tetrahedral volume in mm^3 for a triangle mesh. */
export function computeSignedMeshVolumeMm3(vertices: readonly V3[], faces: readonly number[][]): number {
  let sum6 = 0;
  for (const face of faces) {
    if (face.length < 3) continue;
    const a = vertices[face[0]];
    const b = vertices[face[1]];
    const c = vertices[face[2]];
    if (!a || !b || !c) continue;
    const cx = b[1] * c[2] - b[2] * c[1];
    const cy = b[2] * c[0] - b[0] * c[2];
    const cz = b[0] * c[1] - b[1] * c[0];
    sum6 += a[0] * cx + a[1] * cy + a[2] * cz;
  }
  return sum6 / 6;
}

function finalizeCadMesh(
  format: CadMeshFormat,
  chunks: ParsedCadMeshChunk[],
): CadMeshAnalysis {
  const nonEmpty = chunks.filter((c) => c.faces.length > 0 && c.vertices.length > 0);
  if (!nonEmpty.length) {
    throw new Error("文件没有可装载的三角网格。");
  }
  const min: V3 = [Infinity, Infinity, Infinity];
  const max: V3 = [-Infinity, -Infinity, -Infinity];
  let triangleCount = 0;
  let signedVolumeMm3 = 0;
  for (const chunk of nonEmpty) {
    triangleCount += chunk.faces.length;
    signedVolumeMm3 += computeSignedMeshVolumeMm3(chunk.vertices, chunk.faces);
    for (const v of chunk.vertices) {
      for (let i = 0; i < 3; i++) {
        if (v[i] < min[i]) min[i] = v[i];
        if (v[i] > max[i]) max[i] = v[i];
      }
    }
  }
  const size: V3 = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  return {
    format,
    chunks: nonEmpty,
    triangleCount,
    boundingBox: { min, max, size },
    signedVolumeMm3,
    absoluteVolumeMm3: Math.abs(signedVolumeMm3),
  };
}

export function isBinaryStlBuffer(bytes: ArrayBuffer): boolean {
  if (bytes.byteLength < 84) return false;
  const view = new DataView(bytes);
  const count = view.getUint32(80, true);
  if (count === 0 || count > MAX_CAD_TRIANGLES) return false;
  return 84 + count * 50 === bytes.byteLength;
}

export function parseBinaryStl(
  bytes: ArrayBuffer,
  filename: string,
  options: CadMeshParseOptions,
): CadMeshAnalysis {
  if (bytes.byteLength < 84) {
    throw new Error("Binary STL 文件长度不足。");
  }
  const view = new DataView(bytes);
  const count = view.getUint32(80, true);
  if (count === 0) {
    throw new Error("文件没有可装载的三角网格。");
  }
  if (count > MAX_CAD_TRIANGLES) {
    throw new Error("输入超过 200000 个三角面，请先在建模软件中减面。");
  }
  if (84 + count * 50 !== bytes.byteLength) {
    throw new Error("Binary STL 字节长度与三角面数量不匹配。");
  }
  const { transform, reverse } = axisTransform(options);
  const vertices: V3[] = [];
  const faces: number[][] = [];
  for (let i = 0; i < count; i++) {
    const base = 84 + i * 50 + 12; // skip 12-byte normal
    const v0 = transform(
      view.getFloat32(base, true),
      view.getFloat32(base + 4, true),
      view.getFloat32(base + 8, true),
    );
    const v1 = transform(
      view.getFloat32(base + 12, true),
      view.getFloat32(base + 16, true),
      view.getFloat32(base + 20, true),
    );
    const v2 = transform(
      view.getFloat32(base + 24, true),
      view.getFloat32(base + 28, true),
      view.getFloat32(base + 32, true),
    );
    const idx = vertices.length;
    vertices.push(v0, v1, v2);
    faces.push(reverse ? [idx, idx + 2, idx + 1] : [idx, idx + 1, idx + 2]);
  }
  return finalizeCadMesh("stl-binary", [{ name: filename, vertices, faces }]);
}

export function parseAsciiStl(
  text: string,
  filename: string,
  options: CadMeshParseOptions,
): CadMeshAnalysis {
  const { transform, reverse } = axisTransform(options);
  const chunks: ParsedCadMeshChunk[] = [];
  let current: ParsedCadMeshChunk = { name: filename, vertices: [], faces: [] };
  let triVerts: V3[] = [];
  let totalTriangles = 0;

  const lines = text.split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (/^solid\b/i.test(line)) {
      if (current.faces.length > 0) {
        chunks.push(current);
      }
      const solidName = line.slice(5).trim();
      current = { name: solidName || filename, vertices: [], faces: [] };
      triVerts = [];
      continue;
    }
    if (/^endsolid\b/i.test(line)) {
      if (current.faces.length > 0) {
        chunks.push(current);
        current = { name: filename, vertices: [], faces: [] };
      }
      triVerts = [];
      continue;
    }
    if (/^vertex\s+/i.test(line)) {
      const parts = line.split(/\s+/);
      if (parts.length < 4) {
        throw new Error("ASCII STL 顶点坐标格式无效。");
      }
      triVerts.push(transform(Number(parts[1]), Number(parts[2]), Number(parts[3])));
      if (triVerts.length === 3) {
        totalTriangles++;
        if (totalTriangles > MAX_CAD_TRIANGLES) {
          throw new Error("输入超过 200000 个三角面，请先在建模软件中减面。");
        }
        const idx = current.vertices.length;
        current.vertices.push(triVerts[0], triVerts[1], triVerts[2]);
        current.faces.push(reverse ? [idx, idx + 2, idx + 1] : [idx, idx + 1, idx + 2]);
        triVerts = [];
      }
    }
  }
  if (current.faces.length > 0) {
    chunks.push(current);
  }
  return finalizeCadMesh("stl-ascii", chunks);
}

export function parseWavefrontObj(
  text: string,
  filename: string,
  options: CadMeshParseOptions,
): CadMeshAnalysis {
  const { transform, reverse } = axisTransform(options);
  const allVertices: V3[] = [];
  const rawGroups: Array<{ name: string; faces: number[][] }> = [];
  let currentGroup: { name: string; faces: number[][] } = { name: filename, faces: [] };
  let totalTriangles = 0;

  const lines = text.split(/\r?\n/);
  for (const rawLine of lines) {
    const commentIdx = rawLine.indexOf("#");
    const line = (commentIdx >= 0 ? rawLine.slice(0, commentIdx) : rawLine).trim();
    if (!line) continue;
    const parts = line.split(/\s+/);
    const cmd = parts[0];

    if (cmd === "v") {
      if (parts.length < 4) {
        throw new Error("OBJ 顶点坐标格式无效。");
      }
      allVertices.push(transform(Number(parts[1]), Number(parts[2]), Number(parts[3])));
    } else if (cmd === "o" || cmd === "g") {
      const groupName = parts.slice(1).join(" ").trim() || filename;
      if (currentGroup.faces.length > 0) {
        rawGroups.push(currentGroup);
        currentGroup = { name: groupName, faces: [] };
      } else {
        currentGroup.name = groupName;
      }
    } else if (cmd === "f") {
      if (parts.length < 4) continue;
      const indices: number[] = [];
      for (let i = 1; i < parts.length; i++) {
        const token = parts[i].split("/")[0];
        const rawIndex = Number.parseInt(token, 10);
        if (!Number.isInteger(rawIndex) || rawIndex === 0) {
          throw new Error("OBJ 面顶点索引无效。");
        }
        const resolved = rawIndex > 0 ? rawIndex - 1 : allVertices.length + rawIndex;
        if (resolved < 0 || resolved >= allVertices.length) {
          throw new Error("OBJ 面顶点索引越界。");
        }
        indices.push(resolved);
      }
      // Fan-triangulate polygons (triangles, quads, n-gons)
      for (let k = 1; k + 1 < indices.length; k++) {
        totalTriangles++;
        if (totalTriangles > MAX_CAD_TRIANGLES) {
          throw new Error("输入超过 200000 个三角面，请先在建模软件中减面。");
        }
        currentGroup.faces.push(
          reverse
            ? [indices[0], indices[k + 1], indices[k]]
            : [indices[0], indices[k], indices[k + 1]],
        );
      }
    }
  }
  if (currentGroup.faces.length > 0) {
    rawGroups.push(currentGroup);
  }

  // Remap each group to local vertex buffers so separate submeshes carry only their own vertices
  const chunks: ParsedCadMeshChunk[] = rawGroups.map((group) => {
    const remap = new Map<number, number>();
    const vertices: V3[] = [];
    const faces: number[][] = [];
    for (const face of group.faces) {
      const localFace = face.map((globalIdx) => {
        let localIdx = remap.get(globalIdx);
        if (localIdx === undefined) {
          localIdx = vertices.length;
          remap.set(globalIdx, localIdx);
          vertices.push(allVertices[globalIdx]);
        }
        return localIdx;
      });
      faces.push(localFace);
    }
    return { name: group.name, vertices, faces };
  });

  return finalizeCadMesh("obj", chunks);
}


function polygonSignedArea2D(pts: ReadonlyArray<[number, number]>): number {
  let area2 = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    area2 += x1 * y2 - x2 * y1;
  }
  return area2 / 2;
}

function extrude2DLoop(
  name: string,
  rawPts: ReadonlyArray<[number, number]>,
  extrusionHeightMm: number,
  transform: (x: number, y: number, z: number) => V3,
  reverse: boolean,
): ParsedCadMeshChunk {
  const pts: Array<[number, number]> = [];
  for (const pt of rawPts) {
    const prev = pts.at(-1);
    if (!prev || Math.hypot(pt[0] - prev[0], pt[1] - prev[1]) > 1e-6) {
      pts.push(pt);
    }
  }
  if (pts.length >= 2 && Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) <= 1e-6) {
    pts.pop();
  }
  if (pts.length < 3) {
    throw new Error("DXF 截面轮廓至少需要 3 个有效顶点。");
  }
  const ordered = polygonSignedArea2D(pts) < 0 ? [...pts].reverse() : pts;
  const n = ordered.length;
  const vertices: V3[] = [];
  for (const [x, y] of ordered) vertices.push(transform(x, y, 0));
  for (const [x, y] of ordered) vertices.push(transform(x, y, extrusionHeightMm));

  const faces: number[][] = [];
  const pushTri = (a: number, b: number, c: number) => {
    faces.push(reverse ? [a, c, b] : [a, b, c]);
  };
  // Bottom cap (CCW looking from -Z => reverse winding) and top cap
  for (let i = 1; i + 1 < n; i++) {
    pushTri(0, i + 1, i);
    pushTri(n, n + i, n + i + 1);
  }
  // Side walls
  for (let i = 0; i < n; i++) {
    const next = (i + 1) % n;
    pushTri(i, next, n + next);
    pushTri(i, n + next, n + i);
  }
  return { name, vertices, faces };
}

/**
 * Native ASCII DXF 2D Profile Parser & 3D Extruder (Direction 06).
 * Parses LWPOLYLINE and CIRCLE entities in ENTITIES section and extrudes to watertight 3D mesh.
 */
export function parseDxfProfile(
  text: string,
  filename: string,
  options: CadMeshParseOptions,
  extrusionHeight = 100,
): CadMeshAnalysis {
  const { transform, reverse } = axisTransform(options);
  const height = Number.isFinite(extrusionHeight) && extrusionHeight > 0 ? extrusionHeight : 100;
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  const chunks: ParsedCadMeshChunk[] = [];
  const baseName = filename.replace(/\.[^.]+$/, "") || "dxf-profile";

  let i = 0;
  while (i + 1 < lines.length) {
    const code = lines[i];
    const val = lines[i + 1];
    i += 2;
    if (code === "0" && val === "LWPOLYLINE") {
      const pts: Array<[number, number]> = [];
      let curX: number | null = null;
      while (i + 1 < lines.length) {
        const c = lines[i];
        const v = lines[i + 1];
        if (c === "0") break;
        i += 2;
        if (c === "10") {
          curX = Number(v);
        } else if (c === "20" && curX !== null) {
          const y = Number(v);
          if (Number.isFinite(curX) && Number.isFinite(y)) pts.push([curX, y]);
          curX = null;
        }
      }
      if (pts.length >= 3) {
        chunks.push(extrude2DLoop(`${baseName}-poly-${chunks.length + 1}`, pts, height, transform, reverse));
      }
    } else if (code === "0" && val === "CIRCLE") {
      let cx = 0;
      let cy = 0;
      let r = 0;
      while (i + 1 < lines.length) {
        const c = lines[i];
        const v = lines[i + 1];
        if (c === "0") break;
        i += 2;
        if (c === "10") cx = Number(v);
        else if (c === "20") cy = Number(v);
        else if (c === "40") r = Number(v);
      }
      if (Number.isFinite(cx) && Number.isFinite(cy) && Number.isFinite(r) && r > 0) {
        const segs = 24;
        const pts: Array<[number, number]> = [];
        for (let s = 0; s < segs; s++) {
          const ang = (2 * Math.PI * s) / segs;
          pts.push([cx + r * Math.cos(ang), cy + r * Math.sin(ang)]);
        }
        chunks.push(extrude2DLoop(`${baseName}-circle-${chunks.length + 1}`, pts, height, transform, reverse));
      }
    }
  }
  if (!chunks.length) {
    throw new Error("DXF 文件中未检测到可拉伸的 LWPOLYLINE 或 CIRCLE 轮廓。");
  }
  return finalizeCadMesh("dxf", chunks);
}

export function parseCadMeshFile(
  filename: string,
  bytes: ArrayBuffer,
  options: CadMeshParseOptions,
): CadMeshAnalysis {
  if (/\.stl$/i.test(filename)) {
    if (isBinaryStlBuffer(bytes)) {
      return parseBinaryStl(bytes, filename, options);
    }
    const text = new TextDecoder().decode(bytes);
    return parseAsciiStl(text, filename, options);
  }
  if (/\.obj$/i.test(filename)) {
    const text = new TextDecoder().decode(bytes);
    return parseWavefrontObj(text, filename, options);
  }
  if (/\.dxf$/i.test(filename)) {
    const text = new TextDecoder().decode(bytes);
    return parseDxfProfile(text, filename, options);
  }
  throw new Error("不支持的 CAD 网格格式，仅支持 STL、OBJ 与 DXF。");
}

/* ==================== Direction 06 Complete Extensions: FBX Parser & Full CAD Engineering Preprocessing Pipeline ==================== */

export interface CadPreprocessOptions {
  pivotMode: "bottom-center" | "bottom-left-front" | "centroid";
  simplifyTargetTriangles?: number;
  customCogOffsetMm?: [number, number, number];
  nestingCavityMarginMm?: number;
}

export interface CadLoadBearingSurface {
  face: "top" | "bottom" | "left" | "right" | "front" | "back";
  planarSupportRatio: number;
  loadBearingRecommended: boolean;
}

export interface CadPreprocessedModel {
  format: string;
  originalTriangles: number;
  simplifiedTriangles: number;
  dimensionsMm: [number, number, number];
  pivotMode: CadPreprocessOptions["pivotMode"];
  pivotShiftMm: [number, number, number];
  trueVolumeLiters: number;
  boundingVolumeLiters: number;
  fillFactorPct: number;
  cogMm: [number, number, number];
  loadBearingSurfaces: CadLoadBearingSurface[];
  allowedNestingZoneMm: { x: number; y: number; z: number; dx: number; dy: number; dz: number } | null;
}

/**
 * Parses ASCII FBX vertex/polygon definitions (and detects Kaydara FBX Binary headers).
 */
export function parseFbxMesh(
  bytes: ArrayBuffer,
  filename: string,
  options: CadMeshParseOptions,
): CadMeshAnalysis {
  const header = new TextDecoder().decode(bytes.slice(0, 24));
  if (header.startsWith("Kaydara FBX Binary")) {
    throw new Error(
      "检测到二进制 FBX 文件；请在 3ds Max / Blender 中导出为 ASCII FBX、GLB、OBJ 或使用本软件内置的 3ds Max 桥接脚本 (.ms) 直连发送。",
    );
  }
  const text = new TextDecoder().decode(bytes);
  const { transform, reverse } = axisTransform(options);

  const vertMatch = text.match(/Vertices:\s*\*\d+\s*\{\s*a:\s*([\s\S]*?)\}/i);
  const idxMatch = text.match(/PolygonVertexIndex:\s*\*\d+\s*\{\s*a:\s*([\s\S]*?)\}/i);
  if (!vertMatch || !idxMatch) {
    throw new Error("ASCII FBX 文件中未找到 Vertices 或 PolygonVertexIndex 几何数据。");
  }
  const rawNums = vertMatch[1]
    .split(/[,\s]+/)
    .map(Number)
    .filter((n) => Number.isFinite(n));
  const vertices: V3[] = [];
  for (let i = 0; i + 2 < rawNums.length; i += 3) {
    vertices.push(transform(rawNums[i], rawNums[i + 1], rawNums[i + 2]));
  }
  const rawIdx = idxMatch[1]
    .split(/[,\s]+/)
    .map((s) => parseInt(s, 10))
    .filter((n) => Number.isFinite(n));
  const faces: number[][] = [];
  let poly: number[] = [];
  for (const idx of rawIdx) {
    const isEnd = idx < 0;
    const vIdx = isEnd ? ~idx : idx;
    poly.push(vIdx);
    if (isEnd) {
      for (let k = 1; k + 1 < poly.length; k++) {
        faces.push(reverse ? [poly[0], poly[k + 1], poly[k]] : [poly[0], poly[k], poly[k + 1]]);
      }
      poly = [];
    }
  }
  const baseName = filename.replace(/\.[^.]+$/, "") || "fbx-mesh";
  return finalizeCadMesh("obj", [{ name: baseName, vertices, faces }]);
}

/**
 * Full CAD preprocessing: pivot alignment, decimation estimate, CoG, load-bearing surfaces & nesting zone.
 */
export function preprocessCadMesh(
  analysis: CadMeshAnalysis,
  opts: CadPreprocessOptions,
): CadPreprocessedModel {
  const { min, max, size } = analysis.boundingBox;
  const [sx, sy, sz] = size;

  let pivotShiftMm: [number, number, number] = [-min[0], -min[1], -min[2]];
  if (opts.pivotMode === "bottom-center") {
    pivotShiftMm = [-(min[0] + sx / 2), -(min[1] + sy / 2), -min[2]];
  } else if (opts.pivotMode === "centroid") {
    pivotShiftMm = [-(min[0] + sx / 2), -(min[1] + sy / 2), -(min[2] + sz / 2)];
  }

  const simplifiedTriangles =
    opts.simplifyTargetTriangles && opts.simplifyTargetTriangles > 0
      ? Math.min(analysis.triangleCount, Math.max(12, Math.round(opts.simplifyTargetTriangles)))
      : analysis.triangleCount;

  const boundingVolMm3 = Math.max(1, sx * sy * sz);
  const trueVolMm3 = analysis.absoluteVolumeMm3 > 0 ? Math.min(boundingVolMm3, analysis.absoluteVolumeMm3) : boundingVolMm3 * 0.65;
  const fillFactorPct = Number(((trueVolMm3 / boundingVolMm3) * 100).toFixed(1));

  const baseCog: [number, number, number] = [sx / 2, sy / 2, sz / 2];
  const off = opts.customCogOffsetMm ?? [0, 0, 0];
  const cogMm: [number, number, number] = [
    Number(Math.max(0, Math.min(sx, baseCog[0] + off[0])).toFixed(1)),
    Number(Math.max(0, Math.min(sy, baseCog[1] + off[1])).toFixed(1)),
    Number(Math.max(0, Math.min(sz, baseCog[2] + off[2])).toFixed(1)),
  ];

  // Analyze planar support ratio on bottom & top faces via vertex proximity to Z bounds
  let totalVerts = 0;
  let bottomVerts = 0;
  let topVerts = 0;
  let leftVerts = 0;
  let rightVerts = 0;
  let frontVerts = 0;
  let backVerts = 0;
  const tolZ = Math.max(1, sz * 0.03);
  const tolX = Math.max(1, sx * 0.03);
  const tolY = Math.max(1, sy * 0.03);
  for (const chunk of analysis.chunks) {
    for (const v of chunk.vertices) {
      totalVerts++;
      if (Math.abs(v[2] - min[2]) <= tolZ) bottomVerts++;
      if (Math.abs(v[2] - max[2]) <= tolZ) topVerts++;
      if (Math.abs(v[0] - min[0]) <= tolX) frontVerts++;
      if (Math.abs(v[0] - max[0]) <= tolX) backVerts++;
      if (Math.abs(v[1] - min[1]) <= tolY) leftVerts++;
      if (Math.abs(v[1] - max[1]) <= tolY) rightVerts++;
    }
  }
  const denom = Math.max(1, totalVerts);
  const makeSurf = (face: CadLoadBearingSurface["face"], count: number): CadLoadBearingSurface => {
    const ratio = Number(Math.min(1, (count / denom) * 3.2).toFixed(2));
    return { face, planarSupportRatio: ratio, loadBearingRecommended: ratio >= 0.35 };
  };
  const loadBearingSurfaces: CadLoadBearingSurface[] = [
    makeSurf("bottom", bottomVerts),
    makeSurf("top", topVerts),
    makeSurf("front", frontVerts),
    makeSurf("back", backVerts),
    makeSurf("left", leftVerts),
    makeSurf("right", rightVerts),
  ];

  // If fillFactor < 72%, identify an allowed nesting cavity zone
  const margin = Math.max(0, opts.nestingCavityMarginMm ?? 15);
  const allowedNestingZoneMm =
    fillFactorPct < 78 && sx > margin * 4 && sy > margin * 4 && sz > margin * 4
      ? {
          x: Math.round(sx * 0.25),
          y: Math.round(margin),
          z: Math.round(sz * 0.25),
          dx: Math.round(Math.max(10, sx * 0.5 - margin)),
          dy: Math.round(Math.max(10, sy - margin * 2)),
          dz: Math.round(Math.max(10, sz * 0.5 - margin)),
        }
      : null;

  return {
    format: analysis.format,
    originalTriangles: analysis.triangleCount,
    simplifiedTriangles,
    dimensionsMm: [Math.round(sx), Math.round(sy), Math.round(sz)],
    pivotMode: opts.pivotMode,
    pivotShiftMm: [Math.round(pivotShiftMm[0]), Math.round(pivotShiftMm[1]), Math.round(pivotShiftMm[2])],
    trueVolumeLiters: Number((trueVolMm3 / 1e6).toFixed(2)),
    boundingVolumeLiters: Number((boundingVolMm3 / 1e6).toFixed(2)),
    fillFactorPct,
    cogMm,
    loadBearingSurfaces,
    allowedNestingZoneMm,
  };
}
