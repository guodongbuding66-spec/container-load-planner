import { describe, expect, it } from "vitest";
import { interpolateUi, translateDiagnostic, translateUi } from "./translate-ui";
import { ENGLISH } from "./ui-language";
import { packWithComparison } from "./engine";
import { CONTAINER_PRESETS, SAMPLE_PRODUCTS } from "./presets";
import { readFileSync, readdirSync } from "node:fs";
import ts from "typescript";

describe("English interface and solver diagnostics", () => {
  it("translates both solver results at display time without changing saved data", () => {
    const result = packWithComparison({ container: CONTAINER_PRESETS[0], products: SAMPLE_PRODUCTS.map(p => ({ ...p, quantity: 3 })), mode: "mixed", strategy: "practical", clearance: 10 });
    const messages = [...result.warnings, ...(result.strategyComparison?.guidance.flatMap(g => [g.title, g.detail]) ?? [])];
    expect(messages.length).toBeGreaterThan(3);
    for (const message of messages) expect(translateDiagnostic(message, "en")).not.toMatch(/[\u3400-\u9fff]/);
    expect(result.warnings.some(message => /[\u3400-\u9fff]/.test(message))).toBe(true);
  });

  it("preserves interpolated product data and literal placeholder characters", () => {
    const parts = ["当前第 ", " 箱"];
    expect(interpolateUi(parts, [12], "en")).toBe("Current carton 12");
    expect(interpolateUi(parts, [12], "zh")).toBe("当前第 12 箱");
    expect(interpolateUi(["删除 ", ""], ["客户品名 {1}"], "en")).toBe("Delete 客户品名 {1}");
    expect(translateUi("客户输入的品名", "en")).toBe("客户输入的品名");
  });

  it("translates pallet diagnostics with unchanged numeric height and tare", () => {
    const message = "底层托盘 25 个，自重 625 kg；货物 Z 坐标已包含托盘高度 144 mm，托盘单独记录，不计入货物箱数。";
    expect(translateDiagnostic(message, "en")).toBe("25 floor pallets, 625 kg tare. Cargo Z already includes 144 mm pallet height. Pallets are separate records and are excluded from cargo counts.");
    expect(translateDiagnostic(message, "zh")).toBe(message);
  });

  it("has English text and consistent interpolation slots for every dictionary entry", () => {
    for (const [source, english] of Object.entries(ENGLISH)) {
      expect(english, source).not.toMatch(/[\u3400-\u9fff]/);
      expect([...(english.match(/\{\d+\}/g) ?? [])].sort(), source).toEqual([...(source.match(/\{\d+\}/g) ?? [])].sort());
    }
    expect(translateUi(" 横向占用 ", "en")).toBe(" Horizontal extent ");
  });

  it("covers every direct Chinese UI label without an explicit English fallback", () => {
    const directory = new URL("../../components/", import.meta.url);
    for (const file of readdirSync(directory).filter(f => f.endsWith(".tsx"))) {
      const source = readFileSync(new URL(file, directory), "utf8");
      const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      function visit(node: ts.Node) {
        if (ts.isCallExpression(node) && node.expression.getText(ast) === "tr" && node.arguments.length === 1 && ts.isStringLiteral(node.arguments[0])) {
          const value = node.arguments[0].text;
          if (/[\u3400-\u9fff]/.test(value)) expect(translateUi(value, "en"), `${file}: ${value}`).not.toMatch(/[\u3400-\u9fff]/);
        }
        ts.forEachChild(node, visit);
      }
      visit(ast);
    }
  });
});

describe("8-language international localization", () => {
  it("translates core workflow labels into es, de, fr, ja, ko, and pt without Chinese leakage", () => {
    const langs = ["es", "de", "fr", "ja", "ko", "pt"] as const;
    const samples = [
      ["装入重量", "Loaded weight"],
      ["计算方案", "Calculate plan"],
      ["体积利用率", "Volume utilization"],
      ["智能粘贴", "Smart Paste & File Import (Excel / CSV / WeChat)"],
    ] as const;
    for (const lang of langs) {
      for (const [zh, en] of samples) {
        const out = translateUi(zh, lang, en);
        expect(out, `${lang}:${en}`).not.toBe(en);
        if (lang !== "ja") expect(out, `${lang}:${en}`).not.toMatch(/[\u3400-\u9fff]/); else expect(out).not.toBe(zh);
      }
      const diag = translateDiagnostic("底层托盘 25 个，自重 625 kg；货物 Z 坐标已包含托盘高度 144 mm，托盘单独记录，不计入货物箱数。", lang);
      expect(diag, `${lang}:diag`).not.toMatch(/[\u3400-\u9fff]/);
    }
  });
});
