import assert from 'node:assert/strict';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { createRequire } from 'node:module';
import { provisionRuntime } from '../../scripts/provision-runtime.mjs';
const require = createRequire(import.meta.url);
const { createDatabase } = require('@restaurant/database');
const { PERMISSIONS } = require('@restaurant/shared-types');
const { createApp } = require('../../apps/api/dist/bootstrap.js');

export async function runIntegration(app) {
  const ownerDb = createDatabase(process.env.MIGRATION_DATABASE_URL);
  const runtimeDb = createDatabase();
  const http = request(app.getHttpServer());
  const origin = process.env.APP_ORIGIN;
  let count = 0;
  const test = async (name, fn) => {
    await fn();
    count++;
    console.log(`PASS ${count}: ${name}`);
  };
  const credentials = {
    organization: 'verification',
    branch: 'main',
    email: process.env.SEED_OWNER_EMAIL,
    password: process.env.SEED_OWNER_PASSWORD,
  };
  const signIn = (body = credentials) =>
    http.post('/api/auth/login').set('Origin', origin).send(body);
  const cookieOf = (response) => response.headers['set-cookie'][0].split(';')[0];
  let owner;
  let ownerCookie;
  let user;
  let userToken;
  let roles;
  let terminal;
  let secondOrg;
  let secondBranch;
  try {
    await test('health and database readiness', async () => {
      await http.get('/api/health/live').expect(200);
      await http.get('/api/health/ready').expect(200);
    });
    await test('bootstrap is idempotent and no plaintext passwords are stored', async () => {
      assert.equal(await ownerDb.organization.count(), 1);
      assert.equal(await ownerDb.user.count(), 1);
      assert.equal(await ownerDb.role.count(), 7);
      assert.equal(await ownerDb.auditLog.count({ where: { action: 'system.bootstrap' } }), 1);
      const record = await ownerDb.user.findFirst();
      assert.match(record.passwordHash, /^\$argon2id\$/);
      assert.ok(!record.passwordHash.includes(credentials.password));
    });
    await test('authentication required on all administration routes', async () => {
      for (const route of [
        'auth/me',
        'users',
        'roles',
        'terminals',
        'audit-logs',
        'organization',
        'branch',
        'permissions',
      ])
        await http.get(`/api/${route}`).expect(401);
    });
    await test('CSRF rejects missing and foreign Origin', async () => {
      await http.post('/api/auth/login').send(credentials).expect(403);
      await http
        .post('/api/auth/login')
        .set('Origin', 'https://evil.example')
        .send(credentials)
        .expect(403);
    });
    await test('malformed JSON and oversized bodies have structured client errors', async () => {
      const invalid = await http
        .post('/api/auth/login')
        .set('Origin', origin)
        .set('Content-Type', 'application/json')
        .send('{broken')
        .expect(400);
      assert.equal(invalid.body.code, 'INVALID_JSON');
      const large = await http
        .post('/api/auth/login')
        .set('Origin', origin)
        .send({ data: 'a'.repeat(34000) })
        .expect(413);
      assert.equal(large.body.code, 'BODY_TOO_LARGE');
    });
    await test('input validation rejects malformed and injected permission data', async () => {
      await signIn({ ...credentials, permissions: ['all'] }).expect(400);
      await signIn({ ...credentials, email: 'invalid' }).expect(400);
    });
    await test('wrong password fails and records a safe failed-login audit', async () => {
      await signIn({ ...credentials, password: 'wrong-password' }).expect(401);
      assert.equal(await ownerDb.auditLog.count({ where: { action: 'auth.login_failed' } }), 1);
    });
    await test('owner login, safe response, cookie flags and security headers', async () => {
      const res = await signIn().expect(200);
      owner = res.body.accessToken;
      ownerCookie = cookieOf(res);
      assert.ok(owner);
      assert.equal(res.body.user.permissions.length, PERMISSIONS.length);
      assert.equal(res.body.refreshToken, undefined);
      assert.equal(res.body.user.passwordHash, undefined);
      assert.match(res.headers['set-cookie'][0], /HttpOnly/);
      assert.match(res.headers['set-cookie'][0], /SameSite=Strict/);
      assert.match(res.headers['set-cookie'][0], /Path=\/api\/auth/);
      assert.equal(res.headers['x-content-type-options'], 'nosniff');
      assert.ok(res.headers['x-request-id']);
      const token = await ownerDb.refreshToken.findFirst();
      assert.equal(token.tokenHash.length, 64);
      assert.notEqual(token.tokenHash, ownerCookie.split('=')[1]);
    });
    const auth = (method, path) =>
      http[method](`/api/${path}`).set('Authorization', `Bearer ${owner}`).set('Origin', origin);
    await test('tampered, expired and wrong-algorithm JWTs are rejected', async () => {
      const claims = jwt.decode(owner);
      for (const token of [
        'not-a-token',
        jwt.sign({ sid: claims.sid }, process.env.JWT_SECRET, {
          subject: claims.sub,
          issuer: 'restaurant-local',
          audience: 'restaurant-clients',
          expiresIn: -1,
        }),
        jwt.sign({ sid: claims.sid }, process.env.JWT_SECRET, {
          subject: claims.sub,
          issuer: 'restaurant-local',
          audience: 'restaurant-clients',
          algorithm: 'HS384',
        }),
      ])
        await http.get('/api/auth/me').set('Authorization', `Bearer ${token}`).expect(401);
    });
    await test('branch is selected by verified session and role defaults are configurable records', async () => {
      const branch = await auth('get', 'branch').expect(200);
      assert.equal(branch.body.code, 'main');
      roles = (await auth('get', 'roles').expect(200)).body;
      assert.equal(roles.length, 7);
    });
    await test('user creation is atomic, scoped and audited', async () => {
      const cashier = roles.find((r) => r.name === 'CASHIER');
      const res = await auth('post', 'users')
        .send({
          name: 'Verification cashier',
          email: 'cashier@verification.test',
          password: credentials.password,
          roleIds: [cashier.id],
        })
        .expect(201);
      user = res.body;
      assert.equal(user.passwordHash, undefined);
      assert.equal(await ownerDb.branchMembership.count({ where: { userId: user.id } }), 1);
      assert.equal(
        await ownerDb.auditLog.count({ where: { action: 'user.created', entityId: user.id } }),
        1,
      );
      await auth('post', 'users')
        .send({
          name: 'Rollback',
          email: 'rollback@verification.test',
          password: credentials.password,
          roleIds: [randomUUID()],
        })
        .expect(404);
      assert.equal(await ownerDb.user.count({ where: { email: 'rollback@verification.test' } }), 0);
    });
    await test('cashier cannot read or mutate administration', async () => {
      userToken = (await signIn({ ...credentials, email: user.email }).expect(200)).body
        .accessToken;
      await http.get('/api/users').set('Authorization', `Bearer ${userToken}`).expect(403);
      await http
        .post('/api/terminals')
        .set('Origin', origin)
        .set('Authorization', `Bearer ${userToken}`)
        .send({ name: 'Unauthorized', type: 'POS' })
        .expect(403);
    });
    await test('custom permission assignment applies to an existing token without role-name bypass', async () => {
      const role = (
        await auth('post', 'roles')
          .send({ name: 'Device reader', permissions: ['terminal.read'] })
          .expect(201)
      ).body;
      await auth('patch', `users/${user.id}/roles`)
        .send({ roleIds: [role.id] })
        .expect(200);
      await http.get('/api/terminals').set('Authorization', `Bearer ${userToken}`).expect(200);
      await http.get('/api/users').set('Authorization', `Bearer ${userToken}`).expect(403);
      await auth('patch', `roles/${role.id}/permissions`).send({ permissions: [] }).expect(200);
      await http.get('/api/terminals').set('Authorization', `Bearer ${userToken}`).expect(403);
    });
    await test('owner lockout and protected role escalation are rejected', async () => {
      const ownerRole = roles.find((r) => r.protected);
      await auth('patch', `roles/${ownerRole.id}/permissions`)
        .send({ permissions: [] })
        .expect(403);
      await auth('patch', `users/${user.id}/roles`)
        .send({ roleIds: [ownerRole.id] })
        .expect(403);
      const me = (await auth('get', 'auth/me').expect(200)).body;
      await auth('patch', `users/${me.id}/access`).send({ active: false }).expect(403);
    });
    await test('terminal registration and uniqueness', async () => {
      terminal = (
        await auth('post', 'terminals').send({ name: 'Verification POS', type: 'POS' }).expect(201)
      ).body;
      await auth('post', 'terminals').send({ name: 'Verification POS', type: 'POS' }).expect(409);
      await auth('post', 'terminals')
        .send({ name: 'Forged', type: 'POS', branchId: randomUUID() })
        .expect(400);
    });
    await test('database composite constraints reject cross-organization membership and role leakage', async () => {
      secondOrg = await ownerDb.organization.create({
        data: { slug: 'other-org', name: 'Other organization' },
      });
      secondBranch = await ownerDb.branch.create({
        data: { organizationId: secondOrg.id, code: 'other', name: 'Other branch' },
      });
      await assert.rejects(() =>
        ownerDb.branchMembership.create({
          data: { userId: user.id, branchId: secondBranch.id, organizationId: secondOrg.id },
        }),
      );
      const foreignRole = await ownerDb.role.create({
        data: { name: 'Foreign', organizationId: secondOrg.id },
      });
      const me = (await auth('get', 'auth/me')).body;
      await assert.rejects(() =>
        ownerDb.userBranchRole.create({
          data: {
            userId: user.id,
            branchId: me.branchId,
            organizationId: me.organizationId,
            roleId: foreignRole.id,
          },
        }),
      );
      await auth('patch', `users/${user.id}/roles`)
        .send({ roleIds: [foreignRole.id] })
        .expect(404);
    });
    await test('foreign organization terminals stay hidden and cannot be changed or used for login', async () => {
      const foreign = await ownerDb.terminal.create({
        data: {
          organizationId: secondOrg.id,
          branchId: secondBranch.id,
          name: 'Foreign terminal',
          type: 'POS',
        },
      });
      const rows = (await auth('get', 'terminals')).body;
      assert.ok(!rows.some((r) => r.id === foreign.id));
      await auth('patch', `terminals/${foreign.id}`).send({ active: false }).expect(404);
      await signIn({ ...credentials, terminalId: foreign.id }).expect(401);
    });
    await test('same-organization branch isolation and missing branch membership', async () => {
      const me = (await auth('get', 'auth/me')).body;
      const branch = await ownerDb.branch.create({
        data: { organizationId: me.organizationId, code: 'restricted', name: 'Restricted branch' },
      });
      const foreign = await ownerDb.terminal.create({
        data: {
          organizationId: me.organizationId,
          branchId: branch.id,
          name: 'Other branch terminal',
          type: 'KDS',
        },
      });
      assert.ok(!(await auth('get', 'terminals')).body.some((r) => r.id === foreign.id));
      await auth('patch', `terminals/${foreign.id}`).send({ active: false }).expect(404);
      await signIn({ ...credentials, branch: 'restricted' }).expect(401);
    });
    await test('terminal-bound heartbeat and immediate disable revocation', async () => {
      const session = (await signIn({ ...credentials, terminalId: terminal.id }).expect(200)).body;
      await http
        .post('/api/terminals/heartbeat')
        .set('Origin', origin)
        .set('Authorization', `Bearer ${session.accessToken}`)
        .expect(201);
      assert.ok((await ownerDb.terminal.findUnique({ where: { id: terminal.id } })).lastSeenAt);
      await auth('patch', `terminals/${terminal.id}`).send({ active: false }).expect(200);
      await http
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${session.accessToken}`)
        .expect(401);
      await auth('patch', `terminals/${terminal.id}`).send({ active: true }).expect(200);
    });
    await test('disabling membership revokes existing access and refresh sessions', async () => {
      const session = await signIn({ ...credentials, email: user.email }).expect(200);
      await auth('patch', `users/${user.id}/access`).send({ active: false }).expect(200);
      await http
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${session.body.accessToken}`)
        .expect(401);
      await http
        .post('/api/auth/refresh')
        .set('Origin', origin)
        .set('Cookie', cookieOf(session))
        .expect(401);
      await auth('patch', `users/${user.id}/access`).send({ active: true }).expect(200);
    });
    await test('refresh rotates secrets and replay revokes the whole family', async () => {
      const session = await signIn().expect(200);
      const original = cookieOf(session);
      const rotated = await http
        .post('/api/auth/refresh')
        .set('Origin', origin)
        .set('Cookie', original)
        .expect(200);
      assert.notEqual(cookieOf(rotated), original);
      await http
        .post('/api/auth/refresh')
        .set('Origin', origin)
        .set('Cookie', original)
        .expect(401);
      await http
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${rotated.body.accessToken}`)
        .expect(401);
      await http
        .post('/api/auth/refresh')
        .set('Origin', origin)
        .set('Cookie', cookieOf(rotated))
        .expect(401);
    });
    await test('concurrent refresh has one winner and revokes the compromised family', async () => {
      const session = await signIn().expect(200);
      const original = cookieOf(session);
      const results = await Promise.all(
        [1, 2].map(() =>
          http.post('/api/auth/refresh').set('Origin', origin).set('Cookie', original),
        ),
      );
      assert.deepEqual(results.map((r) => r.status).sort(), [200, 401]);
      await http
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${results.find((r) => r.status === 200).body.accessToken}`)
        .expect(401);
    });
    await test('audit is immutable under both runtime role and migration owner', async () => {
      const record = await ownerDb.auditLog.findFirst();
      await assert.rejects(() =>
        runtimeDb.auditLog.update({ where: { id: record.id }, data: { action: 'forged' } }),
      );
      await assert.rejects(() => ownerDb.auditLog.delete({ where: { id: record.id } }));
      await assert.rejects(() => ownerDb.$executeRawUnsafe('TRUNCATE TABLE "AuditLog"'));
      await assert.rejects(() => runtimeDb.$executeRawUnsafe('CREATE TABLE forbidden (id int)'));
      assert.ok(await ownerDb.auditLog.findUnique({ where: { id: record.id } }));
    });
    await test('runtime grants can be safely re-provisioned', async () => {
      await provisionRuntime();
      await auth('get', 'users').expect(200);
    });
    await test('audit reads are scoped and never contain credential secrets', async () => {
      const rows = (await auth('get', 'audit-logs').expect(200)).body;
      assert.ok(rows.length > 0);
      assert.ok(rows.every((r) => r.organizationId !== secondOrg.id));
      const all = JSON.stringify(await ownerDb.auditLog.findMany());
      assert.ok(!all.includes(credentials.password));
      assert.ok(!all.includes('passwordHash'));
      assert.ok(!all.includes(owner));
    });
    await test('password change verifies current password, revokes all sessions and is audited', async () => {
      const isolatedApp = await createApp();
      const http = request(isolatedApp.getHttpServer());
      const signIn = (body) => http.post('/api/auth/login').set('Origin', origin).send(body);
      try {
        const session = await signIn({ ...credentials, email: user.email }).expect(200);
        const bearer = `Bearer ${session.body.accessToken}`;
        const newPassword = `changed-${credentials.password}`;
        await http
          .post('/api/auth/password')
          .set('Origin', origin)
          .set('Authorization', bearer)
          .send({ currentPassword: 'incorrect', newPassword })
          .expect(401);
        await http
          .post('/api/auth/password')
          .set('Origin', origin)
          .set('Authorization', bearer)
          .send({ currentPassword: credentials.password, newPassword })
          .expect(204);
        await http.get('/api/auth/me').set('Authorization', bearer).expect(401);
        await http
          .post('/api/auth/refresh')
          .set('Origin', origin)
          .set('Cookie', cookieOf(session))
          .expect(401);
        await signIn({ ...credentials, email: user.email, password: newPassword }).expect(200);
        assert.equal(
          await ownerDb.auditLog.count({
            where: { action: 'auth.password_changed', entityId: user.id },
          }),
          1,
        );
      } finally {
        await isolatedApp.close();
      }
    });
    await test('logout revokes access immediately and clears the refresh cookie', async () => {
      const res = await http
        .post('/api/auth/logout')
        .set('Origin', origin)
        .set('Cookie', ownerCookie)
        .expect(204);
      assert.match(res.headers['set-cookie'][0], /Expires=Thu, 01 Jan 1970/);
      await http.get('/api/auth/me').set('Authorization', `Bearer ${owner}`).expect(401);
    });
    await test('authentication is rate limited with a structured response', async () => {
      const isolatedApp = await createApp();
      const isolatedHttp = request(isolatedApp.getHttpServer());
      try {
        for (let i = 0; i < 15; i++)
          await isolatedHttp.post('/api/auth/login').set('Origin', origin).send({}).expect(400);
        const limited = await isolatedHttp
          .post('/api/auth/login')
          .set('Origin', origin)
          .send({})
          .expect(429);
        assert.equal(limited.body.code, 'RATE_LIMITED');
      } finally {
        await isolatedApp.close();
      }
    });
    console.log(`Integration suite passed: ${count} checks.`);
  } finally {
    await ownerDb.$disconnect();
    await runtimeDb.$disconnect();
  }
}
