import {describe,it,expect} from "vitest";
import {wrapTradePdfText} from "./trade-sheet-pdf";

describe("R10 PDF draft text wrapping",()=>{
 it("keeps ordinary English words whole when a declaration wraps",()=>{
  const text="DRAFT / ESTIMATE ONLY — Enter verified Container No., Booking/B/L No., and Shipper before formal SOLAS submission.";
  const rows=wrapTradePdfText(text,95,s=>s.length);
  expect(rows.length).toBeGreaterThan(1);
  expect(rows.flatMap(row=>row.split(/\s+/u))).toEqual(text.split(/\s+/u));
  expect(rows.every(row=>row.length<=95)).toBe(true);
 });
 it("wraps continuous Chinese and oversized references without losing characters",()=>{
  for(const text of ["集装箱核实总重申报单请复核现场实际重量", "https://example.com/ABCDEFGHIJKLMNOPQRSTUVWXYZ"]){
   const rows=wrapTradePdfText(text,10,s=>[...s].length);
   expect(rows.join("")).toBe(text);
   expect(rows.every(row=>[...row].length<=10)).toBe(true);
  }
 });
});
