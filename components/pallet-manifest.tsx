"use client";
import {bottomDeckText} from "../lib/packing/packaging";
import {palletLoadEnvelope} from "../lib/packing/unit-envelope";
import {looseManifest} from "../lib/packing/loose-cargo";
import {CrateActualStackReport} from "./crate-actual-stack-report";
import {DeckSupportPanel} from "./deck-support-panel";
import {palletEnvelopeTop} from "../lib/packing/deck-support";
import type {PalletLayerTemplate} from "../lib/packing/pallet-layer";
import { useMemo, useState } from "react";
import { PalletUnitViewer } from "./pallet-unit-viewer";
import { tr, useLanguage } from "./language";
import type { PackingResult, PlacedBox, ProductInput } from "../lib/packing/types";
import { palletCargoCeiling } from "../lib/packing/floor-pallets";
import { CHOICE_REASON_TEXT } from "../lib/packing/packaging-choice";
import { specificationForPallet } from "../lib/packing/pallet-specifications";
import {ExcelDataGrid,type GridColumn} from "./ui/excel-data-grid";
export function PalletManifest({ result, anchor, products, disabled=false, onAdopt,layerTemplates,onLayerTemplatesChange,initiallyOpen=false,printing=false }: { result: PackingResult;anchor?:string;products?:ProductInput[];disabled?:boolean;initiallyOpen?:boolean;printing?:boolean;layerTemplates?:PalletLayerTemplate[];onLayerTemplatesChange?:(templates:PalletLayerTemplate[])=>void;onAdopt?:(plan:PackingResult)=>void }) {
  useLanguage();
  const [inspect,setInspect]=useState<string|null>(null);
  const loose=looseManifest(result);
  const only=result.workflow==="pallet-only",loaded=result.pallets?.length??0,prepared=result.palletization?.preparedCount??loaded;
  const rows = useMemo(()=>{
    const cargoByPallet=new Map<string,PlacedBox[]>();
    for(const box of result.placements)for(const id of box.palletIds??[]){
      const list=cargoByPallet.get(id)??[];
      list.push(box);
      cargoByPallet.set(id,list);
    }
    return (result.pallets??[]).map(p=>{
      const config=result.palletization?specificationForPallet(result.palletization,p).config:result.floorPallets;
      const ceiling=config?palletCargoCeiling(result.container,result.clearance,config):0;
      const cargo=cargoByPallet.get(p.id)??[];
      const top=Math.max(p.z+p.dz,...cargo.map(b=>b.z+b.dz));
      const counts=new Map<string,number>();
      for(const b of cargo)counts.set(b.sku,(counts.get(b.sku)??0)+1);
      const contents=[...counts].map(([sku,n])=>`${sku} × ${n}`).join(" · ");
      return {p,cargo,top,ceiling,height:palletEnvelopeTop(p,cargo)-p.z,gross:p.weight+cargo.reduce((n,b)=>n+b.weight,0),
        contents,search:[p.id,p.name,p.specificationId,contents,...new Set(cargo.map(b=>b.setCode))].join(" ")};
    });
  },[result]);
  const [grouped,setGrouped]=useState(true),[expanded,setExpanded]=useState<Set<string>>(()=>new Set());
  type Row=typeof rows[number]&{id:string;count:number;members?:Row[];detail?:boolean};
  const original:Row[]=rows.map(r=>({...r,id:r.p.id,count:1}));
  const groups=new Map<string,Row[]>();
  for(const r of original){const p=r.p;
    const key=JSON.stringify([p.name,p.presetId,p.dx,p.dy,p.dz,p.z,p.weight,p.maxLoad,p.orientation,p.enclosureHeight,p.packaging,p.measuredEnvelope,r.ceiling,r.height,
      r.cargo.map(b=>[b.productId,b.sku,b.x-p.x,b.y-p.y,b.z-p.z,b.dx,b.dy,b.dz,b.weight,b.orientation,b.setCode]).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))]);
    const list=groups.get(key)??[];list.push(r);groups.set(key,list);
  }
  const gridRows:Row[]=grouped?[...groups.values()].flatMap(members=>{if(members.length===1)return members;const id="manifest-"+members[0].id,summary={...members[0],id,count:members.length,members,search:members.map(r=>r.search).join(" ")};return [summary,...(expanded.has(id)?members.map(r=>({...r,detail:true})):[])];}):original;
  const columns:GridColumn<Row>[]=[
    {id:"unit",header:tr("托号／规格","Unit / specification"),value:r=>r.members?`${r.members[0].p.id} … ${r.members.at(-1)!.p.id}`:r.p.id,render:r=><>{r.members?<button type="button" className="grid-expand" aria-expanded={expanded.has(r.id)} onClick={()=>setExpanded(p=>{const next=new Set(p);if(next.has(r.id))next.delete(r.id);else next.add(r.id);return next;})}>{expanded.has(r.id)?tr("收起","Collapse"):tr("展开","Expand")} · {r.members[0].p.id} … {r.members.at(-1)!.p.id}</button>:<button type="button" className={`pallet-inspect-button ${r.detail?"grid-child-unit":""}`} aria-label={`${tr("查看整托","Inspect unit")} ${r.p.id}`} onClick={()=>setInspect(r.p.id)}>{r.p.id}{r.p.locked&&` · ${tr("已锁定","Locked")}`}</button>}<small>{r.p.name}</small></>},
    {id:"units",header:tr("托数","Units"),numeric:true,value:r=>r.count},
    {id:"contents",header:tr("托内货物／托","Contents / unit"),value:r=>r.contents},
    {id:"cartons",header:tr("箱数／托","Cartons / unit"),numeric:true,value:r=>r.cargo.length},
    {id:"height",header:tr("整托外部总高 mm","Complete unit height mm"),numeric:true,value:r=>r.height},
    {id:"gross",header:tr("总重 kg／托","Gross kg / unit"),numeric:true,value:r=>r.gross},
    {id:"xyz",header:"X / Y / Z mm",value:r=>r.members?null:`${r.p.x} / ${r.p.y} / ${r.p.z}`,render:r=>r.members?tr("展开查看各托坐标","Expand for individual coordinates"):`${r.p.x} / ${r.p.y} / ${r.p.z}`},
    {id:"base",header:tr("底座长 × 宽 × 高 mm","Base L × W × H mm"),value:r=>`${r.p.dx} × ${r.p.dy} × ${r.p.dz} · ${tr(...bottomDeckText(r.p.packaging,r.p.dz))}`},
    {id:"tare",header:tr("自重 kg／托","Tare kg / unit"),numeric:true,value:r=>r.p.weight},
    {id:"load",header:tr("额定承重 kg","Payload kg"),numeric:true,value:r=>r.p.maxLoad},
    {id:"start",header:tr("货物起始 Z mm","Cargo base Z mm"),numeric:true,value:r=>r.cargo.length?Math.min(...r.cargo.map(b=>b.z)):null},
    {id:"top",header:tr("已装最高 Z mm","Loaded top Z mm"),numeric:true,value:r=>r.cargo.length?r.top:null},
    {id:"limit",header:tr("允许最高 Z mm","Ceiling Z mm"),numeric:true,value:r=>r.ceiling?Math.min(result.container.height-result.clearance,r.p.z+r.ceiling):null},
  ];
  const table=(visibleRows:typeof rows,interactive:boolean)=>visibleRows.length>0?<div className="coordinate-wrap record-table" role="region" aria-label={tr("整托坐标表","Pallet positions table")} tabIndex={interactive?0:undefined}><table className="coordinate-table"><thead><tr><th>{tr("托盘编号")}</th><th>{tr("托内货物", "Pallet contents")}</th><th>{tr("箱数", "Cartons")}</th><th>{tr("整托外部总高", "Complete unit height")} mm</th><th>{tr("整托总重", "Gross weight")} kg</th><th>X / Y / Z</th><th>{tr("底座长 × 宽 × 高", "Base L × W × H")}</th><th>{tr("自重")}</th><th>{tr("额定承重")}</th><th>{tr("货物起始 Z")}</th><th>{tr("已装货物最高 Z")}</th><th>{tr("允许最高 Z")}</th></tr></thead><tbody>{visibleRows.map(({p,cargo,top,ceiling,height,gross,contents})=><tr key={p.id}><td>{interactive?<button className="pallet-inspect-button" type="button" aria-label={`${tr("查看整托","Inspect unit")} ${p.id}`} onClick={()=>setInspect(p.id)}>{p.id}{p.locked&&` · ${tr("已锁定","Locked")}`}{p.specificationId&&<small>{p.name}</small>}</button>:<>{p.id} · {p.name}</>}</td><td>{contents}</td><td>{cargo.length}</td><td>{height.toFixed(1)}</td><td>{gross.toFixed(1)}</td><td>{p.x} / {p.y} / {p.z}</td><td>{p.dx} × {p.dy} × {p.dz} · <small>{tr(...bottomDeckText(p.packaging,p.dz))}</small></td><td>{p.weight} kg</td><td>{p.maxLoad} kg</td><td>{cargo.length?Math.min(...cargo.map(b=>b.z)):tr("未装货")}</td><td>{cargo.length?top:tr("未装货")}</td><td>{ceiling ? Math.min(result.container.height-result.clearance,p.z+ceiling) : "—"}</td></tr>)}</tbody></table></div>:null;
  const looseTable=loose.length>0&&<section aria-label={tr("散箱混装清单","Loose cargo manifest")}><h3>{tr("散箱混装清单","Loose cargo manifest")}</h3><p className="helper-text">{tr("预留箱数分配在生成整托之前；已散装货物的 XYZ 使用柜内基准，不加底座高度。未装数量同时包含未入柜整托和未装散箱。","Reservations are allocated before building units. Loose cargo XYZ uses the vehicle frame without deck height. Unloaded totals include both unloaded units and loose cartons.")}</p><div className="coordinate-wrap"><table className="coordinate-table"><thead><tr><th>SKU</th><th>{tr("预留散装","Reserved loose")}</th><th>{tr("已散装","Loaded loose")}</th><th>{tr("已打托入柜","Loaded on units")}</th><th>{tr("未装","Unloaded")}</th><th>{tr("散箱重量 kg","Loose weight kg")}</th></tr></thead><tbody>{loose.map(r=><tr key={r.productId}><td>{r.sku}</td><td>{r.reserved}</td><td>{r.loose}</td><td>{r.palletized}</td><td>{r.unloaded}</td><td>{r.weightKg.toFixed(1)}</td></tr>)}</tbody></table></div></section>;
  if (!loaded&&!loose.length) return null;
  return <article id={anchor} className="panel pallet-manifest record-panel">
    <details className="record-disclosure record-screen-only" open={initiallyOpen||undefined}>
    <summary><span>{only ? tr("打托清单与托内货物", "Pallet manifest and contents") : tr(result.palletization ? "整托入柜与货物基准" : "托盘铺设与货物基准", result.palletization ? "Loaded pallets and cargo coordinates" : "Floor pallets and cargo coordinates")}</span>
      <small>{result.palletization&&!only?`${tr("入柜","Loaded")} ${loaded} / ${tr("已打托","Prepared")} ${prepared}`:`${loaded} ${tr("托","pallets")}`}{result.palletization?.manualPreparation&&` · ${tr("人工布置","Manual layout")}`}</small>
    </summary>
    <p className="helper-text">{only?tr("XYZ 为独立托盘的编组坐标。托面以上的位置可在整托编辑器查看。","XYZ gives inspection positions. Open the pallet editor for positions above the deck.") : tr("XYZ 使用柜内基准，货物 Z 已计入底座高度。","XYZ uses vehicle coordinates. Cargo Z includes deck height.")}{result.palletization?.bounded&&tr(" · 达到搜索上限，剩余订单仍保留"," · Search limit reached; unmet quantities are retained")}</p>
    {!only&&result.palletization&&<p className="helper-text">{tr("上层整托也保留底座及自重。","Elevated units retain their bases and tare.")}</p>}
    {onAdopt&&result.palletization&&<p className="helper-text">{tr("点击托号可查看／编辑托内货物。","Select a pallet ID to inspect or edit its contents.")}</p>}
    {result.palletization?.specifications&&<div className="pallet-specification-totals" aria-label={tr("包装规格汇总","Packaging specification totals")}>{result.palletization.specifications.map(s=><span key={s.id}><strong>{s.config.name}</strong> · {tr("已生成","Prepared")} {result.palletization!.preparedBySpecification?.[s.id]??0} · {tr("当前清单","In manifest")} {(result.pallets??[]).filter(p=>p.specificationId===s.id).length} / {tr("可用","Available")} {s.maxPallets}</span>)}</div>}
    {loaded>0&&<><label className="grid-group-toggle"><input type="checkbox" checked={grouped} onChange={e=>setGrouped(e.target.checked)}/>{tr("合并同类托盘","Group identical pallets")}</label><p className="helper-text">{tr("合并行展示每托数值；坐标需展开逐托查看。复制和 Excel 包含全部原始托盘。","Grouped rows show per-unit values. Expand for individual positions. Copy and Excel include every original pallet.")}</p><ExcelDataGrid rows={gridRows} columns={columns} exportRows={original} label={tr("搜索整托","Search pallets")}/></>}
    {result.palletization?.selection==="compact"&&!result.palletization.manualPreparation&&<details className="packaging-choice-report"><summary>{tr("包装自动比选依据（生成时记录）","Packaging comparison basis (at generation)")}</summary><div className="manifest-comparison">{result.palletization.selectionChoices?.length?result.palletization.selectionChoices.map(choice=><section key={choice.palletId}><strong>{choice.palletId} · {tr(CHOICE_REASON_TEXT[choice.reason][0],CHOICE_REASON_TEXT[choice.reason][1])}</strong><div className="upgrade-table-wrap"><table><thead><tr><th>{tr("规格","Specification")}</th><th>{tr("箱数","Cartons")}</th><th>{tr("完整外形 mm","Complete exterior mm")}</th><th>{tr("外包络 m³","Envelope m³")}</th><th>{tr("包装自重 kg","Packaging tare kg")}</th><th>{tr("选择","Choice")}</th></tr></thead><tbody>{choice.candidates.map(c=><tr key={c.specificationId}><td>{result.palletization?.specifications?.find(s=>s.id===c.specificationId)?.config.name??c.specificationId}</td><td>{c.cartons}</td><td>{c.exterior.join(" × ")}</td><td>{(c.exterior.reduce((n,v)=>n*v,1)/1e9).toFixed(4)}</td><td>{c.tareKg}</td><td>{choice.chosenSpecificationId===c.specificationId?tr("已选","Selected"):"—"}</td></tr>)}</tbody></table></div></section>):<p>{tr("无可用生成记录；重新自动打托可重新比选。","No generation records; rebuild pallets automatically to compare the packaging again.")}</p>}</div></details>}
    {looseTable}
    {result.pallets?.some(p=>p.measuredEnvelope)&&<section aria-label={tr("已采用实测保守包络","Adopted measured conservative envelopes")}><h3>{tr("已采用实测保守包络","Adopted measured conservative envelopes")}</h3><p>{tr("棕色包络表示装载占位，底座和托内可用空间未扩大。整单重新计算使用原标称输入；修改托内货物需重新测量。","Brown envelopes reserve loading space; bases and usable interiors are unchanged. Whole-order recalculation uses nominal inputs; changed contents need new measurements.")}</p><div className="coordinate-wrap"><table className="coordinate-table"><thead><tr><th>{tr("整托","Unit")}</th><th>XYZ mm</th><th>{tr("装载包络 mm","Loading envelope mm")}</th><th>{tr("来源及日期","Source and date")}</th></tr></thead><tbody>{result.pallets.filter(p=>p.measuredEnvelope).map(p=>{const e=palletLoadEnvelope(p,result.placements.filter(b=>b.palletIds?.includes(p.id)));return <tr key={p.id}><th>{p.id}</th><td>{e.x} / {e.y} / {e.z}</td><td>{e.dx} × {e.dy} × {e.dz}</td><td>{p.measuredEnvelope!.source} · {p.measuredEnvelope!.date}</td></tr>;})}</tbody></table></div></section>}
    <DeckSupportPanel result={result} products={products} disabled={disabled}/>
    <CrateActualStackReport plan={result}/>
    {inspect&&(result.pallets??[]).some(p=>p.id===inspect)&&<PalletUnitViewer layerTemplates={layerTemplates} onLayerTemplatesChange={onLayerTemplatesChange} key={`${result.id}/${inspect}`} result={result} id={inspect} products={products} disabled={disabled} onAdopt={onAdopt?next=>{onAdopt(next);setInspect(null);}:undefined} onClose={()=>setInspect(null)}/>}
    </details>
    {printing&&<section className="record-print-only">{loaded>0&&<><h2>{tr("整托清单","Pallet manifest")}</h2>{table(rows,false)}</>}{looseTable}</section>}
  </article>;
}
