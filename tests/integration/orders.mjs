import assert from 'node:assert/strict';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createDatabase } = require('@restaurant/database');
export async function runOrderIntegration(app) {
  const db = createDatabase(process.env.MIGRATION_DATABASE_URL),
    runtime = createDatabase();
  const http = request(app.getHttpServer()),
    origin = process.env.APP_ORIGIN;
  let count = 0;
  const test = async (name, run) => {
    await run();
    console.log(`PASS orders ${++count}: ${name}`);
  };
  try {
    const credentials = {
      organization: 'verification',
      branch: 'main',
      email: process.env.SEED_OWNER_EMAIL,
      password: process.env.SEED_OWNER_PASSWORD,
    };
    const login = (
      await http.post('/api/auth/login').set('Origin', origin).send(credentials).expect(200)
    ).body;
    const token = login.accessToken,
      scope = { branchId: login.user.branchId, organizationId: login.user.organizationId };
    const call = (method, path, bearer = token) =>
      http[method]('/api/' + path)
        .set('Origin', origin)
        .set('Authorization', 'Bearer ' + bearer);
    const cmd = async (order, input, expected = 201, bearer = token) =>
      (
        await call('post', `orders/${order.id}/commands`, bearer)
          .send({ commandId: randomUUID(), version: order.version, ...input })
          .expect(expected)
      ).body;
    const create = async (input = {}, expected = 201) =>
      (
        await call('post', 'orders')
          .send({ commandId: randomUUID(), type: 'TAKEAWAY', ...input })
          .expect(expected)
      ).body;
    const category = await db.category.create({
      data: { ...scope, name: 'Order verification category' },
    });
    const group = await db.modifierGroup.create({
      data: { ...scope, name: 'Order required extras', minSelections: 1, maxSelections: 1 },
    });
    const modifier = await db.modifier.create({
      data: { ...scope, groupId: group.id, name: 'Order cheese', priceAdjustment: '0.50' },
    });
    const product = await db.product.create({
      data: {
        ...scope,
        categoryId: category.id,
        name: 'Order burger',
        sku: 'ORDER-BURGER',
        sellingPrice: '5.50',
        taxRate: '20.00',
        taxMode: 'INCLUSIVE',
      },
    });
    await db.productModifierGroup.create({
      data: { ...scope, productId: product.id, groupId: group.id },
    });
    const area = await db.area.create({ data: { ...scope, name: 'Order test area' } });
    const table = await db.restaurantTable.create({
      data: {
        ...scope,
        areaId: area.id,
        name: 'Order test table',
        number: 80001,
        capacity: 4,
        positionX: 20,
        positionY: 20,
        width: 100,
        height: 80,
        shape: 'RECTANGLE',
      },
    });
    const otherBranch = await db.branch.create({
      data: { organizationId: scope.organizationId, code: 'order-foreign', name: 'Order foreign' },
    });
    const foreignScope = { organizationId: scope.organizationId, branchId: otherBranch.id };
    const foreignCategory = await db.category.create({
      data: { ...foreignScope, name: 'Foreign' },
    });
    const foreignProduct = await db.product.create({
      data: {
        ...foreignScope,
        categoryId: foreignCategory.id,
        name: 'Foreign product',
        sku: 'FOREIGN',
        sellingPrice: '1.00',
        taxRate: '0.00',
        taxMode: 'INCLUSIVE',
      },
    });
    let order, takeaway, operator;
    const add = {
      action: 'add_item',
      productId: product.id,
      quantity: 2,
      modifierIds: [modifier.id],
      notes: 'No onion',
    };
    await test('strict authentication, input validation and phase boundaries', async () => {
      for (const path of ['orders', 'orders/changes', 'orders/waiters', `orders/${randomUUID()}`])
        await http.get('/api/' + path).expect(401);
      await create({ branchId: otherBranch.id }, 400);
      await create({ type: 'DINE_IN' }, 400);
      await create({ tableId: table.id }, 400);
      await call('get', 'orders?organizationId=' + scope.organizationId).expect(400);
      await call('get', 'orders/changes?after=1e3').expect(400);
      takeaway = await create();
      for (const status of ['PAID', 'SENT_TO_KITCHEN', 'PREPARING'])
        await cmd(takeaway, { action: 'status', status }, 400);
      await cmd(takeaway, { action: 'status', status: 'OPEN' }, 409);
    });
    await test('create command replay and atomic table occupancy', async () => {
      const input = {
        commandId: randomUUID(),
        type: 'DINE_IN',
        tableId: table.id,
        waiterId: login.user.id,
      };
      order = await create(input);
      assert.deepEqual(await create(input), order);
      await create({ ...input, notes: 'different' }, 409);
      await create({ type: 'DINE_IN', tableId: table.id }, 409);
      const currentTable = await db.restaurantTable.findUniqueOrThrow({ where: { id: table.id } });
      assert.equal(currentTable.status, 'OCCUPIED');
      assert.equal(order.waiterName, login.user.name);
      await call('patch', `layout/tables/${table.id}/status`)
        .send({ version: currentTable.version, status: 'FREE' })
        .expect(409);
      assert.equal(await db.order.count({ where: { tableId: table.id } }), 1);
      assert.equal(
        await db.layoutEvent.count({
          where: { entityId: table.id, action: 'layout.table.order_status_changed' },
        }),
        1,
      );
    });
    await test('modifier cardinality, product association and branch isolation', async () => {
      await cmd(order, { ...add, modifierIds: [] }, 409);
      await cmd(order, { ...add, modifierIds: [modifier.id, modifier.id] }, 400);
      await cmd(order, { ...add, modifierIds: [randomUUID()] }, 409);
      await cmd(order, { ...add, productId: foreignProduct.id }, 404);
      await cmd(order, { action: 'assign_waiter', waiterId: randomUUID() }, 404);
      const foreignOrder = await db.order.create({
        data: { ...foreignScope, orderNumber: 1n, type: 'TAKEAWAY', currency: 'EUR' },
      });
      await call('get', 'orders/' + foreignOrder.id).expect(404);
      await call('get', `orders/${foreignOrder.id}/history`).expect(404);
      await cmd({ id: foreignOrder.id, version: 1 }, { action: 'notes', notes: 'intrusion' }, 404);
      assert.ok(
        !(await call('get', 'orders').expect(200)).body.items.some((o) => o.id === foreignOrder.id),
      );
      await assert.rejects(
        db.order.create({
          data: {
            ...scope,
            orderNumber: 999n,
            type: 'TAKEAWAY',
            currency: 'EUR',
            waiterId: randomUUID(),
            waiterName: 'Forged',
          },
        }),
      );
      await assert.rejects(
        db.orderItem.create({
          data: {
            ...foreignScope,
            orderId: order.id,
            productId: foreignProduct.id,
            productName: 'Forged',
            sku: 'x',
            categoryName: 'x',
            unitPrice: '1.00',
            taxRate: '0.00',
            taxMode: 'INCLUSIVE',
            quantity: 1,
            subtotal: '0.00',
            total: '0.00',
            tax: '0.00',
          },
        }),
      );
    });
    await test('item snapshots and add-item retry are durable and decimal-safe', async () => {
      const input = { ...add, commandId: randomUUID() };
      const before = order;
      order = await cmd(before, input);
      assert.deepEqual(await cmd(before, input), order);
      assert.equal(order.items.length, 1);
      assert.equal(order.total, '12.00');
      assert.equal(order.tax, '2.00');
      assert.equal(order.items[0].modifiers[0].name, 'Order cheese');
      const edit = {
        kind: 'products',
        name: 'Renamed burger',
        sku: product.sku,
        categoryId: category.id,
        sellingPrice: '9.50',
        taxRate: '0.00',
        taxMode: 'EXCLUSIVE',
        modifierGroupIds: [group.id],
        kitchenStationIds: [],
      };
      await call('put', 'menu/products/' + product.id)
        .send({ version: 1, data: edit })
        .expect(200);
      order = await cmd(order, {
        action: 'update_item',
        itemId: order.items[0].id,
        quantity: 3,
        notes: 'Original price retained',
      });
      assert.equal(order.total, '18.00');
      assert.equal(order.items[0].productName, 'Order burger');
      assert.equal(order.items[0].taxRate, '20.00');
      order = await cmd(order, { ...add, quantity: 1 });
      assert.equal(order.total, '28.00');
      assert.equal(order.items[1].unitPrice, '9.50');
    });
    await test('fixed gross discount allocation, tax recalculation and rejection rollback', async () => {
      order = await cmd(order, { action: 'discount', amount: '14.00', reason: 'Manager courtesy' });
      assert.equal(order.total, '14.00');
      assert.equal(order.tax, '1.50');
      assert.deepEqual(
        order.items.map((i) => i.discount),
        ['9.00', '5.00'],
      );
      const eventCount = await db.orderEvent.count({ where: { orderId: order.id } });
      await cmd(order, { action: 'discount', amount: '28.01', reason: 'Invalid' }, 409);
      assert.equal(await db.orderEvent.count({ where: { orderId: order.id } }), eventCount);
      assert.equal((await call('get', 'orders/' + order.id)).body.version, order.version);
    });
    await test('permission-based operators cannot discount, cancel or assign others', async () => {
      const role = (
        await call('post', 'roles')
          .send({ name: 'Order operator', permissions: ['order.read', 'order.manage'] })
          .expect(201)
      ).body;
      await call('post', 'users')
        .send({
          name: 'Order operator',
          email: 'orders@verification.test',
          password: credentials.password,
          roleIds: [role.id],
        })
        .expect(201);
      operator = (
        await http
          .post('/api/auth/login')
          .set('Origin', origin)
          .send({ ...credentials, email: 'orders@verification.test' })
          .expect(200)
      ).body;
      for (const input of [
        { action: 'discount', amount: '1.00', reason: 'test' },
        { action: 'cancel', reason: 'test' },
        { action: 'assign_waiter', waiterId: operator.user.id },
      ])
        await cmd(order, input, 403, operator.accessToken);
      await call('get', 'orders/waiters', operator.accessToken).expect(403);
      await call('post', 'orders', operator.accessToken)
        .send({ commandId: randomUUID(), type: 'TAKEAWAY', waiterId: login.user.id })
        .expect(403);
      order = await cmd(order, { action: 'assign_waiter', waiterId: operator.user.id });
      assert.equal(order.waiterName, 'Order operator');
      const waiters = (await call('get', 'orders/waiters')).body.items;
      assert.ok(waiters.some((w) => w.id === operator.user.id));
      assert.ok(waiters.every((w) => Object.keys(w).sort().join(',') === 'id,name'));
      const replayKey = randomUUID();
      order = await cmd(order, { action: 'notes', notes: 'Actor bound', commandId: replayKey });
      await cmd(
        { ...order, version: order.version - 1 },
        { action: 'notes', notes: 'Actor bound', commandId: replayKey },
        409,
        operator.accessToken,
      );
      await db.branchMembership.update({
        where: { userId_branchId: { userId: operator.user.id, branchId: scope.branchId } },
        data: { active: false },
      });
      await cmd(order, { action: 'assign_waiter', waiterId: operator.user.id }, 404);
      await call('get', 'orders', operator.accessToken).expect(401);
    });
    await test('optimistic concurrent commands produce exactly one committed change', async () => {
      const outcomes = await Promise.all(
        [1, 2].map((n) =>
          call('post', `orders/${order.id}/commands`).send({
            commandId: randomUUID(),
            version: order.version,
            action: 'notes',
            notes: 'Concurrent ' + n,
          }),
        ),
      );
      assert.deepEqual(outcomes.map((r) => r.status).sort(), [201, 409]);
      order = (await call('get', 'orders/' + order.id)).body;
    });
    await test('lifecycle locks amounts and keeps table state synchronized', async () => {
      order = await cmd(order, { action: 'status', status: 'OPEN' });
      order = await cmd(order, { action: 'status', status: 'WAITING_PAYMENT' });
      assert.equal(
        (await db.restaurantTable.findUnique({ where: { id: table.id } })).status,
        'WAITING_PAYMENT',
      );
      await cmd(order, add, 409);
      await cmd(order, { action: 'discount', amount: '0.00', reason: 'Cannot silently edit' }, 409);
      order = await cmd(order, { action: 'status', status: 'OPEN' });
      assert.equal(
        (await db.restaurantTable.findUnique({ where: { id: table.id } })).status,
        'OCCUPIED',
      );
    });
    await test('voids retain historical items and product archives preserve orders', async () => {
      order = await cmd(order, {
        action: 'discount',
        amount: '0.00',
        reason: 'Remove discount before item change',
      });
      const itemId = order.items[1].id;
      order = await cmd(order, { action: 'void_item', itemId, reason: 'Customer changed mind' });
      assert.equal(order.total, '18.00');
      assert.equal(order.items.length, 2);
      assert.ok(order.items[1].voidedAt);
      await cmd(order, { action: 'update_item', itemId, quantity: 1 }, 404);
      await call('post', 'menu/products/' + product.id + '/archive')
        .send({ version: 2 })
        .expect(201);
      await cmd(order, add, 404);
      assert.equal(
        (await call('get', 'orders/' + order.id)).body.items[0].productName,
        'Order burger',
      );
    });
    await test('audit or event persistence failure rolls back order, table and counters', async () => {
      const counter = await db.orderCounter.findUnique({ where: { branchId: scope.branchId } });
      for (const relation of ['AuditLog', 'OrderEvent']) {
        await db.$executeRawUnsafe(
          `CREATE FUNCTION reject_order_test_write() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Injected persistence failure'; END; $$`,
        );
        await db.$executeRawUnsafe(
          `CREATE TRIGGER reject_order_test_write BEFORE INSERT ON "${relation}" FOR EACH ROW EXECUTE FUNCTION reject_order_test_write()`,
        );
        try {
          await cmd(order, { action: 'cancel', reason: 'Must roll back' }, 500);
        } finally {
          await db.$executeRawUnsafe(`DROP TRIGGER reject_order_test_write ON "${relation}"`);
          await db.$executeRawUnsafe('DROP FUNCTION reject_order_test_write()');
        }
        assert.equal((await call('get', 'orders/' + order.id)).body.status, 'OPEN');
        assert.equal(
          (await db.restaurantTable.findUnique({ where: { id: table.id } })).status,
          'OCCUPIED',
        );
        assert.equal(
          (await db.orderCounter.findUnique({ where: { branchId: scope.branchId } })).revision,
          counter.revision,
        );
      }
    });
    await test('cancellation is immutable, retains totals/history and releases its table', async () => {
      const input = { commandId: randomUUID(), action: 'cancel', reason: 'Verification complete' },
        before = order;
      order = await cmd(before, input);
      assert.deepEqual(await cmd(before, input), order);
      assert.equal(order.total, '18.00');
      assert.equal(order.status, 'CANCELLED');
      assert.equal(
        (await db.restaurantTable.findUnique({ where: { id: table.id } })).status,
        'FREE',
      );
      await cmd(order, { action: 'notes', notes: 'Locked' }, 409);
      const next = await create({ type: 'DINE_IN', tableId: table.id });
      await cmd(next, { action: 'cancel', reason: 'Cleanup' });
      takeaway = await cmd(takeaway, { action: 'cancel', reason: 'Cleanup empty draft' });
    });
    await test('database guards preserve snapshots, financial history and aggregate totals', async () => {
      for (const client of [db, runtime]) {
        await assert.rejects(client.order.delete({ where: { id: order.id } }));
        await assert.rejects(
          client.order.update({
            where: { id: order.id },
            data: { total: '0.00', version: { increment: 1 } },
          }),
        );
        await assert.rejects(client.orderItem.delete({ where: { id: order.items[0].id } }));
        await assert.rejects(
          client.orderItem.update({
            where: { id: order.items[0].id },
            data: { productName: 'Forged' },
          }),
        );
        await assert.rejects(
          client.orderEvent.updateMany({
            where: { orderId: order.id },
            data: { action: 'Forged' },
          }),
        );
        await assert.rejects(
          client.orderItemModifier.updateMany({
            where: { itemId: order.items[0].id },
            data: { name: 'Forged' },
          }),
        );
      }
      const fresh = await create();
      await assert.rejects(
        runtime.order.update({
          where: { id: fresh.id },
          data: { subtotal: '1.00', total: '1.00', version: { increment: 1 } },
        }),
      );
      // Phase 6 rejects synthetic PAID state without a valid settlement ledger.
      await assert.rejects(
        db.order.update({
          where: { id: fresh.id },
          data: { status: 'PAID', version: { increment: 1 } },
        }),
      );
      await cmd(fresh, { action: 'cancel', reason: 'Closed-order guard fixture' });
      await assert.rejects(
        runtime.order.update({
          where: { id: fresh.id },
          data: { notes: 'Cannot edit a paid order', version: { increment: 1 } },
        }),
      );
      await assert.rejects(
        runtime.orderItem.create({
          data: {
            ...scope,
            orderId: fresh.id,
            productId: product.id,
            productName: 'Forged',
            sku: 'x',
            categoryName: 'x',
            unitPrice: '1.00',
            taxRate: '0.00',
            taxMode: 'INCLUSIVE',
            quantity: 1,
            subtotal: '0.00',
            tax: '0.00',
            total: '0.00',
          },
        }),
      );
    });
    await test('durable scoped events replay with exact BIGINT cursors and history snapshots', async () => {
      const history = (await call('get', `orders/${order.id}/history?limit=2`)).body;
      assert.equal(history.events.length, 2);
      assert.equal(history.hasMore, true);
      assert.equal(history.events[0].snapshot.status, 'DRAFT');
      const later = (await call('get', `orders/${order.id}/history?after=${history.cursor}`)).body;
      assert.equal(later.events.at(-1).snapshot.status, 'CANCELLED');
      assert.equal(
        await db.auditLog.count({ where: { entityType: 'Order', entityId: order.id } }),
        await db.orderEvent.count({ where: { orderId: order.id } }),
      );
      await db.orderCounter.update({
        where: { branchId: scope.branchId },
        data: { revision: 9007199254740993n },
      });
      const fresh = await create();
      const feed = (await call('get', 'orders/changes?after=9007199254740993')).body;
      assert.equal(feed.cursor, '9007199254740994');
      assert.equal(feed.events[0].orderId, fresh.id);
      assert.equal(feed.events[0].snapshot, undefined);
      await cmd(fresh, { action: 'cancel', reason: 'Cleanup' });
    });
    // No active business fixtures are left in the main branch for browser checks.
    await db.restaurantTable.update({
      where: { id: table.id },
      data: { active: false, status: 'DISABLED', deletedAt: new Date() },
    });
    await db.area.update({
      where: { id: area.id },
      data: { active: false, deletedAt: new Date() },
    });
    console.log(`Orders integration suite passed: ${count} checks.`);
  } finally {
    await db.$disconnect();
    await runtime.$disconnect();
  }
}
