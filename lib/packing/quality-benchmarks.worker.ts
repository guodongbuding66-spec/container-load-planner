/// <reference lib="webworker" />
import {qualityCases,runQualityCase,qualityReport,type QualityRow} from "./quality-benchmarks";
self.onmessage=()=>{const rows:QualityRow[]=[];try{for(const c of qualityCases())for(const strategy of ["practical","maximum"] as const){rows.push(runQualityCase(c.id,strategy));self.postMessage({report:qualityReport(rows),done:false});}self.postMessage({report:qualityReport(rows),done:true});}catch(e){self.postMessage({report:qualityReport(rows),error:e instanceof Error?e.message:String(e),done:true});}};
