"use client";
import { useEffect, useMemo, useState } from "react";
import { QrCode, Copy, Check, ExternalLink, X } from "lucide-react";
import type { PackingResult } from "../lib/packing/types";
import {
  buildCrewSlicePayload,
  compactCrewPayloadForQr,
  encodeCrewPayload,
  type CrewSlicePayload,
} from "../lib/packing/crew-payload";
import { tr, useLanguage } from "./language";

export { buildCrewSlicePayload, type CrewSlicePayload };

export function CrewShareButton({ plan, disabled = false }: { plan: PackingResult; disabled?: boolean }) {
  useLanguage();
  const [open, setOpen] = useState(false);
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [qrState, setQrState] = useState<"idle" | "loading" | "ready" | "fallback">("idle");
  const [shortUrl, setShortUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const payload = useMemo(() => buildCrewSlicePayload(plan), [plan]);

  const { fullUrl, qrTargetUrl, compacted, fitsQr } = useMemo(() => {
    if (typeof window === "undefined") {
      return { fullUrl: "", qrTargetUrl: "", compacted: false, fitsQr: true };
    }
    const origin = window.location.origin;
    const fullToken = encodeCrewPayload(payload);
    const full = `${origin}/crew#plan=${fullToken}`;
    const compact = compactCrewPayloadForQr(payload, origin.length);
    const qrTarget = `${origin}/crew#plan=${compact.token}`;
    return { fullUrl: full, qrTargetUrl: qrTarget, compacted: compact.compacted, fitsQr: compact.fitsQr };
  }, [payload]);

  const activeShareUrl = shortUrl || fullUrl;
  const activeQrUrl = shortUrl || fullUrl;

  useEffect(() => {
    if (!open || !fullUrl) return;
    let active = true;

    const resolveAndRender = async () => {
      let targetForQr = qrTargetUrl;
      let canRenderQr = fitsQr;

      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 2500);
        const res = await fetch("/api/crew-share", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          signal: ctrl.signal,
        });
        clearTimeout(timer);
        if (res.ok) {
          const data = (await res.json()) as { id?: string };
          if (data?.id && active) {
            const url = `${window.location.origin}/crew?id=${encodeURIComponent(data.id)}`;
            setShortUrl(url);
            targetForQr = url;
            canRenderQr = true;
          }
        }
      } catch {
        // Static / offline mode: seamlessly use zero-backend hash URL.
      }

      if (!active) return;
      if (!canRenderQr) {
        setQrUrl(null);
        setQrState("fallback");
        return;
      }

      try {
        const QRCode = await import("qrcode");
        const dataUrl = await QRCode.toDataURL(targetForQr, { width: 220, margin: 1, errorCorrectionLevel: "L" });
        if (active) {
          setQrUrl(dataUrl);
          setQrState("ready");
        }
      } catch {
        if (active) {
          setQrUrl(null);
          setQrState("fallback");
        }
      }
    };

    void resolveAndRender();
    return () => {
      active = false;
    };
  }, [open, fullUrl, qrTargetUrl, fitsQr, payload]);

  const copyLink = async () => {
    if (!activeShareUrl) return;
    try {
      await navigator.clipboard.writeText(activeShareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  if (!open) {
    return (
      <button
        type="button"
        className="button"
        disabled={disabled}
        onClick={() => {
          setShortUrl(null);
          setQrUrl(null);
          setQrState("loading");
          setOpen(true);
        }}
      >
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
          {qrState === "ready" && qrUrl ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={qrUrl} alt="Crew View QR Code" width={200} height={200} style={{ borderRadius: 8, border: "1px solid var(--border-card)" }} />
              {shortUrl ? (
                <p className="helper-text" style={{ marginTop: 6, fontSize: 12 }}>
                  {tr("已启用免费云端短链（30 天有效）", "Short link active (valid 30 days)")}
                </p>
              ) : compacted ? (
                <p className="helper-text" style={{ marginTop: 6, fontSize: 12 }}>
                  {tr("SKU 较多，二维码已自动合并分区以便快速扫码；完整逐排清单请点右侧复制链接。", "Large plan auto-compacted for fast QR scan; copy link for full slice detail.")}
                </p>
              ) : null}
            </>
          ) : qrState === "fallback" ? (
            <div style={{ padding: 14, borderRadius: 8, border: "1px dashed var(--border-card)", fontSize: 13 }}>
              {tr(
                "当前方案明细超过单张二维码容量，请直接点击右侧“复制免登录链接”通过微信 / WhatsApp 发送给现场。",
                "Plan exceeds single-QR capacity. Click Copy Crew Link to share via WhatsApp / WeChat.",
              )}
            </div>
          ) : (
            <p className="helper-text">{tr("正在生成二维码…", "Generating QR code…")}</p>
          )}
        </div>
        <div>
          <p className="helper-text">
            {tr(
              "工厂装柜师傅无需登录账号，手机扫码即可查看“第 1 排 → 第 N 排”大字步进清单，并支持八宫格水印拍照打卡、刷新自动保留进度与一键导出 ZIP。",
              "Warehouse crews open this link on any phone without an account to follow slice-by-slice steps, capture watermarked 8-slot proof with auto-save, and export ZIP.",
            )}
          </p>
          <div className="v1-actions">
            <button type="button" className="button primary small" onClick={() => void copyLink()}>
              {copied ? <Check size={14} /> : <Copy size={14} />}
              {copied ? tr("已复制链接", "Copied") : tr("复制免登录链接", "Copy Crew Link")}
            </button>
            <a className="button ghost small" href={activeQrUrl} target="_blank" rel="noopener noreferrer">
              <ExternalLink size={14} />
              {tr("在新窗口预览", "Preview")}
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
