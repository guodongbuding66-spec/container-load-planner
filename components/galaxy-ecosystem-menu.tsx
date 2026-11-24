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
    <details className="workspace-other-menu" name="workspace-menus">
      <summary className="button ghost list-none select-none [&::-webkit-details-marker]:hidden">
        <Box size={16} />{tr("其他工具","Other tools")}</summary>
      <div className="workspace-other-panel">
        <div className="workspace-other-heading">{tr("GALAXY 工具生态")}</div>
        <div className="workspace-other-links">
          {TOOLS.map((tool) => {
            const Icon = tool.icon;
            return (
              <a
                key={tool.href}
                href={tool.href}
                target="_blank"
                rel="noopener noreferrer"
                className="workspace-other-link"
              >
                <span className="workspace-other-icon">
                  <Icon size={16} />
                </span>
                <span className="workspace-other-copy">
                  <strong >{tr(tool.name)}</strong>
                  <small >{tr(tool.description)}</small>
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
    const resolveTarget = () => setTarget(document.querySelector(".workspace-other-entry"));
    resolveTarget();
    if (document.querySelector(".workspace-other-entry")) return;
    const observer = new MutationObserver(resolveTarget);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  return target ? createPortal(<Menu />, target) : null;
}
