import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  applyMessageParams,
  detectUiLocale,
  resolveLocaleMessage,
  type MessageKey,
  type UiLocale,
  UI_LOCALE_STORAGE_KEY,
} from './i18n/runtime';
export type { MessageKey, UiLocale } from './i18n/runtime';

function getInitialLocale(): UiLocale {
  return detectUiLocale();
}

interface I18nContextValue {
  locale: UiLocale;
  isZh: boolean;
  setLocale: (locale: UiLocale) => void;
  t: (key: MessageKey, params?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<UiLocale>(getInitialLocale);
  const isZh = locale === 'zh-CN';

  const setLocale = useCallback((next: UiLocale) => {
    setLocaleState(next);
  }, []);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(UI_LOCALE_STORAGE_KEY, locale);
    }
    if (typeof document !== 'undefined') {
      document.documentElement.lang = locale;
    }
  }, [locale]);

  const t = useCallback(
    (key: MessageKey, params?: Record<string, string | number>) => {
      return applyMessageParams(resolveLocaleMessage(key, locale), params);
    },
    [locale],
  );

  const value = useMemo<I18nContextValue>(
    () => ({ locale, isZh, setLocale, t }),
    [locale, isZh, setLocale, t],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error('useI18n must be used within I18nProvider');
  }
  return ctx;
}

export function localeForDateTime(locale: UiLocale): string {
  return locale === 'zh-CN' ? 'zh-CN' : 'en-US';
}
