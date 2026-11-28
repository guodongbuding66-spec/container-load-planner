"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Command, CornerDownLeft, Search, X } from "lucide-react";
import { tr, useLanguage } from "./language";

export interface CommandItem {
  id: string;
  group: string;
  label: string;
  keywords?: string;
  disabled?: boolean;
  run: () => void;
}

export function CommandPalette({
  open,
  onClose,
  items,
}: {
  open: boolean;
  onClose: () => void;
  items: readonly CommandItem[];
}) {
  useLanguage();
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const enabled = items.filter((item) => !item.disabled);
    if (!q) return enabled;
    return enabled.filter((item) =>
      `${item.group} ${item.label} ${item.keywords ?? ""}`.toLowerCase().includes(q),
    );
  }, [items, query]);

  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => {
      inputRef.current?.focus();
    }, 20);
    return () => window.clearTimeout(t);
  }, [open]);

  if (!open) return null;

  const safeIndex = Math.min(selectedIndex, Math.max(0, filtered.length - 1));

  const execute = (item?: CommandItem) => {
    if (!item || item.disabled) return;
    onClose();
    setQuery("");
    setSelectedIndex(0);
    item.run();
  };

  return (
    <div
      className="command-palette-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={tr("全局命令搜索", "Command palette")}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
          setQuery("");
        }
      }}
    >
      <div className="command-palette-dialog">
        <div className="command-palette-head">
          <Search size={16} aria-hidden="true" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            placeholder={tr("搜索功能、步骤、单位、深色模式或快捷操作…", "Search commands, steps, units, theme, or quick actions…")}
            aria-label={tr("搜索命令", "Search commands")}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                onClose();
                setQuery("");
              } else if (e.key === "ArrowDown") {
                e.preventDefault();
                setSelectedIndex((i) => (filtered.length ? (i + 1) % filtered.length : 0));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setSelectedIndex((i) => (filtered.length ? (i - 1 + filtered.length) % filtered.length : 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                execute(filtered[safeIndex]);
              }
            }}
          />
          <button
            type="button"
            className="icon-button"
            aria-label={tr("关闭命令面板", "Close command palette")}
            onClick={() => {
              onClose();
              setQuery("");
            }}
          >
            <X size={16} />
          </button>
        </div>
        <div className="command-palette-list" role="listbox">
          {filtered.length === 0 ? (
            <p className="command-palette-empty">{tr("未找到匹配的命令。", "No matching commands.")}</p>
          ) : (
            filtered.map((item, idx) => (
              <button
                key={item.id}
                type="button"
                role="option"
                aria-selected={idx === safeIndex}
                className={`command-palette-item${idx === safeIndex ? " is-active" : ""}`}
                onMouseEnter={() => setSelectedIndex(idx)}
                onClick={() => execute(item)}
              >
                <span className="command-palette-group">{item.group}</span>
                <span className="command-palette-label">{item.label}</span>
                {idx === safeIndex && <CornerDownLeft size={13} aria-hidden="true" />}
              </button>
            ))
          )}
        </div>
        <div className="command-palette-foot">
          <span><Command size={12} aria-hidden="true" /> Ctrl+K / ⌘K</span>
          <span>{tr("↑↓ 选择 · Enter 执行 · Esc 关闭", "↑↓ Navigate · Enter Run · Esc Close")}</span>
        </div>
      </div>
    </div>
  );
}
