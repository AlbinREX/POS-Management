import { expect, test } from '@playwright/test';

/**
 * The product photography bundled with the app.
 *
 * The POS spec proves the fallback path with deliberately broken fixture URLs; this
 * one proves the opposite case: that a real bundled asset is served, decodes, and
 * renders in a card whose geometry stays uniform across the grid.
 */
const IMAGES = [
  'riza-burger',
  'chicken-classic',
  'pepperoni-pizza',
  'french-fries',
  'cola',
  'chicken-wrap',
];

test('bundled product images are served, decode and keep the grid uniform', async ({
  page,
}, info) => {
  test.setTimeout(90000);

  // Every bundled asset must exist and be a real image, not an HTML error page.
  for (const name of IMAGES) {
    const response = await page.request.get(`/food/${name}.webp`);
    expect(response.status(), name).toBe(200);
    expect(response.headers()['content-type'], name).toContain('image/webp');
    const bytes = (await response.body()).length;
    // Large enough to be a photograph, small enough to stay fast on a POS terminal.
    expect(bytes, name).toBeGreaterThan(5_000);
    expect(bytes, name).toBeLessThan(400_000);
  }

  await page.goto('/');
  await page.getByLabel('Organization', { exact: true }).fill('verification');
  await page.getByLabel('Branch code').fill('main');
  await page.getByLabel('Email', { exact: true }).fill(process.env.SEED_OWNER_EMAIL!);
  await page.getByLabel('Password', { exact: true }).fill(process.env.SEED_OWNER_PASSWORD!);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('heading', { name: 'Home', exact: true }).waitFor();

  // Create one product that points at a bundled asset, through the normal menu API.
  const prefix = `Image ${info.project.name}`;
  const token = await page.evaluate(async () => {
    const response = await fetch('/api/auth/refresh', { method: 'POST' });
    return response.ok ? ((await response.json()).accessToken as string) : '';
  });
  const auth = {
    Authorization: `Bearer ${token}`,
    Origin: process.env.APP_ORIGIN ?? 'http://localhost:3000',
  };
  const category = await (
    await page.request.post('/api/menu/categories', {
      headers: auth,
      data: { kind: 'categories', name: prefix },
    })
  ).json();
  const created = await page.request.post('/api/menu/products', {
    headers: auth,
    data: {
      kind: 'products',
      name: `${prefix} burger`,
      description: 'Beef patty, cheddar cheese, lettuce, tomato, special sauce',
      // A root-relative path is the portable form used by the bundled catalogue.
      imageUrl: '/food/riza-burger.webp',
      sku: `${prefix}-BURGER`,
      categoryId: category.id,
      // A price no other spec uses: the menu spec asserts on a loose "Price 6.00"
      // text match, and these specs share one database.
      sellingPrice: '6.35',
      taxRate: '20.00',
      taxMode: 'INCLUSIVE',
      modifierGroupIds: [],
      kitchenStationIds: [],
    },
  });
  expect(created.status()).toBe(201);

  await page.getByRole('button', { name: 'POS', exact: true }).click();
  const card = page.getByRole('article', { name: `Product ${prefix} burger` });
  await card.scrollIntoViewIfNeeded();
  await expect(card).toBeVisible();

  // The image must actually decode, not merely be present in the DOM.
  const image = card.locator('.product-image img');
  await expect(image).toHaveAttribute('src', '/food/riza-burger.webp');
  await expect(image).toHaveAttribute('loading', 'lazy');
  await expect
    .poll(async () => image.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0), {
      timeout: 15000,
    })
    .toBe(true);

  // Card geometry: the reserved image box keeps a 4:3 ratio so lazy loading cannot
  // shift the grid, and every card in a row shares one height and footer baseline.
  const geometry = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('.product-card')];
    const rows = new Map<number, { height: number; footer: number; ratio: number }[]>();
    for (const c of cards) {
      const box = c.getBoundingClientRect();
      const footer = c.querySelector('.product-footer')?.getBoundingClientRect();
      const img = c.querySelector('.product-image')?.getBoundingClientRect();
      if (!footer || !img) continue;
      const key = Math.round(box.top);
      if (!rows.has(key)) rows.set(key, []);
      rows.get(key)!.push({
        height: Math.round(box.height),
        footer: Math.round(footer.top),
        ratio: Number((img.width / img.height).toFixed(2)),
      });
    }
    return [...rows.values()].map((row) => ({
      count: row.length,
      heights: [...new Set(row.map((r) => r.height))].length,
      footers: [...new Set(row.map((r) => r.footer))].length,
      ratios: [...new Set(row.map((r) => r.ratio))],
    }));
  });
  expect(geometry.length).toBeGreaterThan(0);
  for (const row of geometry) {
    // One distinct height and one footer baseline per row means the cards align.
    expect(row.heights, JSON.stringify(row)).toBe(1);
    expect(row.footers, JSON.stringify(row)).toBe(1);
    for (const ratio of row.ratios) expect(ratio).toBeGreaterThan(1.28);
    for (const ratio of row.ratios) expect(ratio).toBeLessThan(1.4);
  }

  // No horizontal overflow at this project's viewport.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});
