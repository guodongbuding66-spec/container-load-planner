"use client";
import { useMemo, useState } from "react";
import { BookMarked, Plus, Save, Search, Trash2, Users } from "lucide-react";
import type { ProductInput } from "../lib/packing/types";
import {
  loadSkuLibrary,
  mergeProductsIntoLibrary,
  SAMPLE_CLIENT_TEMPLATES,
  saveSkuLibrary,
  savedSkuToProduct,
  type SavedSkuItem,
} from "../lib/packing/sku-library";
import { tr, useLanguage } from "./language";

export function SkuLibraryDrawer({
  currentProducts,
  onAppendProducts,
}: {
  currentProducts: readonly ProductInput[];
  onAppendProducts: (rows: ProductInput[]) => void;
}) {
  useLanguage();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<SavedSkuItem[]>(() => loadSkuLibrary());
  const [query, setQuery] = useState("");
  const [clientTag, setClientTag] = useState("");
  const [notice, setNotice] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (i) =>
        i.sku.toLowerCase().includes(q) ||
        i.name.toLowerCase().includes(q) ||
        (i.clientTag ?? "").toLowerCase().includes(q),
    );
  }, [items, query]);

  const saveCurrentToLibrary = () => {
    const next = mergeProductsIntoLibrary(items, currentProducts, clientTag);
    setItems(next);
    saveSkuLibrary(next);
    setNotice(tr(`已将当前 ${currentProducts.length} 个 SKU 存入产品库。`, `Saved ${currentProducts.length} SKUs to library.`));
  };

  const removeItem = (id: string) => {
    const next = items.filter((i) => i.id !== id);
    setItems(next);
    saveSkuLibrary(next);
  };

  const loadTemplate = (tplName: string) => {
    const list = SAMPLE_CLIENT_TEMPLATES[tplName];
    if (!list) return;
    onAppendProducts(list.map((it, idx) => savedSkuToProduct(it, idx)));
    setNotice(tr(`已载入老客户模板「${tplName}」（${list.length} 个 SKU）。`, `Loaded client template "${tplName}" (${list.length} SKUs).`));
  };

  if (!open) {
    return (
      <div style={{ marginBottom: 10, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <button type="button" className="button small" onClick={() => setOpen(true)}>
          <BookMarked size={14} aria-hidden="true" />
          {tr("SKU 产品库 / 老客户模板", "SKU Library & Client Templates")} ({items.length})
        </button>
      </div>
    );
  }

  return (
    <section className="v1-panel" aria-label={tr("SKU 常驻产品库", "SKU Product Library")} style={{ marginTop: 0, marginBottom: 12 }}>
      <div className="v1-panel-head">
        <h3>
          <BookMarked size={15} aria-hidden="true" style={{ verticalAlign: "-2px", marginRight: 6 }} />
          {tr("SKU 常驻产品库 & 老客户翻单模板", "SKU Product Library & Repeat Client Templates")}
        </h3>
        <button type="button" className="button ghost small" onClick={() => setOpen(false)}>
          {tr("收起", "Collapse")}
        </button>
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
        <input
          value={clientTag}
          onChange={(e) => setClientTag(e.target.value)}
          placeholder={tr("客户标签（可选，如 VIP-US）", "Client tag (optional, e.g. VIP-US)")}
          aria-label={tr("客户标签", "Client tag")}
          style={{ padding: "6px 10px", border: "1px solid var(--border-card)", borderRadius: 6, fontSize: 12 }}
        />
        <button type="button" className="button primary small" onClick={saveCurrentToLibrary}>
          <Save size={14} aria-hidden="true" />
          {tr("将当前订单存入产品库", "Save Current SKUs to Library")}
        </button>
        <span style={{ fontSize: 12, color: "var(--text-muted)", marginLeft: 4 }}>
          <Users size={13} aria-hidden="true" style={{ verticalAlign: "-2px", marginRight: 4 }} />
          {tr("老客户快捷模板：", "Quick templates:")}
        </span>
        {Object.keys(SAMPLE_CLIENT_TEMPLATES).map((tpl) => (
          <button key={tpl} type="button" className="button ghost small" onClick={() => loadTemplate(tpl)}>
            <Plus size={13} aria-hidden="true" />{tpl}
          </button>
        ))}
      </div>

      {notice && (
        <p className="helper-text" role="status" aria-live="polite" style={{ color: "var(--brand-primary)", marginBottom: 8 }}>
          {notice}
        </p>
      )}

      {items.length > 0 && (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
            <Search size={14} aria-hidden="true" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={tr("搜索 SKU、品名或客户标签…", "Search SKU, name or client tag…")}
              aria-label={tr("搜索产品库", "Search SKU library")}
              style={{ flex: "1 1 220px", maxWidth: 320, padding: "6px 10px", border: "1px solid var(--border-card)", borderRadius: 6, fontSize: 12 }}
            />
          </div>
          <table className="v1-table">
            <thead>
              <tr>
                <th>SKU</th>
                <th>{tr("品名", "Name")}</th>
                <th className="num">L×W×H (mm)</th>
                <th className="num">kg</th>
                <th>{tr("客户标签", "Client")}</th>
                <th className="num">{tr("操作", "Action")}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((item, idx) => (
                <tr key={item.id}>
                  <td><strong>{item.sku}</strong></td>
                  <td>{item.name}</td>
                  <td className="num">{item.length}×{item.width}×{item.height}</td>
                  <td className="num">{item.weight}</td>
                  <td>{item.clientTag || "—"}</td>
                  <td className="num">
                    <button
                      type="button"
                      className="button small"
                      onClick={() => onAppendProducts([savedSkuToProduct(item, idx)])}
                      style={{ marginRight: 6 }}
                    >
                      <Plus size={12} aria-hidden="true" />{tr("加入订单", "Add")}
                    </button>
                    <button
                      type="button"
                      className="button ghost small"
                      aria-label={tr(`删除 ${item.sku}`, `Delete ${item.sku}`)}
                      onClick={() => removeItem(item.id)}
                    >
                      <Trash2 size={12} aria-hidden="true" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}
