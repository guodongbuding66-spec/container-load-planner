"use client";

import { useState } from "react";
import { Copy, ExternalLink, Mail, Network } from "lucide-react";

const SUPPORT_EMAIL = "1906761042@qq.com";
const sites = [
  { name: "Cloudflare 主站", url: "https://container-load-planner.pages.dev/" },
];

export function SupportAndSites() {
  const [copyMessage, setCopyMessage] = useState("");

  async function copyEmail() {
    try {
      await navigator.clipboard.writeText(SUPPORT_EMAIL);
      setCopyMessage("邮箱已复制");
    } catch {
      setCopyMessage("复制未成功，请手动选择邮箱复制");
    }
  }

  return (
    <section className="support-strip" aria-label="联系作者与备用网站">
      <div className="support-contact">
        <Mail size={17} aria-hidden="true" />
        <a href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent("装柜智算 · 咨询与反馈")}`}>{SUPPORT_EMAIL}</a>
        <span>问题咨询 · 升级建议 · 方案定制</span>
        <button type="button" className="support-copy" onClick={copyEmail} aria-label="复制联系邮箱"><Copy size={15} aria-hidden="true" /></button>
        <span className="support-copy-result" role="status">{copyMessage}</span>
      </div>
      <details className="support-sites">
        <summary><Network size={16} aria-hidden="true" />备用网站</summary>
        <div className="support-sites-panel">
          <strong>站点地址与备用线路</strong>
          <nav aria-label="装柜智算站点线路">
            {sites.map((site) => (
              <a key={site.url} href={site.url} target="_blank" rel="noopener noreferrer">
                <span>{site.name}<small>{new URL(site.url).hostname}</small></span>
                <ExternalLink size={16} aria-hidden="true" />
              </a>
            ))}
          </nav>
          <p>不同站点的本机草稿独立保存。切换前请保留当前页面，并导出需要保留的方案。</p>
          <p className="support-sites-pending">备用线路暂未开放：Netlify、GitHub Pages、Vercel、EdgeOne Makers。上线核验后将在这里提供访问入口。</p>
          <small>建议收藏备用地址，主站无法打开时也能直接访问。</small>
        </div>
      </details>
    </section>
  );
}
