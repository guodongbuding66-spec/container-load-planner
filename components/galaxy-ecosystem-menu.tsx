"use client";

import {tr, useLanguage} from "./language";
import { Box, ExternalLink, Search, Video } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

const TOOLS = [
  {
    href: "https://soutu-pro.vercel.app/",
    name: "搜图 Pro",
    description: "反向搜图、OCR、商品溯源与批量图片研究",
    icon: Search,
  },
  {
    href: "https://galaxy-downloader.guodongbuding66.workers.dev/zh",
    name: "SparkDownloader",
    description: "在线视频、音频、图文与 HLS 下载工具",
    icon: Video,
  },
] as const;

function Menu() {
  useLanguage();
  return (
    <details className="workspace-other-menu relative z-50" name="workspace-menus">
      <summary className="button ghost list-none select-none [&::-webkit-details-marker]:hidden">
        <Box size={16} />{tr("其他工具")}</summary>
      <div className="workspace-other-panel absolute right-0 top-[46px] z-[90] w-[min(390px,calc(100vw-28px))] rounded-2xl border border-[#dce5e7] bg-white p-2.5 shadow-[0_20px_60px_rgba(21,52,67,.16)]">
        <div className="px-2 pb-2 pt-1 text-[10px] font-extrabold tracking-[.12em] text-[#71868c]">{tr("GALAXY 工具生态")}</div>
        <div className="grid gap-1">
          {TOOLS.map((tool) => {
            const Icon = tool.icon;
            return (
              <a
                key={tool.href}
                href={tool.href}
                target="_blank"
                rel="noopener noreferrer"
                className="grid grid-cols-[36px_minmax(0,1fr)_16px] items-center gap-2.5 rounded-xl px-2.5 py-2.5 text-[#263f47] no-underline transition-colors hover:bg-[#eef5f6]"
              >
                <span className="grid h-9 w-9 place-items-center rounded-[10px] border border-[#dce5e7] bg-[#e8f3f4] text-[#2f7f89]">
                  <Icon size={16} />
                </span>
                <span className="min-w-0">
                  <strong className="block text-xs">{tr(tool.name)}</strong>
                  <small className="mt-0.5 block text-[10px] leading-4 text-[#71868c]">{tr(tool.description)}</small>
                </span>
                <ExternalLink size={14} className="text-[#91a6aa]" />
              </a>
            );
          })}
        </div>
      </div>
    </details>
  );
}

export function GalaxyEcosystemMenu() {
  useLanguage();
  const [target, setTarget] = useState<Element | null>(null);

  useEffect(() => {
    const resolveTarget = () => setTarget(document.querySelector(".top-actions"));
    resolveTarget();
    if (document.querySelector(".top-actions")) return;
    const observer = new MutationObserver(resolveTarget);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  return target ? createPortal(<Menu />, target) : null;
}
