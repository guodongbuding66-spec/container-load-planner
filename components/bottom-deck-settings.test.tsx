import {renderToStaticMarkup} from "react-dom/server";
import {afterEach,expect,it,vi} from "vitest";
import {BottomDeckSettings} from "./bottom-deck-settings";
import {ForkInterfaceSettings} from "./fork-interface-settings";
import {DEFAULT_PALLET_BUILD} from "../lib/packing/loading-workflow";
import {DEFAULT_PACKAGING,withBottomDeck,baseMeasurements} from "../lib/packing/packaging";
import {setAppLanguage} from "./language";

const config={...DEFAULT_PALLET_BUILD.config,packaging:{...DEFAULT_PACKAGING}};
afterEach(()=>{vi.stubGlobal('document',{documentElement:{lang:''}});setAppLanguage('zh');vi.unstubAllGlobals();});
it("labels the saved selection and does not imply inferred mass, reversibility or rack capability",()=>{
 const html=renderToStaticMarkup(<BottomDeckSettings value={withBottomDeck(config,'none')} onChange={vi.fn()}/>);
 expect(html).toContain('aria-label="托盘底板结构"');expect(html).toContain('value="none" selected');expect(html).toContain('不自动减重');expect(html).toContain('不代表可翻面承重');
});
it("renders the control in English, disabled when blocked and absent for incompatible bases",()=>{
 vi.stubGlobal('document',{documentElement:{lang:''}});setAppLanguage('en');
 const html=renderToStaticMarkup(<BottomDeckSettings value={config} onChange={vi.fn()} disabled/>);
 expect(html).toContain('Pallet bottom construction');expect(html).toContain('disabled');expect(html).not.toMatch(/[\u3400-\u9fff]/u);
 for(const base of ['solid','corner-feet'] as const)expect(renderToStaticMarkup(<BottomDeckSettings value={{...config,packaging:{...config.packaging,base}}} onChange={vi.fn()}/>)).toBe('');
});
it("removes the inapplicable bottom-thickness input while retaining actual measured top dimensions",()=>{
 const c=withBottomDeck({...config,packaging:{...DEFAULT_PACKAGING,measurements:baseMeasurements(config.length,config.width,config.height,DEFAULT_PACKAGING)}},'none');
 const html=renderToStaticMarkup(<ForkInterfaceSettings value={c} onChange={vi.fn()} onValidityChange={vi.fn()}/>);
 expect(html).not.toContain('aria-label="实测底板厚"');expect(html).toContain('aria-label="实测面板厚"');
});
