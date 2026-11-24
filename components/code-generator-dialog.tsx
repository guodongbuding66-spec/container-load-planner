"use client";
import {useMemo,useState} from "react";
import NextImage from "next/image";
import {CODE_TYPES,codeLayout,codeSvg,codeErrorMessage,isMatrixCode,type CodeConfig,type CodeType,type CodeVariables} from "../lib/packing/code-generator";
import {withPngDpi} from "../lib/packing/png-print";
import {FeatureDialog} from "./feature-dialog";
import {UnitInput} from "./ui/unit-input";
import {tr,useLanguage} from "./language";

function download(blob:Blob,name:string){const url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),3000);}
export function CodeGeneratorDialog({initial,editing=false,variables,onInsert,onClose}:{initial?:CodeConfig;editing?:boolean;variables:CodeVariables;onInsert:(config:CodeConfig)=>string|undefined;onClose:()=>void}){
 const language=useLanguage();const [config,setConfig]=useState<CodeConfig>(()=>initial??{codeType:"code128",value:String(variables.sku??"ITEM-2026-001"),width:100,height:32,showText:true});
 const [invalid,setInvalid]=useState(new Set<string>()),[error,setError]=useState(""),[busy,setBusy]=useState(false);
 const preview=useMemo(()=>{try{const layout=codeLayout(config,variables);return {layout,svg:codeSvg(config,variables),error:""};}catch(e){return {error:codeErrorMessage(e,language)};}},[config,variables,language]);
 const type=CODE_TYPES.find(t=>t[0]===config.codeType)!,matrix=isMatrixCode(config.codeType),valid=!!preview.layout&&!invalid.size&&!busy;
 const update=(patch:Partial<CodeConfig>)=>{setConfig(c=>({...c,...patch}));setError("");};
 const validity=(id:string,ok:boolean)=>setInvalid(p=>{if(p.has(id)===!ok)return p;const next=new Set(p);if(ok)next.delete(id);else next.add(id);return next;});
 const changeType=(codeType:CodeType)=>{const t=CODE_TYPES.find(t=>t[0]===codeType)!,m=isMatrixCode(codeType);update({codeType,value:config.value===type[2]||["ean13","ean8","upca","itf14","gs1-128"].includes(codeType)?t[2]:config.value,width:m?(codeType==="pdf417"?100:40):100,height:m?40:32});};
 const save=async(png:boolean)=>{
  if(!valid||!preview.svg)return;setBusy(true);setError("");
  try{const stem=`CargoFit-${config.codeType}`;if(!png){download(new Blob([preview.svg],{type:"image/svg+xml"}),stem+".svg");return;}
   const width=Math.round(config.width/25.4*300),height=Math.round(config.height/25.4*300);if(width*height>40e6)throw Error(tr("图片超过 4000 万像素，请缩小尺寸或使用 SVG。","Image exceeds 40 million pixels. Reduce its dimensions or use SVG."));
   const url=URL.createObjectURL(new Blob([preview.svg],{type:"image/svg+xml"}));try{const image=new Image();image.src=url;await image.decode();const canvas=document.createElement("canvas");canvas.width=width;canvas.height=height;const ctx=canvas.getContext("2d");if(!ctx)throw Error("Canvas unavailable");ctx.imageSmoothingEnabled=false;ctx.drawImage(image,0,0,width,height);const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(Error("PNG encoding failed")),"image/png"));download(new Blob([withPngDpi(new Uint8Array(await blob.arrayBuffer())) as BlobPart],{type:"image/png"}),stem+".png");}finally{URL.revokeObjectURL(url);}
  }catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false);}
 };
 return <FeatureDialog wide title={tr("条码与二维码生成器","Barcode and QR generator")} onClose={onClose}>
  <div className="code-generator" aria-busy={busy}>
   <form onSubmit={e=>{e.preventDefault();setError(preview.error);}} className="code-generator-form">
    <label>{tr("编码类型","Code type")}<select value={config.codeType} onChange={e=>changeType(e.target.value as CodeType)}>{CODE_TYPES.map(t=><option key={t[0]} value={t[0]}>{t[1]}{t[0]==="qrcode"?tr(" 二维码"," code"):""}</option>)}</select></label>
    <label>{tr("编码内容","Code content")}<textarea data-dialog-autofocus rows={4} maxLength={2048} spellCheck={false} value={config.value} onChange={e=>update({value:e.target.value})}/></label>
    <small>{config.codeType==="gs1-128"?tr("使用 (01)…(10)… 格式，填写已有的商品及批次编号。","Use (01)…(10)… with your assigned identifiers."):`${tr("示例","Example")}: ${type[2]}`}</small>
    <div className="code-generator-size">{(["width","height"] as const).map(field=><label key={field}>{field==="width"?tr("宽度","Width"):tr("高度","Height")}<UnitInput unit="mm" ariaLabel={field==="width"?tr("编码宽度","Code width"):tr("编码高度","Code height")} value={config[field]} min={8} max={1500} precision={1} showError onValueChange={n=>update({[field]:n})} onValidityChange={ok=>validity(field,ok)}/></label>)}</div>
    <label className="code-generator-check"><input type="checkbox" disabled={matrix} checked={config.showText} onChange={e=>update({showText:e.target.checked})}/>{tr("显示条码下方文字","Show human-readable text")}</label>
    <small>{tr("可使用 {{sku}}、{{weight}} 等当前货物变量，插入时固定为实际内容。","Use current cargo variables such as {{sku}} and {{weight}}. Insertion saves the resolved content.")}</small>
    <button type="submit" className="button" disabled={busy}>{tr("生成预览","Generate preview")}</button>
   </form>
   <section className="code-generator-result">
    <div className="code-generator-preview" aria-label={tr("编码预览","Code preview")}>
     {preview.svg&&!invalid.size?<NextImage unoptimized width={Math.round(config.width*4)} height={Math.round(config.height*4)} src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(preview.svg)}`} alt={tr("条码或二维码预览","Barcode or QR preview")}/>:<p>{tr("修正内容或尺寸后生成","Correct the content or dimensions")}</p>}
    </div>
    <p role="status">{preview.layout&&!invalid.size?`${type[1]} · ${config.width} × ${config.height} mm · ${tr("模块","Module")} ${preview.layout.module.toFixed(3)} mm · ${tr("已保留静区","Quiet zone preserved")}${preview.layout.value!==config.value?` · ${tr("实际编码","Encoded")}: ${preview.layout.value}`:""}`:""}</p>
    {(error||preview.error)&&<p role="alert" className="code-generator-error">{error||preview.error}</p>}
    <div className="code-generator-actions"><button type="button" className="button primary" disabled={!valid} onClick={()=>{const message=onInsert({...config,value:preview.layout!.value});if(message)setError(message);else onClose();}}>{editing?tr("更新所选编码","Update code"):tr("插入唛头","Insert into mark")}</button><button type="button" className="button" disabled={!valid} onClick={()=>void save(false)}>{tr("下载 SVG","Download SVG")}</button><button type="button" className="button" disabled={!valid} onClick={()=>void save(true)}>{tr("下载 PNG · 300 DPI","Download PNG · 300 DPI")}</button></div>
    <small>{tr("在当前浏览器生成，不上传编码内容。SVG 按毫米导出；二维编码保持原生模块比例。请使用 SVG 进行原尺寸印刷。","Generated locally without uploading content. SVG retains millimeters and matrix codes retain native module proportions. Use SVG for physical-size printing.")}</small>
   </section>
  </div>
 </FeatureDialog>;
}
