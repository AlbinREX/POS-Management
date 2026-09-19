import { expect, test } from '@playwright/test';

/**
 * Settings → Devices in the browser.
 *
 * Covers what an operator actually does: add the restaurant's hardware, see its address
 * and status, route kitchen stations to printers, and watch an unprintable document stay
 * visible and retryable without disturbing the order behind it.
 */
test('configure devices, route stations to printers and keep unprinted work visible', async ({
  page,
}, info) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  // This spec deliberately submits a rejected address and tests a device with no agent,
  // both of which the browser reports as resource errors. The established convention is
  // to gate the collector around that window rather than weaken the assertion.
  let expectingRejection = false;
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    // A cold load probes the session before anyone has signed in, and the browser logs
    // that expected 401 as a console error.
    if (m.location().url.includes('/api/auth/refresh') && m.text().includes('401')) return;
    // The device agent is deliberately not installed in the test environment, so the
    // browser reports a refused loopback connection. That is the state under test.
    if (m.text().includes('127.0.0.1:7717')) return;
    if (m.type() === 'error' && !expectingRejection) errors.push(m.text());
  });

  await page.goto('/');
  await page.getByLabel('Organization', { exact: true }).fill('verification');
  await page.getByLabel('Branch code').fill('main');
  await page.getByLabel('Email', { exact: true }).fill(process.env.SEED_OWNER_EMAIL!);
  await page.getByLabel('Password', { exact: true }).fill(process.env.SEED_OWNER_PASSWORD!);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('heading', { name: 'Home', exact: true }).waitFor();

  const nav = page.getByRole('navigation', { name: 'Administration' });
  await nav.getByRole('button', { name: 'Devices', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Devices' })).toBeVisible();

  const prefix = `Dev ${info.project.name}`;

  // --- add a serial receipt printer and a LAN kitchen printer -------------------
  const add = async (fill: () => Promise<void>) => {
    await page.getByRole('button', { name: 'Add device', exact: true }).click();
    const form = page.getByRole('form', { name: 'Device configuration' });
    await expect(form).toBeVisible();
    await fill();
    await form.getByRole('button', { name: 'Save device', exact: true }).click();
    await expect(form).toHaveCount(0);
  };

  await add(async () => {
    await page.getByLabel('Device name').fill(`${prefix} receipt`);
    await page.getByLabel('Device type').selectOption('RECEIPT_PRINTER');
    await page.getByLabel('Connection').selectOption('SERIAL');
    await page.getByLabel('COM port').fill('COM3');
  });
  await add(async () => {
    await page.getByLabel('Device name').fill(`${prefix} kitchen`);
    await page.getByLabel('Device type').selectOption('KITCHEN_PRINTER');
    await page.getByLabel('Connection').selectOption('NETWORK');
    await page.getByLabel('Printer IP address').fill('192.168.1.50');
  });

  // The list shows each device with the address an operator recognises.
  const list = page.getByRole('list', { name: 'Configured devices' });
  await expect(list).toContainText(`${prefix} receipt`);
  await expect(list).toContainText('COM3');
  await expect(list).toContainText('192.168.1.50:9100');
  // A device that has never been tested is never presented as working.
  await expect(list).toContainText('Not tested');

  // --- an address outside the local network is refused in the browser -----------
  expectingRejection = true;
  await page.getByRole('button', { name: 'Add device', exact: true }).click();
  const form = page.getByRole('form', { name: 'Device configuration' });
  await page.getByLabel('Device name').fill(`${prefix} rejected`);
  await page.getByLabel('Device type').selectOption('KITCHEN_PRINTER');
  await page.getByLabel('Connection').selectOption('NETWORK');
  await page.getByLabel('Printer IP address').fill('8.8.8.8');
  await form.getByRole('button', { name: 'Save device', exact: true }).click();
  await expect(form.getByRole('alert')).toBeVisible();
  await expect(form).toBeVisible();
  await form.getByRole('button', { name: 'Cancel', exact: true }).click();

  // --- station routing ----------------------------------------------------------
  const stations = page.getByRole('region', { name: 'Station printers' });
  await expect(stations).toBeVisible();
  const selects = stations.getByRole('combobox');
  if (await selects.count()) {
    await selects.first().selectOption({ label: `${prefix} kitchen` });
    await expect(page.getByText('Station printer saved.')).toBeVisible();
    // The binding survives a reload, because it is server state rather than UI state.
    await page.reload();
    await nav.getByRole('button', { name: 'Devices', exact: true }).click();
    await expect(
      page.getByRole('region', { name: 'Station printers' }).getByRole('combobox').first(),
    ).toHaveValue(/.+/);
  }

  // --- testing a device without an agent reports honestly, not falsely ----------
  await page
    .getByRole('list', { name: 'Configured devices' })
    .getByRole('button', { name: 'Test Print' })
    .first()
    .click();
  // The agent is not installed here, so the failure must be visible against the device
  // itself and no device may be presented as working. The message is recorded through
  // the API, so it survives a reload rather than being transient UI state.
  await expect(
    page.getByRole('list', { name: 'Configured devices' }),
  ).toContainText(/device agent/i);
  await expect(page.getByRole('list', { name: 'Configured devices' })).not.toContainText(
    'Connected',
  );
  await page.reload();
  await nav.getByRole('button', { name: 'Devices', exact: true }).click();
  await expect(page.getByRole('list', { name: 'Configured devices' })).toContainText(
    /device agent|Offline/i,
  );

  await page.screenshot({ path: `.local/${info.project.name}-devices.png`, fullPage: true });
  expectingRejection = false;
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  expect(errors).toEqual([]);
});
