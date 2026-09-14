import { test, expect, request as apiRequest } from '@playwright/test';
import { randomUUID } from 'node:crypto';
test('submit immutable order snapshots and operate a kitchen-only display with retry and cancellation', async ({
  page,
}, info) => {
  test.setTimeout(60000);
  const errors: string[] = [];
  let outage = false;
  page.on('pageerror', (e) => errors.push(e.message));
  const admin = await apiRequest.newContext({
    baseURL: process.env.APP_ORIGIN ?? 'http://localhost:3000',
    extraHTTPHeaders: { Origin: process.env.APP_ORIGIN ?? 'http://localhost:3000' },
  });
  const credentials = {
    organization: 'verification',
    branch: 'main',
    email: process.env.SEED_OWNER_EMAIL,
    password: process.env.SEED_OWNER_PASSWORD,
  };
  const auth = await admin.post('/api/auth/login', { data: credentials });
  expect(auth.status()).toBe(200);
  const token = (await auth.json()).accessToken,
    headers = { Authorization: 'Bearer ' + token };
  const post = async (path: string, data: unknown) => {
    const res = await admin.post('/api/' + path, { headers, data });
    expect(res.status(), path).toBe(201);
    return res.json();
  };
  const prefix = `KDS ${info.project.name}`,
    email = `kds-${info.project.name}@verification.test`;
  const roles = await (await admin.get('/api/roles', { headers })).json();
  await post('users', {
    name: prefix,
    email,
    password: credentials.password,
    roleIds: [roles.find((r: { name: string }) => r.name === 'KITCHEN').id],
  });
  const station = await post('menu/kitchen-stations', { kind: 'kitchen-stations', name: prefix });
  const category = await post('menu/categories', { kind: 'categories', name: prefix });
  const group = await post('menu/modifier-groups', {
    kind: 'modifier-groups',
    name: prefix,
    minSelections: 1,
    maxSelections: 1,
  });
  const modifier = await post('menu/modifiers', {
    kind: 'modifiers',
    groupId: group.id,
    name: 'Extra cheese',
    priceAdjustment: '0.50',
  });
  const productInput = {
    kind: 'products',
    name: prefix + ' burger',
    sku: prefix,
    categoryId: category.id,
    sellingPrice: '5.50',
    taxRate: '0.00',
    taxMode: 'INCLUSIVE',
    modifierGroupIds: [group.id],
    kitchenStationIds: [station.id],
  };
  const product = await post('menu/products', productInput);
  // The submission button itself is exercised through the existing order workspace.
  await page.goto('/');
  await page.getByLabel('Organization', { exact: true }).fill('verification');
  await page.getByLabel('Branch code').fill('main');
  await page.getByLabel('Email', { exact: true }).fill(credentials.email!);
  await page.getByLabel('Password', { exact: true }).fill(credentials.password!);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('button', { name: 'Orders', exact: true }).click();
  await page.getByRole('button', { name: 'Create draft', exact: true }).click();
  await page.getByLabel('Product', { exact: true }).selectOption(product.id);
  await page.getByLabel('Extra cheese · 0.50', { exact: true }).check();
  await page.getByLabel('New item quantity').fill('2');
  await page.getByLabel('New item notes').fill('No onion');
  await page.getByRole('button', { name: 'Add to order', exact: true }).click();
  await expect(page.getByTestId('order-total')).toHaveText('12.00 EUR');
  await page.getByRole('button', { name: 'Open order', exact: true }).click();
  const changed = await admin.put('/api/menu/products/' + product.id, {
    headers,
    data: {
      version: 1,
      data: { ...productInput, name: prefix + ' changed', sellingPrice: '9.50' },
    },
  });
  expect(changed.status()).toBe(200);
  await page.getByRole('button', { name: 'Send to kitchen', exact: true }).click();
  await expect(
    page
      .getByRole('region', { name: 'Current order' })
      .getByText('SENT TO KITCHEN', { exact: true }),
  ).toBeVisible();
  const tickets = (
    await (await admin.get('/api/kitchen/tickets?stationId=' + station.id, { headers })).json()
  ).items;
  expect(tickets).toHaveLength(1);
  const ticket = tickets[0];
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await page.goto('/kds');
  await page.getByLabel('Organization', { exact: true }).fill('verification');
  await page.getByLabel('Branch code').fill('main');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(credentials.password!);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Kitchen display', exact: true })).toBeVisible();
  page.on('console', (m) => {
    if (m.type() === 'error' && !outage) errors.push(m.text());
  });
  await expect(page.getByRole('navigation', { name: 'Administration' })).toHaveCount(0);
  await page.getByLabel('Kitchen station', { exact: true }).selectOption(station.id);
  const card = page.getByRole('article', {
    name: `Ticket ${ticket.content.orderNumber} ${prefix}`,
    exact: true,
  });
  await expect(card.getByText('2 × ' + prefix + ' burger', { exact: true })).toBeVisible();
  await expect(card.getByText('Note: No onion', { exact: true })).toBeVisible();
  await expect(card.getByText('NEW', { exact: true })).toBeVisible();
  outage = true;
  await page.route(
    '**/api/kitchen/tickets/*/state',
    async (route) => {
      await route.fetch();
      await route.abort('failed');
    },
    { times: 1 },
  );
  await card.getByRole('button', { name: 'Start preparing', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Retry kitchen command' })).toBeVisible();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Retry kitchen command' }).click();
  await expect(page.getByRole('button', { name: 'Retry kitchen command' })).toHaveCount(0);
  await expect(card.getByText('PREPARING', { exact: true })).toBeVisible();
  const history = (
    await (await admin.get(`/api/kitchen/tickets/${ticket.id}/history`, { headers })).json()
  ).events;
  expect(
    history.filter((e: { action: string }) => e.action === 'kitchen.ticket.status_changed'),
  ).toHaveLength(1);
  await page.route('**/api/kitchen/**', (route) => route.abort('failed'));
  await expect(
    page.getByText('Kitchen disconnected or refreshing · Updates paused', { exact: true }),
  ).toBeVisible({ timeout: 12000 });
  await expect(card.getByRole('button', { name: 'Mark ready', exact: true })).toBeDisabled();
  await page.unroute('**/api/kitchen/**');
  await page.getByRole('button', { name: 'Refresh kitchen' }).click();
  await expect(card.getByRole('button', { name: 'Mark ready', exact: true })).toBeEnabled();
  outage = false;
  await card.getByRole('button', { name: 'Mark ready', exact: true }).click();
  await expect(card.getByText('READY', { exact: true })).toBeVisible();
  await page.screenshot({ path: `.local/${info.project.name}-kitchen.png`, fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await card.getByRole('button', { name: 'Complete ticket', exact: true }).click();
  await expect(card).toHaveCount(0);
  await page.getByLabel('Ticket view', { exact: true }).selectOption('history');
  await page.getByLabel('Kitchen station', { exact: true }).selectOption(station.id);
  await expect(card.getByText('COMPLETED', { exact: true })).toBeVisible();
  let order = await (await admin.get('/api/orders/' + ticket.orderId, { headers })).json();
  expect(order.status).toBe('READY');
  expect(order.total).toBe('12.00');
  order = await post(`orders/${order.id}/commands`, {
    commandId: randomUUID(),
    version: order.version,
    action: 'cancel',
    reason: 'KDS browser verification',
  });
  await page.getByRole('button', { name: 'Refresh kitchen' }).click();
  await expect(card.getByText('CANCELLED', { exact: true })).toBeVisible();
  await card.getByRole('button', { name: 'Ticket history', exact: true }).click();
  await expect(
    page
      .getByRole('region', { name: 'Kitchen history' })
      .getByText('kitchen.ticket.cancelled', { exact: false }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  for (const [kind, id, version] of [
    ['products', product.id, 2],
    ['modifiers', modifier.id, 1],
    ['modifier-groups', group.id, 1],
    ['kitchen-stations', station.id, 1],
    ['categories', category.id, 1],
  ])
    await post(`menu/${kind}/${id}/archive`, { version });
  await admin.dispose();
  expect(errors).toEqual([]);
});
