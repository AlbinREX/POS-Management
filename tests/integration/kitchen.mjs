import assert from 'node:assert/strict';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createDatabase } = require('@restaurant/database');
export async function runKitchenIntegration(app) {
  const db = createDatabase(process.env.MIGRATION_DATABASE_URL),
    runtime = createDatabase(),
    http = request(app.getHttpServer()),
    origin = process.env.APP_ORIGIN;
  let count = 0;
  const test = async (name, fn) => {
    await fn();
    console.log(`PASS kitchen ${++count}: ${name}`);
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
    const scope = { branchId: login.user.branchId, organizationId: login.user.organizationId },
      token = login.accessToken;
    const call = (method, path, bearer = token) =>
      http[method]('/api/' + path)
        .set('Origin', origin)
        .set('Authorization', 'Bearer ' + bearer);
    const create = async (path, data) => (await call('post', path).send(data).expect(201)).body;
    const cmd = async (o, data, code = 201) =>
      (
        await call('post', `orders/${o.id}/commands`)
          .send({ commandId: randomUUID(), version: o.version, ...data })
          .expect(code)
      ).body;
    const submit = async (o, extra = {}, code = 201, bearer = token) =>
      (
        await call('post', `orders/${o.id}/kitchen-submit`, bearer)
          .send({ commandId: randomUUID(), version: o.version, ...extra })
          .expect(code)
      ).body;
    const state = async (t, status, extra = {}, code = 201, bearer = token) =>
      (
        await call('post', `kitchen/tickets/${t.id}/state`, bearer)
          .send({ commandId: randomUUID(), version: t.version, status, ...extra })
          .expect(code)
      ).body;
    const getOrder = async (id) => (await call('get', 'orders/' + id).expect(200)).body;
    const category = await db.category.create({
      data: { ...scope, name: 'Kitchen test category' },
    });
    const grill = await db.kitchenStation.create({
        data: { ...scope, name: 'Kitchen test grill' },
      }),
      bar = await db.kitchenStation.create({ data: { ...scope, name: 'Kitchen test bar' } });
    const group = await db.modifierGroup.create({
      data: { ...scope, name: 'Kitchen options', minSelections: 1, maxSelections: 1 },
    });
    const modifier = await db.modifier.create({
      data: { ...scope, groupId: group.id, name: 'Snapshot cheese', priceAdjustment: '0.50' },
    });
    const product = await db.product.create({
      data: {
        ...scope,
        categoryId: category.id,
        name: 'Snapshot burger',
        sku: 'KITCHEN-TEST',
        sellingPrice: '5.50',
        taxRate: '0.00',
        taxMode: 'INCLUSIVE',
      },
    });
    await db.productModifierGroup.create({
      data: { ...scope, productId: product.id, groupId: group.id },
    });
    const area = await db.area.create({ data: { ...scope, name: 'Kitchen test area' } }),
      table = await db.restaurantTable.create({
        data: {
          ...scope,
          areaId: area.id,
          name: 'Kitchen table',
          number: 82001,
          capacity: 4,
          positionX: 20,
          positionY: 20,
          width: 100,
          height: 80,
          shape: 'RECTANGLE',
        },
      });
    const newOrder = async (dine = false) => {
      let o = await create('orders', {
        commandId: randomUUID(),
        type: dine ? 'DINE_IN' : 'TAKEAWAY',
        tableId: dine ? table.id : null,
        waiterId: login.user.id,
        notes: 'Kitchen order note',
      });
      o = await cmd(o, {
        action: 'add_item',
        productId: product.id,
        quantity: 2,
        modifierIds: [modifier.id],
        notes: 'No onion',
      });
      return cmd(o, { action: 'status', status: 'OPEN' });
    };
    let order = await newOrder(true),
      tickets,
      kitchenUser;
    await test('authentication, permissions and strict kitchen boundaries', async () => {
      for (const path of [
        'kitchen/stations',
        'kitchen/tickets',
        'kitchen/changes',
        `kitchen/tickets/${randomUUID()}/print-contract`,
      ])
        await http.get('/api/' + path).expect(401);
      await call('get', 'kitchen/tickets?branchId=' + scope.branchId).expect(400);
      await submit(order, { stationId: grill.id }, 400);
      const role = await db.role.findFirst({
        where: { organizationId: scope.organizationId, name: 'KITCHEN' },
      });
      await create('users', {
        name: 'Kitchen operator',
        email: 'kitchen@verification.test',
        password: credentials.password,
        roleIds: [role.id],
      });
      kitchenUser = (
        await http
          .post('/api/auth/login')
          .set('Origin', origin)
          .send({ ...credentials, email: 'kitchen@verification.test' })
          .expect(200)
      ).body;
      for (const path of ['orders', 'menu/products', 'audit-logs', 'roles'])
        await call('get', path, kitchenUser.accessToken).expect(403);
      await submit(order, {}, 403, kitchenUser.accessToken);
    });
    await test('missing or inactive routing rejects the whole submission with no partial tickets', async () => {
      const missing = await submit(order, {}, 409);
      // The rejection must name the product, so the operator knows which menu item to
      // fix rather than being told only that "every item" needs routing.
      assert.match(missing.message, /has no active kitchen station assigned/);
      assert.ok(
        missing.message.includes(product.name),
        `expected the offending product name in: ${missing.message}`,
      );
      assert.equal(await db.kitchenSubmission.count(), 0);
      await db.productKitchenStation.createMany({
        data: [grill, bar].map((s) => ({ ...scope, productId: product.id, stationId: s.id })),
      });
      await db.kitchenStation.update({ where: { id: bar.id }, data: { active: false } });
      const inactive = await submit(order, {}, 409);
      // A routed-but-closed station is a different fault from no routing at all, and
      // naming the station is what tells the operator where to look.
      assert.match(inactive.message, /unavailable station/);
      assert.ok(
        inactive.message.includes(product.name) && inactive.message.includes(bar.name),
        `expected product and station names in: ${inactive.message}`,
      );
      assert.equal(await db.kitchenTicket.count(), 0);
      assert.equal((await getOrder(order.id)).version, order.version);
      await db.kitchenStation.update({ where: { id: bar.id }, data: { active: true } });
    });
    await test('submission snapshots route to each station once and retry without duplication', async () => {
      await db.product.update({
        where: { id: product.id },
        data: { name: 'Current burger', sellingPrice: '9.50' },
      });
      await db.modifier.update({ where: { id: modifier.id }, data: { name: 'Current cheese' } });
      const input = { commandId: randomUUID() },
        before = order;
      order = await submit(before, input);
      assert.deepEqual(await submit(before, input), order);
      await submit(order, {}, 409);
      tickets = (await call('get', 'kitchen/tickets').expect(200)).body.items;
      assert.equal(tickets.length, 2);
      assert.equal(order.status, 'SENT_TO_KITCHEN');
      assert.equal(order.total, '12.00');
      assert.equal(
        (await db.restaurantTable.findUnique({ where: { id: table.id } })).status,
        'ORDER_SENT',
      );
      for (const t of tickets) {
        assert.equal(t.content.items[0].productName, 'Snapshot burger');
        assert.equal(t.content.items[0].quantity, 2);
        assert.equal(t.content.items[0].modifiers[0].name, 'Snapshot cheese');
        assert.equal(t.content.items[0].notes, 'No onion');
        assert.equal(t.content.notes, 'Kitchen order note');
        assert.equal(JSON.stringify(t).includes('unitPrice'), false);
      }
      const printed = (
        await call(
          'get',
          `kitchen/tickets/${tickets[0].id}/print-contract`,
          kitchenUser.accessToken,
        ).expect(200)
      ).body;
      assert.equal(printed.kind, 'KITCHEN_TICKET');
      assert.deepEqual(printed.content, tickets[0].content);
      assert.equal((await call('get', 'kitchen/tickets?stationId=' + bar.id)).body.items.length, 1);
    });
    await test('catalog changes cannot rewrite tickets and submitted orders cannot be reopened or edited', async () => {
      await db.kitchenStation.update({
        where: { id: bar.id },
        data: { name: 'Renamed bar', active: false, deletedAt: new Date() },
      });
      await db.productKitchenStation.deleteMany({ where: { productId: product.id } });
      assert.ok((await call('get', 'kitchen/stations')).body.some((s) => s.id === bar.id));
      const t = (await call('get', 'kitchen/tickets/' + tickets[0].id)).body;
      assert.deepEqual(t.content, tickets[0].content);
      for (const action of [
        { action: 'notes', notes: 'Changed' },
        { action: 'discount', amount: '0.00', reason: 'Changed' },
        { action: 'update_item', itemId: order.items[0].id, quantity: 1 },
        { action: 'status', status: 'OPEN' },
      ])
        await cmd(order, action, 409);
      await cmd(order, { action: 'status', status: 'PAID' }, 400);
      await assert.rejects(
        runtime.order.update({
          where: { id: order.id },
          data: { status: 'OPEN', version: { increment: 1 } },
        }),
      );
      await assert.rejects(
        runtime.orderItem.update({ where: { id: order.items[0].id }, data: { notes: 'Forged' } }),
      );
      await db.productKitchenStation.createMany({
        data: [grill, bar].map((s) => ({ ...scope, productId: product.id, stationId: s.id })),
      });
      await db.kitchenStation.update({
        where: { id: bar.id },
        data: { active: true, deletedAt: null },
      });
    });
    await test('ticket progression is versioned, replayable and aggregated across all stations', async () => {
      await state(tickets[0], 'READY', {}, 409, kitchenUser.accessToken);
      await state(tickets[0], 'PAID', {}, 400);
      const input = { commandId: randomUUID() },
        before = tickets[0];
      tickets[0] = await state(before, 'PREPARING', input, 201, kitchenUser.accessToken);
      assert.deepEqual(
        await state(before, 'PREPARING', input, 201, kitchenUser.accessToken),
        tickets[0],
      );
      await state(before, 'PREPARING', input, 409, token);
      assert.equal((await getOrder(order.id)).status, 'PREPARING');
      await assert.rejects(
        runtime.order.update({
          where: { id: order.id },
          data: { status: 'READY', version: { increment: 1 } },
        }),
      );
      tickets[0] = await state(tickets[0], 'READY', {}, 201, kitchenUser.accessToken);
      assert.equal((await getOrder(order.id)).status, 'PREPARING');
      tickets[0] = await state(tickets[0], 'COMPLETED', {}, 201, kitchenUser.accessToken);
      tickets[1] = await state(tickets[1], 'PREPARING', {}, 201, kitchenUser.accessToken);
      tickets[1] = await state(tickets[1], 'READY', {}, 201, kitchenUser.accessToken);
      order = await getOrder(order.id);
      assert.equal(order.status, 'READY');
      assert.equal(order.total, '12.00');
      order = await cmd(order, { action: 'status', status: 'WAITING_PAYMENT' });
      tickets[1] = await state(tickets[1], 'COMPLETED', {}, 201, kitchenUser.accessToken);
      order = await getOrder(order.id);
      assert.equal(order.status, 'WAITING_PAYMENT');
      assert.equal((await call('get', 'kitchen/tickets')).body.items.length, 0);
    });
    await test('branch isolation covers details, history, printer contracts, feeds and foreign keys', async () => {
      const branch = await db.branch.create({
        data: {
          organizationId: scope.organizationId,
          code: 'kitchen-foreign',
          name: 'Foreign kitchen',
        },
      });
      const foreignScope = { organizationId: scope.organizationId, branchId: branch.id };
      const foreignOrder = await db.order.create({
        data: { ...foreignScope, orderNumber: 1n, type: 'TAKEAWAY', currency: 'EUR' },
      });
      await submit({ id: foreignOrder.id, version: 1 }, {}, 404);
      await assert.rejects(
        db.kitchenSubmission.create({
          data: { ...foreignScope, orderId: order.id, submittedBy: login.user.id },
        }),
      );
      await db.branchMembership.create({ data: { ...foreignScope, userId: login.user.id } });
      const ownerRole = await db.role.findFirst({
        where: { organizationId: scope.organizationId, name: 'OWNER' },
      });
      await db.userBranchRole.create({
        data: { ...foreignScope, userId: login.user.id, roleId: ownerRole.id },
      });
      const foreign = (
        await http
          .post('/api/auth/login')
          .set('Origin', origin)
          .send({ ...credentials, branch: branch.code })
          .expect(200)
      ).body;
      for (const suffix of ['', '/history', '/print-contract'])
        await call('get', 'kitchen/tickets/' + tickets[0].id + suffix, foreign.accessToken).expect(
          404,
        );
      await state(tickets[0], 'PREPARING', {}, 404, foreign.accessToken);
      assert.equal(
        (await call('get', 'kitchen/changes', foreign.accessToken)).body.events.length,
        0,
      );
      assert.equal(
        (await call('get', 'kitchen/tickets?view=history', foreign.accessToken)).body.items.length,
        0,
      );
    });
    await test('concurrent preparation updates have one winner and leave no duplicate history', async () => {
      let o = await newOrder();
      o = await submit(o);
      let t = (await call('get', 'kitchen/tickets')).body.items.find((t) => t.orderId === o.id);
      const results = await Promise.all(
        [1, 2].map(() =>
          call('post', `kitchen/tickets/${t.id}/state`).send({
            commandId: randomUUID(),
            version: t.version,
            status: 'PREPARING',
          }),
        ),
      );
      assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
      t = (await call('get', 'kitchen/tickets/' + t.id)).body;
      assert.equal(t.version, 2);
      await cmd(await getOrder(o.id), { action: 'cancel', reason: 'Concurrent test cleanup' });
    });
    await test('event failure rolls back submission and cancellation atomically', async () => {
      const o = await newOrder();
      const progressOrder = await submit(await newOrder());
      const progressTicket = (await call('get', 'kitchen/tickets')).body.items.find(
        (t) => t.orderId === progressOrder.id,
      );
      const previous = await db.kitchenRevision.findUnique({ where: { branchId: scope.branchId } });
      await db.$executeRawUnsafe(
        `CREATE FUNCTION reject_kitchen_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Injected event failure'; END; $$`,
      );
      await db.$executeRawUnsafe(
        'CREATE TRIGGER reject_kitchen_test BEFORE INSERT ON "KitchenEvent" FOR EACH ROW EXECUTE FUNCTION reject_kitchen_test()',
      );
      try {
        await state(progressTicket, 'PREPARING', {}, 500);
        assert.equal((await getOrder(progressOrder.id)).version, progressOrder.version);
        assert.equal(
          (await call('get', 'kitchen/tickets/' + progressTicket.id)).body.status,
          'NEW',
        );
        await submit(o, {}, 500);
        assert.equal(await db.kitchenSubmission.count({ where: { orderId: o.id } }), 0);
        assert.equal((await getOrder(o.id)).status, 'OPEN');
        await cmd(order, { action: 'cancel', reason: 'Must roll back' }, 500);
        assert.equal((await getOrder(order.id)).status, 'WAITING_PAYMENT');
        assert.equal(
          (await db.kitchenRevision.findUnique({ where: { branchId: scope.branchId } })).revision,
          previous.revision,
        );
      } finally {
        await db.$executeRawUnsafe('DROP TRIGGER reject_kitchen_test ON "KitchenEvent"');
        await db.$executeRawUnsafe('DROP FUNCTION reject_kitchen_test()');
      }
      await cmd(o, { action: 'cancel', reason: 'Unsubmitted cleanup' });
      await cmd(progressOrder, { action: 'cancel', reason: 'Progress rollback cleanup' });
    });
    await test('cancellation retains preparation history and yields a separate cancellation print contract', async () => {
      order = await cmd(order, { action: 'cancel', reason: 'Kitchen verification complete' });
      for (const t of tickets) {
        const now = (await call('get', 'kitchen/tickets/' + t.id)).body;
        assert.equal(now.status, 'COMPLETED');
        assert.ok(now.cancelledAt);
        assert.ok(now.completedAt);
        await state(now, 'PREPARING', {}, 409);
        const contract = (await call('get', `kitchen/tickets/${t.id}/print-contract`)).body;
        assert.equal(contract.kind, 'KITCHEN_CANCELLATION');
        assert.equal(contract.cancellation.reason, 'Kitchen verification complete');
      }
      assert.equal(
        (await db.restaurantTable.findUnique({ where: { id: table.id } })).status,
        'FREE',
      );
    });
    await test('immutable history, exact cursor replay and immediate permission revocation', async () => {
      for (const client of [runtime, db]) {
        await assert.rejects(client.kitchenTicket.delete({ where: { id: tickets[0].id } }));
        await assert.rejects(
          client.kitchenTicket.update({
            where: { id: tickets[0].id },
            data: { content: { forged: true }, version: { increment: 1 } },
          }),
        );
        await assert.rejects(
          client.kitchenEvent.updateMany({
            where: { ticketId: tickets[0].id },
            data: { action: 'Forged' },
          }),
        );
        await assert.rejects(
          client.kitchenTicketItem.deleteMany({ where: { ticketId: tickets[0].id } }),
        );
      }
      const history = (await call('get', `kitchen/tickets/${tickets[0].id}/history?limit=2`)).body;
      assert.equal(history.hasMore, true);
      assert.equal(history.events[0].snapshot.status, 'NEW');
      assert.ok(
        (
          await call('get', `kitchen/tickets/${tickets[0].id}/history?after=${history.cursor}`)
        ).body.events.some((e) => e.action === 'kitchen.ticket.cancelled'),
      );
      await db.kitchenRevision.update({
        where: { branchId: scope.branchId },
        data: { revision: 9007199254740993n },
      });
      let o = await newOrder();
      o = await submit(o);
      const events = (await call('get', 'kitchen/changes?after=9007199254740993')).body;
      assert.equal(events.events[0].revision, '9007199254740994');
      assert.equal(events.events.length, 2);
      await cmd(o, { action: 'cancel', reason: 'Cursor cleanup' });
      await db.branchMembership.update({
        where: { userId_branchId: { userId: kitchenUser.user.id, branchId: scope.branchId } },
        data: { active: false },
      });
      await call('get', 'kitchen/tickets', kitchenUser.accessToken).expect(401);
    });
    await db.restaurantTable.update({
      where: { id: table.id },
      data: { active: false, status: 'DISABLED', deletedAt: new Date() },
    });
    await db.area.update({
      where: { id: area.id },
      data: { active: false, deletedAt: new Date() },
    });
    await db.product.update({
      where: { id: product.id },
      data: { active: false, deletedAt: new Date() },
    });
    console.log(`Kitchen integration suite passed: ${count} checks.`);
  } finally {
    await db.$disconnect();
    await runtime.$disconnect();
  }
}
