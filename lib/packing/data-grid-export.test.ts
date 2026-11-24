import {expect,it} from "vitest";
import ExcelJS from "exceljs";
import {gridTsv,gridWorkbook} from "./data-grid-export";
import {palletDiagnosticGroups} from "./pallet-diagnostic-groups";
import {inspectPalletCapacity} from "./pallet-capacity";
import {packLoadingWorkflow} from "./pack-loading";
import {packagingCapacityFixture} from "../../tests/packaging-capacity-fixture";
it("exports all original rows, keeps unknown values blank and prevents clipboard formulas",async()=>{
 const rows=[["P1",0,null],["=HYPERLINK(\"x\")",12.5,100]];
 expect(gridTsv(["Unit","kg","Limit"],rows)).toContain("'=" );
 const bytes=await gridWorkbook(["Unit","kg","Limit"],rows),book=new ExcelJS.Workbook();await book.xlsx.load(bytes.buffer as ArrayBuffer);
 const s=book.worksheets[0];expect(s.rowCount).toBe(3);expect(s.getCell("B2").value).toBe(0);expect(s.getCell("C2").value).toBeNull();
 expect(s.getCell("A3").type).toBe(ExcelJS.ValueType.String);expect(s.views[0].state).toBe("frozen");
});
it("groups identical relative cargo geometry but separates a changed SKU",()=>{
 const plan=packLoadingWorkflow(packagingCapacityFixture()),report=inspectPalletCapacity(plan)!;
 const p=plan.pallets![0],boxes=plan.placements.filter(b=>b.palletIds?.[0]===p.id);
 plan.pallets=[p,{...p,id:"copy",x:p.x+10000}];
 plan.placements=[...boxes,...boxes.map(b=>({...b,id:b.id+"-copy",x:b.x+10000,palletIds:["copy"]}))];
 const rows=[report.rows[0],{...report.rows[0],id:"copy"}];
 expect(palletDiagnosticGroups(plan,rows).map(g=>g.length)).toEqual([2]);
 plan.placements.at(-1)!.sku="different";expect(palletDiagnosticGroups(plan,rows).map(g=>g.length)).toEqual([1,1]);
});
