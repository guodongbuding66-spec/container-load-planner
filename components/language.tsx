"use client";
import { useSyncExternalStore } from "react";
import { ENGLISH } from "../lib/packing/ui-language";
type Language = "zh" | "en";
const listeners = new Set<() => void>();
let current: Language = "zh";
let initialized = false;
const notify = () => listeners.forEach(fn => fn());
function initialize() {
  if (initialized || typeof window === "undefined") return;
  initialized = true;
  try { current = localStorage.getItem("cargo-fit-language") === "en" ? "en" : "zh"; } catch {}
  document.documentElement.lang = current === "en" ? "en" : "zh-CN";
  window.addEventListener("storage", e => { if (e.key === "cargo-fit-language") { current = e.newValue === "en" ? "en" : "zh"; document.documentElement.lang = current === "en" ? "en" : "zh-CN"; notify(); } });
}
export function getAppLanguage() { return current; }
export function setAppLanguage(language: Language) { initialize(); current = language; document.documentElement.lang = language === "en" ? "en" : "zh-CN"; try { localStorage.setItem("cargo-fit-language", language); } catch {} notify(); }
const subscribe = (fn: () => void) => { listeners.add(fn); initialize(); return () => { listeners.delete(fn); }; };
export const useLanguage = () => useSyncExternalStore(subscribe, getAppLanguage, () => "zh" as Language);
export function tr(value: string, english?: string) { return current === "en" ? english ?? (Object.hasOwn(ENGLISH, value) ? ENGLISH[value] : value) : value; }
export function trText(value: string) { return tr(value); }
export function trNode<T>(value: T): T | string { return typeof value === "string" ? tr(value) : value; }
