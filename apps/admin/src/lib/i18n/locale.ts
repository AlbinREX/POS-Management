/**
 * Locale identity and per-device persistence.
 *
 * Albanian is the default because the restaurant runs in Kosovo; English is available
 * for anyone who prefers it. The choice belongs to the device, not the account: a POS
 * terminal, a waiter's phone and the kitchen display are often used by different people
 * and should each keep the language their operator set.
 */
export const LOCALES = ['sq', 'en'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'sq';

/** Names are shown in their own language, which is how people recognise them. */
export const LOCALE_NAMES: Record<Locale, string> = { sq: 'Shqip', en: 'English' };

/** BCP 47 tags for date formatting; the app's own codes stay short. */
export const LOCALE_TAGS: Record<Locale, string> = { sq: 'sq-AL', en: 'en-GB' };

const STORAGE_KEY = 'riza.locale';

export const isLocale = (value: unknown): value is Locale =>
  typeof value === 'string' && (LOCALES as readonly string[]).includes(value);

/**
 * The locale for this device, or null when nothing usable is stored.
 *
 * Storage can throw in a private window or when site data is blocked, and the language
 * of the interface must never be the reason the app fails to start.
 */
export function readStoredLocale(): Locale | null {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return isLocale(stored) ? stored : null;
  } catch {
    return null;
  }
}

export function writeStoredLocale(locale: Locale): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    // A device that cannot persist the choice still honours it for this session.
  }
}

/**
 * Resolve the locale for a fresh load: an explicit `?lang=` wins, then the stored
 * device choice, then Albanian. The query parameter exists so support staff and the
 * browser tests can pin a language without touching stored state.
 */
export function resolveInitialLocale(search?: string): Locale {
  const fromQuery = new URLSearchParams(search ?? '').get('lang');
  if (isLocale(fromQuery)) return fromQuery;
  return readStoredLocale() ?? DEFAULT_LOCALE;
}
