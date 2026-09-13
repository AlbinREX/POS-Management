import assert from 'node:assert/strict';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createDatabase } = require('@restaurant/database');
const { PERMISSIONS } = require('@restaurant/shared-types');

export async function runMenuIntegration(app) {
  const db = createDatabase(process.env.MIGRATION_DATABASE_URL);
  const runtime = createDatabase();
  const http = request(app.getHttpServer());
  const origin = process.env.APP_ORIGIN;
  const credentials = {
    organization: 'verification',
    branch: 'main',
    email: process.env.SEED_OWNER_EMAIL,
    password: process.env.SEED_OWNER_PASSWORD,
  };
  let count = 0;
  const test = async (name, fn) => {
    await fn();
    console.log(`PASS menu ${++count}: ${name}`);
  };
  try {
    const login = await http
      .post('/api/auth/login')
      .set('Origin', origin)
      .send(credentials)
      .expect(200);
    const token = login.body.accessToken;
    const org = login.body.user.organizationId;
    const branchId = login.body.user.branchId;
    const scoped = { organizationId: org, branchId };
    const call = (method, path, bearer = token) =>
      http[method]('/api/menu/' + path)
        .set('Authorization', 'Bearer ' + bearer)
        .set('Origin', origin);
    const input = (kind, name, rest = {}) => ({ kind, name, ...rest });
    const create = async (data, status = 201) =>
      (await call('post', data.kind).send(data).expect(status)).body;
    const update = async (row, data, status = 200) =>
      (
        await call('put', `${row.kind}/${row.id}`)
          .send({ version: row.version, data })
          .expect(status)
      ).body;
    const archive = async (row, status = 201) =>
      (
        await call('post', `${row.kind}/${row.id}/archive`)
          .send({ version: row.version })
          .expect(status)
      ).body;
    let category, station, group, modifier, product, productData, readerToken, role;
    await test('all catalog routes require authentication; reject forged branch and unbounded queries', async () => {
      for (const kind of [
        'categories',
        'products',
        'modifier-groups',
        'modifiers',
        'kitchen-stations',
      ])
        await http.get('/api/menu/' + kind).expect(401);
      await create(input('categories', 'Forged', { branchId }), 400);
      await call('get', 'categories?limit=101').expect(400);
      await call('get', 'categories?organizationId=' + org).expect(400);
      await call('post', 'categories').send(input('kitchen-stations', 'Mismatch')).expect(400);
    });
    await test('custom read permission is enforced on every write and revocation is immediate', async () => {
      role = (
        await http
          .post('/api/roles')
          .set('Authorization', 'Bearer ' + token)
          .set('Origin', origin)
          .send({ name: 'Menu reader test', permissions: ['menu.read'] })
          .expect(201)
      ).body;
      await http
        .post('/api/users')
        .set('Authorization', 'Bearer ' + token)
        .set('Origin', origin)
        .send({
          name: 'Catalog reader',
          email: 'menu-reader@verification.test',
          password: credentials.password,
          roleIds: [role.id],
        })
        .expect(201);
      const res = await http
        .post('/api/auth/login')
        .set('Origin', origin)
        .send({ ...credentials, email: 'menu-reader@verification.test' })
        .expect(200);
      readerToken = res.body.accessToken;
      for (const kind of [
        'categories',
        'products',
        'modifier-groups',
        'modifiers',
        'kitchen-stations',
      ]) {
        await call('get', kind, readerToken).expect(200);
        await call('post', kind, readerToken).send({}).expect(403);
        await call('put', kind + '/' + randomUUID(), readerToken)
          .send({})
          .expect(403);
        await call('post', kind + '/' + randomUUID() + '/archive', readerToken)
          .send({ version: 1 })
          .expect(403);
      }
      await http
        .patch('/api/roles/' + role.id + '/permissions')
        .set('Authorization', 'Bearer ' + token)
        .set('Origin', origin)
        .send({ permissions: [] })
        .expect(200);
      await call('get', 'products', readerToken).expect(403);
      assert.deepEqual(login.body.user.permissions.sort(), [...PERMISSIONS].sort());
    });
    await test('creates all five configurable entities and multiple product station/group links', async () => {
      category = await create(input('categories', 'Integration category'));
      station = await create(input('kitchen-stations', 'Integration grill'));
      const station2 = await create(input('kitchen-stations', 'Integration bar'));
      group = await create(
        input('modifier-groups', 'Integration preparation', { minSelections: 1, maxSelections: 2 }),
      );
      const optional = await create(
        input('modifier-groups', 'Integration extras', { minSelections: 0, maxSelections: 2 }),
      );
      modifier = await create(
        input('modifiers', 'Integration option', { groupId: group.id, priceAdjustment: '-0.50' }),
      );
      assert.equal(modifier.priceAdjustment, '-0.50');
      productData = input('products', 'Integration burger', {
        sku: 'INTEGRATION-1',
        barcode: '123456789',
        categoryId: category.id,
        sellingPrice: '999999999999.99',
        taxRate: '18.00',
        taxMode: 'INCLUSIVE',
        modifierGroupIds: [group.id, optional.id],
        kitchenStationIds: [station.id, station2.id],
      });
      product = await create(productData);
      assert.equal(product.sellingPrice, '999999999999.99');
      assert.deepEqual(product.kitchenStationIds, productData.kitchenStationIds);
      assert.deepEqual(product.modifierGroupIds, productData.modifierGroupIds);
    });
    await test('uniqueness and invalid financial inputs fail without partial writes', async () => {
      await create(productData, 409);
      await create({ ...productData, sku: 'SECOND', barcode: '123456789' }, 409);
      await create({ ...productData, sellingPrice: 2.5 }, 400);
      await create({ ...productData, sellingPrice: '-1.00' }, 400);
      await create({ ...productData, taxRate: '100.01' }, 400);
      assert.equal(await db.product.count({ where: scoped }), 1);
    });
    await test('same-organization and other-organization branch data stay isolated in API and composite foreign keys', async () => {
      const otherOrg = await db.organization.create({
        data: { slug: 'menu-other', name: 'Menu other' },
      });
      for (const organizationId of [org, otherOrg.id]) {
        const branch = await db.branch.create({
          data: { organizationId, code: randomUUID(), name: 'Other menu branch' },
        });
        const foreign = { organizationId, branchId: branch.id };
        const cat = await db.category.create({ data: { ...foreign, name: 'Foreign category' } });
        const grp = await db.modifierGroup.create({ data: { ...foreign, name: 'Foreign group' } });
        const st = await db.kitchenStation.create({
          data: { ...foreign, name: 'Foreign station' },
        });
        await call('get', 'categories/' + cat.id).expect(404);
        await update({ ...category, id: cat.id }, input('categories', 'Intrusion'), 404);
        await archive({ ...category, id: cat.id }, 404);
        await create({ ...productData, sku: randomUUID(), barcode: null, categoryId: cat.id }, 404);
        await create(
          { ...productData, sku: randomUUID(), barcode: null, modifierGroupIds: [grp.id] },
          404,
        );
        await create(
          { ...productData, sku: randomUUID(), barcode: null, kitchenStationIds: [st.id] },
          404,
        );
        await create(
          input('modifiers', 'Intrusion', { groupId: grp.id, priceAdjustment: '0.00' }),
          404,
        );
        await assert.rejects(
          runtime.product.create({
            data: {
              ...scoped,
              name: 'Invalid FK',
              sku: randomUUID(),
              categoryId: cat.id,
              sellingPrice: '1.00',
              taxRate: '0.00',
              taxMode: 'INCLUSIVE',
            },
          }),
        );
        await assert.rejects(
          runtime.productModifierGroup.create({
            data: { ...scoped, productId: product.id, groupId: grp.id },
          }),
        );
        await assert.rejects(
          runtime.productKitchenStation.create({
            data: { ...scoped, productId: product.id, stationId: st.id },
          }),
        );
      }
      const rows = (await call('get', 'categories').expect(200)).body.items;
      assert.ok(rows.every((row) => row.name !== 'Foreign category'));
    });
    await test('required modifier choices and dependency archives preserve usable product configuration', async () => {
      await archive(category, 409);
      await archive(station, 409);
      await archive(group, 409);
      await archive(modifier, 409);
      await update(
        group,
        input('modifier-groups', group.name, { minSelections: 2, maxSelections: 2 }),
        409,
      );
      await update(
        modifier,
        input('modifiers', modifier.name, {
          groupId: group.id,
          priceAdjustment: '0.00',
          active: false,
        }),
        409,
      );
      const empty = await create(
        input('modifier-groups', 'Empty required', { minSelections: 1, maxSelections: 1 }),
      );
      await create(
        { ...productData, sku: randomUUID(), barcode: null, modifierGroupIds: [empty.id] },
        409,
      );
      await update(station, input('kitchen-stations', station.name, { active: false }), 409);
    });
    await test('product edits keep fixed-scale prices, replace links, and audit old/new snapshots', async () => {
      productData = {
        ...productData,
        sellingPrice: '7.50',
        kitchenStationIds: [station.id],
        modifierGroupIds: [group.id],
      };
      product = await update(product, productData);
      assert.equal(product.version, 2);
      assert.equal(product.sellingPrice, '7.50');
      assert.equal(await db.productKitchenStation.count({ where: { productId: product.id } }), 1);
      const event = await db.auditLog.findFirst({
        where: { entityId: product.id, action: 'menu.products.updated' },
      });
      assert.equal(event.beforeData.sellingPrice, '999999999999.99');
      assert.equal(event.afterData.sellingPrice, '7.50');
      assert.equal(event.userId, login.body.user.id);
      assert.equal(event.branchId, branchId);
      assert.ok(event.requestId);
    });
    await test('category, station, group and modifier updates are versioned and audited', async () => {
      category = await update(category, input('categories', 'Renamed category', { sortOrder: 2 }));
      station = await update(
        station,
        input('kitchen-stations', 'Renamed grill', { description: 'Configured station' }),
      );
      group = await update(
        group,
        input('modifier-groups', group.name, { minSelections: 1, maxSelections: 3 }),
      );
      modifier = await update(
        modifier,
        input('modifiers', modifier.name, { groupId: group.id, priceAdjustment: '0.50' }),
      );
      for (const row of [category, station, group, modifier]) {
        assert.equal(row.version, 2);
        assert.equal(
          await db.auditLog.count({
            where: { entityId: row.id, action: 'menu.' + row.kind + '.updated' },
          }),
          1,
        );
      }
    });
    await test('concurrent edits produce one winner and an explicit conflict', async () => {
      const results = await Promise.all(
        ['7.60', '7.70'].map((sellingPrice) =>
          call('put', 'products/' + product.id).send({
            version: product.version,
            data: { ...productData, sellingPrice },
          }),
        ),
      );
      assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
      product = results.find((r) => r.status === 200).body;
      productData = { ...productData, sellingPrice: product.sellingPrice };
      await update({ ...product, version: 1 }, productData, 409);
    });
    await test('audit failure rolls back product price and association changes atomically', async () => {
      const before = await db.product.findUnique({ where: { id: product.id } });
      await db.$executeRawUnsafe('REVOKE INSERT ON "AuditLog" FROM restaurant_app');
      try {
        await update(product, { ...productData, sellingPrice: '8.00', modifierGroupIds: [] }, 500);
        const after = await db.product.findUnique({ where: { id: product.id } });
        assert.equal(after.sellingPrice.toFixed(2), before.sellingPrice.toFixed(2));
        assert.equal(after.version, before.version);
        assert.equal(await db.productModifierGroup.count({ where: { productId: product.id } }), 1);
      } finally {
        await db.$executeRawUnsafe('GRANT INSERT ON "AuditLog" TO restaurant_app');
      }
    });
    await test('database constraints reject negative prices and impossible choice limits; runtime cannot hard delete', async () => {
      await assert.rejects(
        runtime.product.update({ where: { id: product.id }, data: { sellingPrice: '-1.00' } }),
      );
      await assert.rejects(
        runtime.modifierGroup.update({
          where: { id: group.id },
          data: { minSelections: 9, maxSelections: 1 },
        }),
      );
      for (const table of ['Product', 'Category', 'Modifier', 'ModifierGroup', 'KitchenStation'])
        await assert.rejects(runtime.$executeRawUnsafe('DELETE FROM "' + table + '" WHERE false'));
    });
    await test('paginated search finds names, SKUs and barcodes without leaking other branches', async () => {
      for (const search of ['burger', 'INTEGRATION-1', '123456789']) {
        const res = await call('get', 'products?search=' + search).expect(200);
        assert.equal(res.body.items.length, 1);
        assert.equal(res.body.items[0].id, product.id);
      }
      const first = (await call('get', 'modifier-groups?limit=1&page=1').expect(200)).body;
      const second = (await call('get', 'modifier-groups?limit=1&page=2').expect(200)).body;
      assert.equal(first.hasMore, true);
      assert.notEqual(first.items[0].id, second.items[0].id);
    });
    await test('archives retain all entity records, preserve price history and reserve identifiers', async () => {
      product = await archive(product);
      assert.ok(product.deletedAt);
      assert.equal(product.active, false);
      await update(product, productData, 409);
      await archive(product, 409);
      assert.equal((await call('get', 'products').expect(200)).body.items.length, 0);
      assert.equal(
        (await call('get', 'products?archived=true').expect(200)).body.items[0].id,
        product.id,
      );
      await create(productData, 409);
      modifier = await archive(modifier);
      group = await archive(group);
      station = await archive(station);
      category = await archive(category);
      for (const row of [product, modifier, group, station, category]) {
        assert.equal((await call('get', row.kind + '/' + row.id).expect(200)).body.id, row.id);
        assert.equal(
          await db.auditLog.count({
            where: { entityId: row.id, action: 'menu.' + row.kind + '.archived' },
          }),
          1,
        );
      }
      assert.equal(await db.productKitchenStation.count({ where: { productId: product.id } }), 1);
    });
    console.log(`Menu integration suite passed: ${count} checks.`);
  } finally {
    await db.$disconnect();
    await runtime.$disconnect();
  }
}
