import type { ProductInput } from "./types";
export async function importSpreadsheet(file: File, colors: readonly string[]): Promise<ProductInput[]> {
  const buffer = await file.arrayBuffer();
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./spreadsheet.worker.ts", import.meta.url), { type: "module" });
    const timer = setTimeout(() => { worker.terminate(); reject(new Error("Excel 读取超过 30 秒，请精简清单后重试。")); }, 30000);
    const stop = () => { clearTimeout(timer); worker.terminate(); };
    worker.onmessage = event => { stop(); if (event.data.error) reject(new Error(event.data.error)); else resolve(event.data.products); };
    worker.onerror = () => { stop(); reject(new Error("Excel 读取线程异常，当前输入未修改。")); };
    worker.postMessage({ buffer, colors }, [buffer]);
  });
}
