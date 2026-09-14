import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import request from 'supertest';
const require = createRequire(import.meta.url);
const { createDatabase } = require('@restaurant/database');

export async function runInventoryIntegration(app) {
  const db = createDatabase(process.env.MIGRATION_DATABASE_URL),
    runtime = createDatabase();
  const http = request(app.getHttpServer()),
    origin = process.env.APP_ORIGIN;
  let count = 0;
  const test = async (name, fn) => {
    await fn();
    console.log(`PASS inventory ${++count}: ${name}`);
  };
  try {
    const credentials = {
      organization: 'verification',
      branch: 'main',
      email: process.env.SEED_OWNER_EMAIL,
      password: process.env.SEED_OWNER_PASSWORD,
    };
    const auth = (
      await http.post('/api/auth/login').set('Origin', origin).send(credentials).expect(200)
    ).body;
    const token = auth.accessToken,
      scope = { branchId: auth.user.branchId, organizationId: auth.user.organizationId };
    const call = (method, path, bearer = token) =>
      http[method]('/api/' + path)
        .set('Origin', origin)
        .set('Authorization', 'Bearer ' + bearer);
    const post = async (path, body, status = 201, bearer = token) =>
      (await call('post', path, bearer).send(body).expect(status)).body;
    const get = async (path, status = 200, bearer = token) =>
      (await call('get', path, bearer).expect(status)).body;
    const input = (body) => ({ commandId: randomUUID(), ...body });
    const warehouse = await post('inventory/warehouses', input({ name: 'Inventory test kitchen' }));
    const ingredient = await post(
      'inventory/items',
      input({
        name: 'Inventory test chicken',
        sku: 'INV7-CHICKEN',
        kind: 'INGREDIENT',
        unitCode: 'g',
      }),
    );
    const category = await db.category.create({ data: { ...scope, name: 'Inventory test food' } });
    const product = await db.product.create({
      data: {
        ...scope,
        categoryId: category.id,
        name: 'Inventory test burger',
        sku: 'INV7-BURGER',
        sellingPrice: '5.00',
        taxRate: '0.00',
        taxMode: 'INCLUSIVE',
      },
    });
    const movement = (extra, status = 201) =>
      post(
        'inventory/movements',
        input({
          warehouseId: warehouse.id,
          itemId: ingredient.id,
          kind: 'ADJUSTMENT',
          quantity: '1',
          unitCode: 'kg',
          reason: 'Opening count',
          ...extra,
        }),
        status,
      );
    const stock = async () =>
      (await get(`inventory/stock?warehouseId=${warehouse.id}&itemId=${ingredient.id}`)).items[0];
    const recipeInput = (version, quantity = '150') =>
      input({
        productId: product.id,
        warehouseId: warehouse.id,
        version,
        active: true,
        items: [{ itemId: ingredient.id, quantity, unitCode: 'g' }],
      });
    const command = (o, body) =>
      post(`orders/${o.id}/commands`, input({ version: o.version, ...body }));
    const order = async (quantity = 1, discount = false, productId = product.id) => {
      let row = await post('orders', input({ type: 'TAKEAWAY' }));
      row = await command(row, {
        action: 'add_item',
        productId,
        quantity,
        modifierIds: [],
        notes: '',
      });
      if (discount)
        row = await command(row, {
          action: 'discount',
          amount: row.total,
          reason: 'Complimentary inventory test',
        });
      row = await command(row, { action: 'status', status: 'OPEN' });
      return command(row, { action: 'status', status: 'WAITING_PAYMENT' });
    };
    const paymentInput = (o, amount) =>
      input({
        version: o.version,
        mode: 'AMOUNT',
        tenders: [
          { method: 'CARD', amount, transactionReference: 'inventory-test-' + randomUUID() },
        ],
      });
    const collect = (o, amount, status = 201) =>
      post(`payments/orders/${o.id}/collect`, paymentInput(o, amount), status);
    let role, reader, recipe, partial, settledReceipt;
    await test('reference units, strict inputs and distinct read/adjust/waste permissions', async () => {
      assert.deepEqual((await get('inventory/units')).map((u) => u.code).sort(), [
        'g',
        'kg',
        'l',
        'ml',
        'pcs',
      ]);
      await http.get('/api/inventory/stock').expect(401);
      role = await post('roles', { name: 'Inventory reader', permissions: ['inventory.read'] });
      await post('users', {
        name: 'Inventory reader',
        email: 'inventory-reader@test.invalid',
        password: credentials.password,
        roleIds: [role.id],
      });
      reader = (
        await http
          .post('/api/auth/login')
          .set('Origin', origin)
          .send({ ...credentials, email: 'inventory-reader@test.invalid' })
          .expect(200)
      ).body;
      await get('inventory/stock', 200, reader.accessToken);
      await post(
        'inventory/movements',
        input({
          warehouseId: warehouse.id,
          itemId: ingredient.id,
          kind: 'WASTE',
          quantity: '1',
          unitCode: 'g',
          reason: 'Test',
        }),
        403,
        reader.accessToken,
      );
      await post(
        'inventory/items',
        input({ name: 'No access', sku: 'NONE', kind: 'INGREDIENT', unitCode: 'g' }),
        403,
        reader.accessToken,
      );
      for (const extra of [
        { quantity: '1.1234567' },
        { reason: '' },
        { quantity: 1 },
        { branchId: randomUUID() },
      ])
        await movement(extra, 400);
      await movement({ unitCode: 'l' }, 400);
    });
    await test('append-only opening stock, exact conversion, replay and conflicting command reuse', async () => {
      const request = input({
        warehouseId: warehouse.id,
        itemId: ingredient.id,
        kind: 'ADJUSTMENT',
        quantity: '1',
        unitCode: 'kg',
        reason: 'Opening count',
      });
      const first = await post('inventory/movements', request);
      assert.deepEqual(await post('inventory/movements', request), first);
      await post('inventory/movements', { ...request, quantity: '2' }, 409);
      assert.equal((await stock()).quantity, '1000.000000');
      assert.equal(await db.stockMovement.count({ where: { positionId: (await stock()).id } }), 1);
    });
    await test('waste and signed adjustments retain reasons and low-stock thresholds', async () => {
      await movement({ kind: 'WASTE', quantity: '100', unitCode: 'g', reason: 'Spoiled' });
      await movement({ quantity: '-50', unitCode: 'g', reason: 'Count correction' });
      const s = await stock();
      await post(
        'inventory/thresholds',
        input({
          warehouseId: warehouse.id,
          itemId: ingredient.id,
          version: s.version,
          lowStockThreshold: '0.900',
          unitCode: 'kg',
        }),
      );
      assert.equal((await stock()).quantity, '850.000000');
      assert.equal((await stock()).lowStock, true);
      assert.equal((await stock()).lowStockThreshold, '900.000000');
      const history = await get(`inventory/movements?itemId=${ingredient.id}`);
      assert.equal(history.items.length, 3);
      assert(
        history.items.some(
          (m) => m.kind === 'WASTE' && m.quantity === '-100.000000' && m.reason === 'Spoiled',
        ),
      );
    });
    await test('recipes enforce unique ingredients, exact conversions and optimistic versions', async () => {
      recipe = await post('inventory/recipes', recipeInput(0));
      assert.equal(recipe.items[0].quantity, '150.000000');
      await post('inventory/recipes', recipeInput(0), 409);
      const invalid = recipeInput(1);
      invalid.items.push(invalid.items[0]);
      await post('inventory/recipes', invalid, 400);
      await post(
        'inventory/items/' + ingredient.id + '/archive',
        input({ version: ingredient.version }),
        409,
      );
      await post(
        'inventory/warehouses/' + warehouse.id + '/archive',
        input({ version: warehouse.version }),
        409,
      );
    });
    await test('partial payment freezes a plan; later recipe edits cannot rewrite its consumption', async () => {
      partial = await order(2);
      await collect(partial, '4.00');
      partial = await get(`orders/${partial.id}`);
      assert.equal((await stock()).quantity, '850.000000');
      const plan = await db.inventoryPlanItem.findMany({ where: { orderId: partial.id } });
      assert.equal(plan.length, 1);
      assert.equal(plan[0].quantity.toFixed(6), '300.000000');
      recipe = await post('inventory/recipes', recipeInput(1, '350'));
      assert.equal((await get(`inventory/recipes/${recipe.id}/history`)).items.length, 2);
      const request = paymentInput(partial, '6.00');
      settledReceipt = await post(`payments/orders/${partial.id}/collect`, request);
      assert.deepEqual(
        await post(`payments/orders/${partial.id}/collect`, request),
        settledReceipt,
      );
      assert.equal((await stock()).quantity, '550.000000');
      assert.equal((await get(`orders/${partial.id}`)).status, 'PAID');
      assert.equal(await db.stockMovement.count({ where: { orderId: partial.id } }), 1);
    });
    await test('refunds and cancelled partial payments do not manufacture returned ingredients', async () => {
      await post(
        `payments/${settledReceipt.payments[0].id}/reverse`,
        input({
          kind: 'REFUND',
          amount: '6.00',
          reason: 'Customer refund',
          transactionReference: 'inventory-refund',
        }),
      );
      assert.equal((await stock()).quantity, '550.000000');
      const o = await order();
      const receipt = await collect(o, '1.00');
      await post(
        `payments/${receipt.payments[0].id}/reverse`,
        input({
          kind: 'CANCELLATION',
          amount: '1.00',
          reason: 'Cancelled collection',
          transactionReference: 'inventory-cancel',
        }),
      );
      await command(await get(`orders/${o.id}`), {
        action: 'cancel',
        reason: 'Cancelled before sale',
      });
      assert.equal((await stock()).quantity, '550.000000');
      assert.equal(await db.stockMovement.count({ where: { orderId: o.id } }), 0);
    });
    await test('zero-total sales and negative stock are explicit, atomic and replayable', async () => {
      const o = await order(2, true);
      const request = input({ version: o.version });
      const receipt = await post(`payments/orders/${o.id}/settle-zero`, request);
      assert.deepEqual(await post(`payments/orders/${o.id}/settle-zero`, request), receipt);
      assert.equal((await stock()).quantity, '-150.000000');
      assert.equal((await stock()).lowStock, true);
      assert.equal(await db.stockMovement.count({ where: { orderId: o.id } }), 1);
    });
    await test('concurrent settlement cannot consume the same plan twice', async () => {
      const o = await order();
      const request = paymentInput(o, '5.00');
      const responses = await Promise.all([
        call('post', `payments/orders/${o.id}/collect`).send(request),
        call('post', `payments/orders/${o.id}/collect`).send(request),
      ]);
      assert(responses.some((r) => r.status === 201));
      assert(responses.every((r) => [201, 409].includes(r.status)));
      await post(`payments/orders/${o.id}/collect`, request);
      assert.equal(await db.stockMovement.count({ where: { orderId: o.id } }), 1);
      assert.equal((await stock()).quantity, '-500.000000');
    });
    await test('a stock insertion failure rolls back the entire payment and PAID transition', async () => {
      const o = await order();
      await db.$executeRawUnsafe(
        `CREATE FUNCTION inventory_test_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected inventory failure'; END $$`,
      );
      await db.$executeRawUnsafe(
        `CREATE TRIGGER inventory_test_failure BEFORE INSERT ON "StockMovement" FOR EACH ROW WHEN (NEW.kind='SALE_CONSUMPTION') EXECUTE FUNCTION inventory_test_failure()`,
      );
      try {
        await collect(o, '5.00', 500);
      } finally {
        await db.$executeRawUnsafe('DROP TRIGGER inventory_test_failure ON "StockMovement"');
        await db.$executeRawUnsafe('DROP FUNCTION inventory_test_failure()');
      }
      assert.equal(await db.payment.count({ where: { orderId: o.id } }), 0);
      assert.equal(await db.inventoryPlan.count({ where: { orderId: o.id } }), 0);
      assert.equal(await db.orderSettlement.count({ where: { orderId: o.id } }), 0);
      assert.equal((await get(`orders/${o.id}`)).status, 'WAITING_PAYMENT');
      assert.equal((await stock()).quantity, '-500.000000');
    });
    await test('inventory event failure rolls back stock and its audit record together', async () => {
      const before = await stock();
      const auditCount = await db.auditLog.count({
        where: { ...scope, action: 'inventory.adjustment' },
      });
      await db.$executeRawUnsafe(
        `CREATE FUNCTION inventory_event_test_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected event failure'; END $$`,
      );
      await db.$executeRawUnsafe(
        `CREATE TRIGGER inventory_event_test_failure BEFORE INSERT ON "InventoryEvent" FOR EACH ROW WHEN (NEW.action='inventory.adjustment') EXECUTE FUNCTION inventory_event_test_failure()`,
      );
      try {
        await movement({ quantity: '100', unitCode: 'g' }, 500);
      } finally {
        await db.$executeRawUnsafe('DROP TRIGGER inventory_event_test_failure ON "InventoryEvent"');
        await db.$executeRawUnsafe('DROP FUNCTION inventory_event_test_failure()');
      }
      assert.equal((await stock()).quantity, before.quantity);
      assert.equal(
        await db.auditLog.count({ where: { ...scope, action: 'inventory.adjustment' } }),
        auditCount,
      );
    });
    await test('database rejects incomplete plans even without going through the service', async () => {
      const o = await order();
      await assert.rejects(
        db.$transaction(async (tx) => {
          await tx.orderBill.create({ data: { ...scope, orderId: o.id, mode: 'AMOUNT' } });
          await tx.inventoryPlan.create({
            data: { ...scope, orderId: o.id, userId: auth.user.id, snapshot: {} },
          });
        }),
      );
      assert.equal(await db.orderBill.count({ where: { orderId: o.id } }), 0);
    });
    await test('branch isolation covers reads, writes and composite foreign keys', async () => {
      const foreignBranch = await db.branch.create({
        data: {
          organizationId: scope.organizationId,
          code: 'inventory-other',
          name: 'Other inventory branch',
        },
      });
      const foreignWarehouse = await db.warehouse.create({
        data: {
          branchId: foreignBranch.id,
          organizationId: scope.organizationId,
          name: 'Foreign warehouse',
        },
      });
      await movement({ warehouseId: foreignWarehouse.id }, 404);
      assert.equal(
        (await get(`inventory/stock?warehouseId=${foreignWarehouse.id}`)).items.length,
        0,
      );
      await assert.rejects(
        runtime.stockPosition.create({
          data: { ...scope, warehouseId: foreignWarehouse.id, itemId: ingredient.id },
        }),
      );
      await call('put', `inventory/warehouses/${foreignWarehouse.id}`)
        .send(input({ version: 1, name: 'Unauthorized', active: true }))
        .expect(404);
    });
    await test('database guards protect stock, units, recipe revisions and frozen plans', async () => {
      const m = await db.stockMovement.findFirst({ where: { ...scope } });
      for (const client of [db, runtime]) {
        await assert.rejects(
          client.stockMovement.update({ where: { id: m.id }, data: { quantity: '999' } }),
        );
        await assert.rejects(client.stockMovement.delete({ where: { id: m.id } }));
        await assert.rejects(
          client.inventoryUnit.update({ where: { code: 'kg' }, data: { factor: 2 } }),
        );
        await assert.rejects(
          client.inventoryItem.update({
            where: { id: ingredient.id },
            data: { unitCode: 'kg', version: { increment: 1 } },
          }),
        );
        await assert.rejects(client.$executeRawUnsafe('TRUNCATE "StockMovement" CASCADE'));
      }
      const line = await db.inventoryPlanItem.findFirst({ where: { orderId: partial.id } });
      await assert.rejects(
        db.inventoryPlanItem.update({ where: { id: line.id }, data: { quantity: '1' } }),
      );
      const revision = await db.recipeVersion.findFirst({ where: { recipeId: recipe.id } });
      await assert.rejects(
        db.recipeItem.create({
          data: { ...scope, recipeVersionId: revision.id, itemId: ingredient.id, quantity: '1' },
        }),
      );
      await assert.rejects(
        db.stockMovement.create({
          data: {
            ...scope,
            positionId: line.positionId,
            userId: auth.user.id,
            kind: 'SALE_CONSUMPTION',
            quantity: '-1',
            planItemId: line.id,
            orderId: partial.id,
            reason: 'Mismatch',
            snapshot: line.snapshot,
            enteredQuantity: '1',
            enteredUnit: 'g',
          },
        }),
      );
    });
    await test('configuration archives retain history, event cursors and immediate revocation', async () => {
      const disposable = await post(
        'inventory/items',
        input({ name: 'Archived salt', sku: 'INV7-ARCHIVE', kind: 'INGREDIENT', unitCode: 'g' }),
      );
      await movement({ itemId: disposable.id, quantity: '50', unitCode: 'g' });
      await post(
        `inventory/items/${disposable.id}/archive`,
        input({ version: disposable.version }),
      );
      assert.equal((await get(`inventory/movements?itemId=${disposable.id}`)).items.length, 1);
      assert.equal(
        (await get(`inventory/stock?itemId=${disposable.id}&includeArchived=true`)).items.length,
        1,
      );
      const feed = await get('inventory/events?after=0&limit=100');
      assert(feed.events.length);
      assert.equal(feed.events[0].response, undefined);
      assert.equal((await get(`inventory/events?after=${feed.cursor}`)).events.length, 0);
      assert(
        (await db.auditLog.count({ where: { ...scope, action: 'inventory.sale_consumed' } })) >= 3,
      );
      await call('patch', `roles/${role.id}/permissions`).send({ permissions: [] }).expect(200);
      await get('inventory/stock', 403, reader.accessToken);
    });
    console.log(`Inventory integration suite passed: ${count} checks.`);
  } finally {
    await runtime.$disconnect();
    await db.$disconnect();
  }
}
