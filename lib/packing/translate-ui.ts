import { ENGLISH } from "./ui-language";
import {
  getLanguageMeta,
  isUiLanguage,
  SUPPORTED_LANGUAGES,
  translateLocaleFromEnglish,
  type LanguageOption,
  type UiLanguage,
} from "./ui-locales";

export { getLanguageMeta, isUiLanguage, SUPPORTED_LANGUAGES, type LanguageOption, type UiLanguage };

export function translateUi(value: string, language: UiLanguage, english?: string): string {
  if (language === "zh") return value;
  const trimmed = value.trim();
  const englishResolved = english !== undefined ? english : ENGLISH[trimmed];
  if (language === "en") {
    if (english !== undefined) return english;
    if (englishResolved === undefined) return value;
    return value.replace(trimmed, englishResolved);
  }
  const canonicalEn = (englishResolved ?? trimmed).trim();
  const localized = translateLocaleFromEnglish(canonicalEn, language);
  if (localized !== undefined) {
    return trimmed && value !== trimmed ? value.replace(trimmed, localized) : localized;
  }
  if (english !== undefined) return english;
  if (englishResolved !== undefined) return value.replace(trimmed, englishResolved);
  return value;
}

/** Translate the sentence, preserving interpolated numbers, SKUs and user data. */
export function interpolateUi(strings: readonly string[], values: readonly unknown[], language: UiLanguage): string {
  const key = strings.map((part, i) => part + (i < values.length ? `{${i}}` : "")).join("");
  const template = translateUi(key, language);
  return template.replace(/\{(\d+)\}/g, (token, index: string) => Number(index) < values.length ? String(values[Number(index)] ?? "") : token);
}

const diagnosticPatterns = Object.entries(ENGLISH)
  .filter(([key]) => /\{\d+\}/.test(key))
  .sort(([a], [b]) => b.length - a.length)
  .map(([key, english]) => {
    const indices: number[] = [];
    const escaped = key.split(/(\{\d+\})/).map(part => {
      const match = /^\{(\d+)\}$/.exec(part);
      if (match) { indices.push(Number(match[1])); return "([\\s\\S]*?)"; }
      return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }).join("");
    return { pattern: new RegExp(`^${escaped}$`), english, indices };
  });

/** Solver messages stay language-neutral in saved plans; localize on display. */
export function translateDiagnostic(value: string, language: UiLanguage, depth = 0): string {
  if (language === "zh" && value === "Cargo exceeds its loose or palletized allocation / 箱数超过散装或打托分配") return "箱数超过散装或打托分配";
  const exact = translateUi(value, language);
  if (language === "zh" || exact !== value || !/[\u3400-\u9fff]/.test(value) || depth > 3) return exact;
  for (const { pattern, english, indices } of diagnosticPatterns) {
    const match = pattern.exec(value);
    if (!match) continue;
    const values = new Map(indices.map((index, i) => [index, translateDiagnostic(match[i + 1], language, depth + 1)]));
    const localizedTemplate = translateLocaleFromEnglish(english, language) ?? english;
    return localizedTemplate.replace(/\{(\d+)\}/g, (token, index: string) => values.get(Number(index)) ?? token);
  }
  return value;
}
