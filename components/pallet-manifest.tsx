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
import {RecordPageControls,useRecordPage} from "./record-page";
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
  const page=useRecordPage(rows);
  const table=(visibleRows:typeof rows,interactive:boolean)=>visibleRows.length>0?<div className="coordinate-wrap record-table" role="region" aria-label={tr("整托坐标表","Pallet positions table")} tabIndex={interactive?0:undefined}><table className="coordinate-table"><thead><tr><th>{tr("托盘编号")}</th><th>{tr("托内货物", "Pallet contents")}</th><th>{tr("箱数", "Cartons")}</th><th>{tr("整托外部总高", "Complete unit height")} mm</th><th>{tr("整托总重", "Gross weight")} kg</th><th>X / Y / Z</th><th>{tr("底座长 × 宽 × 高", "Base L × W × H")}</th><th>{tr("自重")}</th><th>{tr("额定承重")}</th><th>{tr("货物起始 Z")}</th><th>{tr("已装货物最高 Z")}</th><th>{tr("允许最高 Z")}</th></tr></thead><tbody>{visibleRows.map(({p,cargo,top,ceiling,height,gross,contents})=><tr key={p.id}><td>{interactive?<button className="pallet-inspect-button" type="button" aria-label={`${tr("查看整托","Inspect unit")} ${p.id}`} onClick={()=>setInspect(p.id)}>{p.id}{p.locked&&` · ${tr("已锁定","Locked")}`}{p.specificationId&&<small>{p.name}</small>}</button>:<>{p.id} · {p.name}</>}</td><td>{contents}</td><td>{cargo.length}</td><td>{height.toFixed(1)}</td><td>{gross.toFixed(1)}</td><td>{p.x} / {p.y} / {p.z}</td><td>{p.dx} × {p.dy} × {p.dz}<small>{tr(...bottomDeckText(p.packaging,p.dz))}</small></td><td>{p.weight} kg</td><td>{p.maxLoad} kg</td><td>{cargo.length?Math.min(...cargo.map(b=>b.z)):tr("未装货")}</td><td>{cargo.length?top:tr("未装货")}</td><td>{ceiling ? Math.min(result.container.height-result.clearance,p.z+ceiling) : "—"}</td></tr>)}</tbody></table></div>:null;
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
    {loaded>0&&<RecordPageControls page={page} label={tr("搜索整托","Search pallets")} placeholder={tr("托号、包装规格、SKU 或套装","Pallet ID, packaging, SKU or kit")}/>}
    {table(page.rows,true)}
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
