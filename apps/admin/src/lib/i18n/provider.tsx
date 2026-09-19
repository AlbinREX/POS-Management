'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { MESSAGES, type MessageKey } from './messages';
import {
  DEFAULT_LOCALE,
  LOCALE_TAGS,
  resolveInitialLocale,
  writeStoredLocale,
  type Locale,
} from './locale';

export type Translate = (key: MessageKey, params?: Record<string, string | number>) => string;

type I18nValue = { locale: Locale; setLocale: (locale: Locale) => void; t: Translate };

const I18nContext = createContext<I18nValue | null>(null);

/** Substitute `{name}` placeholders; an absent parameter leaves the token visible. */
function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (token, name: string) =>
    name in params ? String(params[name]) : token,
  );
}

export function translate(
  locale: Locale,
  key: MessageKey,
  params?: Record<string, string | number>,
): string {
  const entry = MESSAGES[key];
  // A key missing from the catalogue cannot be a thrown error or a console warning:
  // several browser specs fail the run on any console output, and a missing phrase
  // must never take down a till mid-service. Fall back to English, then to the key.
  if (!entry) return key;
  return interpolate(entry[locale] ?? entry.en ?? key, params);
}

export function LocaleProvider({ children }: { children: ReactNode }) {
  // Render the default first so the server and the first client paint agree; the stored
  // choice is applied immediately afterwards, before the user can read the page.
  const [locale, setLocaleState] = useState<Locale>(DEFAULT_LOCALE);

  useEffect(() => {
    const initial = resolveInitialLocale(window.location.search);
    if (initial !== DEFAULT_LOCALE) setLocaleState(initial);
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    writeStoredLocale(next);
  }, []);

  const value = useMemo<I18nValue>(
    () => ({
      locale,
      setLocale,
      t: (key, params) => translate(locale, key, params),
    }),
    [locale, setLocale],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const value = useContext(I18nContext);
  // Falling back to the default keeps a component usable outside a provider, which
  // matters for isolated rendering rather than being a silent misconfiguration.
  if (!value)
    return {
      locale: DEFAULT_LOCALE,
      setLocale: () => {},
      t: (key, params) => translate(DEFAULT_LOCALE, key, params),
    };
  return value;
}

/** The BCP 47 tag for the active locale, for date and time formatting. */
export const localeTag = (locale: Locale) => LOCALE_TAGS[locale];
