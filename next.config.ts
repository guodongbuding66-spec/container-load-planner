import type { NextConfig } from "next";

const isCloudflarePages = process.env.CF_PAGES === "1";

const nextConfig: NextConfig = {
  ...(isCloudflarePages ? { output: "export" as const } : {}),
};

export default nextConfig;

