import { expect, test } from '@playwright/test';

test('dine-in and takeaway orders retain snapshots and recover an uncertain save without duplicates', async ({
  page,
}, info) => {
  test.setTimeout(90000);
  const errors: string[] = [];
  let injectingLoss = false;
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.getByLabel('Organization', { exact: true }).fill('verification');
  await page.getByLabel('Branch code').fill('main');
  await page.getByLabel('Email', { exact: true }).fill(process.env.SEED_OWNER_EMAIL!);
  await page.getByLabel('Password', { exact: true }).fill(process.env.SEED_OWNER_PASSWORD!);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('button', { name: 'Orders', exact: true }).click();
  // Anonymous startup intentionally receives 401 from refresh; inspect errors in the authenticated workflow.
  page.on('console', (m) => {
    if (m.type() === 'error' && !injectingLoss) errors.push(m.text());
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
  const token = (await login.json()).accessToken;
  const headers = {
    Origin: process.env.APP_ORIGIN ?? 'http://localhost:3000',
    Authorization: 'Bearer ' + token,
  };
  const create = async (path: string, data: unknown) => {
    const response = await page.request.post('/api/' + path, { headers, data });
    expect(response.status(), path).toBe(201);
    return response.json();
  };
  const prefix = `Order browser ${info.project.name}`;
  const category = await create('menu/categories', { kind: 'categories', name: prefix });
  const group = await create('menu/modifier-groups', {
    kind: 'modifier-groups',
    name: prefix,
    minSelections: 1,
    maxSelections: 1,
  });
  const modifier = await create('menu/modifiers', {
    kind: 'modifiers',
    groupId: group.id,
    name: prefix + ' cheese',
    priceAdjustment: '0.50',
  });
  const productInput = {
    kind: 'products',
    name: prefix + ' burger',
    sku: 'ORDER-E2E-' + info.project.name,
    categoryId: category.id,
    sellingPrice: '5.50',
    taxRate: '20.00',
    taxMode: 'INCLUSIVE',
    modifierGroupIds: [group.id],
    kitchenStationIds: [],
  };
  const product = await create('menu/products', productInput);
  const area = await create('layout/areas', { name: prefix });
  const table = await create('layout/tables', {
    areaId: area.id,
    name: prefix,
    number: info.project.name === 'desktop' ? 81001 : 81002,
    capacity: 4,
    positionX: 20,
    positionY: 20,
    width: 100,
    height: 80,
    shape: 'RECTANGLE',
  });
  await page.getByRole('button', { name: 'Refresh orders' }).click();
  await page.getByLabel('Order type', { exact: true }).selectOption('DINE_IN');
  await expect(page.getByLabel('Free table').locator(`option[value="${table.id}"]`)).toHaveCount(1);
  await page.getByLabel('Free table').selectOption(table.id);
  await page.getByRole('button', { name: 'Create draft', exact: true }).click();
  const current = page.getByRole('region', { name: 'Current order' });
  await expect(current.getByText(`${prefix} / ${prefix}`, { exact: false })).toBeVisible();
  await page.getByLabel('Product', { exact: true }).selectOption(product.id);
  await page.getByLabel(`${prefix} cheese · 0.50`, { exact: true }).check();
  await page.getByLabel('New item quantity').fill('2');
  await page.getByLabel('New item notes').fill('No onion');
  injectingLoss = true;
  await page.route(
    '**/api/orders/*/commands',
    async (route) => {
      await route.fetch(); // The server committed. Simulate losing only the response.
      await route.abort('failed');
    },
    { times: 1 },
  );
  await page.getByRole('button', { name: 'Add to order', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Retry pending command' })).toBeVisible();
  await page.reload({ waitUntil: 'domcontentloaded' });
  try {
    await page
      .getByRole('navigation', { name: 'Administration' })
      .getByRole('button', { name: 'Orders', exact: true })
      .click({ timeout: 5000 });
  } catch {
    await page.getByRole('button', { name: /^Orders/ }).first().click();
  }
  await page.getByRole('button', { name: 'Retry pending command' }).click();
  await expect(page.getByRole('button', { name: 'Retry pending command' })).toHaveCount(0);
  await expect(page.getByTestId('order-total')).toHaveText('12.00 EUR');
  expect(await current.getByRole('article').count()).toBe(1);
  injectingLoss = false;
  const response = await page.request.put('/api/menu/products/' + product.id, {
    headers,
    data: {
      version: product.version,
      data: { ...productInput, sellingPrice: '9.50', name: prefix + ' new name' },
    },
  });
  expect(response.status()).toBe(200);
  await page.getByLabel(`Quantity for ${prefix} burger`).fill('3');
  await page.getByRole('button', { name: 'Update item', exact: true }).click();
  await expect(page.getByTestId('order-total')).toHaveText('18.00 EUR');
  await expect(current.getByText('Snapshot price 5.50', { exact: false })).toBeVisible();
  await page.getByLabel('Discount amount (EUR, gross)').fill('3.00');
  await page.getByLabel('Discount reason', { exact: true }).fill('Service courtesy');
  await page.getByRole('button', { name: 'Apply discount', exact: true }).click();
  await expect(page.getByTestId('order-total')).toHaveText('15.00 EUR');
  await page.getByRole('button', { name: 'Open order', exact: true }).click();
  await page.getByRole('button', { name: 'Request payment', exact: true }).click();
  await expect(current.getByText('WAITING PAYMENT', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add to order', exact: true })).toHaveCount(0);
  expect(
    (await (await page.request.get('/api/layout/tables/' + table.id, { headers })).json()).status,
  ).toBe('WAITING_PAYMENT');
  await page.screenshot({ path: `.local/${info.project.name}-orders.png`, fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page
    .getByLabel('Cancellation reason', { exact: true })
    .fill('Browser verification complete');
  await page.getByRole('button', { name: 'Cancel order', exact: true }).click();
  await expect(current.getByText('CANCELLED', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'View order history', exact: true }).click();
  await expect(
    page.getByRole('list', { name: 'Order history' }).getByText('order.cancel', { exact: false }),
  ).toBeVisible();
  expect(
    (await (await page.request.get('/api/layout/tables/' + table.id, { headers })).json()).status,
  ).toBe('FREE');
  await page.getByLabel('Order type', { exact: true }).selectOption('TAKEAWAY');
  await page.getByRole('button', { name: 'Create draft', exact: true }).click();
  await expect(current.getByText('DRAFT', { exact: true })).toBeVisible();
  await expect(current.getByText('Takeaway ·', { exact: false })).toBeVisible();
  await page.getByLabel('Cancellation reason', { exact: true }).fill('Empty draft cleanup');
  await page.getByRole('button', { name: 'Cancel order', exact: true }).click();
  await expect(current.getByText('CANCELLED', { exact: true })).toBeVisible();
  const currentTable = await (
    await page.request.get('/api/layout/tables/' + table.id, { headers })
  ).json();
  await create(`layout/tables/${table.id}/archive`, { version: currentTable.version });
  await create(`layout/areas/${area.id}/archive`, { version: area.version });
  await create(`menu/products/${product.id}/archive`, { version: 2 });
  await create(`menu/modifiers/${modifier.id}/archive`, { version: 1 });
  await create(`menu/modifier-groups/${group.id}/archive`, { version: 1 });
  await create(`menu/categories/${category.id}/archive`, { version: 1 });
  expect(errors).toEqual([]);
});
