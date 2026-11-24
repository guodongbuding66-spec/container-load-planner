"use client";

import { useMemo, useRef, useState, type PointerEvent } from "react";
import { ArrowDown, ArrowUp, Barcode, Box, Copy, Download, ExternalLink, Frame, ImagePlus, Package, Pencil, QrCode, Redo2, Trash2, Type, Undo2, Upload } from "lucide-react";
import { MARK_FACES, MARK_IMAGE_LIMIT, MARK_MAX_ELEMENTS, MARK_SAFE_AREA, isCode39, keepMarkOnBoard, markArtworkUrl, markBoardSvg, markElement, outsideMarkSafeArea, parseMarkArtwork, type MarkArtwork, type MarkBoard, type MarkElement, type MarkFace, type MarkKind } from "../lib/packing/shipping-mark-artwork";
import { SHIPPING_MARK_SYMBOLS } from "../lib/packing/shipping-mark-symbols";
import { parseShippingMark, type ShippingMark } from "../lib/packing/shipping-mark";
import type { ProductInput } from "../lib/packing/types";
import { FeatureDialog } from "./feature-dialog";
import { NumericInput } from "./numeric-input";
import { tr, useLanguage } from "./language";
import {CodeGeneratorDialog} from "./code-generator-dialog";
import {codeLayout,type CodeConfig,type CodeType} from "../lib/packing/code-generator";
import {codePlacement,markCodeIssues} from "../lib/packing/shipping-mark-artwork";
import {withPngDpi} from "../lib/packing/png-print";

const BOXSTUDIO_MARKS = "https://boxstudio-sigma.vercel.app/marks";
const ARTWORK_FORMAT = "cargofit-shipping-mark-v1";
type Bounds = Pick<ProductInput,"sku"|"length"|"width"|"height"|"weight">;
type History = { past: MarkArtwork[]; current: MarkArtwork; future: MarkArtwork[] };
type Drag = { face: MarkFace; id: string; startX: number; startY: number; original: MarkElement; mode:"move"|"resize" };

function faceLabel(face: MarkFace) {
  return face==="front" ? tr("正唛","Front mark") : tr("侧唛","Side mark");
}
function kindLabel(kind: MarkKind) {
  return {text:tr("文字","Text"),image:tr("图片","Image"),qr:tr("二维码","QR code"),barcode:tr("条码","Barcode"),code:tr("编码","Code"),symbol:tr("搬运图标","Handling symbol"),frame:tr("边框","Frame")}[kind];
}
function emptyBoard(width:number,height:number):MarkBoard {
  return {width:Math.min(250,Math.max(20,width)),height:Math.min(80,Math.max(20,height)),elements:[]};
}
function initialArtwork(mark:ShippingMark|undefined,product:Bounds):MarkArtwork {
  if(mark?.artwork)return mark.artwork;
  const front=emptyBoard(product.length,product.height);
  if(mark?.image){
    front.elements.push({...markElement("image",mark.image,front.width-12,mark.text?(front.height-12)*.45:front.height-12)});
  }
  if(mark?.text){
    const y=mark.image ? Math.round(front.height*.54) : 6;
    const fontSize=Math.max(2,Math.min(10,(front.height-y-4)/Math.max(1,mark.text.split(/\r?\n/).length*1.25)));
    front.elements.push({...markElement("text",mark.text,front.width-12,front.height-y-4),y,fontSize});
  }
  return {front,side:emptyBoard(product.width,product.height)};
}

async function importMarkImage(file:File) {
  if(!/\.(png|jpe?g|webp|svg)$/i.test(file.name)||file.size>8*1024*1024)throw new Error();
  // Image decoding keeps imported SVG in image mode. Persist only raster pixels.
  const url=URL.createObjectURL(file);
  try {
    const image=new Image();
    image.src=url;
    await image.decode();
    const canvas=document.createElement("canvas"),ctx=canvas.getContext("2d");
    if(!ctx||!image.naturalWidth||!image.naturalHeight)throw new Error();
    for(const max of [1000,720,480,320]){
      const scale=Math.min(1,max/Math.max(image.naturalWidth,image.naturalHeight));
      canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));
      canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));
      ctx.drawImage(image,0,0,canvas.width,canvas.height);
      const data=canvas.toDataURL("image/webp",.95);
      if(data.length<=MARK_IMAGE_LIMIT)return {data,width:image.naturalWidth,height:image.naturalHeight};
    }
    throw new Error();
  }finally{URL.revokeObjectURL(url);}
}

function downloadMark(blob: Blob, filename: string) {
  const url=URL.createObjectURL(blob),anchor=document.createElement("a");
  anchor.href=url;anchor.download=filename;anchor.click();
  window.setTimeout(()=>URL.revokeObjectURL(url),3000);
}

function ShippingMarkStudio({mark, product, onApply, onClose}:{
  mark?:ShippingMark;product:Bounds;onApply:(mark?:ShippingMark)=>void;onClose:()=>void;
}) {
  useLanguage();
  const [history,setHistory]=useState<History>(()=>({past:[],current:initialArtwork(mark,product),future:[]}));
  const [face,setFace]=useState<MarkFace>("front"),[selected,setSelectedId]=useState("");
  const [invalidFields,setInvalidFields]=useState<Set<string>>(()=>new Set());
  const setSelected=(id:string)=>{setSelectedId(id);setInvalidFields(new Set());};
  const numericValidity=(key:string,valid:boolean)=>setInvalidFields(previous=>{
    if(previous.has(key)===!valid)return previous;
    const next=new Set(previous);
    if(valid)next.delete(key);else next.add(key);
    return next;
  });
  const [draft,setDraft]=useState<MarkElement>(),[grid,setGrid]=useState(true),[snap,setSnap]=useState(false);
  const [error,setError]=useState(""),[busy,setBusy]=useState(false),[showSymbols,setShowSymbols]=useState(false);
  const [codeDialog,setCodeDialog]=useState<{element?:MarkElement;type?:CodeType}>();
  const imageInput=useRef<HTMLInputElement>(null), projectInput=useRef<HTMLInputElement>(null);
  const svg=useRef<SVGSVGElement>(null),drag=useRef<Drag>(null);
  const board=history.current[face];
  const current=draft??board.elements.find(e=>e.id===selected);
  const visualBoard=useMemo(()=>draft?{...board,elements:board.elements.map(e=>e.id===draft.id?draft:e)}:board,[board,draft]);
  const source=useMemo(()=>markArtworkUrl(visualBoard),[visualBoard]);
  const faceWidth=face==="front"?product.length:product.width;
  const oversized=board.width>faceWidth||board.height>product.height;
  const warnings=board.elements.filter(e=>outsideMarkSafeArea(e,board));
  const full=board.elements.length>=MARK_MAX_ELEMENTS;
  const codeIssues=MARK_FACES.flatMap(f=>markCodeIssues(history.current[f]).map(issue=>`${faceLabel(f)} · ${tr(...issue.split(" / ") as [string,string])}`));
  const codeVariables=useMemo(()=>({sku:product.sku,weight:product.weight,length:product.length,width:product.width,height:product.height}),[product]);

  const record=(next:MarkArtwork)=>{
    try {
      const valid=parseMarkArtwork(next);
      setHistory(h=>({current:valid,past:[...h.past.slice(-19),h.current],future:[]}));
      setError("");
      return true;
    }catch{
      setError(tr("唛头图层或图片超过限制。请减少图层或使用较小的图片。","The artwork exceeds the layer or image limits. Remove a layer or use a smaller image."));
      return false;
    }
  };
  const setBoard=(next:MarkBoard)=>record({...history.current,[face]:next});
  const replace=(element:MarkElement)=>setBoard({...board,elements:board.elements.map(e=>e.id===element.id?keepMarkOnBoard(element,board):e)});
  const add=(element:MarkElement)=>{
    if(full)return;
    const shift=board.elements.length%5*3;
    const next=keepMarkOnBoard({...element,x:element.x+shift,y:element.y+shift},board);
    if(setBoard({...board,elements:[...board.elements,next]}))setSelected(next.id);
  };
  const insertCode=(config:CodeConfig)=>{
    try{
      if(full&&!codeDialog?.element)return tr("图层数量已达上限。","Layer limit reached.");
      const original=codeDialog?.element;
      const element=codePlacement(board,{...(original??markElement("code",config.value,config.width,config.height)),kind:"code",value:config.value,width:config.width,height:config.height,angle:0,codeType:config.codeType,codeShowText:config.showText},!!original);
      if(setBoard({...board,elements:original?board.elements.map(e=>e.id===original.id?element:e):[...board.elements,element]})){setSelected(element.id);return;}
      return tr("无法保存编码图层。","Could not save the code layer.");
    }catch(e){const message=e instanceof Error?e.message:String(e);return message.includes(" / ")?tr(...message.split(" / ") as [string,string]):message;}
  };
  const changeSize=(dimension:"width"|"height",value:number)=>{
    if(board[dimension]===value)return;
    const next={...board,[dimension]:value};
    setBoard({...next,elements:next.elements.map(e=>keepMarkOnBoard(e,next))});
  };
  const remove=()=>{
    if(current&&setBoard({...board,elements:board.elements.filter(e=>e.id!==current.id)}))setSelected("");
  };
  const order=(direction:number)=>{
    if(!current)return;
    const list=[...board.elements],index=list.findIndex(e=>e.id===current.id),next=index+direction;
    if(next>=0&&next<list.length){
      [list[index],list[next]]=[list[next],list[index]];
      setBoard({...board,elements:list});
    }
  };
  const undo=(redo:boolean)=>{
    setDraft(undefined);setError("");setInvalidFields(new Set());
    setHistory(h=>{
      if(redo){const [current,...future]=h.future;return current?{past:[...h.past,h.current],current,future}:h;}
      const current=h.past.at(-1);
      return current?{past:h.past.slice(0,-1),current,future:[h.current,...h.future]}:h;
    });
  };
  const switchFace=(next:MarkFace)=>{setFace(next);setSelected("");setDraft(undefined);setError("");};
  const addTemplate=(kind:"shipping"|"code")=>{
    if(board.elements.length>MARK_MAX_ELEMENTS-2)return;
    const width=board.width-12,height=board.height-12;
    const elements=kind==="shipping"?[
      markElement("frame","",width,height),
      {...markElement("text",`SKU: ${product.sku.slice(0,100)}\nG.W.: ${product.weight} kg\nMEAS: ${product.length} × ${product.width} × ${product.height} mm\nMade in China`,width-6,height-6),x:9,y:9,fontSize:Math.max(1,Math.min(12,(height-6)/5,(width-6)/24))},
    ]:[
      {...markElement("text",product.sku.slice(0,160),width*.58,height*.6),y:Math.max(6,board.height*.23),fontSize:Math.min(14,height*.35,width*.06)},
      {...markElement("qr",product.sku.slice(0,120),width*.38,height),x:board.width-6-width*.38},
    ];
    if(setBoard({...board,elements:[...board.elements,...elements.map(e=>keepMarkOnBoard(e,board))]}))setSelected(elements.at(-1)!.id);
  };
  const startDrag=(event:PointerEvent<SVGElement>,element:MarkElement,mode:Drag["mode"])=>{
    if(event.button!==0)return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    svg.current?.focus();
    setSelected(element.id);
    drag.current={face,id:element.id,startX:event.clientX,startY:event.clientY,original:element,mode};
  };
  const moveDrag=(event:PointerEvent<SVGSVGElement>)=>{
    const start=drag.current,rect=svg.current?.getBoundingClientRect();
    if(!start||!rect?.width||start.face!==face)return;
    const round=(v:number)=>snap?Math.round(v/5)*5:Math.round(v*10)/10;
    const dx=(event.clientX-start.startX)*board.width/rect.width;
    const dy=(event.clientY-start.startY)*board.height/rect.height;
    if(!draft&&Math.hypot(event.clientX-start.startX,event.clientY-start.startY)<2)return;
    const e=start.original;
    const next=keepMarkOnBoard(start.mode==="move"?{...e,x:round(e.x+dx),y:round(e.y+dy)}:{
      ...e,width:Math.max(1,Math.min(board.width-e.x,round(e.width+dx))),
      height:Math.max(1,Math.min(board.height-e.y,round(e.height+dy))),
    },board);
    if(next.kind==="code"){try{codeLayout({codeType:next.codeType!,value:next.value,width:next.width,height:next.height,showText:next.codeShowText!==false});}catch{return;}}
    setDraft(next);
  };
  const finishDrag=()=>{
    if(drag.current&&draft&&drag.current.id===draft.id)replace(draft);
    drag.current=null;setDraft(undefined);
  };
  const addImage=async(file?:File)=>{
    if(!file||full)return;
    setBusy(true);setError("");
    try{
      const imported=await importMarkImage(file);
      const scale=Math.min((board.width-12)/imported.width,(board.height-12)/imported.height);
      add(markElement("image",imported.data,Math.max(1,imported.width*scale),Math.max(1,imported.height*scale)));
    }catch{setError(tr("无法读取图片。请选择 BoxStudio 导出的 SVG/PNG，或 8 MB 以内的 JPG、WebP。","Choose a readable BoxStudio SVG/PNG or a JPG/WebP up to 8 MB."));}
    finally{setBusy(false);}
  };
  const importProject=async(file?:File)=>{
    if(!file)return;
    setBusy(true);setError("");
    try{
      if(file.size>650000)throw new Error();
      const data=JSON.parse(await file.text());
      if(data.format!==ARTWORK_FORMAT)throw new Error();
      if(record(parseMarkArtwork(data.artwork)))setSelected("");
    }catch{setError(tr("请选择 CargoFit 唛头 JSON。BoxStudio 文件请先导出 SVG 或 PNG，再导入到对应的正唛或侧唛。","Choose a CargoFit mark JSON. For BoxStudio, export an SVG or PNG and import it into the desired front or side artboard."));}
    finally{setBusy(false);}
  };
  const exportAs=async(format:"svg"|"png"|"json")=>{
    const name=product.sku.replace(/[^\p{L}\p{N}_.-]+/gu,"-").slice(0,75)||"carton";
    const stem=`${name}-${face}`;
    setBusy(true);setError("");
    try {
      if(format!=="json"&&MARK_FACES.some(f=>markCodeIssues(history.current[f]).length))throw Error(tr("请先移开覆盖编码的图层，并保留安全边距。","Clear overlapping layers and preserve the code safe margin before export."));
      if(format==="json")downloadMark(new Blob([JSON.stringify({format:ARTWORK_FORMAT,artwork:history.current},null,2)],{type:"application/json"}),`${name}-marks.json`);
      if(format==="svg")downloadMark(new Blob([markBoardSvg(board)],{type:"image/svg+xml"}),`${stem}.svg`);
      if(format==="png"){
        const pixels=Math.min(8192,Math.round(Math.max(board.width,board.height)*300/25.4));
        const url=URL.createObjectURL(new Blob([markBoardSvg(board,pixels)],{type:"image/svg+xml"}));
        try {
          const image=new Image();image.src=url;await image.decode();
          const canvas=document.createElement("canvas");canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;
          canvas.getContext("2d")!.drawImage(image,0,0);
          const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error()),"image/png"));
          downloadMark(new Blob([withPngDpi(new Uint8Array(await blob.arrayBuffer())) as BlobPart],{type:"image/png"}),`${stem}.png`);
        }finally{URL.revokeObjectURL(url);}
      }
    }catch{setError(tr("导出失败，请重试或改用 SVG。","Export failed. Retry or choose SVG."));}
    finally{setBusy(false);}
  };
  const apply=()=>onApply(parseShippingMark({artwork:history.current}));
  const safe=MARK_SAFE_AREA;

  return <FeatureDialog wide fullscreen title={tr("唛头设计工作台","Shipping mark studio")} subtitle={product.sku} onClose={onClose}
    footer={<><p role="status">{error||codeIssues[0]||(invalidFields.size?tr("请修正当前标红的数字。","Correct the highlighted numbers."):tr("应用后仍需在货物设置中保存。SVG 保留毫米尺寸。","Apply the marks, then save Cargo settings. SVG retains physical dimensions."))}</p><button type="button" className="button" onClick={onClose}>{tr("取消","Cancel")}</button><button type="button" className="button primary" disabled={busy||invalidFields.size>0||MARK_FACES.some(f=>markCodeIssues(history.current[f]).length)} onClick={apply}>{tr("应用到当前 SKU","Apply to SKU")}</button></>}>
    <div className="mark-studio" aria-busy={busy}>
      <div className="mark-studio-top">
        <div className="mark-face-switch" role="group" aria-label={tr("唛头画板","Mark artboards")}>
          {MARK_FACES.map(f=><button type="button" key={f} className="button" aria-pressed={face===f} disabled={busy} onClick={()=>switchFace(f)}><Box size={15}/><span>{faceLabel(f)}<small>{history.current[f].width} × {history.current[f].height} mm</small></span></button>)}
        </div>
        <div className="mark-actions">
          <button type="button" className="button small" disabled={busy} onClick={()=>projectInput.current?.click()}><Upload size={14}/>{tr("载入 JSON","Import JSON")}</button>
          <details className="mark-export"><summary className="button small"><Download size={14}/>{tr("导出","Export")}</summary>
            <div>{(["svg","png","json"] as const).map(format=><button key={format} type="button" className="button small" disabled={busy} onClick={event=>{event.currentTarget.closest("details")!.open=false;void exportAs(format);}}>{format.toUpperCase()} · {format==="json"?tr("双面项目","Both faces"):faceLabel(face)}</button>)}</div>
          </details>
        </div>
      </div>
      <input ref={imageInput} hidden type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml,.svg" onChange={e=>{const file=e.currentTarget.files?.[0];e.currentTarget.value="";void addImage(file);}}/>
      <input ref={projectInput} hidden type="file" accept="application/json,.json" onChange={e=>{const file=e.currentTarget.files?.[0];e.currentTarget.value="";void importProject(file);}}/>
      <div className="mark-workgrid">
        <section className="mark-stage-panel" aria-label={tr("设计画布","Design canvas")}>
          <div className="mark-toolbar">
            <div className="mark-actions" role="group" aria-label={tr("添加图层","Add layer")}>
              <button type="button" className="button small" disabled={busy||full} onClick={()=>add(markElement("text",product.sku.slice(0,120),Math.max(12,board.width*.55),Math.max(10,board.height*.25)))}><Type size={15}/>{kindLabel("text")}</button>
              <button type="button" className="button small" disabled={busy||full} onClick={()=>imageInput.current?.click()}><ImagePlus size={15}/>{tr("图片 / SVG","Image / SVG")}</button>
              <button type="button" className="button small" disabled={busy||full} onClick={()=>setCodeDialog({type:"qrcode"})}><QrCode size={15}/>{kindLabel("qr")}</button>
              <button type="button" className="button small" disabled={busy||full} onClick={()=>setCodeDialog({})}><Barcode size={15}/>{tr("条码生成器","Code generator")}</button>
              <button type="button" className="button small" disabled={busy||full} onClick={()=>add(markElement("frame","",board.width-12,board.height-12))}><Frame size={15}/>{kindLabel("frame")}</button>
            </div>
            <button type="button" className="button small" disabled={busy||full} aria-expanded={showSymbols} onClick={()=>setShowSymbols(v=>!v)}><Package size={15}/>{tr("搬运图标","Handling symbols")}</button>
            <div className="mark-actions" role="group" aria-label={tr("编辑历史","Edit history")}>
              <button type="button" className="button small" aria-label={tr("撤销","Undo")} disabled={busy||!history.past.length} onClick={()=>undo(false)}><Undo2 size={16}/></button>
              <button type="button" className="button small" aria-label={tr("重做","Redo")} disabled={busy||!history.future.length} onClick={()=>undo(true)}><Redo2 size={16}/></button>
            </div>
          </div>
          {showSymbols&&<div className="mark-symbol-library" role="group" aria-label={tr("上传的唛头图标库","Uploaded shipping mark symbols")}>
            {SHIPPING_MARK_SYMBOLS.map(symbol=>{
              const size=Math.min(board.width,board.height)*.45;
              const element=markElement("symbol",symbol.id,size,size);
              const icon={width:40,height:40,elements:[{...element,x:2,y:2,width:36,height:36}]};
              return <button type="button" key={symbol.id} className="button small" disabled={busy||full} onClick={()=>{add(element);setShowSymbols(false);}}>
                <span className="mark-symbol-thumbnail" aria-hidden="true" style={{backgroundImage:`url("${markArtworkUrl(icon)}")`}}/>
                <span>{tr(symbol.zh,symbol.en)}</span>
              </button>;
            })}
          </div>}
          <div className="mark-stage">
            <svg ref={svg} tabIndex={0} aria-label={faceLabel(face)} viewBox={`0 0 ${board.width} ${board.height}`}
              style={{width:`min(100%, ${420 * board.width/board.height}px)`}}
              onPointerDown={()=>setSelected("")} onPointerMove={moveDrag} onPointerUp={finishDrag}
              onPointerCancel={()=>{drag.current=null;setDraft(undefined);}}
              onKeyDown={event=>{
                const offsets:Record<string,[number,number]>={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]};
                const delta=offsets[event.key];
                if(!current||busy)return;
                if(delta){event.preventDefault();const step=event.shiftKey?5:1;replace({...current,x:current.x+delta[0]*step,y:current.y+delta[1]*step});}
                if(event.key==="Delete"){event.preventDefault();remove();}
              }}>
              <image href={source} width={board.width} height={board.height} pointerEvents="none"/>
              {grid&&<><defs><pattern id="mark-studio-grid" width="10" height="10" patternUnits="userSpaceOnUse"><path d="M10 0H0V10" fill="none" stroke="#0d766b" strokeOpacity=".25" strokeWidth=".35"/></pattern></defs>
                <rect width={board.width} height={board.height} fill="url(#mark-studio-grid)" pointerEvents="none"/></>}
              <rect x={safe} y={safe} width={board.width-safe*2} height={board.height-safe*2} fill="none" stroke="#4b8881" strokeDasharray="5 4" vectorEffect="non-scaling-stroke" pointerEvents="none"/>
              {visualBoard.elements.map(e=><rect key={e.id} x={e.x} y={e.y} width={e.width} height={e.height} transform={`rotate(${e.angle} ${e.x+e.width/2} ${e.y+e.height/2})`} fill="transparent" stroke={selected===e.id?"#087e74":"none"} strokeWidth="1.5" vectorEffect="non-scaling-stroke" className="mark-hit" onPointerDown={event=>{if(!busy)startDrag(event,e,"move");}}/>)}
              {current?.angle===0&&<circle cx={current.x+current.width} cy={current.y+current.height} r={Math.max(board.width,board.height)*.013} fill="#087e74" stroke="white" vectorEffect="non-scaling-stroke" className="mark-resize" onPointerDown={event=>{if(!busy)startDrag(event,current,"resize");}}/>}
            </svg>
          </div>
          <div className="mark-stage-footer">
            <span>{board.width} × {board.height} mm · {tr("安全边距","Safe margin")} {safe} mm</span>
            <div className="mark-actions"><label><input type="checkbox" checked={grid} onChange={e=>setGrid(e.target.checked)}/>{tr("网格","Grid")}</label><label><input type="checkbox" checked={snap} onChange={e=>setSnap(e.target.checked)}/>{tr("吸附 5 mm","Snap 5 mm")}</label></div>
          </div>
        </section>
        <aside className="mark-inspector">
          <section>
            <h3>{faceLabel(face)} · {tr("画板","Artboard")}</h3>
            <div className="mark-property-grid">
              {(["width","height"] as const).map(field=><label key={`${face}-${field}`}>{field==="width"?tr("宽度 mm","Width mm"):tr("高度 mm","Height mm")}<NumericInput ariaLabel={field==="width"?tr("画板宽度","Artboard width"):tr("画板高度","Artboard height")} value={board[field]} min={20} max={2000} precision={1} showError onValidityChange={v=>numericValidity("board-"+field,v)} onValueChange={v=>{if(!busy)changeSize(field,v);}}/></label>)}
            </div>
            <div className="mark-actions">
              {[250,200].map(w=><button key={w} className="button small" type="button" disabled={busy} onClick={()=>{const next={...board,width:w,height:w*.32};setBoard({...next,elements:board.elements.map(e=>keepMarkOnBoard(e,next))});}}>{w} × {w*.32}</button>)}
              <button className="button small" type="button" disabled={busy||board.elements.length>MARK_MAX_ELEMENTS-2} onClick={()=>addTemplate("shipping")}>{tr("运输字段","Shipping fields")}</button>
              <button className="button small" type="button" disabled={busy||board.elements.length>MARK_MAX_ELEMENTS-2} onClick={()=>addTemplate("code")}>{tr("SKU + QR","SKU + QR")}</button>
            </div>
            {oversized&&<p className="mark-warning">{tr("画板大于当前箱面。装柜视图会等比缩小，导出仍按画板尺寸。","The artboard exceeds this carton face. The load view scales it down; export retains artboard dimensions.")}</p>}
            {warnings.length>0&&<p className="mark-warning">{warnings.length} {tr("个图层超出安全边距","layers cross the safe margin")}</p>}
          </section>
          <section>
            <h3>{tr("图层","Layers")} <small>{board.elements.length}/{MARK_MAX_ELEMENTS}</small></h3>
            {board.elements.length===0&&<p>{tr("添加文字、图片或模板开始排版。","Add text, an image or a template to start.")}</p>}
            <div className="mark-layer-list" role="group" aria-label={tr("选择图层","Select layer")}>
              {[...board.elements].reverse().map(e=><button key={e.id} type="button" className="button small" disabled={busy} aria-pressed={e.id===selected} onClick={()=>setSelected(e.id)}>{e.kind==="code"?e.codeType:kindLabel(e.kind)}{(e.kind==="text"||e.kind==="qr"||e.kind==="barcode"||e.kind==="code")&&<span>{e.value.split("\n")[0]}</span>}</button>)}
            </div>
            {current&&<div className="mark-layer-props" key={current.id}>
              {current.kind==="code"&&<button type="button" className="button" onClick={()=>setCodeDialog({element:current})}>{tr("编辑编码、尺寸与文字","Edit code, size and caption")}</button>}
              {(current.kind==="text"||current.kind==="qr")&&<label>{current.kind==="qr"?tr("二维码内容","QR content"):kindLabel("text")}<textarea rows={current.kind==="text"?3:2} maxLength={current.kind==="qr"?160:480} disabled={busy} value={current.value} onChange={e=>replace({...current,value:e.target.value})}/></label>}
              {current.kind==="barcode"&&<label>Code 39
                <input maxLength={32} disabled={busy} value={current.value} onChange={e=>{
                  const value=e.target.value.toUpperCase();
                  if(isCode39(value))replace({...current,value});
                  else setError(tr("Code 39 支持大写字母、数字、空格及 - . $ / + %。","Code 39 supports uppercase letters, digits, spaces and - . $ / + %."));
                }}/></label>}
              <div className="mark-property-grid">
                {(["x","y",...(current.kind==="code"?[]:["width","height","angle"] as const),...(current.kind==="text"?["fontSize"] as const:[])] as const).map(field=>{
                  const label={x:"X mm",y:"Y mm",width:tr("宽 mm","W mm"),height:tr("高 mm","H mm"),angle:tr("角度 °","Angle °"),fontSize:tr("字号 mm","Type size mm")}[field];
                  return <label key={field}>{label}<NumericInput ariaLabel={label} value={current[field]} min={field==="angle"?-180:field==="x"||field==="y"?0:1}
                    max={field==="angle"?180:field==="fontSize"?250:field==="x"?board.width-current.width:field==="y"?board.height-current.height:field==="width"?board.width-current.x:board.height-current.y} precision={1} showError onValidityChange={v=>numericValidity(current.id+"-"+field,v)} onValueChange={v=>{if(!busy)replace({...current,[field]:v});}}/></label>;
                })}
              </div>
              {(current.kind==="text"||current.kind==="frame"||current.kind==="symbol")&&<div className="mark-actions"><label>{tr("颜色","Color")} <input type="color" aria-label={tr("图层颜色","Layer color")} disabled={busy} value={current.color} onChange={e=>replace({...current,color:e.target.value})}/></label>{current.kind==="text"&&<label><input type="checkbox" checked={current.bold} disabled={busy} onChange={e=>replace({...current,bold:e.target.checked})}/>{tr("粗体","Bold")}</label>}</div>}
              <div className="mark-actions">
                <button type="button" className="button small" disabled={busy} onClick={()=>replace({...current,x:(board.width-current.width)/2})}>{tr("水平居中","Center X")}</button>
                <button type="button" className="button small" disabled={busy} onClick={()=>replace({...current,y:(board.height-current.height)/2})}>{tr("垂直居中","Center Y")}</button>
                <button type="button" className="button small" aria-label={tr("上移图层","Raise layer")} disabled={busy||board.elements.at(-1)?.id===current.id} onClick={()=>order(1)}><ArrowUp size={14}/></button>
                <button type="button" className="button small" aria-label={tr("下移图层","Lower layer")} disabled={busy||board.elements[0]?.id===current.id} onClick={()=>order(-1)}><ArrowDown size={14}/></button>
                <button type="button" className="button small" aria-label={tr("复制图层","Duplicate layer")} disabled={busy||full} onClick={()=>add({...current,id:crypto.randomUUID(),x:current.x+3,y:current.y+3})}><Copy size={14}/></button>
                <button type="button" className="button small" aria-label={tr("删除图层","Delete layer")} disabled={busy} onClick={remove}><Trash2 size={14}/></button>
              </div>
            </div>}
          </section>
          <section className="mark-studio-bridge">
            <a className="button small" href={BOXSTUDIO_MARKS} target="_blank" rel="noopener noreferrer"><ExternalLink size={14}/>{tr("在 BoxStudio 做印刷排版","Open BoxStudio for print design")}</a>
            <p>{tr("在 BoxStudio 排条码、符号或批量唛头后，导出 SVG 或 PNG，分别上传到正唛和侧唛。","Design barcodes, symbols or batch marks in BoxStudio, then import its SVG or PNG into the matching artboard.")}</p>
          </section>
        </aside>
      </div>
      {codeDialog&&<CodeGeneratorDialog key={codeDialog.element?.id??codeDialog.type??"new"} variables={codeVariables} editing={!!codeDialog.element} initial={codeDialog.element?{codeType:codeDialog.element.codeType!,value:codeDialog.element.value,width:codeDialog.element.width,height:codeDialog.element.height,showText:codeDialog.element.codeShowText!==false}:codeDialog.type?{codeType:codeDialog.type,value:product.sku,width:40,height:40,showText:false}:undefined} onInsert={insertCode} onClose={()=>setCodeDialog(undefined)}/>}
    </div>
  </FeatureDialog>;
}

export function ShippingMarkEditor({mark,product,onChange}:{mark?:ShippingMark;product:Bounds;onChange:(mark?:ShippingMark)=>void}) {
  useLanguage();
  const [open,setOpen]=useState(false);
  const faces=mark?.artwork?MARK_FACES.filter(f=>mark.artwork![f].elements.length):[];
  return <section className="mark-entry" aria-label={tr("自定义箱标与唛头","Custom carton label and shipping mark")}>
    <div><h3>{tr("箱标与唛头","Carton shipping marks")}</h3>
      <p>{faces.length?faces.map(faceLabel).join(" · "):mark?.text||mark?.image?tr("已保存自定义唛头","Custom mark saved"):tr("当前箱面显示 SKU","Carton faces display the SKU")}</p>
    </div>
    <div className="mark-actions">
      {mark&&<button type="button" className="button small" onClick={()=>onChange(undefined)}>{tr("恢复默认 SKU","Restore default SKU")}</button>}
      <button type="button" className="button small" onClick={()=>setOpen(true)}><Pencil size={14}/>{tr("设计正唛与侧唛","Design front and side marks")}</button>
    </div>
    {open&&<ShippingMarkStudio mark={mark} product={product} onClose={()=>setOpen(false)} onApply={next=>{onChange(next);setOpen(false);}}/>}
  </section>;
}
