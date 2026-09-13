import assert from 'node:assert/strict';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createDatabase } = require('@restaurant/database');
export async function runLayoutIntegration(app) {
  const db = createDatabase(process.env.MIGRATION_DATABASE_URL),
    runtime = createDatabase();
  const http = request(app.getHttpServer()),
    origin = process.env.APP_ORIGIN;
  let count = 0;
  const test = async (name, fn) => {
    await fn();
    console.log(`PASS layout ${++count}: ${name}`);
  };
  try {
    const credentials = {
      organization: 'verification',
      branch: 'main',
      email: process.env.SEED_OWNER_EMAIL,
      password: process.env.SEED_OWNER_PASSWORD,
    };
    const login = await http
      .post('/api/auth/login')
      .set('Origin', origin)
      .send(credentials)
      .expect(200);
    const token = login.body.accessToken,
      scoped = {
        branchId: login.body.user.branchId,
        organizationId: login.body.user.organizationId,
      };
    const call = (method, path, bearer = token) =>
      http[method]('/api/layout/' + path)
        .set('Origin', origin)
        .set('Authorization', 'Bearer ' + bearer);
    const createArea = async (name, extra = {}) =>
      (
        await call('post', 'areas')
          .send({ name, ...extra })
          .expect(201)
      ).body;
    const createTable = async (data, expected = 201) =>
      (await call('post', 'tables').send(data).expect(expected)).body;
    const updateTable = async (row, data, expected = 200) =>
      (
        await call('put', 'tables/' + row.id)
          .send({ version: row.version, data })
          .expect(expected)
      ).body;
    const status = async (row, state, expected = 200, bearer = token) =>
      (
        await call('patch', 'tables/' + row.id + '/status', bearer)
          .send({ version: row.version, status: state })
          .expect(expected)
      ).body;
    const archive = async (kind, row, expected = 201) =>
      (
        await call('post', kind + '/' + row.id + '/archive')
          .send({ version: row.version })
          .expect(expected)
      ).body;
    let indoor, terrace, table, data, reader, statusOnly, readerRole;
    await test('layout is not seeded and all reads require authentication', async () => {
      assert.equal(await db.area.count(), 0);
      assert.equal(await db.restaurantTable.count(), 0);
      for (const path of ['areas', 'tables', 'changes', 'areas/' + randomUUID() + '/map'])
        await http.get('/api/layout/' + path).expect(401);
      await call('get', 'changes?after=garbage').expect(400);
      await call('get', 'areas?branchId=' + scoped.branchId).expect(400);
      await call('post', 'areas')
        .send({ name: 'Forged', ...scoped })
        .expect(400);
    });
    await test('custom read and status permissions do not grant layout configuration', async () => {
      for (const [name, permissions] of [
        ['reader', ['layout.read']],
        ['operator', ['layout.read', 'layout.status.manage']],
      ]) {
        const role = (
          await http
            .post('/api/roles')
            .set('Origin', origin)
            .set('Authorization', 'Bearer ' + token)
            .send({ name: 'Layout ' + name, permissions })
            .expect(201)
        ).body;
        if (name === 'reader') readerRole = role;
        const email = 'layout-' + name + '@verification.test';
        await http
          .post('/api/users')
          .set('Origin', origin)
          .set('Authorization', 'Bearer ' + token)
          .send({ name, email, password: credentials.password, roleIds: [role.id] })
          .expect(201);
        const session = await http
          .post('/api/auth/login')
          .set('Origin', origin)
          .send({ ...credentials, email })
          .expect(200);
        const bearer = session.body.accessToken;
        if (name === 'reader') reader = bearer;
        else statusOnly = bearer;
        await call('get', 'areas', bearer).expect(200);
        await call('get', 'changes', bearer).expect(200);
        for (const kind of ['areas', 'tables']) {
          await call('post', kind, bearer).send({}).expect(403);
          await call('put', kind + '/' + randomUUID(), bearer)
            .send({})
            .expect(403);
          await call('post', kind + '/' + randomUUID() + '/archive', bearer)
            .send({ version: 1 })
            .expect(403);
        }
        await call('patch', 'tables/' + randomUUID() + '/geometry', bearer)
          .send({})
          .expect(403);
      }
      await call('patch', 'tables/' + randomUUID() + '/status', reader)
        .send({})
        .expect(403);
    });
    await test('configurable Indoor/Terrace, all shape fields and map snapshots persist', async () => {
      indoor = await createArea('Integration Indoor');
      terrace = await createArea('Integration Terrace');
      data = {
        areaId: indoor.id,
        name: 'Integration table',
        number: 101,
        capacity: 4,
        positionX: 20,
        positionY: 30,
        width: 100,
        height: 100,
        shape: 'CIRCLE',
      };
      table = await createTable(data);
      assert.equal(table.status, 'FREE');
      assert.equal(table.active, true);
      const map = (await call('get', 'areas/' + indoor.id + '/map').expect(200)).body;
      assert.equal(map.tables[0].id, table.id);
      assert.equal(map.area.name, indoor.name);
      assert.equal(map.revision, '3');
      const events = (await call('get', 'changes?after=0&limit=2').expect(200)).body;
      assert.equal(events.hasMore, true);
      assert.equal(events.cursor, '2');
      assert.equal(events.events[0].entityType, 'Area');
      const tail = (await call('get', 'changes?after=' + events.cursor).expect(200)).body;
      assert.equal(tail.events[0].entityId, table.id);
      assert.equal(tail.cursor, '3');
    });
    await test('bounds, shape, overlap and reserved identifiers reject invalid writes atomically', async () => {
      await createTable(data, 409);
      await createTable({ ...data, number: 102, positionX: 40 }, 409);
      await createTable({ ...data, number: 102, positionX: 1190 }, 409);
      await createTable({ ...data, number: 102, height: 90 }, 400);
      await call('put', 'areas/' + indoor.id)
        .send({
          version: indoor.version,
          data: { name: indoor.name, canvasWidth: 200, canvasHeight: 200, active: false },
        })
        .expect(409);
      await assert.rejects(
        runtime.restaurantTable.update({ where: { id: table.id }, data: { capacity: 0 } }),
      );
      await assert.rejects(
        runtime.restaurantTable.update({ where: { id: table.id }, data: { active: false } }),
      );
      await assert.rejects(
        runtime.restaurantTable.update({ where: { id: table.id }, data: { height: 90 } }),
      );
    });
    await test('same-org and cross-org branches stay isolated in map, changes and relationships', async () => {
      const org2 = await db.organization.create({
        data: { slug: 'layout-other', name: 'Layout other' },
      });
      for (const organizationId of [scoped.organizationId, org2.id]) {
        const branch = await db.branch.create({
          data: { organizationId, code: randomUUID(), name: 'Other layout branch' },
        });
        const foreign = { branchId: branch.id, organizationId };
        const area = await db.area.create({ data: { ...foreign, name: 'Foreign area' } });
        const foreignTable = await db.restaurantTable.create({
          data: { ...data, ...foreign, areaId: area.id },
        });
        await db.layoutEvent.create({
          data: {
            ...foreign,
            revision: 1n,
            entityType: 'Area',
            entityId: area.id,
            entityVersion: 1,
            action: 'layout.area.created',
          },
        });
        for (const path of [
          'areas/' + area.id,
          'areas/' + area.id + '/map',
          'tables/' + foreignTable.id,
        ])
          await call('get', path).expect(404);
        await updateTable({ ...table, id: foreignTable.id }, data, 404);
        await status({ ...table, id: foreignTable.id }, 'RESERVED', 404);
        await archive('areas', { ...indoor, id: area.id }, 404);
        await createTable({ ...data, number: 200, areaId: area.id }, 404);
        await assert.rejects(
          runtime.restaurantTable.create({
            data: { ...data, ...scoped, number: 200, areaId: area.id },
          }),
        );
        const rows = (await call('get', 'changes').expect(200)).body.events;
        assert.ok(rows.every((r) => r.entityId !== area.id));
      }
    });
    await test('manual reservations are audited and cannot enter later order states', async () => {
      table = await status(table, 'RESERVED', 200, statusOnly);
      const event = await db.auditLog.findFirst({
        where: { entityId: table.id, action: 'layout.table.status_changed' },
      });
      assert.equal(event.beforeData.status, 'FREE');
      assert.equal(event.afterData.status, 'RESERVED');
      assert.equal(event.branchId, scoped.branchId);
      assert.ok(event.userId);
      assert.ok(event.requestId);
      await status(table, 'DISABLED', 409);
      await archive('tables', table, 409);
      await updateTable(table, { ...data, areaId: terrace.id }, 409);
      for (const state of ['OCCUPIED', 'ORDER_SENT', 'WAITING_PAYMENT'])
        await status(table, state, 400);
      table = await status(table, 'FREE', 200, statusOnly);
    });
    await test('precise geometry, area reassignment and all shapes update with versions', async () => {
      table = (
        await call('patch', 'tables/' + table.id + '/geometry')
          .send({
            version: table.version,
            positionX: 100,
            positionY: 100,
            width: 160,
            height: 80,
            shape: 'RECTANGLE',
          })
          .expect(200)
      ).body;
      assert.equal(table.positionX, 100);
      await call('put', 'areas/' + indoor.id)
        .send({
          version: indoor.version,
          data: { name: indoor.name, canvasWidth: 200, canvasHeight: 200 },
        })
        .expect(409);
      data = {
        ...data,
        areaId: terrace.id,
        positionX: 200,
        positionY: 150,
        width: 120,
        height: 120,
        shape: 'SQUARE',
      };
      table = await updateTable(table, data);
      assert.equal(table.areaId, terrace.id);
      assert.equal(table.shape, 'SQUARE');
      assert.equal(
        (await call('get', 'areas/' + indoor.id + '/map').expect(200)).body.tables.length,
        0,
      );
      assert.equal(
        (await call('get', 'areas/' + terrace.id + '/map').expect(200)).body.tables[0].id,
        table.id,
      );
    });
    await test('simultaneous geometry writes have one winner and one conflict', async () => {
      const results = await Promise.all(
        [220, 240].map((positionX) =>
          call('patch', 'tables/' + table.id + '/geometry').send({
            version: table.version,
            positionX,
            positionY: 150,
            width: 120,
            height: 120,
            shape: 'SQUARE',
          }),
        ),
      );
      assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
      table = results.find((r) => r.status === 200).body;
      data = { ...data, positionX: table.positionX };
      await status({ ...table, version: 1 }, 'RESERVED', 409);
    });
    await test('audit and event failures roll back layout, version and branch cursor together', async () => {
      for (const target of ['AuditLog', 'LayoutEvent']) {
        const before = await db.layoutRevision.findUnique({ where: { branchId: scoped.branchId } });
        const audits = await db.auditLog.count({ where: scoped }),
          events = await db.layoutEvent.count({ where: scoped });
        await db.$executeRawUnsafe('REVOKE INSERT ON "' + target + '" FROM restaurant_app');
        try {
          await updateTable(table, { ...data, name: 'Must roll back' }, 500);
          const current = await db.restaurantTable.findUnique({ where: { id: table.id } });
          assert.equal(current.name, table.name);
          assert.equal(current.version, table.version);
          assert.equal(
            (await db.layoutRevision.findUnique({ where: { branchId: scoped.branchId } })).revision,
            before.revision,
          );
          assert.equal(await db.auditLog.count({ where: scoped }), audits);
          assert.equal(await db.layoutEvent.count({ where: scoped }), events);
        } finally {
          await db.$executeRawUnsafe('GRANT INSERT ON "' + target + '" TO restaurant_app');
        }
      }
    });
    await test('disabled tables and inactive areas cannot silently become operational', async () => {
      table = await status(table, 'DISABLED');
      assert.equal(table.active, false);
      terrace = (
        await call('put', 'areas/' + terrace.id)
          .send({ version: terrace.version, data: { name: terrace.name, active: false } })
          .expect(200)
      ).body;
      await status(table, 'FREE', 409);
      await createTable({ ...data, number: 102, positionX: 500 }, 409);
      await archive('areas', terrace, 409);
      terrace = (
        await call('put', 'areas/' + terrace.id)
          .send({ version: terrace.version, data: { name: terrace.name, active: true } })
          .expect(200)
      ).body;
      table = await status(table, 'FREE');
    });
    await test('feed permissions revoke immediately and immutable events reject mutation/deletion', async () => {
      await http
        .patch('/api/roles/' + readerRole.id + '/permissions')
        .set('Origin', origin)
        .set('Authorization', 'Bearer ' + token)
        .send({ permissions: [] })
        .expect(200);
      await call('get', 'changes', reader).expect(403);
      await call('get', 'areas/' + terrace.id + '/map', reader).expect(403);
      const event = await db.layoutEvent.findFirst({ where: scoped });
      await assert.rejects(
        runtime.layoutEvent.update({ where: { id: event.id }, data: { action: 'tamper' } }),
      );
      await assert.rejects(
        db.layoutEvent.update({ where: { id: event.id }, data: { action: 'tamper' } }),
      );
      await assert.rejects(db.layoutEvent.delete({ where: { id: event.id } }));
      await assert.rejects(db.$executeRawUnsafe('TRUNCATE "LayoutEvent"'));
      for (const name of ['Area', 'RestaurantTable', 'LayoutRevision'])
        await assert.rejects(runtime.$executeRawUnsafe('DELETE FROM "' + name + '" WHERE false'));
    });
    await test('BIGINT change cursors stay exact beyond JavaScript safe integers', async () => {
      await db.layoutRevision.update({
        where: { branchId: scoped.branchId },
        data: { revision: 9007199254740993n },
      });
      table = await status(table, 'RESERVED');
      const changes = (await call('get', 'changes?after=9007199254740993').expect(200)).body;
      assert.equal(changes.cursor, '9007199254740994');
      assert.equal(changes.events.length, 1);
      const map = (await call('get', 'areas/' + terrace.id + '/map').expect(200)).body;
      assert.equal(map.revision, changes.cursor);
      table = await status(table, 'FREE');
    });
    await test('archives preserve records/events and exclude tables from active maps', async () => {
      table = await archive('tables', table);
      assert.ok(table.deletedAt);
      assert.equal(table.status, 'DISABLED');
      await updateTable(table, data, 409);
      await createTable(data, 409);
      assert.equal(
        (await call('get', 'tables?archived=true&areaId=' + terrace.id).expect(200)).body.items[0]
          .id,
        table.id,
      );
      assert.equal(
        (await call('get', 'areas/' + terrace.id + '/map').expect(200)).body.tables.length,
        0,
      );
      terrace = await archive('areas', terrace);
      indoor = await archive('areas', indoor);
      assert.equal((await call('get', 'areas').expect(200)).body.items.length, 0);
      assert.equal(
        (await call('get', 'areas?archived=true&limit=1').expect(200)).body.hasMore,
        true,
      );
      await status(table, 'FREE', 409);
      assert.ok(
        await db.layoutEvent.count({
          where: { ...scoped, entityId: table.id, action: 'layout.table.archived' },
        }),
      );
    });
    console.log(`Layout integration suite passed: ${count} checks.`);
  } finally {
    await db.$disconnect();
    await runtime.$disconnect();
  }
}
