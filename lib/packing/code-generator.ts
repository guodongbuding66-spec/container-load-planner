import type { UiLanguage } from "./ui-locales";
// Ported from guodongbuding66-spec/BoxStudio src/codeGeneratorV72.js.
// Keep the encoder, physical quiet zones and moduleSize-density policy in sync.
import * as bwip from "@bwip-js/generic";

export const CODE_TYPES = [
 ["code128","Code 128","ITEM-2026-001"], ["code39","Code 39","ITEM-001"], ["code93","Code 93","BOX-2026"],
 ["ean13","EAN-13","6901234567892"], ["ean8","EAN-8","96385074"], ["upca","UPC-A","012345678905"],
 ["itf14","ITF-14","10012345678902"], ["gs1-128","GS1-128","(01)09501101530003(10)LOT001"],
 ["qrcode","QR","https://example.com/box/ITEM-001"], ["datamatrix","Data Matrix","BOX-2026-001"],
 ["pdf417","PDF417","BOX-2026-001"], ["azteccode","Aztec","BOX-2026-001"],
] as const;
export type CodeType=typeof CODE_TYPES[number][0];
export type CodeConfig={codeType:CodeType;value:string;width:number;height:number;showText:boolean};
export type CodeVariables=Record<string,string|number>;
type Raw={bbs:number[];bhs:number[];sbs:number[]}|{pixs:number[];pixx:number;pixy:number;height:number;width:number};
// The generic package's named `raw` is a rendering wrapper; its ESM default
// exposes the raw encoder used by BoxStudio. Upstream typings omit that default.
const encoder=(bwip as unknown as {default:{raw:(options:Record<string,unknown>)=>Raw[]}}).default;
const cache=new Map<string,Raw>();
const xml=(s:string)=>s.replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&apos;"}[c]!));
export class CodeGenerationError extends Error{
 constructor(public zh:string,public en:string){super(`${zh} / ${en}`);this.name="CodeGenerationError";}
}
export function codeErrorMessage(error:unknown,language:UiLanguage){return error instanceof CodeGenerationError?error[language==="zh"?"zh":"en"]:error instanceof Error?error.message:String(error);}
function fail(zh:string,en:string):never{throw new CodeGenerationError(zh,en);}
export const isCodeType=(type:unknown):type is CodeType=>CODE_TYPES.some(t=>t[0]===type);
export const isMatrixCode=(type:CodeType)=>["qrcode","datamatrix","pdf417","azteccode"].includes(type);
export function codeLayout(config:CodeConfig,variables:CodeVariables={}){
 const {codeType:type,width:w,height:h}=config;
 if(!isCodeType(type))fail("请选择有效编码类型","Choose a valid code type");
 let value=config.value.replace(/\{\{\s*([\w]+)\s*\}\}/g,(_,key:string)=>{
  if(variables[key]===undefined)fail(`未定义变量 ${key}`,`Unknown variable ${key}`);
  return String(variables[key]);
 });
 if(!value.trim()||value.length>2048)fail("编码内容需为 1–2048 个字符","Code content must contain 1–2048 characters");
 if(type==="code39")value=value.toUpperCase();
 const length:Partial<Record<CodeType,number>>={ean13:13,ean8:8,upca:12,itf14:14},digits=length[type];
 if(digits){
  if(!/^\d+$/.test(value)||![digits-1,digits].includes(value.length))fail(`需输入 ${digits-1} 位数字自动补校验位，或 ${digits} 位完整编码`,`Enter ${digits-1} digits for an automatic check digit or ${digits} complete digits`);
  if(value.length===digits-1){const sum=[...value].reverse().reduce((a,c,i)=>a+Number(c)*(i%2?1:3),0);value+=(10-sum%10)%10;}
 }
 if(![w,h].every(n=>Number.isFinite(n)&&n>=8&&n<=1500))fail("编码宽高需为 8–1500 mm","Code dimensions must be 8–1500 mm");
 const key=JSON.stringify([type,value]);let raw=cache.get(key);
 if(!raw){try{raw=encoder.raw({bcid:type,text:value,includetext:false,...(type==="code93"?{includecheck:true}:{}),...(type==="qrcode"?{eclevel:"M"}:{})})[0];}
  catch(e){fail("编码无效",`Invalid code: ${String(e instanceof Error?e.message:e).replace(/^bwipp\.[^:]+:\s*/,"")}`);}
  if(!raw)fail("无法生成编码","Cannot generate this code");
  if(cache.size>=80)cache.delete(cache.keys().next().value!);cache.set(key,raw);
 }
 const rects:{x:number;y:number;w:number;h:number}[]=[];let moduleSize:number,label="",fontSize=0;
 const matrix="pixs" in raw,quietModules=matrix?(type==="qrcode"?4:2):12;
 if("pixs" in raw){
  const ratio=raw.height/raw.pixy/(raw.width/raw.pixx),cols=raw.pixx+2*quietModules,rows=(raw.pixy+2*quietModules)*ratio;
  moduleSize=Math.min(w/cols,h/rows);const ox=(w-cols*moduleSize)/2+quietModules*moduleSize,oy=(h-rows*moduleSize)/2+quietModules*moduleSize*ratio;
  for(let y=0;y<raw.pixy;y++){let start=-1;for(let x=0;x<=raw.pixx;x++){
   const black=x<raw.pixx&&raw.pixs[y*raw.pixx+x];if(black&&start<0)start=x;
   if(!black&&start>=0){rects.push({x:ox+start*moduleSize,y:oy+y*moduleSize*ratio,w:(x-start)*moduleSize,h:moduleSize*ratio});start=-1;}
  }}
 }else{
  const units=raw.sbs.reduce((a,b)=>a+b,0);moduleSize=w/(units+quietModules*2);
  fontSize=config.showText===false?0:Math.min(4,h*.13);const bottom=Math.max(1,fontSize*1.6),barH=h-bottom-1,maxHeight=Math.max(...raw.bhs.map((n,i)=>n+(raw.bbs[i]||0)));
  if(barH<5)fail("条码高度不足","Increase the barcode height");
  let x=quietModules*moduleSize;for(let i=0;i<raw.sbs.length;i++){if(i%2===0){const j=i/2,offset=raw.bbs[j]||0,hh=raw.bhs[j];rects.push({x,y:1+barH*(1-(hh+offset)/maxHeight),w:raw.sbs[i]*moduleSize,h:barH*hh/maxHeight});}x+=raw.sbs[i]*moduleSize;}
  label=config.showText===false?"":value;
  if(type==="itf14"){const thickness=Math.max(moduleSize,1);rects.push({x:quietModules*moduleSize,y:1,w:units*moduleSize,h:thickness},{x:quietModules*moduleSize,y:1+barH-thickness,w:units*moduleSize,h:thickness});}
 }
 const minimum=matrix?.4:.254;
 if(moduleSize<minimum-1e-6)fail(`编码过密：模块 ${moduleSize.toFixed(3)} mm，至少需要 ${minimum} mm；请增大尺寸或缩短内容`,`Code too dense: module ${moduleSize.toFixed(3)} mm; minimum ${minimum} mm. Increase size or shorten content`);
 return {type,value,rects,w,h,module:moduleSize,minimum,label,fontSize,labelY:h-fontSize*.35,matrix,quietModules};
}
export function codeSvg(config:CodeConfig,variables:CodeVariables={},physical=true){
 const l=codeLayout(config,variables),n=(v:number)=>+v.toFixed(6);
 return `<svg xmlns="http://www.w3.org/2000/svg" width="${l.w}${physical?"mm":""}" height="${l.h}${physical?"mm":""}" viewBox="0 0 ${l.w} ${l.h}" shape-rendering="crispEdges"><rect width="${l.w}" height="${l.h}" fill="#fff"/><g fill="#000">${l.rects.map(r=>`<rect x="${n(r.x)}" y="${n(r.y)}" width="${n(r.w)}" height="${n(r.h)}"/>`).join("")}</g>${l.label?`<text x="${l.w/2}" y="${l.labelY}" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="${l.fontSize}" fill="#000" shape-rendering="auto">${xml(l.label)}</text>`:""}</svg>`;
}
