"use client";
import {tr,useLanguage} from "./language";

/** Saved work is never silently replaced by a newer introductory example. */
export function WorkspaceDraftNotice({visible,cartons,demoCartons,disabled,onSample}:{visible:boolean;cartons:number;demoCartons:number;disabled?:boolean;onSample:()=>void}){
 useLanguage();if(!visible)return null;
 return <section className="workspace-draft-notice" aria-label={tr("已恢复的工作区","Restored workspace")}>
  <div><strong>{tr("当前使用本机草稿","Using your local draft")} · {cartons} {tr("箱","cartons")}</strong>
   <p>{tr("已保存的数据会原样保留。新版演示为","Saved data stays unchanged. The current demo contains")} {demoCartons} {tr("箱；体验演示前请先备份当前工作。","cartons. Back up your work before loading the demo.")}</p></div>
  <button type="button" className="button small" disabled={disabled} onClick={onSample}>{tr("载入新版示例","Load current demo")}</button>
 </section>;
}
