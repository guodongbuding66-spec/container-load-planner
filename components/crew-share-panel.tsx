"use client";
import { useEffect, useMemo, useState } from "react";
import { QrCode, Copy, Check, ExternalLink, X } from "lucide-react";
import type { PackingResult } from "../lib/packing/types";
import { tr, useLanguage } from "./language";

export interface CrewSlicePayload {
  v: 1;
  c: string; // container name
  L: number;
  W: number;
  H: number;
  tot: number;
  wt: number;
  vol: number;
  slices: Array<{
    idx: number;
    xFrom: number;
    xTo: number;
    items: Array<{ sku: string; qty: number; dx: number; dy: number; dz: number; col: string }>;
  }>;
}

export function buildCrewSlicePayload(plan: PackingResult): CrewSlicePayload {
  const sorted = [...plan.placements].sort((a, b) => a.x - b.x || a.z - b.z || a.y - b.y);
  const slices: CrewSlicePayload["slices"] = [];
  const bandMm = 1200;

  for (const box of sorted) {
    const band = Math.floor(box.x / bandMm);
    let slice = slices.find((s) => s.idx === band + 1);
    if (!slice) {
      slice = { idx: band + 1, xFrom: band * bandMm, xTo: (band + 1) * bandMm, items: [] };
      slices.push(slice);
    }
    const existing = slice.items.find(
      (it) => it.sku === box.sku && it.dx === Math.round(box.dx) && it.dy === Math.round(box.dy) && it.dz === Math.round(box.dz),
    );
    if (existing) existing.qty += 1;
    else slice.items.push({ sku: box.sku, qty: 1, dx: Math.round(box.dx), dy: Math.round(box.dy), dz: Math.round(box.dz), col: box.color });
  }

  return {
    v: 1,
    c: plan.container.name,
    L: Math.round(plan.container.length),
    W: Math.round(plan.container.width),
    H: Math.round(plan.container.height),
    tot: plan.metrics.loadedCount,
    wt: Math.round(plan.metrics.grossWeight),
    vol: Number((plan.metrics.loadedVolume / 1e9).toFixed(2)),
    slices,
  };
}

function encodePayload(payload: CrewSlicePayload): string {
  const json = JSON.stringify(payload);
  const bytes = new TextEncoder().encode(json);
  let bin = "";
  bytes.forEach((b) => {
    bin += String.fromCharCode(b);
  });
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function CrewShareButton({ plan, disabled = false }: { plan: PackingResult; disabled?: boolean }) {
  useLanguage();
  const [open, setOpen] = useState(false);
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const shareUrl = useMemo(() => {
    if (typeof window === "undefined") return "";
    const token = encodePayload(buildCrewSlicePayload(plan));
    return `${window.location.origin}/crew#plan=${token}`;
  }, [plan]);

  useEffect(() => {
    if (!open || !shareUrl) return;
    let active = true;
    import("qrcode")
      .then((QRCode) => QRCode.toDataURL(shareUrl, { width: 220, margin: 1 }))
      .then((url) => {
        if (active) setQrUrl(url);
      })
      .catch(() => {
        if (active) setQrUrl(null);
      });
    return () => {
      active = false;
    };
  }, [open, shareUrl]);

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
      <button type="button" className="button" disabled={disabled} onClick={() => setOpen(true)}>
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
            <p className="helper-text">{tr("正在生成二维码…", "Generating QR code…")}</p>
          )}
        </div>
        <div>
          <p className="helper-text">
            {tr(
              "工厂装柜师傅无需登录账号，手机扫码即可查看“第 1 排 → 第 N 排”大字步进清单，并支持空柜/半柜/满柜/封条五图水印打卡导出验货报告。",
              "Warehouse crews open this link on any phone without an account to follow slice-by-slice loading steps and capture watermarked 5-photo proof.",
            )}
          </p>
          <div className="v1-actions">
            <button type="button" className="button primary small" onClick={() => void copyLink()}>
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
