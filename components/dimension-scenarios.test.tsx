import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import { DimensionAllowanceFields, DimensionComparisonResults } from "./dimension-scenarios";
import { emptyDimensionAllowance } from "../lib/packing/dimension-allowance";
import { buildDimensionComparison, deriveDimensionScenario } from "../lib/packing/dimension-scenarios";
import { packLoadingWorkflow } from "../lib/packing/pack-loading";
import { setAppLanguage } from "./language";
import type { PackingRequest } from "../lib/packing/types";

afterEach(()=>{vi.stubGlobal("document",{documentElement:{lang:""}});setAppLanguage("zh");vi.unstubAllGlobals();});
it("labels the measurement basis and independent inclusion flags in both languages with converted units",()=>{
  vi.stubGlobal("document",{documentElement:{lang:""}});
  const value={...emptyDimensionAllowance(),increment:{length:6,width:6,height:6},attachments:[{sourceId:"wrap",name:"Film",increment:{length:2,width:2,height:2},weightKg:.2,dimensionsIncluded:true,weightIncluded:false}]};
  const render=()=>renderToStaticMarkup(<DimensionAllowanceFields value={value} onChange={()=>{}} unit="cm" invalid={false} onValidity={()=>{}}/>);
  const zh=render();expect(zh).toContain('aria-label="公差增量 长 (cm)"');expect(zh).toContain('value="0.6"');expect(zh).toContain("尺寸已计入");expect(zh).toContain("重量已计入");
  setAppLanguage("en");const en=render();expect(en).toContain("Increase per face, both sides (×2)");expect(en).toContain("Dimensions already included");expect(en).not.toMatch(/[\u3400-\u9fff]/u);
});
it("keeps the selected conservative metrics, projections and source identity together",()=>{
  const r:PackingRequest={workflow:"direct",mode:"mixed",strategy:"maximum",clearance:0,container:{id:"c",name:"C",length:100,width:400,height:100,doorWidth:400,doorHeight:100,maxWeight:1000},products:[{id:"p",sku:"P",name:"P",length:100,width:100,height:100,weight:10,quantity:4,priority:50,rotationPolicy:"fixed",stackable:false,maxStackLayers:0,color:"#338877",dimensionAllowance:{...emptyDimensionAllowance(),increment:{length:0,width:1,height:0}}}]};
  const nominal=packLoadingWorkflow(r),conservative=packLoadingWorkflow(deriveDimensionScenario(r,"conservative").request),comparison=buildDimensionComparison(r,nominal,conservative);
  const html=renderToStaticMarkup(<DimensionComparisonResults comparison={comparison}/>);
  expect(html).toContain("原箱位复核");expect(html).toContain("不通过");expect(html).toContain('aria-pressed="true">保守方案');expect(html).toContain(comparison.conservative.plan.dimensionScenario!.id);
  expect(html).toContain("导出当前方案坐标 CSV");expect(html).toContain("同一订单的独立方案");expect(html).toContain('>3</td>');expect(html).toContain('>4</td>');
});
