"use client";
import Link from "next/link";
import { useEffect, useState, useSyncExternalStore } from "react";
import type { CrewSlicePayload } from "../../components/crew-share-panel";
import { buildZipArchive, dataUrlToBytes } from "../../lib/packing/mini-zip";
import { setAppLanguage, SUPPORTED_LANGUAGES, tr, useLanguage, type UiLanguage } from "../../components/language";

const PHOTO_NODES = [
  { id: "01_empty", zh: "① 空柜检查（含柜号）", en: "1. Empty Container (with Container No.)" },
  { id: "02_quarter", zh: "② 装至 1/4 进度", en: "2. Quarter Loaded (25%)" },
  { id: "03_half", zh: "③ 装至 1/2 进度", en: "3. Half Loaded (50%)" },
  { id: "04_three_quarter", zh: "④ 装至 3/4 进度", en: "4. 3/4 Loaded (75%)" },
  { id: "05_full", zh: "⑤ 装满全貌", en: "5. Fully Loaded (100%)" },
  { id: "06_left_door", zh: "⑥ 关左门（含柜号）", en: "6. Left Door Closed (with Container No.)" },
  { id: "07_right_door", zh: "⑦ 关右门", en: "7. Right Door Closed" },
  { id: "08_seal", zh: "⑧ 全关门 + 铅封特写", en: "8. Doors Closed & Seal Close-up" },
] as const;

function decodePayload(hash: string): CrewSlicePayload | null {
  try {
    const match = hash.match(/plan=([A-Za-z0-9_-]+)/);
    if (!match) return null;
    const rawB64 = match[1].replace(/-/g, "+").replace(/_/g, "/");
    const b64 = rawB64 + "=".repeat((4 - (rawB64.length % 4)) % 4);
    const bin = atob(b64);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    const json = new TextDecoder().decode(bytes);
    const parsed = JSON.parse(json) as CrewSlicePayload;
    return parsed && parsed.v === 1 && Array.isArray(parsed.slices) ? parsed : null;
  } catch {
    return null;
  }
}

async function stampWatermark(file: File, watermarkText: string): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = reject;
    el.src = dataUrl;
  });
  const canvas = document.createElement("canvas");
  const maxW = 1280;
  const scale = img.width > maxW ? maxW / img.width : 1;
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) return dataUrl;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const barH = 38;
  ctx.fillStyle = "rgba(15, 23, 42, 0.78)";
  ctx.fillRect(0, canvas.height - barH, canvas.width, barH);
  ctx.fillStyle = "#FFFFFF";
  ctx.font = "600 15px sans-serif";
  ctx.fillText(watermarkText, 14, canvas.height - 13);
  return canvas.toDataURL("image/jpeg", 0.86);
}

export default function CrewViewPage() {
  const language = useLanguage();
  useEffect(() => { if (typeof navigator !== "undefined" && "serviceWorker" in navigator) { navigator.serviceWorker.register("/sw.js").catch(() => {}); } }, []);
  const hash = useSyncExternalStore(
    (onStoreChange) => {
      window.addEventListener("hashchange", onStoreChange);
      return () => window.removeEventListener("hashchange", onStoreChange);
    },
    () => window.location.hash,
    () => "",
  );
  const payload = decodePayload(hash);
  const [checkedSlices, setCheckedSlices] = useState<Record<number, boolean>>({});
  const [containerNo, setContainerNo] = useState("");
  const [sealNo, setSealNo] = useState("");
  const [photos, setPhotos] = useState<Record<string, string>>({});
  const [receiptCopied, setReceiptCopied] = useState(false);

  const handlePhoto = async (nodeId: string, file?: File) => {
    if (!file) return;
    const stamp = `CargoFit | ${containerNo || "CNTR-TBD"} | Seal: ${sealNo || "TBD"} | ${new Date().toLocaleString()}`;
    const stamped = await stampWatermark(file, stamp);
    setPhotos((prev) => ({ ...prev, [nodeId]: stamped }));
  };

  const langPicker = (
    <select
      aria-label="Language"
      value={language}
      onChange={(e) => setAppLanguage(e.target.value as UiLanguage)}
      style={{ padding: "6px 10px", border: "1px solid #CBD5E1", borderRadius: 6, background: "#F8FAFC", color: "#0F172A", cursor: "pointer", fontSize: 13 }}
    >
      {SUPPORTED_LANGUAGES.map((opt) => (
        <option key={opt.code} value={opt.code}>{opt.label}</option>
      ))}
    </select>
  );

  if (!payload) {
    return (
      <main style={{ maxWidth: 680, margin: "40px auto", padding: 20, fontFamily: "sans-serif" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <h1>{tr("CargoFit 现场装柜指挥单", "CargoFit Crew Loading Sheet")}</h1>
          {langPicker}
        </div>
        <p>{tr("未检测到有效的装柜分享数据。请从装柜智算第 7 步点击“扫码分享给工厂 (Crew View)”生成二维码后打开。", "No valid shared loading plan detected. Generate a QR code from Step 7 in CargoFit first.")}</p>
        <Link href="/" style={{ color: "#0F766E", fontWeight: 600 }}>
          {tr("返回装柜智算工作台", "Back to CargoFit Workspace")} →
        </Link>
      </main>
    );
  }

  const doneCount = payload.slices.filter((s) => checkedSlices[s.idx]).length;

  return (
    <main style={{ maxWidth: 760, margin: "0 auto", padding: "20px 16px 64px", fontFamily: "sans-serif", color: "#0F172A" }}>
      <header style={{ borderBottom: "2px solid #0F766E", paddingBottom: 14, marginBottom: 18 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <h1 style={{ margin: "0 0 6px", fontSize: 22 }}>
            {tr("CargoFit 现场装柜指挥单", "CargoFit Crew Loading Sheet")} · {payload.c}
          </h1>
          {langPicker}
        </div>
        <p style={{ margin: 0, fontSize: 14, color: "#475569" }}>
          {payload.tot} ctns · {payload.wt} kg · {payload.vol} CBM · {payload.L}×{payload.W}×{payload.H} mm
        </p>
        <p style={{ margin: "6px 0 0", fontSize: 14, fontWeight: 600, color: "#0F766E" }}>
          {tr("装柜进度", "Progress")}: {doneCount} / {payload.slices.length}
        </p>
      </header>

      <section style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 17, margin: "0 0 12px" }}>
          {tr("一、逐排装柜步进清单（从柜内最深处向柜门推进）", "Step-by-Step Row Loading Checklist (Deepest Wall → Door)")}
        </h2>
        {payload.slices.map((s) => (
          <article
            key={s.idx}
            style={{
              border: "1px solid #CBD5E1",
              borderRadius: 10,
              padding: 14,
              marginBottom: 12,
              background: checkedSlices[s.idx] ? "#F0FDF4" : "#FFFFFF",
            }}
          >
            <label style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, cursor: "pointer" }}>
              <strong style={{ fontSize: 16 }}>
                #{s.idx} ({s.xFrom}–{s.xTo} mm)
              </strong>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 14 }}>
                <input
                  type="checkbox"
                  style={{ width: 20, height: 20 }}
                  checked={Boolean(checkedSlices[s.idx])}
                  onChange={(e) => setCheckedSlices((prev) => ({ ...prev, [s.idx]: e.target.checked }))}
                />
                {tr("已装完", "Loaded")}
              </span>
            </label>
            <ul style={{ margin: "10px 0 0", paddingLeft: 18, fontSize: 15, lineHeight: 1.7 }}>
              {s.items.map((it, idx) => (
                <li key={idx}>
                  <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 2, background: it.col, marginRight: 6 }} />
                  <strong>{it.sku}</strong> × <strong>{it.qty}</strong> ({it.dx}×{it.dy}×{it.dz} mm)
                </li>
              ))}
            </ul>
          </article>
        ))}
      </section>

      <section style={{ borderTop: "1px solid #E2E8F0", paddingTop: 18 }}>
        <h2 style={{ fontSize: 17, margin: "0 0 10px" }}>
          {tr("二、装柜八宫格水印打卡（导出验货 PDF / ZIP）", "8-Photo Watermark Proof (Export Inspection PDF / ZIP)")}
        </h2>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
          <label style={{ fontSize: 13 }}>
            Container No.
            <input
              value={containerNo}
              onChange={(e) => setContainerNo(e.target.value)}
              placeholder="MSCU1234567"
              style={{ width: "100%", padding: "8px 10px", marginTop: 4, border: "1px solid #CBD5E1", borderRadius: 6 }}
            />
          </label>
          <label style={{ fontSize: 13 }}>
            Seal No.
            <input
              value={sealNo}
              onChange={(e) => setSealNo(e.target.value)}
              placeholder="SL882910"
              style={{ width: "100%", padding: "8px 10px", marginTop: 4, border: "1px solid #CBD5E1", borderRadius: 6 }}
            />
          </label>
        </div>

        <div style={{ display: "grid", gap: 12 }}>
          {PHOTO_NODES.map((node) => (
            <div key={node.id} style={{ border: "1px solid #E2E8F0", borderRadius: 8, padding: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <strong style={{ fontSize: 14 }}>{tr(node.zh, node.en)}</strong>
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={(e) => void handlePhoto(node.id, e.target.files?.[0])}
                />
              </div>
              {photos[node.id] && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={photos[node.id]}
                  alt={tr(node.zh, node.en)}
                  style={{ width: "100%", maxHeight: 280, objectFit: "contain", marginTop: 10, borderRadius: 6, background: "#0F172A" }}
                />
              )}
            </div>
          ))}
        </div>

        <div style={{ display: "flex", gap: 10, marginTop: 18, flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={async () => {
              const receipt = [
                `[CargoFit Actual Load Receipt] ${payload.c}`,
                `Container No: ${containerNo || "TBD"} | Seal No: ${sealNo || "TBD"}`,
                `Completed Rows: ${doneCount} / ${payload.slices.length}`,
                `Planned Total: ${payload.tot} ctns / ${payload.wt} kg / ${payload.vol} CBM`,
                `Photos Attached: ${Object.keys(photos).length} / 8`,
                `Timestamp: ${new Date().toISOString()}`,
              ].join("\n");
              try { await navigator.clipboard.writeText(receipt); setReceiptCopied(true); setTimeout(() => setReceiptCopied(false), 2500); } catch {}
            }}
            style={{ padding: "10px 16px", background: "#0F172A", color: "#FFFFFF", border: 0, borderRadius: 8, fontWeight: 600, cursor: "pointer" }}
          >
            {receiptCopied ? tr("✓ 已复制实装回执", "✓ Receipt Copied") : tr("复制实装回执给跟单", "Copy Actual Load Receipt")}
          </button>
                    <button
            type="button"
            onClick={() => {
              const entries = PHOTO_NODES.filter((n) => photos[n.id]).map((n) => ({
                name: `${n.id}.jpg`,
                data: dataUrlToBytes(photos[n.id]),
              }));
              const summary = [
                `CargoFit 8-Slot Inspection Bundle`,
                `Container: ${payload.c} | Container No: ${containerNo || "TBD"} | Seal No: ${sealNo || "TBD"}`,
                `Completed Rows: ${doneCount} / ${payload.slices.length}`,
                `Total: ${payload.tot} ctns / ${payload.wt} kg / ${payload.vol} CBM`,
                `Photos Included: ${entries.length} / 8`,
              ].join("\n");
              entries.push({ name: "loading-receipt.txt", data: new TextEncoder().encode(summary) });
              const zipBytes = buildZipArchive(entries);
              const blob = new Blob([zipBytes.buffer as ArrayBuffer], { type: "application/zip" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = `CargoFit_Inspection_${(containerNo || "CNTR").replace(/[^A-Za-z0-9_-]/g, "")}.zip`;
              a.click();
              setTimeout(() => URL.revokeObjectURL(url), 10000);
            }}
            style={{ padding: "10px 16px", background: "#0369A1", color: "#FFFFFF", border: 0, borderRadius: 8, fontWeight: 600, cursor: "pointer" }}
          >
            {tr("一键打包照片 ZIP", "Download Inspection ZIP")} ({Object.keys(photos).length}/8)
          </button>
                    <button
            type="button"
            onClick={() => window.print()}
            style={{ padding: "10px 18px", background: "#0F766E", color: "#FFFFFF", border: 0, borderRadius: 8, fontWeight: 600, cursor: "pointer" }}
          >
            {tr("打印 / 保存装柜验货报告 PDF", "Print / Save PDF Inspection Report")}
          </button>
          <Link href="/" style={{ padding: "10px 16px", border: "1px solid #CBD5E1", borderRadius: 8, color: "#334155", textDecoration: "none" }}>
            {tr("返回装柜工作台", "Back to CargoFit Workspace")}
          </Link>
        </div>
      </section>
    </main>
  );
}
