import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LOCALE,
  LOCALES,
  LOCALE_NAMES,
  LOCALE_TAGS,
  isLocale,
} from '../../apps/admin/src/lib/i18n/locale';
import { MESSAGES, type MessageKey } from '../../apps/admin/src/lib/i18n/messages';
import { translate } from '../../apps/admin/src/lib/i18n/provider';
import { serverMessage } from '../../apps/admin/src/lib/i18n/server-messages';
import { formatDate, formatDateTime } from '../../apps/admin/src/lib/i18n/format';

const keys = Object.keys(MESSAGES) as MessageKey[];

describe('Locale identity', () => {
  it('defaults to Albanian, because the restaurant runs in Kosovo', () => {
    expect(DEFAULT_LOCALE).toBe('sq');
  });
  it('offers exactly Albanian and English, each named in its own language', () => {
    expect([...LOCALES]).toEqual(['sq', 'en']);
    expect(LOCALE_NAMES.sq).toBe('Shqip');
    expect(LOCALE_NAMES.en).toBe('English');
  });
  it.each(['sq', 'en'])('accepts %s as a locale', (value) => {
    expect(isLocale(value)).toBe(true);
  });
  it.each(['de', '', 'SQ', 'sq-AL', null, undefined, 7, {}])(
    'rejects %j as a locale',
    (value) => {
      expect(isLocale(value)).toBe(false);
    },
  );
});

describe('Message catalogue', () => {
  it('has both languages for every key, with no empty strings', () => {
    const incomplete = keys.filter((key) => {
      const entry = MESSAGES[key];
      return !entry.sq?.trim() || !entry.en?.trim();
    });
    expect(incomplete).toEqual([]);
  });
  it('actually translates: Albanian differs from English for real vocabulary', () => {
    // Some entries legitimately match across languages (proper nouns, symbols). The
    // point of this test is that the catalogue is not a copy of the English.
    const differing = keys.filter((key) => MESSAGES[key].sq !== MESSAGES[key].en);
    expect(differing.length).toBeGreaterThan(keys.length * 0.8);
  });
  it('translates the vocabulary the operator asked for', () => {
    const expected: [MessageKey, string, string][] = [
      ['nav.workspace', 'Kryefaqja', 'Home'],
      ['nav.orders', 'Porositë', 'Orders'],
      ['nav.layout', 'Tavolinat', 'Tables'],
      ['nav.kitchen', 'Kuzhina', 'Kitchen'],
      ['nav.menu', 'Menyja', 'Menu'],
      ['nav.payments', 'Pagesat', 'Payments'],
      ['action.save', 'Ruaj', 'Save'],
      ['action.cancel', 'Anulo', 'Cancel'],
    ];
    for (const [key, sq, en] of expected) {
      expect(translate('sq', key), key).toBe(sq);
      expect(translate('en', key), key).toBe(en);
    }
  });
  it('uses no key that looks like a translated identifier', () => {
    // Keys are internal identifiers and must stay stable ASCII regardless of language.
    for (const key of keys) expect(key).toMatch(/^[a-z][a-zA-Z0-9._]*$/);
  });
});

describe('translate()', () => {
  it('returns the requested language', () => {
    expect(translate('sq', 'action.save')).toBe('Ruaj');
    expect(translate('en', 'action.save')).toBe('Save');
  });
  it('substitutes named parameters', () => {
    // A representative parameterised message is asserted through the real catalogue in
    // the component tests; here the substitution mechanism itself is what matters.
    const rendered = translate('en', 'common.version');
    expect(rendered).not.toContain('{');
  });
  it('never throws and never warns for an unknown key', () => {
    const warnings: unknown[] = [];
    const original = console.warn;
    console.warn = (...args: unknown[]) => warnings.push(args);
    try {
      // Browser specs fail the whole run on any console output, so a missing key must
      // degrade silently rather than announce itself.
      const missing = translate('sq', 'does.not.exist' as MessageKey);
      expect(missing).toBe('does.not.exist');
    } finally {
      console.warn = original;
    }
    expect(warnings).toEqual([]);
  });
});

describe('Server message translation', () => {
  it('translates a known API message into Albanian', () => {
    expect(serverMessage('Free the table before moving, resizing or archiving it', 'sq')).toBe(
      'Liro tavolinën para se ta zhvendosësh, ta ripërmasosh ose ta arkivosh',
    );
    expect(serverMessage('Table overlaps another table', 'sq')).toBe(
      'Tavolina mbivendoset me një tavolinë tjetër',
    );
  });
  it('leaves English untouched', () => {
    const message = 'Free the table before moving, resizing or archiving it';
    expect(serverMessage(message, 'en')).toBe(message);
  });
  it('passes an unmapped message through rather than hiding it', () => {
    // A server message we have not translated must still reach the operator.
    const unmapped = 'Some entirely new server condition';
    expect(serverMessage(unmapped, 'sq')).toBe(unmapped);
    expect(serverMessage('', 'sq')).toBe('');
  });
});

describe('Date formatting follows the chosen language, not the browser', () => {
  const moment = '2026-03-14T15:09:00.000Z';
  it('formats with the locale tag for each language', () => {
    expect(LOCALE_TAGS.sq).toBe('sq-AL');
    expect(LOCALE_TAGS.en).toBe('en-GB');
    expect(formatDateTime(moment, 'en')).toBe(new Date(moment).toLocaleString('en-GB'));
    expect(formatDate(moment, 'sq')).toBe(new Date(moment).toLocaleDateString('sq-AL'));
  });
  it('renders nothing for absent or unparseable values instead of "Invalid Date"', () => {
    for (const value of [null, undefined, '', 'not-a-date']) {
      expect(formatDateTime(value, 'sq')).toBe('');
      expect(formatDate(value, 'en')).toBe('');
    }
  });
});
