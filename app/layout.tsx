import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./features.css";
import "./scene-workbench.css";
import "./compact-workspace.css";
import "./cargo-workbench.css";
import "./tokens.css";
import "./workbench-layout.css";
import { GalaxyEcosystemMenu } from "../components/galaxy-ecosystem-menu";
import { AppLanguageTitle } from "../components/language";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F8FAFC" },
    { media: "(prefers-color-scheme: dark)", color: "#0B1117" },
  ],
};

export const metadata: Metadata = {
  title: {
    default: "CargoFit · 外贸装柜智算 | 3D Container Load Planner",
    template: "%s | CargoFit",
  },
  description:
    "3D container load planner for exporters, merchandisers, and warehouses. Paste Excel orders, mix pallets and loose cartons, fill gaps, compare FCL vs LCL, and export Packing Lists.",
  robots: { index: true, follow: true },
  openGraph: {
    type: "website",
    title: "CargoFit | 3D Container Load Planner",
    description:
      "3-second Excel import, 3D pallet & container optimization, gap-fill upsell calculator, FCL vs LCL break-even, and account-free Crew View.",
    siteName: "CargoFit",
  },
  twitter: {
    card: "summary_large_image",
    title: "CargoFit | 3D Container Load Planner",
    description:
      "3D container load planner for exporters, merchandisers, and warehouses.",
  },
  other: {
    "codex-preview": "development",
  },
  manifest: "/manifest.webmanifest",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
    apple: "/favicon.svg",
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
