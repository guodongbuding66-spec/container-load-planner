import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("Galaxy ecosystem menu", () => {
  it("keeps the related production tools discoverable", () => {
    const source = readFileSync(join(process.cwd(), "components/galaxy-ecosystem-menu.tsx"), "utf8");
    expect(source).not.toContain("https://ai-foreign-trade-os.pages.dev/");
    expect(source).not.toContain("https://isunor-industry-daily.pages.dev/");
    expect(source).toContain("https://soutu-pro.vercel.app/");
    expect(source).toContain("https://galaxy-downloader.guodongbuding66.workers.dev/zh");
    expect(source).not.toContain("https://github.com/guodongbuding66-spec/galaxy-downloader");
    expect(source).toContain("createPortal");
    expect(source).toContain(".workspace-other-entry");
  });
});
