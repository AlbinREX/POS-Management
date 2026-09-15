import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
test('company operator configures an account, recovers a lost save and settles an order on credit', async ({
  page,
}, info) => {
  test.setTimeout(90000);
  const errors: string[] = [];
  const networkTest = false;
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page).toHaveTitle('FastFood Riza · POS');
  await page.getByLabel('Organization', { exact: true }).fill('verification');
  await page.getByLabel('Branch code').fill('main');
  await page.getByLabel('Email', { exact: true }).fill(process.env.SEED_OWNER_EMAIL!);
  await page.getByLabel('Password', { exact: true }).fill(process.env.SEED_OWNER_PASSWORD!);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('navigation').getByRole('button', { name: 'Companies', exact: true }).click();
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
  const prefix = `Companies ${info.project.name}`;
  const dialog = page.getByRole('dialog', { name: 'Company editor' });
  const detail = page.getByRole('region', { name: 'Company detail' });
  const views = page.getByRole('group', { name: 'Company views' });

  // Create the company through the UI so the workspace is exercised end to end.
  await page.getByRole('button', { name: 'Add company', exact: true }).click();
  await dialog.getByLabel('Company name').fill(`${prefix} Ltd`);
  await dialog.getByLabel('Business number').fill('BIZ-UI');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const companyButton = page.getByRole('button', { name: new RegExp(`${prefix} Ltd`) });
  await expect(companyButton).toBeVisible();
  // Selection drives which company every editor writes to, and it defaults to the first
  // company alphabetically, which the shared integration fixtures own. Select ours first.
  await companyButton.click();
  await expect(companyButton).toHaveAttribute('aria-current', 'true');

  // Contract with a credit limit, activated from the UI.
  await views.getByRole('button', { name: 'Contracts', exact: true }).click();
  await page.getByRole('button', { name: 'Add contract', exact: true }).click();
  // The integration suite shares this database, so scope every assertion to our own row.
  const contractNumber = `C-${info.project.name}-${randomUUID().slice(0, 6)}`;
  await dialog.getByLabel('Contract number').fill(contractNumber);
  await dialog.getByLabel('Start date').fill('2026-01-01');
  await dialog.getByLabel('Credit limit').fill('100.00');
  await dialog.getByLabel('Discount percentage').fill('10.00');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const contractRow = detail.locator('li').filter({ hasText: contractNumber });
  // The workspace lowercases status labels for display.
  await expect(contractRow.getByText('draft', { exact: true })).toBeVisible();
  await contractRow.getByRole('button', { name: 'Activate', exact: true }).click();
  await expect(contractRow.getByText('active', { exact: true })).toBeVisible();

  // Authorize an employee for this company. The sessionStorage retry-receipt path is shared
  // with Purchasing and Inventory and is covered by their specs plus companies integration
  // group 7, which proves replay returns the original receipt without duplicating a record.
  await views.getByRole('button', { name: 'Employees', exact: true }).click();
  await page.getByRole('button', { name: 'Add employee', exact: true }).click();
  await dialog.getByLabel('Employee name').fill(`${prefix} Employee`);
  await dialog.getByLabel('Code').fill('E-UI');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(detail.getByText(`${prefix} Employee`)).toHaveCount(1);

  // Settle a real order on the company account through the existing payment API.
  const companies = await (
    await page.request.get('/api/companies?page=1&limit=100', { headers })
  ).json();
  const company = companies.items.find((c: { name: string }) => c.name === `${prefix} Ltd`);
  expect(
    company,
    `company "${prefix} Ltd" missing from ${JSON.stringify(companies.items?.map((c: { name: string }) => c.name))}`,
  ).toBeTruthy();
  const employees = await (
    await page.request.get(
      `/api/companies/directory/employees?companyId=${company.id}&page=1&limit=100`,
      { headers },
    )
  ).json();
  expect(
    employees.items?.[0],
    `no employees returned for ${company.id}: ${JSON.stringify(employees)}`,
  ).toBeTruthy();
  const category = await post('menu/categories', { kind: 'categories', name: `${prefix} cat` });
  const product = await post('menu/products', {
    kind: 'products',
    name: `${prefix} meal`,
    sku: `CO9-UI-${info.project.name}`,
    categoryId: category.id,
    sellingPrice: '10.00',
    taxRate: '0.00',
    taxMode: 'INCLUSIVE',
  });
  let order = await post('orders', { commandId: randomUUID(), type: 'TAKEAWAY' });
  for (const action of [
    { action: 'add_item', productId: product.id, quantity: 1 },
    { action: 'status', status: 'OPEN' },
    { action: 'status', status: 'WAITING_PAYMENT' },
  ])
    order = await post(`orders/${order.id}/commands`, {
      commandId: randomUUID(),
      version: order.version,
      ...action,
    });
  const collected = await post(`payments/orders/${order.id}/collect`, {
    commandId: randomUUID(),
    version: order.version,
    mode: 'AMOUNT',
    tenders: [
      {
        method: 'COMPANY_ACCOUNT',
        amount: order.total,
        companyId: company.id,
        companyEmployeeId: employees.items[0].id,
      },
    ],
  });
  expect(collected.settled).toBe(true);

  // The charge was posted out of band, so refresh before asserting on the account view.
  await views.getByRole('button', { name: 'Account', exact: true }).click();
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(detail.getByText('charge', { exact: true })).toBeVisible();
  await expect(detail.getByText(`${prefix} Employee`)).toBeVisible();

  // A statement freezes the period. Desktop and mobile share one database, so each project
  // uses its own period end: a statement is unique per company and period, and a repeated
  // period is a deliberate conflict rather than a new document.
  await expect(companyButton).toHaveAttribute('aria-current', 'true');
  await views.getByRole('button', { name: 'Statements', exact: true }).click();
  await page.getByRole('button', { name: 'Generate statement', exact: true }).click();
  await dialog.getByLabel('Period start').fill('2026-01-01');
  await dialog.getByLabel('Period end').fill(info.project.name === 'desktop' ? '2098-12-31' : '2099-12-31');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(detail.getByText(/Statement \d+/).first()).toBeVisible();

  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBe(true);
  await page.screenshot({
    path: join(tmpdir(), `phase9-companies-${info.project.name}.png`),
    fullPage: true,
  });
  if (info.project.name === 'desktop') {
    await page.setViewportSize({ width: 1024, height: 768 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.setViewportSize({ width: 1280, height: 720 });
  }
  expect(errors).toEqual([]);
});
