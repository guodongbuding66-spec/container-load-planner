import type {MeasurementReport,MeasurementReportEntry} from "./measurement-report";
export const MEASUREMENT_PAGE={width:1800,height:2546,left:100,right:1700,bottom:2350} as const;
export type ReportTextBlock={kind:"text";text:string;x:number;y:number;size:number;bold:boolean;color:string};
export type ReportPlotBlock={kind:"plot";entry:number;x:number;y:number;width:number;height:number};
export type MeasurementReportPage={entry:number|null;blocks:Array<ReportTextBlock|ReportPlotBlock>};
export type TextWidth=(text:string,size:number,bold:boolean)=>number;
/** Unicode codepoints are kept intact. Explicit line breaks and every character are retained. */
export function wrapMeasurementText(value:string,maxWidth:number,size:number,bold:boolean,width:TextWidth){
  const lines:string[]=[];for(const paragraph of value.split("\n")){let line="";for(const char of paragraph){if(line&&width(line+char,size,bold)>maxWidth){lines.push(line);line="";}line+=char;}lines.push(line);}return lines;
}
export function layoutMeasurementReport(report:MeasurementReport,width:TextWidth):MeasurementReportPage[]{
  const pages:MeasurementReportPage[]=[],en=report.language==="en",t=(zh:string,english:string)=>en?english:zh;
  let page!:MeasurementReportPage,y=0,entry:MeasurementReportEntry|undefined;
  const text=(value:string,size:number,bold=false,color="#234653")=>{for(const line of wrapMeasurementText(value,1600,size,bold,width)){page.blocks.push({kind:"text",text:line,x:100,y,size,bold,color});y+=Math.ceil(size*1.45);}};
  const start=(continued=false)=>{
    page={entry:entry?entry.number-1:null,blocks:[]};pages.push(page);y=90;text("CARGOFIT / MEASUREMENTS",24,true,"#137d83");y+=20;
    text(entry?`${t("测量","Measurement")} ${entry.number} / ${report.entries.length}${continued?t("（续）"," (continued)"):""}`:t("测量复核报告","Measurement review report"),42,true);y+=14;
    if(entry){text(entry.status,27,true,entry.current?"#137d83":"#925500");text(entry.title,34,true);text(`${t("导出时范围","Export change marker")}: ${report.scope}`,23);y+=10;text(entry.distance,44,true,entry.current?"#137d83":"#925500");y+=16;}
    else y+=10;
  };
  const field=(value:string,size=27,bold=false,color="#234653")=>{for(const line of wrapMeasurementText(value,1600,size,bold,width)){if(y+Math.ceil(size*1.45)>MEASUREMENT_PAGE.bottom)start(true);page.blocks.push({kind:"text",text:line,x:100,y,size,bold,color});y+=Math.ceil(size*1.45);}y+=10;};
  start();for(const line of report.context)field(line,27,true);y+=24;for(const note of report.notes)field(note,26);y+=24;
  field(t("记录索引：状态仅说明方案匹配，不等于现场或结构验收。","Record index: matching the plan is not field or structural acceptance."),28,true);
  for(const e of report.entries)field(`${e.number}. ${e.title} | ${e.distance} | ${e.current?t("当前有效","CURRENT"):t("需重新测量","REMEASURE")}`,26,false,e.current?"#234653":"#925500");
  for(const e of report.entries){
    entry=e;start();
    field(e.current?t("来源快照投影，仅定位端点；不是当前全柜图。","Recorded source projections locate endpoints; this is not a full current load view."):t("历史来源快照投影；不得用于当前箱位。","HISTORICAL source projections: do not use for current positions."),24,true,e.current?"#234653":"#925500");
    page.blocks.push({kind:"plot",entry:e.number-1,x:100,y:y+10,width:1600,height:340});y+=390;
    for(const f of e.fields)field(f.text,26,!!f.emphasis);
  }
  return pages;
}
