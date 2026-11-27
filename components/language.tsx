"use client";
import { useSyncExternalStore } from "react";
import {
  getLanguageMeta,
  interpolateUi,
  isUiLanguage,
  SUPPORTED_LANGUAGES,
  translateDiagnostic,
  translateUi,
  type UiLanguage,
} from "../lib/packing/translate-ui";

export { SUPPORTED_LANGUAGES, type UiLanguage };
type Language = UiLanguage;
const listeners = new Set<() => void>();
let current: Language = "zh";
let initialized = false;
const notify = () => listeners.forEach(fn => fn());

function applyHtmlLang(language: Language) {
  if (typeof document !== "undefined" && document.documentElement) {
    document.documentElement.lang = getLanguageMeta(language).htmlLang;
  }
}

function initialize() {
  if (initialized || typeof window === "undefined") return;
  initialized = true;
  try {
    const saved = localStorage.getItem("cargo-fit-language");
    current = isUiLanguage(saved) ? saved : "zh";
  } catch {}
  applyHtmlLang(current);
  window.addEventListener("storage", e => {
    if (e.key === "cargo-fit-language") {
      current = isUiLanguage(e.newValue) ? e.newValue : "zh";
      applyHtmlLang(current);
      notify();
    }
  });
}

export function getAppLanguage(): Language { return current; }
export function setAppLanguage(language: Language) {
  initialize();
  current = isUiLanguage(language) ? language : "zh";
  applyHtmlLang(current);
  try { localStorage.setItem("cargo-fit-language", current); } catch {}
  notify();
}
const subscribe = (fn: () => void) => { listeners.add(fn); initialize(); return () => { listeners.delete(fn); }; };
export const useLanguage = () => useSyncExternalStore(subscribe, getAppLanguage, () => "zh" as Language);
export function AppLanguageTitle() {
  const language = useLanguage();
  return <title>{getLanguageMeta(language).title}</title>;
}
export function tr(value: string, english?: string) { return translateUi(value, current, english); }
export function tt(strings: TemplateStringsArray, ...values: unknown[]) { return interpolateUi(strings, values, current); }
export function trText(value: string) { return translateDiagnostic(value, current); }
export function trNode<T>(value: T): T | string { return typeof value === "string" ? tr(value) : value; }
