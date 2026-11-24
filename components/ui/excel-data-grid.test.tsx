import {renderToStaticMarkup} from "react-dom/server";
import {expect,it} from "vitest";
import {ExcelDataGrid} from "./excel-data-grid";
const rows=Array.from({length:30},(_,n)=>({id:`row-${n}`,search:`SKU-${n}`,quantity:n}));
it("honors the controlled page for editable rows and renders full-width details",()=>{
 const html=renderToStaticMarkup(<ExcelDataGrid rows={rows} columns={[{id:"quantity",header:"Cartons",numeric:true,value:r=>r.quantity}]} label="Cargo" pageSize={25} pageIndex={1} onPageChange={()=>{}} renderRow={r=><><tr><td>{r.id}</td></tr><tr><td colSpan={1}>Rules {r.id}</td></tr></>}/>);
 expect(html).toContain("row-25");expect(html).toContain("row-29");expect(html).not.toContain("row-24");expect(html).toContain("Rules row-25");expect(html).toContain("26–30");
});
it("blocks all spreadsheet actions while a numeric draft is invalid or pending",()=>{
 const html=renderToStaticMarkup(<ExcelDataGrid rows={rows} columns={[{id:"quantity",header:"Cartons",value:r=>r.quantity}]} label="Cargo" exportDisabled/>);
 expect((html.match(/<button[^>]*disabled=""/g)??[]).length).toBeGreaterThanOrEqual(2);expect(html).toContain("完成有效输入后即可复制或导出。");
});
