"use client";
import Link from "next/link";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { crewDraftKey, decodeCrewHash, isCrewPayload, type CrewSlicePayload } from "../../lib/packing/crew-payload";
import { buildZipArchive, dataUrlToBytes } from "../../lib/packing/mini-zip";
import {
  aggregatePlannedSkus,
  applyCrewScan,
  buildCrewAuditCsv,
  DISCREPANCY_LABELS,
  type CrewDiscrepancy,
  type DiscrepancyKind,
} from "../../lib/packing/crew-scanner";
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

interface CrewDraftState {
  checkedSlices: Record<number, boolean>;
  containerNo: string;
  sealNo: string;
  photos: Record<string, string>;
  scanCounts: Record<string, number>;
  scanHistory: string[];
  discrepancies: CrewDiscrepancy[];
}

const EMPTY_DRAFT: CrewDraftState = {
  checkedSlices: {},
  containerNo: "",
  sealNo: "",
  photos: {},
  scanCounts: {},
  scanHistory: [],
  discrepancies: [],
};

function readDraft(storageKey: string): CrewDraftState {
  if (typeof window === "undefined") return EMPTY_DRAFT;
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return EMPTY_DRAFT;
    const saved = JSON.parse(raw) as Partial<CrewDraftState>;
    return {
      checkedSlices: saved.checkedSlices && typeof saved.checkedSlices === "object" ? saved.checkedSlices : {},
      containerNo: typeof saved.containerNo === "string" ? saved.containerNo : "",
      sealNo: typeof saved.sealNo === "string" ? saved.sealNo : "",
      photos: saved.photos && typeof saved.photos === "object" ? saved.photos : {},
      scanCounts: saved.scanCounts && typeof saved.scanCounts === "object" ? saved.scanCounts : {},
      scanHistory: Array.isArray(saved.scanHistory) ? saved.scanHistory.filter((x): x is string => typeof x === "string") : [],
      discrepancies: Array.isArray(saved.discrepancies) ? saved.discrepancies : [],
    };
  } catch {
    return EMPTY_DRAFT;
  }
}

function writeDraft(storageKey: string, draft: CrewDraftState): boolean {
  if (typeof window === "undefined") return true;
  try {
    localStorage.setItem(storageKey, JSON.stringify(draft));
    return true;
  } catch {
    try {
      localStorage.setItem(storageKey, JSON.stringify({ ...draft, photos: {} }));
    } catch {}
    return false;
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
  return canvas.toDataURL("image/jpeg", 0.82);
}

export default function CrewViewPage() {
  const language = useLanguage();
  useEffect(() => {
    if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }, []);

  const locationKey = useSyncExternalStore(
    (onStoreChange) => {
      window.addEventListener("hashchange", onStoreChange);
      window.addEventListener("popstate", onStoreChange);
      return () => {
        window.removeEventListener("hashchange", onStoreChange);
        window.removeEventListener("popstate", onStoreChange);
      };
    },
    () => `${window.location.search}|${window.location.hash}`,
    () => "|",
  );

  const { hash, shortId } = useMemo(() => {
    const [searchPart, hashPart] = locationKey.split("|");
    const rawId = new URLSearchParams(searchPart || "").get("id") || "";
    return {
      hash: hashPart || "",
      shortId: /^[a-z0-9]{6,16}$/i.test(rawId) ? rawId : "",
    };
  }, [locationKey]);

  const hashPayload = useMemo(() => decodeCrewHash(hash), [hash]);
  const [remoteResult, setRemoteResult] = useState<{ id: string; payload: CrewSlicePayload | null; error: boolean } | null>(null);

  useEffect(() => {
    if (hashPayload || !shortId) return;
    let active = true;
    fetch(`/api/crew-share?id=${encodeURIComponent(shortId)}`)
      .then((res) => (res.ok ? (res.json() as Promise<CrewSlicePayload>) : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((data) => {
        if (!active) return;
        if (isCrewPayload(data)) {
          setRemoteResult({ id: shortId, payload: data, error: false });
        } else {
          setRemoteResult({ id: shortId, payload: null, error: true });
        }
      })
      .catch(() => {
        if (active) setRemoteResult({ id: shortId, payload: null, error: true });
      });
    return () => {
      active = false;
    };
  }, [hashPayload, shortId]);

  const payload = hashPayload ?? (remoteResult?.id === shortId ? remoteResult.payload : null);
  const remoteLoading = !hashPayload && Boolean(shortId) && remoteResult?.id !== shortId;
  const remoteError = !hashPayload && Boolean(shortId) && remoteResult?.id === shortId && remoteResult.error;

  const storageKey = useMemo(() => {
    return crewDraftKey(hashPayload ? hash : "", shortId);
  }, [hashPayload, hash, shortId]);

  const [draftOverrides, setDraftOverrides] = useState<Record<string, CrewDraftState>>({});
  const [quotaWarn, setQuotaWarn] = useState(false);
  const [scanInput, setScanInput] = useState("");
  const [scanFeedback, setScanFeedback] = useState<{ tone: "ok" | "warn" | "err"; text: string } | null>(null);
  const [discSku, setDiscSku] = useState("");
  const [discKind, setDiscKind] = useState<DiscrepancyKind>("damaged");
  const [discDelta, setDiscDelta] = useState("-1");
  const [discNote, setDiscNote] = useState("");
  const [receiptCopied, setReceiptCopied] = useState(false);

  const draft = useMemo(
    () => draftOverrides[storageKey] ?? readDraft(storageKey),
    [draftOverrides, storageKey],
  );

  const updateDraft = (updater: (prev: CrewDraftState) => CrewDraftState) => {
    setDraftOverrides((prevMap) => {
      const current = prevMap[storageKey] ?? readDraft(storageKey);
      const next = updater(current);
      const savedFull = writeDraft(storageKey, next);
      setQuotaWarn(!savedFull);
      return { ...prevMap, [storageKey]: next };
    });
  };

  const handlePhoto = async (nodeId: string, file?: File) => {
    if (!file) return;
    const stamp = `CargoFit | ${draft.containerNo || "CNTR-TBD"} | Seal: ${draft.sealNo || "TBD"} | ${new Date().toLocaleString()}`;
    const stamped = await stampWatermark(file, stamp);
    updateDraft((prev) => ({ ...prev, photos: { ...prev.photos, [nodeId]: stamped } }));
  };

  const clearLocalDraft = () => {
    setQuotaWarn(false);
    setDraftOverrides((prevMap) => ({ ...prevMap, [storageKey]: EMPTY_DRAFT }));
    try {
      localStorage.removeItem(storageKey);
    } catch {}
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

  if (remoteLoading) {
    return (
      <main style={{ maxWidth: 680, width: "100%", boxSizing: "border-box", overflowX: "clip", margin: "24px auto", padding: "16px 12px", fontFamily: "sans-serif", overflowWrap: "anywhere" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <h1>{tr("CargoFit 现场装柜指挥单", "CargoFit Crew Loading Sheet")}</h1>
          {langPicker}
        </div>
        <p>{tr("正在读取云端装柜方案…", "Loading shared loading plan…")}</p>
      </main>
    );
  }

  if (!payload) {
    return (
      <main style={{ maxWidth: 680, width: "100%", boxSizing: "border-box", overflowX: "clip", margin: "24px auto", padding: "16px 12px", fontFamily: "sans-serif", overflowWrap: "anywhere" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <h1>{tr("CargoFit 现场装柜指挥单", "CargoFit Crew Loading Sheet")}</h1>
          {langPicker}
        </div>
        <p>
          {remoteError
            ? tr("该短链已过期或未找到，请让业务员重新生成分享链接。", "This short link has expired or was not found. Please request a fresh link.")
            : tr("未检测到有效的装柜分享数据。请从装柜智算第 7 步点击“扫码分享给工厂 (Crew View)”生成二维码后打开。", "No valid shared loading plan detected. Generate a QR code from Step 7 in CargoFit first.")}
        </p>
        <Link href="/" style={{ color: "#0F766E", fontWeight: 600 }}>
          {tr("返回装柜智算工作台", "Back to CargoFit Workspace")} →
        </Link>
      </main>
    );
  }

  const { checkedSlices, containerNo, sealNo, photos, scanCounts, scanHistory, discrepancies } = draft;
  const plannedSkuMap = aggregatePlannedSkus(payload);
  const plannedSkuList = Object.keys(plannedSkuMap);
  const totalScanned = Object.values(scanCounts).reduce((s, n) => s + n, 0);
  const effectiveDiscSku = discSku && plannedSkuMap[discSku] !== undefined ? discSku : (plannedSkuList[0] ?? "");

  const submitScan = (rawValue: string) => {
    const res = applyCrewScan(scanCounts, plannedSkuMap, rawValue);
    if (res.ok && res.matchedSku) {
      updateDraft((prev) => ({
        ...prev,
        scanCounts: res.nextCounts,
        scanHistory: [...prev.scanHistory, res.matchedSku!],
      }));
      setScanFeedback({
        tone: "ok",
        text: tr(
          `✓ 已核销 ${res.matchedSku}（${res.scannedCount} / ${res.plannedCount}）`,
          `✓ Scanned ${res.matchedSku} (${res.scannedCount} / ${res.plannedCount})`,
        ),
      });
      setScanInput("");
    } else if (res.status === "over-scan" && res.matchedSku) {
      setScanFeedback({
        tone: "err",
        text: tr(
          `⚠ 超扫拦截：${res.matchedSku} 已达计划数 ${res.plannedCount} 箱，请核对是否重复扫码。`,
          `⚠ Over-scan blocked: ${res.matchedSku} already reached planned qty (${res.plannedCount}).`,
        ),
      });
      setScanInput("");
    } else {
      setScanFeedback({
        tone: "warn",
        text: tr(`未在当前装柜清单中找到 SKU「${rawValue.trim()}」。`, `SKU "${rawValue.trim()}" not found in this loading plan.`),
      });
    }
  };

  const undoLastScan = () => {
    if (!scanHistory.length) return;
    const lastSku = scanHistory[scanHistory.length - 1];
    updateDraft((prev) => {
      const nextCount = Math.max(0, (prev.scanCounts[lastSku] ?? 0) - 1);
      return {
        ...prev,
        scanCounts: { ...prev.scanCounts, [lastSku]: nextCount },
        scanHistory: prev.scanHistory.slice(0, -1),
      };
    });
    setScanFeedback({
      tone: "warn",
      text: tr(`已撤销最近一次扫码：${lastSku}`, `Undid last scan: ${lastSku}`),
    });
  };

  const addDiscrepancy = () => {
    if (!effectiveDiscSku) return;
    const delta = Number.parseInt(discDelta, 10);
    const entry: CrewDiscrepancy = {
      id: `disc-${Date.now()}`,
      timestamp: new Date().toISOString(),
      sku: effectiveDiscSku,
      kind: discKind,
      qtyDelta: Number.isFinite(delta) ? delta : 0,
      note: discNote.trim() || tr(...DISCREPANCY_LABELS[discKind]),
    };
    updateDraft((prev) => ({ ...prev, discrepancies: [entry, ...prev.discrepancies] }));
    setDiscNote("");
  };
  const doneCount = payload.slices.filter((s) => checkedSlices[s.idx]).length;

  return (
    <main style={{ maxWidth: 760, width: "100%", boxSizing: "border-box", overflowX: "clip", margin: "0 auto", padding: "16px 12px 64px", fontFamily: "sans-serif", color: "#0F172A", overflowWrap: "anywhere" }}>
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
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8, marginTop: 6 }}>
          <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: "#0F766E" }}>
            {tr("装柜进度", "Progress")}: {doneCount} / {payload.slices.length} · {tr("自动本地保存（刷新不丢失）", "Auto-saved locally")}
          </p>
          <button
            type="button"
            onClick={clearLocalDraft}
            style={{ padding: "4px 10px", fontSize: 12, border: "1px solid #CBD5E1", borderRadius: 6, background: "#FFFFFF", color: "#475569", cursor: "pointer" }}
          >
            {tr("清空本柜打卡缓存", "Clear local draft")}
          </button>
        </div>
        {quotaWarn && (
          <p style={{ margin: "8px 0 0", fontSize: 12, color: "#B45309", background: "#FEF3C7", padding: "6px 10px", borderRadius: 6 }}>
            {tr(
              "照片体积超过浏览器本地缓存上限，已保留勾选与柜号；请及时点击“一键打包照片 ZIP”。",
              "Photos exceed browser local cache quota (checkmarks & container no. saved); export ZIP soon.",
            )}
          </p>
        )}
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
                  onChange={(e) =>
                    updateDraft((prev) => ({
                      ...prev,
                      checkedSlices: { ...prev.checkedSlices, [s.idx]: e.target.checked },
                    }))
                  }
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

      <section aria-label={tr("现场扫码核销与异常登记", "Barcode Scan Verification & Discrepancy Log")} style={{ borderTop: "1px solid #E2E8F0", paddingTop: 18, marginBottom: 24 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
          <h2 style={{ fontSize: 17, margin: 0 }}>
            {tr("扫码枪实时核销与四账对账明细", "Barcode Scan Verification & 4-Way Reconciliation")}
          </h2>
          <span style={{ fontSize: 13, fontWeight: 600, color: totalScanned >= payload.tot ? "#0F766E" : "#334155" }}>
            {tr("已扫码核销", "Scanned")}: {totalScanned} / {payload.tot} · {tr("异常件数", "Exceptions")}: {discrepancies.length} · {tr("预计净发", "Net Ship")}: {Math.max(0, totalScanned - discrepancies.length)}
          </span>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (scanInput.trim()) submitScan(scanInput);
          }}
          style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}
        >
          <input
            type="text"
            value={scanInput}
            onChange={(e) => setScanInput(e.target.value)}
            aria-label={tr("扫描或输入 SKU 条码", "Scan or enter SKU barcode")}
            placeholder={tr("扫描或输入 SKU 条码后按 Enter（兼容蓝牙扫码枪）", "Scan or type SKU barcode and press Enter")}
            style={{ flex: "1 1 220px", minWidth: 0, padding: "9px 11px", border: "1px solid #94A3B8", borderRadius: 8, fontSize: 14 }}
          />
          <button type="submit" style={{ padding: "9px 14px", background: "#0F766E", color: "#FFFFFF", border: 0, borderRadius: 8, fontWeight: 600, cursor: "pointer" }}>
            {tr("核销 +1", "Verify +1")}
          </button>
          <button
            type="button"
            disabled={!scanHistory.length}
            onClick={undoLastScan}
            style={{ padding: "9px 12px", background: "#FFFFFF", color: "#334155", border: "1px solid #CBD5E1", borderRadius: 8, cursor: scanHistory.length ? "pointer" : "not-allowed", opacity: scanHistory.length ? 1 : 0.5 }}
          >
            {tr("撤销上次", "Undo")}
          </button>
          <button
            type="button"
            onClick={() => {
              const csv = buildCrewAuditCsv(payload, containerNo, sealNo, scanCounts, discrepancies);
              const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = `CargoFit_ScanAudit_${(containerNo || "CNTR").replace(/[^A-Za-z0-9_-]/g, "")}.csv`;
              a.click();
              setTimeout(() => URL.revokeObjectURL(url), 5000);
            }}
            style={{ padding: "9px 12px", background: "#F8FAFC", color: "#0F172A", border: "1px solid #CBD5E1", borderRadius: 8, cursor: "pointer" }}
          >
            {tr("导出核验 CSV", "Export Audit CSV")}
          </button>
        </form>
        {scanFeedback && (
          <p
            role="status"
            style={{
              margin: "0 0 10px",
              padding: "8px 10px",
              borderRadius: 8,
              fontSize: 13,
              fontWeight: 600,
              background: scanFeedback.tone === "ok" ? "#ECFDF5" : scanFeedback.tone === "err" ? "#FEF2F2" : "#FFFBEB",
              color: scanFeedback.tone === "ok" ? "#065F46" : scanFeedback.tone === "err" ? "#B91C1C" : "#92400E",
            }}
          >
            {scanFeedback.text}
          </p>
        )}
        <div style={{ display: "grid", gap: 6, marginBottom: 14 }}>
          {plannedSkuList.map((sku) => {
            const planned = plannedSkuMap[sku] ?? 0;
            const scanned = scanCounts[sku] ?? 0;
            const pct = planned > 0 ? Math.min(100, Math.round((scanned / planned) * 100)) : 0;
            return (
              <div key={sku} style={{ border: "1px solid #E2E8F0", borderRadius: 8, padding: "8px 10px", background: scanned >= planned ? "#F0FDF4" : "#FFFFFF" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, fontSize: 13 }}>
                  <strong>{sku}</strong>
                  <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                    <span>{scanned} / {planned} ({pct}%)</span>
                    <button
                      type="button"
                      disabled={scanned >= planned}
                      onClick={() => submitScan(sku)}
                      style={{ padding: "2px 8px", fontSize: 12, borderRadius: 6, border: "1px solid #0F766E", background: scanned >= planned ? "#E2E8F0" : "#FFFFFF", color: "#0F766E", cursor: scanned >= planned ? "not-allowed" : "pointer" }}
                    >
                      +1
                    </button>
                  </div>
                </div>
                <div style={{ height: 6, borderRadius: 999, background: "#E2E8F0", marginTop: 6, overflow: "hidden" }}>
                  <div style={{ width: `${pct}%`, height: "100%", background: scanned >= planned ? "#10B981" : "#0F766E" }} />
                </div>
              </div>
            );
          })}
        </div>

        <div style={{ border: "1px solid #E2E8F0", borderRadius: 10, padding: 12, background: "#F8FAFC" }}>
          <strong style={{ fontSize: 14, display: "block", marginBottom: 8 }}>{tr("现场异常差异登记（破损 / 短装 / 换位）", "On-Site Discrepancy Log (Damage / Shortage / Relocate)")}</strong>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <select aria-label={tr("异常 SKU", "Discrepancy SKU")} value={effectiveDiscSku} onChange={(e) => setDiscSku(e.target.value)} style={{ padding: "7px 8px", border: "1px solid #CBD5E1", borderRadius: 6, fontSize: 13 }}>
              {plannedSkuList.map((sku) => (
                <option key={sku} value={sku}>{sku}</option>
              ))}
            </select>
            <select aria-label={tr("异常类型", "Discrepancy type")} value={discKind} onChange={(e) => setDiscKind(e.target.value as DiscrepancyKind)} style={{ padding: "7px 8px", border: "1px solid #CBD5E1", borderRadius: 6, fontSize: 13 }}>
              {(Object.keys(DISCREPANCY_LABELS) as DiscrepancyKind[]).map((k) => (
                <option key={k} value={k}>{tr(...DISCREPANCY_LABELS[k])}</option>
              ))}
            </select>
            <input
              type="number"
              aria-label={tr("数量偏差", "Qty delta")}
              value={discDelta}
              onChange={(e) => setDiscDelta(e.target.value)}
              style={{ width: 72, padding: "7px 8px", border: "1px solid #CBD5E1", borderRadius: 6, fontSize: 13 }}
            />
            <input
              type="text"
              aria-label={tr("异常备注", "Discrepancy note")}
              value={discNote}
              onChange={(e) => setDiscNote(e.target.value)}
              placeholder={tr("备注说明（如：叉车碰伤外箱边角）", "Note (e.g., carton corner damaged)")}
              style={{ flex: "1 1 180px", minWidth: 0, padding: "7px 8px", border: "1px solid #CBD5E1", borderRadius: 6, fontSize: 13 }}
            />
            <button type="button" onClick={addDiscrepancy} style={{ padding: "7px 12px", background: "#B45309", color: "#FFFFFF", border: 0, borderRadius: 6, fontWeight: 600, fontSize: 13, cursor: "pointer" }}>
              {tr("登记异常", "Log Issue")}
            </button>
          </div>
          {discrepancies.length > 0 && (
            <ul style={{ margin: "10px 0 0", paddingLeft: 18, fontSize: 13, color: "#7C2D12" }}>
              {discrepancies.map((d) => (
                <li key={d.id} style={{ marginBottom: 4 }}>
                  <strong>{d.sku}</strong> · {tr(...DISCREPANCY_LABELS[d.kind])} ({d.qtyDelta > 0 ? `+${d.qtyDelta}` : d.qtyDelta}) · {d.note}
                  <button
                    type="button"
                    onClick={() => updateDraft((prev) => ({ ...prev, discrepancies: prev.discrepancies.filter((x) => x.id !== d.id) }))}
                    style={{ marginLeft: 8, fontSize: 11, color: "#64748B", background: "transparent", border: 0, cursor: "pointer", textDecoration: "underline" }}
                  >
                    {tr("移除", "Remove")}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

            <section style={{ borderTop: "1px solid #E2E8F0", paddingTop: 18 }}>
        <h2 style={{ fontSize: 17, margin: "0 0 10px" }}>
          {tr("二、装柜八宫格水印打卡（导出验货 PDF / ZIP）", "8-Photo Watermark Proof (Export Inspection PDF / ZIP)")}
        </h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 10, marginBottom: 14 }}>
          <label style={{ fontSize: 13, minWidth: 0 }}>
            Container No.
            <input
              value={containerNo}
              onChange={(e) => updateDraft((prev) => ({ ...prev, containerNo: e.target.value }))}
              placeholder="MSCU1234567"
              style={{ width: "100%", maxWidth: "100%", boxSizing: "border-box", minWidth: 0, padding: "8px 10px", marginTop: 4, border: "1px solid #CBD5E1", borderRadius: 6 }}
            />
          </label>
          <label style={{ fontSize: 13, minWidth: 0 }}>
            Seal No.
            <input
              value={sealNo}
              onChange={(e) => updateDraft((prev) => ({ ...prev, sealNo: e.target.value }))}
              placeholder="SL882910"
              style={{ width: "100%", maxWidth: "100%", boxSizing: "border-box", minWidth: 0, padding: "8px 10px", marginTop: 4, border: "1px solid #CBD5E1", borderRadius: 6 }}
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
                  style={{ width: "100%", maxWidth: "100%", boxSizing: "border-box", fontSize: 12 }}
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

        <div style={{ marginTop: 16, padding: 12, borderRadius: 10, border: "1px dashed #64748B", background: "#F8FAFC" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <strong style={{ fontSize: 13 }}>{tr("热敏箱托条码标签预览 (100×150 mm)", "Thermal Pallet / Carton Label Preview (100×150 mm)")}</strong>
            <button
              type="button"
              onClick={() => window.print()}
              style={{ padding: "6px 12px", background: "#1E293B", color: "#FFFFFF", border: 0, borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: "pointer" }}
            >
              {tr("打印热敏标签", "Print Thermal Label")}
            </button>
          </div>
          <div style={{ marginTop: 8, padding: 10, background: "#FFFFFF", border: "1px solid #CBD5E1", borderRadius: 6, maxWidth: 320, fontFamily: "monospace", fontSize: 11 }}>
            <div style={{ fontWeight: 700, fontSize: 13 }}>CARGOFIT DISPATCH LABEL</div>
            <div>CNTR: {containerNo || "PENDING"} | SEAL: {sealNo || "PENDING"}</div>
            <div>EQUIP: {payload.c} | PLAN: {payload.tot} CTNS / {payload.wt} KG</div>
            <div>SCANNED: {Object.values(scanCounts).reduce((a, b) => a + b, 0)} | EXCEP: {discrepancies.length}</div>
            <svg viewBox="0 0 240 34" width="100%" height="34" aria-label="Barcode" style={{ marginTop: 6 }}>
              {[4,10,14,22,26,34,40,46,52,58,66,72,78,86,92,98,106,114,120,128,136,142,150,158,166,174,182,190,198,206,214,224].map((x, idx) => (
                <rect key={x} x={x} y={2} width={idx % 3 === 0 ? 4 : 2} height={28} fill="#0F172A" />
              ))}
            </svg>
          </div>
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
              try {
                await navigator.clipboard.writeText(receipt);
                setReceiptCopied(true);
                setTimeout(() => setReceiptCopied(false), 2500);
              } catch {}
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
              entries.push({ name: "scan-audit.csv", data: new TextEncoder().encode(buildCrewAuditCsv(payload, containerNo, sealNo, scanCounts, discrepancies)) });
              if (discrepancies.length > 0) {
                entries.push({ name: "discrepancies.json", data: new TextEncoder().encode(JSON.stringify(discrepancies, null, 2)) });
              }
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
