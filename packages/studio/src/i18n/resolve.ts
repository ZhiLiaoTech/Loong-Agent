import type { Locale, MessageTree } from "./types.js";
import { en } from "./locales/en.js";
import { zhCN } from "./locales/zh-CN.js";

export const LOCALE_STORAGE_KEY = "loong.locale";
export const LOCALE_CHANGE_EVENT = "loong:locale-change";

const catalogs: Record<Locale, MessageTree> = {
  en,
  "zh-CN": zhCN,
};

export function normalizeLocale(value: unknown): Locale {
  return value === "en" ? "en" : "zh-CN";
}

export function detectDefaultLocale(): Locale {
  if (typeof navigator === "undefined") {
    return "zh-CN";
  }
  const lang = navigator.language.toLowerCase();
  return lang.startsWith("zh") ? "zh-CN" : "en";
}

export function readStoredLocale(): Locale {
  if (typeof window === "undefined") {
    return detectDefaultLocale();
  }
  try {
    const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    if (stored) {
      return normalizeLocale(stored);
    }
  } catch {
    // ignore
  }
  return detectDefaultLocale();
}

export function getMessages(locale: Locale): MessageTree {
  return catalogs[locale];
}

export function resolveMessage(messages: MessageTree, key: string): string {
  const parts = key.split(".");
  let current: string | MessageTree = messages;
  for (const part of parts) {
    if (typeof current !== "object" || current === null || !(part in current)) {
      return key;
    }
    current = current[part] as string | MessageTree;
  }
  return typeof current === "string" ? current : key;
}
