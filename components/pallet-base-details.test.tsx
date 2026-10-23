import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import { PalletBaseDetails } from "./pallet-base-details";
import { PalletManifest } from "./pallet-manifest";
import { packLoadingWorkflow } from "../lib/packing/pack-loading";
import { DEFAULT_PALLET_BUILD } from "../lib/packing/loading-workflow";
import { setAppLanguage } from "./language";
const plan = packLoadingWorkflow({ workflow: "palletized", mode: "mixed", strategy: "maximum", clearance: 0,
  container: { id: "c", name: "QA", length: 1000, width: 1000, height: 1000, doorWidth: 1000, doorHeight: 1000, maxWeight: 1000 },
  palletBuild: { ...DEFAULT_PALLET_BUILD, config: { ...DEFAULT_PALLET_BUILD.config, length: 1000, width: 1000, height: 100, weight: 20, maxCargoHeight: 200 }, stackLayers: 3, maxTopLoadKg: 200 },
  products: [{ id: "p", sku: "P", name: "Carton", length: 500, width: 500, height: 200, weight: 10, quantity: 12, priority: 50, rotationPolicy: "upright", stackable: true, maxStackLayers: 0, maxTopLoadKg: 100, color: "#338877" }] });
afterEach(() => { vi.stubGlobal("document", { documentElement: { lang: "" } }); setAppLanguage("zh"); vi.unstubAllGlobals(); });
it("shows an elevated unit's own base, deck surface and complete height without counting the support below", () => {
  const p = plan.pallets!.find(p => p.z === 600)!; expect(p).toBeDefined();
  const h = renderToStaticMarkup(<PalletBaseDetails result={plan} pallet={p}/>);
  expect(h).toContain("1000.0 mm × 1000.0 mm × 100.0 mm"); expect(h).toContain("1000.0 mm × 1000.0 mm × 300.0 mm");
  expect(h).toContain("700.0 mm"); expect(h).toContain("20 kg"); expect(h).toContain("60 kg"); expect(h).toContain("<dd>4</dd>");
});
it("keeps base dimensions explicit in the manifest and shows localized unit conversions", () => {
  vi.stubGlobal("document", { documentElement: { lang: "" } }); setAppLanguage("en");
  const h = renderToStaticMarkup(<><PalletBaseDetails result={plan} pallet={plan.pallets![0]} unit="cm" precision={2}/><PalletManifest result={plan}/></>);
  expect(h).toContain("Base L × W × H"); expect(h).toContain("Complete unit height"); expect(h).toContain("100.00 cm × 100.00 cm × 10.00 cm"); expect(h).toContain("Elevated units retain their bases and tare"); expect(h).not.toMatch(/[\u3400-\u9fff]/u);
});
