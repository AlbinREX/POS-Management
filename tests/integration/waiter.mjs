import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import request from 'supertest';
const require = createRequire(import.meta.url);
const { createDatabase } = require('@restaurant/database');
export async function runWaiterIntegration(app) {
  const db = createDatabase(process.env.MIGRATION_DATABASE_URL);
  const http = request(app.getHttpServer()),
    origin = process.env.APP_ORIGIN;
  let count = 0;
  const test = async (name, fn) => {
    await fn();
    console.log(`PASS waiter ${++count}: ${name}`);
  };
  try {
    const auth = (
      await http
        .post('/api/auth/login')
        .set('Origin', origin)
        .send({
          organization: 'verification',
          branch: 'main',
          email: process.env.SEED_OWNER_EMAIL,
          password: process.env.SEED_OWNER_PASSWORD,
        })
        .expect(200)
    ).body;
    const scope = { branchId: auth.user.branchId, organizationId: auth.user.organizationId };
    const call = (method, path, token = auth.accessToken) =>
      http[method]('/api/' + path)
        .set('Origin', origin)
        .set('Authorization', 'Bearer ' + token);
    const post = async (path, data, status = 201, token) =>
      (await call('post', path, token).send(data).expect(status)).body;
    const get = async (path, status = 200, token) =>
      (await call('get', path, token).expect(status)).body;
    const cmd = (x) => ({ commandId: randomUUID(), ...x });
    const password = 'Waiter-surface-password-10!';
    const email = 'waiter-surface@verification.test';

    // Fixtures the waiter surface reads: an area, a table, a category and a product.
    const area = await post('layout/areas', { name: 'Waiter terrace', sortOrder: 40 });
    const table = await post('layout/tables', {
      areaId: area.id,
      name: 'W1',
      number: 91001,
      capacity: 4,
      positionX: 10,
      positionY: 10,
      width: 90,
      height: 90,
      shape: 'SQUARE',
    });
    const category = await post('menu/categories', { kind: 'categories', name: 'Waiter menu' });
    const product = await post('menu/products', {
      kind: 'products',
      name: 'Waiter plate',
      sku: 'WAITER-10',
      categoryId: category.id,
      sellingPrice: '9.00',
      taxRate: '0.00',
      taxMode: 'INCLUSIVE',
      modifierGroupIds: [],
      kitchenStationIds: [],
    });
    const station = await post('menu/kitchen-stations', {
      kind: 'kitchen-stations',
      name: 'Waiter pass',
    });
    await call('put', `menu/products/${product.id}`)
      .send({
        version: product.version,
        data: {
          kind: 'products',
          name: 'Waiter plate',
          sku: 'WAITER-10',
          categoryId: category.id,
          sellingPrice: '9.00',
          taxRate: '0.00',
          taxMode: 'INCLUSIVE',
          modifierGroupIds: [],
          kitchenStationIds: [station.id],
        },
      })
      .expect(200);

    let waiter, role, order;
    await test('a waiter role reads tables, menu and orders but no privileged surface', async () => {
      const roles = await get('roles');
      role = roles.find((r) => r.name === 'WAITER');
      assert.ok(role, 'seeded WAITER role must exist');
      assert.deepEqual(
        role.permissions.map((p) => p.permissionKey).sort(),
        ['layout.read', 'menu.read', 'order.manage', 'order.read', 'order.submit_kitchen'],
      );
      await post('users', { name: 'Waiter surface', email, password, roleIds: [role.id] });
      waiter = (
        await http
          .post('/api/auth/login')
          .set('Origin', origin)
          .send({ organization: 'verification', branch: 'main', email, password })
          .expect(200)
      ).body;
      // The mobile surface needs exactly these reads.
      await get('layout/areas', 200, waiter.accessToken);
      await get('layout/tables', 200, waiter.accessToken);
      await get('layout/changes?after=0', 200, waiter.accessToken);
      await get('menu/products', 200, waiter.accessToken);
      await get('orders', 200, waiter.accessToken);
      // And must not reach administrative or financial surfaces.
      for (const denied of [
        'kitchen/tickets',
        'payments/shifts',
        'orders/waiters',
        'users',
        'audit-logs',
        'companies',
      ])
        await get(denied, 403, waiter.accessToken);
    });

    await test('a waiter opens a dine-in order and the table becomes occupied', async () => {
      order = await post(
        'orders',
        cmd({ type: 'DINE_IN', tableId: table.id, waiterId: waiter.user.id, notes: 'Terrace' }),
        201,
        waiter.accessToken,
      );
      assert.equal(order.type, 'DINE_IN');
      assert.equal(order.tableId, table.id);
      const tables = await get('layout/tables', 200, waiter.accessToken);
      assert.equal(tables.items.find((t) => t.id === table.id).status, 'OCCUPIED');
    });

    await test('adding an item preserves immutable product and price snapshots', async () => {
      order = await post(
        `orders/${order.id}/commands`,
        cmd({
          version: order.version,
          action: 'add_item',
          productId: product.id,
          quantity: 2,
          modifierIds: [],
          notes: 'No ice',
        }),
        201,
        waiter.accessToken,
      );
      const line = order.items.find((i) => !i.voidedAt);
      assert.equal(line.productName, 'Waiter plate');
      assert.equal(line.unitPrice, '9.00');
      assert.equal(line.quantity, 2);
      assert.equal(line.notes, 'No ice');
      assert.equal(order.total, '18.00');
    });

    await test('an identical command replays its receipt without duplicating a line', async () => {
      order = await post(
        `orders/${order.id}/commands`,
        cmd({ version: order.version, action: 'status', status: 'OPEN' }),
        201,
        waiter.accessToken,
      );
      const input = cmd({
        version: order.version,
        action: 'update_item',
        itemId: order.items.find((i) => !i.voidedAt).id,
        quantity: 3,
        notes: 'No ice',
      });
      const first = await post(
        `orders/${order.id}/commands`,
        input,
        201,
        waiter.accessToken,
      );
      assert.deepEqual(
        await post(`orders/${order.id}/commands`, input, 201, waiter.accessToken),
        first,
      );
      order = await get('orders/' + order.id, 200, waiter.accessToken);
      assert.equal(order.items.filter((i) => !i.voidedAt).length, 1);
      assert.equal(order.total, '27.00');
      // A different body under the same command id is a conflict, never a second write.
      await post(
        `orders/${order.id}/commands`,
        { ...input, quantity: 4 },
        409,
        waiter.accessToken,
      );
    });

    await test('a waiter cannot discount, cancel or reassign another waiter', async () => {
      for (const action of [
        { action: 'discount', amount: '1.00', reason: 'Mobile discount' },
        { action: 'cancel', reason: 'Mobile cancel' },
        { action: 'assign_waiter', waiterId: auth.user.id },
      ])
        await post(
          `orders/${order.id}/commands`,
          cmd({ version: order.version, ...action }),
          403,
          waiter.accessToken,
        );
      order = await get('orders/' + order.id, 200, waiter.accessToken);
      assert.equal(order.discount, '0.00');
      assert.equal(order.status, 'OPEN');
    });

    await test('kitchen submission routes once and then locks the order', async () => {
      const input = cmd({ version: order.version });
      const submitted = await post(
        `orders/${order.id}/kitchen-submit`,
        input,
        201,
        waiter.accessToken,
      );
      assert.equal(submitted.kitchenSubmitted, true);
      // Replaying the submission returns the original receipt, never a second ticket.
      assert.deepEqual(
        await post(`orders/${order.id}/kitchen-submit`, input, 201, waiter.accessToken),
        submitted,
      );
      order = await get('orders/' + order.id, 200, waiter.accessToken);
      assert.equal(
        await db.kitchenSubmission.count({ where: { ...scope, orderId: order.id } }),
        1,
      );
      // A submitted order is immutable: the mobile surface must show it as locked.
      await post(
        `orders/${order.id}/commands`,
        cmd({
          version: order.version,
          action: 'add_item',
          productId: product.id,
          quantity: 1,
          modifierIds: [],
          notes: '',
        }),
        409,
        waiter.accessToken,
      );
      const tables = await get('layout/tables', 200, waiter.accessToken);
      assert.equal(tables.items.find((t) => t.id === table.id).status, 'ORDER_SENT');
    });

    await test('requesting payment needs no payment permission and hands off to the cashier', async () => {
      const tickets = await db.kitchenTicket.findMany({ where: { ...scope, orderId: order.id } });
      assert.ok(tickets.length > 0);
      for (const ticket of tickets)
        for (const status of ['PREPARING', 'READY']) {
          const current = await db.kitchenTicket.findFirstOrThrow({ where: { id: ticket.id } });
          await post(
            `kitchen/tickets/${ticket.id}/state`,
            cmd({ version: current.version, status }),
            201,
          );
        }
      order = await get('orders/' + order.id, 200, waiter.accessToken);
      order = await post(
        `orders/${order.id}/commands`,
        cmd({ version: order.version, action: 'status', status: 'WAITING_PAYMENT' }),
        201,
        waiter.accessToken,
      );
      assert.equal(order.status, 'WAITING_PAYMENT');
      // The waiter hands off: collecting money remains a cashier permission.
      await get(`payments/orders/${order.id}`, 403, waiter.accessToken);
      await post(
        `payments/orders/${order.id}/collect`,
        cmd({
          version: order.version,
          mode: 'AMOUNT',
          tenders: [{ method: 'CARD', amount: order.total, transactionReference: 'MOBILE-1' }],
        }),
        403,
        waiter.accessToken,
      );
      const tables = await get('layout/tables', 200, waiter.accessToken);
      assert.equal(tables.items.find((t) => t.id === table.id).status, 'WAITING_PAYMENT');
    });

    await test('branch isolation hides another branch from the mobile surface', async () => {
      const branch = await db.branch.create({
        data: {
          organizationId: scope.organizationId,
          code: 'waiter-other',
          name: 'Other waiter branch',
          currency: 'EUR',
          timezone: 'Europe/Pristina',
        },
      });
      const foreignArea = await db.area.create({
        data: { branchId: branch.id, organizationId: scope.organizationId, name: 'Foreign area' },
      });
      const foreignTable = await db.restaurantTable.create({
        data: {
          branchId: branch.id,
          organizationId: scope.organizationId,
          areaId: foreignArea.id,
          name: 'F1',
          number: 91999,
          capacity: 2,
          positionX: 0,
          positionY: 0,
          width: 80,
          height: 80,
          shape: 'SQUARE',
        },
      });
      await get(`layout/tables/${foreignTable.id}`, 404, waiter.accessToken);
      await get(`layout/areas/${foreignArea.id}`, 404, waiter.accessToken);
      await post(
        'orders',
        cmd({ type: 'DINE_IN', tableId: foreignTable.id, waiterId: waiter.user.id, notes: '' }),
        404,
        waiter.accessToken,
      );
      const visible = await get('layout/tables', 200, waiter.accessToken);
      assert.ok(!visible.items.some((t) => t.id === foreignTable.id));
    });

    await test('revoking waiter grants stops the mobile surface immediately', async () => {
      await call('patch', `roles/${role.id}/permissions`)
        .send({ permissions: ['menu.read', 'layout.read', 'order.read'] })
        .expect(200);
      // The existing session keeps working for reads but loses every write.
      await get('orders', 200, waiter.accessToken);
      await post(
        'orders',
        cmd({ type: 'TAKEAWAY', tableId: null, waiterId: waiter.user.id, notes: '' }),
        403,
        waiter.accessToken,
      );
      await post(
        `orders/${order.id}/kitchen-submit`,
        cmd({ version: order.version }),
        403,
        waiter.accessToken,
      );
      // Restore the seeded grants so later runs and browser tests are unaffected.
      await call('patch', `roles/${role.id}/permissions`)
        .send({
          permissions: [
            'menu.read',
            'layout.read',
            'order.read',
            'order.manage',
            'order.submit_kitchen',
          ],
        })
        .expect(200);
    });

    console.log(`Waiter integration suite passed: ${count} checks.`);
  } finally {
    await db.$disconnect();
  }
}
