"use client";

import { useMemo } from "react";
import { BookOpen } from "lucide-react";
import { inspectLoadShortfall } from "../lib/packing/load-shortfall";
import type { PackingResult, ProductInput } from "../lib/packing/types";
import { tr, trText, useLanguage } from "./language";

export function LoadingShortfall({plan, products, onDetails, onGuide}: {
  plan: PackingResult;
  products: ProductInput[];
  onDetails: () => void;
  onGuide: (topic: "stack-pallets" | "capacity") => void;
}) {
  const language = useLanguage();
  const report = useMemo(() => inspectLoadShortfall(plan, products), [plan, products]);
  if (!report) return null;
  const number = (value: number) => value.toLocaleString(language === "zh" ? "zh-CN" : "en-US", {maximumFractionDigits: 3});
  const {remaining, only, prepared, waiting, loadedPallets, totalLimit, usedStock, floorOnly, ceiling, weightBlocked, fitBlocked} = report;
  const facts = [
    prepared !== undefined && waiting > 0 && tr(
      `已备 ${number(prepared)} 托 · 入柜 ${number(loadedPallets)} 托 · 待入柜 ${number(waiting)} 托`,
      `${number(prepared)} pallets prepared · ${number(loadedPallets)} loaded · ${number(waiting)} awaiting loading`,
    ),
    totalLimit !== undefined && tr(`已达到总备托上限 ${number(totalLimit)} 托`, `Total preparation limit reached (${number(totalLimit)} pallets)`),
    !!usedStock && tr(`${tr(usedStock.config.name)} · 已用完 ${number(usedStock.maxPallets)} 托备货数量`, `${tr(usedStock.config.name)} · all ${number(usedStock.maxPallets)} units of packaging allocated`),
    !!floorOnly && tr(`${tr(floorOnly.config.name)} · 当前整托规则仅允许底置`, `${tr(floorOnly.config.name)} · current rules keep loaded units at floor level`),
    !!ceiling && tr(`${tr(ceiling.name)} · 托内净高 ${number(ceiling.current)} mm，${ceiling.sku} 只够一层纸箱`, `${tr(ceiling.name)} · ${number(ceiling.current)} mm allows one layer of ${ceiling.sku}`),
    !!weightBlocked && tr(`${weightBlocked.sku} 单箱 ${number(weightBlocked.weight)} kg，剩余载重 ${number(report.remainingKg)} kg`, `${weightBlocked.sku} weighs ${number(weightBlocked.weight)} kg per carton with ${number(report.remainingKg)} kg of payload remaining`),
    !!fitBlocked && `${fitBlocked.sku} · ${trText(fitBlocked.reason)}`,
    report.limitedSearch && tr("已达到打托搜索数量上限", "The pallet preparation search reached its quantity limit"),
  ].filter((entry): entry is string => typeof entry === "string");
  return <section className="loading-shortfall" aria-label={tr("未装原因","Unloaded cargo diagnosis")}>
    <div className="loading-shortfall-head">
      <h3>{only ? tr(`${number(remaining)} 箱待打托`, `${number(remaining)} cartons awaiting palletizing`) : tr(`${number(remaining)} 箱未装柜`, `${number(remaining)} cartons still to load`)}</h3>
      <div className="loading-shortfall-actions">
        <button type="button" className="button small" onClick={onDetails}>{tr("查看详细诊断","View detailed diagnosis")}</button>
        <button type="button" className="button ghost small" onClick={() => onGuide(floorOnly || ceiling ? "stack-pallets" : "capacity")}><BookOpen size={15} aria-hidden="true"/>{tr("排查教程","Troubleshooting guide")}</button>
      </div>
    </div>
    {facts.length > 0 ? <ul>{facts.map(fact => <li key={fact}>{fact}</li>)}</ul>
      : <p>{tr("本次搜索未安置余货。请在详细诊断中核对货物尺寸、连续空间和装载约束。","The search left some cargo unplaced. Check dimensions, contiguous space and loading constraints in the detailed diagnosis.")}</p>}
  </section>;
}
