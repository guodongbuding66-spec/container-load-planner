"use client";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import { isolatePalletPlan } from "../lib/packing/pallet-inspection";
import type { PackingResult, ProductInput } from "../lib/packing/types";
import type { CameraView, CameraProjection } from "../lib/packing/camera-fit";
import { FeatureDialog } from "./feature-dialog";
import { tr, trText, useLanguage } from "./language";
import { usePlanEditor, type PlanEditor } from "./use-plan-editor";
import { NumericInput } from "./numeric-input";
import { palletLayers, palletLocalBox, palletOrderPool } from "../lib/packing/pallet-edit";
import { snapGroupTranslation, type Delta } from "../lib/packing/plan-edit";
import { specificationForPallet } from "../lib/packing/pallet-specifications";
import { packagingInterior } from "../lib/packing/packaging";
function palletMessage(value:string){const parts=value.split(" / ");if(parts.length===2&&/[\u3400-\u9fff]/u.test(parts[0])&&!/[\u3400-\u9fff]/u.test(parts[1]))return tr(parts[0],parts[1]);return trText(value);}
const Scene=dynamic(()=>import("./container-scene").then(m=>m.ContainerScene),{ssr:false});
export function PalletEditorControls({editor,products,id,onPendingChange}:{editor:PlanEditor;products:ProductInput[];id:string;onPendingChange?:(pending:boolean)=>void}){
  useLanguage();
  const plan=editor.plan!,p=plan.pallets!.find(p=>p.id===id)!;
  const config=specificationForPallet(plan.palletization!,p).config,inside=packagingInterior(config);
  const [offset,setOffset]=useState<Delta>({x:0,y:0,z:0}),[position,setPosition]=useState<Delta>({x:inside.inset,y:inside.inset,z:0});
  const [invalid,setInvalid]=useState<Record<string,boolean>>({}),[sku,setSku]=useState(products[0]?.id??""),[target,setTarget]=useState("");
  const layers=palletLayers(plan,id),[bottom,setBottom]=useState(0),[query,setQuery]=useState(""),[page,setPage]=useState(0);
  const pool=palletOrderPool(plan,products),cargo=plan.placements.filter(b=>b.palletIds?.includes(id)),selected=editor.selected.filter(b=>b.palletIds?.includes(id));
  const filtered=cargo.filter(b=>`${b.sku} ${b.id}`.toLowerCase().includes(query.toLowerCase())),current=Math.min(page,Math.max(0,Math.ceil(filtered.length/40)-1));
  const blocked=editor.disabled||!editor.enabled||!!p.locked,bad=Object.values(invalid).some(Boolean);
  useEffect(()=>onPendingChange?.(bad),[bad,onPendingChange]);
  const checked=(key:string)=>(valid:boolean)=>setInvalid(s=>({...s,[key]:!valid}));
  return <section className="pallet-editor" aria-label={tr("托内编辑","Pallet contents editor")}>
    <div className="upgrade-actions"><label><input type="checkbox" checked={editor.enabled} disabled={editor.disabled} onChange={e=>editor.update({enabled:e.target.checked,rectangle:false})}/>{tr("启用托内编辑","Enable pallet editing")}</label><button className="button" disabled={editor.disabled} onClick={()=>editor.palletEdit(id,{type:"lock",locked:!p.locked})}>{p.locked?tr("解除本托锁定","Unlock this pallet"):tr("锁定本托","Lock this pallet")}</button><button className="button" disabled={editor.disabled} onClick={()=>editor.palletEdit(id,{type:"lock-others",locked:true})}>{tr("锁定其他托盘","Lock other pallets")}</button><button className="button" disabled={!editor.undo.length||editor.disabled} onClick={editor.undoEdit}>{tr("撤销","Undo")}</button><button className="button" disabled={!editor.redo.length||editor.disabled} onClick={editor.redoEdit}>{tr("重做","Redo")}</button><button className="button" disabled={!editor.changed} onClick={editor.discard}>{tr("放弃调整","Discard edits")}</button></div>
    <p>{tr("X／Y 沿托盘原始长／宽，Z 从托面向上。移动和旋转仅调整托内货物；删箱和转移自动包含同套全部组件。复制层若涉及跨层套装，会连同整套复制。","X/Y follow the original pallet length/width; Z starts at the deck surface. Move and rotate affect contents only. Removal and transfer include complete kits; layer copies include any kit components on other levels.")}</p>
    {editor.disabled&&<p role="status">{tr("当前输入或方案未就绪，请先完成录入并重新计算。", "Inputs or the plan are not ready. Complete input and recalculate first.")}</p>}
    <p>{tr("本托","This pallet")} {cargo.length} {tr("箱，已选","cartons; selected")} {selected.length} · {tr("编辑版本","Edit revision")} {plan.palletization?.editRevision??0}{p.locked&&` · ${tr("整托已锁定","Pallet locked")}`}</p>
    <details><summary>{tr("完整订单与待分配余量","Complete order and unassigned pool")}</summary><div className="coordinate-wrap"><table className="coordinate-table"><thead><tr><th>SKU</th><th>{tr("订单","Order")}</th><th>{tr("已分配","Assigned")}</th><th>{tr("待分配","Unassigned")}</th></tr></thead><tbody>{pool.map(row=><tr key={row.productId}><td>{row.sku}</td><td>{row.requested}</td><td>{row.loaded}</td><td>{row.remaining}</td></tr>)}</tbody></table></div></details>
    <label>{tr("搜索托内货物","Search pallet cargo")}<input value={query} onChange={e=>{setQuery(e.target.value);setPage(0);}}/></label>
    <div className="upgrade-actions"><button className="button" disabled={blocked} onClick={()=>editor.selectMany(cargo.map(b=>b.id))}>{tr("选择本托全部","Select all pallet cargo")}</button><button className="button" onClick={()=>editor.selectMany([])}>{tr("清除选择","Clear selection")}</button></div>
    <div className="coordinate-wrap"><table className="coordinate-table"><thead><tr><th>{tr("选择","Select")}</th><th>SKU / ID</th><th>{tr("托内坐标","Local position")} mm</th><th>{tr("尺寸","Dimensions")} mm</th><th>{tr("套号","Kit number")}</th></tr></thead><tbody>{filtered.slice(current*40,(current+1)*40).map(b=>{const local=palletLocalBox(b,p);return <tr key={b.id}><td><input type="checkbox" aria-label={`${tr("选择箱体","Select carton")} ${b.id}`} checked={selected.some(s=>s.id===b.id)} disabled={blocked} onChange={()=>editor.select(b.id,true)}/></td><td>{b.sku}<small>{b.id}{b.locked?` · ${tr("已锁定","Locked")}`:""}</small></td><td>{[local.x,local.y,local.z].map(n=>Math.round(n*1000)/1000).join(" / ")}</td><td>{local.dx} × {local.dy} × {local.dz}</td><td>{b.setCode?`${b.setCode} / ${b.setNumber}`:"—"}</td></tr>;})}</tbody></table></div>
    {filtered.length>40&&<div className="upgrade-actions"><button className="button" disabled={!current} onClick={()=>setPage(current-1)}>{tr("上一页","Previous")}</button><span>{current+1} / {Math.ceil(filtered.length/40)}</span><button className="button" disabled={(current+1)*40>=filtered.length} onClick={()=>setPage(current+1)}>{tr("下一页","Next")}</button></div>}
    <fieldset disabled={blocked}><legend>{tr("调整所选货物","Adjust selected cargo")}</legend><div className="tool-form-grid">{(["x","y","z"] as const).map(axis=><label key={axis}>{axis.toUpperCase()} {tr("偏移 mm","offset mm")}<NumericInput ariaLabel={`${tr("托内偏移","Pallet offset")} ${axis.toUpperCase()}`} value={offset[axis]} min={-100000} max={100000} onValueChange={v=>setOffset(s=>({...s,[axis]:v}))} onValidityChange={checked(`offset-${axis}`)}/></label>)}</div>
    <div className="upgrade-actions"><button className="button" disabled={!selected.length||bad} onClick={()=>editor.palletEdit(id,{type:"move",ids:selected.map(b=>b.id),delta:offset})}>{tr("验证移动","Validate move")}</button><button className="button" disabled={!selected.length} onClick={()=>editor.palletEdit(id,{type:"rotate",ids:selected.map(b=>b.id)})}>{tr("水平转 90°","Rotate 90°")}</button><button className="button" disabled={!selected.length} onClick={()=>editor.palletEdit(id,{type:"remove",ids:selected.map(b=>b.id)})}>{tr("退回订单余量","Return to unassigned pool")}</button></div>
    <label>{tr("物理层（托面以上 mm）","Physical layer (mm above deck)")}<select value={layers.some(l=>Math.abs(l.bottom-bottom)<.0001)?bottom:layers[0]?.bottom??0} onChange={e=>setBottom(Number(e.target.value))}>{layers.map(l=><option key={l.bottom} value={l.bottom}>{l.bottom}–{l.top} mm · {l.ids.length} {tr("箱","cartons")}</option>)}</select></label><button className="button" disabled={!layers.length} onClick={()=>editor.palletEdit(id,{type:"copy-layer",bottom:layers.some(l=>Math.abs(l.bottom-bottom)<.0001)?bottom:layers[0]?.bottom??0})}>{tr("复制此层到上方","Copy layer above")}</button></fieldset>
    <fieldset disabled={blocked}><legend>{tr("添加或转移货物","Add or transfer cargo")}</legend><p>{tr("目标坐标采用目标托盘的托内坐标。每次添加一箱或一个完整套装；仅使用订单余量。","Destination coordinates use the target pallet's local axes. Each add inserts one carton or one complete kit from the unassigned pool.")}</p><div className="tool-form-grid">{(["x","y","z"] as const).map(axis=><label key={axis}>{tr("目标","Target")} {axis.toUpperCase()} mm<NumericInput ariaLabel={`${tr("托内目标","Pallet target")} ${axis.toUpperCase()}`} value={position[axis]} min={0} max={100000} onValueChange={v=>setPosition(s=>({...s,[axis]:v}))} onValidityChange={checked(`position-${axis}`)}/></label>)}</div>
    <div className="tool-form-grid"><label>SKU<select value={sku} onChange={e=>setSku(e.target.value)}>{pool.map(row=><option key={row.productId} value={row.productId}>{row.sku} · {tr("待分配","Unassigned")} {row.remaining}</option>)}</select></label><label>{tr("目标托盘","Target pallet")}<select value={target} onChange={e=>setTarget(e.target.value)}><option value="">{tr("请选择","Select")}</option>{plan.pallets!.filter(q=>q.id!==id).map(q=><option key={q.id} value={q.id} disabled={q.locked}>{q.id} · {q.name}{q.locked?` · ${tr("已锁定","Locked")}`:""}</option>)}</select></label></div>
    <div className="upgrade-actions"><button className="button" disabled={!sku||bad} onClick={()=>editor.palletEdit(id,{type:"add",productId:sku,position})}>{tr("从余量添加一箱／整套","Add one carton / kit from pool")}</button><button className="button" disabled={!selected.length||!target||bad} onClick={()=>editor.palletEdit(id,{type:"transfer",ids:selected.map(b=>b.id),targetId:target,position})}>{tr("转移到目标托盘","Transfer to target pallet")}</button></div></fieldset>
    <p role="status">{palletMessage(editor.message)}</p><p className="helper-text">{tr("所有操作先检查完整方案，失败时整次回退。清空某托仍保留托盘及自重。关闭或放弃调整不会改动已采用方案。","Each operation checks the complete plan and rolls back entirely on failure. Empty pallets and their tare remain. Closing or discarding does not change the adopted plan.")}</p>
  </section>;
}
export function PalletUnitViewer({result,id,onClose,products=[],disabled=false,onAdopt}:{result:PackingResult;id:string;onClose:()=>void;products?:ProductInput[];disabled?:boolean;onAdopt?:(plan:PackingResult)=>void}) {
  useLanguage();
  const canEdit=!!onAdopt&&!!products.length&&!!result.palletization;
  const editor=usePlanEditor(result,products,disabled||!canEdit,onAdopt??(()=>{}));
  const [pending,setPending]=useState(false),[formVersion,setFormVersion]=useState(0);
  const discard=()=>{editor.discard();setPending(false);setFormVersion(v=>v+1);};
  const draft=editor.plan??result;
  const plan=useMemo(()=>isolatePalletPlan(draft,id),[draft,id]);
  const p=draft.pallets!.find(p=>p.id===id)!;
  const selected=editor.selected.filter(b=>b.palletIds?.includes(id)).map(b=>({...b,x:b.x-p.x,y:b.y-p.y,z:b.z-p.z}));
  const scoped:PlanEditor={...editor,source:plan,plan,selected,message:palletMessage(editor.message),disabled:editor.disabled||pending||!!p.locked,discard,apply:()=>{if(!pending)editor.apply();},
    move:(delta,rotate=false)=>{const snap=rotate?delta:snapGroupTranslation(plan,selected,delta,editor.grid,editor.tolerance);return editor.palletEdit(id,rotate?{type:"rotate",ids:selected.map(b=>b.id)}:{type:"move",ids:selected.map(b=>b.id),delta:p.orientation==="WLH"?{x:-snap.y,y:snap.x,z:snap.z}:snap});},
    lock:()=>editor.palletEdit(id,{type:"lock-cargo",ids:selected.map(b=>b.id),locked:!selected.every(b=>b.locked)})
  };
  const [view,setView]=useState<CameraView>("perspective"),[projection,setProjection]=useState<CameraProjection>("perspective");
  const visible=useMemo(()=>new Set(plan.summaries.map(s=>s.productId)),[plan]);
  return <FeatureDialog wide title={canEdit?tr("整托查看与托内编辑","Inspect and edit pallet contents"):tr("整托独立查看","Inspect complete pallet load")} subtitle={id} onClose={onClose}>
    <div className="pallet-unit-summary"><strong>{plan.placements.length} {tr("箱","cartons")} · {plan.metrics.grossWeight.toFixed(1)} kg</strong><span>{plan.container.length} × {plan.container.width} × {plan.container.height} mm</span></div>
    {canEdit&&<PalletEditorControls key={formVersion} editor={{...editor,discard}} products={products} id={id} onPendingChange={setPending}/>}
    <Scene editor={canEdit?scoped:undefined} products={products} result={plan} visibleProducts={visible} visibleCount={plan.placements.length} cameraView={view} projectionMode={projection} onCameraViewChange={setView} onProjectionModeChange={setProjection}/>
    <div className="pallet-unit-contents">{plan.summaries.map(s=><span key={s.productId}><i style={{background:s.color}}/>{s.sku} × {s.loaded} · {s.loadedWeight.toFixed(1)} kg</span>)}</div>
    <p className="helper-text">{tr("当前只显示这一托的包装和货物，坐标已移到独立查看原点；采用前，原装柜方案保持不变。","Only this unit and its contents are shown, rebased to a local inspection origin. The vehicle plan is unchanged until edits are applied.")}</p>
    {canEdit&&<div className="feature-dialog-footer"><button className="button" onClick={onClose}>{tr("取消并关闭","Cancel and close")}</button><button className="button primary" disabled={!editor.changed||editor.disabled||pending} onClick={editor.apply}>{tr("采用托内调整","Apply pallet edits")}</button><p>{tr("采用后同步整柜清单、重量和导出，并生成新方案版本。","Applying updates the complete manifest, weight and exports and creates a new plan version.")}</p></div>}
  </FeatureDialog>;
}
