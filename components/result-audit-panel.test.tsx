import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ResultAuditPanel } from "./result-audit-panel";
import { setAppLanguage } from "./language";
import type { ResultAudit } from "../lib/packing/result-audit";
const report:ResultAudit={checks:[{id:"quantities",state:"pass",message:["箱数一致","Carton counts agree"],items:[]},{id:"strength",state:"unverified",message:["缺少额定上压","Top-load rating is missing"],items:["SKU-A"]}],hasErrors:false,completeCoordinates:true,passed:1,failed:0,unverified:1};
beforeEach(()=>vi.stubGlobal("document",{documentElement:{lang:""}}));
afterEach(()=>{setAppLanguage("zh");vi.unstubAllGlobals();});
it("keeps consistent reports collapsed, with visible pending-data counts and no export warning",()=>{
  const html=renderToStaticMarkup(<ResultAuditPanel report={report}/>);
  expect(html).toContain("方案数据一致性");expect(html).not.toContain('open=""');
  expect(html).toContain("项待复核");expect(html).toContain('data-audit-state="unverified"');expect(html).toContain("SKU-A");expect(html).not.toContain('role="alert"');
});
it("opens failed reports and explains the paused page exports in English without Chinese residue",()=>{
  setAppLanguage("en");
  const failed:ResultAudit={...report,checks:[{id:"quantities",state:"fail",message:["箱数不一致","Carton counts disagree"],items:["SKU-A"]}],hasErrors:true,passed:0,failed:1,unverified:0};
  const html=renderToStaticMarkup(<ResultAuditPanel report={failed}/>);
  expect(html).toContain('open=""');expect(html).toContain('role="alert"');expect(html).toContain("Plan exports on this page are paused");expect(html).toContain("Carton counts disagree");
  expect(html).not.toMatch(/[\u3400-\u9fff]/u);
});
