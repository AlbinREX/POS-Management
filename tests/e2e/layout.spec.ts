import { expect, test } from '@playwright/test';

test('configure areas and geometry, drag a table, receive a remote status change and archive the layout', async ({
  page,
}, info) => {
  test.setTimeout(60000);
  const errors: string[] = [];
  let simulatingOutage = false;
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.getByLabel('Organization', { exact: true }).fill('verification');
  await page.getByLabel('Branch code').fill('main');
  await page.getByLabel('Email', { exact: true }).fill(process.env.SEED_OWNER_EMAIL!);
  await page.getByLabel('Password', { exact: true }).fill(process.env.SEED_OWNER_PASSWORD!);
  const loginResponse = page.waitForResponse(
    (r) => r.url().endsWith('/api/auth/login') && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  const { accessToken } = await (await loginResponse).json();
  await page.getByRole('heading', { name: 'Home', exact: true }).waitFor();
  page.on('console', (m) => {
    if (!simulatingOutage && ['error', 'warning'].includes(m.type())) errors.push(m.text());
  });
  await page.getByRole('button', { name: 'Tables', exact: true }).click();
  const prefix = `Browser ${info.project.name}`;
  for (const example of ['Indoor', 'Terrace']) {
    await page.getByRole('button', { name: 'Add area', exact: true }).click();
    await page.getByRole('button', { name: example, exact: true }).click();
    await expect(page.getByLabel('Area name')).toHaveValue(example);
    await page.getByLabel('Area name').fill(`${prefix} ${example}`);
    await page.getByRole('button', { name: 'Save area', exact: true }).click();
    await expect(page.getByRole('form', { name: 'Area editor' })).toHaveCount(0);
    await expect(
      page.getByRole('heading', { name: `${prefix} ${example}`, exact: true }),
    ).toBeVisible();
  }
  await page.getByLabel('Area', { exact: true }).selectOption({ label: `${prefix} Indoor` });
  await page.getByRole('button', { name: 'Add table', exact: true }).click();
  await page.getByLabel('Table name', { exact: true }).fill(`${prefix} table`);
  const number = info.project.name === 'desktop' ? 301 : 302;
  await page.getByLabel('Table number (unique in branch)').fill(String(number));
  await page.getByLabel('Table height').fill('120');
  await page.getByLabel('Shape', { exact: true }).selectOption('CIRCLE');
  const createdResponse = page.waitForResponse(
    (r) => r.url().endsWith('/api/layout/tables') && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Save table', exact: true }).click();
  const created = await (await createdResponse).json();
  await expect(page.getByRole('form', { name: 'Table editor' })).toHaveCount(0);
  const mapTable = page.getByRole('button', { name: new RegExp(`^Table ${number}:`) });
  await expect(mapTable).toBeVisible();
  // Return an old area-list response after a concurrent area commit. The map
  // cursor must precede that list read so polling cannot skip the new area.
  await page.route(
    '**/api/layout/areas?**',
    async (route) => {
      const old = await route.fetch();
      const added = await page.request.post('/api/layout/areas', {
        headers: { Authorization: `Bearer ${accessToken}`, Origin: 'http://localhost:3000' },
        data: { name: `${prefix} Garden` },
      });
      expect(added.status()).toBe(201);
      await route.fulfill({ response: old });
    },
    { times: 1 },
  );
  await page.getByRole('button', { name: 'Reload layout', exact: true }).click();
  await expect(page.getByLabel('Area', { exact: true })).toContainText(`${prefix} Garden`, {
    timeout: 12000,
  });
  await page.getByRole('button', { name: 'Arrange tables', exact: true }).click();
  await mapTable.scrollIntoViewIfNeeded();
  const box = await mapTable.boundingBox();
  expect(box).not.toBeNull();
  const geometryResponse = page.waitForResponse(
    (r) =>
      r.url().endsWith(`/api/layout/tables/${created.id}/geometry`) &&
      r.request().method() === 'PATCH',
  );
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width / 2 + 75, box!.y + box!.height / 2 + 75, { steps: 5 });
  await page.mouse.up();
  const moved = await (await geometryResponse).json();
  expect(moved.positionX).toBe(120);
  expect(moved.positionY).toBe(120);
  await expect(page.getByRole('region', { name: 'Selected table' })).toContainText(
    'Position 120, 120',
  );
  await page.getByRole('button', { name: 'Arrange tables', exact: true }).click();
  await page.getByRole('button', { name: 'Edit table', exact: true }).click();
  await page.getByLabel('Table area').selectOption({ label: `${prefix} Terrace` });
  await page.getByLabel('Shape', { exact: true }).selectOption('RECTANGLE');
  await page.getByLabel('Table width').fill('160');
  await page.getByLabel('Table height').fill('80');
  await page.getByRole('button', { name: 'Save table', exact: true }).click();
  await expect(page.getByRole('form', { name: 'Table editor' })).toHaveCount(0);
  await expect(mapTable).toHaveCount(0);
  await page.getByLabel('Area', { exact: true }).selectOption({ label: `${prefix} Terrace` });
  await mapTable.click();
  const current = await page.request.get(`/api/layout/tables/${created.id}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const remote = await page.request.patch(`/api/layout/tables/${created.id}/status`, {
    headers: { Authorization: `Bearer ${accessToken}`, Origin: 'http://localhost:3000' },
    data: { version: (await current.json()).version, status: 'RESERVED' },
  });
  expect(remote.status()).toBe(200);
  await expect(mapTable).toHaveAccessibleName(new RegExp('Reserved'), { timeout: 12000 });
  await expect(page.getByRole('button', { name: 'Edit table', exact: true })).toBeDisabled();
  await page.screenshot({ path: `.local/${info.project.name}-layout.png`, fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  simulatingOutage = true;
  await page.route('**/api/layout/**', (route) => route.abort('failed'));
  await expect(page.getByText(/Connection unavailable.*Editing paused/)).toBeVisible({
    timeout: 12000,
  });
  await expect(page.getByRole('button', { name: 'Mark free', exact: true })).toBeDisabled();
  await page.unroute('**/api/layout/**');
  await expect(
    page.getByText('Connected · Changes checked every 5 seconds', { exact: true }),
  ).toBeVisible({ timeout: 12000 });
  simulatingOutage = false;
  await page.getByRole('button', { name: 'Mark free', exact: true }).click();
  await expect(mapTable).toHaveAccessibleName(new RegExp('Free'));
  await page.getByRole('button', { name: 'Mark disabled', exact: true }).click();
  await expect(mapTable).toHaveAccessibleName(new RegExp('Disabled'));
  await page.getByRole('button', { name: 'Archive table', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm table archive', exact: true }).click();
  await expect(mapTable).toHaveCount(0);
  for (const name of [`${prefix} Terrace`, `${prefix} Indoor`, `${prefix} Garden`]) {
    await page.getByLabel('Area', { exact: true }).selectOption({ label: name });
    await page.getByRole('button', { name: 'Edit area', exact: true }).click();
    await page.getByRole('button', { name: 'Archive area', exact: true }).click();
    await page.getByRole('button', { name: 'Confirm area archive', exact: true }).click();
    await expect(page.getByRole('form', { name: 'Area editor' })).toHaveCount(0);
  }
  await page.getByRole('button', { name: 'Audit history', exact: true }).click();
  await expect(
    page.getByRole('cell', { name: 'layout.table.geometry_changed', exact: true }).first(),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  expect(errors).toEqual([]);
});
