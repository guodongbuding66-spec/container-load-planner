import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { ContainerScene } from "./container-scene";
import { TransportAppearanceProvider } from "./transport-appearance";
import { SceneFullscreen } from "./scene-fullscreen";
import { parseViewPreferences } from "../lib/packing/view-preferences";

it("migrates old view preferences with summary badges off and preserves independent label choices", () => {
  const old = { labels: true, transparency: 60, dimensionUnit: "cm", dimensionLineColor: "#123456" };
  expect(parseViewPreferences(old)).toMatchObject({ ...old, skuSummaries: false });
  expect(parseViewPreferences({ ...old, labels: false, skuSummaries: true })).toMatchObject({ labels: false, skuSummaries: true });
  expect(parseViewPreferences({ skuSummaries: "true" })).toMatchObject({ skuSummaries: false });
});

it("keeps standalone playback as the only progress slider outside fullscreen", () => {
  const html = renderToStaticMarkup(<SceneFullscreen toolbar={<button>Labels</button>} fullscreenFooter={<input aria-label="Fullscreen progress" type="range"/>}><div>Model</div></SceneFullscreen>);
  expect(html).toContain("Labels");
  expect(html).not.toContain("Fullscreen progress");
  expect(html).not.toContain('type="range"');
});

it("keeps dimension and label toggles visible and groups appearance options before the canvas", () => {
  const html = renderToStaticMarkup(<TransportAppearanceProvider><ContainerScene result={null} visibleProducts={new Set()} visibleCount={0} cameraView="perspective" projectionMode="perspective" onCameraViewChange={()=>{}} onProjectionModeChange={()=>{}}/></TransportAppearanceProvider>);
  const header = html.slice(0, html.indexOf('class="scene-workbench-container"'));
  for (const label of ["箱标", "SKU 汇总", "尺寸单位", "尺寸字号", "标尺样式", "标线颜色", "标尺文字颜色", "透明度"]) expect(header).toContain(label);
  const options = header.indexOf('<details class="scene-display-options">');
  expect(options).toBeGreaterThan(0);
  expect(header.slice(0, options)).toContain(">尺寸</button>");
  expect(header.slice(options)).toContain("显示设置</summary>");
  expect(html).not.toContain('class="scene-progress"');
});
