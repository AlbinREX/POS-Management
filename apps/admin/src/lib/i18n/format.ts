/**
 * Locale-aware date and time formatting.
 *
 * Dates previously followed the browser's locale, which would ignore the language the
 * operator chose in the app. They now follow the active locale instead.
 *
 * Money is deliberately absent from this file. Amounts arrive from the API as exact
 * decimal strings and are rendered verbatim; passing them through a number formatter
 * would introduce float rounding and a locale-dependent decimal separator into values
 * that must stay exact and must match what the server stored.
 */
import { LOCALE_TAGS, type Locale } from './locale';

export function formatDateTime(value: string | Date | null | undefined, locale: Locale): string {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(LOCALE_TAGS[locale]);
}

export function formatDate(value: string | Date | null | undefined, locale: Locale): string {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(LOCALE_TAGS[locale]);
}
