import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { pack } from "./engine";
import { solveOptimal2DLayer } from "./layer-2d-optimal";
import { buildCrewSlicePayload, isCrewPayload } from "./crew-payload";
import { createPackingListWorkbook } from "./packing-list-export";
import { buildPlacementCsv, parseCsvRecords } from "./csv";
import { buildZipArchive } from "./mini-zip";
import type { ContainerSpec, ProductInput } from "./types";

function makeBoxContainer(length: number, width: number, height = 200): ContainerSpec {
  return {
    id: `custom-${length}x${width}x${height}`,
    name: `${length}x${width}x${height}`,
    length,
    width,
    height,
    doorWidth: width,
    doorHeight: height,
    maxWeight: 28_000,
  };
}

function makeBoxProduct(length: number, width: number, height = 200, quantity = 100): ProductInput {
  return {
    id: `sku-${length}x${width}x${height}`,
    sku: `BOX-${length}x${width}`,
    name: `Box ${length}x${width}x${height}`,
    length,
    width,
    height,
    weight: 5,
    quantity,
    color: "#3b82f6",
    rotationPolicy: "upright",
    maxStackLayers: 0,
    stackable: true,
    bottomOnly: false,
    mustLoad: false,
    priority: 1,
  };
}

const ZERO_CLEARANCE = 0;

describe("BUG-01: Optimal 2D Pinwheel & exact mixed-orientation packing in maximum mode", () => {
  const AUDIT_COUNTEREXAMPLES: Array<{
    L: number;
    W: number;
    a: number;
    b: number;
    expected: number;
  }> = [
    { L: 400, W: 300, a: 300, b: 200, expected: 2 },
    { L: 500, W: 500, a: 300, b: 200, expected: 4 },
    { L: 600, W: 500, a: 300, b: 200, expected: 5 },
    { L: 700, W: 700, a: 300, b: 200, expected: 8 },
    { L: 700, W: 700, a: 400, b: 100, expected: 12 },
    { L: 800, W: 700, a: 300, b: 200, expected: 9 },
  ];

  for (const tc of AUDIT_COUNTEREXAMPLES) {
    it(`hits exact optimal ${tc.expected} boxes for ${tc.L}x${tc.W} floor / ${tc.a}x${tc.b} box in both single and mixed maximum mode`, () => {
      const container = makeBoxContainer(tc.L, tc.W, 200);
      const product = makeBoxProduct(tc.a, tc.b, 200, 100);

      const singleResult = pack({
        mode: "single",
        strategy: "maximum",
        container,
        clearance: ZERO_CLEARANCE,
        products: [product],
      });
      expect(singleResult.placements.length).toBe(tc.expected);
      expect(singleResult.validation.valid).toBe(true);

      const mixedResult = pack({
        mode: "mixed",
        strategy: "maximum",
        container,
        clearance: ZERO_CLEARANCE,
        products: [product],
      });
      expect(mixedResult.placements.length).toBe(tc.expected);
      expect(mixedResult.validation.valid).toBe(true);
    });
  }

  it("stacks Pinwheel 2D optimal layers cleanly across multiple Z levels", () => {
    const container = makeBoxContainer(500, 500, 600);
    const product = makeBoxProduct(300, 200, 200, 50);

    const singleResult = pack({
      mode: "single",
      strategy: "maximum",
      container,
      clearance: ZERO_CLEARANCE,
      products: [product],
    });
    expect(singleResult.placements.length).toBe(12); // 4 per layer * 3 layers
    expect(singleResult.validation.valid).toBe(true);

    const mixedResult = pack({
      mode: "mixed",
      strategy: "maximum",
      container,
      clearance: ZERO_CLEARANCE,
      products: [product],
    });
    expect(mixedResult.placements.length).toBe(12);
    expect(mixedResult.validation.valid).toBe(true);
  });

  it("matches exact 2D solver across a 120-case rectangle rotation sweep with 0% shortfall", () => {
    const floors = [
      [400, 300],
      [500, 400],
      [500, 500],
      [600, 500],
      [700, 500],
      [700, 600],
      [700, 700],
      [800, 600],
      [800, 700],
      [900, 700],
      [1000, 700],
      [1000, 800],
    ];
    const boxes = [
      [300, 200],
      [400, 100],
      [400, 200],
      [400, 300],
      [350, 200],
      [350, 150],
      [250, 150],
      [300, 150],
      [450, 200],
      [500, 200],
    ];

    let totalCases = 0;
    let matchedSingle = 0;
    let matchedMixed = 0;

    for (const [L, W] of floors) {
      for (const [a, b] of boxes) {
        const expected = solveOptimal2DLayer(L, W, a, b).length;
        if (expected === 0) continue;
        totalCases += 1;

        const container = makeBoxContainer(L, W, 200);
        const product = makeBoxProduct(a, b, 200, 200);

        const singleRes = pack({
          mode: "single",
          strategy: "maximum",
          container,
          clearance: ZERO_CLEARANCE,
          products: [product],
        });
        expect(singleRes.validation.valid).toBe(true);
        if (singleRes.placements.length >= expected) matchedSingle += 1;

        const mixedRes = pack({
          mode: "mixed",
          strategy: "maximum",
          container,
          clearance: ZERO_CLEARANCE,
          products: [product],
        });
        expect(mixedRes.validation.valid).toBe(true);
        if (mixedRes.placements.length >= expected) matchedMixed += 1;
      }
    }

    expect(totalCases).toBeGreaterThanOrEqual(110);
    expect(matchedSingle).toBe(totalCases);
    expect(matchedMixed).toBe(totalCases);
  });

  it("matches an independent exact branch-and-bound solver across 180+ rectangle-rotation instances with 100% accuracy", () => {
    function independentExact(L: number, W: number, a: number, b: number, maxNodes = 30000): number {
      const area = a * b;
      const ub = Math.floor((L * W + 1e-6) / area);
      if (ub === 0) return 0;
      let best = Math.max(
        Math.floor(L / a) * Math.floor(W / b),
        Math.floor(L / b) * Math.floor(W / a),
      );
      if (best >= ub) return best;
      const placed: Array<[number, number, number, number]> = [];
      const dims: Array<[number, number]> = a === b ? [[a, b]] : [[a, b], [b, a]];
      let nodes = 0;

      function overlaps(x: number, y: number, dx: number, dy: number) {
        for (let i = 0; i < placed.length; i += 1) {
          const [px, py, pdx, pdy] = placed[i];
          if (x < px + pdx - 1e-6 && x + dx > px + 1e-6 && y < py + pdy - 1e-6 && y + dy > py + 1e-6) return true;
        }
        return false;
      }

      function dfs(remArea: number) {
        if (placed.length > best) {
          best = placed.length;
          if (best >= ub) return;
        }
        if (nodes >= maxNodes) return;
        if (placed.length + Math.floor((remArea + 1e-6) / area) <= best) return;
        nodes += 1;
        const xs = new Set([0]);
        const ys = new Set([0]);
        const mn = Math.min(a, b);
        for (const [px, py, pdx, pdy] of placed) {
          if (px + pdx <= L - mn + 1e-6) xs.add(px + pdx);
          if (py + pdy <= W - mn + 1e-6) ys.add(py + pdy);
        }
        const sx = [...xs].sort((u, v) => u - v);
        const sy = [...ys].sort((u, v) => u - v);
        let ax = -1;
        let ay = -1;
        const opts: Array<[number, number]> = [];
        outer: for (const x of sx) {
          for (const y of sy) {
            for (const [dx, dy] of dims) {
              if (x + dx <= L + 1e-6 && y + dy <= W + 1e-6 && !overlaps(x, y, dx, dy)) {
                ax = x;
                ay = y;
                opts.push([dx, dy]);
              }
            }
            if (opts.length) break outer;
          }
        }
        if (ax < 0) return;
        for (const [dx, dy] of opts) {
          placed.push([ax, ay, dx, dy]);
          dfs(remArea - area);
          placed.pop();
          if (best >= ub || nodes >= maxNodes) return;
        }
      }

      dfs(L * W);
      return best;
    }

    const Ls = [300, 400, 500, 600, 700, 800, 900, 1000];
    const Ws = [300, 400, 500, 600, 700, 800];
    const boxes: Array<[number, number]> = [
      [200, 100],
      [300, 100],
      [300, 200],
      [400, 100],
      [400, 200],
      [400, 300],
      [500, 200],
      [500, 300],
    ];

    let tested = 0;
    const misses: string[] = [];
    for (const L of Ls) {
      for (const W of Ws) {
        if (W > L) continue;
        for (const [a, b] of boxes) {
          const ub = Math.floor((L * W) / (a * b));
          if (ub < 1 || ub > 16) continue;
          tested += 1;
          const opt = independentExact(L, W, a, b);
          const container = makeBoxContainer(L, W, 200);
          const product = makeBoxProduct(a, b, 200, 100);
          const sRes = pack({ mode: "single", strategy: "maximum", container, clearance: ZERO_CLEARANCE, products: [product] });
          const mRes = pack({ mode: "mixed", strategy: "maximum", container, clearance: ZERO_CLEARANCE, products: [product] });
          if (sRes.placements.length < opt || !sRes.validation.valid) {
            misses.push(`SINGLE ${L}x${W}/${a}x${b}: got=${sRes.placements.length}, opt=${opt}`);
          }
          if (mRes.placements.length < opt || !mRes.validation.valid) {
            misses.push(`MIXED ${L}x${W}/${a}x${b}: got=${mRes.placements.length}, opt=${opt}`);
          }
        }
      }
    }

    expect(tested).toBeGreaterThanOrEqual(180);
    expect(misses).toEqual([]);
  });

  it("preserves 2D Pinwheel optimal layers when maxTopLoadKg or allowedAboveSkus caps stack height", () => {
    const container = makeBoxContainer(500, 500, 800);
    const product = { ...makeBoxProduct(300, 200, 200, 50), maxTopLoadKg: 10 };

    const singleRes = pack({ mode: "single", strategy: "maximum", container, clearance: ZERO_CLEARANCE, products: [product] });
    expect(singleRes.validation.valid).toBe(true);
    expect(singleRes.placements.length).toBe(12);

    const mixedRes = pack({ mode: "mixed", strategy: "maximum", container, clearance: ZERO_CLEARANCE, products: [product] });
    expect(mixedRes.validation.valid).toBe(true);
    expect(mixedRes.placements.length).toBe(12);

    const noSelfStack = { ...makeBoxProduct(300, 200, 200, 50), allowedAboveSkus: ["OTHER-SKU"] };
    const oneLayerRes = pack({ mode: "single", strategy: "maximum", container, clearance: ZERO_CLEARANCE, products: [noSelfStack] });
    expect(oneLayerRes.validation.valid).toBe(true);
    expect(oneLayerRes.placements.length).toBe(4);
  });
});

describe("BUG-02: Strict spatial bounds & partition consistency in isCrewPayload", () => {
  const validPayload = {
    v: 1,
    c: "Test 1m",
    L: 1000,
    W: 1000,
    H: 1000,
    tot: 2,
    wt: 10,
    vol: 50,
    slices: [
      {
        idx: 1,
        xFrom: 0,
        xTo: 500,
        items: [
          { sku: "SKU-A", qty: 2, dx: 400, dy: 300, dz: 200, col: "#3b82f6" },
        ],
      },
    ],
  };

  it("accepts valid crew payload", () => {
    expect(isCrewPayload(validPayload)).toBe(true);
  });

  it("rejects out-of-bounds slice interval (99999-100000 mm in L=1000 mm container)", () => {
    const badSlice = {
      ...validPayload,
      slices: [
        {
          ...validPayload.slices[0],
          xFrom: 99999,
          xTo: 100000,
        },
      ],
    };
    expect(isCrewPayload(badSlice)).toBe(false);
  });

  it("rejects oversized item dimensions (100000x100000x100000 mm)", () => {
    const badItem = {
      ...validPayload,
      slices: [
        {
          ...validPayload.slices[0],
          items: [
            { sku: "SKU-BIG", qty: 1, dx: 100000, dy: 100000, dz: 100000, col: "#ef4444" },
          ],
        },
      ],
    };
    expect(isCrewPayload(badItem)).toBe(false);
  });

  it("rejects overlapping or inverted slice partitions and absurd container sizes", () => {
    const overlapping = {
      ...validPayload,
      slices: [
        { ...validPayload.slices[0], idx: 1, xFrom: 0, xTo: 600 },
        { ...validPayload.slices[0], idx: 2, xFrom: 500, xTo: 900 },
      ],
    };
    expect(isCrewPayload(overlapping)).toBe(false);

    const inverted = {
      ...validPayload,
      slices: [{ ...validPayload.slices[0], xFrom: 600, xTo: 400 }],
    };
    expect(isCrewPayload(inverted)).toBe(false);

    const absurdContainer = {
      ...validPayload,
      L: 999999, W: 2000, H: 2000,
    };
    expect(isCrewPayload(absurdContainer)).toBe(false);
  });

  it("produces valid bounded payload from buildCrewSlicePayload", () => {
    const container = makeBoxContainer(2000, 1200, 1200);
    const product = makeBoxProduct(400, 300, 300, 24);
    const result = pack({
      mode: "single",
      strategy: "maximum",
      container,
      clearance: ZERO_CLEARANCE,
      products: [product],
    });
    const payload = buildCrewSlicePayload(result);
    expect(isCrewPayload(payload)).toBe(true);
    for (const s of payload.slices) {
      expect(s.xFrom).toBeGreaterThanOrEqual(0);
      expect(s.xTo).toBeLessThanOrEqual(payload.L);
    }
  });
});

describe("BUG-03: Exported file content verification (Excel .xlsx, CSV, ZIP)", () => {
  const container = makeBoxContainer(2400, 1200, 1200);
  const products: ProductInput[] = [
    makeBoxProduct(600, 400, 400, 10),
    {
      ...makeBoxProduct(500, 300, 300, 8),
      id: "sku-b",
      sku: "BOX-500x300",
      name: "Carton B",
      weight: 8.5,
      color: "#10b981",
    },
  ];
  const result = pack({
    mode: "mixed",
    strategy: "maximum",
    container,
    clearance: ZERO_CLEARANCE,
    products,
  });

  it("verifies real Excel (.xlsx) workbook sheets, SKU rows, and totals", async () => {
    const bytes = await createPackingListWorkbook(result, products, { invoiceNo: "INV-2026-001", containerNo: "MSCU1234567" });
    expect(bytes.byteLength).toBeGreaterThan(2000);

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
    expect(wb.worksheets.length).toBeGreaterThanOrEqual(1);

    const sheet = wb.worksheets[0];
    const allText: string[] = [];
    sheet.eachRow((row) => {
      row.eachCell((cell) => {
        if (cell.value !== null && cell.value !== undefined) {
          allText.push(typeof cell.value === 'object' && cell.value && 'result' in cell.value ? String((cell.value as { result?: unknown }).result ?? '') : String(cell.value));
        }
      });
    });
    const joined = allText.join(" | ");
    expect(joined).toContain("BOX-600x400");
    expect(joined).toContain("BOX-500x300");
    expect(joined).toContain(String(result.placements.length));
  });

  it("verifies real CSV placement export row count and coordinates", () => {
    const csv = buildPlacementCsv(result);
    const records = parseCsvRecords(csv);
    expect(records.length).toBe(result.placements.length + 1); // header + data rows
    expect(records[0][1]).toBe("SKU");
    expect(records[0][6]).toBe("X(mm)");

    const firstPlacement = result.placements[0];
    const firstRow = records[1];
    expect(firstRow[1]).toBe(firstPlacement.sku);
    expect(Number(firstRow[6])).toBe(Math.round(firstPlacement.x));
    expect(Number(firstRow[7])).toBe(Math.round(firstPlacement.y));
    expect(Number(firstRow[8])).toBe(Math.round(firstPlacement.z));
  });

  it("verifies real ZIP archive binary signature, entry names, and payloads", () => {
    const csvBytes = new TextEncoder().encode(buildPlacementCsv(result));
    const jsonBytes = new TextEncoder().encode(JSON.stringify({ totalLoaded: result.placements.length }));
    const zipBytes = buildZipArchive([
      { name: "placements.csv", data: csvBytes },
      { name: "summary.json", data: jsonBytes },
    ]);

    // Check PK\x03\x04 local header and PK\x05\x06 EOCD signature
    expect(zipBytes[0]).toBe(0x50);
    expect(zipBytes[1]).toBe(0x4b);
    expect(zipBytes[2]).toBe(0x03);
    expect(zipBytes[3]).toBe(0x04);

    const zipStr = new TextDecoder("latin1").decode(zipBytes);
    expect(zipStr).toContain("placements.csv");
    expect(zipStr).toContain("summary.json");
    expect(zipStr).toContain(`"totalLoaded":${result.placements.length}`);
  });
});

describe("Audit Round 2: All 10 Multi-SKU 2D & 7 3D Mixed-Orientation Counterexamples (17/17)", () => {
  const MULTI_SKU_10: Array<{ L: number; W: number; a: [number, number]; b: [number, number]; qty: [number, number]; expected: number }> = [
    { L: 500, W: 500, a: [300, 100], b: [300, 200], qty: [2, 3], expected: 5 },
    { L: 500, W: 500, a: [300, 200], b: [400, 100], qty: [2, 3], expected: 5 },
    { L: 600, W: 300, a: [200, 200], b: [400, 100], qty: [2, 2], expected: 4 },
    { L: 600, W: 500, a: [300, 200], b: [400, 100], qty: [3, 3], expected: 6 },
    { L: 600, W: 500, a: [300, 200], b: [400, 200], qty: [2, 2], expected: 4 },
    { L: 700, W: 300, a: [200, 200], b: [400, 100], qty: [2, 2], expected: 4 },
    { L: 700, W: 300, a: [300, 200], b: [400, 100], qty: [2, 2], expected: 4 },
    { L: 700, W: 500, a: [300, 200], b: [400, 100], qty: [3, 3], expected: 6 },
    { L: 700, W: 500, a: [400, 200], b: [300, 300], qty: [2, 2], expected: 4 },
    { L: 700, W: 600, a: [300, 200], b: [300, 300], qty: [2, 3], expected: 5 },
  ];

  it("packs 100% of all 10 multi-SKU 2D mixed-order counterexamples with 0 shortfall", () => {
    for (const tc of MULTI_SKU_10) {
      const container = makeBoxContainer(tc.L, tc.W, 100);
      const pA = { ...makeBoxProduct(tc.a[0], tc.a[1], 100, tc.qty[0]), id: "qa0", sku: "QA0" };
      const pB = { ...makeBoxProduct(tc.b[0], tc.b[1], 100, tc.qty[1]), id: "qa1", sku: "QA1" };
      const res = pack({ mode: "mixed", strategy: "maximum", container, clearance: ZERO_CLEARANCE, products: [pA, pB] });
      expect(res.validation.valid, `${tc.L}x${tc.W}`).toBe(true);
      expect(res.placements.length, `${tc.L}x${tc.W} [${tc.a} + ${tc.b}]`).toBe(tc.expected);
    }
  });

  const MIXED_3D_7: Array<{ L: number; W: number; H: number; d: [number, number, number]; expected: number }> = [
    { L: 500, W: 400, H: 400, d: [100, 200, 300], expected: 13 },
    { L: 600, W: 500, H: 400, d: [200, 300, 300], expected: 6 },
    { L: 600, W: 500, H: 500, d: [200, 200, 300], expected: 11 },
    { L: 600, W: 500, H: 500, d: [200, 300, 300], expected: 7 },
    { L: 600, W: 500, H: 500, d: [100, 300, 400], expected: 12 },
    { L: 600, W: 600, H: 500, d: [200, 200, 300], expected: 15 },
    { L: 600, W: 600, H: 500, d: [200, 300, 300], expected: 10 },
  ];

  it("hits all 7 3D mixed-orientation witness lower bounds in BOTH single and mixed maximum mode", () => {
    for (const tc of MIXED_3D_7) {
      const container = makeBoxContainer(tc.L, tc.W, tc.H);
      const product = { ...makeBoxProduct(tc.d[0], tc.d[1], tc.d[2], 100), rotationPolicy: "any" as const };
      const singleRes = pack({ mode: "single", strategy: "maximum", container, clearance: ZERO_CLEARANCE, products: [product] });
      expect(singleRes.validation.valid, `single ${tc.L}x${tc.W}x${tc.H}`).toBe(true);
      expect(singleRes.placements.length, `single ${tc.L}x${tc.W}x${tc.H} d=${tc.d}`).toBeGreaterThanOrEqual(tc.expected);

      const mixedRes = pack({ mode: "mixed", strategy: "maximum", container, clearance: ZERO_CLEARANCE, products: [product] });
      expect(mixedRes.validation.valid, `mixed ${tc.L}x${tc.W}x${tc.H}`).toBe(true);
      expect(mixedRes.placements.length, `mixed ${tc.L}x${tc.W}x${tc.H} d=${tc.d}`).toBeGreaterThanOrEqual(tc.expected);
    }
  });

  it("assigns exact physical stack layers (1..5) in 3D mixed-orientation plans and handles 3-SKU exact 2D orders", () => {
    // 600x500x500 with 100x300x400 -> 5 stacked layers of dz=100 must have layers 1, 2, 3, 4, 5 (never hardcoded 2)
    const c3d = makeBoxContainer(600, 500, 500);
    const p3d = { ...makeBoxProduct(100, 300, 400, 50), rotationPolicy: "any" as const };
    const r3d = pack({ mode: "single", strategy: "maximum", container: c3d, clearance: ZERO_CLEARANCE, products: [p3d] });
    expect(r3d.validation.valid).toBe(true);
    expect(r3d.placements.length).toBe(12);
    // Verify every box has its exact topological physical layer (1 on floor, 1 + max(below.layer) above)
    for (const b of r3d.placements) {
      if (b.z <= 1e-6) {
        expect(b.layer).toBe(1);
      } else {
        const below = r3d.placements.filter(
          (o) =>
            Math.abs(o.z + o.dz - b.z) <= 1e-4 &&
            b.x < o.x + o.dx - 1e-4 &&
            b.x + b.dx > o.x + 1e-4 &&
            b.y < o.y + o.dy - 1e-4 &&
            b.y + b.dy > o.y + 1e-4,
        );
        expect(below.length).toBeGreaterThan(0);
        expect(b.layer).toBe(Math.max(...below.map((o) => o.layer)) + 1);
      }
    }

    // 3-SKU tight 2D mixed order on 600x500 floor (100% area fill)
    const c3sku = makeBoxContainer(600, 500, 100);
    const s1 = { ...makeBoxProduct(300, 200, 100, 2), id: "s1", sku: "S1" }; // area 120000
    const s2 = { ...makeBoxProduct(400, 100, 100, 3), id: "s2", sku: "S2" }; // area 120000
    const s3 = { ...makeBoxProduct(200, 300, 100, 1), id: "s3", sku: "S3" }; // area 60000 -> total 300000 = 100%
    const r3sku = pack({ mode: "mixed", strategy: "maximum", container: c3sku, clearance: ZERO_CLEARANCE, products: [s1, s2, s3] });
    expect(r3sku.validation.valid).toBe(true);
    expect(r3sku.placements.length).toBe(6);
  });
});
