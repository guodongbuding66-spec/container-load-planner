import {afterEach,expect,it,vi} from "vitest";
import {renderMeasurementPdf} from "./measurement-pdf";
import {createMeasurementReport} from "./measurement-report";
import {layoutMeasurementReport} from "./measurement-report-layout";
import {reportPlan,solidRecord,wallRecord,reportOptions} from "../../tests/measurement-report-fixture";
afterEach(()=>vi.unstubAllGlobals());
function canvasFixture(failure?:"context"|"encoding"){
  const text=vi.fn(),ctx={font:"",fillStyle:"",strokeStyle:"",lineWidth:1,fillRect(){},strokeRect(){},beginPath(){},moveTo(){},lineTo(){},arc(){},stroke(){},fill(){},fillText:text,measureText:(s:string)=>({width:[...s].length*20})};
  vi.stubGlobal("document",{fonts:{ready:Promise.resolve()},createElement:()=>({width:0,height:0,getContext:()=>failure==="context"?null:ctx,toBlob:(done:(b:Blob|null)=>void)=>done(failure==="encoding"?null:new Blob([new Uint8Array([255,216,255,217])]))})});return text;
}
it("renders every measured record and page into a valid raster PDF structure",async()=>{const texts=canvasFixture(),r=createMeasurementReport(reportPlan,[{...solidRecord(),visible:false},{...wallRecord(),scope:"0000000000000000"}],reportOptions),bytes=await renderMeasurementPdf(r),raw=new TextDecoder().decode(bytes),pages=layoutMeasurementReport(r,s=>[...s].length*20);expect(raw.startsWith("%PDF-1.4")).toBe(true);expect(raw).toContain(`/Count ${pages.length}`);expect(raw).toContain("xref");expect(raw).toContain("%%EOF");const drawn=texts.mock.calls.map(c=>String(c[0])).join("\n");for(const expected of ["500.000 mm","10.000 mm","CURRENT:","REMEASURE:","Raw values mm:","U opening","Rear clearance"])expect(drawn).toContain(expected);expect(texts.mock.calls.filter(c=>String(c[0]).startsWith("Page "))).toHaveLength(pages.length);});
it("refuses to produce a plausible file when the browser cannot provide a canvas",async()=>{canvasFixture("context");await expect(renderMeasurementPdf(createMeasurementReport(reportPlan,[solidRecord()],reportOptions))).rejects.toThrow("canvas");});
it("propagates image encoding failure instead of downloading missing pages",async()=>{canvasFixture("encoding");await expect(renderMeasurementPdf(createMeasurementReport(reportPlan,[solidRecord()],reportOptions))).rejects.toThrow("encoding");});
