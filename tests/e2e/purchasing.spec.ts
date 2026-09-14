import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
test('purchasing operator orders, receives with retry, checks stock and reconciles supplier balance', async ({
  page,
}, info) => {
  test.setTimeout(90000);
  const errors: string[] = [];
  let networkTest = false;
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page).toHaveTitle('FastFood Riza · POS');
  await page.getByLabel('Organization', { exact: true }).fill('verification');
  await page.getByLabel('Branch code').fill('main');
  await page.getByLabel('Email', { exact: true }).fill(process.env.SEED_OWNER_EMAIL!);
  await page.getByLabel('Password', { exact: true }).fill(process.env.SEED_OWNER_PASSWORD!);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page
    .getByRole('navigation')
    .getByRole('button', { name: 'Purchasing', exact: true })
    .click();
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
  const post = async (path: string, data: unknown) => {
    const r = await page.request.post('/api/' + path, { headers, data });
    expect(r.status()).toBe(201);
    return r.json();
  };
  const prefix = `Purchasing ${info.project.name}`;
  const warehouse = await post('inventory/warehouses', {
    commandId: randomUUID(),
    name: prefix + ' warehouse',
  });
  const item = await post('inventory/items', {
    commandId: randomUUID(),
    name: prefix + ' chicken',
    sku: 'PUR-UI-' + info.project.name,
    kind: 'INGREDIENT',
    unitCode: 'g',
  });
  const dialog = page.getByRole('dialog', { name: 'Purchasing editor' }),
    detail = page.getByRole('region', { name: 'Purchase detail' }),
    receipt = page.getByRole('region', { name: 'Receipt detail' }),
    views = page.getByRole('group', { name: 'Purchasing views' });
  await page.getByRole('button', { name: 'Add supplier', exact: true }).click();
  await dialog.getByLabel('Supplier name', { exact: true }).fill(prefix + ' supplier');
  await dialog.getByLabel('Business number', { exact: true }).fill('UI-' + info.project.name);
  await dialog.getByRole('button', { name: 'Save supplier', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole('button', { name: 'Refresh purchasing', exact: true }).click();
  await page.getByRole('button', { name: 'New purchase order', exact: true }).click();
  await dialog
    .getByRole('combobox', { name: 'Supplier', exact: true })
    .selectOption({ label: prefix + ' supplier' });
  await dialog
    .getByRole('combobox', { name: 'Receiving warehouse', exact: true })
    .selectOption(warehouse.id);
  await dialog
    .getByRole('combobox', { name: 'Purchase item 1', exact: true })
    .selectOption(item.id);
  await dialog.getByLabel('Quantity 1', { exact: true }).fill('2');
  await dialog.getByRole('combobox', { name: 'Purchase unit 1', exact: true }).selectOption('kg');
  await dialog.getByLabel('Net unit price 1', { exact: true }).fill('10.00');
  await dialog.getByLabel('Tax rate (%) 1', { exact: true }).fill('18');
  await dialog.getByLabel('Purchase reference', { exact: true }).fill(prefix + ' order');
  await dialog.getByRole('button', { name: 'Save purchase draft', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(detail.getByTestId('purchase-detail-status')).toHaveText('draft');
  await expect(detail.getByText('23.60 EUR', { exact: true })).toHaveCount(2);
  await detail.getByRole('button', { name: 'Edit draft', exact: true }).click();
  await dialog.getByLabel('Purchase notes', { exact: true }).fill('Deliver to kitchen');
  await dialog.getByRole('button', { name: 'Save purchase draft', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await detail.getByRole('button', { name: 'Confirm purchase order', exact: true }).click();
  await expect(detail.getByTestId('purchase-detail-status')).toHaveText('ordered');
  await detail.getByRole('button', { name: 'Receive goods', exact: true }).click();
  await dialog
    .getByRole('textbox', { name: `Receive ${prefix} chicken (kg)`, exact: true })
    .fill('1');
  await dialog.getByLabel('Delivery reference', { exact: true }).fill(prefix + ' delivery-1');
  await dialog.getByLabel('Invoice number', { exact: true }).fill(prefix + ' invoice-1');
  await dialog.getByLabel('Invoice date', { exact: true }).fill('2026-09-14');
  networkTest = true;
  await page.route(
    '**/api/purchasing/orders/*/receive',
    async (route) => {
      await route.fetch();
      await route.abort('failed');
    },
    { times: 1 },
  );
  await dialog.getByRole('button', { name: 'Post goods receipt', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Retry purchasing command', exact: true }),
  ).toBeAttached();
  await page.reload();
  await page
    .getByRole('navigation')
    .getByRole('button', { name: 'Purchasing', exact: true })
    .click();
  await page.getByRole('button', { name: 'Retry purchasing command', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Retry purchasing command', exact: true }),
  ).toHaveCount(0);
  networkTest = false;
  await expect(receipt.getByTestId('receipt-balance')).toHaveText('11.80 EUR');
  await expect(receipt.getByText('Received 1 kg', { exact: false })).toContainText(
    'added 1000 g to stock',
  );
  const stock = await page.request.get(
    `/api/inventory/stock?warehouseId=${warehouse.id}&itemId=${item.id}`,
    { headers },
  );
  expect((await stock.json()).items[0].quantity).toBe('1000.000000');
  await receipt.getByRole('button', { name: 'Record supplier payment', exact: true }).click();
  await dialog.getByLabel('Supplier payment amount', { exact: true }).fill('5.00');
  await dialog.getByLabel('Payment reference', { exact: true }).fill(prefix + ' bank receipt');
  await dialog.getByLabel('Payment reason', { exact: true }).fill('Bank confirmation checked');
  await dialog.getByRole('button', { name: 'Save supplier payment', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(receipt.getByTestId('receipt-balance')).toHaveText('6.80 EUR');
  await receipt.getByRole('button', { name: 'Open source purchase', exact: true }).click();
  await expect(detail.getByTestId('purchase-detail-status')).toHaveText('partially received');
  await detail.getByRole('button', { name: 'Receive goods', exact: true }).click();
  await dialog.getByLabel('Delivery reference', { exact: true }).fill(prefix + ' delivery-2');
  await dialog.getByRole('button', { name: 'Post goods receipt', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await receipt.getByRole('button', { name: 'Open source purchase', exact: true }).click();
  await expect(detail.getByTestId('purchase-detail-status')).toHaveText('received');
  await detail.getByRole('button', { name: 'Show purchase history', exact: true }).press('Enter');
  await expect(detail.locator('details').filter({ hasText: 'Deliver to kitchen' }).first()).toBeVisible();
  await views.getByRole('button', { name: 'Supplier balances', exact: true }).click();
  await page
    .getByRole('combobox', { name: 'Filter supplier', exact: true })
    .selectOption({ label: prefix + ' supplier' });
  await expect(page.getByTestId('supplier-balance')).toHaveText('18.60 EUR');
  await page.getByRole('button', { name: 'Reverse payment record', exact: true }).click();
  await dialog.getByLabel('Reason', { exact: true }).fill('Correct payment reference');
  await dialog.getByRole('button', { name: 'Confirm payment reversal', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId('supplier-balance')).toHaveText('23.60 EUR');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({
    path: join(tmpdir(), `phase8-purchasing-${info.project.name}.png`),
    fullPage: true,
  });
  if (info.project.name === 'desktop') {
    const viewport = page.viewportSize()!;
    await page.setViewportSize({ width: 1024, height: 768 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: join(tmpdir(), 'phase8-purchasing-tablet.png'), fullPage: true });
    await page.setViewportSize(viewport);
  }
  expect(errors).toEqual([]);
});
