import { describe, expect, it } from "vitest";
import {
  computeSignedMeshVolumeMm3,
  isBinaryStlBuffer,
  parseAsciiStl,
  parseBinaryStl,
  parseCadMeshFile,
  parseWavefrontObj,
} from "./cad-mesh-import";
import { importCargoModel } from "./model-import";

/** Build a closed unit box [0..lx] x [0..ly] x [0..lz] with outward CCW triangles. */
function makeBoxTriangles(lx: number, ly: number, lz: number): Array<[[number, number, number], [number, number, number], [number, number, number]]> {
  const v: Array<[number, number, number]> = [
    [0, 0, 0],
    [lx, 0, 0],
    [lx, ly, 0],
    [0, ly, 0],
    [0, 0, lz],
    [lx, 0, lz],
    [lx, ly, lz],
    [0, ly, lz],
  ];
  const idx: Array<[number, number, number]> = [
    [0, 2, 1], [0, 3, 2], // z=0 (-Z)
    [4, 5, 6], [4, 6, 7], // z=lz (+Z)
    [0, 1, 5], [0, 5, 4], // y=0 (-Y)
    [3, 6, 2], [3, 7, 6], // y=ly (+Y)
    [0, 4, 7], [0, 7, 3], // x=0 (-X)
    [1, 2, 6], [1, 6, 5], // x=lx (+X)
  ];
  return idx.map(([a, b, c]) => [v[a], v[b], v[c]]);
}

function buildBinaryStl(lx: number, ly: number, lz: number): ArrayBuffer {
  const tris = makeBoxTriangles(lx, ly, lz);
  const buf = new ArrayBuffer(84 + tris.length * 50);
  const view = new DataView(buf);
  const header = "CargoFit Binary STL test";
  for (let i = 0; i < header.length; i++) view.setUint8(i, header.charCodeAt(i));
  view.setUint32(80, tris.length, true);
  tris.forEach((tri, i) => {
    const base = 84 + i * 50 + 12;
    for (let k = 0; k < 3; k++) {
      view.setFloat32(base + k * 12, tri[k][0], true);
      view.setFloat32(base + k * 12 + 4, tri[k][1], true);
      view.setFloat32(base + k * 12 + 8, tri[k][2], true);
    }
  });
  return buf;
}

function buildAsciiStl(lx: number, ly: number, lz: number, name = "box_part"): string {
  const tris = makeBoxTriangles(lx, ly, lz);
  const lines = [`solid ${name}`];
  for (const [a, b, c] of tris) {
    lines.push("  facet normal 0 0 0");
    lines.push("    outer loop");
    lines.push(`      vertex ${a[0]} ${a[1]} ${a[2]}`);
    lines.push(`      vertex ${b[0]} ${b[1]} ${b[2]}`);
    lines.push(`      vertex ${c[0]} ${c[1]} ${c[2]}`);
    lines.push("    endloop");
    lines.push("  endfacet");
  }
  lines.push(`endsolid ${name}`);
  return lines.join("\n");
}

function buildQuadObj(lx: number, ly: number, lz: number): string {
  return [
    "# CargoFit Wavefront OBJ box with quads and negative indices",
    "o industrial_crate",
    `v 0 0 0`,
    `v ${lx} 0 0`,
    `v ${lx} ${ly} 0`,
    `v 0 ${ly} 0`,
    `v 0 0 ${lz}`,
    `v ${lx} 0 ${lz}`,
    `v ${lx} ${ly} ${lz}`,
    `v 0 ${ly} ${lz}`,
    "f 1 4 3 2",
    "f 5 6 7 8",
    "f 1 2 6 5",
    "f 4 8 7 3",
    "f 1 5 8 4",
    "f -7 -6 -2 -3",
  ].join("\n");
}

describe("cad-mesh-import (D06 Binary STL / ASCII STL / Wavefront OBJ)", () => {
  it("parses Binary STL with exact bounding box and signed tetrahedral volume", () => {
    const buf = buildBinaryStl(600, 400, 300);
    expect(isBinaryStlBuffer(buf)).toBe(true);
    const parsed = parseBinaryStl(buf, "pump.stl", { unit: "mm", up: "Z" });
    expect(parsed.format).toBe("stl-binary");
    expect(parsed.triangleCount).toBe(12);
    expect(parsed.boundingBox.size).toEqual([600, 400, 300]);
    expect(Math.round(parsed.absoluteVolumeMm3)).toBe(600 * 400 * 300);
    expect(Math.round(computeSignedMeshVolumeMm3(parsed.chunks[0].vertices, parsed.chunks[0].faces))).toBe(
      600 * 400 * 300,
    );
  });

  it("parses ASCII STL with unit conversion (cm -> mm) and Y-up axis remapping", () => {
    const stlText = buildAsciiStl(50, 30, 40, "valve_body");
    const parsed = parseAsciiStl(stlText, "valve.stl", { unit: "cm", up: "Y" });
    expect(parsed.format).toBe("stl-ascii");
    expect(parsed.chunks[0].name).toBe("valve_body");
    expect(parsed.triangleCount).toBe(12);
    // up='Y' maps [x, y, z] -> [x, z, y] so [500, 400, 300] mm
    expect(parsed.boundingBox.size).toEqual([500, 400, 300]);
    expect(Math.round(parsed.absoluteVolumeMm3)).toBe(500 * 400 * 300);
  });

  it("parses Wavefront OBJ including quad fan-triangulation and negative indices", () => {
    const objText = buildQuadObj(0.8, 0.5, 0.4);
    const parsed = parseWavefrontObj(objText, "crate.obj", { unit: "m", up: "Z" });
    expect(parsed.format).toBe("obj");
    expect(parsed.chunks[0].name).toBe("industrial_crate");
    expect(parsed.triangleCount).toBe(12);
    expect(parsed.boundingBox.size.map((v) => Math.round(v))).toEqual([800, 500, 400]);
    expect(Math.round(parsed.absoluteVolumeMm3)).toBe(800 * 500 * 400);
  });

  it("auto-detects Binary STL vs ASCII STL vs OBJ in parseCadMeshFile", () => {
    const bin = buildBinaryStl(100, 100, 100);
    const ascii = new TextEncoder().encode(buildAsciiStl(100, 100, 100)).buffer;
    const obj = new TextEncoder().encode(buildQuadObj(100, 100, 100)).buffer;
    expect(parseCadMeshFile("a.stl", bin, { unit: "mm", up: "Z" }).format).toBe("stl-binary");
    expect(parseCadMeshFile("b.stl", ascii, { unit: "mm", up: "Z" }).format).toBe("stl-ascii");
    expect(parseCadMeshFile("c.obj", obj, { unit: "mm", up: "Z" }).format).toBe("obj");
  });

  it("rejects corrupted or empty CAD files cleanly", () => {
    expect(() => parseBinaryStl(new ArrayBuffer(20), "bad.stl", { unit: "mm", up: "Z" })).toThrow();
    expect(() => parseWavefrontObj("# empty", "empty.obj", { unit: "mm", up: "Z" })).toThrow();
    expect(() => parseWavefrontObj("v 0 0 0\nf 1 2 3", "oob.obj", { unit: "mm", up: "Z" })).toThrow();
  });

  it("imports STL and OBJ files end-to-end through importCargoModel into closed SolidModel", async () => {
    const stlFile = new File([buildBinaryStl(500, 350, 280)], "gearbox.stl", { type: "model/stl" });
    const stlResult = await importCargoModel([stlFile], {
      unit: "mm",
      up: "Z",
      separate: false,
      targetTriangles: 2000,
    });
    expect(stlResult.closed).toBe(true);
    expect(stlResult.parts).toBe(1);
    expect(stlResult.trianglesBefore).toBe(12);
    expect(stlResult.size.map((v) => Math.round(v))).toEqual([500, 350, 280]);

    const objFile = new File([buildQuadObj(0.6, 0.4, 0.3)], "frame.obj", { type: "text/plain" });
    const objResult = await importCargoModel([objFile], {
      unit: "m",
      up: "Z",
      separate: false,
      targetTriangles: 2000,
    });
    expect(objResult.closed).toBe(true);
    expect(objResult.parts).toBe(1);
    expect(objResult.size.map((v) => Math.round(v))).toEqual([600, 400, 300]);
  });
});
