import { test, expect } from './fixtures';
test('sign in, register a terminal, inspect audit, restore session, sign out', async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page).toHaveTitle('FastFood Riza · POS');
  await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
  await page.getByLabel('Organization', { exact: true }).fill('verification');
  await page.getByLabel('Branch code').fill('main');
  await page.getByLabel('Email', { exact: true }).fill(process.env.SEED_OWNER_EMAIL!);
  await page.getByLabel('Password', { exact: true }).fill(process.env.SEED_OWNER_PASSWORD!);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Home', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Terminals', exact: true }).click();
  const name = `Browser ${info.project.name}`;
  await page.getByLabel('Terminal name').fill(name);
  await page.getByRole('button', { name: 'Register terminal' }).click();
  await expect(page.getByRole('cell', { name, exact: false }).first()).toBeVisible();
  await page.screenshot({ path: `.local/${info.project.name}-terminals.png`, fullPage: true });
  await page.getByRole('button', { name: 'Audit history', exact: true }).click();
  await expect(
    page.getByRole('cell', { name: 'terminal.registered', exact: true }).first(),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Home', exact: true })).toBeVisible();
  const storage = await page.evaluate(() => ({
    local: { ...localStorage },
    session: { ...sessionStorage },
  }));
  expect(storage).toEqual({ local: { 'riza.locale': 'en' }, session: {} });
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});
