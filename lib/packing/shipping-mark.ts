import { isMarkImage, parseMarkArtwork, type MarkArtwork } from "./shipping-mark-artwork";

export type ShippingMark = { text?: string; image?: string; artwork?: MarkArtwork };
export { MARK_IMAGE_LIMIT } from "./shipping-mark-artwork";

export const MARK_TEXT_LIMIT = 240;
export const MARK_ASPECT = 2;

export function parseShippingMark(value: unknown): ShippingMark | undefined {
  if (value === undefined) return;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("箱标资料无效 / Invalid shipping mark");
  const { text, image, artwork } = value as ShippingMark;
  if (text !== undefined && (typeof text !== "string" || text.length > MARK_TEXT_LIMIT)) {
    throw new Error("唛头文字过长 / Shipping mark text is too long");
  }
  if (image !== undefined && !isMarkImage(image)) {
    throw new Error("箱标图片无效 / Invalid shipping mark image");
  }
  if (artwork !== undefined) {
    const parsed = parseMarkArtwork(artwork);
    if(parsed.front.elements.length || parsed.side.elements.length) return {artwork:parsed};
  }
  const cleanText = text?.trim();
  return cleanText || image ? { ...(cleanText ? { text: cleanText } : {}), ...(image ? { image } : {}) } : undefined;
}

export function markLines(text: string) {
  return text.trim().split(/\r?\n/).filter(line => line.trim()).slice(0, 6);
}
