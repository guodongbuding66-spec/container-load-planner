import type { Metadata } from "next";
import "./globals.css";
import "./features.css";
import "./scene-workbench.css";
import "./compact-workspace.css";
import { GalaxyEcosystemMenu } from "../components/galaxy-ecosystem-menu";
import { AppLanguageTitle } from "../components/language";

export const metadata: Metadata = {
  description: "面向外贸业务的单品最大装柜量、多 SKU 拼柜与三维装载复核工具。",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">
        <AppLanguageTitle />
        <GalaxyEcosystemMenu />
        {children}
      </body>
    </html>
  );
}
