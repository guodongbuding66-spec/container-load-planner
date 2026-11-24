import {expect,it} from "vitest";
import {CODE_TYPES,codeLayout,codeSvg,type CodeConfig} from "./code-generator";
import {codePlacement,markBoardSvg,markCodeIssues,markElement,parseMarkArtwork} from "./shipping-mark-artwork";
import {withPngDpi} from "./png-print";
const config:CodeConfig={codeType:"code128",value:"ITEM-2026-001",width:100,height:32,showText:true};
it.each(CODE_TYPES)("generates %s using physical modules and complete quiet zones",(type,_,example)=>{
 const c={...config,codeType:type,value:example,width:160,height:55},l=codeLayout(c);
 expect(l.rects.length).toBeGreaterThan(20);expect(l.module).toBeGreaterThanOrEqual(l.minimum);
 expect(l.rects.every(r=>r.x>=0&&r.y>=0&&r.w>0&&r.h>0&&r.x+r.w<=c.width+1e-6&&r.y+r.h<=c.height+1e-6)).toBe(true);
 expect(Math.min(...l.rects.map(r=>r.x))).toBeGreaterThanOrEqual(l.quietModules*l.module-1e-6);
 expect(codeSvg(c)).toContain('width="160mm"');
});
it("normalizes values, validates check digits and refuses unresolved variables and excessive density",()=>{
 expect(codeLayout({...config,codeType:"ean13",value:"690123456789"}).value).toBe("6901234567892");
 expect(()=>codeLayout({...config,codeType:"ean13",value:"6901234567891"})).toThrow();
 expect(()=>codeLayout({...config,value:""})).toThrow();
 expect(codeLayout({...config,value:"{{sku}}"},{sku:"SKU-001"}).value).toBe("SKU-001");
 expect(()=>codeLayout({...config,value:"{{missing}}"})).toThrow(/Unknown variable/);
 expect(()=>codeLayout({...config,width:8,value:"A".repeat(100)})).toThrow(/dense/);
 expect(codeLayout({...config,codeType:"code39",value:"box-001"}).value).toBe("BOX-001");
 expect(codeSvg({...config,showText:false})).not.toContain("<text");
 // UPC-A and zero-prefixed EAN-13 encode the same GTIN bars; some scanners
 // return the canonical 13-digit representation even when reporting UPC-A.
 expect(codeLayout({...config,codeType:"upca",value:"012345678905"}).rects).toEqual(codeLayout({...config,codeType:"ean13",value:"0012345678905"}).rects);
});
it("retains generated code editability and millimeter geometry through artwork backup",()=>{
 const e={...markElement("code",config.value,100,32),x:6,y:6,codeType:config.codeType,codeShowText:true};
 const art={front:{width:250,height:80,elements:[e]},side:{width:250,height:80,elements:[]}};
 expect(parseMarkArtwork(JSON.parse(JSON.stringify(art)))).toEqual(art);
 const svg=markBoardSvg(art.front);expect(svg).toContain('width="100" height="32" viewBox="0 0 100 32"');
 expect(()=>parseMarkArtwork({...art,front:{...art.front,elements:[{...e,width:8}]}})).toThrow();
 const old={...markElement("barcode","OLD-001",100,25)};expect(parseMarkArtwork({...art,front:{...art.front,elements:[old]}}).front.elements[0].kind).toBe("barcode");
});
it("finds a clear insertion without trimming codes and detects covered quiet zones",()=>{
 const board={width:250,height:80,elements:[{...markElement("text","Text",45,36),x:4,y:4}]};
 const e={...markElement("code","ITEM-001",100,32),codeType:"code128" as const,codeShowText:true};
 const placed=codePlacement(board,e);expect(placed.x).toBeGreaterThan(49);expect(placed.width).toBe(100);
 expect(markCodeIssues({...board,elements:[...board.elements,placed]})).toEqual([]);
 expect(markCodeIssues({...board,elements:[...board.elements,{...placed,x:4}]})).toHaveLength(1);
 expect(()=>codePlacement({...board,width:80},e)).toThrow(/No clear area/);
 const frame={...markElement("frame","",230,60),x:6,y:6},code={...placed,x:12,y:12};
 expect(markCodeIssues({width:250,height:80,elements:[frame,code]})).toEqual([]);
 expect(markCodeIssues({width:250,height:80,elements:[frame,{...code,x:5}]})).toHaveLength(1);
});
it("writes exactly one 300-DPI physical-resolution chunk",()=>{
 const png=Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=","base64"));
 const result=withPngDpi(withPngDpi(png));const text=Buffer.from(result).toString("latin1");
 expect(text.split("pHYs")).toHaveLength(2);const offset=text.indexOf("pHYs"),view=new DataView(result.buffer);expect(view.getUint32(offset+4)).toBe(11811);expect(view.getUint32(offset+8)).toBe(11811);expect(result[offset+12]).toBe(1);
});
