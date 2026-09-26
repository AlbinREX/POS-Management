import sharp from 'sharp';
import { expect, test } from './fixtures';
import { MESSAGES } from '../../apps/admin/src/lib/i18n/messages';

/**
 * Menu management in the browser: bilingual tabs, the product drawer with a real image
 * upload, sold-out and inactive on the POS, an offer from creation to the order line, and
 * category order as the POS shows it.
 */
test('manage products, photos, sold-out, offers and order, and see them on the POS', async ({
  page,
}, info) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const prefix = `Menu ${info.project.name}`;
  const burger = `${prefix} Riza Burger`;
  const cola = `${prefix} Coca-Cola`;

  await page.goto('/');
  await page.getByLabel('Organization', { exact: true }).fill('verification');
  await page.getByLabel('Branch code').fill('main');
  await page.getByLabel('Email', { exact: true }).fill(process.env.SEED_OWNER_EMAIL!);
  await page.getByLabel('Password', { exact: true }).fill(process.env.SEED_OWNER_PASSWORD!);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('heading', { name: 'Home', exact: true }).waitFor();

  // Set-up through the normal menu API: two categories and three products.
  const token = await page.evaluate(async () => {
    const response = await fetch('/api/auth/refresh', { method: 'POST' });
    return response.ok ? ((await response.json()).accessToken as string) : '';
  });
  const headers = { Authorization: `Bearer ${token}`, Origin: process.env.APP_ORIGIN ?? 'http://localhost:3000' };
  const create = async (path: string, data: Record<string, unknown>) => {
    const response = await page.request.post('/api/' + path, { headers, data });
    expect(response.status(), path).toBe(201);
    return response.json();
  };
  const burgers = await create('menu/categories', { kind: 'categories', name: `${prefix} Burger` });
  const drinks = await create('menu/categories', { kind: 'categories', name: `${prefix} Pije` });
  const product = (name: string, sku: string, categoryId: string, sellingPrice: string, active = true) =>
    create('menu/products', {
      kind: 'products',
      name,
      sku: `${prefix}-${sku}`,
      categoryId,
      sellingPrice,
      taxRate: '0.00',
      taxMode: 'INCLUSIVE',
      active,
    });
  const burgerRow = await product(burger, 'BURGER', burgers.id, '3.50');
  await product(cola, 'COLA', drinks.id, '1.50');
  await product(`${prefix} Hidden`, 'HIDDEN', burgers.id, '2.00', false);

  // Tabs are translated, and switching language keeps the same tab selected.
  const menuNav = (locale: 'sq' | 'en') =>
    page.getByRole('navigation', { name: MESSAGES['catalog.navigation'][locale] });
  await page.getByTestId('language-sq').click();
  await page.getByTestId('nav-menu').click();
  for (const key of ['catalog.products', 'catalog.categories', 'catalog.offers'] as const)
    await expect(menuNav('sq').getByRole('button', { name: MESSAGES[key].sq, exact: true })).toBeVisible();
  await menuNav('sq').getByRole('button', { name: MESSAGES['catalog.offers'].sq, exact: true }).click();
  await page.getByTestId('language-en').click();
  await expect(menuNav('en').getByRole('button', { name: 'Offers', exact: true })).toHaveAttribute('aria-current', 'page');

  // Product drawer: upload a real PNG, mark sold out, preview, then save explicitly.
  await menuNav('en').getByRole('button', { name: 'Products', exact: true }).click();
  await page.getByLabel('Category filter').selectOption({ label: `${prefix} Burger` });
  await page.getByRole('button', { name: `Edit ${burger}`, exact: true }).click();
  const drawer = page.getByRole('dialog', { name: 'Edit product' });
  const png = await sharp({ create: { width: 600, height: 400, channels: 3, background: '#c0392b' } }).png().toBuffer();
  await drawer.getByLabel('Upload image').setInputFiles({ name: 'burger.png', mimeType: 'image/png', buffer: png });
  const uploaded = drawer.locator('.menu-image-preview img');
  await expect(uploaded).toHaveAttribute('src', /^\/api\/media\/menu\/[0-9a-f-]{36}\.webp$/);
  const imagePath = await uploaded.getAttribute('src');
  // Uploading alone changes nothing on the product until Save changes.
  const before = await (await page.request.get('/api/menu/products/' + burgerRow.id, { headers })).json();
  expect(before.imageUrl).toBeNull();
  await drawer.getByRole('checkbox', { name: /Temporarily sold out/ }).check();
  await expect(drawer.getByRole('region', { name: 'Preview' }).getByText('Sold out')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await drawer.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.getByText('Catalog saved.', { exact: true })).toBeVisible();
  await expect(drawer).toHaveCount(0);

  // POS: the uploaded photo is shown, sold-out cannot be picked, inactive is hidden.
  await page.getByRole('button', { name: 'POS', exact: true }).click();
  const card = page.getByRole('article', { name: `Product ${burger}` });
  await card.scrollIntoViewIfNeeded();
  await expect(card.locator('.product-image img')).toHaveAttribute('src', imagePath!);
  await expect
    .poll(async () => card.locator('.product-image img').evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0))
    .toBe(true);
  await expect(card.getByText('Sold out', { exact: true })).toBeVisible();
  await expect(card.locator('.product-select')).toBeDisabled();
  await expect(page.getByRole('article', { name: `Product ${prefix} Hidden` })).toHaveCount(0);

  // Back in stock, then an offer created from the Offers tab.
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await menuNav('en').getByRole('button', { name: 'Products', exact: true }).click();
  await page.getByRole('button', { name: `Edit ${burger}`, exact: true }).click();
  await drawer.getByRole('checkbox', { name: /Temporarily sold out/ }).uncheck();
  await drawer.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.getByText('Catalog saved.', { exact: true })).toBeVisible();

  await menuNav('en').getByRole('button', { name: 'Offers', exact: true }).click();
  await page.getByRole('button', { name: 'Add offer', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'New offer' });
  await editor.getByLabel('Name', { exact: true }).fill(`${prefix} deal`);
  await editor.getByLabel('Offer price').fill('2.99');
  await editor.getByRole('checkbox', { name: new RegExp(`^${burger}`) }).check();
  // The preview shows exactly what the POS will charge, beside the normal price.
  await expect(editor.getByLabel('Normal price 3.50')).toBeVisible();
  await expect(editor.getByText('2.99', { exact: true })).toBeVisible();
  await editor.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.getByText('Offer saved.', { exact: true })).toBeVisible();
  const offerRow = page.getByRole('listitem', { name: `${prefix} deal` });
  await expect(offerRow.getByText('Live', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'POS', exact: true }).click();
  await card.scrollIntoViewIfNeeded();
  await expect(card.getByLabel('Normal price 3.50')).toBeVisible();
  await expect(card.getByLabel('Offer price 2.99')).toBeVisible();
  await expect(card.getByText('OFFER', { exact: true })).toBeVisible();

  // Ordered at the offer price, with the offer frozen on the line.
  await page.getByRole('button', { name: 'Orders', exact: true }).click();
  await page.getByLabel('Order type', { exact: true }).selectOption('TAKEAWAY');
  await page.getByRole('button', { name: 'Create draft', exact: true }).click();
  await page.getByLabel('Product', { exact: true }).selectOption(burgerRow.id);
  await page.getByRole('button', { name: 'Add to order', exact: true }).click();
  const current = page.getByRole('region', { name: 'Current order' });
  await expect(current.getByText(`Offer: ${prefix} deal`)).toBeVisible();
  await expect(current.getByText(/2\.99/).first()).toBeVisible();

  // Categories: move Pije above Burger and save; the POS follows the saved order.
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await menuNav('en').getByRole('button', { name: 'Categories', exact: true }).click();
  await page.getByRole('button', { name: 'Reorder', exact: true }).click();
  const order = page.getByRole('region', { name: 'Order on the POS' }).locator('li');
  await expect(order.first()).toBeVisible();
  const position = async (name: string) =>
    (await order.allInnerTexts()).findIndex((text) => text.includes(name));
  // Swap the two categories, whichever way round they start.
  const [first, second] =
    (await position(`${prefix} Pije`)) > (await position(`${prefix} Burger`))
      ? [`${prefix} Pije`, `${prefix} Burger`]
      : [`${prefix} Burger`, `${prefix} Pije`];
  while ((await position(first)) > (await position(second)))
    await page.getByRole('button', { name: `Move ${first} up`, exact: true }).click();
  await page.getByRole('button', { name: 'Save order', exact: true }).click();
  await expect(page.getByText('Order saved.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'POS', exact: true }).click();
  const categoryStrip = page.getByRole('group', { name: 'Product categories' });
  // The POS loads its menu after opening; read the order only once both are shown.
  await expect(categoryStrip.getByRole('button', { name: first, exact: true })).toBeVisible();
  await expect(categoryStrip.getByRole('button', { name: second, exact: true })).toBeVisible();
  const strip = await categoryStrip.getByRole('button').allInnerTexts();
  expect(strip.indexOf(first)).toBeLessThan(strip.indexOf(second));

  // Featured, set from the Albanian editor: stored as the same boolean in any language,
  // and shown first within its own category on the POS without changing its price.
  const late = await product(`${prefix} Double Burger`, 'DOUBLE', burgers.id, '4.50');
  await page.getByTestId('language-sq').click();
  await page.getByTestId('nav-menu').click();
  await menuNav('sq').getByRole('button', { name: MESSAGES['catalog.products'].sq, exact: true }).click();
  await page.getByRole('button', { name: MESSAGES['catalog.editNamed'].sq.replace('{name}', late.name), exact: true }).click();
  const sqDrawer = page.getByRole('dialog', { name: MESSAGES['catalog.editProduct'].sq });
  await sqDrawer.getByRole('checkbox', { name: new RegExp(`^${MESSAGES['catalog.featured'].sq}`) }).check();
  await sqDrawer.getByRole('button', { name: MESSAGES['catalog.saveChanges'].sq, exact: true }).click();
  await expect(sqDrawer).toHaveCount(0);
  const stored = await (await page.request.get('/api/menu/products/' + late.id, { headers })).json();
  expect([stored.featured, stored.sellingPrice]).toEqual([true, '4.50']);
  await page.getByTestId('language-en').click();
  await page.getByRole('button', { name: 'POS', exact: true }).click();
  await page.getByRole('group', { name: 'Product categories' }).getByRole('button', { name: `${prefix} Burger`, exact: true }).click();
  const names = page.locator('.product-grid .product-card h3');
  await expect(names.first()).toHaveText(late.name);
  const shown = await names.allInnerTexts();
  expect(shown.indexOf(late.name)).toBeLessThan(shown.indexOf(burger));
  await expect(page.getByRole('article', { name: `Product ${late.name}` }).getByText('4.50')).toBeVisible();

  // Leave no live promotion behind for other specs that share this database.
  const offers = await (await page.request.get('/api/offers', { headers })).json();
  const deal = offers.find((o: { name: string }) => o.name === `${prefix} deal`);
  const archived = await page.request.post(`/api/offers/${deal.id}/archive`, { headers, data: { version: deal.version } });
  expect(archived.status()).toBe(201);
  expect(errors).toEqual([]);
});
