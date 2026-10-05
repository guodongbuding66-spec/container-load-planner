import { parseSpreadsheet } from "./spreadsheet";
self.onmessage = async (event: MessageEvent<{ buffer: ArrayBuffer; colors: string[] }>) => {
  try { self.postMessage({ products: await parseSpreadsheet(event.data.buffer, event.data.colors) }); }
  catch (e) { self.postMessage({ error: e instanceof Error ? e.message : "Excel 读取失败。" }); }
};
