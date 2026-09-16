import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import request from 'supertest';
const require = createRequire(import.meta.url);
const { createDatabase } = require('@restaurant/database');

export async function runSyncIntegration(app) {
  const db = createDatabase(process.env.MIGRATION_DATABASE_URL);
  const http = request(app.getHttpServer()),
    origin = process.env.APP_ORIGIN;
  let count = 0;
  const test = async (name, fn) => {
    await fn();
    console.log(`PASS sync ${++count}: ${name}`);
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
    const streams = [
      'layout',
      'orders',
      'kitchen',
      'payments',
      'inventory',
      'purchasing',
      'companies',
    ];

    await test('sync status needs a session and sync.read; operational roles are refused', async () => {
      await http.get('/api/sync/status').expect(401);
      const role = await post('roles', { name: 'Sync viewer', permissions: ['sync.read'] });
      const password = 'Sync-viewer-password-12!';
      await post('users', {
        name: 'Sync viewer',
        email: 'sync-viewer@verification.test',
        password,
        roleIds: [role.id],
      });
      const reader = await login({
        ...credentials,
        email: 'sync-viewer@verification.test',
        password,
      });
      await get('sync/status', 200, reader.accessToken);
      // A sync reader holds no operational authority.
      await get('orders', 403, reader.accessToken);
      await get('payments/shifts', 403, reader.accessToken);
      await get('reports/sales', 403, reader.accessToken);
      const roles = await get('roles');
      const cashier = roles.find((r) => r.name === 'CASHIER');
      await post('users', {
        name: 'Sync cashier',
        email: 'sync-cashier@verification.test',
        password,
        roleIds: [cashier.id],
      });
      const operator = await login({
        ...credentials,
        email: 'sync-cashier@verification.test',
        password,
      });
      await get('sync/status', 403, operator.accessToken);
      // Revocation takes effect on the existing session immediately.
      await call('patch', `roles/${role.id}/permissions`).send({ permissions: [] }).expect(200);
      await get('sync/status', 403, reader.accessToken);
    });

    await test('status is strict, branch scoped and reports every durable stream', async () => {
      await get('sync/status?branchId=' + scope.branchId, 400);
      await get('sync/status?organizationId=' + scope.organizationId, 400);
      await get('sync/status?stream=ledger', 400);
      await call('post', 'sync/status').send({}).expect(404);
      const status = await get('sync/status');
      assert.equal(status.localAuthoritative, true);
      assert.equal(status.branchId, scope.branchId);
      assert.equal(status.organizationId, scope.organizationId);
      assert.deepEqual(status.streams.map((s) => s.stream).sort(), [...streams].sort());
      // No cloud target is configured in verification, so delivery is inert by design.
      assert.equal(status.enabled, false);
      assert.equal(status.health, 'disabled');
      const one = await get('sync/status?stream=orders');
      assert.equal(one.streams.length, 1);
      assert.equal(one.streams[0].stream, 'orders');
    });

    await test('local revisions advance with real business writes and become pending delivery', async () => {
      const before = await get('sync/status?stream=layout');
      const area = await post('layout/areas', { name: 'Sync area ' + randomUUID().slice(0, 8) });
      assert.ok(area.id);
      const after = await get('sync/status?stream=layout');
      // The event log is the outbox: a committed business change raises the local cursor.
      assert.ok(
        BigInt(after.streams[0].localRevision) > BigInt(before.streams[0].localRevision),
        'layout revision advanced',
      );
      // Nothing was delivered, so the new record is pending, never silently acknowledged.
      assert.equal(after.streams[0].deliveredRevision, '0');
      assert.ok(after.streams[0].pending >= 1);
      assert.equal(after.streams[0].lastDeliveredAt, null);
    });

    await test('a delivery checkpoint never rewinds and never alters business data', async () => {
      const counts = async () => [
        await db.order.count(),
        await db.payment.count(),
        await db.stockMovement.count(),
        await db.companyLedgerEntry.count(),
        await db.auditLog.count(),
        await db.layoutEvent.count(),
      ];
      const before = await counts();
      const checkpoint = { ...scope, stream: 'orders' };
      await db.syncCheckpoint.create({ data: { ...checkpoint, deliveredRevision: 5 } });
      let status = await get('sync/status?stream=orders');
      assert.equal(status.streams[0].deliveredRevision, '5');
      // A stale acknowledgement must not move the cursor backwards.
      await db.syncCheckpoint.updateMany({
        where: checkpoint,
        data: { deliveredRevision: 5 },
      });
      status = await get('sync/status?stream=orders');
      assert.equal(status.streams[0].deliveredRevision, '5');
      // Reading and checkpointing never touch business rows.
      assert.deepEqual(await counts(), before);
      await db.syncCheckpoint.deleteMany({ where: checkpoint });
    });

    await test('a checkpoint ahead of local history reports no backlog and no negative count', async () => {
      const checkpoint = { ...scope, stream: 'kitchen' };
      // Branch revisions in this database deliberately exceed Number.MAX_SAFE_INTEGER to
      // prove cursor precision, so "ahead" is computed from the live local revision
      // rather than from a hard-coded constant that only looks large.
      const current = await get('sync/status?stream=kitchen');
      const ahead = (BigInt(current.streams[0].localRevision) + 1000n).toString();
      await db.syncCheckpoint.create({ data: { ...checkpoint, deliveredRevision: ahead } });
      const status = await get('sync/status?stream=kitchen');
      // A restored or rebuilt database must not produce a negative backlog or reprocessing.
      assert.equal(status.streams[0].deliveredRevision, ahead);
      assert.equal(status.streams[0].pending, 0);
      assert.equal(status.pendingTotal, 0);
      await db.syncCheckpoint.deleteMany({ where: checkpoint });
    });

    await test('a large genuine backlog is clamped for display without losing the cursor', async () => {
      // Revisions here exceed the JS safe integer range. The reported backlog is clamped
      // so the figure stays usable, while the exact cursors remain exact decimal strings.
      const status = await get('sync/status?stream=orders');
      const row = status.streams[0];
      assert.equal(row.deliveredRevision, '0');
      assert.ok(BigInt(row.localRevision) > BigInt(Number.MAX_SAFE_INTEGER));
      assert.equal(row.pending, 1000000);
      assert.equal(typeof row.localRevision, 'string');
    });

    await test('a recorded delivery failure is reported rather than shown as healthy', async () => {
      const checkpoint = { ...scope, stream: 'payments' };
      await db.syncCheckpoint.create({
        data: {
          ...checkpoint,
          deliveredRevision: 0,
          lastError: 'connection refused',
          failedAttempts: 3,
          lastAttemptAt: new Date(),
        },
      });
      const status = await get('sync/status');
      const row = status.streams.find((s) => s.stream === 'payments');
      assert.equal(row.lastError, 'connection refused');
      assert.equal(row.failedAttempts, 3);
      assert.equal(status.degraded, true);
      // Delivery health never gates local operation: a business write still succeeds.
      const area = await post('layout/areas', {
        name: 'Sync degraded ' + randomUUID().slice(0, 8),
      });
      assert.ok(area.id);
      await db.syncCheckpoint.deleteMany({ where: checkpoint });
    });

    await test('branch isolation: checkpoints and revisions never cross a branch boundary', async () => {
      const branch = await db.branch.create({
        data: {
          organizationId: scope.organizationId,
          code: 'sync-other',
          name: 'Other sync branch',
          currency: 'EUR',
          timezone: 'Europe/Belgrade',
        },
      });
      await db.syncCheckpoint.create({
        data: {
          branchId: branch.id,
          organizationId: scope.organizationId,
          stream: 'orders',
          deliveredRevision: 424242,
        },
      });
      const status = await get('sync/status?stream=orders');
      // The foreign branch's checkpoint is invisible from this session.
      assert.notEqual(status.streams[0].deliveredRevision, '424242');
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
      const foreign = await login({ ...credentials, branch: 'sync-other' });
      const foreignStatus = await get('sync/status?stream=orders', 200, foreign.accessToken);
      assert.equal(foreignStatus.branchId, branch.id);
      assert.equal(foreignStatus.streams[0].deliveredRevision, '424242');
      // The unique constraint is per branch, organization and stream.
      await assert.rejects(() =>
        db.syncCheckpoint.create({
          data: {
            branchId: branch.id,
            organizationId: scope.organizationId,
            stream: 'orders',
            deliveredRevision: 1,
          },
        }),
      );
    });

    await test('the database rejects an unknown stream and a negative cursor', async () => {
      await assert.rejects(
        () => db.syncCheckpoint.create({ data: { ...scope, stream: 'ledger' } }),
        'unknown stream refused',
      );
      await assert.rejects(
        () =>
          db.syncCheckpoint.create({
            data: { ...scope, stream: 'inventory', deliveredRevision: -1 },
          }),
        'negative cursor refused',
      );
    });

    console.log(`Sync integration suite passed: ${count} checks.`);
  } finally {
    await db.$disconnect();
  }
}
