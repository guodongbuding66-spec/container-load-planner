import {renderToStaticMarkup} from "react-dom/server";
import {afterEach,expect,it,vi} from "vitest";
import {setAppLanguage} from "./language";
import {WorkspaceDraftNotice} from "./workspace-draft-notice";
afterEach(()=>{vi.stubGlobal("document",{documentElement:{lang:""}});setAppLanguage("zh");vi.unstubAllGlobals();});
it("distinguishes a restored 116-carton draft from the current 144-carton demo in both languages",()=>{
 vi.stubGlobal("document",{documentElement:{lang:""}});
 const render=(visible=true,disabled=false)=>renderToStaticMarkup(<WorkspaceDraftNotice visible={visible} cartons={116} demoCartons={144} disabled={disabled} onSample={()=>{}}/>);
 expect(render(false)).toBe("");expect(render()).toContain("当前使用本机草稿");expect(render()).toContain("116");expect(render()).toContain("144");expect(render(true,true)).toContain("disabled");
 setAppLanguage("en");const en=render();expect(en).toContain("Using your local draft");expect(en).toContain("Back up your work");expect(en).not.toMatch(/[\u3400-\u9fff]/u);
});
