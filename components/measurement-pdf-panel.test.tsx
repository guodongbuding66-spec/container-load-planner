import {afterEach,expect,it,vi} from "vitest";
import {renderToStaticMarkup} from "react-dom/server";
import {SavedMeasurementsPanel} from "./saved-measurements-panel";
import {TransportAppearanceProvider} from "./transport-appearance";
import {setAppLanguage} from "./language";
import type {SceneInspection} from "./use-scene-inspection";
import {reportPlan,solidRecord} from "../tests/measurement-report-fixture";
function view(empty=false,ready=true){return renderToStaticMarkup(<TransportAppearanceProvider><SavedMeasurementsPanel result={reportPlan} inspection={{measurement:null,saved:{items:empty?[]:[{...solidRecord(),visible:false}],ready,mode:"saved",message:"",removed:null,importing:false}} as unknown as SceneInspection}/></TransportAppearanceProvider>);}
afterEach(()=>{vi.stubGlobal("document",{documentElement:{lang:""}});setAppLanguage("zh");vi.unstubAllGlobals();});
it("provides an independent enabled PDF export for hidden saved records with explicit scope",()=>{const h=view();expect(h).toContain(">下载测量 PDF</button>");expect(h).not.toMatch(/disabled=""[^>]*>下载测量 PDF/);expect(h).toContain("含全部已保存记录（含隐藏与历史）");expect(h).toContain("测量 JSON 备份");});
it("disables PDF export while records are absent or not yet loaded",()=>{for(const h of [view(true),view(false,false)])expect(h).toMatch(/disabled=""[^>]*>下载测量 PDF/);});
it("translates the PDF action and backup distinction in English",()=>{vi.stubGlobal("document",{documentElement:{lang:""}});setAppLanguage("en");const h=view();expect(h).toContain("Download measurement PDF");expect(h).toContain("including hidden and historical entries");expect(h).not.toMatch(/[\u3400-\u9fff]/u);});
