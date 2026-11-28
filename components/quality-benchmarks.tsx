"use client";
import {useEffect,useRef,useState} from "react";
import {qualityCases,BENCHMARK_VERSION,type QualityReport} from "../lib/packing/quality-benchmarks";
import {
  buildPublicBenchmarkSuite,
  runPublicBenchmarkSuite,
  type BenchmarkRunRow,
  type BenchmarkSuiteSummary,
} from "../lib/packing/public-benchmarks";
import {ENGINE_VERSION} from "../lib/packing/engine";
import {QualityHistory} from "./quality-history";
import {ToolSummary} from "./workflow-tools";
import {tr,trText,useLanguage} from "./language";

export function PalletSearchNote({value}:{value?:import("../lib/packing/pallet-search").PalletSearchSummary}){
 useLanguage();if(value?.selected!=="practical-lower-bound")return null;
 return <small className="feature-note">{tr("整托候选复核：","Pallet candidate review: ")}{value.maximumCount} → {value.practicalCount} {tr("箱；采用独立复核的现场候选","cartons; adopted the independently reviewed practical candidate")}</small>;
}

function summarizePublicRows(rows: BenchmarkRunRow[]): BenchmarkSuiteSummary {
  const times = rows.map((r) => r.elapsedMs).sort((a, b) => a - b);
  const pct = (p: number) => {
    if (!times.length) return 0;
    const idx = Math.min(times.length - 1, Math.max(0, Math.ceil((p / 100) * times.length) - 1));
    return Number(times[idx].toFixed(2));
  };
  const utils = rows.map((r) => r.volumeUtilPct);
  const passedRuns = rows.filter((r) => r.oracle.passed && r.engineValid && r.auditErrors === 0).length;
  return {
    totalRuns: rows.length,
    passedRuns,
    totalCollisions: rows.reduce((s, r) => s + r.oracle.collisions, 0),
    totalOob: rows.reduce((s, r) => s + r.oracle.oobCount, 0),
    totalFloating: rows.reduce((s, r) => s + r.oracle.floatingCount, 0),
    totalWeightViolations: rows.filter((r) => r.oracle.weightOverLimit).length,
    totalConservationErrors: rows.reduce((s, r) => s + r.oracle.conservationErrors + r.oracle.kitIntegrityErrors, 0),
    meanVolumeUtilPct: utils.length ? Number((utils.reduce((a, b) => a + b, 0) / utils.length).toFixed(2)) : 0,
    minVolumeUtilPct: utils.length ? Math.min(...utils) : 0,
    maxVolumeUtilPct: utils.length ? Math.max(...utils) : 0,
    p50Ms: pct(50),
    p95Ms: pct(95),
    p99Ms: pct(99),
    rows,
  };
}

function downloadJsonFile(data: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function QualityBenchmarks(){
 useLanguage();
 const [environment,setEnvironment]=useState("");
 const [report,setReport]=useState<QualityReport|null>(null);
 const [running,setRunning]=useState(false);
 const [message,setMessage]=useState("");
 const [show,setShow]=useState(false);
 const worker=useRef<Worker|null>(null);
 const timer=useRef<ReturnType<typeof setTimeout>|null>(null);

 // D01: Public academic benchmark runner (BR1-BR7 + 5 extreme stress cases = 12 cases)
 const [pubStrategy, setPubStrategy] = useState<"maximum" | "practical">("maximum");
 const [pubRunning, setPubRunning] = useState(false);
 const [pubProgress, setPubProgress] = useState<{ done: number; total: number }>({ done: 0, total: 12 });
 const [pubSummary, setPubSummary] = useState<BenchmarkSuiteSummary | null>(null);
 const [pubShowJson, setPubShowJson] = useState(false);
 const pubCancelRef = useRef(false);
 const pubTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

 const stop=()=>{worker.current?.terminate();worker.current=null;if(timer.current)clearTimeout(timer.current);timer.current=null;setRunning(false);};
 const stopPublic=()=>{
  pubCancelRef.current = true;
  if (pubTimerRef.current) {
   clearTimeout(pubTimerRef.current);
   pubTimerRef.current = null;
  }
  setPubRunning(false);
 };
 useEffect(()=>()=>{
  worker.current?.terminate();
  if(timer.current)clearTimeout(timer.current);
  pubCancelRef.current = true;
  if(pubTimerRef.current)clearTimeout(pubTimerRef.current);
 },[]);

 const run=()=>{stop();setReport(null);setMessage("");try{const w=new Worker(new URL("../lib/packing/quality-benchmarks.worker.ts",import.meta.url),{type:"module"});worker.current=w;setRunning(true);w.onmessage=e=>{if(worker.current!==w)return;setReport(e.data.report);if(e.data.done){stop();setMessage(e.data.error?String(e.data.error):"固定案例运行完成。");}};w.onerror=()=>{if(worker.current!==w)return;stop();setMessage("线程异常，保留已完成案例。");};timer.current=setTimeout(()=>{stop();setMessage("达到 120 秒时限，保留部分结果。");},120000);w.postMessage({environment});}catch{stop();setMessage("无法启动基准线程，请使用支持 Worker 的浏览器。");}};

 const runPublic=()=>{
  stopPublic();
  pubCancelRef.current = false;
  const cases = buildPublicBenchmarkSuite(0); // 7 BR1-BR7 + 5 extreme stress cases = 12 cases
  setPubRunning(true);
  setPubProgress({ done: 0, total: cases.length });
  setPubSummary(null);
  const collected: BenchmarkRunRow[] = [];
  let idx = 0;

  const step = () => {
   if (pubCancelRef.current) {
    setPubRunning(false);
    return;
   }
   if (idx >= cases.length) {
    setPubSummary(summarizePublicRows(collected));
    setPubRunning(false);
    return;
   }
   const single = runPublicBenchmarkSuite([cases[idx]], pubStrategy);
   if (single.rows[0]) {
    collected.push(single.rows[0]);
   }
   idx += 1;
   setPubProgress({ done: idx, total: cases.length });
   setPubSummary(summarizePublicRows([...collected]));
   pubTimerRef.current = setTimeout(step, 0);
  };
  pubTimerRef.current = setTimeout(step, 0);
 };

 const brOnlyRows = pubSummary?.rows.filter((r) => r.suite === "BR-weak" || r.suite === "BR-strong") ?? [];
 const brMeanUtil = brOnlyRows.length
  ? Number((brOnlyRows.reduce((s, r) => s + r.volumeUtilPct, 0) / brOnlyRows.length).toFixed(2))
  : null;

 return <details className="upgrade-panel">
  <ToolSummary kind="bearing" title={tr("固定业务基准与算法质量","Fixed business benchmarks and solver quality")} description={tr("独立运行固定案例与 BR1–BR7 公开学术基准，记录装载率、耗时和零信任三维校验结果。","Run fixed cases and BR1–BR7 public academic benchmarks with utilization, latency, and zero-trust 3D oracle checks.")}/>
  <div className="upgrade-body">
   <section className="public-benchmark-box" aria-label={tr("公开学术基准看板","Public academic benchmark dashboard")}>
    <h4>{tr("公开学术基准与极端压力校验（BR1–BR7 + 5 组极端案例）","Public Academic Benchmarks & Extreme Stress Oracle (BR1–BR7 + 5 Extreme)")}</h4>
    <p>{tr("采用 Bischoff–Ratcliff (1995) 标准 20 英尺柜内径（5870×2330×2200 mm）与 5 组极端边界案例，在当前浏览器实时求解并执行独立三维碰撞、越界、悬空、承重与数量守恒校验。","Runs Bischoff–Ratcliff (1995) ISO 20ft container instances (5870×2330×2200 mm) plus 5 extreme stress cases live in your browser with independent 3D collision, OOB, floating, weight, and conservation checks.")}</p>
    <div className="upgrade-actions">
     <label className="public-benchmark-strategy">
      <span>{tr("测试策略","Strategy")}</span>
      <select aria-label={tr("公开基准策略","Public benchmark strategy")} value={pubStrategy} disabled={pubRunning} onChange={(e)=>setPubStrategy(e.target.value as "maximum"|"practical")}>
       <option value="maximum">{tr("高密度（学术对照）","Maximum (Academic)")}</option>
       <option value="practical">{tr("现场实用（95% 上限）","Practical (95% cap)")}</option>
      </select>
     </label>
     <button type="button" className="button primary" disabled={pubRunning} onClick={runPublic}>
      {pubRunning ? tr(`正在运行 ${pubProgress.done}/${pubProgress.total}…`, `Running ${pubProgress.done}/${pubProgress.total}…`) : tr("一键运行 BR1–BR7 公开基准","Run BR1–BR7 Public Benchmarks")}
     </button>
     {pubRunning && <button type="button" className="button" onClick={stopPublic}>{tr("停止","Stop")}</button>}
     <button type="button" className="button" disabled={!pubSummary} onClick={()=>pubSummary && downloadJsonFile({ engineVersion: ENGINE_VERSION, suite: "BR1-BR7 + Extreme (12)", strategy: pubStrategy, generatedAt: new Date().toISOString(), brMeanVolumeUtilPct: brMeanUtil, summary: pubSummary }, `cargofit-br-benchmark-v${ENGINE_VERSION}.json`)}>
      {tr("导出基准报告 JSON","Export Benchmark JSON")}
     </button>
     <button type="button" className="button" disabled={!pubSummary} onClick={()=>setPubShowJson(v=>!v)}>
      {pubShowJson ? tr("收起 JSON","Hide JSON") : tr("查看 JSON","Inspect JSON")}
     </button>
    </div>
    {pubSummary && (
     <>
      <div className="public-benchmark-kpis">
       <div><span>{tr("零信任校验通过","Oracle Pass")}</span><strong>{pubSummary.passedRuns} / {pubSummary.totalRuns}</strong></div>
       <div><span>{tr("BR1–BR7 平均装载率","BR1–BR7 Mean Util")}</span><strong>{brMeanUtil !== null ? `${brMeanUtil}%` : "—"}</strong></div>
       <div><span>{tr("P50 / P95 / P99 耗时","P50 / P95 / P99")}</span><strong>{pubSummary.p50Ms} / {pubSummary.p95Ms} / {pubSummary.p99Ms} ms</strong></div>
       <div><span>{tr("碰撞 / 越界 / 悬空","Collisions / OOB / Float")}</span><strong>{pubSummary.totalCollisions} / {pubSummary.totalOob} / {pubSummary.totalFloating}</strong></div>
      </div>
      <div className="upgrade-table-wrap">
       <table>
        <thead>
         <tr>
          <th>{tr("基准编号与名称","Case")}</th>
          <th>{tr("分类","Suite")}</th>
          <th>{tr("已装 / 需求","Loaded / Req")}</th>
          <th>{tr("体积利用率","Volume Util")}</th>
          <th>ms</th>
          <th>{tr("零信任 3D 校验","3D Oracle")}</th>
         </tr>
        </thead>
        <tbody>
         {pubSummary.rows.map((row) => (
          <tr key={row.id}>
           <td>{row.title}</td>
           <td>{row.suite}</td>
           <td>{row.loadedCount} / {row.requestedCount}</td>
           <td>{row.volumeUtilPct.toFixed(2)}%</td>
           <td>{row.elapsedMs.toFixed(1)}</td>
           <td>{row.oracle.passed && row.engineValid && row.auditErrors === 0 ? tr("通过 (0 违规)","PASS (0 violations)") : tr(`异常 (碰${row.oracle.collisions}/界${row.oracle.oobCount}/悬${row.oracle.floatingCount})`,`FAIL (${row.oracle.collisions}/${row.oracle.oobCount}/${row.oracle.floatingCount})`)}</td>
          </tr>
         ))}
        </tbody>
       </table>
      </div>
      {pubShowJson && <textarea readOnly aria-label={tr("公开基准 JSON 报告","Public benchmark JSON report")} value={JSON.stringify({ engineVersion: ENGINE_VERSION, strategy: pubStrategy, brMeanVolumeUtilPct: brMeanUtil, summary: pubSummary }, null, 2)} />}
     </>
    )}
   </section>

   <p>{BENCHMARK_VERSION}</p>
   <p>{tr("测试不修改当前订单。小案例给出物理最优参考；现场策略另外保留 95% 利用率上限和操作约束，差距不等于校验失败。业务混装案例尚无最优性证明，耗时取决于当前设备。","Tests do not change the current order. Small cases provide physical optimum references. The practical strategy additionally retains its 95% utilization ceiling and operational constraints; a gap is not a validation failure. Business mixes have no optimality proof. Timings depend on this device.")}</p>
   <label>{tr("测试设备备注（可选）","Test device note (optional)")}<input aria-label={tr("测试设备备注","Test device note")} maxLength={120} value={environment} disabled={running} onChange={e=>setEnvironment(e.target.value)}/></label>
   <ul>{qualityCases().map(c=><li key={c.id}>{tr(...c.name)} · {c.exactCount===null?tr("最优未知","Optimum unknown"):`${tr("物理参考","Physical reference")}: ${c.exactCount}`}</li>)}</ul>
   <div className="upgrade-actions"><button className="button" disabled={running} onClick={run}>{tr("运行固定基准","Run fixed benchmarks")}</button><button className="button" disabled={!running} onClick={()=>{stop();setMessage("已停止，保留部分结果。");}}>{tr("停止并保留结果","Stop and retain results")}</button><button className="button" disabled={!report} onClick={()=>setShow(v=>!v)}>{tr("显示基准报告 JSON","Show benchmark report JSON")}</button></div>
   {report&&<><p>{report.engineVersion} · {report.rows.length} / {qualityCases().length*2} · {report.complete?tr("全部运行结束","All runs completed"):tr("部分结果","Partial results")}</p><div className="upgrade-table-wrap"><table><thead><tr><th>{tr("案例／策略","Case / strategy")}</th><th>{tr("箱数／套数","Cartons / kits")}</th><th>{tr("载重 kg","Payload kg")}</th><th>ms</th><th>{tr("距物理参考箱数","Gap to physical reference")}</th><th>{tr("模型校验","Model validation")}</th></tr></thead><tbody>{report.rows.map(r=><tr key={`${r.caseId}/${r.strategy}`}><td>{tr(...r.name)} / {r.strategy==="practical"?tr("现场","Practical"):tr("高密度","Maximum")}<PalletSearchNote value={r.palletSearch}/></td><td>{r.loaded} / {r.sets}</td><td>{r.payloadKg.toFixed(2)}</td><td>{r.elapsedMs.toFixed(1)}</td><td>{r.gapToProof??tr("未知","Unknown")}</td><td>{r.valid?tr("通过","Passed"):tr("失败","Failed")}{r.errors.join(" · ")}</td></tr>)}</tbody></table></div></>}
   {show&&report&&<textarea readOnly aria-label={tr("固定基准完整报告","Complete benchmark report")} value={JSON.stringify(report,null,2)}/>}
   <p role="status">{trText(message)}</p>
   <QualityHistory report={report} running={running}/>
  </div>
 </details>;
}
