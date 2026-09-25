import { test, expect } from '@playwright/test';
import { MESSAGES, type MessageKey } from '../../apps/admin/src/lib/i18n/messages';

test('Albanian default, English selection and persistence including query override', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('lang', 'sq');
  await expect(page.getByTestId('login-submit')).toHaveText('Hyr');
  const defaultManifest = await (await page.request.get('/manifest.webmanifest')).json();
  expect(defaultManifest).toMatchObject({
    lang: 'sq',
    start_url: '/waiter',
    scope: '/',
    name: MESSAGES['pwa.name'].sq,
  });
  await page.getByTestId('language-en').click();
  await expect(page.getByTestId('login-submit')).toHaveText('Sign in');
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
    'href',
    '/manifest.webmanifest?lang=en',
  );
  const englishManifest = await (await page.request.get('/manifest.webmanifest?lang=en')).json();
  expect(englishManifest).toMatchObject({
    lang: 'en',
    start_url: '/waiter',
    scope: '/',
    name: MESSAGES['pwa.name'].en,
  });
  expect(englishManifest.icons).toEqual(defaultManifest.icons);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.getByTestId('login-submit')).toHaveText('Sign in');
  await page.goto('/?lang=en');
  await page.getByTestId('language-sq').click();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'sq');
  await expect(page.getByTestId('login-submit')).toHaveText('Hyr');
});

test('workspace modules and draft commands work in both languages with stable internal values', async ({
  page,
}, info) => {
  test.setTimeout(90000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.getByTestId('field-organization').fill('verification');
  await page.getByTestId('field-branch').fill('main');
  await page.getByTestId('field-email').fill(process.env.SEED_OWNER_EMAIL!);
  await page.getByTestId('field-password').fill(process.env.SEED_OWNER_PASSWORD!);
  await page.getByTestId('login-submit').click();
  await expect(page.getByTestId('nav-workspace')).toBeVisible();
  for (const locale of ['sq', 'en'] as const) {
    await page.getByTestId(`language-${locale}`).click();
    const modules = [
      ['dashboard', 'nav.dashboard'],
      ['pos', 'nav.pos'],
      ['menu', 'nav.menu'],
      ['layout', 'nav.layout'],
      ['orders', 'nav.orders'],
      ['kitchen', 'nav.kitchen'],
      ['payments', 'nav.payments'],
      ['inventory', 'nav.inventory'],
      ['purchasing', 'nav.purchasing'],
      ['companies', 'nav.companies'],
      ['team', 'nav.team'],
      ['roles', 'nav.roles'],
      ['terminals', 'nav.terminals'],
      ['devices', 'nav.devices'],
    ];
    for (const [id, key] of modules) {
      await page.getByTestId(`nav-${id}`).click();
      await expect(page.getByTestId(`nav-${id}`)).toHaveAttribute('aria-current', 'page');
      await expect(page.locator('main h1')).toHaveText(MESSAGES[key as MessageKey][locale]);
      if (id === 'pos') {
        await expect(
          page.getByText(MESSAGES['sales.startOrSwitchOrder'][locale], { exact: false }),
        ).toBeVisible();
        await expect(
          page.getByText(MESSAGES['sales.searchTheMenu'][locale], { exact: true }),
        ).toBeVisible();
      }
      if (id === 'devices') {
        await expect(
          page.getByRole('heading', { name: MESSAGES['devices.stationPrintersTitle'][locale] }),
        ).toBeVisible();
        await expect(
          page.getByRole('button', { name: MESSAGES['devices.add'][locale], exact: true }),
        ).toBeVisible();
      }
    }
    await page.getByTestId('nav-orders').click();
    await expect(page.getByTestId('create-draft')).toHaveText(
      locale === 'sq' ? 'Krijo porosi paraprake' : 'Create draft',
    );
    await page.getByTestId('order-type').selectOption('TAKEAWAY');
    await expect(page.getByTestId('order-type')).toHaveValue('TAKEAWAY');
    const notes = `Bilingual ${locale} ${info.project.name}`;
    await page.getByTestId('order-notes').fill(notes);
    const response = page.waitForResponse(
      (r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/orders',
    );
    await page.getByTestId('create-draft').click();
    const result = await response;
    expect(result.ok()).toBe(true);
    expect(result.request().postDataJSON()).toMatchObject({ type: 'TAKEAWAY', notes });
    await expect(page.getByTestId('create-draft')).toBeEnabled();
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('lang', locale);
    await expect(page.getByTestId('nav-workspace')).toBeVisible();
  }
  expect(errors).toEqual([]);
});

test('raw API failures translate on display and waiter and KDS shells follow the saved language', async ({
  page,
}) => {
  await page.route('**/api/auth/login', (route) =>
    route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'Authentication required', statusCode: 401 }),
    }),
  );
  await page.goto('/');
  await page.getByTestId('field-organization').fill('verification');
  await page.getByTestId('field-branch').fill('main');
  await page.getByTestId('field-email').fill('test@example.test');
  await page.getByTestId('field-password').fill('incorrect-password');
  await page.getByTestId('login-submit').click();
  await expect(page.locator('main').getByRole('alert')).toContainText(
    'Kërkohet vërtetimi i identitetit',
  );
  await page.getByTestId('language-en').click();
  await expect(page.locator('main').getByRole('alert')).toContainText('Authentication required');
  for (const path of ['/waiter', '/kds']) {
    await page.goto(path);
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.getByTestId('login-submit')).toHaveText('Sign in');
    await page.getByTestId('language-sq').click();
    await expect(page.getByTestId('login-submit')).toHaveText('Hyr');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('lang', 'sq');
    await page.getByTestId('language-en').click();
  }
});
