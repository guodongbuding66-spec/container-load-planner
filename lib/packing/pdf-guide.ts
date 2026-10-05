import { palletAnchors } from "./floor-pallets";
import type { PackingResult } from "./types";
type RasterPage = { jpeg: Uint8Array; width: number; height: number };
/** Raster PDF with byte-accurate xref offsets; embeds browser-rendered Unicode text. */
export function buildRasterPdf(pages: RasterPage[]) {
  const encode = (s: string) => new TextEncoder().encode(s); const parts: Uint8Array[] = []; const offsets = [0]; let size = 0;
  const add = (s: string | Uint8Array) => { const bytes = typeof s === "string" ? encode(s) : s; parts.push(bytes); size += bytes.length; };
  const object = (id: number, content: string | Uint8Array[]) => { offsets[id] = size; add(`${id} 0 obj\n`); if (typeof content === "string") add(content); else content.forEach(add); add("\nendobj\n"); };
  add("%PDF-1.4\n%\u00e2\u00e3\u00cf\u00d3\n"); object(1, "<< /Type /Catalog /Pages 2 0 R >>");
  object(2, `<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_, i) => `${3 + i * 3} 0 R`).join(" ")}] >>`);
  pages.forEach((page, i) => { const id = 3 + i * 3; const stream = "q 595.28 0 0 841.89 0 0 cm /Im0 Do Q";
    object(id, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Resources << /XObject << /Im0 ${id + 1} 0 R >> >> /Contents ${id + 2} 0 R >>`);
    object(id + 1, [encode(`<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.jpeg.length} >>\nstream\n`), page.jpeg, encode("\nendstream")]);
    object(id + 2, `<< /Length ${encode(stream).length} >>\nstream\n${stream}\nendstream`);
  });
  const xref = size; add(`xref\n0 ${offsets.length}\n0000000000 65535 f \n`); for (let i = 1; i < offsets.length; i++) add(`${String(offsets[i]).padStart(10, "0")} 00000 n \n`);
  add(`trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  const output = new Uint8Array(size); let at = 0; parts.forEach(part => { output.set(part, at); at += part.length; }); return output;
}
export async function downloadPdfGuide(result: PackingResult, language: "zh" | "en" = "zh") {
  if (!result.validation.valid) throw new Error("方案未通过校验，不能导出指导书。");
  await document.fonts.ready;
  const en = language === "en", t = (zh: string, english: string) => en ? english : zh; const width = 1800, height = 2546; const pages: RasterPage[] = [];
  const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height; const ctx = canvas.getContext("2d"); if (!ctx) throw new Error("浏览器无法生成 PDF。");
  const text = (value: string, x: number, y: number, size = 30, bold = false, color = "#234653") => { ctx.font = `${bold ? 700 : 400} ${size}px 'Noto Sans SC','Microsoft YaHei',Arial,sans-serif`; ctx.fillStyle = color; ctx.fillText(value, x, y); };
  const ellipsis = (value: string, max: number) => { let s = value; while (ctx.measureText(s).width > max && s.length > 1) s = s.slice(0, -1); return s === value ? s : `${s}…`; };
  const start = (title: string) => { ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, width, height); text("CARGOFIT · LOADING GUIDE", 100, 95, 26, true, "#2c8390"); text(title, 100, 164, 46, true); text(`${result.container.name} · ${result.engineVersion} · ${new Date(result.createdAt).toLocaleDateString()}`, 100, 216, 25); ctx.strokeStyle = "#d9e7ea"; ctx.beginPath(); ctx.moveTo(100, 247); ctx.lineTo(1700, 247); ctx.stroke(); };
  const finish = async () => { text(`${t("页", "Page")} ${pages.length + 1} · X/Y/Z: mm · kg`, 100, height - 60, 24); const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error("PDF 图像生成失败。")), "image/jpeg", 0.95)); pages.push({ jpeg: new Uint8Array(await blob.arrayBuffer()), width, height }); };
  start(t("装柜方案与执行概览", "Load plan and execution overview"));
  const m = result.metrics; const remaining = Math.max(0, m.effectiveVolume - m.loadedVolume) / 1e9;
  [[t("装入数量", "Loaded items"), String(m.loadedCount)], [t("体积利用率", "Volume utilization"), `${(m.volumeUtilization * 100).toFixed(1)}%`], [t("剩余容积", "Remaining volume"), `${remaining.toFixed(2)} m³`], [t("已装重量", "Loaded weight"), `${m.grossWeight.toLocaleString()} kg`]].forEach(([label, value], i) => { const x = 100 + i * 410; ctx.fillStyle = "#f0f7f8"; ctx.fillRect(x, 295, 380, 165); text(label, x + 24, 343, 26); text(value, x + 24, 410, 40, true); });
  const projections = [ ["top", t("俯视图", "Top view")], ["side", t("侧视图", "Side view")], ["door", t("箱门图", "Door view")] ] as const;
  projections.forEach(([view, label], i) => { const y = 535 + i * 520; text(label, 100, y, 32, true); const l = result.container.length - result.clearance * 2, w = result.container.width - result.clearance * 2, h = result.container.height - result.clearance; const extentX = view === "door" ? w : l, extentY = view === "top" ? w : h; const scale = Math.min(1580 / extentX, 405 / extentY); const x0 = 100, y0 = y + 35; ctx.strokeStyle = "#6a919b"; ctx.strokeRect(x0, y0, extentX * scale, extentY * scale);
    const boxes = [...palletAnchors(result.pallets??[]), ...result.placements].sort((a, b) => view === "top" ? a.z - b.z : view === "side" ? a.y - b.y : a.x - b.x);
    boxes.forEach(b => { const x = view === "door" ? b.y : b.x, dy = view === "top" ? b.y : extentY - b.z - b.dz, dx = view === "door" ? b.dy : b.dx, dz = view === "top" ? b.dy : b.dz; ctx.fillStyle = b.color; ctx.fillRect(x0 + x * scale, y0 + dy * scale, dx * scale, dz * scale); ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 1; ctx.strokeRect(x0 + x * scale, y0 + dy * scale, dx * scale, dz * scale); });
  });
  text(t("先装柜内，再向柜门推进；下层支撑先于上层箱。", "Load the nose first, then advance toward the door. Load supports before upper cargo."), 100, 2210, 26);
  text(t("尺寸、门洞、包装承重与现场操作请按当前输入核对。", "Confirm dimensions, door clearance, packaging strength and handling against entered rules."), 100, 2260, 26);
  await finish();
  for (let startAt = 0; startAt < result.summaries.length; startAt += 28) { start(t("货物清单", "Cargo manifest")); const columns = [100, 630, 990, 1260]; ["SKU", t("需求 / 已装", "Requested / loaded"), t("重量 kg", "Weight kg"), t("体积 m³", "Volume m³")].forEach((v, i) => text(v, columns[i], 310, 27, true)); result.summaries.slice(startAt, startAt + 28).forEach((s, i) => { const y = 375 + i * 64; text(ellipsis(s.sku, 495), columns[0], y, 26); text(`${s.requested} / ${s.loaded}`, columns[1], y, 26); text(s.loadedWeight.toFixed(1), columns[2], y, 26); text((s.loadedVolume / 1e9).toFixed(3), columns[3], y, 26); }); await finish(); }
  for(let startAt=0;startAt<(result.pallets?.length??0);startAt+=28){start(t("底层托盘铺设与自重","Floor pallet layout and tare"));text(t("先铺设托盘；货物 Z 已包含底座高度，勿再次加高。","Place pallets first. Cargo Z already includes the base height."),100,310,27,true);result.pallets!.slice(startAt,startAt+28).forEach((p,i)=>{const y=390+i*64;text(`${p.id} · ${p.name}`,100,y,25);text(`${p.x} / ${p.y} / ${p.z}`,700,y,25);text(`${p.dx} × ${p.dy} × ${p.dz}`,1100,y,25);text(`${p.weight} kg`,1530,y,25);});await finish();}
  for (let startAt = 0; startAt < result.placements.length; startAt += 32) { start(t("逐箱装载顺序与坐标", "Loading sequence and coordinates")); text("#     SKU                         X / Y / Z                        L × W × H                  ↑    Layer", 100, 310, 25, true); result.placements.slice(startAt, startAt + 32).forEach((b, i) => { const y = 375 + i * 58; text(String(startAt + i + 1), 100, y, 24); text(ellipsis(b.sku, 380), 200, y, 24); text(`${b.x.toFixed(0)} / ${b.y.toFixed(0)} / ${b.z.toFixed(0)}`, 600, y, 24); text(`${b.dx} × ${b.dy} × ${b.dz}`, 1100, y, 24); text(`${b.orientation}  ${b.layer}`, 1520, y, 24); }); await finish(); }
  if (result.warnings.length) { start(t("装载规则与复核提示", "Rules and review notes")); let y = 320; ctx.font = "28px 'Noto Sans SC','Microsoft YaHei',Arial,sans-serif"; for (const warning of result.warnings) { const chars = [...warning]; let line = ""; for (const char of chars) { if (ctx.measureText(line + char).width > 1520) { text(line, 120, y, 28); y += 45; line = ""; } if (y > 2350) { await finish(); start(t("复核提示（续）", "Review notes (continued)")); y = 320; } line += char; } text(`• ${line}`, 100, y, 28); y += 80; } await finish(); }
  const bytes = buildRasterPdf(pages); const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/pdf" })); const a = document.createElement("a"); a.href = url; a.download = `CargoFit_${result.container.id}_guide.pdf`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 10000);
}
