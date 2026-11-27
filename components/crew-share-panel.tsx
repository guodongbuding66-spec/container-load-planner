"use client";
import { useEffect, useMemo, useState } from "react";
import { QrCode, Copy, Check, ExternalLink, X } from "lucide-react";
import type { PackingResult } from "../lib/packing/types";
import { tr, useLanguage } from "./language";

import { buildCrewSlicePayload, compactCrewPayloadForQr, encodeCrewPayload, isCrewPayload, type CrewSlicePayload } from "../lib/packing/crew-payload";

export { buildCrewSlicePayload, type CrewSlicePayload };

export function CrewShareButton({ plan, disabled = false }: { plan: PackingResult; disabled?: boolean }) {
  useLanguage();
  const [open, setOpen] = useState(false);
  const [qr, setQr] = useState<{ fullUrl: string; shortUrl: string; image: string | null } | null>(null);
  const [copied, setCopied] = useState(false);

  const payload = useMemo(() => buildCrewSlicePayload(plan), [plan]);
  const fullUrl = typeof window === "undefined" ? "" : window.location.origin + "/crew#plan=" + encodeCrewPayload(payload);
  const currentQr = qr?.fullUrl === fullUrl ? qr : null;
  const shareUrl = currentQr?.shortUrl || fullUrl;
  const qrUrl = currentQr?.image;

  useEffect(() => {
    if (!open || !fullUrl) return;
    let active = true;
    const controller = new AbortController();
    const render = async () => {
      if (!isCrewPayload(payload)) { if (active) setQr({ fullUrl, shortUrl: "", image: null }); return; }
      const compact = compactCrewPayloadForQr(payload, window.location.origin.length);
      let shortUrl = "";
      let target = fullUrl;
      let fits = compact.fitsQr;
      if (!fits) {
        const timer = setTimeout(() => controller.abort(), 2500);
        try {
          const res = await fetch("/api/crew-share", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), signal: controller.signal });
          if (res.ok) {
            const data = await res.json() as { id?: string };
            if (typeof data.id === "string" && /^[a-z0-9]{6,16}$/i.test(data.id)) {
              shortUrl = window.location.origin + "/crew?id=" + encodeURIComponent(data.id);
              target = shortUrl;
              fits = true;
            }
          }
        } catch { /* fallback to complete hash link */ } finally { clearTimeout(timer); }
      }
      let image: string | null = null;
      if (fits) {
        try {
          const QRCode = await import("qrcode");
          image = await QRCode.toDataURL(target, { width: 320, margin: 4, errorCorrectionLevel: "L" });
        } catch { /* show complete link instead */ }
      }
      if (active) setQr({ fullUrl, shortUrl, image });
    };
    void render();
    return () => { active = false; controller.abort(); };
  }, [open, fullUrl, payload]);

  const copyLink = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  if (!open) {
    return (
      <button type="button" className="button" disabled={disabled || !isCrewPayload(payload)} onClick={() => { setQr(null); setOpen(true); }}>
        <QrCode size={16} />
        {tr("扫码分享给工厂 (Crew View)", "Share Crew View QR")}
      </button>
    );
  }

  return (
    <section className="v1-panel" aria-label={tr("免登录现场装柜分享", "Crew View Share")}>
      <div className="v1-panel-head">
        <h3>{tr("免登录现场装柜指挥页（微信 / WhatsApp 扫码即看）", "Account-Free Crew View (Scan on Any Phone)")}</h3>
        <button type="button" className="icon-button" aria-label={tr("关闭", "Close")} onClick={() => setOpen(false)}>
          <X size={16} />
        </button>
      </div>
      <div className="v1-grid-2" style={{ alignItems: "center" }}>
        <div style={{ textAlign: "center" }}>
          {qrUrl ? (
            <img src={qrUrl} alt="Crew View QR Code" width={200} height={200} style={{ borderRadius: 8, border: "1px solid var(--border-card)" }} />
          ) : (
            <p className="helper-text">{currentQr ? tr("二维码容量不足或不可用。请复制完整链接，货物明细不会删减。", "QR unavailable or too long. Copy the complete link; no cargo data is removed.") : tr("正在生成二维码…", "Generating QR code…")}</p>
          )}
        </div>
        <div>
          <p className="helper-text">
            {tr(
              "工厂装柜师傅无需登录账号，手机扫码即可查看“第 1 排 → 第 N 排”大字步进清单，并支持八宫格水印拍照、自动保存进度及导出 ZIP。",
              "Warehouse crews open this link on any phone without an account to follow slice-by-slice loading steps and capture watermarked 8-photo proof, retain progress and export ZIP.",
            )}
          </p>
          <div className="v1-actions">
            <button type="button" className="button primary small" disabled={!shareUrl || !isCrewPayload(payload)} onClick={() => void copyLink()}>
              {copied ? <Check size={14} /> : <Copy size={14} />}
              {copied ? tr("已复制链接", "Copied") : tr("复制免登录链接", "Copy Crew Link")}
            </button>
            <a className="button ghost small" href={shareUrl} target="_blank" rel="noopener noreferrer">
              <ExternalLink size={14} />
              {tr("在新窗口预览", "Preview")}
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
