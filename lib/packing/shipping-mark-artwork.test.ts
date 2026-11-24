import {describe,expect,it} from "vitest";
import {SHIPPING_MARK_SYMBOLS} from "./shipping-mark-symbols";
import { code39, markArtworkUrl, markBoardSvg, markElement, markFaceForAxis, outsideMarkSafeArea, parseMarkArtwork } from "./shipping-mark-artwork";

describe("shipping mark artwork",()=>{
  it("keeps vector dimensions, escapes markup and accepts CJK and supplementary characters",()=>{
    const board={width:250,height:80,elements:[markElement("text","<svg> 箱 🚚 \ud800",100,20),markElement("qr","ITEM-001",30,30)]};
    const svg=markBoardSvg(board);
    expect(svg).toContain('width="250mm" height="80mm" viewBox="0 0 250 80"');
    expect(svg).toContain("&lt;svg&gt; 箱 🚚");
    expect(svg).toContain("shape-rendering");
    expect(()=>markArtworkUrl(board)).not.toThrow();
  });

  it("keeps barcode start, stop and quiet zones, and rejects invalid code or foreign images",()=>{
    const barcode=code39("A")!;
    expect(barcode.width).toBe(67);
    expect(barcode.bars[0]).toEqual({x:10,width:1});
    expect(barcode.bars.at(-1)).toEqual({x:56,width:1});
    expect(code39("中文")).toBeUndefined();
    const empty={width:250,height:80,elements:[]};
    expect(()=>parseMarkArtwork({front:empty,side:{...empty,elements:[markElement("image","https://example.org/x.svg",100,20)]}})).toThrow();
  });

  it("preserves user-supplied handling symbols as editable vectors in both exported artboards",()=>{
    expect(SHIPPING_MARK_SYMBOLS.length).toBe(24);
    for(const symbol of SHIPPING_MARK_SYMBOLS){
      const element=markElement("symbol",symbol.id,20,20);
      const front={width:250,height:80,elements:[element]},side={width:200,height:64,elements:[]};
      expect(parseMarkArtwork({front,side}).front.elements[0].value).toBe(symbol.id);
      const svg=markBoardSvg(front);
      expect(svg).toContain('preserveAspectRatio="xMidYMid meet"');
      expect(svg).toContain("<path");
      expect(svg).not.toContain("<script");
      expect(symbol.viewBox.split(" ").slice(2).every(n=>Number(n)>0)).toBe(true);
    }
    expect(()=>parseMarkArtwork({front:{width:250,height:80,elements:[markElement("symbol","arbitrary",20,20)]},side:{width:200,height:64,elements:[]}})).toThrow();
  });

  it("maps the short and long faces through carton rotation and flags a rotated layer crossing the safe margin",()=>{
    expect([0,1,2].map(axis=>markFaceForAxis("LWH",axis))).toEqual(["side",undefined,"front"]);
    expect([0,1,2].map(axis=>markFaceForAxis("WLH",axis))).toEqual(["front",undefined,"side"]);
    expect([0,1,2].map(axis=>markFaceForAxis("HLW",axis))).toEqual([undefined,"front","side"]);
    const e=markElement("text","A",60,12),board={width:250,height:80,elements:[e]};
    expect(outsideMarkSafeArea(e,board)).toBe(false);
    expect(outsideMarkSafeArea({...e,angle:90},board)).toBe(true);
  });
});

it("renders every uploaded symbol with valid SVG attributes and retains barcode readable text",()=>{
 for(const symbol of SHIPPING_MARK_SYMBOLS){
  expect(symbol.paths).not.toMatch(/\s[\w-]+-symbol-clip-(?:path|rule)=/);
  expect(symbol.paths).toContain('fill="currentColor"');
 }
 const svg=markBoardSvg({width:250,height:80,elements:[markElement("barcode","BED-205",150,35)]});
 expect(svg).toContain('text-anchor="middle"');expect(svg).toContain('>BED-205</text>');
 expect(SHIPPING_MARK_SYMBOLS[0].viewBox.split(" ").map(Number)[2]).toBeGreaterThan(400);
});
