import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import { CrateExteriorHeight } from "./crate-exterior-height";
import { PackagingEditor } from "./packaging-editor";
import { TransportAppearanceProvider } from "./transport-appearance";
import { DEFAULT_PALLET_BUILD } from "../lib/packing/loading-workflow";
import { DEFAULT_PACKAGING } from "../lib/packing/packaging";
import { setAppLanguage } from "./language";
const value = { ...DEFAULT_PALLET_BUILD.config, length: 1700, width: 560, height: 144, maxCargoHeight: 1000, packaging: { ...DEFAULT_PACKAGING, base: "corner-feet" as const, enclosure: "slatted" as const, wallThickness: 30 } };
afterEach(() => { vi.stubGlobal("document", { documentElement: { lang: "" } }); setAppLanguage("zh"); vi.unstubAllGlobals(); });
it("exposes the editable exterior height and explains the base/interior/lid sum", () => {
  const html = renderToStaticMarkup(<CrateExteriorHeight value={value} onChange={() => {}} onValidityChange={() => {}}/>);
  expect(html).toContain('aria-label="木箱外部总高"'); expect(html).toContain('value="1174"');
  expect(html).toContain("144"); expect(html).toContain("1000"); expect(html).toContain("30"); expect(html).toContain("总高必须大于底座和箱盖之和");
});
it("makes corner feet distinct from continuous runners and only offers exterior height for crates", () => {
  const render = (enclosure: "slatted" | "none") => renderToStaticMarkup(<TransportAppearanceProvider><PackagingEditor value={{ ...value, packaging: { ...value.packaging, enclosure } }} onChange={() => {}} onValidityChange={() => {}}/></TransportAppearanceProvider>);
  expect(render("slatted")).toContain("不是通长底梁"); expect(render("slatted")).toContain('aria-label="木箱外部总高"');
  expect(render("none")).not.toContain('aria-label="木箱外部总高"');
});
it("provides English labels and height guidance without residual Chinese", () => {
  vi.stubGlobal("document", { documentElement: { lang: "" } }); setAppLanguage("en");
  const html = renderToStaticMarkup(<CrateExteriorHeight value={value} onChange={() => {}} onValidityChange={() => {}}/>);
  expect(html).toContain('aria-label="Crate exterior height"'); expect(html).toContain("including base and lid"); expect(html).not.toMatch(/[\u3400-\u9fff]/u);
});
