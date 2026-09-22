'use client';

import { LOCALES, LOCALE_NAMES, useI18n } from '../lib/i18n';

/**
 * Shqip / English, shown in the header so it is reachable from the POS, the waiter
 * surface and the kitchen display alike.
 *
 * Each language is named in itself, which is how someone recognises their own language
 * without having to read the other one first. Switching is instant: the choice lives in
 * React state, so there is no reload and no flash of the previous language.
 */
export function LanguageSwitcher() {
  const { locale, setLocale, t } = useI18n();
  return (
    <div
      className="language-switcher"
      role="group"
      aria-label={t('shell.language')}
      data-testid="language-switcher"
    >
      {LOCALES.map((code) => (
        <button
          key={code}
          type="button"
          lang={code}
          data-testid={`language-${code}`}
          aria-pressed={locale === code}
          onClick={() => setLocale(code)}
        >
          {LOCALE_NAMES[code]}
        </button>
      ))}
    </div>
  );
}
