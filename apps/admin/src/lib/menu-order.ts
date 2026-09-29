import type { MenuRecord } from '@restaurant/shared-types';

/**
 * The order products appear in on the POS: categories in their configured order, then,
 * within each category, featured products first, then the configured sortOrder, then
 * name. Featured is a display preference only; nothing about price or availability is
 * read or changed here.
 */
export function posProductOrder(products: MenuRecord[], categories: MenuRecord[]): MenuRecord[] {
  const rank = new Map(categories.map((category, index) => [category.id, index]));
  const place = (p: MenuRecord) => rank.get(p.categoryId ?? '') ?? Number.MAX_SAFE_INTEGER;
  return [...products].sort(
    (a, b) =>
      place(a) - place(b) ||
      Number(Boolean(b.featured)) - Number(Boolean(a.featured)) ||
      a.sortOrder - b.sortOrder ||
      a.name.localeCompare(b.name),
  );
}
