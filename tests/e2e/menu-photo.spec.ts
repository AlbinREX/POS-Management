import sharp from 'sharp';
import { expect, test, type Page } from './fixtures';

/**
 * Product photos chosen on this PC: previewed locally, uploaded only by Save changes, and
 * stored as an uploaded media path, never as a local file path.
 */
const image = (format: 'png' | 'jpeg' | 'webp' | 'gif', background = '#c0392b') =>
  sharp({ create: { width: 480, height: 360, channels: 3, background } })[format]().toBuffer();
const MIME = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' } as const;

async function signIn(page: Page) {
  await page.goto('/');
  await page.getByLabel('Organization', { exact: true }).fill('verification');
  await page.getByLabel('Branch code').fill('main');
  await page.getByLabel('Email', { exact: true }).fill(process.env.SEED_OWNER_EMAIL!);
  await page.getByLabel('Password', { exact: true }).fill(process.env.SEED_OWNER_PASSWORD!);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('heading', { name: 'Home', exact: true }).waitFor();
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
  const read = async (id: string) =>
    (await (await page.request.get('/api/menu/products/' + id, { headers })).json()) as { imageUrl: string | null };
  return { create, read };
}

async function productSetup(page: Page, prefix: string) {
  const api = await signIn(page);
  const category = await api.create('menu/categories', { kind: 'categories', name: `${prefix} Photos` });
  const product = await api.create('menu/products', {
    kind: 'products',
    name: `${prefix} Photo Burger`,
    sku: `${prefix}-PHOTO`,
    categoryId: category.id,
    sellingPrice: '3.10',
    taxRate: '0.00',
    taxMode: 'INCLUSIVE',
  });
  return { ...api, category, product };
}

test('a photo chosen on this PC is previewed, and uploaded only by Save changes', async ({ page }, info) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  let uploads = 0;
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url().includes('/api/media/menu')) uploads++;
  });
  const prefix = `Photo ${info.project.name}`;
  const { product, read } = await productSetup(page, prefix);
  const open = async () => {
    await page.getByRole('button', { name: `Edit ${product.name}`, exact: true }).click();
    return page.getByRole('dialog', { name: 'Edit product' });
  };
  // "Choose photo normally" opens the browser's own single-file chooser.
  const chooseNormally = async (drawer: ReturnType<typeof page.getByRole>, name: string, format: keyof typeof MIME) => {
    const chooser = page.waitForEvent('filechooser');
    await drawer.getByRole('button', { name: 'Choose photo normally', exact: true }).click();
    const picker = await chooser;
    expect(picker.isMultiple()).toBe(false);
    await picker.setFiles({ name, mimeType: MIME[format], buffer: await image(format) });
  };

  await page.getByTestId('nav-menu').click();
  await page.getByLabel('Category filter').selectOption({ label: `${prefix} Photos` });
  let drawer = await open();
  const field = drawer.getByRole('group', { name: 'Product photo' });
  await expect(field.getByRole('button', { name: 'Browse photos on this device', exact: true })).toBeVisible();
  const preview = field.locator('.menu-image-preview img');

  // Choose, preview, then clear: back to no photo, nothing uploaded.
  await chooseNormally(drawer, 'Riza Burger.png', 'png');
  await expect(field.getByText('Riza Burger.png', { exact: true })).toBeVisible();
  await expect(field.getByText('Ready to save', { exact: true })).toBeVisible();
  await expect(preview).toHaveAttribute('src', /^data:image\/png;base64,/);
  await expect(drawer.getByRole('region', { name: 'Preview' }).locator('img')).toHaveAttribute('src', /^data:image\/png/);
  await field.getByRole('button', { name: 'Clear selection', exact: true }).click();
  await expect(field.getByText('Ready to save', { exact: true })).toHaveCount(0);
  await expect(preview).toHaveCount(0);

  // A file that is not PNG, JPEG or WebP is refused at once and changes nothing.
  await chooseNormally(drawer, 'Animated.gif', 'gif');
  await expect(field.getByRole('alert')).toHaveText('Choose a PNG, JPEG or WebP image');
  await expect(preview).toHaveCount(0);

  // Cancel with Escape: the chosen JPEG is discarded, never uploaded, never saved.
  await chooseNormally(drawer, 'Chicken.jpg', 'jpeg');
  await expect(preview).toHaveAttribute('src', /^data:image\/jpeg;base64,/);
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);
  expect(uploads).toBe(0);
  expect((await read(product.id)).imageUrl).toBeNull();

  // Save changes uploads once and stores the managed path, never a local one.
  drawer = await open();
  await chooseNormally(drawer, 'Riza Burger.png', 'png');
  await drawer.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(drawer).toHaveCount(0);
  expect(uploads).toBe(1);
  const stored = (await read(product.id)).imageUrl!;
  expect(stored).toMatch(/^\/api\/media\/menu\/[0-9a-f-]{36}\.webp$/);
  expect(stored).not.toMatch(/[A-Za-z]:|\\|Users|Riza Burger/);

  // An upload that fails leaves the product and its saved photo exactly as they were.
  drawer = await open();
  await expect(drawer.getByRole('group', { name: 'Product photo' }).locator('.menu-image-preview img')).toHaveAttribute('src', stored);
  await page.route('**/api/media/menu', (route) =>
    route.fulfill({ status: 413, contentType: 'application/json', body: JSON.stringify({ statusCode: 413, message: 'Images must be 5 MB or smaller' }) }),
  );
  await chooseNormally(drawer, 'Wrap It Up.webp', 'webp');
  await drawer.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(drawer.getByRole('alert').filter({ hasText: 'Images must be 5 MB or smaller' })).toBeVisible();
  await expect(drawer).toBeVisible();
  expect((await read(product.id)).imageUrl).toBe(stored);
  await page.unroute('**/api/media/menu');
  await drawer.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect((await read(product.id)).imageUrl).toBe(stored);

  // The upload succeeds but the save is refused: the choice stays pending and clearable,
  // and the retry reuses that upload rather than sending the file again.
  drawer = await open();
  const photoField = drawer.getByRole('group', { name: 'Product photo' });
  await chooseNormally(drawer, 'Pice Proshute.png', 'png');
  await page.route(`**/api/menu/products/${product.id}`, (route) =>
    route.request().method() === 'PUT'
      ? route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ statusCode: 409, message: 'This record changed. Reload before saving.' }) })
      : route.continue(),
  { times: 1 });
  const beforeRetry = uploads;
  await drawer.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(drawer.getByRole('alert').filter({ hasText: 'This record changed' })).toBeVisible();
  expect(uploads).toBe(beforeRetry + 1);
  await expect(photoField.getByText('Ready to save', { exact: true })).toBeVisible();
  await expect(photoField.getByText('Pice Proshute.png', { exact: true })).toBeVisible();
  await expect(photoField.getByRole('button', { name: 'Clear selection', exact: true })).toBeVisible();
  expect((await read(product.id)).imageUrl).toBe(stored);
  await drawer.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(drawer).toHaveCount(0);
  expect(uploads).toBe(beforeRetry + 1);
  const replaced = (await read(product.id)).imageUrl!;
  expect(replaced).toMatch(/^\/api\/media\/menu\/[0-9a-f-]{36}\.webp$/);
  expect(replaced).not.toBe(stored);

  // Escape while a save is running does not pretend to cancel it: the editor stays open
  // until the save completes.
  drawer = await open();
  await chooseNormally(drawer, 'Fanta.png', 'png');
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route('**/api/media/menu', async (route) => {
    await held;
    await route.continue();
  }, { times: 1 });
  await drawer.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect.poll(() => uploads).toBe(beforeRetry + 2);
  await page.keyboard.press('Escape');
  await expect(drawer).toBeVisible();
  release();
  await expect(drawer).toHaveCount(0);
  const latest = (await read(product.id)).imageUrl!;
  expect(latest).not.toBe(replaced);

  // Remove photo is also only applied by Save changes.
  drawer = await open();
  await drawer.getByRole('group', { name: 'Product photo' }).getByRole('button', { name: 'Remove photo', exact: true }).click();
  await expect(drawer.getByText('The photo will be removed when you press Save changes.')).toBeVisible();
  expect((await read(product.id)).imageUrl).toBe(latest);
  await drawer.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(drawer).toHaveCount(0);
  expect((await read(product.id)).imageUrl).toBeNull();
  expect(errors).toEqual([]);
});

test('"Browse photos on this device" uses the native picker, in Albanian and English alike', async ({ page }, info) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // Stand in for the operating system's file dialog, recording what the page asked of it.
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__pickerCalls = [];
    Object.defineProperty(window, 'showOpenFilePicker', {
      configurable: true,
      value: async (options: unknown) => {
        (w.__pickerCalls as unknown[]).push(options);
        if (w.__pickerCancel) throw new DOMException('The user aborted a request.', 'AbortError');
        const bytes = Uint8Array.from(atob(String(w.__pickerBytes)), (c) => c.charCodeAt(0));
        return [{ getFile: async () => new File([bytes], String(w.__pickerName), { type: String(w.__pickerType) }) }];
      },
    });
  });
  const prefix = `Browse ${info.project.name}`;
  const { product, read } = await productSetup(page, prefix);
  const jpeg = (await image('jpeg', '#f4c451')).toString('base64');
  await page.evaluate((bytes) => {
    const w = window as unknown as Record<string, unknown>;
    Object.assign(w, { __pickerBytes: bytes, __pickerName: 'Chicken Classic Delight.jpg', __pickerType: 'image/jpeg', __pickerCancel: true });
  }, jpeg);

  await page.getByTestId('language-sq').click();
  await page.getByTestId('nav-menu').click();
  await page.getByLabel('Kategoria').selectOption({ label: `${prefix} Photos` });
  await page.getByRole('button', { name: `Ndrysho ${product.name}`, exact: true }).click();
  const drawer = page.getByRole('dialog', { name: 'Ndrysho produktin' });
  const field = drawer.getByRole('group', { name: 'Foto e produktit' });
  const browse = field.getByRole('button', { name: 'Shfleto fotot në pajisje', exact: true });
  await expect(field.getByRole('button', { name: 'Zgjidh foto normalisht', exact: true })).toBeVisible();
  await expect(field.getByText(/Herën e parë, shko te dosja e fotove të menysë/)).toBeVisible();

  // Cancelling the dialog is not an error and changes nothing.
  await browse.click();
  await expect(field.getByRole('alert')).toHaveCount(0);
  await expect(field.locator('.menu-image-preview img')).toHaveCount(0);

  await page.evaluate(() => Object.assign(window, { __pickerCancel: false }));
  await browse.click();
  await expect(field.getByText('Chicken Classic Delight.jpg', { exact: true })).toBeVisible();
  await expect(field.getByText('Gati për ruajtje', { exact: true })).toBeVisible();
  await expect(field.locator('.menu-image-preview img')).toHaveAttribute('src', /^data:image\/jpeg;base64,/);
  const calls = await page.evaluate(() => (window as unknown as { __pickerCalls: unknown[] }).__pickerCalls);
  expect(calls).toHaveLength(2);
  expect(calls[1]).toEqual({
    id: 'riza-menu-photos',
    multiple: false,
    excludeAcceptAllOption: true,
    types: [
      {
        description: 'PNG, JPEG, WebP',
        accept: { 'image/png': ['.png'], 'image/jpeg': ['.jpg', '.jpeg'], 'image/webp': ['.webp'] },
      },
    ],
  });
  expect((await read(product.id)).imageUrl).toBeNull();

  await drawer.getByRole('button', { name: 'Ruaj ndryshimet', exact: true }).click();
  await expect(drawer).toHaveCount(0);
  const stored = (await read(product.id)).imageUrl!;
  expect(stored).toMatch(/^\/api\/media\/menu\/[0-9a-f-]{36}\.webp$/);

  // The stored value is the same whichever language the editor was used in.
  await page.getByTestId('language-en').click();
  await page.getByRole('button', { name: `Edit ${product.name}`, exact: true }).click();
  const english = page.getByRole('dialog', { name: 'Edit product' }).getByRole('group', { name: 'Product photo' });
  await expect(english.locator('.menu-image-preview img')).toHaveAttribute('src', stored);
  await expect(english.getByRole('button', { name: 'Browse photos on this device', exact: true })).toBeEnabled();
  expect(errors).toEqual([]);
});
