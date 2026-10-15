"use client";
import { useState } from "react";
import type { PlanEditor } from "./use-plan-editor";
import { NumericInput } from "./numeric-input";
import { tr, trText, useLanguage } from "./language";
import type { EditGroup } from "../lib/packing/plan-edit";
export function SceneEditPanel({editor}:{editor:PlanEditor}){
  useLanguage();const [delta,setDelta]=useState({x:0,y:0,z:0}),[invalid,setInvalid]=useState<Record<string,boolean>>({});
  return <section className="scene-inspector-section scene-edit-panel"><h3>{tr("三维编辑","3D editor")}</h3>
    <label className="scene-inspector-check"><input type="checkbox" checked={editor.enabled} disabled={editor.disabled} onChange={e=>editor.update({enabled:e.target.checked,rectangle:false})}/>{tr("启用箱位编辑","Enable cargo editing")}</label>
    {editor.enabled&&<><p>{tr("点击选箱；Shift 点击多选。移动手柄在松开后统一校验，失败会恢复原位置。","Click cargo; Shift-click adds to selection. Gizmo moves validate on release and revert when invalid.")}</p>
      <button aria-pressed={editor.rectangle} onClick={()=>editor.update({rectangle:!editor.rectangle})}>{tr("框选货物","Rectangle select")}</button>
      <label>{tr("移动范围","Move group")}<select aria-label={tr("编辑移动范围","Edit group")} value={editor.group} onChange={e=>editor.update({group:e.target.value as EditGroup})}>{[["selection","所选箱体","Selected cargo"],["set","整套","Whole set"],["pallet",editor.plan?.container.id==="unit-inspection"?"同托全部货物":"同托货物／完整预打托",editor.plan?.container.id==="unit-inspection"?"All contents on this pallet":"Pallet cargo / complete prebuilt load"],["stack","所选及上方堆叠","Selected and stacked above"]].map(([v,zh,en])=><option key={v} value={v}>{tr(zh,en)}</option>)}</select></label>
      <p>{tr("已选","Selected")} {editor.selected.length} {tr("箱","cartons")}</p>
      <label>{tr("网格步长 mm","Grid step mm")}<NumericInput ariaLabel={tr("编辑网格步长","Edit grid step")} value={editor.grid} min={0} max={1000} onValueChange={grid=>editor.update({grid})} onValidityChange={v=>setInvalid(s=>({...s,grid:!v}))}/></label>
      <label>{tr("吸附距离 mm","Snap distance mm")}<NumericInput ariaLabel={tr("编辑吸附距离","Edit snap distance")} value={editor.tolerance} min={0} max={500} onValueChange={tolerance=>editor.update({tolerance})} onValidityChange={v=>setInvalid(s=>({...s,tolerance:!v}))}/></label>
      {(["x","y","z"] as const).map(axis=><label key={axis}>{axis.toUpperCase()} {tr("偏移 mm","offset mm")}<NumericInput ariaLabel={`${axis.toUpperCase()} ${tr("三维偏移","3D offset")}`} value={delta[axis]} min={-100000} max={100000} onValueChange={v=>setDelta(s=>({...s,[axis]:v}))} onValidityChange={v=>setInvalid(s=>({...s,[axis]:!v}))}/></label>)}
      <div className="scene-inspector-actions"><button disabled={!editor.selected.length||Object.values(invalid).some(Boolean)||editor.disabled} onClick={()=>editor.move(delta)}>{tr("验证移动","Validate move")}</button><button disabled={!editor.selected.length||editor.disabled} onClick={()=>editor.move({x:0,y:0,z:0},true)}>{tr("水平转 90°","Rotate 90°")}</button><button disabled={!editor.selected.length||editor.disabled} onClick={editor.lock}>{tr(editor.selected.every(b=>b.locked)?"解除锁定":"锁定箱位",editor.selected.every(b=>b.locked)?"Unlock cargo":"Lock cargo")}</button></div>
      <div className="scene-inspector-actions"><button disabled={!editor.undo.length||editor.disabled} onClick={editor.undoEdit}>{tr("撤销","Undo")}</button><button disabled={!editor.redo.length||editor.disabled} onClick={editor.redoEdit}>{tr("重做","Redo")}</button><button disabled={!editor.changed||editor.disabled} onClick={editor.apply}>{tr("采用手动方案","Apply edits")}</button><button disabled={!editor.changed} onClick={editor.discard}>{tr("放弃调整","Discard edits")}</button></div>
      <p role="status">{trText(editor.message)}</p>
    </>}
  </section>;
}
