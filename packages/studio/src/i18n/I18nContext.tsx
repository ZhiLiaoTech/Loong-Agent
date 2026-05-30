import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  LOCALE_CHANGE_EVENT,
  LOCALE_STORAGE_KEY,
  getMessages,
  normalizeLocale,
  readStoredLocale,
  resolveMessage,
} from "./resolve.js";
import type { Locale } from "./types.js";

export interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: string) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

function applyDocumentLocale(locale: Locale): void {
  if (typeof document !== "undefined") {
    document.documentElement.lang = locale === "zh-CN" ? "zh-CN" : "en";
  }
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => readStoredLocale());

  useEffect(() => {
    applyDocumentLocale(locale);
  }, [locale]);

  const setLocale = useCallback((next: Locale) => {
    const normalized = normalizeLocale(next);
    setLocaleState(normalized);
    try {
      window.localStorage.setItem(LOCALE_STORAGE_KEY, normalized);
    } catch {
      // ignore
    }
    applyDocumentLocale(normalized);
    window.dispatchEvent(new CustomEvent(LOCALE_CHANGE_EVENT, { detail: { locale: normalized } }));
  }, []);

  const value = useMemo((): I18nContextValue => {
    const messages = getMessages(locale);
    return {
      locale,
      setLocale,
      t: (key: string) => resolveMessage(messages, key),
    };
  }, [locale, setLocale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error("useI18n must be used within I18nProvider");
  }
  return context;
}
