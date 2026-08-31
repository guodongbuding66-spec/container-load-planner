import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("Galaxy ecosystem menu", () => {
  it("keeps the related production tools discoverable", () => {
    const source = readFileSync(join(process.cwd(), "components/galaxy-ecosystem-menu.tsx"), "utf8");
    expect(source).toContain("https://ai-foreign-trade-os.pages.dev/");
    expect(source).toContain("https://isunor-industry-daily.pages.dev/");
    expect(source).toContain("https://github.com/guodongbuding66-spec/galaxy-downloader");
    expect(source).toContain("createPortal");
    expect(source).toContain(".top-actions");
  });
});
