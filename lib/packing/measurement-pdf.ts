import {buildRasterPdf,type RasterPage} from "./pdf-raster";
import {layoutMeasurementReport,MEASUREMENT_PAGE} from "./measurement-report-layout";
import {measurementReportProjection} from "./measurement-report-projection";
import type {MeasurementReport} from "./measurement-report";
const font=(size:number,bold=false)=>`${bold?700:400} ${size}px 'Noto Sans SC','Microsoft YaHei',Arial,sans-serif`;
/** Generates bytes only. The UI owns download timing, cancellation and object-URL cleanup. */
export async function renderMeasurementPdf(report:MeasurementReport):Promise<Uint8Array>{
  await document.fonts.ready;
  const canvas=document.createElement("canvas");canvas.width=MEASUREMENT_PAGE.width;canvas.height=MEASUREMENT_PAGE.height;
  const ctx=canvas.getContext("2d");if(!ctx)throw Error("PDF canvas unavailable");
  const pages=layoutMeasurementReport(report,(text,size,bold)=>{ctx.font=font(size,bold);return ctx.measureText(text).width;}),images:RasterPage[]=[];
  for(const [pageIndex,page] of pages.entries()){
    ctx.fillStyle="#ffffff";ctx.fillRect(0,0,canvas.width,canvas.height);
    for(const b of page.blocks){
      if(b.kind==="text"){ctx.font=font(b.size,b.bold);ctx.fillStyle=b.color;ctx.fillText(b.text,b.x,b.y);continue;}
      for(const [i,view] of (["top","side","door"] as const).entries()){
        const rect={x:b.x+i*(b.width/3+6),y:b.y,width:b.width/3-12,height:b.height},p=measurementReportProjection(report.entries[b.entry],view,rect);
        ctx.strokeStyle="#d9e7ea";ctx.lineWidth=2;ctx.strokeRect(rect.x,rect.y,rect.width,rect.height);ctx.font=font(23,true);ctx.fillStyle="#234653";ctx.fillText(p.axes,rect.x+14,rect.y+28);
        ctx.beginPath();for(const [a,c] of p.segments){ctx.moveTo(a.x,a.y);ctx.lineTo(c.x,c.y);}ctx.strokeStyle="#6a919b";ctx.lineWidth=2;ctx.stroke();
        ctx.beginPath();ctx.moveTo(p.a.x,p.a.y);ctx.lineTo(p.b.x,p.b.y);ctx.strokeStyle=report.entries[b.entry].current?"#467ee6":"#925500";ctx.lineWidth=4;ctx.stroke();
        const together=Math.hypot(p.a.x-p.b.x,p.a.y-p.b.y)<24;
        for(const [index,point] of [p.a,p.b].entries()){ctx.beginPath();ctx.arc(point.x,point.y,6,0,Math.PI*2);ctx.fillStyle="#137d83";ctx.fill();if(index===1&&together)continue;ctx.font=font(23,true);ctx.fillStyle="#234653";ctx.fillText(together?"A/B":index===0?"A":"B",Math.min(point.x+9,rect.x+rect.width-55),Math.max(rect.y+55,point.y-10));}
      }
    }
    ctx.strokeStyle="#d9e7ea";ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(100,2400);ctx.lineTo(1700,2400);ctx.stroke();ctx.font=font(22);ctx.fillStyle="#234653";
    ctx.fillText(`${report.language==="en"?"Page":"页"} ${pageIndex+1} / ${pages.length} | ${report.generatedAt} | ${report.unit}`,100,2460);
    const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(Error("PDF image encoding failed")),"image/jpeg",.95));images.push({jpeg:new Uint8Array(await blob.arrayBuffer()),width:canvas.width,height:canvas.height});
  }
  return buildRasterPdf(images);
}
