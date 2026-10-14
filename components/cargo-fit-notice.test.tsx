import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CargoFitNotice, ZeroLoadNotice } from "./cargo-fit-notice";
import { defaultSolidModel } from "../lib/packing/solid-model";
import { pack } from "../lib/packing/engine";
import { CargoSettings } from "./cargo-settings";
import type { ProductInput } from "../lib/packing/types";
const container = { id: "hq", name: "HQ", length: 12032, width: 2350, height: 2700, doorWidth: 2340, doorHeight: 2597, maxWeight: 28600 };
const p:ProductInput = { id: "tube", sku: "TUBE", name: "Tube", cargoShape: "tube", solidModel: defaultSolidModel("tube",[5000,5000,2000]), length:5000,width:5000,height:2000,weight:42.5,quantity:1,priority:50,rotationPolicy:"fixed",stackable:false,maxStackLayers:0,color:"#338899" };
it("shows centimeter and meter dimensions next to definite vehicle constraints", () => {
  const html=renderToStaticMarkup(<CargoFitNotice product={p} container={container} clearance={10} strategy="maximum" unit="cm"/>);
  expect(html).toContain("500 × 500 × 200 cm");
  expect(html).toContain("5 × 5 × 2 m");
  expect(html).toContain("尺寸单位");
});
it("shows reasons and cargo edits for a zero-capacity result instead of claiming all demand loaded", () => {
  const result=pack({mode:"single",strategy:"maximum",container,clearance:10,products:[p],singleCartonLimit:2});
  const html=renderToStaticMarkup(<ZeroLoadNotice result={result} products={[p]} unit="cm" onEdit={()=>{}}/>);
  expect(html).toContain("未生成可执行装载方案");expect(html).toContain("尺寸单位");expect(html).toContain("修改货物与单位");expect(html).not.toContain("需求已全部装入");
});
it("offers explicit unit selection and vehicle fit feedback inside the model settings",()=>{
  const html=renderToStaticMarkup(<CargoSettings product={p} container={container} clearance={10} mode="single" lengthUnit="cm" weightUnit="kg" onSave={()=>{}} onClose={()=>{}}/>);
  expect(html).toContain('aria-label="货物尺寸单位"');expect(html).toContain("保持实际尺寸");expect(html).toContain("500 × 500 × 200 cm");
  expect(html).toContain('自定义建模工作台');expect(html).toMatch(/>导出(?:<!-- -->)? (?:<!-- -->)?GLB</);
});
