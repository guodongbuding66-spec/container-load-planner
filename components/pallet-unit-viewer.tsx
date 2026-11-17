"use client";
import dynamic from "next/dynamic";
import {PalletLayerTemplates} from "./pallet-layer-templates";
import {PalletBaseDetails} from "./pallet-base-details";
import {PalletLayoutCopy} from "./pallet-layout-copy";
import {PalletRepackControls} from "./pallet-repack-controls";
import {PalletRefillControls} from "./pallet-refill-controls";
import {PalletConsolidationControls} from "./pallet-consolidation-controls";
import {LongSupportPanel} from "./long-support-panel";
import type {PalletLayerTemplate} from "../lib/packing/pallet-layer";
import { useEffect, useMemo, useState } from "react";
import { isolatePalletPlan } from "../lib/packing/pallet-inspection";
import type { PackingResult, ProductInput } from "../lib/packing/types";
import type { CameraView, CameraProjection } from "../lib/packing/camera-fit";
import { FeatureDialog } from "./feature-dialog";
import { tr, trText, useLanguage } from "./language";
import { usePlanEditor, type PlanEditor } from "./use-plan-editor";
import { NumericInput } from "./numeric-input";
import { palletLayers, palletLocalBox, palletLocalDelta, palletOrderPool } from "../lib/packing/pallet-edit";
import { snapGroupTranslation, type Delta } from "../lib/packing/plan-edit";
import { specificationForPallet } from "../lib/packing/pallet-specifications";
import { packagingInterior } from "../lib/packing/packaging";
import { SceneErrorBoundary } from "./scene-error-boundary";
function palletMessage(value:string) {
  const validation = "归档坐标未通过当前校验：";
  if(value.startsWith(validation)){
    const boundaryError = ": cargo must remain within one complete pallet";
    const detail = value.slice(validation.length).split("；").map(issue=>issue.endsWith(boundaryError)
      ? `${issue.slice(0,-boundaryError.length)} · ${tr("箱体超出单托可用空间","Carton exceeds a pallet's usable space")}`
      : trText(issue));
    return `${tr("托内调整未通过校验","Pallet edit failed validation")} · ${[...new Set(detail)].join(" · ")}`;
  }
  const parts = value.split(" / ");
  if(parts.length===2&&/[\u3400-\u9fff]/u.test(parts[0])&&!/[\u3400-\u9fff]/u.test(parts[1])) return tr(parts[0],parts[1]);
  return trText(value);
}
const Scene=dynamic(()=>import("./container-scene").then(m=>m.ContainerScene),{ssr:false});
function PalletUnitScene({plan,products,editor}:{plan:PackingResult;products?:ProductInput[];editor?:PlanEditor}){
  const [view,setView]=useState<CameraView>("perspective"),[projection,setProjection]=useState<CameraProjection>("perspective");
  const visible=useMemo(()=>new Set(plan.summaries.map(s=>s.productId)),[plan]);
  return <SceneErrorBoundary resetKey={plan.id}><Scene editor={editor} products={products} result={plan} visibleProducts={visible} visibleCount={plan.placements.length} cameraView={view} projectionMode={projection} onCameraViewChange={setView} onProjectionModeChange={setProjection}/></SceneErrorBoundary>;
}
export function PalletUnitPreviewScene({result,id}:{result:PackingResult;id:string}){
  const plan=useMemo(()=>isolatePalletPlan(result,id),[result,id]);
  return <div className="pallet-preview-scene"><PalletUnitScene plan={plan}/></div>;
}
export function PalletEditorControls({editor,products,id,onPendingChange,onViewPallet,layerTemplates,onLayerTemplatesChange,preparation=false}:{preparation?:boolean;layerTemplates?:PalletLayerTemplate[];onLayerTemplatesChange?:(templates:PalletLayerTemplate[])=>void;editor:PlanEditor;products:ProductInput[];id:string;onPendingChange?:(pending:boolean)=>void;onViewPallet?:(id:string)=>void}){
  useLanguage();
  const plan=editor.plan!,p=plan.pallets!.find(p=>p.id===id)!;
  const config=specificationForPallet(plan.palletization!,p).config,inside=packagingInterior(config);
  const [offset,setOffset]=useState<Delta>({x:0,y:0,z:0}),[position,setPosition]=useState<Delta>({x:inside.inset,y:inside.inset,z:0});
  const [invalid,setInvalid]=useState<Record<string,boolean>>({}),[sku,setSku]=useState(products[0]?.id??""),[target,setTarget]=useState("");
  const layers=palletLayers(plan,id),[bottom,setBottom]=useState(0),[query,setQuery]=useState(""),[page,setPage]=useState(0);
  const pool=palletOrderPool(plan,products),cargo=plan.placements.filter(b=>b.palletIds?.includes(id)),selected=editor.selected.filter(b=>b.palletIds?.includes(id));
  const filtered=cargo.filter(b=>`${b.sku} ${b.id}`.toLowerCase().includes(query.toLowerCase())),current=Math.min(page,Math.max(0,Math.ceil(filtered.length/40)-1));
  const [layerPending,setLayerPending]=useState(false),[repackPending,setRepackPending]=useState(false);
  const [refillPending,setRefillPending]=useState(false);
  const [consolidationPending,setConsolidationPending]=useState(false);
  const blocked=editor.disabled||!editor.enabled||!!p.locked;
  const invalidOffset=Object.entries(invalid).some(([key,value])=>key.startsWith("offset-")&&value);
  const invalidPosition=Object.entries(invalid).some(([key,value])=>key.startsWith("position-")&&value);
  const bad=invalidOffset||invalidPosition;
  const activeLayer=layers.find(l=>l.bottom===bottom)??layers[0];
  const fromPool=pool.find(row=>row.productId===sku);
  const targetPallet=plan.pallets!.find(q=>q.id===target&&!q.locked);
  useEffect(()=>onPendingChange?.(bad||layerPending||repackPending||refillPending||consolidationPending),[bad,layerPending,repackPending,refillPending,consolidationPending,onPendingChange]);
  const checked=(key:string)=>(valid:boolean)=>setInvalid(s=>({...s,[key]:!valid}));
  return <section className="pallet-editor" aria-label={tr("托内编辑","Pallet contents editor")}>
    <div className="upgrade-actions"><label><input type="checkbox" checked={editor.enabled} disabled={editor.disabled} onChange={e=>editor.update({enabled:e.target.checked,rectangle:false})}/>{tr("启用托内编辑","Enable pallet editing")}</label><button className="button" disabled={editor.disabled} onClick={()=>editor.palletEdit(id,{type:"lock",locked:!p.locked})}>{p.locked?tr("解除本托锁定","Unlock this pallet"):tr("锁定本托","Lock this pallet")}</button><button className="button" disabled={editor.disabled} onClick={()=>editor.palletEdit(id,{type:"lock-others",locked:true})}>{tr("锁定其他托盘","Lock other pallets")}</button><button className="button" disabled={!editor.undo.length||editor.disabled} onClick={editor.undoEdit}>{tr("撤销","Undo")}</button><button className="button" disabled={!editor.redo.length||editor.disabled} onClick={editor.redoEdit}>{tr("重做","Redo")}</button><button className="button" disabled={!editor.changed} onClick={editor.discard}>{tr("放弃调整","Discard edits")}</button></div>
    <p className="helper-text">{tr("在预览中选箱，用拖动手柄或输入偏移调整位置。X／Y 沿托盘长／宽，Z 从托面起算。","Select a carton, then drag its handles or enter offsets. X/Y follow the pallet length/width. Z starts at the deck surface.")}</p>
    {editor.disabled&&<p role="status">{tr("当前输入或方案未就绪，请先完成录入并重新计算。", "Inputs or the plan are not ready. Complete input and recalculate first.")}</p>}
    <p>{tr("本托","This pallet")} {cargo.length} {tr("箱，已选","cartons; selected")} {selected.length} · {tr("编辑版本","Edit revision")} {plan.palletization?.editRevision??0}{p.locked&&` · ${tr("整托已锁定","Pallet locked")}`}</p>
    <div className="upgrade-actions"><button className="button" disabled={blocked} onClick={()=>editor.selectMany(cargo.map(b=>b.id))}>{tr("选择本托全部","Select all pallet cargo")}</button><button className="button" onClick={()=>editor.selectMany([])}>{tr("清除选择","Clear selection")}</button></div>
    <PalletRefillControls editor={editor} products={products} id={id} blocked={blocked||bad||layerPending||repackPending||consolidationPending} onPendingChange={setRefillPending}/>
    <div className="pallet-editor-operations">
      <fieldset disabled={blocked}><legend>{tr("调整所选货物","Adjust selected cargo")}</legend>
        <div className="tool-form-grid">{(["x","y","z"] as const).map(axis=><label key={axis}>{axis.toUpperCase()} {tr("偏移 mm","offset mm")}<NumericInput ariaLabel={`${tr("托内偏移","Pallet offset")} ${axis.toUpperCase()}`} value={offset[axis]} min={-100000} max={100000} onValueChange={v=>setOffset(s=>({...s,[axis]:v}))} onValidityChange={checked(`offset-${axis}`)}/></label>)}</div>
        <div className="upgrade-actions">
          <button className="button" disabled={!selected.length||invalidOffset} onClick={()=>editor.palletEdit(id,{type:"move",ids:selected.map(b=>b.id),delta:offset})}>{tr("验证移动","Validate move")}</button>
          <button className="button" disabled={!selected.length} onClick={()=>editor.palletEdit(id,{type:"rotate",ids:selected.map(b=>b.id)})}>{tr("水平转 90°","Rotate 90°")}</button>
          <button className="button" disabled={!selected.length} onClick={()=>editor.palletEdit(id,{type:"remove",ids:selected.map(b=>b.id)})}>{tr("退回订单余量","Return to unassigned pool")}</button>
        </div>
        <div className="pallet-editor-layer-row">
          <label>{tr("物理层（托面以上 mm）","Physical layer (mm above deck)")}
            <select value={activeLayer?.bottom??""} disabled={!activeLayer} onChange={e=>setBottom(Number(e.target.value))}>{layers.map(l=><option key={l.bottom} value={l.bottom}>{l.bottom}–{l.top} mm · {l.ids.length} {tr("箱","cartons")}</option>)}</select>
          </label>
          <button className="button" disabled={!activeLayer} onClick={()=>activeLayer&&editor.palletEdit(id,{type:"copy-layer",bottom:activeLayer.bottom})}>{tr("复制此层到上方","Copy layer above")}</button>
        </div>
      </fieldset>
      <fieldset disabled={blocked}><legend>{tr("添加或转移货物","Add or transfer cargo")}</legend>
        <div className="tool-form-grid">{(["x","y","z"] as const).map(axis=><label key={axis}>{tr("目标","Target")} {axis.toUpperCase()} mm<NumericInput ariaLabel={`${tr("托内目标","Pallet target")} ${axis.toUpperCase()}`} value={position[axis]} min={0} max={100000} onValueChange={v=>setPosition(s=>({...s,[axis]:v}))} onValidityChange={checked(`position-${axis}`)}/></label>)}</div>
        <div className="pallet-editor-destination">
          <label>SKU<select value={fromPool?.productId??""} onChange={e=>setSku(e.target.value)}>{pool.map(row=><option key={row.productId} value={row.productId}>{row.sku} · {tr("待分配","Unassigned")} {row.remaining}</option>)}</select></label>
          <label>{tr("目标托盘","Target pallet")}<select value={targetPallet?.id??""} onChange={e=>setTarget(e.target.value)}><option value="">{tr("请选择","Select")}</option>{plan.pallets!.filter(q=>q.id!==id).map(q=><option key={q.id} value={q.id} disabled={q.locked}>{q.id} · {q.name}{q.locked?` · ${tr("已锁定","Locked")}`:""}</option>)}</select></label>
        </div>
        <div className="upgrade-actions">
          <button className="button" disabled={!fromPool?.remaining||invalidPosition} onClick={()=>editor.palletEdit(id,{type:"add",productId:sku,position})}>{tr("从余量添加一箱／整套","Add one carton / kit from pool")}</button>
          <button className="button" disabled={!selected.length||!targetPallet||invalidPosition} onClick={()=>editor.palletEdit(id,{type:"transfer",ids:selected.map(b=>b.id),targetId:target,position})}>{tr("转移到目标托盘","Transfer to target pallet")}</button>
        </div>
        <p>{tr("坐标以接收货物的托盘为基准。添加时使用订单余量，套装按整套添加。","Use the receiving pallet's local coordinates. Add cargo from the unassigned pool, keeping kits complete.")}</p>
      </fieldset>
    </div>
    <PalletConsolidationControls editor={editor} products={products} id={id} disabled={blocked||bad||layerPending||repackPending||refillPending} onPendingChange={setConsolidationPending} onViewPallet={onViewPallet}/>
    <PalletLayoutCopy plan={plan} id={id} disabled={editor.disabled||!editor.enabled||bad||layerPending||repackPending||refillPending||consolidationPending} onCopy={targetIds=>editor.palletEdit(id,{type:"copy-layout",targetIds})}/>
    <p role="status">{palletMessage(editor.message)}</p>
    <p className="helper-text">{preparation?tr("应用时只保留有货的托盘，货物余量保留在订单。","Applying keeps loaded pallets and retains unassigned quantities in the order."):tr("清空某托仍保留托盘及自重。","Empty pallets and their tare remain.")}</p>
    <details><summary>{tr("托内箱号与坐标","Carton identifiers and coordinates")} · {cargo.length} {tr("箱","cartons")}</summary>
      <div className="upgrade-actions pallet-editor-search"><label>{tr("搜索托内货物","Search pallet cargo")}<input type="search" value={query} onChange={e=>{setQuery(e.target.value);setPage(0);}}/></label></div>
      <div className="coordinate-wrap"><table className="coordinate-table"><thead><tr><th>{tr("选择","Select")}</th><th>SKU / ID</th><th>{tr("托内坐标","Local position")} mm</th><th>{tr("尺寸","Dimensions")} mm</th><th>{tr("套号","Kit number")}</th></tr></thead><tbody>{filtered.slice(current*40,(current+1)*40).map(b=>{const local=palletLocalBox(b,p);return <tr key={b.id}><td><input type="checkbox" aria-label={`${tr("选择箱体","Select carton")} ${b.id}`} checked={selected.some(s=>s.id===b.id)} disabled={blocked} onChange={()=>editor.select(b.id,true)}/></td><td>{b.sku}<small>{b.id}{b.locked?` · ${tr("已锁定","Locked")}`:""}</small></td><td>{[local.x,local.y,local.z].map(n=>Math.round(n*1000)/1000).join(" / ")}</td><td>{local.dx} × {local.dy} × {local.dz}</td><td>{b.setCode?`${b.setCode} / ${b.setNumber}`:"—"}</td></tr>;})}</tbody></table></div>
      {filtered.length>40&&<div className="upgrade-actions"><button className="button" disabled={!current} onClick={()=>setPage(current-1)}>{tr("上一页","Previous")}</button><span>{current+1} / {Math.ceil(filtered.length/40)}</span><button className="button" disabled={(current+1)*40>=filtered.length} onClick={()=>setPage(current+1)}>{tr("下一页","Next")}</button></div>}
    </details>
    <details><summary>{tr("完整订单与待分配余量","Complete order and unassigned pool")}</summary><div className="coordinate-wrap"><table className="coordinate-table"><thead><tr><th>SKU</th><th>{tr("订单","Order")}</th><th>{tr("已分配","Assigned")}</th><th>{tr("待分配","Unassigned")}</th></tr></thead><tbody>{pool.map(row=><tr key={row.productId}><td>{row.sku}</td><td>{row.requested}</td><td>{row.loaded}</td><td>{row.remaining}</td></tr>)}</tbody></table></div></details>
    <PalletRepackControls editor={editor} products={products} id={id} blocked={blocked||bad||layerPending||refillPending||consolidationPending} onPendingChange={setRepackPending}/>
    <PalletLayerTemplates editor={editor} products={products} id={id} templates={layerTemplates} onChange={onLayerTemplatesChange} blocked={blocked||bad||repackPending||refillPending||consolidationPending} onPendingChange={setLayerPending}/>
  </section>;
}
export function PalletUnitViewer({result,id:initialId,onClose,products=[],disabled=false,onAdopt,layerTemplates,onLayerTemplatesChange,preparation=false}:{preparation?:boolean;layerTemplates?:PalletLayerTemplate[];onLayerTemplatesChange?:(templates:PalletLayerTemplate[])=>void;result:PackingResult;id:string;onClose:()=>void;products?:ProductInput[];disabled?:boolean;onAdopt?:(plan:PackingResult)=>void}) {
  useLanguage();
  const canEdit=!!onAdopt&&!!products.length&&!!result.palletization;
  const editor=usePlanEditor(result,products,disabled||!canEdit,onAdopt??(()=>{}),preparation);
  const [pending,setPending]=useState(false),[formVersion,setFormVersion]=useState(0);
  const [viewedId,setViewedId]=useState(initialId);
  const discard=()=>{editor.discard();setPending(false);setFormVersion(v=>v+1);};
  const draft=editor.plan??result;
  const id=draft.pallets!.some(p=>p.id===viewedId)?viewedId:draft.pallets![0].id;
  const viewPallet=(targetId:string)=>{editor.selectMany([]);setViewedId(targetId);};
  const plan=useMemo(()=>isolatePalletPlan(draft,id),[draft,id]);
  const p=draft.pallets!.find(p=>p.id===id)!;
  const selected=editor.selected.filter(b=>b.palletIds?.includes(id)).map(b=>({...b,x:b.x-p.x,y:b.y-p.y,z:b.z-p.z}));
  const scoped:PlanEditor={...editor,source:plan,plan,selected,message:palletMessage(editor.message),disabled:editor.disabled||pending||!!p.locked,discard,apply:()=>{if(!pending)editor.apply();},
    move:(delta,rotate=false)=>{const snap=rotate?delta:snapGroupTranslation(plan,selected,delta,editor.grid,editor.tolerance);return editor.palletEdit(id,rotate?{type:"rotate",ids:selected.map(b=>b.id)}:{type:"move",ids:selected.map(b=>b.id),delta:palletLocalDelta(snap,p)});},
    lock:()=>editor.palletEdit(id,{type:"lock-cargo",ids:selected.map(b=>b.id),locked:!selected.every(b=>b.locked)})
  };
  return <FeatureDialog wide title={canEdit?tr("整托查看与托内编辑","Inspect and edit pallet contents"):tr("整托独立查看","Inspect complete pallet load")} subtitle={id} onClose={onClose} footer={canEdit&&<>
    <p>{preparation?tr("采用后，两套装柜方案均使用这些托内位置。","Both loading strategies will use these pallet positions.") : tr("采用后同步整柜清单、重量和导出。","Apply edits to update the full manifest, weight and exports.")}</p>
    <button className="button" onClick={onClose}>{tr("取消并关闭","Cancel and close")}</button>
    <button className="button primary" disabled={!editor.changed||editor.disabled||pending} onClick={editor.apply}>{preparation?tr("应用托内布置","Apply pallet layout"):tr("采用托内调整","Apply pallet edits")}</button>
  </>}>
    <div className="pallet-unit-summary"><strong>{plan.placements.length} {tr("箱","cartons")} · {plan.metrics.grossWeight.toFixed(1)} kg</strong><span>{plan.container.length} × {plan.container.width} × {plan.container.height} mm</span>
      {canEdit&&draft.pallets!.length>1&&<label className="pallet-review-picker">{tr("查看托盘","View pallet")}
        <select value={id} disabled={pending} onChange={e=>viewPallet(e.currentTarget.value)}>
          {draft.pallets!.map(q=><option key={q.id} value={q.id}>{q.id} · {q.name}</option>)}
        </select>
      </label>}
    </div>
    <div className="pallet-unit-scene"><PalletUnitScene key={id} plan={plan} products={products} editor={canEdit?scoped:undefined}/></div>
    {canEdit&&<PalletEditorControls preparation={preparation} layerTemplates={layerTemplates} onLayerTemplatesChange={onLayerTemplatesChange} key={`${id}/${formVersion}`} editor={{...editor,discard}} products={products} id={id} onPendingChange={setPending} onViewPallet={viewPallet}/>}
    <div className="pallet-unit-contents">{plan.summaries.map(s=><span key={s.productId}><i style={{background:s.color}}/>{s.sku} × {s.loaded} · {s.loadedWeight.toFixed(1)} kg</span>)}</div>
    <PalletBaseDetails result={plan} pallet={plan.pallets![0]}/>
    <LongSupportPanel plan={draft} products={products}/>
  </FeatureDialog>;
}
