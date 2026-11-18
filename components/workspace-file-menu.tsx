"use client";

import { ChevronDown, Download, FileJson, Printer, Sparkles, Upload } from "lucide-react";
import type { RefObject } from "react";
import { tr, useLanguage } from "./language";

type Props = {
  menuRef: RefObject<HTMLDetailsElement | null>;
  backupBlocked: boolean;
  restoreBlocked: boolean;
  planBlockReason?: string;
  onBackUp: () => void;
  onRestore: () => void;
  onPrint: () => void;
  onExport: () => void;
  onSample: () => void;
};

export function WorkspaceFileMenu({
  menuRef, backupBlocked, restoreBlocked, planBlockReason,
  onBackUp, onRestore, onPrint, onExport, onSample,
}: Props) {
  useLanguage();
  const workspaceLabel = tr("工作区文件", "Workspace files");
  const planLabel = tr("当前方案", "Current plan");
  return <details className="workspace-file-menu" name="workspace-menus" ref={menuRef}>
    <summary className="button ghost">
      <FileJson size={16} aria-hidden="true"/>{tr("文件与备份", "Files & backups")}
      <ChevronDown size={14} aria-hidden="true"/>
    </summary>
    <div className="workspace-file-panel" onClick={event => {
      if (!(event.target instanceof Element) || !event.target.closest("button:not(:disabled)")) return;
      const menu = menuRef.current;
      if (!menu) return;
      menu.open = false;
      menu.querySelector("summary")?.focus({ preventScroll: true });
    }}>
      <div className="workspace-file-group" role="group" aria-label={workspaceLabel}>
        <strong aria-hidden="true">{workspaceLabel}</strong>
        <button type="button" className="workspace-file-action" onClick={onBackUp} disabled={backupBlocked}><Download size={16} aria-hidden="true"/>{tr("备份工作区", "Back up workspace")}</button>
        <button type="button" className="workspace-file-action" onClick={onRestore} disabled={restoreBlocked}><Upload size={16} aria-hidden="true"/>{tr("恢复工作区", "Restore workspace")}</button>
        {backupBlocked && <p>{tr("完成数字录入后可备份。", "Finish entering numbers to back up.")}</p>}
      </div>
      <div className="workspace-file-group" role="group" aria-label={planLabel}>
        <strong aria-hidden="true">{planLabel}</strong>
        <button type="button" className="workspace-file-action" onClick={onPrint} disabled={!!planBlockReason}><Printer size={16} aria-hidden="true"/>{tr("打印现场指导书", "Print loading guide")}</button>
        <button type="button" className="workspace-file-action" onClick={onExport} disabled={!!planBlockReason}><FileJson size={16} aria-hidden="true"/>{tr("导出方案 JSON", "Export plan JSON")}</button>
        {planBlockReason && <p>{planBlockReason}</p>}
      </div>
      <div className="workspace-file-group">
        <button type="button" className="workspace-file-action" onClick={onSample}><Sparkles size={16} aria-hidden="true"/>{tr("载入示例", "Load example")}</button>
      </div>
    </div>
  </details>;
}
