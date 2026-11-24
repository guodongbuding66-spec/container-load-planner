export type GridValue=string|number|null;
const safeText=(s:string)=>/^[\s]*[=+@-]/.test(s)?"'"+s:s;
export function gridTsv(headers:string[],rows:GridValue[][]){
 return [headers,...rows].map(row=>row.map(value=>typeof value==="number"?String(value):safeText(value??"").replace(/[\t\r\n]+/g," ")).join("\t")).join("\n");
}
export async function gridWorkbook(headers:string[],rows:GridValue[][]){
 const {default:ExcelJS}=await import("exceljs"),book=new ExcelJS.Workbook(),sheet=book.addWorksheet("CargoFit");
 sheet.addRow(headers);rows.forEach(row=>sheet.addRow(row));sheet.views=[{state:"frozen",ySplit:1}];
 sheet.autoFilter={from:{row:1,column:1},to:{row:rows.length+1,column:headers.length}};
 sheet.columns.forEach((c,i)=>{c.width=Math.min(56,Math.max(14,headers[i].length*2+4));});
 sheet.eachRow((row,n)=>row.eachCell({includeEmpty:true},cell=>{
  cell.border={top:{style:"thin",color:{argb:"FFE2E8F0"}},bottom:{style:"thin",color:{argb:"FFE2E8F0"}},left:{style:"thin",color:{argb:"FFE2E8F0"}},right:{style:"thin",color:{argb:"FFE2E8F0"}}};
  if(n===1){cell.font={bold:true};cell.fill={type:"pattern",pattern:"solid",fgColor:{argb:"FFF1F5F9"}};}
  else if(typeof cell.value==="number"){cell.alignment={horizontal:"right"};cell.numFmt="0.0#";}
 }));return new Uint8Array(await book.xlsx.writeBuffer());
}
