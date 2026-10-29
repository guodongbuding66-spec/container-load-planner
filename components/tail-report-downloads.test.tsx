import {expect,it,vi,afterEach} from "vitest";
import {renderToStaticMarkup} from "react-dom/server";
import {TailReportDownloads} from "./tail-report-downloads";
import {setAppLanguage} from "./language";
afterEach(()=>{setAppLanguage("zh");vi.unstubAllGlobals();});
it("labels the report as a preview and keeps partial/no-candidate downloads unavailable",()=>{
 const getReport=vi.fn(),partial=renderToStaticMarkup(<TailReportDownloads enabled={false} hasCandidate={false} getReport={getReport}/>);expect(partial.match(/disabled=""/g)).toHaveLength(2);const noCandidate=renderToStaticMarkup(<TailReportDownloads enabled={true} hasCandidate={false} getReport={getReport}/>);expect(noCandidate.match(/disabled=""/g)).toHaveLength(1);expect(noCandidate).toContain("未采用预览");expect(getReport).not.toHaveBeenCalled();
 vi.stubGlobal("document",{documentElement:{lang:""}});setAppLanguage("en");const en=renderToStaticMarkup(<TailReportDownloads enabled={true} hasCandidate={true} getReport={getReport}/>);expect(en).toContain("Download trial report JSON");expect(en).toContain("unapplied preview");expect(en).not.toMatch(/[\u3400-\u9fff]/u);
});
