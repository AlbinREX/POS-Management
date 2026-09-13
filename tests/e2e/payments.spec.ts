import { test, expect, request as apiRequest } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

test('cash shift, mixed settlement, lost-response retry, refund and counted close', async ({
  page,
}, info) => {
  test.setTimeout(90000);
  const errors: string[] = [],
    consoles: string[] = [];
  let networkTest = false;
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    // An anonymous initial page probes refresh and receives the expected 401.
    if (m.location().url.includes('/api/auth/refresh') && m.text().includes('401')) return;
    if (m.type() === 'error' && !networkTest) consoles.push(m.text());
  });
  const client = await apiRequest.newContext({
    baseURL: 'http://localhost:3000',
    extraHTTPHeaders: { Origin: 'http://localhost:3000' },
  });
  const credentials = {
    organization: 'verification',
    branch: 'main',
    email: process.env.SEED_OWNER_EMAIL!,
    password: process.env.SEED_OWNER_PASSWORD!,
  };
  const auth = await client.post('/api/auth/login', { data: credentials });
  expect(auth.status()).toBe(200);
  const headers = { Authorization: 'Bearer ' + (await auth.json()).accessToken };
  const post = async (path: string, data: unknown) => {
    const res = await client.post('/api/' + path, { headers, data });
    expect(res.status(), path).toBe(201);
    return res.json();
  };
  const prefix = 'Payment browser ' + info.project.name;
  const category = await post('menu/categories', { kind: 'categories', name: prefix });
  const product = await post('menu/products', {
    kind: 'products',
    name: prefix + ' burger',
    sku: prefix,
    categoryId: category.id,
    sellingPrice: '5.00',
    taxRate: '0.00',
    taxMode: 'INCLUSIVE',
    modifierGroupIds: [],
    kitchenStationIds: [],
  });
  const terminal = await post('terminals', { name: prefix, type: 'POS' });
  let order = await post('orders', { commandId: randomUUID(), type: 'TAKEAWAY' });
  for (const command of [
    { action: 'add_item', productId: product.id, quantity: 2 },
    { action: 'status', status: 'OPEN' },
    { action: 'status', status: 'WAITING_PAYMENT' },
  ])
    order = await post(`orders/${order.id}/commands`, {
      commandId: randomUUID(),
      version: order.version,
      ...command,
    });
  await page.goto('/');
  await expect(page).toHaveTitle('FastFood Riza · POS');
  await page.getByLabel('Organization', { exact: true }).fill('verification');
  await page.getByLabel('Branch code').fill('main');
  await page.getByLabel('Email', { exact: true }).fill(credentials.email);
  await page.getByLabel('Password', { exact: true }).fill(credentials.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('button', { name: 'Payments', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Cash register shifts', exact: true }),
  ).toBeVisible();
  await page.getByLabel('POS terminal', { exact: true }).selectOption(terminal.id);
  await page.getByLabel('Opening cash', { exact: true }).fill('20.00');
  await page.getByRole('button', { name: 'Open cash shift', exact: true }).click();
  await expect(
    page.getByText(`Your open drawer: ${prefix} · Expected 20.00 EUR`, { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: new RegExp('^#' + order.orderNumber + ' ·') }).click();
  await expect(page.getByTestId('payment-due')).toHaveText('10.00');
  await page.getByLabel('Cash amount', { exact: true }).fill('4.00');
  await page.getByLabel('Card amount', { exact: true }).fill('6.00');
  await page.getByLabel('Cash tendered', { exact: true }).fill('10.00');
  await page
    .getByLabel('Approved terminal receipt reference', { exact: true })
    .fill('browser-' + randomUUID());
  networkTest = true;
  await page.route(
    '**/api/payments/orders/*/collect',
    async (route) => {
      await route.fetch();
      await route.abort('failed');
    },
    { times: 1 },
  );
  await page.getByRole('button', { name: 'Record payment', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Retry saved payment command' })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Payments', exact: true }).click();
  await page.getByRole('button', { name: 'Retry saved payment command' }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'CASH 4.00 · Change 6.00 / CARD 6.00' }),
  ).toBeVisible();
  networkTest = false;
  await page.getByLabel('Bill status').selectOption('PAID');
  await page.getByRole('button', { name: new RegExp('^#' + order.orderNumber + ' ·') }).click();
  await expect(page.getByTestId('payment-due')).toHaveText('0.00');
  const summary = await (await client.get(`/api/payments/orders/${order.id}`, { headers })).json();
  expect(summary.payments).toHaveLength(2);
  expect(summary.order.status).toBe('PAID');
  const receipt = page
    .locator('article')
    .filter({ hasText: summary.payments.find((p: { method: string }) => p.method === 'CASH').id });
  await receipt.getByLabel('Refund amount', { exact: true }).fill('1.00');
  await receipt.getByLabel('Reversal reason', { exact: true }).fill('Browser quality refund');
  await receipt.getByRole('button', { name: 'Record refund', exact: true }).click();
  await expect(receipt.getByText(/REFUND 1.00 · Browser quality refund/)).toBeVisible();
  networkTest = true;
  await page.route('**/api/payments/**', (route) => route.abort('failed'));
  await page.getByRole('button', { name: 'Refresh payments', exact: true }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Financial actions are paused' }),
  ).toBeVisible();
  await expect(receipt.getByRole('button', { name: 'Record refund', exact: true })).toBeDisabled();
  await page.unroute('**/api/payments/**');
  await page.getByRole('button', { name: 'Refresh payments', exact: true }).click();
  await expect(receipt.getByRole('button', { name: 'Record refund', exact: true })).toBeEnabled();
  networkTest = false;
  await page.getByRole('button', { name: new RegExp('^' + prefix + ' ·') }).click();
  await page.getByLabel('Cash movement type').selectOption('cash_out');
  await page.getByLabel('Movement amount', { exact: true }).fill('2.00');
  await page.getByLabel('Movement reason', { exact: true }).fill('Browser petty cash');
  await page.getByRole('button', { name: 'Record cash movement', exact: true }).click();
  await expect(
    page.getByText('Opening 20.00 · Expected 21.00 · Counted — · Difference —', { exact: true }),
  ).toBeVisible();
  await page.getByLabel('Counted cash', { exact: true }).fill('21.00');
  await page.getByRole('button', { name: 'Close cash shift', exact: true }).click();
  await expect(
    page.getByText('Opening 20.00 · Expected 21.00 · Counted 21.00 · Difference 0.00', {
      exact: true,
    }),
  ).toBeVisible();
  await page.screenshot({
    path: join(tmpdir(), `restaurant-phase6-${info.project.name}.png`),
    fullPage: true,
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  expect(errors).toEqual([]);
  expect(consoles).toEqual([]);
  expect(page.url()).toBe('http://localhost:3000/');
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  let itemOrder = await post('orders', { commandId: randomUUID(), type: 'TAKEAWAY' });
  for (const command of [
    { action: 'add_item', productId: product.id, quantity: 2 },
    { action: 'status', status: 'OPEN' },
    { action: 'status', status: 'WAITING_PAYMENT' },
  ])
    itemOrder = await post(`orders/${itemOrder.id}/commands`, {
      commandId: randomUUID(),
      version: itemOrder.version,
      ...command,
    });
  const roles = await (await client.get('/api/roles', { headers })).json();
  const cashierEmail = `payment-browser-${info.project.name}@verification.test`;
  await post('users', {
    name: 'Browser cashier',
    email: cashierEmail,
    password: credentials.password,
    roleIds: [roles.find((r: { name: string }) => r.name === 'CASHIER').id],
  });
  await page.getByLabel('Organization', { exact: true }).fill('verification');
  await page.getByLabel('Branch code').fill('main');
  await page.getByLabel('Email', { exact: true }).fill(cashierEmail);
  await page.getByLabel('Password', { exact: true }).fill(credentials.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('button', { name: 'Payments', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Roles', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: new RegExp('^#' + itemOrder.orderNumber + ' ·') }).click();
  await page.getByLabel('Split mode').selectOption('ITEMS');
  await page.getByLabel('Item payment method').selectOption('CARD');
  for (const due of ['5.00', '0.00']) {
    await page.getByLabel(`Pay quantity ${prefix} burger`).fill('1');
    await page
      .getByLabel('Approved terminal receipt reference', { exact: true })
      .fill('browser-items-' + randomUUID());
    await page.getByRole('button', { name: 'Record payment', exact: true }).click();
    await expect(page.getByTestId('payment-due')).toHaveText(due);
  }
  await expect(page.getByRole('button', { name: 'Record refund', exact: true })).toHaveCount(0);
  const itemSummary = await (
    await client.get(`/api/payments/orders/${itemOrder.id}`, { headers })
  ).json();
  expect(itemSummary.mode).toBe('ITEMS');
  expect(itemSummary.payments).toHaveLength(2);
  expect(itemSummary.order.status).toBe('PAID');
  await page.screenshot({
    path: join(tmpdir(), `restaurant-phase6-items-${info.project.name}.png`),
    fullPage: true,
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  expect(errors).toEqual([]);
  expect(consoles).toEqual([]);
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await post(`menu/products/${product.id}/archive`, { version: 1 });
  await post(`menu/categories/${category.id}/archive`, { version: 1 });
  const disabledTerminal = await client.patch('/api/terminals/' + terminal.id, {
    headers,
    data: { active: false },
  });
  expect(disabledTerminal.status()).toBe(200);
  await client.dispose();
});
