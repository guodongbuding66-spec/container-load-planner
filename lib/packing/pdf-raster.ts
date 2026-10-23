export type RasterPage = { jpeg: Uint8Array; width: number; height: number };
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
