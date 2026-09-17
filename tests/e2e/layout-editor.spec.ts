import { expect, test, type Page } from '@playwright/test';

/**
 * The visual floor-plan editor: draw, move, resize, snap, clamp, edit and save.
 *
 * Geometry is a draft until Save, so these tests assert both that dragging changes the
 * map and that nothing is written until the operator asks for it.
 */
const CANVAS = { width: 1200, height: 800 };

async function signIn(page: Page) {
  await page.goto('/');
  await page.getByLabel('Organization', { exact: true }).fill('verification');
  await page.getByLabel('Branch code').fill('main');
  await page.getByLabel('Email', { exact: true }).fill(process.env.SEED_OWNER_EMAIL!);
  await page.getByLabel('Password', { exact: true }).fill(process.env.SEED_OWNER_PASSWORD!);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('heading', { name: 'Home', exact: true }).waitFor();
}

test('draw, move, resize and save a table on the floor plan, then reload it', async ({
  page,
}, info) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    // A cold load probes the session before anyone has signed in, and the browser logs
    // that expected 401 as a console error. Same narrow gate the sync spec uses.
    if (m.location().url.includes('/api/auth/refresh') && m.text().includes('401')) return;
    if (['error', 'warning'].includes(m.type())) errors.push(m.text());
  });
  await signIn(page);
  await page.getByRole('button', { name: 'Tables', exact: true }).click();

  const prefix = `Editor ${info.project.name}`;
  const number = info.project.name === 'desktop' ? 411 : 412;
  const second = number + 40;
  await page.getByRole('button', { name: 'Add area', exact: true }).click();
  await page.getByLabel('Area name').fill(prefix);
  await page.getByRole('button', { name: 'Save area', exact: true }).click();
  await expect(page.getByRole('heading', { name: prefix, exact: true })).toBeVisible();
  await page.getByLabel('Area', { exact: true }).selectOption({ label: prefix });

  const map = page.getByRole('group', { name: `Floor plan for ${prefix}` });
  await expect(map).toBeVisible();
  /**
   * The panel and hints above the map change its page offset whenever a mode changes,
   * so every gesture measures the map itself rather than reusing an earlier origin.
   */
  /**
   * Scroll the floor plan's container so a canvas coordinate is actually on screen.
   * On a phone viewport the 1200-unit canvas is far wider than the window, and a point
   * that is scrolled out of view cannot receive a pointer event.
   */
  const scrollCanvasInto = async (x: number, y: number) => {
    await page.evaluate(
      ([cx, cy]) => {
        const svg = document.querySelector('svg[aria-label^="Floor plan"]') as SVGSVGElement | null;
        const box = document.querySelector('[aria-label="Scrollable floor plan"]');
        if (!svg || !box) return;
        const scale = svg.getBoundingClientRect().width / 1200;
        box.scrollLeft = Math.max(0, (cx as number) * scale - box.clientWidth / 2);
        box.scrollTop = Math.max(0, (cy as number) * scale - box.clientHeight / 2);
      },
      [x, y],
    );
  };
  const drag = async (
    from: readonly [number, number],
    to: readonly [number, number],
    steps = 10,
  ) => {
    // Clicking panel buttons scrolls the page, which can leave the map partly or wholly
    // outside the viewport. Bring it back before measuring, or the computed point lands
    // off-screen and the drag reaches no element at all.
    await map.scrollIntoViewIfNeeded();
    // The map is wider than a phone viewport and lives in a scrolling container, so the
    // target point must be scrolled into that container before it can be clicked.
    await scrollCanvasInto(from[0], from[1]);
    const frame = (await map.boundingBox())!;
    const scale = frame.width / CANVAS.width;
    const px = (x: number, y: number) => ({ x: frame.x + x * scale, y: frame.y + y * scale });
    const start = px(...from);
    const end = px(...to);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps });
    await page.mouse.up();
  };

  // --- 1. Draw a new table by dragging on the grid -------------------------------
  await page.getByRole('button', { name: 'Add table', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Cancel drawing', exact: true })).toBeVisible();
  // Esc leaves draw mode without creating anything.
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Add table', exact: true })).toBeVisible();
  await expect(page.getByRole('form', { name: 'Table details' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Add table', exact: true }).click();
  // Deliberately off-grid endpoints, so snapping is observable in the result.
  await drag([103, 97], [303, 237]);
  const details = page.getByRole('form', { name: 'Table details' });
  await expect(details).toBeVisible();
  await expect(page.getByLabel('Position X')).toHaveValue('100');
  await expect(page.getByLabel('Position Y')).toHaveValue('100');
  await expect(page.getByLabel('Table width')).toHaveValue('200');
  await expect(page.getByLabel('Table height')).toHaveValue('140');
  // Drawing must not have created the table yet: it exists only as a draft.
  await expect(page.getByRole('button', { name: new RegExp(`^Table ${number}:`) })).toHaveCount(0);

  // --- 5. Fill the details after placing it visually -----------------------------
  await page.getByLabel('Table name', { exact: true }).fill(`${prefix} table`);
  await page.getByLabel('Table number (unique in branch)').fill(String(number));
  await page.getByLabel('Seats', { exact: true }).fill('6');
  const created = page.waitForResponse(
    (r) => r.url().endsWith('/api/layout/tables') && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Save table', exact: true }).click();
  const row = await (await created).json();
  expect(row).toMatchObject({
    positionX: 100,
    positionY: 100,
    width: 200,
    height: 140,
    capacity: 6,
    number,
  });
  await expect(details).toHaveCount(0);
  const table = page.getByRole('button', { name: new RegExp(`^Table ${number}:`) });
  await expect(table).toBeVisible();

  // --- 2. Selecting an existing table loads its details --------------------------
  await table.click();
  await expect(details).toBeVisible();
  await expect(page.getByLabel('Table name', { exact: true })).toHaveValue(`${prefix} table`);
  await expect(page.getByLabel('Seats', { exact: true })).toHaveValue('6');
  await expect(page.getByLabel('Position X')).toHaveValue('100');

  // --- 3. Move the table, snapped to the grid ------------------------------------
  let writes = 0;
  page.on('request', (r) => {
    if (r.url().includes('/api/layout/tables/') && ['PUT', 'PATCH'].includes(r.method()))
      writes += 1;
  });
  await drag([200, 170], [403, 327]);
  await expect(page.getByLabel('Position X')).toHaveValue('300');
  await expect(page.getByLabel('Position Y')).toHaveValue('260');
  // A move is a draft edit only.
  expect(writes).toBe(0);

  // --- Reset restores the saved geometry -----------------------------------------
  await page.getByRole('button', { name: 'Reset', exact: true }).click();
  await expect(page.getByLabel('Position X')).toHaveValue('100');
  await expect(page.getByLabel('Position Y')).toHaveValue('100');

  // --- 4. Resize from a corner and from a side -----------------------------------
  // Corner: the south-east handle sits on the table's bottom-right point.
  await drag([300, 240], [400, 340]);
  await expect(page.getByLabel('Table width')).toHaveValue('300');
  await expect(page.getByLabel('Table height')).toHaveValue('240');
  // Side: the east handle changes width only.
  await drag([400, 220], [340, 220]);
  await expect(page.getByLabel('Table width')).toHaveValue('240');
  await expect(page.getByLabel('Table height')).toHaveValue('240');
  expect(writes).toBe(0);

  // --- Boundary clamping ----------------------------------------------------------
  await drag([220, 220], [2400, 1600]);
  const clampedX = Number(await page.getByLabel('Position X').inputValue());
  const clampedY = Number(await page.getByLabel('Position Y').inputValue());
  const clampedW = Number(await page.getByLabel('Table width').inputValue());
  const clampedH = Number(await page.getByLabel('Table height').inputValue());
  expect(clampedX + clampedW).toBeLessThanOrEqual(CANVAS.width);
  expect(clampedY + clampedH).toBeLessThanOrEqual(CANVAS.height);
  expect(clampedX % 20).toBe(0);
  expect(clampedY % 20).toBe(0);

  // --- 6/7. Edit metadata and save geometry and fields together -------------------
  await page.getByLabel('Position X').fill('80');
  await page.getByLabel('Position Y').fill('60');
  await page.getByLabel('Seats', { exact: true }).fill('8');
  await page.getByLabel('Table name', { exact: true }).fill(`${prefix} renamed`);
  const saved = page.waitForResponse(
    (r) => r.url().includes('/api/layout/tables/') && r.request().method() === 'PUT',
  );
  await page.getByRole('button', { name: 'Save table', exact: true }).click();
  const updated = await (await saved).json();
  expect(updated).toMatchObject({
    positionX: 80,
    positionY: 60,
    width: 240,
    height: 240,
    capacity: 8,
    name: `${prefix} renamed`,
  });
  await expect(details).toHaveCount(0);

  // --- 8. Persistence after reload ------------------------------------------------
  await page.reload();
  await page.getByRole('button', { name: 'Tables', exact: true }).click();
  await page.getByLabel('Area', { exact: true }).selectOption({ label: prefix });
  const renamed = page.getByRole('button', { name: new RegExp(`^Table ${number}:`) });
  await expect(renamed).toBeVisible();
  await renamed.click();
  await expect(page.getByLabel('Table name', { exact: true })).toHaveValue(`${prefix} renamed`);
  await expect(page.getByLabel('Position X')).toHaveValue('80');
  await expect(page.getByLabel('Position Y')).toHaveValue('60');
  await expect(page.getByLabel('Seats', { exact: true })).toHaveValue('8');
  await expect(page.getByLabel('Table width')).toHaveValue('240');

  // --- Overlap is refused before a request is ever sent ---------------------------
  await page.getByRole('button', { name: 'Add table', exact: true }).click();
  await drag([600, 400], [760, 520]);
  await page.getByLabel('Table name', { exact: true }).fill(`${prefix} second`);
  await page.getByLabel('Table number (unique in branch)').fill(String(second));
  await page.getByRole('button', { name: 'Save table', exact: true }).click();
  await expect(page.getByRole('form', { name: 'Table details' })).toHaveCount(0);
  // Move the second table onto the first and try to save.
  const secondTable = page.getByRole('button', { name: new RegExp(`^Table ${second}:`) });
  await secondTable.click();
  await page.getByLabel('Position X').fill('80');
  await page.getByLabel('Position Y').fill('60');
  await page.getByRole('button', { name: 'Save table', exact: true }).click();
  await expect(details.getByRole('alert')).toContainText('overlaps another table');

  // --- 9. Circles stay uniform ----------------------------------------------------
  await page.getByLabel('Position X').fill('600');
  await page.getByLabel('Position Y').fill('400');
  await page.getByLabel('Shape', { exact: true }).selectOption('CIRCLE');
  const width = await page.getByLabel('Table width').inputValue();
  await expect(page.getByLabel('Table height')).toHaveValue(width);
  await page.getByRole('button', { name: 'Save table', exact: true }).click();
  await expect(page.getByRole('form', { name: 'Table details' })).toHaveCount(0);

  await page.screenshot({ path: `.local/${info.project.name}-layout-editor.png`, fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );

  // --- Clean up so repeated runs stay independent ---------------------------------
  for (const n of [second, number]) {
    // The map and the list both expose a button per table, so target the map node and
    // wait for each status change to land before asking for the next one.
    const target = page.getByRole('button', { name: new RegExp(`^Table ${n}:`) }).first();
    await target.click();
    await expect(details).toBeVisible();
    await page.getByRole('button', { name: 'Mark disabled', exact: true }).click();
    await expect(target).toHaveAccessibleName(/Disabled/, { timeout: 12000 });
    await target.click();
    await page.getByRole('button', { name: 'Archive table', exact: true }).click();
    await page.getByRole('button', { name: 'Confirm table archive', exact: true }).click();
    await expect(page.getByRole('button', { name: new RegExp(`^Table ${n}:`) })).toHaveCount(0, {
      timeout: 12000,
    });
  }
  await page.getByRole('button', { name: 'Edit area', exact: true }).click();
  await page.getByRole('button', { name: 'Archive area', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm area archive', exact: true }).click();
  await expect(page.getByRole('form', { name: 'Area editor' })).toHaveCount(0);
  expect(errors).toEqual([]);
});
