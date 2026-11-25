import type {ProductInput} from "../lib/packing/types";
import {exactCartonVolumeCbm} from "../lib/packing/volume";
import {fromMillimeters,fromKilograms,lengthUnitPrecision,weightUnitPrecision,type LengthUnit,type WeightUnit} from "../lib/packing/units";
import {tr} from "./language";
import type {GridColumn} from "./ui/excel-data-grid";
export type CargoEntryRow=ProductInput&{search:string};
export function cargoEntryRows(products:ProductInput[]):CargoEntryRow[]{return products.map(p=>({...p,search:[p.id,p.sku,p.name,p.setCode,p.orderLine?.lineReference,p.orderLine?.customer,p.orderLine?.batch].filter(Boolean).join(" ")}));}
export function cargoEntryColumns(length:LengthUnit,weight:WeightUnit,mixed:boolean,singleKit:boolean):GridColumn<CargoEntryRow>[] {
 const columns:GridColumn<CargoEntryRow>[]=[
  {id:"color",header:tr("标识","Color"),className:"cargo-color-cell",value:p=>p.color},
  {id:"sku",header:"SKU",className:"cargo-sku-heading",value:p=>p.sku},
  {id:"settings",header:tr("货物设置","Cargo Settings"),className:"cargo-settings-heading",value:p=>p.name},
  {id:"length",header:`${tr("外箱长","Length")} (${length})`,numeric:true,numberFormat:`0.${"#".repeat(lengthUnitPrecision(length))}`,value:p=>fromMillimeters(p.length,length)},
  {id:"width",header:`${tr("外箱宽","Width")} (${length})`,numeric:true,numberFormat:`0.${"#".repeat(lengthUnitPrecision(length))}`,value:p=>fromMillimeters(p.width,length)},
  {id:"height",header:`${tr("外箱高","Height")} (${length})`,numeric:true,numberFormat:`0.${"#".repeat(lengthUnitPrecision(length))}`,value:p=>fromMillimeters(p.height,length)},
  {id:"cbm",header:tr("CBM 自动 (m³)","CBM (m³)"),numeric:true,numberFormat:"0.0000##",value:exactCartonVolumeCbm},
  {id:"weight",header:`${tr("毛重","Gross")} (${weight})`,numeric:true,numberFormat:`0.${"#".repeat(weightUnitPrecision(weight))}`,value:p=>fromKilograms(p.weight,weight)},
 ];
 if(mixed)columns.push({id:"quantity",header:tr("需求箱数","Cartons"),numeric:true,numberFormat:"0",value:p=>p.quantity});
 if(mixed||singleKit)columns.push({id:"setCode",header:tr("套装编码","Kit Code"),className:"cargo-kit-heading",value:p=>p.setCode??""},{id:"unitsPerSet",header:tr("套内数量 (箱/套)","Cartons / Kit"),numeric:true,numberFormat:"0",value:p=>p.unitsPerSet??1});
 columns.push({id:"actions",header:tr("操作","Actions"),className:"cargo-row-actions",value:()=>null});return columns;
}
export function cargoEntryExportColumns(length:LengthUnit,weight:WeightUnit):GridColumn<CargoEntryRow>[] {
 return [...cargoEntryColumns(length,weight,true,false).filter(c=>!["settings","actions"].includes(c.id)),
 {id:"name",header:tr("品名","Product Name"),value:p=>p.name},
 {id:"lineReference",header:tr("订单行","Order Row"),value:p=>p.orderLine?.lineReference??p.id},
 {id:"customer",header:tr("客户","Customer"),value:p=>p.orderLine?.customer??""},
 {id:"batch",header:tr("批次","Batch"),value:p=>p.orderLine?.batch??""},
 {id:"priority",header:tr("装载优先级","Loading Priority"),numeric:true,numberFormat:"0",value:p=>p.priority},
 {id:"mustLoad",header:tr("必装","Required"),value:p=>p.mustLoad===false?tr("否","No"):tr("是","Yes")},
 {id:"rotationPolicy",header:tr("方向规则","Orientation"),value:p=>p.rotationPolicy==="fixed"?tr("固定方向","Fixed"):p.rotationPolicy==="upright"?tr("仅平面旋转","Upright"):tr("任意旋转","Any")},
 {id:"stackable",header:tr("可承托","Supports Stacking"),value:p=>p.stackable?tr("是","Yes"):tr("否","No")},
 {id:"bottomOnly",header:tr("必须底置","Floor Only"),value:p=>p.bottomOnly?tr("是","Yes"):tr("否","No")},
 {id:"maxStackLayers",header:tr("层数上限 (0=自动)","Layer Limit (0=Automatic)"),numeric:true,numberFormat:"0",value:p=>p.maxStackLayers}];
}
