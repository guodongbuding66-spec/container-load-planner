"use client";

import {tr, tt, useLanguage} from "./language";
import { palletAnchors } from "../lib/packing/floor-pallets";
import { Check, Rotate3D } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import type { CameraView } from "../lib/packing/camera-fit";
import type { PackingResult, PlacedBox } from "../lib/packing/types";

type ViewKind = "top" | "side" | "door";

type Props = {
  result: PackingResult;
  visibleProducts: Set<string>;
  visibleCount: number;
  primaryCountLabel: string;
  secondaryCountLabel?: string;
  renderPrintSvg?: boolean;
  activeView: CameraView;
  onViewSelect: (view: ViewKind) => void;
};

const VIEW_COPY: Record<ViewKind, { title: string; axes: string; description: string }> = {
  top: { title: "俯视图", axes: "长 × 宽", description: "从柜顶向下查看平面占用" },
  side: { title: "侧视图", axes: "长 × 高", description: "查看沿柜长方向的堆叠高度" },
  door: { title: "箱门视图", axes: "宽 × 高", description: "从箱门方向检查横向和层高" },
};

function projectBox(box: PlacedBox, kind: ViewKind) {
  if (kind === "top") return { x: box.x, y: box.y, width: box.dx, height: box.dy, depth: box.z };
  if (kind === "side") return { x: box.x, y: box.z, width: box.dx, height: box.dz, depth: box.y };
  return { x: box.y, y: box.z, width: box.dy, height: box.dz, depth: box.x };
}

function ProjectionPrintSvg({
  kind,
  boxes,
  horizontalSize,
  verticalSize,
}: {
  kind: ViewKind;
  boxes: PlacedBox[];
  horizontalSize: number;
  verticalSize: number;
}) {
  useLanguage();
  const width = 1000;
  const height = 560;
  const left = 70;
  const right = 55;
  const top = 52;
  const bottom = 78;
  const scale = Math.min(
    (width - left - right) / Math.max(1, horizontalSize),
    (height - top - bottom) / Math.max(1, verticalSize),
  );
  const plotWidth = horizontalSize * scale;
  const plotHeight = verticalSize * scale;
  const plotX = left + Math.max(0, (width - left - right - plotWidth) / 2);
  const plotY = top + Math.max(0, (height - top - bottom - plotHeight) / 2);
  const projected = boxes
    .map((box) => ({ box, projection: projectBox(box, kind) }))
    .sort((a, b) => a.projection.depth - b.projection.depth);
  const fontFamily = '"Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", Arial, sans-serif';

  return (
    <svg
      className="projection-print-svg"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
      focusable="false"
    >
      <rect x={plotX} y={plotY} width={plotWidth} height={plotHeight} fill="#f8fbfb" />
      {Array.from({ length: 9 }, (_, index) => {
        const step = index + 1;
        const x = plotX + (plotWidth * step) / 10;
        const y = plotY + (plotHeight * step) / 10;
        return (
          <g key={`grid-${step}`} stroke="#dfe8e9" strokeWidth="1.4">
            <line x1={x} y1={plotY} x2={x} y2={plotY + plotHeight} />
            <line x1={plotX} y1={y} x2={plotX + plotWidth} y2={y} />
          </g>
        );
      })}
      {projected.map(({ box, projection }) => {
        const x = plotX + projection.x * scale;
        const y = kind === "top"
          ? plotY + projection.y * scale
          : plotY + (verticalSize - projection.y - projection.height) * scale;
        return (
          <rect
            key={`${kind}-${box.id}`}
            x={x}
            y={y}
            width={Math.max(1, projection.width * scale)}
            height={Math.max(1, projection.height * scale)}
            fill={box.color}
            fillOpacity="0.82"
            stroke="#ffffff"
            strokeOpacity="0.82"
            strokeWidth="1.2"
          />
        );
      })}
      <rect x={plotX} y={plotY} width={plotWidth} height={plotHeight} fill="none" stroke="#597b83" strokeWidth="3" />
      <text
        x={plotX + plotWidth / 2}
        y={plotY + plotHeight + 46}
        fill="#71858a"
        fontFamily={fontFamily}
        fontSize="22"
        fontWeight="600"
        textAnchor="middle"
      >
        {Math.round(horizontalSize).toLocaleString()} mm
      </text>
      <text
        transform={`translate(${plotX - 34} ${plotY + plotHeight / 2}) rotate(-90)`}
        fill="#71858a"
        fontFamily={fontFamily}
        fontSize="22"
        fontWeight="600"
        textAnchor="middle"
      >
        {Math.round(verticalSize).toLocaleString()} mm
      </text>
      <text
        x={plotX + plotWidth}
        y={plotY - 18}
        fill="#9a7932"
        fontFamily={fontFamily}
        fontSize="20"
        fontWeight="700"
        textAnchor="end"
      >
        {kind === "door" ? tr("正对箱门") : tr("箱门 →")}
      </text>
    </svg>
  );
}

function ProjectionCanvas({
  kind,
  boxes,
  horizontalSize,
  verticalSize,
  renderPrintSvg,
}: {
  kind: ViewKind;
  boxes: PlacedBox[];
  horizontalSize: number;
  verticalSize: number;
  renderPrintSvg: boolean;
}) {
  useLanguage();
  const language = useLanguage();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const palletCount = boxes.filter((box) => box.supportOnly).length;
  const cargoCount = boxes.length - palletCount;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let frame = 0;

    const draw = () => {
      const rect = canvas.getBoundingClientRect();
      const width = Math.max(280, rect.width);
      const height = Math.max(120, rect.height);
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      const context = canvas.getContext("2d");
      if (!context) return;
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.clearRect(0, 0, width, height);

      const left = 34;
      const right = 30;
      const top = 22;
      const bottom = 35;
      const scale = Math.min(
        (width - left - right) / Math.max(1, horizontalSize),
        (height - top - bottom) / Math.max(1, verticalSize),
      );
      const plotWidth = horizontalSize * scale;
      const plotHeight = verticalSize * scale;
      const plotX = left + Math.max(0, (width - left - right - plotWidth) / 2);
      const plotY = top + Math.max(0, (height - top - bottom - plotHeight) / 2);

      context.fillStyle = "#f8fbfb";
      context.fillRect(plotX, plotY, plotWidth, plotHeight);
      context.strokeStyle = "#dfe8e9";
      context.lineWidth = 1;
      for (let step = 1; step < 10; step += 1) {
        const x = plotX + (plotWidth * step) / 10;
        const y = plotY + (plotHeight * step) / 10;
        context.beginPath();
        context.moveTo(x, plotY);
        context.lineTo(x, plotY + plotHeight);
        context.stroke();
        context.beginPath();
        context.moveTo(plotX, y);
        context.lineTo(plotX + plotWidth, y);
        context.stroke();
      }

      const projected = boxes.map((box) => ({ box, projection: projectBox(box, kind) })).sort((a, b) => a.projection.depth - b.projection.depth);
      for (const { box, projection } of projected) {
        const x = plotX + projection.x * scale;
        const y = kind === "top"
          ? plotY + projection.y * scale
          : plotY + (verticalSize - projection.y - projection.height) * scale;
        const boxWidth = Math.max(1, projection.width * scale);
        const boxHeight = Math.max(1, projection.height * scale);
        context.globalAlpha = 0.82;
        context.fillStyle = box.color;
        context.fillRect(x, y, boxWidth, boxHeight);
        context.globalAlpha = 0.72;
        context.strokeStyle = "#ffffff";
        context.lineWidth = Math.min(1.25, Math.max(0.45, boxWidth / 24));
        context.strokeRect(x + 0.35, y + 0.35, Math.max(0, boxWidth - 0.7), Math.max(0, boxHeight - 0.7));
      }
      context.globalAlpha = 1;
      context.strokeStyle = "#597b83";
      context.lineWidth = 1.6;
      context.strokeRect(plotX, plotY, plotWidth, plotHeight);

      context.fillStyle = "#71858a";
      context.font = "600 11px system-ui, sans-serif";
      context.textAlign = "center";
      context.fillText(`${Math.round(horizontalSize).toLocaleString()} mm`, plotX + plotWidth / 2, plotY + plotHeight + 23);
      context.save();
      context.translate(plotX - 18, plotY + plotHeight / 2);
      context.rotate(-Math.PI / 2);
      context.fillText(`${Math.round(verticalSize).toLocaleString()} mm`, 0, 0);
      context.restore();

      context.font = "700 10px system-ui, sans-serif";
      context.fillStyle = "#9a7932";
      if (kind === "door") {
        context.textAlign = "right";
        context.fillText(tr("正对箱门"), plotX + plotWidth, plotY - 8);
      } else {
        context.textAlign = "right";
        context.fillText(tr("箱门 →"), plotX + plotWidth, plotY - 8);
      }
    };

    const scheduleDraw = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(draw);
    };
    const observer = new ResizeObserver(scheduleDraw);
    observer.observe(canvas);
    scheduleDraw();
    return () => {
      observer.disconnect();
      window.cancelAnimationFrame(frame);
    };
  }, [boxes, horizontalSize, kind, verticalSize, language]);

  return (
    <>
      <canvas ref={canvasRef} className="projection-canvas" role="img" aria-label={tt`${tr(VIEW_COPY[kind].title)}，当前显示 ${cargoCount} 箱${palletCount ? tt`，${palletCount} 个托盘` : ""}`} />
      {renderPrintSvg
        ? <ProjectionPrintSvg kind={kind} boxes={boxes} horizontalSize={horizontalSize} verticalSize={verticalSize} />
        : null}
    </>
  );
}

function occupiedExtent(boxes: PlacedBox[], kind: ViewKind) {
  if (!boxes.length) return { horizontal: 0, vertical: 0 };
  return boxes.reduce(
    (extent, box) => {
      const projected = projectBox(box, kind);
      return {
        horizontal: Math.max(extent.horizontal, projected.x + projected.width),
        vertical: Math.max(extent.vertical, projected.y + projected.height),
      };
    },
    { horizontal: 0, vertical: 0 },
  );
}

export function OrthographicViews({
  result,
  visibleProducts,
  visibleCount,
  primaryCountLabel,
  secondaryCountLabel,
  renderPrintSvg = false,
  activeView,
  onViewSelect,
}: Props) {
  useLanguage();
  const boxes = useMemo(
    () => [...palletAnchors(result.pallets??[]), ...result.placements.slice(0, Math.max(0, visibleCount)).filter((box) => visibleProducts.has(box.productId))],
    [result.placements, result.pallets, visibleCount, visibleProducts],
  );
  const effective = {
    length: Math.max(1, result.container.length - result.clearance * 2),
    width: Math.max(1, result.container.width - result.clearance * 2),
    height: Math.max(1, result.container.height - result.clearance),
  };
  const views: Array<{ kind: ViewKind; horizontalSize: number; verticalSize: number }> = [
    { kind: "top", horizontalSize: effective.length, verticalSize: effective.width },
    { kind: "side", horizontalSize: effective.length, verticalSize: effective.height },
    { kind: "door", horizontalSize: effective.width, verticalSize: effective.height },
  ];

  return (
    <div className="projection-grid">
      {views.map((view) => {
        const copy = VIEW_COPY[view.kind];
        const occupied = occupiedExtent(boxes, view.kind);
        return (
          <button
            type="button"
            className={`projection-card projection-card-action ${activeView === view.kind ? "active" : ""}`}
            key={view.kind}
            aria-pressed={activeView === view.kind}
            aria-label={tt`${tr(copy.title)}，点击让三维视角旋转到${tr(copy.title)}`}
            onClick={() => onViewSelect(view.kind)}
          >
            <header>
              <div><strong>{tr(copy.title)}</strong><span>{tr(copy.axes)} · {tr(copy.description)}</span></div>
              <div className="projection-card-meta">
                <b>{primaryCountLabel}</b>
                {secondaryCountLabel ? <small>{secondaryCountLabel}</small> : null}
                <span>{activeView === view.kind ? <Check size={11} /> : <Rotate3D size={11} />}{activeView === view.kind ? tr("3D 已同步") : tr("联动 3D")}</span>
              </div>
            </header>
            <ProjectionCanvas
              kind={view.kind}
              boxes={boxes}
              horizontalSize={view.horizontalSize}
              verticalSize={view.verticalSize}
              renderPrintSvg={renderPrintSvg}
            />
            <footer>
              <span>{tr("横向占用 ")}{Math.round(occupied.horizontal).toLocaleString()} mm</span>
              <span>{tr("纵向占用 ")}{Math.round(occupied.vertical).toLocaleString()} mm</span>
            </footer>
          </button>
        );
      })}
    </div>
  );
}
