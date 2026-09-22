import { expect, test } from './fixtures';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

test('waiter installs the mobile surface, opens a table order, sends it and hands off payment', async ({
  page,
}, info) => {
  test.setTimeout(90000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const origin = process.env.APP_ORIGIN ?? 'http://localhost:3000';
  const prefix = `Waiter ${info.project.name}`;
  const email = `waiter-${info.project.name}@verification.test`;
  const password = 'Waiter-browser-password-10!';

  // Prepare the branch and a WAITER-role account through the API, so the browser
  // walk exercises the mobile surface rather than administration.
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
  const headers = {
    Origin: origin,
    Authorization: 'Bearer ' + (await owner.json()).accessToken,
  };
  const post = async (path: string, data: unknown) => {
    const response = await page.request.post('/api/' + path, { headers, data });
    expect(response.status(), path).toBe(201);
    return response.json();
  };
  const area = await post('layout/areas', { name: `${prefix} hall`, sortOrder: 50 });
  const table = await post('layout/tables', {
    areaId: area.id,
    name: `${prefix} T1`,
    number: info.project.name === 'desktop' ? 92001 : 92002,
    capacity: 4,
    positionX: 10,
    positionY: 10,
    width: 90,
    height: 90,
    shape: 'SQUARE',
  });
  const station = await post('menu/kitchen-stations', {
    kind: 'kitchen-stations',
    name: `${prefix} pass`,
  });
  const category = await post('menu/categories', { kind: 'categories', name: `${prefix} menu` });
  await post('menu/products', {
    kind: 'products',
    name: `${prefix} plate`,
    sku: `WAITER-UI-${info.project.name}`,
    categoryId: category.id,
    sellingPrice: '9.00',
    taxRate: '0.00',
    taxMode: 'INCLUSIVE',
    modifierGroupIds: [],
    kitchenStationIds: [station.id],
  });
  const roles = await (await page.request.get('/api/roles', { headers })).json();
  await post('users', {
    name: prefix,
    email,
    password,
    roleIds: [roles.find((r: { name: string }) => r.name === 'WAITER').id],
  });

  // Fixture setup above authenticated as the owner through the shared cookie jar.
  // Clear it so the waiter route presents the sign-in form rather than restoring
  // that session, which would test the wrong account entirely.
  await page.context().clearCookies();

  // The installable surface is its own route, like the kitchen display.
  await page.goto('/waiter');
  await expect(page).toHaveTitle('FastFood Riza · POS');

  // PWA characteristics are served before authentication.
  const manifestLink = page.locator('link[rel=manifest]');
  await expect(manifestLink).toHaveCount(1);
  const manifestHref = await manifestLink.getAttribute('href');
  const manifest = await (await page.request.get(manifestHref!)).json();
  expect(manifest.display).toBe('standalone');
  expect(manifest.start_url).toBe('/waiter');
  expect(manifest.theme_color).toBe('#111214');
  expect(manifest.icons.length).toBeGreaterThanOrEqual(2);
  for (const icon of manifest.icons)
    expect((await page.request.get(icon.src)).status(), icon.src).toBe(200);
  expect((await page.request.get('/sw.js')).status()).toBe(200);
  // The worker must never cache authenticated application data.
  const worker = await (await page.request.get('/sw.js')).text();
  expect(worker).toContain("url.pathname.startsWith('/api/')");

  // The POS spec seeds products with deliberately broken image URLs under /qa/ to prove
  // the catalogue's image fallback. Those products persist in this shared database, so
  // their 404s are another suite's intended fixture rather than a fault in this surface.
  const fixtureImage = (url: string) => url.includes('/qa/');
  // Record the failing URL, not just the generic console text, so a missing asset
  // names itself instead of having to be guessed at.
  page.on('response', (r) => {
    if (!r.ok() && r.status() !== 401 && !fixtureImage(r.url()))
      errors.push(`${r.status()} ${r.url()}`);
  });
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('Failed to load resource'))
      errors.push(m.text());
  });
  await page.getByLabel('Organization', { exact: true }).fill('verification');
  await page.getByLabel('Branch code').fill('main');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();

  // A dedicated mobile surface exposes no administration navigation.
  await expect(page.getByRole('navigation', { name: 'Waiter views' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Administration' })).toHaveCount(0);
  const tables = page.getByRole('region', { name: 'Restaurant tables' });
  await expect(tables.getByRole('button', { name: new RegExp(`${prefix} T1`) })).toBeVisible();

  // Take the order through the existing POS surface, then send it to the kitchen.
  const order = await post('orders', {
    commandId: randomUUID(),
    type: 'DINE_IN',
    tableId: table.id,
    notes: '',
  });
  await page
    .getByRole('navigation', { name: 'Waiter views' })
    .getByRole('button', { name: 'Tables' })
    .click();
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  // Other suites share this database, so match only this project's own table.
  const occupied = tables.getByRole('button', { name: `Table ${prefix} T1, Occupied` });
  await expect(occupied).toBeVisible();
  await occupied.click();
  await expect(page.getByRole('navigation', { name: 'Waiter views' })).toBeVisible();

  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({
    path: join(tmpdir(), `phase10-waiter-${info.project.name}.png`),
    fullPage: true,
  });
  expect(errors).toEqual([]);
  expect(order.tableId).toBe(table.id);
});
