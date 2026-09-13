import assert from 'node:assert/strict';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createDatabase } = require('@restaurant/database');

export async function runPaymentIntegration(app) {
  const db = createDatabase(process.env.MIGRATION_DATABASE_URL),
    runtime = createDatabase(),
    http = request(app.getHttpServer()),
    origin = process.env.APP_ORIGIN;
  let count = 0;
  const test = async (name, fn) => {
    await fn();
    console.log(`PASS payments ${++count}: ${name}`);
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
    const post = async (path, input, code = 201, bearer = token) =>
      (await call('post', path, bearer).send(input).expect(code)).body;
    const get = async (path, code = 200, bearer = token) =>
      (await call('get', path, bearer).expect(code)).body;
    const cmd = (o, input, code = 201) =>
      post(
        `orders/${o.id}/commands`,
        { commandId: randomUUID(), version: o.version, ...input },
        code,
      );
    const collect = (o, tenders, mode = 'AMOUNT', code = 201, extra = {}, bearer = token) =>
      post(
        `payments/orders/${o.id}/collect`,
        { commandId: randomUUID(), version: o.version, mode, tenders, ...extra },
        code,
        bearer,
      );
    const reverse = (p, input, code = 201, bearer = token) =>
      post(`payments/${p.id}/reverse`, { commandId: randomUUID(), ...input }, code, bearer);
    const card = (amount) => ({
      method: 'CARD',
      amount,
      transactionReference: 'test-' + randomUUID(),
    });
    const category = await db.category.create({
      data: { ...scope, name: 'Payment test category' },
    });
    const product = await db.product.create({
      data: {
        ...scope,
        categoryId: category.id,
        name: 'Payment snapshot burger',
        sku: 'PAYMENT-TEST',
        sellingPrice: '3.34',
        taxRate: '20.00',
        taxMode: 'INCLUSIVE',
      },
    });
    const area = await db.area.create({ data: { ...scope, name: 'Payment area' } });
    const table = await db.restaurantTable.create({
      data: {
        ...scope,
        areaId: area.id,
        name: 'Payment table',
        number: 83001,
        capacity: 4,
        positionX: 0,
        positionY: 0,
        width: 100,
        height: 80,
        shape: 'RECTANGLE',
      },
    });
    const terminal = await db.terminal.create({
      data: { ...scope, name: 'Payment POS', type: 'POS' },
    });
    const secondTerminal = await db.terminal.create({
      data: { ...scope, name: 'Payment second POS', type: 'POS' },
    });
    const role = await post('roles', {
      name: 'Payment cashier fixture',
      permissions: [
        'order.read',
        'payment.read',
        'payment.collect',
        'cash.shift.read',
        'cash.shift.manage',
        'cash.movement.manage',
      ],
    });
    await post('users', {
      name: 'Payment cashier',
      email: 'payment-cashier@verification.test',
      password: credentials.password,
      roleIds: [role.id],
    });
    const cashier = (
      await http
        .post('/api/auth/login')
        .set('Origin', origin)
        .send({ ...credentials, email: 'payment-cashier@verification.test' })
        .expect(200)
    ).body;
    const newOrder = async ({ dine = false, wait = true, zero = false } = {}) => {
      let o = await post('orders', {
        commandId: randomUUID(),
        type: dine ? 'DINE_IN' : 'TAKEAWAY',
        tableId: dine ? table.id : null,
        waiterId: login.user.id,
      });
      o = await cmd(o, { action: 'add_item', productId: product.id, quantity: 3 });
      o = await cmd(o, {
        action: 'discount',
        amount: zero ? '10.02' : '0.02',
        reason: 'Deterministic remainder test',
      });
      o = await cmd(o, { action: 'status', status: 'OPEN' });
      return wait ? cmd(o, { action: 'status', status: 'WAITING_PAYMENT' }) : o;
    };
    const bill = (id) => get('payments/orders/' + id);
    let shift, otherShift, partial, paid, paidReceipt;
    await test('authentication, strict inputs, role boundaries and waiting lifecycle', async () => {
      await http.get('/api/payments/shifts').expect(401);
      await get('payments/changes?branchId=' + scope.branchId, 400);
      await post(
        'payments/shifts',
        { commandId: randomUUID(), terminalId: terminal.id, openingAmount: 10 },
        400,
      );
      const o = await newOrder({ wait: false });
      await collect(o, [card('10.00')], 'AMOUNT', 409);
      await cmd(o, { action: 'status', status: 'PAID' }, 400);
      await reverse(
        { id: randomUUID() },
        { kind: 'REFUND', amount: '1.00', reason: 'Permission check' },
        403,
        cashier.accessToken,
      );
      await reverse(
        { id: randomUUID() },
        { kind: 'CANCELLATION', amount: '1.00', reason: 'Permission check' },
        403,
        cashier.accessToken,
      );
      await cmd(o, { action: 'cancel', reason: 'Fixture cleanup' });
    });
    await test('shift uniqueness, actor ownership, replay and signed cash movements', async () => {
      const input = { commandId: randomUUID(), terminalId: terminal.id, openingAmount: '20.00' };
      shift = await post('payments/shifts', input);
      assert.deepEqual(await post('payments/shifts', input), shift);
      await post('payments/shifts', { ...input, commandId: randomUUID() }, 409);
      await post(
        'payments/shifts',
        { ...input, commandId: randomUUID(), terminalId: secondTerminal.id },
        409,
      );
      otherShift = await post(
        'payments/shifts',
        { commandId: randomUUID(), terminalId: secondTerminal.id, openingAmount: '10.00' },
        201,
        cashier.accessToken,
      );
      await post(
        `payments/shifts/${shift.id}/commands`,
        {
          commandId: randomUUID(),
          version: shift.version,
          action: 'cash_in',
          amount: '1.00',
          reason: 'Foreign cashier',
        },
        409,
        cashier.accessToken,
      );
      shift = await post(`payments/shifts/${shift.id}/commands`, {
        commandId: randomUUID(),
        version: shift.version,
        action: 'cash_in',
        amount: '5.00',
        reason: 'Change float',
      });
      shift = await post(`payments/shifts/${shift.id}/commands`, {
        commandId: randomUUID(),
        version: shift.version,
        action: 'cash_out',
        amount: '2.00',
        reason: 'Petty cash',
      });
      assert.equal(shift.expectedAmount, '23.00');
      await post(
        `payments/shifts/${shift.id}/commands`,
        {
          commandId: randomUUID(),
          version: shift.version,
          action: 'cash_out',
          amount: '99.00',
          reason: 'Excess',
        },
        409,
      );
    });
    await test('partial cash, exact change, immutable snapshots, replay and overcollection', async () => {
      partial = await newOrder();
      await db.product.update({
        where: { id: product.id },
        data: { name: 'Changed menu price', sellingPrice: '7.50' },
      });
      const input = {
        commandId: randomUUID(),
        version: partial.version,
        mode: 'AMOUNT',
        tenders: [{ method: 'CASH', amount: '4.00', tendered: '10.00', shiftId: shift.id }],
      };
      const receipt = await post(`payments/orders/${partial.id}/collect`, input);
      assert.equal(receipt.payments[0].change, '6.00');
      assert.deepEqual(await post(`payments/orders/${partial.id}/collect`, input), receipt);
      await post(
        `payments/orders/${partial.id}/collect`,
        { ...input, tenders: [card('5.00')] },
        409,
      );
      const s = await bill(partial.id);
      partial = s.order;
      assert.equal(s.due, '6.00');
      assert.equal(s.order.total, '10.00');
      assert.equal(s.order.items[0].productName, 'Payment snapshot burger');
      await collect(partial, [card('6.01')], 'AMOUNT', 409);
      await collect(
        partial,
        [{ method: 'CASH', amount: '1.00', tendered: '0.50', shiftId: shift.id }],
        'AMOUNT',
        409,
      );
      await collect(
        partial,
        [{ method: 'CASH', amount: '1.00', tendered: '1.00', shiftId: otherShift.id }],
        'AMOUNT',
        409,
      );
      await cmd(partial, { action: 'status', status: 'OPEN' }, 409);
      await cmd(partial, { action: 'cancel', reason: 'Has money' }, 409);
      await db.product.update({
        where: { id: product.id },
        data: { name: 'Payment snapshot burger', sellingPrice: '3.34' },
      });
    });
    await test('full cancellation restores due, preserves records and allows order cancellation', async () => {
      const s = await bill(partial.id),
        p = s.payments[0];
      await reverse(
        p,
        { kind: 'CANCELLATION', amount: '1.00', reason: 'Must be full', shiftId: shift.id },
        409,
      );
      const input = {
        kind: 'CANCELLATION',
        amount: p.amount,
        reason: 'Incorrect tender',
        shiftId: shift.id,
        commandId: randomUUID(),
      };
      const r = await reverse(p, input);
      assert.deepEqual(await reverse(p, input), r);
      assert.equal((await bill(partial.id)).due, '10.00');
      await cmd((await bill(partial.id)).order, { action: 'status', status: 'OPEN' }, 409);
      await cmd((await bill(partial.id)).order, {
        action: 'cancel',
        reason: 'Customer left after reversal',
      });
      assert.equal(await db.payment.count({ where: { orderId: partial.id } }), 1);
    });
    await test('mixed tenders settle atomically and release the dine-in table only at exact balance', async () => {
      paid = await newOrder({ dine: true });
      const c = card('6.00');
      paidReceipt = await collect(paid, [
        { method: 'CASH', amount: '4.00', tendered: '5.00', shiftId: shift.id },
        c,
      ]);
      assert.equal(paidReceipt.settled, true);
      assert.equal(paidReceipt.payments[0].change, '1.00');
      const s = await bill(paid.id);
      paid = s.order;
      assert.equal(paid.status, 'PAID');
      assert.ok(s.settledAt);
      assert.equal(s.due, '0.00');
      assert.equal(s.netReceipts, '10.00');
      assert.equal(
        (await db.restaurantTable.findUnique({ where: { id: table.id } })).status,
        'FREE',
      );
      await collect(paid, [card('1.00')], 'AMOUNT', 409);
      const o = await newOrder();
      await collect(
        o,
        [{ method: 'CASH', amount: '4.00', tendered: '4.00', shiftId: shift.id }, c],
        'AMOUNT',
        409,
      );
      assert.equal((await bill(o.id)).payments.length, 0);
      assert.equal((await bill(o.id)).mode, null);
      await cmd(o, { action: 'cancel', reason: 'Duplicate card reference rollback' });
    });
    await test('counted close, difference reason and refunds from a new shift preserve original settlement', async () => {
      shift = (await get(`payments/shifts/${shift.id}`)).shift;
      assert.equal(shift.expectedAmount, '27.00');
      await post(
        `payments/shifts/${shift.id}/commands`,
        {
          commandId: randomUUID(),
          version: shift.version,
          action: 'close',
          closingAmount: '26.00',
        },
        409,
      );
      shift = await post(`payments/shifts/${shift.id}/commands`, {
        commandId: randomUUID(),
        version: shift.version,
        action: 'close',
        closingAmount: '26.00',
        reason: 'One euro count difference',
      });
      assert.equal(shift.difference, '-1.00');
      const cashPayment = (await bill(paid.id)).payments.find((p) => p.method === 'CASH');
      await reverse(
        cashPayment,
        { kind: 'REFUND', amount: '1.00', reason: 'Closed drawer', shiftId: shift.id },
        409,
      );
      const originalShiftId = shift.id;
      shift = await post('payments/shifts', {
        commandId: randomUUID(),
        terminalId: terminal.id,
        openingAmount: '10.00',
      });
      const input = {
        kind: 'REFUND',
        amount: '1.25',
        reason: 'Quality adjustment',
        shiftId: shift.id,
        commandId: randomUUID(),
      };
      const reversal = await reverse(cashPayment, input);
      assert.deepEqual(await reverse(cashPayment, input), reversal);
      await reverse(cashPayment, { ...input, commandId: randomUUID(), amount: '3.00' }, 409);
      const cardPayment = (await bill(paid.id)).payments.find((p) => p.method === 'CARD');
      await reverse(cardPayment, {
        kind: 'REFUND',
        amount: '0.75',
        reason: 'Partial card refund',
        transactionReference: 'refund-' + randomUUID(),
      });
      const s = await bill(paid.id);
      assert.equal(s.refunded, '2.00');
      assert.equal(s.netReceipts, '8.00');
      assert.equal(s.due, '0.00');
      assert.deepEqual(s.order, paid);
      assert.equal((await get(`payments/shifts/${originalShiftId}`)).shift.expectedAmount, '27.00');
    });
    await test('split by item quantities rounds once and releases units only on cancellation', async () => {
      let o = await newOrder();
      const itemId = o.items[0].id;
      const itemTender = (quantity) => ({
        method: 'CARD',
        items: [{ itemId, quantity }],
        transactionReference: 'item-' + randomUUID(),
      });
      const first = await collect(o, [itemTender(1)], 'ITEMS');
      assert.equal(first.payments[0].amount, '3.34');
      let s = await bill(o.id);
      o = s.order;
      assert.equal(s.units[0].remainingAmount, '6.66');
      await collect(o, [card('1.00')], 'AMOUNT', 409);
      await collect(o, [itemTender(3)], 'ITEMS', 409);
      await reverse(s.payments[0], {
        kind: 'CANCELLATION',
        amount: '3.34',
        reason: 'Wrong person',
        transactionReference: 'cancel-' + randomUUID(),
      });
      s = await bill(o.id);
      assert.equal(s.units[0].remaining, 3);
      await collect(s.order, [itemTender(1), itemTender(2)], 'ITEMS');
      s = await bill(o.id);
      assert.equal(s.order.status, 'PAID');
      assert.equal(s.netReceipts, '10.00');
      assert.equal(s.units[0].remaining, 0);
      assert.deepEqual(
        s.payments
          .filter((p) => !p.reversals.length)
          .map((p) => p.amount)
          .sort(),
        ['3.34', '6.66'],
      );
    });
    await test('concurrent settlements have one winner with no duplicate financial records', async () => {
      const o = await newOrder();
      const results = await Promise.all(
        [1, 2].map(() =>
          call('post', `payments/orders/${o.id}/collect`).send({
            commandId: randomUUID(),
            version: o.version,
            mode: 'AMOUNT',
            tenders: [card('10.00')],
          }),
        ),
      );
      assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
      assert.equal((await bill(o.id)).payments.length, 1);
      const original = (await bill(o.id)).payments[0];
      const reversals = await Promise.all(
        [1, 2].map(() =>
          call('post', `payments/${original.id}/reverse`).send({
            commandId: randomUUID(),
            kind: 'REFUND',
            amount: '6.00',
            reason: 'Concurrent refund cap',
            transactionReference: 'concurrent-refund-' + randomUUID(),
          }),
        ),
      );
      assert.deepEqual(reversals.map((r) => r.status).sort(), [201, 409]);
      assert.equal((await bill(o.id)).refunded, '6.00');
      assert.equal((await bill(o.id)).order.status, 'PAID');
    });
    await test('kitchen readiness gates collection; completed tickets never rewrite a paid order', async () => {
      const station = await db.kitchenStation.create({
        data: { ...scope, name: 'Payment kitchen' },
      });
      await db.productKitchenStation.create({
        data: { ...scope, productId: product.id, stationId: station.id },
      });
      let o = await newOrder({ wait: false });
      o = await post(`orders/${o.id}/kitchen-submit`, {
        commandId: randomUUID(),
        version: o.version,
      });
      await collect(o, [card('10.00')], 'AMOUNT', 409);
      await cmd(o, { action: 'status', status: 'WAITING_PAYMENT' }, 409);
      let ticket = (await get('kitchen/tickets?stationId=' + station.id)).items[0];
      for (const status of ['PREPARING', 'READY'])
        ticket = await post(`kitchen/tickets/${ticket.id}/state`, {
          commandId: randomUUID(),
          version: ticket.version,
          status,
        });
      o = await get('orders/' + o.id);
      o = await cmd(o, { action: 'status', status: 'WAITING_PAYMENT' });
      await collect(o, [card('10.00')]);
      const before = (await bill(o.id)).order;
      ticket = await post(`kitchen/tickets/${ticket.id}/state`, {
        commandId: randomUUID(),
        version: ticket.version,
        status: 'COMPLETED',
      });
      assert.equal(ticket.status, 'COMPLETED');
      assert.deepEqual((await bill(o.id)).order, before);
      await db.kitchenStation.update({
        where: { id: station.id },
        data: { active: false, deletedAt: new Date() },
      });
    });
    await test('zero-total settlement is explicit and synthetic PAID or altered totals fail at the database', async () => {
      const guarded = await newOrder();
      for (const client of [runtime, db]) {
        for (const tender of [
          card('11.00'),
          { method: 'CASH', amount: '1.00', tendered: '1.00', change: '0.00', shiftId: shift.id },
        ]) {
          await assert.rejects(
            client.$transaction(async (tx) => {
              await tx.orderBill.create({
                data: { ...scope, orderId: guarded.id, mode: 'AMOUNT' },
              });
              await tx.payment.create({
                data: { ...scope, orderId: guarded.id, cashierId: login.user.id, ...tender },
              });
            }),
          );
        }
      }
      assert.equal((await bill(guarded.id)).mode, null);
      assert.equal((await bill(guarded.id)).payments.length, 0);
      await cmd(guarded, { action: 'cancel', reason: 'Database ledger guard fixture' });
      const o = await newOrder({ zero: true });
      await post(`payments/orders/${o.id}/settle-zero`, {
        commandId: randomUUID(),
        version: o.version,
      });
      const s = await bill(o.id);
      assert.equal(s.order.status, 'PAID');
      assert.equal(s.payments.length, 0);
      const draft = await post('orders', { commandId: randomUUID(), type: 'TAKEAWAY' });
      for (const client of [runtime, db]) {
        await assert.rejects(
          client.order.update({
            where: { id: draft.id },
            data: { status: 'PAID', version: { increment: 1 } },
          }),
        );
        await assert.rejects(
          client.order.update({
            where: { id: paid.id },
            data: { total: '9.00', version: { increment: 1 } },
          }),
        );
        await assert.rejects(
          client.orderItem.update({
            where: { id: paid.items[0].id },
            data: { productName: 'Forged' },
          }),
        );
      }
      await cmd(draft, { action: 'cancel', reason: 'Empty fixture cleanup' });
    });
    await test('cross-branch reads, writes, refunds and composite foreign keys are isolated', async () => {
      const branch = await db.branch.create({
        data: {
          organizationId: scope.organizationId,
          code: 'payment-foreign',
          name: 'Payment foreign branch',
        },
      });
      const ownerRole = await db.role.findFirst({
        where: { organizationId: scope.organizationId, name: 'OWNER' },
      });
      await db.branchMembership.create({
        data: { organizationId: scope.organizationId, branchId: branch.id, userId: login.user.id },
      });
      await db.userBranchRole.create({
        data: {
          organizationId: scope.organizationId,
          branchId: branch.id,
          userId: login.user.id,
          roleId: ownerRole.id,
        },
      });
      const foreign = (
        await http
          .post('/api/auth/login')
          .set('Origin', origin)
          .send({ ...credentials, branch: branch.code })
          .expect(200)
      ).body.accessToken;
      for (const path of [
        `payments/orders/${paid.id}`,
        `payments/orders/${paid.id}/history`,
        `payments/shifts/${shift.id}`,
      ])
        await get(path, 404, foreign);
      await collect(paid, [card('1.00')], 'AMOUNT', 404, {}, foreign);
      await reverse(
        paidReceipt.payments[0],
        { kind: 'REFUND', amount: '1.00', reason: 'Foreign', shiftId: shift.id },
        404,
        foreign,
      );
      await assert.rejects(
        runtime.paymentEvent.create({
          data: {
            ...scope,
            branchId: branch.id,
            userId: login.user.id,
            orderId: paid.id,
            commandId: randomUUID(),
            requestHash: 'a'.repeat(64),
            revision: 1n,
            action: 'forged',
            response: {},
          },
        }),
      );
      const feed = await get('payments/changes', 200, foreign);
      assert.deepEqual(feed.events, []);
    });
    await test('event failure rolls back collection, settlement, table release, cash movement and refund', async () => {
      const o = await newOrder({ dine: true }),
        beforeShift = (await get(`payments/shifts/${shift.id}`)).shift;
      await db.$executeRawUnsafe(
        `CREATE FUNCTION reject_payment_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Injected payment event failure'; END; $$`,
      );
      await db.$executeRawUnsafe(
        'CREATE TRIGGER reject_payment_test BEFORE INSERT ON "PaymentEvent" FOR EACH ROW EXECUTE FUNCTION reject_payment_test()',
      );
      try {
        await collect(
          o,
          [{ method: 'CASH', amount: '10.00', tendered: '10.00', shiftId: shift.id }],
          'AMOUNT',
          500,
        );
        const s = await bill(o.id);
        assert.equal(s.mode, null);
        assert.equal(s.payments.length, 0);
        assert.deepEqual(s.order, o);
        assert.equal(
          (await db.restaurantTable.findUnique({ where: { id: table.id } })).status,
          'WAITING_PAYMENT',
        );
        assert.deepEqual((await get(`payments/shifts/${shift.id}`)).shift, beforeShift);
        const countBefore = await db.paymentReversal.count();
        await reverse(
          paidReceipt.payments[0],
          { kind: 'REFUND', amount: '0.25', reason: 'Rollback', shiftId: shift.id },
          500,
        );
        assert.equal(await db.paymentReversal.count(), countBefore);
      } finally {
        await db.$executeRawUnsafe('DROP TRIGGER reject_payment_test ON "PaymentEvent"');
        await db.$executeRawUnsafe('DROP FUNCTION reject_payment_test()');
      }
      await cmd(o, { action: 'cancel', reason: 'Rollback fixture cleanup' });
    });
    await test('financial history is immutable for runtime and owner roles; closing cannot be rewritten', async () => {
      for (const client of [runtime, db]) {
        for (const [model, where] of [
          ['payment', { id: paidReceipt.payments[0].id }],
          ['orderSettlement', { orderId: paid.id }],
          ['orderBill', { orderId: paid.id }],
        ])
          await assert.rejects(client[model].delete({ where }));
        await assert.rejects(
          client.payment.update({
            where: { id: paidReceipt.payments[0].id },
            data: { amount: '0.01' },
          }),
        );
        await assert.rejects(
          client.paymentReversal.deleteMany({ where: { paymentId: paidReceipt.payments[0].id } }),
        );
        await assert.rejects(
          client.paymentAllocation.deleteMany({ where: { branchId: scope.branchId } }),
        );
        await assert.rejects(client.cashMovement.deleteMany({ where: { shiftId: shift.id } }));
        await assert.rejects(
          client.paymentEvent.updateMany({
            where: { orderId: paid.id },
            data: { action: 'Forged' },
          }),
        );
      }
      shift = (await get(`payments/shifts/${shift.id}`)).shift;
      shift = await post(`payments/shifts/${shift.id}/commands`, {
        commandId: randomUUID(),
        version: shift.version,
        action: 'close',
        closingAmount: shift.expectedAmount,
      });
      await assert.rejects(
        db.cashShift.update({
          where: { id: shift.id },
          data: { closingAmount: '0.00', version: { increment: 1 } },
        }),
      );
      await assert.rejects(
        db.cashMovement.create({
          data: {
            ...scope,
            shiftId: shift.id,
            cashierId: login.user.id,
            kind: 'CASH_IN',
            amount: '1.00',
            reason: 'Closed',
          },
        }),
      );
      await post(
        `payments/shifts/${otherShift.id}/commands`,
        {
          commandId: randomUUID(),
          version: otherShift.version,
          action: 'close',
          closingAmount: '10.00',
        },
        201,
        cashier.accessToken,
      );
    });
    await test('durable event cursors exceed JS integer precision and permission revocation applies immediately', async () => {
      await db.paymentRevision.update({
        where: { branchId: scope.branchId },
        data: { revision: 9007199254740993n },
      });
      const o = await newOrder();
      await collect(o, [card('10.00')]);
      const feed = await get('payments/changes?after=9007199254740993');
      assert.equal(feed.cursor, '9007199254740994');
      assert.equal(feed.events[0].snapshot, undefined);
      const history = await get(`payments/orders/${o.id}/history`);
      assert.equal(history.events[0].snapshot.settled, true);
      await call('patch', `roles/${role.id}/permissions`)
        .send({ permissions: ['order.read'] })
        .expect(200);
      await get('payments/orders/' + o.id, 403, cashier.accessToken);
      assert.equal(
        await db.auditLog.count({ where: { entityType: 'OrderPayment', entityId: o.id } }),
        1,
      );
    });
    await db.restaurantTable.update({
      where: { id: table.id },
      data: { active: false, status: 'DISABLED', deletedAt: new Date() },
    });
    for (const [model, id] of [
      ['area', area.id],
      ['product', product.id],
      ['category', category.id],
      ['terminal', terminal.id],
      ['terminal', secondTerminal.id],
    ])
      await db[model].update({ where: { id }, data: { active: false, deletedAt: new Date() } });
    console.log(`Payments integration suite passed: ${count} checks.`);
  } finally {
    await db.$disconnect();
    await runtime.$disconnect();
  }
}
