import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

test('inventory operator configures stock, recovers a lost save, records waste and a sold recipe', async ({
  page,
}, info) => {
  test.setTimeout(90000);
  const errors: string[] = [];
  let networkTest = false;
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.getByLabel('Organization', { exact: true }).fill('verification');
  await page.getByLabel('Branch code').fill('main');
  await page.getByLabel('Email', { exact: true }).fill(process.env.SEED_OWNER_EMAIL!);
  await page.getByLabel('Password', { exact: true }).fill(process.env.SEED_OWNER_PASSWORD!);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('button', { name: 'Inventory', exact: true }).click();
  page.on('console', (m) => {
    if (m.type() === 'error' && !networkTest) errors.push(m.text());
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
  const post = async (path: string, body: unknown) => {
    const response = await page.request.post('/api/' + path, { headers, data: body });
    expect(response.status(), path).toBe(201);
    return response.json();
  };
  const prefix = `Inventory browser ${info.project.name}`;
  const views = page.getByRole('group', { name: 'Inventory views' });
  const dialog = page.getByRole('dialog', { name: 'Inventory editor' });
  await views.getByRole('button', { name: 'Warehouses', exact: true }).click();
  await page.getByRole('button', { name: 'Add warehouse', exact: true }).click();
  await dialog.getByLabel('Name', { exact: true }).fill(prefix + ' kitchen');
  await dialog.getByLabel('Description', { exact: true }).fill('Kitchen stock');
  await dialog.getByRole('button', { name: 'Save details' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('heading', { name: prefix + ' kitchen', exact: true })).toBeVisible();
  await views.getByRole('button', { name: 'Ingredients & items' }).click();
  await page.getByRole('button', { name: 'Add inventory item' }).click();
  await dialog.getByLabel('Name', { exact: true }).fill(prefix + ' chicken');
  await dialog.getByLabel('SKU', { exact: true }).fill('INV-UI-' + info.project.name);
  await dialog.getByLabel('Quantity unit', { exact: true }).selectOption('g');
  await dialog.getByRole('button', { name: 'Save details' }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole('button', { name: 'Adjust stock', exact: true }).click();
  await dialog
    .getByLabel('Warehouse', { exact: true })
    .selectOption({ label: prefix + ' kitchen' });
  await dialog
    .getByLabel('Inventory item', { exact: true })
    .selectOption({ label: prefix + ' chicken · g' });
  await dialog.getByLabel('Quantity change').fill('1');
  await dialog.getByLabel('Quantity unit', { exact: true }).selectOption('kg');
  await dialog.getByLabel('Reason', { exact: true }).fill('Opening stock');
  networkTest = true;
  await page.route(
    '**/api/inventory/movements',
    async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      await route.fetch();
      await route.abort('failed');
    },
    { times: 1 },
  );
  await dialog.getByRole('button', { name: 'Save adjustment' }).click();
  await expect(page.getByRole('button', { name: 'Retry inventory command' })).toBeAttached();
  await page.reload();
  await page.getByRole('button', { name: 'Inventory', exact: true }).click();
  await page.getByRole('button', { name: 'Retry inventory command' }).click();
  await expect(page.getByRole('button', { name: 'Retry inventory command' })).toHaveCount(0);
  networkTest = false;
  await page.getByLabel('Search inventory', { exact: true }).fill(prefix);
  const card = page.getByRole('article', {
    name: `Stock ${prefix} chicken at ${prefix} kitchen`,
    exact: true,
  });
  await expect(card.getByTestId('stock-quantity')).toHaveText('1000');
  await card.getByRole('button', { name: 'Edit alert' }).click();
  await dialog.getByLabel('Low-stock threshold', { exact: true }).fill('500');
  await dialog.getByRole('button', { name: 'Save low-stock alert' }).click();
  await expect(dialog).toHaveCount(0);
  await card.getByRole('button', { name: 'Waste', exact: true }).click();
  await dialog.getByLabel('Quantity wasted').fill('700');
  await dialog.getByLabel('Reason', { exact: true }).fill('Spoiled ingredient');
  await dialog.getByRole('button', { name: 'Save waste' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(card.getByTestId('stock-quantity')).toHaveText('300');
  await expect(card.getByText('Low stock', { exact: true })).toBeVisible();
  const category = await post('menu/categories', { kind: 'categories', name: prefix });
  const product = await post('menu/products', {
    kind: 'products',
    categoryId: category.id,
    name: prefix + ' burger',
    sku: prefix,
    sellingPrice: '5.00',
    taxRate: '0.00',
    taxMode: 'INCLUSIVE',
    modifierGroupIds: [],
    kitchenStationIds: [],
  });
  await views.getByRole('button', { name: 'Recipes', exact: true }).click();
  await page.getByRole('button', { name: 'Refresh inventory' }).click();
  await page.getByRole('button', { name: 'Create recipe' }).click();
  await expect(
    dialog
      .getByRole('combobox', { name: 'Product', exact: true })
      .locator(`option[value="${product.id}"]`),
  ).toHaveCount(1);
  await dialog.getByRole('combobox', { name: 'Product', exact: true }).selectOption(product.id);
  await dialog
    .getByLabel('Warehouse', { exact: true })
    .selectOption({ label: prefix + ' kitchen' });
  await dialog
    .getByLabel('Ingredient 1', { exact: true })
    .selectOption({ label: prefix + ' chicken' });
  await dialog.getByLabel('Recipe quantity 1').fill('0.150');
  await dialog.getByLabel('Recipe unit 1').selectOption('kg');
  await dialog.getByRole('button', { name: 'Save recipe', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('heading', { name: prefix + ' burger', exact: true })).toBeVisible();
  let order = await post('orders', { commandId: randomUUID(), type: 'TAKEAWAY' });
  for (const change of [
    { action: 'add_item', productId: product.id, quantity: 1, modifierIds: [], notes: '' },
    { action: 'status', status: 'OPEN' },
    { action: 'status', status: 'WAITING_PAYMENT' },
  ])
    order = await post(`orders/${order.id}/commands`, {
      commandId: randomUUID(),
      version: order.version,
      ...change,
    });
  await post(`payments/orders/${order.id}/collect`, {
    commandId: randomUUID(),
    version: order.version,
    mode: 'AMOUNT',
    tenders: [
      {
        method: 'CARD',
        amount: '5.00',
        transactionReference: 'inventory-browser-' + info.project.name + '-receipt',
      },
    ],
  });
  await views.getByRole('button', { name: 'Stock', exact: true }).click();
  await page.getByLabel('Search inventory', { exact: true }).fill(prefix);
  await expect(card.getByTestId('stock-quantity')).toHaveText('150');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({
    path: join(tmpdir(), `phase7-inventory-${info.project.name}.png`),
    fullPage: true,
  });
  if (info.project.name === 'desktop') {
    const viewport = page.viewportSize()!;
    await page.setViewportSize({ width: 1024, height: 768 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: join(tmpdir(), 'phase7-inventory-tablet.png'), fullPage: true });
    await page.setViewportSize(viewport);
  }
  await views.getByRole('button', { name: 'History', exact: true }).click();
  await page.getByLabel('Search inventory', { exact: true }).fill(prefix);
  await expect(page.getByText(`Order #${order.orderNumber}`, { exact: false })).toBeVisible();
  await expect(page.getByText('Final order settlement', { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
