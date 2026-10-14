"use client";
import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { tr, useLanguage } from "./language";
export function FeatureDialog({ title, subtitle, onClose, children, footer, wide = false, fullscreen=false }: { title: string; subtitle?: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean;fullscreen?:boolean }) {
  useLanguage();
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const dialog = ref.current; const previous = document.activeElement as HTMLElement | null; const overflow = document.body.style.overflow; dialog?.showModal(); document.body.style.overflow = "hidden"; return () => { dialog?.close(); document.body.style.overflow = overflow; previous?.focus(); }; }, []);
  return <dialog ref={ref} className={`feature-dialog ${wide ? "feature-dialog-wide" : ""} ${fullscreen?"feature-dialog-fullscreen":""}`} aria-label={title} onCancel={onClose} onClick={e => { if (e.target === e.currentTarget) { const box = e.currentTarget.getBoundingClientRect(); if (e.clientX < box.left || e.clientX > box.right || e.clientY < box.top || e.clientY > box.bottom) onClose(); } }}>
    <header className="feature-dialog-heading"><div><span className="eyebrow">CARGOFIT WORKSPACE</span><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div><button className="feature-icon-button" aria-label={tr("关闭")} onClick={onClose}><X size={20}/></button></header>
    <div className="feature-dialog-body">{children}</div>{footer && <footer className="feature-dialog-footer">{footer}</footer>}
  </dialog>;
}
