import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { ContainerScene } from "./container-scene";
import { TransportAppearanceProvider } from "./transport-appearance";
import { SceneFullscreen } from "./scene-fullscreen";
import { SceneViewToolbar } from "./scene-view-toolbar";
import { parseViewPreferences } from "../lib/packing/view-preferences";

it("migrates old view preferences with summary badges off and preserves independent label choices", () => {
  const old = { labels: true, transparency: 60, dimensionUnit: "cm", dimensionLineColor: "#123456" };
  expect(parseViewPreferences(old)).toMatchObject({ ...old, skuSummaries: false });
  expect(parseViewPreferences({ ...old, labels: false, skuSummaries: true })).toMatchObject({ labels: false, skuSummaries: true });
  expect(parseViewPreferences({ skuSummaries: "true" })).toMatchObject({ skuSummaries: false });
});

it("keeps the fullscreen toggle in the toolbar and the extra playback control inside fullscreen", () => {
  const html = renderToStaticMarkup(<SceneFullscreen toolbar={toggle => <><button>Labels</button>{toggle}</>} fullscreenFooter={<input aria-label="Fullscreen progress" type="range"/>}><div>Model</div></SceneFullscreen>);
  expect(html).toContain("Labels");
  expect(html.indexOf('class="scene-fullscreen-toggle"')).toBeLessThan(html.indexOf("<div>Model</div>"));
  expect(html).toContain('aria-expanded="false"');
  expect(html).not.toContain("Fullscreen progress");
  expect(html).not.toContain('type="range"');
});

it("exposes camera, display and ruler controls above the viewer without opening a disclosure", () => {
  const html = renderToStaticMarkup(<TransportAppearanceProvider><ContainerScene result={null} visibleProducts={new Set()} visibleCount={0} cameraView="perspective" projectionMode="perspective" onCameraViewChange={()=>{}} onProjectionModeChange={()=>{}}/></TransportAppearanceProvider>);
  const header = html.slice(0, html.indexOf('class="scene-workbench-container"'));
  expect(header).toContain('aria-label="三维视图工具栏"');
  expect(header).not.toContain("<details");
  for (const group of ["视角", "显示", "标尺"]) expect(header).toContain(`role="group" aria-label="${group}"`);
  for (const label of ["透视投影", "正交投影", "等轴测", "俯视", "侧视", "箱门", "底视", "后视", "左视", "箱标", "SKU 汇总", "碰撞体", "实物模型", "线框", "透明度", "尺寸", "尺寸单位", "尺寸字号", "标尺样式", "标线颜色", "标尺文字颜色", "重置视图", "保存图片", "全屏"]) {
    expect(header).toContain(label);
  }
  expect(html).not.toContain('class="scene-progress"');
});

it("labels the pallet front view and disables GPU-only controls in the top-view fallback", () => {
  const html = renderToStaticMarkup(<TransportAppearanceProvider><SceneViewToolbar
    cameraView="perspective"
    projectionMode="perspective"
    hasCargo
    hasCollisionBody
    palletOnly
    webglSupported={false}
    fullscreenToggle={null}
    onViewChange={() => {}}
    onProjectionChange={() => {}}
    onReset={() => {}}
    onSave={() => {}}
  /></TransportAppearanceProvider>);
  expect(html).toContain('disabled="" aria-pressed="true">正交投影');
  expect(html).toContain(">正视</button>");
  expect(html).not.toContain(">箱门</button>");
  expect(html).not.toContain("实物模型");
  expect(html).toContain('aria-pressed="true" title="箱标随货物旋转和缩放"');
});
