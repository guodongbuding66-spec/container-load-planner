import { describe, expect, it } from "vitest";
import { buildPlacementCsv, MAX_CSV_ROWS, parseCsvRecords, parseProductsCsv, toCsvCell } from "./csv";
import type { PackingResult } from "./types";

const colors = ["#2f7f89", "#c66a3d"];

describe("CSV utilities", () => {
  it("escapes separators, quotes, newlines, and spreadsheet formulas", () => {
    expect(toCsvCell("普通文本")).toBe("普通文本");
    expect(toCsvCell('箱体,"A"\n第二行')).toBe('"箱体,""A""\n第二行"');
    expect(toCsvCell("=HYPERLINK(\"https://example.com\")")).toBe('"\'=HYPERLINK(""https://example.com"")"');
    expect(toCsvCell("  +SUM(1,2)")).toBe('"\'  +SUM(1,2)"');
    expect(toCsvCell(-12.5)).toBe("-12.5");
  });

  it("parses quoted commas, escaped quotes, and multiline cells", () => {
    expect(parseCsvRecords('sku,name\r\nA-1,"主箱,""加固""\n第二行"\r\n')).toEqual([
      ["sku", "name"],
      ["A-1", '主箱,"加固"\n第二行'],
    ]);
    expect(() => parseCsvRecords('sku,name\nA,"未闭合')).toThrow("未闭合");
  });

  it("trims imported text and replaces invalid colors without changing quantities", () => {
    const parsed = parseProductsCsv(
      "sku,name,length,width,height,weight,quantity,priority,setCode,unitsPerSet,rotationPolicy,maxStackLayers,color\n" +
      " A-1 , 测试主箱 ,1000,500,300,20,3,100, SET-A ,2,upright,99,not-a-color",
      colors,
      123,
    );

    expect(parsed[0]).toMatchObject({
      id: "import-123-0",
      sku: "A-1",
      name: "测试主箱",
      quantity: 3,
      priority: 100,
      unitsPerSet: 2,
      maxStackLayers: 99,
      declaredVolumeCbm: 0.15,
      color: colors[0],
    });
  });

  it("recalculates CBM from dimensions even when a legacy CSV value is present", () => {
    const parsed = parseProductsCsv(
      "sku,name,length,width,height,declaredVolumeCbm,weight,quantity\n" +
      "AUTO-CBM,自动体积,1270,550,290,99,31,1",
      colors,
    );

    expect(parsed[0].declaredVolumeCbm).toBe(0.2);
  });

  it("imports explicit display units into canonical millimeters and kilograms", () => {
    const parsed = parseProductsCsv(
      "sku,name,length,width,height,lengthUnit,weight,weightUnit,quantity\n" +
      "UNIT-1,单位换算,127,55,29,cm,68.3433012,lb,1",
      colors,
    );

    expect(parsed[0]).toMatchObject({
      length: 1270,
      width: 550,
      height: 290,
      maxStackLayers: 0,
    });
    expect(parsed[0].weight).toBeCloseTo(31, 5);
  });

  it("keeps legacy files compatible and rejects unknown unit codes", () => {
    const legacy = parseProductsCsv(
      "sku,name,length,width,height,weight,quantity\nLEGACY,旧模板,1270,550,290,31,1",
      colors,
    );
    expect(legacy[0]).toMatchObject({ length: 1270, weight: 31, maxStackLayers: 0 });
    expect(() => parseProductsCsv(
      "sku,name,length,width,height,lengthUnit,weight,quantity\nBAD,错误单位,1,1,1,ft,1,1",
      colors,
    )).toThrow("长度单位");
  });

  it("rejects missing columns, empty files, and excessive rows", () => {
    expect(() => parseProductsCsv("sku,name\nA,测试", colors)).toThrow("缺少必要字段");
    expect(() => parseProductsCsv("", colors)).toThrow("文件为空");
    expect(() => parseProductsCsv(
      "sku,name,length,width,height,weight,quantity,sku\nA,测试,1,1,1,1,1,B",
      colors,
    )).toThrow("重复表头");
    const header = "sku,name,length,width,height,weight,quantity";
    const excessive = Array.from({ length: MAX_CSV_ROWS + 1 }, (_, index) => `A-${index},测试,1,1,1,1,1`);
    expect(() => parseProductsCsv([header, ...excessive].join("\n"), colors)).toThrow("最多支持");
  });

  it("builds safe placement exports without breaking columns", () => {
    const result = {
      container: { id: "test" },
      placements: [{
        id: "box-1",
        productId: "product-1",
        sku: "=2+2",
        name: '主箱,"加固"\n第二行',
        setCode: "@SET",
        setNumber: 1,
        setItemNumber: 1,
        x: 0,
        y: 0,
        z: 0,
        dx: 100,
        dy: 100,
        dz: 100,
        weight: 10,
        orientation: "LWH",
        layer: 1,
        color: "#2f7f89",
      }],
    } as PackingResult;

    const csv = buildPlacementCsv(result);
    expect(csv).toContain("'=2+2");
    expect(csv).toContain("'@SET");
    expect(csv).toContain('"主箱,""加固""\n第二行"');
    expect(parseCsvRecords(csv)[1]).toHaveLength(20);
    expect(parseCsvRecords(csv)[0].slice(-3)).toEqual(["客户","目的地","卸货站次"]);
  });
});
