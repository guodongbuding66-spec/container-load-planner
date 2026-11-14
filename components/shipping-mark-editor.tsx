"use client";

import { useState } from "react";
import { MARK_IMAGE_LIMIT, MARK_TEXT_LIMIT, markLines, parseShippingMark, type ShippingMark } from "../lib/packing/shipping-mark";
import { tr, useLanguage } from "./language";

async function compactMarkImage(file: File) {
  if (!/^(image\/(png|jpeg|webp))$/.test(file.type) || file.size > 8 * 1024 * 1024) throw new Error();
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx || !image.naturalWidth || !image.naturalHeight) throw new Error();
    for (const max of [640, 480, 320]) {
      const scale = Math.min(1, max / Math.max(image.naturalWidth, image.naturalHeight));
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      const data = canvas.toDataURL("image/webp", .9);
      if (data.length <= MARK_IMAGE_LIMIT) return parseShippingMark({ image: data })!.image!;
    }
    throw new Error();
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function ShippingMarkEditor({ mark, sku, onChange, onBusy }: {
  mark?: ShippingMark;
  sku: string;
  onChange: (mark?: ShippingMark) => void;
  onBusy: (busy: boolean) => void;
}) {
  useLanguage();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const upload = async (file?: File) => {
    if (!file) return;
    setBusy(true);
    onBusy(true);
    setError("");
    try {
      onChange({ ...mark, image: await compactMarkImage(file) });
    } catch {
      setError(tr("无法读取图片。请选择 8 MB 以内的 PNG、JPG 或 WebP。", "Choose a readable PNG, JPG or WebP up to 8 MB."));
    } finally {
      setBusy(false);
      onBusy(false);
    }
  };
  return <details className="shipping-mark-editor">
    <summary>{tr("自定义箱标与唛头", "Custom carton label and shipping mark")} <small>{mark?.image || mark?.text?.trim() ? tr("已自定义", "Customized") : tr("默认 SKU", "Default SKU")}</small></summary>
    <div className="shipping-mark-grid">
      <div className="shipping-mark-fields">
        <label>{tr("唛头文字", "Shipping mark text")}<textarea value={mark?.text ?? ""} disabled={busy} maxLength={MARK_TEXT_LIMIT} rows={4} placeholder={"CONSIGNEE\nPO NO.\nMADE IN CHINA"} onChange={event => onChange({ ...mark, text: event.target.value })}/></label>
        <label>{tr("上传箱标图片", "Upload carton label image")}<input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; void upload(file); }}/></label>
        <div className="shipping-mark-actions">
          {mark?.image && <button type="button" className="button small" disabled={busy} onClick={() => onChange({ text: mark.text })}>{tr("移除图片", "Remove image")}</button>}
          {(mark?.text || mark?.image) && <button type="button" className="button small" disabled={busy} onClick={() => { onChange(undefined); setError(""); }}>{tr("恢复默认箱标", "Restore default label")}</button>}
        </div>
        {busy && <small role="status">{tr("正在处理图片…", "Processing image…")}</small>}
        {error && <small role="alert">{error}</small>}
      </div>
      <div className="shipping-mark-preview" aria-label={tr("箱标预览", "Carton label preview")}>
        {/* eslint-disable-next-line @next/next/no-img-element -- local raster preview */}
        {mark?.image && <img src={mark.image} alt={tr("自定义箱标", "Custom carton label")}/>}
        {(!mark?.image || mark.text?.trim()) && <span>{markLines(mark?.text?.trim() || sku).join("\n")}</span>}
      </div>
    </div>
  </details>;
}
