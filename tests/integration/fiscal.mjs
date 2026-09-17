import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import request from 'supertest';
const require = createRequire(import.meta.url);
const { createDatabase } = require('@restaurant/database');

export async function runFiscalIntegration(app) {
  const db = createDatabase(process.env.MIGRATION_DATABASE_URL);
  const http = request(app.getHttpServer()),
    origin = process.env.APP_ORIGIN;
  let count = 0;
  const test = async (name, fn) => {
    await fn();
    console.log(`PASS fiscal ${++count}: ${name}`);
  };
  try {
    const credentials = {
      organization: 'verification',
      branch: 'main',
      email: process.env.SEED_OWNER_EMAIL,
      password: process.env.SEED_OWNER_PASSWORD,
    };
    const login = async (input) =>
      (await http.post('/api/auth/login').set('Origin', origin).send(input).expect(200)).body;
    const auth = await login(credentials);
    const scope = { branchId: auth.user.branchId, organizationId: auth.user.organizationId };
    const call = (method, path, token = auth.accessToken) =>
      http[method]('/api/' + path)
        .set('Origin', origin)
        .set('Authorization', 'Bearer ' + token);
    const get = async (path, status = 200, token) =>
      (await call('get', path, token).expect(status)).body;
    const post = async (path, data, status = 201, token) =>
      (await call('post', path, token).send(data).expect(status)).body;
    const cmd = (x) => ({ commandId: randomUUID(), ...x });

    // A real settled sale: the only thing eligible for handoff.
    const category = await post('menu/categories', { kind: 'categories', name: 'Fiscal meals' });
    const product = await post('menu/products', {
      kind: 'products',
      name: 'Fiscal plate',
      sku: 'FISCAL-1',
      categoryId: category.id,
      sellingPrice: '9.00',
      taxRate: '18.00',
      taxMode: 'INCLUSIVE',
    });
    const settle = async () => {
      let o = await post('orders', cmd({ type: 'TAKEAWAY' }));
      for (const action of [
        { action: 'add_item', productId: product.id, quantity: 2 },
        { action: 'status', status: 'OPEN' },
        { action: 'status', status: 'WAITING_PAYMENT' },
      ])
        o = await post(`orders/${o.id}/commands`, cmd({ version: o.version, ...action }));
      await post(
        `payments/orders/${o.id}/collect`,
        cmd({
          version: o.version,
          mode: 'AMOUNT',
          tenders: [
            { method: 'CARD', amount: o.total, transactionReference: 'fiscal-' + randomUUID() },
          ],
        }),
      );
      return o;
    };
    const settled = await settle();

    let role, reader;
    await test('fiscal views need a session and fiscal.read; operators are refused', async () => {
      await http.get('/api/fiscal/status').expect(401);
      role = await post('roles', { name: 'Fiscal viewer', permissions: ['fiscal.read'] });
      const password = 'Fiscal-viewer-password-14!';
      await post('users', {
        name: 'Fiscal viewer',
        email: 'fiscal-viewer@verification.test',
        password,
        roleIds: [role.id],
      });
      reader = await login({ ...credentials, email: 'fiscal-viewer@verification.test', password });
      await get('fiscal/status', 200, reader.accessToken);
      await get('fiscal/handoffs', 200, reader.accessToken);
      // Visibility grants no business authority and no retry authority.
      await get('orders', 403, reader.accessToken);
      await get('payments/shifts', 403, reader.accessToken);
      await call('post', `fiscal/orders/${settled.id}/retry`, reader.accessToken)
        .send({})
        .expect(403);
      const roles = await get('roles');
      const cashier = roles.find((r) => r.name === 'CASHIER');
      await post('users', {
        name: 'Fiscal cashier',
        email: 'fiscal-cashier@verification.test',
        password,
        roleIds: [cashier.id],
      });
      const operator = await login({
        ...credentials,
        email: 'fiscal-cashier@verification.test',
        password,
      });
      await get('fiscal/status', 403, operator.accessToken);
    });

    await test('only a settled sale is eligible for handoff', async () => {
      // An open order has no settlement, so there is nothing to hand off.
      const open = await post('orders', cmd({ type: 'TAKEAWAY' }));
      await get(`fiscal/orders/${open.id}/payload`, 404);
      await call('post', `fiscal/orders/${open.id}/retry`).send({}).expect(404);
      await post(
        `orders/${open.id}/commands`,
        cmd({ version: open.version, action: 'cancel', reason: 'Fiscal eligibility' }),
      );
      // A settled sale produces a payload.
      const payload = await get(`fiscal/orders/${settled.id}/payload`);
      assert.equal(payload.orderId, settled.id);
      assert.equal(payload.settlementId, settled.id);
    });

    await test('payload is deterministic and carries the stored sale figures', async () => {
      const first = await get(`fiscal/orders/${settled.id}/payload`);
      const second = await get(`fiscal/orders/${settled.id}/payload`);
      assert.deepEqual(second, first);
      const order = await get('orders/' + settled.id);
      assert.equal(first.total, order.total);
      assert.equal(first.tax, order.tax);
      assert.equal(first.subtotal, order.subtotal);
      assert.equal(first.orderNumber, String(order.orderNumber));
      assert.equal(first.lines.length, 1);
      assert.equal(first.lines[0].quantity, 2);
      assert.equal(first.tenders[0].method, 'CARD');
      assert.equal(first.seller.branchId, scope.branchId);
      assert.equal(first.correlationKey, `riza-settlement:${settled.id}`);
      // The tax breakdown reproduces the order's own recorded tax.
      const breakdown = first.taxBreakdown.reduce((n, t) => n + BigInt(t.tax.replace('.', '')), 0n);
      assert.equal(breakdown, BigInt(order.tax.replace('.', '')));
      // This POS issues no fiscal identifier.
      assert.ok(!/fiscalNumber|fiscalReceipt|signature/i.test(JSON.stringify(first)));
    });

    await test('no transport is implemented, so a handoff is never reported as delivered', async () => {
      const status = await get('fiscal/status');
      assert.equal(status.enabled, false);
      assert.equal(status.transportPending, true);
      // A retry attempt records an honest failure rather than a fake success.
      const attempt = await post(`fiscal/orders/${settled.id}/retry`, {}, 201);
      assert.equal(attempt.state, 'RETRY_REQUIRED');
      assert.equal(attempt.providerReference, null);
      assert.match(attempt.lastError, /specification/i);
      assert.equal(attempt.correlationKey, `riza-settlement:${settled.id}`);
    });

    await test('a provider failure never alters financial truth', async () => {
      const counts = async () => [
        await db.order.count({ where: scope }),
        await db.payment.count({ where: scope }),
        await db.orderSettlement.count({ where: scope }),
        await db.companyLedgerEntry.count({ where: scope }),
      ];
      const before = await counts();
      const order = await get('orders/' + settled.id);
      for (let i = 0; i < 3; i++) await post(`fiscal/orders/${settled.id}/retry`, {}, 201);
      assert.deepEqual(await counts(), before);
      const after = await get('orders/' + settled.id);
      // The sale is still PAID with identical totals after repeated provider failure.
      assert.equal(after.status, 'PAID');
      assert.equal(after.total, order.total);
      assert.equal(after.version, order.version);
    });

    await test('duplicate handoff protection: one settlement, one delivery identity', async () => {
      const rows = await db.fiscalHandoff.findMany({ where: { ...scope, orderId: settled.id } });
      assert.equal(rows.length, 1, 'exactly one handoff row per settlement');
      assert.ok(rows[0].attempts >= 4, 'retries increment attempts on the same row');
      // The unique constraints make a second row impossible even from direct SQL.
      await assert.rejects(() =>
        db.fiscalHandoff.create({
          data: {
            ...scope,
            orderId: settled.id,
            correlationKey: `riza-settlement:${settled.id}`,
            provider: 'sandbox',
            state: 'PENDING',
          },
        }),
      );
    });

    await test('retry reuses the same correlation identity and is audited', async () => {
      const before = await db.auditLog.count({
        where: { ...scope, action: 'fiscal.handoff_retried' },
      });
      const retried = await post(`fiscal/orders/${settled.id}/retry`, {}, 201);
      assert.equal(retried.correlationKey, `riza-settlement:${settled.id}`);
      const after = await db.auditLog.count({
        where: { ...scope, action: 'fiscal.handoff_retried' },
      });
      assert.equal(after, before + 1, 'every operator retry is audited');
      const entry = await db.auditLog.findFirst({
        where: { ...scope, action: 'fiscal.handoff_retried' },
        orderBy: { createdAt: 'desc' },
      });
      assert.equal(entry.afterData.orderId, settled.id);
      // The audit record carries no credential or endpoint.
      assert.ok(!/password|secret|endpoint|http/i.test(JSON.stringify(entry.afterData)));
    });

    await test('a confirmed handoff is terminal and can never be re-sent', async () => {
      // Simulate a provider confirmation directly, then prove the API refuses to re-send.
      await db.fiscalHandoff.updateMany({
        where: { ...scope, orderId: settled.id },
        data: {
          state: 'CONFIRMED',
          confirmedAt: new Date(),
          providerReference: 'provider-supplied-ref',
          lastError: null,
        },
      });
      await call('post', `fiscal/orders/${settled.id}/retry`).send({}).expect(409);
      const status = await get(`fiscal/orders/${settled.id}`);
      assert.equal(status.state, 'CONFIRMED');
      assert.equal(status.providerReference, 'provider-supplied-ref');
      const summary = await get('fiscal/status');
      assert.equal(summary.counts.CONFIRMED >= 1, true);
    });

    await test('the database refuses an unknown state and an inconsistent confirmation', async () => {
      const other = await settle();
      await assert.rejects(
        () =>
          db.fiscalHandoff.create({
            data: {
              ...scope,
              orderId: other.id,
              correlationKey: `riza-settlement:${other.id}`,
              provider: 'sandbox',
              state: 'ISSUED',
            },
          }),
        'unknown state refused',
      );
      await assert.rejects(
        () =>
          db.fiscalHandoff.create({
            data: {
              ...scope,
              orderId: other.id,
              correlationKey: `riza-settlement:${other.id}`,
              provider: 'sandbox',
              state: 'CONFIRMED',
            },
          }),
        'a confirmed row must carry its confirmation time',
      );
    });

    await test('branch isolation: a foreign branch cannot see or retry a handoff', async () => {
      const branch = await db.branch.create({
        data: {
          organizationId: scope.organizationId,
          code: 'fiscal-other',
          name: 'Other fiscal branch',
          currency: 'EUR',
          timezone: 'Europe/Belgrade',
        },
      });
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
      const foreign = await login({ ...credentials, branch: 'fiscal-other' });
      // The other branch's settled sale is invisible and unusable from here.
      await get(`fiscal/orders/${settled.id}/payload`, 404, foreign.accessToken);
      await call('post', `fiscal/orders/${settled.id}/retry`, foreign.accessToken)
        .send({})
        .expect(404);
      const list = await get('fiscal/handoffs', 200, foreign.accessToken);
      assert.equal(list.length, 0);
      const summary = await get('fiscal/status', 200, foreign.accessToken);
      assert.equal(summary.unresolved, 0);
    });

    await test('inputs are strict and no fiscal identifier is accepted from a client', async () => {
      await get('fiscal/handoffs?state=ISSUED', 400);
      await get('fiscal/handoffs?branchId=' + scope.branchId, 400);
      await call('post', `fiscal/orders/${settled.id}/retry`)
        .send({ providerReference: 'forged-fiscal-number' })
        .expect(400);
      await call('post', `fiscal/orders/${settled.id}/retry`)
        .send({ fiscalNumber: '12345' })
        .expect(400);
    });

    await test('revoking fiscal.read stops fiscal reads immediately', async () => {
      await call('patch', `roles/${role.id}/permissions`).send({ permissions: [] }).expect(200);
      await get('fiscal/status', 403, reader.accessToken);
    });

    console.log(`Fiscal integration suite passed: ${count} checks.`);
  } finally {
    await db.$disconnect();
  }
}
