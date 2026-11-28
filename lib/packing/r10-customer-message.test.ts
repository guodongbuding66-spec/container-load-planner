import {describe,it,expect} from "vitest";
import {parseSmartCargoText} from "./smart-import";
describe("Customer messages and existing spreadsheet inputs",()=>{
 it("recognizes labelled Chinese dimensions, units, gross and cartons",()=>{
  const r=parseSmartCargoText("货号 SHED-101，品名：工具房，长220厘米，宽62cm，高18cm，毛重42.5kg，数量30箱。");
  expect(r.validCount).toBe(1);expect(r.rows[0]).toMatchObject({sku:"SHED-101",lengthMm:2200,widthMm:620,heightMm:180,weightKg:42.5,quantity:30});
 });
 it("keeps separate messages and converts explicit axis units",()=>{
  const r=parseSmartCargoText("SKU A, length 220cm, width 620mm, height 0.18m, weight 42.5kg, qty 30\n货号B，尺寸60x40x35cm，毛重12kg，80箱");
  expect(r.validCount).toBe(2);expect(r.rows[0].heightMm).toBe(180);expect(r.rows[1]).toMatchObject({sku:"B",lengthMm:600,quantity:80});
 });
 it("retains invalid and incomplete rows instead of guessing missing values",()=>{
  const r=parseSmartCargoText("货号A，长-60cm，宽40cm，高35cm，毛重12kg，数量10.5箱\n货号B，长60cm，宽40cm，高35cm，毛重12kg");
  expect(r.validCount).toBe(0);expect(r.errorCount).toBe(2);
 });
 it("preserves Chinese spreadsheet headers and strict CSV behavior",()=>{
  const r=parseSmartCargoText("货号,外箱长,外箱宽,外箱高,毛重(kg),箱数\nA,600,400,350,12,80");
  expect(r.headerMatched).toBe(true);expect(r.validCount).toBe(1);expect(r.rows[0].lengthMm).toBe(600);
 });
});
