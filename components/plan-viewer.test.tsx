import {renderToStaticMarkup} from "react-dom/server";
import {expect,it,vi} from "vitest";
import {PlanViewer} from "./plan-viewer";
import {packagingCapacityFixture} from "../tests/packaging-capacity-fixture";
import {packLoadingWorkflow} from "../lib/packing/pack-loading";
import {TransportAppearanceProvider} from "./transport-appearance";
vi.mock("./use-webgl-support",()=>({useWebGLSupport:()=>false}));
it("renders actual coordinates and an explicit fallback inside the no-WebGL viewer dialog",()=>{
 const plan=packLoadingWorkflow(packagingCapacityFixture());
 const html=renderToStaticMarkup(<TransportAppearanceProvider><PlanViewer plans={[plan]} onClose={()=>{}}/></TransportAppearanceProvider>);
 expect(html).toContain("真实坐标俯视图");expect(html).toContain("viewer-fallback");expect(html).toContain("当前浏览器无法使用三维渲染");expect(html).toContain(plan.summaries[0].sku);
});
