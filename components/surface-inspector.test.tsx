import {afterEach,expect,it,vi} from "vitest";
import {renderToStaticMarkup} from "react-dom/server";
import {SceneInspector} from "./scene-inspector";
import {TransportAppearanceProvider} from "./transport-appearance";
import {setAppLanguage} from "./language";
import type {SceneInspection} from "./use-scene-inspection";
import {EMPTY_SECTION} from "../lib/packing/inspection";
import {pack} from "../lib/packing/engine";
import {CONTAINER_PRESETS,SAMPLE_PRODUCTS} from "../lib/packing/presets";
const plan=pack({mode:"mixed",strategy:"practical",products:[{...SAMPLE_PRODUCTS[0],id:"u",sku:"U-PROFILE",name:"U",quantity:1,length:1000,width:100,height:1000,cargoShape:"u-profile",rotationPolicy:"fixed"}],container:CONTAINER_PRESETS[2],clearance:10}),box={...plan.placements[0],sku:"U-PROFILE"};
function view(cut=false,curve=false){return renderToStaticMarkup(<TransportAppearanceProvider><SceneInspector result={curve?{...plan,cargoDetails:{u:{cargoShape:"cylinder"}}}:plan} selected={box} inspection={{value:{basis:"surface",mode:"points",wall:"x-",points:[],snaps:[],captures:[],boxes:[],locked:false,section:{...EMPTY_SECTION,axis:cut?"z":"off"}},displayBoxes:[box],measurement:null,pickedCount:0,saved:{items:[],ready:true,mode:"saved",message:"",removed:null,importing:false}} as unknown as SceneInspection} onClearSelection={()=>{}}/></TransportAppearanceProvider>);}
afterEach(()=>{vi.stubGlobal("document",{documentElement:{lang:""}});setAppLanguage("zh");vi.unstubAllGlobals();});
it("renders solid basis, 16 real U vertices, coordinates and precise scope",()=>{const h=view();expect(h).toContain('aria-label="测量依据"');expect(h).toContain('value="15"');expect(h).not.toContain('value="16"');expect(h).toContain("XYZ");expect(h).toContain("不是沿面长度或两件货物的全局最短净距");});
it("offers no misleading exact picker for unsupported or cut solids",()=>{expect(view(true)).toContain("请关闭剖切");expect(view(false,true)).toContain("暂不支持实体取点");expect(view(true)).not.toContain(">取此点<");expect(view(false,true)).not.toContain(">取此点<");});
it("renders all measurement controls and caveats in English",()=>{vi.stubGlobal("document",{documentElement:{lang:""}});setAppLanguage("en");const h=view();expect(h).toContain("Regular solid surface");expect(h).not.toMatch(/[\u3400-\u9fff]/u);});
