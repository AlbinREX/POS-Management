import { expect, test } from '@playwright/test';

test('the header reports local connectivity and sync state, and never caches authenticated data', async ({
  page,
}, info) => {
  test.setTimeout(90000);
  const errors: string[] = [];
  // This spec deliberately aborts requests to prove the unavailable state, which the
  // browser reports as a console error. The established convention is to gate the
  // collector around that window rather than to weaken the assertion.
  let networkTest = false;
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.location().url.includes('/api/auth/refresh') && m.text().includes('401')) return;
    if (m.type() === 'error' && !networkTest) errors.push(m.text());
  });
  const origin = process.env.APP_ORIGIN ?? 'http://localhost:3000';

  await page.goto('/');
  await expect(page).toHaveTitle('FastFood Riza · POS');
  await page.getByLabel('Organization', { exact: true }).fill('verification');
  await page.getByLabel('Branch code').fill('main');
  await page.getByLabel('Email', { exact: true }).fill(process.env.SEED_OWNER_EMAIL!);
  await page.getByLabel('Password', { exact: true }).fill(process.env.SEED_OWNER_PASSWORD!);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();

  // The indicator is a desktop-header affordance. At phone widths the header's flex row
  // has no spare width, and an overflowing mobile page is rescaled by the browser, so it
  // is deliberately not rendered there. Each project asserts the contract that applies.
  const desktop = info.project.name === 'desktop';
  const indicator = page.getByRole('status').filter({ hasText: 'Restaurant server' });
  if (!desktop) {
    await expect(indicator).toHaveCount(0);
    // The regression this guards: a header wider than the layout viewport rescales the
    // page and makes every modal interaction unstable.
    const overflow = await page.evaluate(() => ({
      scrollW: document.documentElement.scrollWidth,
      clientW: document.documentElement.clientWidth,
    }));
    expect(overflow.scrollW).toBeLessThanOrEqual(overflow.clientW);
  }
  if (desktop) await expect(indicator.first()).toContainText('Restaurant server connected');
  // No cloud target is configured in verification, so delivery is reported as such
  // rather than as healthy.
  // Below 640px the sync half is hidden so the header stays short on a phone, while the
  // wording remains in the accessible name. Asserting the accessible name tests the same
  // guarantee on both viewports rather than only where the text is painted.
  if (desktop) await expect(indicator.first()).toHaveAccessibleName(/Cloud sync not configured/);

  // The status endpoint is branch scoped and refuses a client-supplied scope.
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
  const body = await owner.json();
  const headers = { Origin: origin, Authorization: 'Bearer ' + body.accessToken };
  const status = await page.request.get('/api/sync/status', { headers });
  expect(status.status()).toBe(200);
  const payload = await status.json();
  expect(payload.localAuthoritative).toBe(true);
  expect(payload.branchId).toBe(body.user.branchId);
  expect(payload.streams).toHaveLength(7);
  const scoped = await page.request.get(`/api/sync/status?branchId=${body.user.branchId}`, {
    headers,
  });
  expect(scoped.status()).toBe(400);
  const anonymous = await page.request.get('/api/sync/status', { headers: { Origin: origin } });
  expect(anonymous.status()).toBe(401);

  // Losing the local server must read as a local failure, not as an internet problem.
  // A session with sync.read probes sync/status; one without probes the public
  // health/ready route, so both are aborted to simulate an unreachable server.
  networkTest = true;
  await page.route('**/api/sync/status', (route) => route.abort());
  await page.route('**/api/health/ready', (route) => route.abort());
  if (desktop)
    await expect(indicator.first()).toContainText('Restaurant server unavailable', {
      timeout: 30000,
    });
  await page.unroute('**/api/sync/status');
  await page.unroute('**/api/health/ready');
  if (desktop)
    await expect(indicator.first()).toContainText('Restaurant server connected', {
      timeout: 30000,
    });
  networkTest = false;

  // Goal 12: the waiter service worker must never persistently cache authenticated data.
  const worker = await page.request.get('/sw.js');
  expect(worker.status()).toBe(200);
  const source = await worker.text();
  expect(source).toContain("url.pathname.startsWith('/api/')");
  // The early return for /api precedes every cache write in the fetch handler.
  const fetchHandler = source.slice(source.indexOf("addEventListener('fetch'"));
  expect(fetchHandler.indexOf("startsWith('/api/')")).toBeLessThan(fetchHandler.indexOf('caches.'));

  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  expect(errors).toEqual([]);
  expect(info.project.name.length).toBeGreaterThan(0);
});
