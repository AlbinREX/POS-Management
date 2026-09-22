import { expect, test } from './fixtures';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

test('owner reads the dashboard, switches ranges, drills into a day and exports CSV', async ({
  page,
}, info) => {
  test.setTimeout(90000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.location().url.includes('/api/auth/refresh') && m.text().includes('401')) return;
    if (m.type() === 'error') errors.push(m.text());
  });
  const origin = process.env.APP_ORIGIN ?? 'http://localhost:3000';
  const prefix = `Report ${info.project.name}`;
  const owner = await page.request.post('/api/auth/login', {
    headers: { Origin: origin },
    data: {
      organization: 'verification',
      branch: 'main',
      email: process.env.SEED_OWNER_EMAIL,
      password: process.env.SEED_OWNER_PASSWORD,
    },
  });
  expect(owner.status()).toBe(200);
  const headers = { Origin: origin, Authorization: 'Bearer ' + (await owner.json()).accessToken };
  const post = async (path: string, data: unknown) => {
    const response = await page.request.post('/api/' + path, { headers, data });
    expect(response.status(), path).toBe(201);
    return response.json();
  };
  // A settled card order gives the dashboard a known figure to display for this project.
  const category = await post('menu/categories', { kind: 'categories', name: `${prefix} menu` });
  const product = await post('menu/products', {
    kind: 'products',
    name: `${prefix} platter`,
    sku: `REPORT-UI-${info.project.name}`,
    categoryId: category.id,
    sellingPrice: info.project.name === 'desktop' ? '7.10' : '7.20',
    taxRate: '0.00',
    taxMode: 'INCLUSIVE',
    modifierGroupIds: [],
    kitchenStationIds: [],
  });
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
  await post(`payments/orders/${order.id}/collect`, {
    commandId: randomUUID(),
    version: order.version,
    mode: 'AMOUNT',
    tenders: [{ method: 'CARD', amount: order.total, transactionReference: 'ui-' + randomUUID() }],
  });
  const before = await (
    await page.request.get('/api/reports/sales?preset=today', { headers })
  ).json();
  await page.context().clearCookies();

  await page.goto('/');
  await expect(page).toHaveTitle('FastFood Riza · POS');
  await page.getByLabel('Organization', { exact: true }).fill('verification');
  await page.getByLabel('Branch code').fill('main');
  await page.getByLabel('Email', { exact: true }).fill(process.env.SEED_OWNER_EMAIL!);
  await page.getByLabel('Password', { exact: true }).fill(process.env.SEED_OWNER_PASSWORD!);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page
    .getByRole('navigation')
    .getByRole('button', { name: 'Dashboard', exact: true })
    .click();
  const dashboard = page.getByRole('region', { name: 'Owner dashboard' });
  await expect(dashboard).toBeVisible();
  const salesCard = dashboard.getByRole('button', { name: /^Sales: / });
  await expect(salesCard).toContainText(`${before.salesAfterDiscount} ${before.currency}`);
  await expect(salesCard).toContainText(`${before.orderCount} settled orders`);
  await expect(
    dashboard.getByText(`${before.range.fromDate} → ${before.range.toDate}`),
  ).toBeVisible();

  // Presets change the range shown and the figures behind it.
  const range = dashboard.getByRole('group', { name: 'Report range' });
  await range.getByRole('button', { name: 'Yesterday', exact: true }).click();
  const yesterday = await (
    await page.request.get('/api/reports/sales?preset=yesterday', { headers })
  ).json();
  await expect(salesCard).toContainText(`${yesterday.salesAfterDiscount} ${yesterday.currency}`);
  await expect(
    dashboard.getByText(`${yesterday.range.fromDate} → ${yesterday.range.toDate}`),
  ).toBeVisible();
  await range.getByRole('button', { name: 'Today', exact: true }).click();
  await expect(salesCard).toContainText(`${before.orderCount} settled orders`);

  // Drill-down: the sales card opens the orders report; a day row narrows the range.
  await salesCard.click();
  const detail = page.getByRole('region', { name: 'Orders report' });
  const daily = detail.getByRole('table', { name: 'Daily sales' });
  await expect(daily).toBeVisible();
  await expect(daily.getByRole('cell', { name: before.range.fromDate, exact: true })).toBeVisible();
  await expect(
    daily.getByRole('cell', { name: before.salesAfterDiscount, exact: true }).first(),
  ).toBeVisible();
  await daily.getByRole('row').nth(1).click();
  await expect(range.getByRole('button', { name: 'Custom', exact: true })).toHaveAttribute(
    'data-variant',
    'default',
  );
  await expect(range.getByLabel('From date')).toHaveValue(before.range.fromDate);
  await expect(detail.getByRole('table', { name: 'Top orders' })).toContainText(order.total);

  // Every report view renders without a client error.
  const views = dashboard.getByRole('group', { name: 'Report views' });
  for (const view of ['Products', 'Staff', 'Cash', 'Inventory', 'Purchasing', 'Companies']) {
    await views.getByRole('button', { name: view, exact: true }).click();
    await expect(page.getByRole('region', { name: `${view} report` })).toBeVisible();
    await expect(dashboard.getByText('Loading reports…')).toHaveCount(0);
  }
  // Re-open Products before asserting its table: the loop above ended on Companies.
  await views.getByRole('button', { name: 'Products', exact: true }).click();
  await expect(
    page
      .getByRole('region', { name: 'Products report' })
      .getByRole('table', { name: 'Top sellers' }),
  ).toContainText(`${prefix} platter`);

  // CSV export is permission-protected, exact and served as an attachment.
  const csv = await page.request.get(
    `/api/reports/products/export?preset=custom&from=${before.range.fromDate}&to=${before.range.toDate}`,
    { headers },
  );
  expect(csv.status()).toBe(200);
  expect(csv.headers()['content-type']).toMatch(/^text\/csv/);
  expect(csv.headers()['content-disposition']).toBe(
    `attachment; filename="products-${before.range.fromDate}-to-${before.range.toDate}.csv"`,
  );
  const body = (await csv.text()).replace(/^\uFEFF/, '');
  expect(body.split('\r\n')[0]).toBe('productId,productName,categoryName,quantity,lines,sales');
  expect(body).toContain(`${product.id},${prefix} platter,${prefix} menu,2,1,${order.total}`);
  const anonymous = await page.request.get('/api/reports/products/export', {
    headers: { Origin: origin },
  });
  expect(anonymous.status()).toBe(401);
  await views.getByRole('button', { name: 'Products', exact: true }).click();
  await dashboard.getByRole('button', { name: 'Export CSV', exact: true }).click();
  await expect(dashboard.getByText(/^Exported products-/)).toBeVisible();

  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({
    path: join(tmpdir(), `phase11-dashboard-${info.project.name}.png`),
    fullPage: true,
  });
  expect(errors).toEqual([]);
});
