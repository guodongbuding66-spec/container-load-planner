import {afterEach,expect,it,vi} from "vitest";
import {renderToStaticMarkup} from "react-dom/server";
import {TransportAppearanceProvider} from "./transport-appearance";
import {SavedMeasurementsPanel} from "./saved-measurements-panel";
import {setAppLanguage} from "./language";
import {captureMeasurement} from "../lib/packing/saved-measurements";
import {EMPTY_SECTION} from "../lib/packing/inspection";
import {pack} from "../lib/packing/engine";
import {CONTAINER_PRESETS,SAMPLE_PRODUCTS} from "../lib/packing/presets";
import type {SceneInspection} from "./use-scene-inspection";
const plan=pack({mode:"mixed",strategy:"practical",container:CONTAINER_PRESETS[2],products:SAMPLE_PRODUCTS,clearance:10});
const item=captureMeasurement(plan,"wall",[plan.placements[0]],[],"face","x-",EMPTY_SECTION,"Rear wall","test",'2026-10-22T09:00:00.000Z');
function view(items=[item],mode="saved",result=plan){return renderToStaticMarkup(<TransportAppearanceProvider><SavedMeasurementsPanel result={result} inspection={{measurement:null,saveMeasurement:()=>false,saved:{items,ready:true,mode,message:"",removed:null,importing:false,patch(){},remove(){},undo(){}}} as unknown as SceneInspection}/></TransportAppearanceProvider>);}
afterEach(()=>{vi.stubGlobal("document",{documentElement:{lang:""}});setAppLanguage("zh");vi.unstubAllGlobals();});
it("labels current envelope records with targets and explicit independent backup scope",()=>{const h=view();expect(h).toContain("当前有效");expect(h).toContain("完整外包络");expect(h).toContain(plan.placements[0].id);expect(h).toContain("工作区备份、PDF 和装柜清单不包含");expect(h).toContain('aria-label="测量名称 1"');expect(h).toContain('aria-label="显示测量 1"');});
it("retains old numbers while marking switched plans as requiring remeasurement",()=>{expect(view([item],"saved",{...plan,strategy:"maximum"})).toContain("方案已变化，需重新测量");});
it("offers an actionable empty state and disables saving an incomplete measurement",()=>{const h=view([]);expect(h).toContain("完成一次测量后");expect(h).toMatch(/disabled=""[^>]*>保存当前测量/);});
it("protects corrupt originals and explains stale-page write conflicts",()=>{expect(view([item],"corrupt")).toContain("下载原始测量记录");expect(view([item],"conflict")).toContain("本次未覆盖");expect(view([item],"session")).toContain("刷新前请下载");});
it("renders controls, status and scope in English without untranslated UI",()=>{vi.stubGlobal("document",{documentElement:{lang:""}});setAppLanguage("en");const h=view([item],"conflict");expect(h).toContain("Download measurements");expect(h).toContain("Current");expect(h).toContain("did not overwrite");expect(h).not.toMatch(/[\u3400-\u9fff]/u);});
