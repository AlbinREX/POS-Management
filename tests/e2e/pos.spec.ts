import { expect, test } from './fixtures';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

test('Riza POS preserves order commands, modifiers, totals and payment navigation', async ({
  page,
}, info) => {
  test.setTimeout(90000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await page.getByLabel('Organization', { exact: true }).fill('verification');
  await page.getByLabel('Branch code').fill('main');
  await page.getByLabel('Email', { exact: true }).fill(process.env.SEED_OWNER_EMAIL!);
  await page.getByLabel('Password', { exact: true }).fill(process.env.SEED_OWNER_PASSWORD!);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Home', exact: true })).toBeVisible();
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  const login = await page.request.post('/api/auth/login', {
    headers: { Origin: process.env.APP_ORIGIN ?? 'http://localhost:3000' },
    data: {
      organization: 'verification',
      branch: 'main',
      email: process.env.SEED_OWNER_EMAIL,
      password: process.env.SEED_OWNER_PASSWORD,
    },
  });
  expect(login.status()).toBe(200);
  const headers = {
    Origin: process.env.APP_ORIGIN ?? 'http://localhost:3000',
    Authorization: 'Bearer ' + (await login.json()).accessToken,
  };
  const create = async (path: string, data: unknown) => {
    const response = await page.request.post('/api/' + path, { headers, data });
    expect(response.status(), path).toBe(201);
    return response.json();
  };
  const prefix = `Riza ${info.project.name}`;
  // Deterministic image fixtures stay inside the isolated browser environment.
  await page.route('**/qa/catalog-image.svg', (route) =>
    route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="#292b2f"/><circle cx="40" cy="40" r="22" fill="none" stroke="#f4c451" stroke-width="2"/></svg>',
    }),
  );
  await page.route('**/qa/unavailable-image.png', (route) =>
    route.fulfill({ contentType: 'image/png', body: 'invalid image fixture' }),
  );
  const category = await create('menu/categories', { kind: 'categories', name: prefix });
  const group = await create('menu/modifier-groups', {
    kind: 'modifier-groups',
    name: prefix + ' extras',
    minSelections: 1,
    maxSelections: 1,
  });
  await create('menu/modifiers', {
    kind: 'modifiers',
    groupId: group.id,
    name: prefix + ' cheese',
    priceAdjustment: '0.50',
  });
  const product = await create('menu/products', {
    kind: 'products',
    name: prefix + ' burger',
    description: 'Grilled patty, crisp lettuce and house sauce.',
    imageUrl: (process.env.APP_ORIGIN ?? 'http://localhost:3000') + '/qa/catalog-image.svg',
    sku: prefix + '-burger',
    categoryId: category.id,
    sellingPrice: '5.50',
    taxRate: '20.00',
    taxMode: 'INCLUSIVE',
    modifierGroupIds: [group.id],
    kitchenStationIds: [],
  });
  for (const [name, description] of [
    ['Chicken wrap', 'Grilled chicken and fresh salad in a warm wrap.'],
    ['Margherita', 'Tomato, mozzarella and basil.'],
    ['Golden fries', 'Crisp fries, seasoned to order.'],
    ['Fresh lemonade', 'Lemon and chilled sparkling water.'],
    ['Chocolate brownie', 'A rich chocolate finish.'],
  ]) {
    await create('menu/products', {
      kind: 'products',
      name: prefix + ' ' + name,
      description,
      ...(name === 'Chicken wrap'
        ? {
            imageUrl:
              (process.env.APP_ORIGIN ?? 'http://localhost:3000') + '/qa/unavailable-image.png',
          }
        : {}),
      sku: prefix + '-' + name,
      categoryId: category.id,
      sellingPrice: '4.00',
      taxRate: '20.00',
      taxMode: 'INCLUSIVE',
      modifierGroupIds: [],
      kitchenStationIds: [],
    });
  }
  await page.getByRole('button', { name: 'POS', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: "What's on the menu?", exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Create draft', exact: true }).click();
  const current = page.getByRole('region', { name: 'Current order', exact: true });
  await expect(current.getByText('DRAFT', { exact: true })).toBeVisible();
  await expect(current.getByRole('button', { name: 'Delivery', exact: true })).toBeDisabled();
  await expect(current.getByRole('button', { name: 'Cash', exact: true })).toBeDisabled();
  await page
    .getByRole('group', { name: 'Product categories' })
    .getByRole('button', { name: prefix, exact: true })
    .click();
  await expect(page.locator('.product-card')).toHaveCount(6);
  await expect(
    page.getByLabel(`No image for ${prefix} Chicken wrap`, { exact: true }),
  ).toBeVisible();
  await page.getByLabel('Search the menu', { exact: true }).fill('burger');
  await expect(page.locator('.product-card')).toHaveCount(1);
  await expect
    .poll(() =>
      page
        .getByRole('img', { name: product.name, exact: true })
        .evaluate((image) => (image as HTMLImageElement).naturalWidth),
    )
    .toBe(80);
  await page.getByRole('button', { name: `Increase ${product.name}`, exact: true }).click();
  await page.getByRole('button', { name: `Customize ${product.name}`, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Customize product' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('New item quantity')).toHaveValue('2');
  await dialog.getByLabel(prefix + ' cheese · 0.50', { exact: true }).check();
  await dialog.getByLabel('New item notes').fill('No onion');
  await dialog.getByRole('button', { name: 'Add to order', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId('order-total')).toHaveText('12.00 EUR');
  await expect(current.getByText('No onion', { exact: true })).toBeVisible();
  await current
    .locator('summary')
    .filter({ hasText: /^Order options$/ })
    .click();
  await current.getByLabel('Discount amount (EUR, gross)').fill('2.00');
  await current.getByLabel('Discount reason', { exact: true }).fill('POS regression courtesy');
  await current.getByRole('button', { name: 'Apply discount', exact: true }).click();
  await expect(page.getByTestId('order-total')).toHaveText('10.00 EUR');
  await current
    .locator('summary')
    .filter({ hasText: /^Order options$/ })
    .click();
  await page.getByLabel('Search the menu', { exact: true }).fill('');
  await page.screenshot({
    path: join(tmpdir(), `riza-pos-${info.project.name}.png`),
    fullPage: true,
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  if (info.project.name === 'desktop') {
    const size = page.viewportSize()!;
    await page.setViewportSize({ width: 1024, height: 768 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: join(tmpdir(), 'riza-pos-tablet.png'), fullPage: true });
    await page.setViewportSize(size);
  }
  await current.getByRole('button', { name: 'Place Order', exact: true }).click();
  await expect(current.getByText('OPEN', { exact: true })).toBeVisible();
  // Placing a draft does not automatically submit it to the kitchen or collect payment.
  await expect(current.getByRole('button', { name: 'Send to kitchen', exact: true })).toBeVisible();
  await current.getByRole('button', { name: 'Request payment', exact: true }).click();
  await expect(current.getByText('WAITING PAYMENT', { exact: true })).toBeVisible();
  const orderNumber = (await current.getByRole('heading', { level: 2 }).textContent())!;
  await current.getByRole('button', { name: 'Split', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Payments', exact: true })).toBeVisible();
  await expect(page.getByTestId('payment-due')).toHaveText('10.00');
  await expect(
    page.getByRole('heading', {
      name: `Bill ${orderNumber.replace('Order ', '')} · Takeaway`,
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByLabel('Cash amount', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('Card amount', { exact: true })).toHaveValue('');
  expect(errors).toEqual([]);
});
