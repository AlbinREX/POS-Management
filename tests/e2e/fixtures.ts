import { test as base, expect } from '@playwright/test';

// Existing operational regressions run in English. Dedicated i18n specs exercise
// the unmodified Albanian default and both languages without this fixture.
export const test = base.extend({
  page: async ({ page }, use) => {
    await page.addInitScript(() => {
      if (!localStorage.getItem('riza.locale')) localStorage.setItem('riza.locale', 'en');
    });
    await use(page);
  },
});
export { expect };
export { request, type Page } from '@playwright/test';
