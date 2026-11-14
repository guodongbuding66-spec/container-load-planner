export type ShippingMark = { text?: string; image?: string };

export const MARK_TEXT_LIMIT = 240;
export const MARK_IMAGE_LIMIT = 120_000;
export const MARK_ASPECT = 2;

export function parseShippingMark(value: unknown): ShippingMark | undefined {
  if (value === undefined) return;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("箱标资料无效 / Invalid shipping mark");
  const { text, image } = value as ShippingMark;
  if (text !== undefined && (typeof text !== "string" || text.length > MARK_TEXT_LIMIT)) {
    throw new Error("唛头文字过长 / Shipping mark text is too long");
  }
  if (image !== undefined && (typeof image !== "string" || image.length > MARK_IMAGE_LIMIT ||
    !/^data:image\/(?:png;base64,iVBORw0KGgo|jpeg;base64,\/9j\/|webp;base64,UklGR)[A-Za-z0-9+/]+={0,2}$/.test(image))) {
    throw new Error("箱标图片无效 / Invalid shipping mark image");
  }
  const cleanText = text?.trim();
  return cleanText || image ? { ...(cleanText ? { text: cleanText } : {}), ...(image ? { image } : {}) } : undefined;
}

export function markLines(text: string) {
  return text.trim().split(/\r?\n/).filter(line => line.trim()).slice(0, 6);
}
