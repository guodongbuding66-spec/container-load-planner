import QRCode from "qrcode";
import {shippingMarkSymbol} from "./shipping-mark-symbols";

export type MarkFace = "front" | "side";
export type MarkKind = "text" | "image" | "qr" | "barcode" | "symbol" | "frame";
export type MarkElement = {
  id: string;
  kind: MarkKind;
  x: number;
  y: number;
  width: number;
  height: number;
  angle: number;
  value: string;
  color: string;
  fontSize: number;
  bold: boolean;
};
export type MarkBoard = { width: number; height: number; elements: MarkElement[] };
export type MarkArtwork = Record<MarkFace, MarkBoard>;

export const MARK_FACES = ["front", "side"] as const;
export const MARK_KINDS = ["text", "image", "qr", "barcode", "symbol", "frame"] as const;
export const MARK_MAX_ELEMENTS = 24;
export const MARK_SAFE_AREA = 4;
export const MARK_IMAGE_LIMIT = 120_000;

export function isMarkImage(image: unknown): image is string {
  return typeof image === "string" && image.length <= MARK_IMAGE_LIMIT &&
    /^data:image\/(?:png;base64,iVBORw0KGgo|jpeg;base64,\/9j\/|webp;base64,UklGR)[A-Za-z0-9+/]+={0,2}$/.test(image);
}

export function parseMarkArtwork(value: unknown): MarkArtwork {
  const fail = () => { throw new Error("唛头画板或图层无效 / Invalid shipping mark artboard or layer"); };
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail();
  const art = value as MarkArtwork;
  const parseBoard = (board: MarkBoard): MarkBoard => {
    const within = (n: unknown, min: number, max: number) => typeof n === "number" && Number.isFinite(n) && n >= min && n <= max;
    if (!board || !within(board.width, 20, 2000) || !within(board.height, 20, 2000) ||
      !Array.isArray(board.elements) || board.elements.length > MARK_MAX_ELEMENTS) return fail();
    const ids = new Set<string>();
    const elements = board.elements.map(e => {
      if (!e || typeof e.id !== "string" || !/^[\w-]{1,60}$/.test(e.id) || ids.has(e.id) || !MARK_KINDS.includes(e.kind) ||
        !within(e.x, 0, 2000) || !within(e.y, 0, 2000) || !within(e.width, 1, 2000) || !within(e.height, 1, 2000) ||
        !within(e.angle, -180, 180) || typeof e.color !== "string" || !/^#[0-9a-f]{6}$/i.test(e.color) ||
        !within(e.fontSize, 1, 250) || typeof e.bold !== "boolean" || typeof e.value !== "string" ||
        (e.kind === "image" ? !isMarkImage(e.value) : e.value.length > 480) ||
        (e.kind === "qr" && e.value.length > 160) || (e.kind==="barcode"&&!isCode39(e.value)) || (e.kind==="symbol"&&!shippingMarkSymbol(e.value))) return fail();
      ids.add(e.id);
      const {id, kind, x, y, width, height, angle, value, color, fontSize, bold} = e;
      return {id, kind, x, y, width, height, angle, value, color, fontSize, bold};
    });
    if (elements.reduce((sum, e) => sum + (e.kind === "image" ? e.value.length : 0), 0) > MARK_IMAGE_LIMIT * 2) return fail();
    return {width: board.width, height: board.height, elements};
  };
  return {front: parseBoard(art.front), side: parseBoard(art.side)};
}

export function markElement(kind: MarkKind, value: string, width: number, height: number): MarkElement {
  return {id:globalThis.crypto.randomUUID(),kind,value,x:6,y:6,width,height,angle:0,color:"#17242c",fontSize:9,bold:kind==="text"};
}

export function keepMarkOnBoard(e: MarkElement, board: Pick<MarkBoard,"width"|"height">): MarkElement {
  const width=Math.min(e.width,board.width), height=Math.min(e.height,board.height);
  return {...e,width,height,x:Math.max(0,Math.min(board.width-width,e.x)),y:Math.max(0,Math.min(board.height-height,e.y))};
}

export function outsideMarkSafeArea(e: MarkElement, board: MarkBoard) {
  const rad = e.angle * Math.PI / 180;
  const halfWidth = (Math.abs(Math.cos(rad)) * e.width + Math.abs(Math.sin(rad)) * e.height) / 2;
  const halfHeight = (Math.abs(Math.sin(rad)) * e.width + Math.abs(Math.cos(rad)) * e.height) / 2;
  const cx=e.x+e.width/2, cy=e.y+e.height/2;
  return cx-halfWidth<MARK_SAFE_AREA-.001 || cy-halfHeight<MARK_SAFE_AREA-.001 ||
    cx+halfWidth>board.width-MARK_SAFE_AREA+.001 || cy+halfHeight>board.height-MARK_SAFE_AREA+.001;
}

const wellFormed = (s: string) => s.replace(/[\uD800-\uDFFF]/gu,"");
const xml = (s: string) => wellFormed(s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\uFFFE\uFFFF]/g,"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&apos;"}[c]!));

export function markElementSvg(e: MarkElement) {
  const {width:w,height:h,color}=e;
  if(e.kind==="symbol"){
    const symbol=shippingMarkSymbol(e.value);
    return symbol ? `<svg width="${w}" height="${h}" viewBox="${symbol.viewBox}" color="${color}" preserveAspectRatio="xMidYMid meet"><metadata>${symbol.source}</metadata>${symbol.paths}</svg>` : "";
  }
  if(e.kind==="image")return `<image href="${e.value}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid meet"/>`;
  if(e.kind==="frame"){
    const stroke=Math.min(.6,w/2,h/2);
    return `<rect x="${stroke/2}" y="${stroke/2}" width="${w-stroke}" height="${h-stroke}" fill="none" stroke="${color}" stroke-width="${stroke}"/>`;
  }
  if(e.kind==="barcode"){
    const code=code39(e.value);
    if(!code)return "";
    return `<svg width="${w}" height="${h}" viewBox="0 0 ${code.width} 30" preserveAspectRatio="none"><rect width="100%" height="100%" fill="white"/>${code.bars.map(bar=>`<rect x="${bar.x}" y="0" width="${bar.width}" height="30" fill="black"/>`).join("")}</svg>`;
  }
  if(e.kind==="qr"){
    const value=wellFormed(e.value);
    if(!value.trim())return "";
    const {modules} = QRCode.create(value,{errorCorrectionLevel:"M"});
    const quiet = 4;
    const size = modules.size + quiet * 2;
    const side = Math.min(w,h);
    const path = [];
    for(let row=0;row<modules.size;row++){
      for(let column=0;column<modules.size;column++){
        if(modules.get(row,column))path.push(`M${column+quiet} ${row+quiet}h1v1h-1z`);
      }
    }
    return `<svg x="${(w-side)/2}" y="${(h-side)/2}" width="${side}" height="${side}" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges"><rect width="${size}" height="${size}" fill="#fff"/><path d="${path.join("")}" fill="#000"/></svg>`;
  }
  return `<svg width="${w}" height="${h}" overflow="hidden"><text fill="${color}" font-size="${e.fontSize}" font-weight="${e.bold?700:400}" font-family="Arial, Noto Sans SC, sans-serif">${e.value.split(/\r?\n/).map((line,i)=>`<tspan x="0" y="${e.fontSize*(1+i*1.25)}">${xml(line)}</tspan>`).join("")}</text></svg>`;
}

export function markBoardSvg(board: MarkBoard, pixels?: number) {
  const aspect = board.width / board.height;
  const width = pixels ? Math.max(1,Math.round(pixels * Math.min(aspect,1))) : `${board.width}mm`;
  const height = pixels ? Math.max(1,Math.round(pixels / Math.max(aspect,1))) : `${board.height}mm`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${board.width} ${board.height}"><rect width="100%" height="100%" fill="white"/>${board.elements.map(e=>`<g transform="translate(${e.x} ${e.y}) rotate(${e.angle} ${e.width/2} ${e.height/2})">${markElementSvg(e)}</g>`).join("")}</svg>`;
}

const artworkUrls=new WeakMap<MarkBoard,string>();

export function markArtworkUrl(board: MarkBoard) {
  const cached=artworkUrls.get(board);
  if(cached)return cached;
  const url=`data:image/svg+xml;charset=utf-8,${encodeURIComponent(markBoardSvg(board,640))}`;
  artworkUrls.set(board,url);
  return url;
}

export function markFaceForAxis(orientation: string, threeAxis: number): MarkFace | undefined {
  const dimension=orientation[[0,2,1][threeAxis]];
  return dimension==="W" ? "front" : dimension==="L" ? "side" : undefined;
}

// Code 39 symbol values as published in ZXing's Code39Reader (Apache-2.0).
const CODE39_ALPHABET="0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-. $/+%";
const CODE39_BITS=[
  0x034,0x121,0x061,0x160,0x031,0x130,0x070,0x025,0x124,0x064,
  0x109,0x049,0x148,0x019,0x118,0x058,0x00d,0x10c,0x04c,0x01c,
  0x103,0x043,0x142,0x013,0x112,0x052,0x007,0x106,0x046,0x016,
  0x181,0x0c1,0x1c0,0x091,0x190,0x0d0,0x085,0x184,0x0c4,0x0a8,
  0x0a2,0x08a,0x02a,
];

export function isCode39(value:string) {
  return /^[0-9A-Z. $/+%-]{0,32}$/.test(value);
}

export function code39(value:string) {
  if(!value.trim()||!isCode39(value))return;
  const bars:{x:number;width:number}[]=[];
  const quiet=10;
  let x=quiet;
  for(const symbol of `*${value}*`){
    const code=symbol==="*"?0x094:CODE39_BITS[CODE39_ALPHABET.indexOf(symbol)];
    for(let i=0;i<9;i++){
      const width=(code&(1<<(8-i)))?3:1;
      if(i%2===0)bars.push({x,width});
      x+=width;
    }
    x++;
  }
  return {width:x-1+quiet,bars};
}
