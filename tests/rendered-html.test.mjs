import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const developmentPreviewMeta =
  /<meta(?=[^>]*\bname=["']codex-preview["'])(?=[^>]*\bcontent=["']development["'])[^>]*>/i;

test("renders development preview metadata", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  const response = await worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );

  assert.equal(response.status, 200);
  assert.match(
    response.headers.get("content-type") ?? "",
    /^text\/html\b/i,
  );
  const html = await response.text();
  assert.match(html, developmentPreviewMeta);
  assert.match(html, /目标利用率倒推/);
  assert.match(html, /另存为自定义柜型/);
});

test("includes result-only progress and three-view interfaces", async () => {
  const source = await readFile(new URL("../components/packing-app.tsx", import.meta.url), "utf8");
  assert.match(source, /码垛进度/);
  assert.match(source, /三视图同步复核/);
  assert.match(source, /OrthographicViews/);
});

test("prints three-view diagrams as undistorted vector artwork", async () => {
  const source = await readFile(new URL("../components/orthographic-views.tsx", import.meta.url), "utf8");
  const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

  assert.match(source, /className="projection-print-svg"/);
  assert.match(source, /preserveAspectRatio="xMidYMid meet"/);
  assert.match(styles, /\.viewer-projections \.projection-canvas \{ display: none !important; \}/);
  assert.match(styles, /\.viewer-projections \.projection-print-svg \{ display: block;/);
  assert.match(styles, /grid-template-columns: repeat\(3, minmax\(0, 1fr\)\) !important;/);
});

test("includes arbitrary multi-carton set creation and traceability", async () => {
  const source = await readFile(new URL("../components/packing-app.tsx", import.meta.url), "utf8");
  const engine = await readFile(new URL("../lib/packing/engine.ts", import.meta.url), "utf8");

  assert.match(source, /多箱套装助手/);
  assert.match(source, /\[2, 3, 4, 5\]/);
  assert.match(source, /增加箱型/);
  assert.match(source, /向下对齐/);
  assert.match(source, /套装编码,套号,套内序号/);
  assert.match(engine, /box\.setNumber = batch\.setNumber/);
  assert.match(engine, /box\.setItemNumber = itemIndex \+ 1/);
});
