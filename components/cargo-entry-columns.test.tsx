import {expect,it} from "vitest";
import {cargoEntryColumns,cargoEntryExportColumns,cargoEntryRows} from "./cargo-entry-columns";
import {DEMO_PRODUCTS} from "../lib/packing/demo-order";
import {gridTsv,gridWorkbook} from "../lib/packing/data-grid-export";
import ExcelJS from "exceljs";
it("keeps carton identity, kit metadata and searchable order references without mutating source",()=>{
 const products=structuredClone(DEMO_PRODUCTS);products[0].orderLine={orderReference:"PO-117",lineReference:"PO-117",customer:"Retailer",batch:"B-8",destination:"Warehouse",stop:1};products[0].setCode="KIT-A";
 const rows=cargoEntryRows(products);expect(rows[0].search).toContain("PO-117 Retailer B-8");expect(rows[0].search).toContain("KIT-A");expect(products[0]).not.toHaveProperty("search");
 expect(cargoEntryColumns("mm","kg",true,false)).toHaveLength(12);expect(cargoEntryColumns("mm","kg",false,false)).toHaveLength(9);expect(cargoEntryColumns("mm","kg",false,true)).toHaveLength(11);
});
it("exports all rows, precise selected units and off-screen rules as typed Excel cells",async()=>{
 const rows=cargoEntryRows(structuredClone(DEMO_PRODUCTS)),columns=cargoEntryExportColumns("in","lb");
 const values=rows.map(p=>columns.map(c=>c.value(p))),headers=columns.map(c=>c.header);
 expect(columns.find(c=>c.id==="length")!.value(rows[0])).toBeCloseTo(2200/25.4,9);
 expect(columns.find(c=>c.id==="weight")!.value(rows[0])).toBeCloseTo(42.5/.45359237,9);
 expect(columns.some(c=>c.id==="maxStackLayers")).toBe(true);expect(columns.some(c=>c.id==="mustLoad")).toBe(true);
 expect(gridTsv(headers,values).split("\n")).toHaveLength(rows.length+1);
 const book=new ExcelJS.Workbook();await book.xlsx.load(await gridWorkbook(headers,values) as never);
 const sheet=book.worksheets[0],col=columns.findIndex(c=>c.id==="length")+1;
 expect(sheet.getCell(1,col).value).toContain("(in)");expect(sheet.getCell(2,col).value).toBeCloseTo(2200/25.4,9);expect(sheet.rowCount).toBe(rows.length+1);
 expect(DEMO_PRODUCTS[0].length).toBe(2200);
});
