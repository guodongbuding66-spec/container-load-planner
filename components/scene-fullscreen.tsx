"use client";

import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal, flushSync } from "react-dom";
import { Expand, Minimize } from "lucide-react";
import { tr, useLanguage } from "./language";

/** A top-layer viewport dialog remains usable when native fullscreen is denied. */
export function SceneFullscreen({ children, toolbar, fullscreenFooter, onEscape }: {
  children: ReactNode;
  toolbar: (fullscreenToggle: ReactNode) => ReactNode;
  fullscreenFooter?: ReactNode;
  onEscape?: () => boolean;
}) {
  useLanguage();
  const [expanded, setExpanded] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const nativeRef = useRef(false);
  const close = useCallback(() => {
    flushSync(() => setExpanded(false));
    buttonRef.current?.focus();
  }, []);

  useLayoutEffect(() => {
    if (!expanded) return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    dialog.showModal();
    document.body.style.overflow = "hidden";
    buttonRef.current?.focus();
    const changed = () => {
      if (document.fullscreenElement === dialog) nativeRef.current = true;
      else if (nativeRef.current) { nativeRef.current = false; close(); }
    };
    document.addEventListener("fullscreenchange", changed);
    return () => {
      document.removeEventListener("fullscreenchange", changed);
      if (document.fullscreenElement === dialog) void document.exitFullscreen().catch(() => {});
      nativeRef.current = false;
      dialog.close();
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, [expanded, close]);

  const toggle = () => {
    if (expanded) { close(); return; }
    // Keep the browser's user activation through mounting and requestFullscreen.
    flushSync(() => setExpanded(true));
    const dialog = dialogRef.current;
    if (dialog && document.fullscreenEnabled && dialog.requestFullscreen) {
      void dialog.requestFullscreen().catch(() => {});
    }
  };
  const fullscreenToggle = <button ref={buttonRef} type="button" className="scene-fullscreen-toggle" aria-expanded={expanded} onClick={toggle}>
    {expanded ? <Minimize size={15}/> : <Expand size={15}/>}
    {expanded ? tr("退出全屏", "Exit fullscreen") : tr("全屏", "Fullscreen")}
  </button>;
  const content = <div className={`scene-workspace ${expanded ? "scene-workspace-expanded" : ""}`} onKeyDown={e=>{
    if(e.key==="Escape"&&!(e.target as HTMLElement).closest("input,select,textarea")&&onEscape?.()){
      e.preventDefault();
      e.stopPropagation();
    }
  }}>
    {toolbar(fullscreenToggle)}
    {children}
    {expanded && fullscreenFooter}
  </div>;
  return expanded ? createPortal(<dialog ref={dialogRef} className="scene-fullscreen-dialog" aria-label={tr("全屏三维查看器", "Fullscreen 3D viewer")} onCancel={e => { e.preventDefault(); e.stopPropagation(); close(); }}>{content}</dialog>, document.body) : content;
}
