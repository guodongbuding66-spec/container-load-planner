"use client";
import {useEffect,useRef,useState} from "react";
import {createMeasurementReport,type MeasurementReportOptions} from "../lib/packing/measurement-report";
import type {PackingResult} from "../lib/packing/types";
import type {SavedMeasurement} from "../lib/packing/saved-measurements";
export function useMeasurementPdf(){
  const [status,setStatus]=useState<"idle"|"busy"|"done"|"error">("idle"),live=useRef(true),busy=useRef(false);
  useEffect(()=>{live.current=true;return ()=>{live.current=false;};},[]);
  const download=async(plan:PackingResult,items:SavedMeasurement[],options:MeasurementReportOptions)=>{
    if(busy.current)return;busy.current=true;setStatus("busy");
    try{
      const report=createMeasurementReport(plan,items,options),{renderMeasurementPdf}=await import("../lib/packing/measurement-pdf"),bytes=await renderMeasurementPdf(report);
      if(!live.current)return;
      const url=URL.createObjectURL(new Blob([bytes as BlobPart],{type:"application/pdf"}));
      try{const a=document.createElement("a");a.href=url;a.download=`CargoFit_measurements_${report.generatedAt.slice(0,10)}_${report.scope}_${report.language}.pdf`;a.click();}finally{setTimeout(()=>URL.revokeObjectURL(url),10000);}
      setStatus("done");
    }catch{if(live.current)setStatus("error");}finally{busy.current=false;}
  };
  return {status,download};
}
