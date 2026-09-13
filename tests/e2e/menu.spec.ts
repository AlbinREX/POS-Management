import { expect, test } from '@playwright/test';

test('configure all catalog types, edit a product, inspect audit and archive through the admin', async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await page.getByLabel('Organization', { exact: true }).fill('verification');
  await page.getByLabel('Branch code').fill('main');
  await page.getByLabel('Email', { exact: true }).fill(process.env.SEED_OWNER_EMAIL!);
  await page.getByLabel('Password', { exact: true }).fill(process.env.SEED_OWNER_PASSWORD!);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  const prefix = `Browser ${info.project.name}`;
  async function start(tab: string, singular: string, suffix: string) {
    await page
      .getByRole('navigation', { name: 'Menu catalog' })
      .getByRole('button', { name: tab, exact: true })
      .click();
    await page.getByRole('button', { name: `Add ${singular}`, exact: true }).click();
    await page.getByLabel('Name', { exact: true }).fill(`${prefix} ${suffix}`);
  }
  async function save() {
    await page.getByRole('button', { name: 'Save entry', exact: true }).click();
    await expect(page.getByRole('form', { name: 'Catalog editor' })).toHaveCount(0);
    await expect(page.getByText('Catalog saved.', { exact: true })).toBeVisible();
  }
  await start('Categories', 'category', 'category');
  await save();
  await start('Kitchen stations', 'kitchen station', 'station');
  await save();
  await start('Modifier groups', 'modifier group', 'group');
  await page.getByLabel('Minimum selections').fill('1');
  await save();
  await start('Modifiers', 'modifier', 'option');
  await page
    .getByLabel('Modifier group', { exact: true })
    .selectOption({ label: `${prefix} group` });
  await page.getByLabel('Price adjustment').fill('0.50');
  await save();
  await start('Products', 'product', 'product');
  await page.getByLabel('SKU', { exact: true }).fill(`BROWSER-${info.project.name}`);
  await page.getByLabel('Category', { exact: true }).selectOption({ label: `${prefix} category` });
  await page.getByLabel('Selling price (branch currency)').fill('5.50');
  await page.getByLabel('Tax rate (%)').fill('0.00');
  await page.getByLabel('Price tax mode').selectOption('INCLUSIVE');
  await page.getByLabel(`${prefix} group`, { exact: true }).check();
  await page.getByLabel(`${prefix} station`, { exact: true }).check();
  await page.screenshot({ path: `.local/${info.project.name}-menu-editor.png`, fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await save();
  await page.getByRole('button', { name: `Edit ${prefix} product`, exact: true }).click();
  await expect(page.getByLabel(`${prefix} group`, { exact: true })).toBeChecked();
  await expect(page.getByLabel(`${prefix} station`, { exact: true })).toBeChecked();
  await page.getByLabel('Selling price (branch currency)').fill('6.00');
  await save();
  await expect(page.getByText(/Price 6.00/)).toBeVisible();
  await page.getByRole('button', { name: 'Audit history', exact: true }).click();
  await expect(
    page.getByRole('cell', { name: 'menu.products.updated', exact: true }).first(),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  for (const [tab, suffix] of [
    ['Products', 'product'],
    ['Modifiers', 'option'],
    ['Modifier groups', 'group'],
    ['Kitchen stations', 'station'],
    ['Categories', 'category'],
  ]) {
    await page
      .getByRole('navigation', { name: 'Menu catalog' })
      .getByRole('button', { name: tab, exact: true })
      .click();
    await page.getByRole('button', { name: `Edit ${prefix} ${suffix}`, exact: true }).click();
    await page.getByRole('button', { name: 'Archive entry', exact: true }).click();
    await page.getByRole('button', { name: 'Confirm archive', exact: true }).click();
    await expect(page.getByRole('form', { name: 'Catalog editor' })).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: `Edit ${prefix} ${suffix}`, exact: true }),
    ).toHaveCount(0);
  }
  await page.getByLabel('Show archived').check();
  await expect(page.getByText(`${prefix} category`, { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  expect(errors).toEqual([]);
});
