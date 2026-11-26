"use client";
import { useMemo, useRef, useState } from "react";
import { ClipboardPaste, CheckCircle2, AlertTriangle, Upload, X } from "lucide-react";
import { parseSmartCargoText, smartRowsToProducts } from "../lib/packing/smart-import";
import type { LengthUnit, WeightUnit } from "../lib/packing/units";
import type { ProductInput } from "../lib/packing/types";
import { tr, useLanguage } from "./language";

export function SmartPasteImporter({
  onImport,
  existingCount,
  disabled = false,
}: {
  onImport: (products: ProductInput[], mode: "append" | "replace") => void;
  existingCount: number;
  disabled?: boolean;
}) {
  useLanguage();
  const [open, setOpen] = useState(false);
  const [rawText, setRawText] = useState("");
  const [lengthOverride, setLengthOverride] = useState<"" | LengthUnit>("");
  const [weightOverride, setWeightOverride] = useState<"" | WeightUnit>("");
  const [fileError, setFileError] = useState("");
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const parsed = useMemo(
    () => parseSmartCargoText(rawText, lengthOverride || undefined, weightOverride || undefined),
    [rawText, lengthOverride, weightOverride],
  );

  const handleFile = async (file: File) => {
    setFileError("");
    try {
      const lower = file.name.toLowerCase();
      if (lower.endsWith(".xlsx") || lower.endsWith(".xls")) {
        const ExcelJS = (await import("exceljs")).default;
        const wb = new ExcelJS.Workbook();
        const buf = await file.arrayBuffer();
        await wb.xlsx.load(buf);
        const ws = wb.worksheets[0];
        if (!ws) throw new Error(tr("工作簿为空。", "Workbook is empty."));
        const lines: string[] = [];
        ws.eachRow((row) => {
          const vals = (row.values as unknown[]).slice(1).map((v) => {
            if (v === null || v === undefined) return "";
            if (typeof v === "object" && "result" in (v as Record<string, unknown>)) return String((v as { result: unknown }).result ?? "");
            return String(v).replace(/\t|\r|\n/g, " ").trim();
          });
          if (vals.some((c) => c.length > 0)) lines.push(vals.join("\t"));
        });
        setRawText(lines.join("\n"));
      } else {
        const text = await file.text();
        setRawText(text);
      }
    } catch (e) {
      setFileError(e instanceof Error ? e.message : tr("文件解析失败，请检查格式。", "Failed to parse file."));
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        className="button ghost small"
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        <ClipboardPaste size={15} />
        {tr("粘贴 / 拖拽导入 Excel", "Smart Paste / Drop Excel")}
      </button>
    );
  }

  const autoFixInvalidRows = () => {
    const fixed = rawText
      .split(/\r?\n/)
      .map((line) => line.replace(/(^|[\t,\sxX×*])-(\d+(?:\.\d+)?)/g, "$1$2"))
      .join("\n");
    setRawText(fixed);
  };

    const commit = (mode: "append" | "replace") => {
    const items = smartRowsToProducts(parsed.rows, mode === "append" ? existingCount : 0);
    if (!items.length) return;
    onImport(items, mode);
    setRawText("");
    setFileError("");
    setOpen(false);
  };

  return (
    <section className="v1-panel" aria-label={tr("智能剪贴板粘贴与拖拽导入", "Smart clipboard paste and drag-drop importer")}>
      <div className="v1-panel-head">
        <h3>{tr("智能粘贴 / 拖拽导入 Excel & CSV（支持合并尺寸如 60x40x35cm）", "Smart Paste / Drop Excel & CSV (supports 60x40x35cm)")}</h3>
        <button type="button" className="icon-button" aria-label={tr("关闭", "Close")} onClick={() => setOpen(false)}>
          <X size={16} />
        </button>
      </div>

      <div
        className={`smart-dropzone ${dragging ? "is-dragging" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const f = e.dataTransfer.files?.[0];
          if (f) void handleFile(f);
        }}
        onClick={() => fileInputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") fileInputRef.current?.click();
        }}
      >
        <Upload size={18} />
        <span>
          {tr("拖拽 .xlsx / .csv 文件到此处，或点击选择文件（也可直接在下方 Ctrl+V 粘贴表格）", "Drop .xlsx / .csv file here or click to browse (or paste directly below)")}
        </span>
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.csv,.tsv,.txt"
          hidden
          onChange={(e) => {
            const f = e.currentTarget.files?.[0];
            e.currentTarget.value = "";
            if (f) void handleFile(f);
          }}
        />
      </div>
      {fileError && <p style={{ color: "var(--status-fail-fg)", fontSize: 13, margin: "6px 0" }}>{fileError}</p>}

      <textarea
        className="v1-textarea"
        placeholder={tr(
          "示例：\n货号\t品名\t外箱尺寸\t毛重(kg)\t箱数\t客户\t卸货顺序\nSKU-01\t折叠椅\t60x40x35cm\t12.5\t80\tBuyer A\t1",
          "Example:\nSKU\tName\tSize\tGross(kg)\tQty\tCustomer\tStop\nSKU-01\tChair\t60x40x35cm\t12.5\t80\tBuyer A\t1",
        )}
        value={rawText}
        onChange={(e) => setRawText(e.target.value)}
      />
      <div className="v1-actions">
        {parsed.errorCount > 0 && (
          <button type="button" className="button small" onClick={autoFixInvalidRows}>
            {tr("一键修正异常行", "Auto-Fix Invalid Rows")}
          </button>
        )}
        <label style={{ fontSize: 12 }}>
          {tr("长度单位：", "Length unit: ")}
          <select value={lengthOverride} onChange={(e) => setLengthOverride(e.target.value as "" | LengthUnit)}>
            <option value="">{tr(`自动 (${parsed.detectedLengthUnit})`, `Auto (${parsed.detectedLengthUnit})`)}</option>
            <option value="mm">mm</option>
            <option value="cm">cm</option>
            <option value="m">m</option>
            <option value="in">in</option>
          </select>
        </label>
        <label style={{ fontSize: 12 }}>
          {tr("重量单位：", "Weight unit: ")}
          <select value={weightOverride} onChange={(e) => setWeightOverride(e.target.value as "" | WeightUnit)}>
            <option value="">{tr(`自动 (${parsed.detectedWeightUnit})`, `Auto (${parsed.detectedWeightUnit})`)}</option>
            <option value="kg">kg</option>
            <option value="lb">lb</option>
          </select>
        </label>
        {parsed.unitHint === "possible_cm" && (
          <button type="button" className="button small" onClick={() => setLengthOverride("cm")}>
            <AlertTriangle size={14} />
            {tr("检测到疑似厘米(cm)，点此一键按 cm 换算", "Looks like cm — click to convert from cm")}
          </button>
        )}
      </div>

      {parsed.rows.length > 0 && (
        <div style={{ overflowX: "auto", marginTop: 10 }}>
          <p style={{ fontSize: 13, margin: "4px 0" }}>
            <CheckCircle2 size={14} style={{ verticalAlign: "middle", marginRight: 4 }} />
            {tr(
              `识别 ${parsed.rows.length} 行：有效 ${parsed.validCount} 行，异常 ${parsed.errorCount} 行`,
              `Parsed ${parsed.rows.length} rows: ${parsed.validCount} valid, ${parsed.errorCount} with errors`,
            )}
          </p>
          <table className="v1-table">
            <thead>
              <tr>
                <th>#</th>
                <th>SKU</th>
                <th className="num">L × W × H (mm)</th>
                <th className="num">{tr("毛重 (kg)", "Gross (kg)")}</th>
                <th className="num">{tr("箱数", "Qty")}</th>
                <th>{tr("状态", "Status")}</th>
              </tr>
            </thead>
            <tbody>
              {parsed.rows.slice(0, 12).map((row) => (
                <tr key={row.rowIndex}>
                  <td className="num">{row.rowIndex}</td>
                  <td>{row.sku}</td>
                  <td className="num">{`${row.lengthMm} × ${row.widthMm} × ${row.heightMm}`}</td>
                  <td className="num">{row.weightKg}</td>
                  <td className="num">{row.quantity}</td>
                  <td>
                    {row.errors.length === 0 ? (
                      <span className="status-badge status-badge-success">{tr("有效", "OK")}</span>
                    ) : (
                      <span className="status-badge status-badge-danger">{row.errors[0]}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="v1-actions">
        <button type="button" className="button primary small" disabled={parsed.validCount === 0} onClick={() => commit("append")}>
          {tr(`追加导入 ${parsed.validCount} 行`, `Append ${parsed.validCount} rows`)}
        </button>
        <button type="button" className="button small" disabled={parsed.validCount === 0} onClick={() => commit("replace")}>
          {tr("替换当前货物清单", "Replace current list")}
        </button>
        <button type="button" className="button ghost small" onClick={() => setOpen(false)}>
          {tr("取消", "Cancel")}
        </button>
      </div>
    </section>
  );
}
