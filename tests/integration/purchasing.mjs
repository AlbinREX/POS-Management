import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import request from 'supertest';
const require = createRequire(import.meta.url);
const { createDatabase } = require('@restaurant/database');
export async function runPurchasingIntegration(app) {
  const db = createDatabase(process.env.MIGRATION_DATABASE_URL),
    runtime = createDatabase();
  const http = request(app.getHttpServer()),
    origin = process.env.APP_ORIGIN;
  let count = 0;
  const test = async (name, fn) => {
    await fn();
    console.log(`PASS purchasing ${++count}: ${name}`);
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
    const warehouse = await post(
      'inventory/warehouses',
      cmd({ name: 'Purchasing receiving warehouse' }),
    );
    const item = await post(
      'inventory/items',
      cmd({ name: 'Purchasing chicken', sku: 'PUR8-CHICKEN', kind: 'INGREDIENT', unitCode: 'g' }),
    );
    const other = await post(
      'inventory/items',
      cmd({ name: 'Purchasing milk', sku: 'PUR8-MILK', kind: 'INGREDIENT', unitCode: 'ml' }),
    );
    let supplier, order, receipt, payment, reader, role;
    const draft = (extra = {}) =>
      cmd({
        supplierId: supplier.id,
        warehouseId: warehouse.id,
        reference: 'PO-EXT',
        items: [
          {
            itemId: item.id,
            quantity: '2',
            unitCode: 'kg',
            unitPrice: '10.1234',
            taxRate: '18.00',
          },
        ],
        ...extra,
      });
    const receive = (o, qty = '1', extra = {}) =>
      cmd({
        version: o.version,
        reference: 'DEL-' + randomUUID(),
        invoiceNumber: 'INV-' + randomUUID(),
        invoiceDate: '2026-09-14',
        items: [{ purchaseItemId: o.items[0].id, quantity: qty }],
        ...extra,
      });
    const currentStock = async () =>
      (await get(`inventory/stock?warehouseId=${warehouse.id}&itemId=${item.id}`)).items[0]
        ?.quantity ?? '0.000000';
    await test('strict inputs, supplier CRUD, read/receive/payment permissions', async () => {
      await http.get('/api/purchasing/suppliers').expect(401);
      supplier = await post(
        'purchasing/suppliers',
        cmd({ name: 'Purchase supplier', businessNumber: 'BIZ-8', email: 'supply@example.test' }),
      );
      await post('purchasing/suppliers', cmd({ name: 'Bad', branchId: randomUUID() }), 400);
      role = await post('roles', {
        name: 'Purchasing viewer',
        permissions: ['purchase.read', 'supplier.read'],
      });
      reader = await post('users', {
        email: 'purchasing-reader@example.test',
        name: 'Purchasing viewer',
        password: 'Purchasing-viewer-password-8!',
        roleIds: [role.id],
      });
      const login = await http
        .post('/api/auth/login')
        .set('Origin', origin)
        .send({
          organization: 'verification',
          branch: 'main',
          email: 'purchasing-reader@example.test',
          password: 'Purchasing-viewer-password-8!',
        })
        .expect(200);
      reader.token = login.body.accessToken;
      await get('purchasing/suppliers', 200, reader.token);
      await get('purchasing/catalog/items', 200, reader.token);
      await get('inventory/items', 403, reader.token);
      await post('purchasing/orders', draft(), 403, reader.token);
      await post(
        'purchasing/payments',
        cmd({
          receiptId: randomUUID(),
          amount: '1.00',
          method: 'BANK_TRANSFER',
          reference: 'r',
          reason: 'test',
        }),
        403,
        reader.token,
      );
    });
    await test('draft replacement keeps source history and decimal-safe totals', async () => {
      order = await post('purchasing/orders', draft());
      assert.equal(order.total, '23.90');
      assert.equal(order.items[0].stockQuantity, '2000.000000');
      const oldLine = order.items[0].id;
      order = (
        await call('put', `purchasing/orders/${order.id}`)
          .send({ ...draft(), version: order.version, notes: 'Checked order' })
          .expect(200)
      ).body;
      assert((await db.purchaseItem.findUnique({ where: { id: oldLine } })).voidedAt);
      await call('put', `purchasing/orders/${order.id}`)
        .send({ ...draft(), version: 1 })
        .expect(409);
      await post(
        'purchasing/orders',
        draft({
          items: [{ itemId: item.id, quantity: '1', unitCode: 'l', unitPrice: '1', taxRate: '0' }],
        }),
        400,
      );
    });
    await test('ordering freezes snapshots and does not create stock or payable', async () => {
      order = await post(`purchasing/orders/${order.id}/order`, cmd({ version: order.version }));
      assert.equal(order.status, 'ORDERED');
      assert.equal(await currentStock(), '0.000000');
      await call('put', `purchasing/orders/${order.id}`)
        .send({ ...draft(), version: order.version })
        .expect(409);
      const acct = await get(`purchasing/suppliers/${supplier.id}/account`);
      assert.equal(acct.outstanding, '0.00');
      supplier = (
        await call('put', `purchasing/suppliers/${supplier.id}`)
          .send(cmd({ version: supplier.version, name: 'Renamed supplier', active: true }))
          .expect(200)
      ).body;
      await post(
        `purchasing/suppliers/${supplier.id}/archive`,
        cmd({ version: supplier.version }),
        409,
      );
    });
    await test('partial receiving commits stock, receipt, payable, audit and replay exactly once', async () => {
      const input = receive(order);
      receipt = await post(`purchasing/orders/${order.id}/receive`, input);
      assert.equal(receipt.supplierName, 'Purchase supplier');
      assert.equal(receipt.total, '11.94');
      assert.equal(receipt.outstanding, '11.94');
      assert.equal(await currentStock(), '1000.000000');
      assert.deepEqual(await post(`purchasing/orders/${order.id}/receive`, input), receipt);
      await post(
        `purchasing/orders/${order.id}/receive`,
        { ...input, reference: 'conflicting' },
        409,
      );
      order = await get(`purchasing/orders/${order.id}`);
      assert.equal(order.status, 'PARTIALLY_RECEIVED');
      assert.equal(order.items[0].remainingQuantity, '1.000000');
      assert.equal(
        await db.stockMovement.count({ where: { ...scope, receiptItemId: receipt.items[0].id } }),
        1,
      );
      assert.equal(
        await db.auditLog.count({
          where: { ...scope, action: 'purchase.received', entityId: receipt.id },
        }),
        1,
      );
    });
    await test('overreceiving, duplicate invoice and wrong purchase lines are rejected atomically', async () => {
      await post(`purchasing/orders/${order.id}/receive`, receive(order, '1.1'), 409);
      await post(
        `purchasing/orders/${order.id}/receive`,
        receive(order, '1', { invoiceNumber: receipt.invoiceNumber }),
        409,
      );
      await post(
        `purchasing/orders/${order.id}/receive`,
        receive(order, '1', { items: [{ purchaseItemId: randomUUID(), quantity: '1' }] }),
        404,
      );
      assert.equal(await currentStock(), '1000.000000');
    });
    await test('separate external payments and correction reversals produce accurate balances', async () => {
      const input = cmd({
        receiptId: receipt.id,
        amount: '5.00',
        method: 'BANK_TRANSFER',
        reference: 'BANK-PUR8-1',
        reason: 'External bank confirmation',
      });
      const cashBefore = await db.cashMovement.count();
      payment = await post('purchasing/payments', input);
      assert.deepEqual(await post('purchasing/payments', input), payment);
      assert.equal((await get(`purchasing/suppliers/${supplier.id}/account`)).outstanding, '6.94');
      await post(
        'purchasing/payments',
        cmd({ ...input, commandId: randomUUID(), amount: '7.00', reference: 'BANK-PUR8-over' }),
        409,
      );
      await post(
        `purchasing/payments/${payment.id}/reverse`,
        cmd({ reason: 'Recorded against wrong bank receipt' }),
        403,
        reader.token,
      );
      const reversal = cmd({ reason: 'Correction of external payment record' });
      await post(`purchasing/payments/${payment.id}/reverse`, reversal);
      await post(`purchasing/payments/${payment.id}/reverse`, reversal);
      await post(
        `purchasing/payments/${payment.id}/reverse`,
        cmd({ reason: 'Second reversal' }),
        409,
      );
      assert.equal((await get(`purchasing/suppliers/${supplier.id}/account`)).outstanding, '11.94');
      assert.equal(await db.cashMovement.count(), cashBefore);
    });
    await test('final delivery completes the purchase and retains receipt-specific rounding', async () => {
      await post(`purchasing/orders/${order.id}/receive`, receive(order));
      order = await get(`purchasing/orders/${order.id}`);
      assert.equal(order.status, 'RECEIVED');
      assert.equal(await currentStock(), '2000.000000');
      const account = await get(`purchasing/suppliers/${supplier.id}/account`);
      assert.equal(account.receivedValue, '23.88');
      assert.equal(account.outstanding, '23.88');
      assert.equal(account.receiptCount, 2);
      await post(
        `purchasing/orders/${order.id}/cancel`,
        cmd({ version: order.version, reason: 'not allowed' }),
        409,
      );
    });
    await test('concurrent receiving cannot duplicate movements or overreceive', async () => {
      let o = await post('purchasing/orders', draft());
      o = await post(`purchasing/orders/${o.id}/order`, cmd({ version: o.version }));
      const input = receive(o, '2');
      const replies = await Promise.all([
        call('post', `purchasing/orders/${o.id}/receive`).send(input),
        call('post', `purchasing/orders/${o.id}/receive`).send(input),
      ]);
      assert(replies.every((r) => [201, 409].includes(r.status)));
      assert(replies.some((r) => r.status === 201));
      await post(`purchasing/orders/${o.id}/receive`, input);
      assert.equal(await db.goodsReceipt.count({ where: { purchaseOrderId: o.id } }), 1);
      assert.equal(await currentStock(), '4000.000000');
    });
    await test('forced stock failure rolls back receiving and supplier balances', async () => {
      let o = await post('purchasing/orders', draft());
      o = await post(`purchasing/orders/${o.id}/order`, cmd({ version: o.version }));
      await db.$executeRawUnsafe(
        `CREATE FUNCTION phase8_fail_stock() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.kind::text='PURCHASE' THEN RAISE EXCEPTION 'forced receiving failure'; END IF; RETURN NEW; END $$`,
      );
      await db.$executeRawUnsafe(
        'CREATE TRIGGER phase8_fail_stock BEFORE INSERT ON "StockMovement" FOR EACH ROW EXECUTE FUNCTION phase8_fail_stock()',
      );
      try {
        await post(`purchasing/orders/${o.id}/receive`, receive(o), 500);
      } finally {
        await db.$executeRawUnsafe('DROP TRIGGER phase8_fail_stock ON "StockMovement"');
        await db.$executeRawUnsafe('DROP FUNCTION phase8_fail_stock()');
      }
      assert.equal(await db.goodsReceipt.count({ where: { purchaseOrderId: o.id } }), 0);
      assert.equal((await get(`purchasing/orders/${o.id}`)).status, 'ORDERED');
      assert.equal(await currentStock(), '4000.000000');
    });
    await test('event failure rolls back receipt, stock, charge and audit together', async () => {
      let o = await post('purchasing/orders', draft());
      o = await post(`purchasing/orders/${o.id}/order`, cmd({ version: o.version }));
      const before = await db.auditLog.count({ where: scope });
      await db.$executeRawUnsafe(
        `CREATE FUNCTION phase8_fail_event() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'forced purchasing event failure'; END $$`,
      );
      await db.$executeRawUnsafe(
        'CREATE TRIGGER phase8_fail_event BEFORE INSERT ON "PurchasingEvent" FOR EACH ROW EXECUTE FUNCTION phase8_fail_event()',
      );
      try {
        await post(`purchasing/orders/${o.id}/receive`, receive(o), 500);
      } finally {
        await db.$executeRawUnsafe('DROP TRIGGER phase8_fail_event ON "PurchasingEvent"');
        await db.$executeRawUnsafe('DROP FUNCTION phase8_fail_event()');
      }
      assert.equal(await db.goodsReceipt.count({ where: { purchaseOrderId: o.id } }), 0);
      assert.equal(await db.auditLog.count({ where: scope }), before);
      assert.equal(await currentStock(), '4000.000000');
    });
    await test('zero-cost goods and multiple item dimensions have complete ledger sources', async () => {
      let o = await post(
        'purchasing/orders',
        draft({
          items: [
            { itemId: other.id, quantity: '0.5', unitCode: 'l', unitPrice: '0', taxRate: '0' },
          ],
        }),
      );
      o = await post(`purchasing/orders/${o.id}/order`, cmd({ version: o.version }));
      const r = await post(`purchasing/orders/${o.id}/receive`, receive(o, '0.5'));
      assert.equal(r.total, '0.00');
      assert.equal(r.items[0].stockQuantity, '500.000000');
      assert.equal(r.outstanding, '0.00');
    });
    await test('database enforces frozen lines and complete receiving even with owner access', async () => {
      await assert.rejects(
        db.purchaseOrder.update({
          where: { id: order.id },
          data: { total: '1', version: { increment: 1 } },
        }),
      );
      await assert.rejects(
        db.purchaseItem.update({ where: { id: order.items[0].id }, data: { unitPrice: '1' } }),
      );
      await assert.rejects(
        db.goodsReceiptItem.update({
          where: { id: receipt.items[0].id },
          data: { quantity: '50' },
        }),
      );
      await assert.rejects(db.supplierEntry.delete({ where: { id: payment.id } }));
      await assert.rejects(
        runtime.stockMovement.updateMany({
          where: { receiptItemId: receipt.items[0].id },
          data: { quantity: '99' },
        }),
      );
      let o = await post('purchasing/orders', draft());
      o = await post(`purchasing/orders/${o.id}/order`, cmd({ version: o.version }));
      await assert.rejects(
        db.goodsReceipt.create({
          data: {
            ...scope,
            purchaseOrderId: o.id,
            supplierId: supplier.id,
            receivedBy: auth.user.id,
            reference: 'INCOMPLETE',
            currency: 'EUR',
            subtotal: '0',
            tax: '0',
            total: '0',
          },
        }),
      );
      await assert.rejects(
        db.supplierEntry.create({
          data: {
            ...scope,
            supplierId: supplier.id,
            receiptId: receipt.id,
            userId: auth.user.id,
            kind: 'PAYMENT',
            amount: '-100',
            method: 'BANK_TRANSFER',
            reference: 'DB-OVERPAY',
            reason: 'Invalid overpayment',
          },
        }),
      );
    });
    await test('branch isolation covers suppliers, orders, receipts, account entries and references', async () => {
      const branch = await db.branch.create({
        data: {
          organizationId: scope.organizationId,
          code: 'purchasing-other',
          name: 'Other purchasing branch',
          currency: 'EUR',
          timezone: 'Europe/Pristina',
        },
      });
      const foreign = await db.supplier.create({
        data: {
          branchId: branch.id,
          organizationId: scope.organizationId,
          name: 'Foreign supplier',
        },
      });
      await get(`purchasing/suppliers/${foreign.id}/account`, 404);
      await post('purchasing/orders', draft({ supplierId: foreign.id }), 404);
      const ownerRole = await db.role.findFirstOrThrow({
        where: { organizationId: scope.organizationId, name: 'OWNER' },
      });
      await db.branchMembership.create({
        data: { branchId: branch.id, organizationId: scope.organizationId, userId: auth.user.id },
      });
      await db.userBranchRole.create({
        data: {
          branchId: branch.id,
          organizationId: scope.organizationId,
          userId: auth.user.id,
          roleId: ownerRole.id,
        },
      });
      const foreignLogin = (
        await http
          .post('/api/auth/login')
          .set('Origin', origin)
          .send({
            organization: 'verification',
            branch: 'purchasing-other',
            email: process.env.SEED_OWNER_EMAIL,
            password: process.env.SEED_OWNER_PASSWORD,
          })
          .expect(200)
      ).body;
      const foreignToken = foreignLogin.accessToken;
      await get(`purchasing/orders/${order.id}`, 404, foreignToken);
      await get(`purchasing/receipts/${receipt.id}`, 404, foreignToken);
      await get(`purchasing/suppliers/${supplier.id}/account`, 404, foreignToken);
      assert.equal(
        (await get(`purchasing/orders/${order.id}/history`, 200, foreignToken)).events.length,
        0,
      );
      assert.equal((await get('purchasing/receipts', 200, foreignToken)).items.length, 0);
      await post(`purchasing/orders/${order.id}/receive`, receive(order), 404, foreignToken);
      await post(
        'purchasing/payments',
        cmd({
          receiptId: receipt.id,
          amount: '1.00',
          method: 'BANK_TRANSFER',
          reference: 'FOREIGN',
          reason: 'Invalid',
        }),
        404,
        foreignToken,
      );
      await post(
        `purchasing/payments/${payment.id}/reverse`,
        cmd({ reason: 'Invalid' }),
        404,
        foreignToken,
      );
      await assert.rejects(
        db.purchaseOrder.create({
          data: {
            ...scope,
            supplierId: foreign.id,
            warehouseId: warehouse.id,
            userId: auth.user.id,
            number: 99999n,
            currency: 'EUR',
            supplierSnapshot: { name: 'Foreign supplier' },
            warehouseName: warehouse.name,
            subtotal: '0',
            tax: '0',
            total: '0',
          },
        }),
      );
      assert(!(await get('purchasing/suppliers')).items.some((s) => s.id === foreign.id));
    });
    await test('unreceived cancellation, archive history, events and revoked permissions persist', async () => {
      let o = await post('purchasing/orders', draft());
      o = await post(
        `purchasing/orders/${o.id}/cancel`,
        cmd({ version: o.version, reason: 'Supplier unavailable' }),
      );
      assert.equal(o.status, 'CANCELLED');
      const disposable = await post('purchasing/suppliers', cmd({ name: 'Archived supplier' }));
      await post(
        `purchasing/suppliers/${disposable.id}/archive`,
        cmd({ version: disposable.version }),
      );
      assert(
        (await get('purchasing/suppliers?includeArchived=true')).items.some(
          (s) => s.id === disposable.id,
        ),
      );
      const history = await get(`purchasing/orders/${order.id}/history`);
      assert(history.events.some((e) => e.action === 'purchase.received'));
      const events = await get('purchasing/events?limit=1');
      assert(events.hasMore);
      assert(BigInt(events.cursor) > 0n);
      await call('patch', `roles/${role.id}/permissions`).send({ permissions: [] }).expect(200);
      await get('purchasing/orders', 403, reader.token);
    });
    console.log(`Purchasing integration suite passed: ${count} checks.`);
  } finally {
    await db.$disconnect();
    await runtime.$disconnect();
  }
}
