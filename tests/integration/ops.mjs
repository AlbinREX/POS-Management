import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import request from 'supertest';
const require = createRequire(import.meta.url);
const { createDatabase } = require('@restaurant/database');

export async function runOpsIntegration(app) {
  const db = createDatabase(process.env.MIGRATION_DATABASE_URL);
  const http = request(app.getHttpServer()),
    origin = process.env.APP_ORIGIN;
  let count = 0;
  const test = async (name, fn) => {
    await fn();
    console.log(`PASS ops ${++count}: ${name}`);
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
    const call = (method, path, token = auth.accessToken) =>
      http[method]('/api/' + path)
        .set('Origin', origin)
        .set('Authorization', 'Bearer ' + token);
    const get = async (path, status = 200, token) =>
      (await call('get', path, token).expect(status)).body;
    const post = async (path, data, status = 201, token) =>
      (await call('post', path, token).send(data).expect(status)).body;

    let role, reader;
    await test('operational status needs a session and ops.read; operators are refused', async () => {
      await http.get('/api/ops/status').expect(401);
      role = await post('roles', { name: 'Ops viewer', permissions: ['ops.read'] });
      const password = 'Ops-viewer-password-13!';
      await post('users', {
        name: 'Ops viewer',
        email: 'ops-viewer@verification.test',
        password,
        roleIds: [role.id],
      });
      reader = await login({ ...credentials, email: 'ops-viewer@verification.test', password });
      await get('ops/status', 200, reader.accessToken);
      // An operations reader holds no business authority.
      await get('orders', 403, reader.accessToken);
      await get('payments/shifts', 403, reader.accessToken);
      await get('reports/sales', 403, reader.accessToken);
      const roles = await get('roles');
      const cashier = roles.find((r) => r.name === 'CASHIER');
      await post('users', {
        name: 'Ops cashier',
        email: 'ops-cashier@verification.test',
        password,
        roleIds: [cashier.id],
      });
      const operator = await login({
        ...credentials,
        email: 'ops-cashier@verification.test',
        password,
      });
      await get('ops/status', 403, operator.accessToken);
    });

    await test('status reports every operational signal with a worst-case severity', async () => {
      const status = await get('ops/status');
      assert.equal(status.localAuthoritative, true);
      assert.ok(['ok', 'warn', 'critical', 'unknown'].includes(status.severity));
      assert.deepEqual(status.checks.map((c) => c.id).sort(), [
        'backup',
        'database',
        'storage',
        'sync',
      ]);
      // The database is answering this very request, so it must report reachable.
      assert.equal(status.database.reachable, true);
      assert.equal(status.database.severity, 'ok');
      assert.ok(typeof status.uptimeSeconds === 'number' && status.uptimeSeconds >= 0);
      // The aggregate is the worst individual signal, never an average.
      const order = { ok: 0, unknown: 1, warn: 2, critical: 3 };
      const worst = status.checks.reduce(
        (w, c) => (order[c.severity] > order[w] ? c.severity : w),
        'ok',
      );
      assert.equal(status.severity, worst);
    });

    await test('no credential, connection string or driver detail is exposed', async () => {
      const body = JSON.stringify(await get('ops/status'));
      assert.ok(!/postgres(ql)?:\/\//i.test(body), 'no connection string');
      assert.ok(!/password|secret|JWT|PGPASSWORD/i.test(body), 'no secret material');
      // The seeded owner password must never appear anywhere in an operational payload.
      assert.ok(!body.includes(process.env.SEED_OWNER_PASSWORD), 'no seeded credential');
      assert.ok(!body.includes(process.env.JWT_SECRET ?? 'unset-secret'), 'no signing key');
    });

    await test('reading operational status writes nothing', async () => {
      const counts = async () => [
        await db.order.count(),
        await db.payment.count(),
        await db.auditLog.count(),
        await db.syncCheckpoint.count(),
      ];
      const before = await counts();
      for (let i = 0; i < 3; i++) await get('ops/status');
      assert.deepEqual(await counts(), before);
      // The endpoint is read-only: no write verb is routed.
      await call('post', 'ops/status').send({}).expect(404);
      await call('put', 'ops/status').send({}).expect(404);
    });

    await test('backup absence is reported as critical rather than silently healthy', async () => {
      // No backup archive exists in the verification harness, which is exactly the state
      // an unprotected restaurant would be in and must never read as fine.
      const status = await get('ops/status');
      assert.equal(status.backup.severity, 'critical');
      assert.equal(status.backup.outcome, 'unknown');
      assert.equal(status.backup.ageHours, null);
      assert.equal(status.severity, 'critical');
    });

    await test('sync backlog is reported without gating local operation', async () => {
      const status = await get('ops/status');
      // Phase 12 delivery is disabled in verification, so it must not raise severity.
      assert.equal(status.sync.health, 'disabled');
      assert.equal(status.sync.severity, 'ok');
      assert.equal(status.sync.degraded, false);
      // A business write still succeeds regardless of operational severity.
      const area = await post('layout/areas', { name: 'Ops area', sortOrder: 0 });
      assert.ok(area.id);
    });

    await test('revoking ops.read stops operational reads immediately', async () => {
      await call('patch', `roles/${role.id}/permissions`).send({ permissions: [] }).expect(200);
      await get('ops/status', 403, reader.accessToken);
    });

    console.log(`Ops integration suite passed: ${count} checks.`);
  } finally {
    await db.$disconnect();
  }
}
