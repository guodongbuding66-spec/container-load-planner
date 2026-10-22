import {BENCHMARK_VERSION,qualityCases,type QualityReport,type QualityRow} from "./quality-benchmarks";

export const QUALITY_HISTORY_LIMIT=8;
export const QUALITY_REPORT_BYTES=2_000_000;
export const QUALITY_ARCHIVE_BYTES=8_000_000;
export const QUALITY_HISTORY_KEY="cargo-fit-quality-history-v1";
const invalid=()=>new Error("基准报告格式或数据无效 / Invalid benchmark report format or data");
const tooLarge=()=>new Error("基准文件超过大小限制 / Benchmark file exceeds the size limit");
const bytes=(s:string)=>new TextEncoder().encode(s).length;
function object(v:unknown):Record<string,unknown>{if(!v||typeof v!=="object"||Array.isArray(v))throw invalid();return v as Record<string,unknown>;}
function text(v:unknown,max:number){if(typeof v!=="string"||!v.trim()||v.length>max)throw invalid();return v;}
function count(v:unknown){if(!Number.isSafeInteger(v)||Number(v)<0||Number(v)>1_000_000)throw invalid();return Number(v);}
function number(v:unknown,max:number){if(typeof v!=="number"||!Number.isFinite(v)||v<0||v>max)throw invalid();return v;}
function token(v:unknown,max:number){const s=text(v,max);if(!/^[A-Za-z0-9][A-Za-z0-9._+:-]*$/.test(s))throw invalid();return s;}
const strategies=["practical","maximum"] as const;
const pair=(r:Pick<QualityRow,"caseId"|"strategy">)=>`${r.caseId}/${r.strategy}`;
function inputJson(v:unknown,depth=0,budget={nodes:0}):void {
  if(depth>24||++budget.nodes>5000)throw invalid();
  if(v===null||typeof v==="boolean")return;
  if(typeof v==="number"){if(!Number.isFinite(v))throw invalid();return;}
  if(typeof v==="string"){if(v.length>10000)throw invalid();return;}
  if(Array.isArray(v)){for(const x of v)inputJson(x,depth+1,budget);return;}
  for(const [k,x]of Object.entries(object(v))){if(["__proto__","prototype","constructor"].includes(k))throw invalid();inputJson(x,depth+1,budget);}
}
/** Exact JSON change detection, not authentication or a collision/strength check. */
export function canonicalQualityInput(v:unknown):string {
  if(Array.isArray(v))return `[${v.map(canonicalQualityInput).join(",")}]`;
  if(v&&typeof v==="object")return `{${Object.entries(v).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,x])=>`${JSON.stringify(k)}:${canonicalQualityInput(x)}`).join(",")}}`;
  return JSON.stringify(v);
}
function parseRow(value:unknown):QualityRow {
  const v=object(value),caseId=token(v.caseId,100),strategy=v.strategy;
  if(!strategies.includes(strategy as never)||!Array.isArray(v.name)||v.name.length!==2||typeof v.valid!=="boolean"||!Array.isArray(v.errors)||v.errors.length>32)throw invalid();
  const errors=v.errors.map(x=>text(x,2000)),exactCount=v.exactCount===null?null:count(v.exactCount),loaded=count(v.loaded),sets=count(v.sets);
  if(sets>loaded||v.valid&&errors.length||exactCount!==null&&v.valid&&loaded>exactCount||v.gapToProof!==(exactCount===null?null:exactCount-loaded))throw invalid();
  const r:QualityRow={caseId,strategy:strategy as QualityRow["strategy"],name:[text(v.name[0],200),text(v.name[1],200)],proof:text(v.proof,2000),exactCount,loaded,sets,payloadKg:number(v.payloadKg,1e12),elapsedMs:number(v.elapsedMs,1e9),valid:v.valid,errors,gapToProof:v.gapToProof as number|null};
  if(v.input!==undefined){const i=object(v.input);inputJson(i);object(i.request);if(i.exactCount!==r.exactCount||i.proof!==r.proof)throw invalid();r.input=JSON.parse(JSON.stringify({request:i.request,exactCount:i.exactCount,proof:i.proof}));}
  if(v.palletSearch!==undefined){const p=object(v.palletSearch),maximumCount=count(p.maximumCount),practicalCount=p.practicalCount===null?null:count(p.practicalCount);
    if(!["maximum","practical-lower-bound"].includes(String(p.selected))||!["not-needed","kept-maximum","adopted-lower-bound","rejected","unavailable"].includes(String(p.comparison)))throw invalid();
    const adopted=p.selected==="practical-lower-bound";
    if(adopted!==(p.comparison==="adopted-lower-bound")||adopted&&(practicalCount===null||practicalCount<=maximumCount||loaded!==practicalCount)||!adopted&&loaded!==maximumCount)throw invalid();
    r.palletSearch={maximumCount,practicalCount,selected:p.selected as NonNullable<QualityRow["palletSearch"]>["selected"],comparison:p.comparison as NonNullable<QualityRow["palletSearch"]>["comparison"]};
  }
  return r;
}
export function parseQualityReport(value:unknown):QualityReport {
  const v=object(value);if(v.format!=="cargo-fit-quality-benchmarks"||v.version!==1||typeof v.complete!=="boolean"||!Array.isArray(v.rows)||v.rows.length>96)throw invalid();
  const rows=v.rows.map(parseRow),keys=new Set(rows.map(pair)),createdAt=text(v.createdAt,40),caseVersion=token(v.caseVersion,120);
  if(keys.size!==rows.length||!Number.isFinite(Date.parse(createdAt))||new Date(createdAt).toISOString()!==createdAt)throw invalid();
  if(caseVersion===BENCHMARK_VERSION){const expected=new Set(qualityCases().flatMap(c=>strategies.map(strategy=>pair({caseId:c.id,strategy}))));if([...keys].some(k=>!expected.has(k))||v.complete!==(keys.size===expected.size))throw invalid();}
  const environment=v.environment===undefined?undefined:typeof v.environment==="string"&&v.environment.length<=120?v.environment.trim():(()=>{throw invalid();})();
  const result:QualityReport={format:"cargo-fit-quality-benchmarks",version:1,engineVersion:token(v.engineVersion,80),caseVersion,createdAt,complete:v.complete,rows,...(environment?{environment}:{})};
  if(bytes(JSON.stringify(result))>QUALITY_REPORT_BYTES)throw tooLarge();return result;
}
export function parseQualityArchive(contents:string):QualityReport[] {
  if(bytes(contents)>QUALITY_ARCHIVE_BYTES)throw tooLarge();
  let raw:unknown;try{raw=JSON.parse(contents);}catch{throw invalid();}const v=object(raw);
  if(v.format==="cargo-fit-quality-benchmarks")return [parseQualityReport(v)];
  if(v.format!=="cargo-fit-quality-history"||v.version!==1||!Array.isArray(v.reports)||v.reports.length>QUALITY_HISTORY_LIMIT)throw invalid();
  const reports=v.reports.map(parseQualityReport);if(new Set(reports.map(qualityReportKey)).size!==reports.length)throw invalid();return reports;
}
export const qualityReportKey=(r:QualityReport)=>`${r.engineVersion}/${r.createdAt}`;
/** Validate the complete transaction before changing any existing history. */
export function mergeQualityHistory(current:QualityReport[],incoming:QualityReport[]):QualityReport[] {
  const out=parseQualityArchive(JSON.stringify({format:"cargo-fit-quality-history",version:1,reports:current}));
  for(const raw of [...incoming].reverse()){const r=parseQualityReport(raw),old=out.find(x=>qualityReportKey(x)===qualityReportKey(r));if(old){if(canonicalQualityInput(old)!==canonicalQualityInput(r))throw new Error("相同基准时间标识的内容冲突 / Conflicting benchmark contents share the same time identifier");continue;}out.unshift(r);}
  return out.slice(0,QUALITY_HISTORY_LIMIT);
}
export function serializeQualityHistory(reports:QualityReport[]):string {
  const value=JSON.stringify({format:"cargo-fit-quality-history",version:1,reports:reports.map(parseQualityReport)},null,2);parseQualityArchive(value);return value;
}
export type QualityScope="same-input"|"legacy-no-input"|"input-changed"|"case-version-changed"|"missing-run";
export type QualityComparisonRow={key:string;name:[string,string];strategy:QualityRow["strategy"];baseline?:QualityRow;current?:QualityRow;scope:QualityScope;cartonDelta:number|null;kitDelta:number|null;payloadDelta:number|null;elapsedDeltaMs:number|null;newFailure:boolean};
export function compareQualityReports(baseline:QualityReport,current:QualityReport) {
  const a=parseQualityReport(baseline),b=parseQualityReport(current),left=new Map(a.rows.map(r=>[pair(r),r])),right=new Map(b.rows.map(r=>[pair(r),r]));
  const expected=new Map(qualityCases().flatMap(c=>strategies.map(strategy=>[pair({caseId:c.id,strategy}),canonicalQualityInput(JSON.parse(JSON.stringify({request:{...c.request,strategy},exactCount:c.exactCount,proof:c.proof})))]as const)));
  const rows:QualityComparisonRow[]=[...new Set([...right.keys(),...left.keys()])].map(key=>{
    const old=left.get(key),now=right.get(key),row=now??old!;let scope:QualityScope="same-input";
    if(!old||!now)scope="missing-run";
    else if(a.caseVersion!==b.caseVersion||a.caseVersion!==BENCHMARK_VERSION)scope="case-version-changed";
    else if([old,now].some(r=>r.input&&canonicalQualityInput(r.input)!==expected.get(key)))scope="input-changed";
    else if(!old.input||!now.input)scope="legacy-no-input";
    const comparable=scope==="same-input";
    return {key,name:row.name,strategy:row.strategy,baseline:old,current:now,scope,cartonDelta:comparable?now!.loaded-old!.loaded:null,kitDelta:comparable?now!.sets-old!.sets:null,payloadDelta:comparable?now!.payloadKg-old!.payloadKg:null,elapsedDeltaMs:comparable?now!.elapsedMs-old!.elapsedMs:null,newFailure:comparable&&old!.valid&&!now!.valid};
  });
  return {rows,sameEnvironment:!!a.environment&&a.environment===b.environment,sameInputRows:rows.filter(r=>r.scope==="same-input").length,newFailures:rows.filter(r=>r.newFailure).length};
}
