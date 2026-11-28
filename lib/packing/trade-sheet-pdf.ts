import {buildRasterPdf,type RasterPage} from "./pdf-raster";

/** Keep ordinary words intact; split only tokens wider than a full PDF line. */
export function wrapTradePdfText(value:string,maxWidth:number,measure:(text:string)=>number):string[] {
 const rows:string[]=[];let current="";
 const flush=()=>{if(current.trim())rows.push(current.trimEnd());current="";};
 for(const token of value.match(/\s+|\S+/gu)??[]){
  if(/^\s+$/u.test(token)){if(current&&!current.endsWith(" "))current+=" ";continue;}
  if(current&&measure(current+token)>maxWidth)flush();
  if(measure(token)<=maxWidth){current+=token;continue;}
  for(const char of token){if(current&&measure(current+char)>maxWidth)flush();current+=char;}
 }
 flush();return rows.length?rows:[""];
}

/** Render our own document HTML into real, paginated PDF bytes (including Unicode). */
export async function downloadTradeSheetPdf(html:string,filename:string) {
 await document.fonts.ready;
 const doc=new DOMParser().parseFromString(html,"text/html");
 const width=1240,height=1754,margin=70,pages:RasterPage[]=[];
 const canvas=document.createElement("canvas");canvas.width=width;canvas.height=height;
 const ctx=canvas.getContext("2d");if(!ctx)throw Error("PDF canvas unavailable");
 const clean=(s:string|null|undefined)=>s?.replace(/\s+/g," ").trim()??"";
 const line=(value:string,x:number,y:number,maxWidth:number,size=25,bold=false)=>{
  ctx.font=`${bold?700:400} ${size}px 'Noto Sans SC','Microsoft YaHei',Arial,sans-serif`;ctx.fillStyle="#0f172a";
  const rows=wrapTradePdfText(value,maxWidth,text=>ctx.measureText(text).width);
  rows.forEach((text,row)=>ctx.fillText(text,x,y+row*38));return y+rows.length*38;
 };
 const start=(title:string)=>{ctx.fillStyle="white";ctx.fillRect(0,0,width,height);line(title,margin,105,width-2*margin,32,true);ctx.strokeStyle="#cbd5e1";ctx.beginPath();ctx.moveTo(margin,130);ctx.lineTo(width-margin,130);ctx.stroke();};
 const finish=async()=>{const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(Error("PDF image failed")),"image/jpeg",.94));pages.push({jpeg:new Uint8Array(await blob.arrayBuffer()),width,height});};
 const cards=[...doc.querySelectorAll(".mark-card")];
 if(cards.length){
  for(const card of cards){
   start(clean(doc.title));
   let y=190;
   for(const col of card.querySelectorAll(".mark-col")){
    for(const node of col.children){
     const value=clean(node.textContent);if(!value)continue;
     // A very long label continues on a new page rather than clipping.
     const estimated=Math.ceil(value.length/45)*38;
     if(y+estimated>height-100){await finish();start(clean(doc.title));y=190;}
     y=line(value,margin+20,y,width-2*margin-40,node.classList.contains("mark-consignee")?30:25,node.classList.contains("mark-tag"));y+=12;
    }
    y+=30;
   }
   await finish();
  }
 }else{
  start(clean(doc.querySelector("h1")?.textContent)||clean(doc.title));let y=185;
  const draft=clean(doc.querySelector(".draft-banner")?.textContent);
  if(draft){y=line(draft,margin,y,width-margin*2,23,true)+25;}
  for(const row of doc.querySelectorAll("tr")){
   if(y>height-220){await finish();start(clean(doc.title));y=185;}
   y=line(clean(row.querySelector("th")?.textContent),margin,y,width-margin*2,23,true);
   y=line(clean(row.querySelector("td")?.textContent),margin+16,y,width-margin*2-16,26)+28;
  }
  if(y>height-220){await finish();start(clean(doc.title));y=185;}
  line("Authorized signature / Company stamp: ____________________",margin,y+50,width-margin*2,22);
  line(`Generated: ${new Date().toISOString().slice(0,10)} · CargoFit`,margin,height-70,width-margin*2,20);
  await finish();
 }
 const bytes=buildRasterPdf(pages),url=URL.createObjectURL(new Blob([bytes as BlobPart],{type:"application/pdf"}));
 const a=document.createElement("a");a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);
}
