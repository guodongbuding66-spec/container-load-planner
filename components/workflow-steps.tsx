"use client";

import { useState } from "react";
import type { LoadingWorkflow } from "../lib/packing/types";
import { Check, ChevronDown } from "lucide-react";
import { tr, useLanguage } from "./language";

export type WorkflowStep = 1 | 2 | 3 | 4 | 5 | 6 | 7;

const allSteps = [
  [1, "选柜型", "Container"],
  [2, "选包装", "Packaging"],
  [3, "录入货物", "Cargo"],
  [4, "布置预览", "Layout"],
  [5, "装载规则", "Rules"],
  [6, "核对计算", "Review"],
  [7, "查看方案", "Results"],
] as const;

const simpleSteps = [
  [1, "选柜型", "Container"],
  [3, "录入货物", "Cargo"],
  [7, "查看方案", "Results"],
] as const;

export function WorkflowSteps({
  current,
  maxUnlocked,
  onSelect,
  workflow = "palletized",
  simpleMode = false,
  onToggleSimpleMode,
}: {
  workflow?: LoadingWorkflow;
  current: WorkflowStep;
  maxUnlocked?: WorkflowStep;
  onSelect: (step: WorkflowStep) => void;
  simpleMode?: boolean;
  onToggleSimpleMode?: () => void;
}) {
  const unlockedStep = Math.max(current, maxUnlocked ?? current);
  useLanguage();
  const [mobileOpen, setMobileOpen] = useState(false);

  const visibleSteps = simpleMode ? simpleSteps : allSteps;
  const totalCount = visibleSteps.length;
  const activeIdx = Math.max(0, visibleSteps.findIndex(([id]) => id === current));
  const activeStep = visibleSteps[activeIdx] ?? visibleSteps[0];

  const labelFor = (id: WorkflowStep, label: string, en: string) =>
    id === 2 && (workflow === "direct" || workflow === "single-capacity")
      ? tr("底托选项", "Floor options")
      : id === 4 && (workflow === "direct" || workflow === "single-capacity")
        ? tr("散箱布置", "Loose layout")
        : id === 1 && workflow === "pallet-only"
          ? tr("装载方式", "Workflow")
          : tr(label, en);

  return (
    <div className="wizard-steps-shell">
      <div className="mobile-step-capsule">
        <button
          type="button"
          className="mobile-step-trigger"
          aria-expanded={mobileOpen}
          onClick={() => setMobileOpen((v) => !v)}
        >
          <span>
            {tr(`步骤 ${activeIdx + 1} / ${totalCount}`, `Step ${activeIdx + 1} / ${totalCount}`)} ·{" "}
            <strong>{labelFor(activeStep[0], activeStep[1], activeStep[2])}</strong>
          </span>
          <ChevronDown size={16} aria-hidden="true" />
        </button>
        {mobileOpen && (
          <div className="mobile-step-drawer" role="menu">
            {visibleSteps.map(([id, label, en], idx) => (
              <button
                type="button"
                key={id}
                role="menuitem"
                className={current === id ? "current" : id < current || id <= unlockedStep ? "complete" : ""}
                disabled={id > unlockedStep}
                onClick={() => {
                  onSelect(id);
                  setMobileOpen(false);
                }}
              >
                <span className="wizard-step-number" aria-hidden="true">
                  {id < current ? <Check size={14} /> : idx + 1}
                </span>
                <span>{labelFor(id, label, en)}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="wizard-steps-row">
        <nav className="wizard-steps" aria-label={tr("装柜计算步骤", "Loading workflow")}>
          {visibleSteps.map(([id, label, en], idx) => (
            <button
              type="button"
              key={id}
              aria-current={current === id ? "step" : undefined}
              className={current === id ? "current" : id < current || id <= unlockedStep ? "complete" : ""}
              disabled={id > unlockedStep}
              onClick={() => onSelect(id)}
            >
              <span className="wizard-step-number" aria-hidden="true">
                {id < current ? <Check size={15} /> : idx + 1}
              </span>
              <strong>{labelFor(id, label, en)}</strong>
            </button>
          ))}
        </nav>
        {onToggleSimpleMode && (
          <button
            type="button"
            className={`mode-switch-pill${simpleMode ? " is-simple" : ""}`}
            aria-pressed={simpleMode}
            onClick={onToggleSimpleMode}
            title={simpleMode ? tr("切换回完整 7 步专家模式", "Switch to full 7-step Expert Mode") : tr("切换至极简 3 步新手模式", "Switch to 3-step Simple Mode")}
          >
            {simpleMode ? tr("极简 3 步", "Simple 3-Step") : tr("专家 7 步", "Expert 7-Step")}
          </button>
        )}
      </div>
    </div>
  );
}
