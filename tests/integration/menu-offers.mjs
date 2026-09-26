import assert from 'node:assert/strict';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const sharp = require('sharp');
const { createDatabase } = require('@restaurant/database');

/**
 * Menu management: product editing, sold-out, uploaded images, offers, the order-line
 * price snapshot and display order, all through the public API.
 */
export async function runMenuOffersIntegration(app) {
  const db = createDatabase(process.env.MIGRATION_DATABASE_URL);
  const http = request(app.getHttpServer());
  const origin = process.env.APP_ORIGIN;
  const mediaDir = join(process.env.MEDIA_ROOT, 'menu');
  const credentials = {
    organization: 'verification',
    branch: 'main',
    email: process.env.SEED_OWNER_EMAIL,
    password: process.env.SEED_OWNER_PASSWORD,
  };
  let count = 0;
  const test = async (name, fn) => {
    await fn();
    console.log(`PASS menu-offers ${++count}: ${name}`);
  };
  const days = (n) => new Date(Date.now() + n * 86400000).toISOString();
  const image = (format, size = 400) => {
    const canvas = sharp({ create: { width: size, height: size, channels: 3, background: '#c0392b' } });
    return canvas[format]().toBuffer();
  };
  const onDisk = (path) => existsSync(join(mediaDir, path.slice(path.lastIndexOf('/') + 1)));
  try {
    const login = await http.post('/api/auth/login').set('Origin', origin).send(credentials).expect(200);
    const token = login.body.accessToken;
    const call = (method, path, bearer = token) =>
      http[method]('/api/' + path).set('Authorization', 'Bearer ' + bearer).set('Origin', origin);
    const upload = (buffer, type = 'image/png', bearer = token) =>
      call('post', 'media/menu', bearer).set('Content-Type', type).send(buffer);
    const menu = async (kind, data, status = 201) =>
      (await call('post', 'menu/' + kind).send({ kind, ...data }).expect(status)).body;
    const update = async (row, data, status = 200) =>
      (await call('put', `menu/${row.kind}/${row.id}`).send({ version: row.version, data }).expect(status)).body;
    const productData = (row, changes = {}) => ({
      kind: 'products',
      name: row.name,
      description: row.description,
      sortOrder: row.sortOrder,
      active: row.active,
      sku: row.sku,
      barcode: row.barcode,
      categoryId: row.categoryId,
      sellingPrice: row.sellingPrice,
      taxRate: row.taxRate,
      taxMode: row.taxMode,
      imageUrl: row.imageUrl,
      modifierGroupIds: row.modifierGroupIds,
      kitchenStationIds: row.kitchenStationIds,
      ...changes,
    });
    const product = (name, sku, categoryId, price = '3.50') =>
      menu('products', {
        name,
        sku,
        categoryId,
        sellingPrice: price,
        taxRate: '0.00',
        taxMode: 'INCLUSIVE',
      });
    const getProduct = async (id) => (await call('get', 'menu/products/' + id).expect(200)).body;
    const order = async () =>
      (await call('post', 'orders').send({ commandId: randomUUID(), type: 'TAKEAWAY' }).expect(201)).body;
    const addItem = async (current, productId, expected = 201, quantity = 1) =>
      (
        await call('post', `orders/${current.id}/commands`)
          .send({
            commandId: randomUUID(),
            version: current.version,
            action: 'add_item',
            productId,
            quantity,
            modifierIds: [],
            notes: '',
          })
          .expect(expected)
      ).body;
    const offer = async (data, status = 201) =>
      (
        await call('post', 'offers')
          .send({ name: 'Offer', active: true, startsAt: days(-1), endsAt: days(3), ...data })
          .expect(status)
      ).body;
    const audits = async (entityId) =>
      (await db.auditLog.findMany({ where: { entityId }, orderBy: { createdAt: 'asc' } })).map(
        (row) => row.action,
      );

    const burgers = await menu('categories', { name: 'MO Burger', sortOrder: 10 });
    const drinks = await menu('categories', { name: 'MO Pije', sortOrder: 20 });

    let riza = await product('MO Riza Burger', 'MO-RIZA', burgers.id);
    await test('a product edit changes name, description, price and category, and is audited by change', async () => {
      riza = await update(
        riza,
        productData(riza, {
          name: 'MO Riza Burger Deluxe',
          description: 'Double patty',
          sellingPrice: '3.80',
          categoryId: drinks.id,
        }),
      );
      assert.equal(riza.name, 'MO Riza Burger Deluxe');
      assert.equal(riza.description, 'Double patty');
      assert.equal(riza.sellingPrice, '3.80');
      assert.equal(riza.categoryId, drinks.id);
      riza = await update(riza, productData(riza, { sellingPrice: '3.50', categoryId: burgers.id }));
      const actions = await audits(riza.id);
      for (const action of ['menu.products.updated', 'menu.products.price_changed', 'menu.products.category_changed'])
        assert.ok(actions.includes(action), `missing audit ${action}`);
    });
    await test('sold out is separate from inactive, survives edits that omit it, and blocks ordering', async () => {
      riza = await update(riza, productData(riza, { soldOut: true }));
      assert.equal(riza.soldOut, true);
      assert.equal(riza.active, true);
      // A client that does not know about sold-out must not clear it by editing a price.
      riza = await update(riza, productData(riza, { sellingPrice: '3.50' }));
      assert.equal(riza.soldOut, true);
      const draft = await order();
      const refused = await addItem(draft, riza.id, 409);
      assert.equal(refused.message, 'This product is sold out');
      riza = await update(riza, productData(riza, { soldOut: false }));
      const actions = await audits(riza.id);
      assert.ok(actions.includes('menu.products.sold_out'));
      assert.ok(actions.includes('menu.products.back_in_stock'));
      // Inactive hides the product from ordering altogether and is audited on its own.
      riza = await update(riza, productData(riza, { active: false }));
      await addItem(draft, riza.id, 404);
      riza = await update(riza, productData(riza, { active: true }));
      assert.ok((await audits(riza.id)).includes('menu.products.deactivated'));
      assert.ok((await audits(riza.id)).includes('menu.products.activated'));
    });

    let png, jpeg, webp;
    await test('PNG, JPEG and WebP uploads become a 1024 px WebP square on persistent storage', async () => {
      png = (await upload(await image('png'), 'image/png').expect(201)).body;
      jpeg = (await upload(await image('jpeg', 900), 'image/jpeg').expect(201)).body;
      // The declared type is ignored: a WebP sent as octet-stream is still recognised.
      webp = (await upload(await image('webp', 1600), 'application/octet-stream').expect(201)).body;
      for (const stored of [png, jpeg, webp]) {
        assert.match(stored.path, /^\/api\/media\/menu\/[0-9a-f-]{36}\.webp$/);
        assert.equal(stored.width, 1024);
        assert.ok(onDisk(stored.path), 'file written under MEDIA_ROOT');
        const served = await http.get(stored.path).buffer(true).parse((res, done) => {
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => done(null, Buffer.concat(chunks)));
        }).expect(200);
        assert.equal(served.headers['content-type'], 'image/webp');
        assert.match(served.headers['cache-control'], /immutable/);
        const meta = await sharp(served.body).metadata();
        assert.deepEqual([meta.format, meta.width, meta.height], ['webp', 1024, 1024]);
      }
      // Uploading changes no database row: nothing references the file until a save.
      assert.equal(await db.product.count({ where: { imageUrl: png.path } }), 0);
    });
    await test('non-images, damaged, tiny and oversized uploads are refused', async () => {
      const text = await upload(Buffer.from('not really a picture'), 'image/png').expect(415);
      assert.equal(text.body.message, 'Choose a PNG, JPEG or WebP image');
      const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      const damaged = await upload(Buffer.concat([pngHeader, Buffer.alloc(200, 7)])).expect(422);
      assert.equal(damaged.body.message, 'This image is damaged or incomplete');
      const tiny = await upload(await image('png', 50)).expect(422);
      assert.equal(tiny.body.message, 'Images must be at least 200 × 200 pixels');
      const oversized = await upload(Buffer.concat([pngHeader, Buffer.alloc(5 * 1024 * 1024 + 1)])).expect(413);
      assert.equal(oversized.body.message, 'Images must be 5 MB or smaller');
      await http.post('/api/media/menu').set('Authorization', 'Bearer ' + token).set('Content-Type', 'image/png').send(await image('png')).expect(403);
      await http.get('/api/media/menu/..%2F..%2Fsecret.webp').expect(404);
      await http.get('/api/media/menu/' + randomUUID() + '.webp').expect(404);
    });
    await test('menu managers alone may upload images', async () => {
      const role = (await call('post', 'roles').send({ name: 'MO cashier', permissions: ['menu.read', 'order.read'] }).expect(201)).body;
      await call('post', 'users')
        .send({ name: 'MO cashier', email: 'mo-cashier@verification.test', password: credentials.password, roleIds: [role.id] })
        .expect(201);
      const cashier = (await http.post('/api/auth/login').set('Origin', origin).send({ ...credentials, email: 'mo-cashier@verification.test' }).expect(200)).body.accessToken;
      await upload(await image('png'), 'image/png', cashier).expect(403);
      await call('post', 'offers', cashier).send({}).expect(403);
      await call('post', 'menu/categories/reorder', cashier).send({ items: [] }).expect(403);
    });
    await test('replacing an image removes the old file only after the product stops using it', async () => {
      riza = await update(riza, productData(riza, { imageUrl: png.path }));
      assert.equal(riza.imageUrl, png.path);
      // A second product shares the JPEG, so it must survive the first moving away.
      let cola = await product('MO Coca-Cola', 'MO-COLA', drinks.id, '1.50');
      cola = await update(cola, productData(cola, { imageUrl: jpeg.path }));
      riza = await update(riza, productData(riza, { imageUrl: jpeg.path }));
      assert.equal(onDisk(png.path), false, 'unreferenced previous image removed');
      assert.equal(onDisk(jpeg.path), true);
      riza = await update(riza, productData(riza, { imageUrl: webp.path }));
      assert.equal(onDisk(jpeg.path), true, 'still used by another product');
      assert.ok((await audits(riza.id)).includes('menu.products.image_changed'));
      // Removing the image leaves no dangling reference, and the file goes once unused.
      cola = await update(cola, productData(cola, { imageUrl: null }));
      assert.equal(cola.imageUrl, null);
      assert.equal(onDisk(jpeg.path), false);
      // A product can never be pointed at a managed file that no longer exists.
      const gone = await update(cola, productData(cola, { imageUrl: png.path }), 409);
      assert.equal(gone.message, 'This image is no longer available. Upload it again.');
    });

    const live = { kind: 'FIXED_PRICE', offerPrice: '2.99' };
    let rizaOffer;
    await test('a live offer prices new order lines and freezes the price, base and offer on the line', async () => {
      rizaOffer = await offer({ name: 'MO Riza week', productIds: [riza.id], ...live });
      assert.equal(rizaOffer.status, 'LIVE');
      assert.deepEqual(rizaOffer.products.map((p) => [p.basePrice, p.offerPrice]), [['3.50', '2.99']]);
      const shown = await getProduct(riza.id);
      assert.equal(shown.sellingPrice, '3.50', 'the normal price is never rewritten');
      assert.equal(shown.activeOffer.price, '2.99');
      const draft = await order();
      const priced = await addItem(draft, riza.id, 201, 3);
      const line = priced.items[0];
      assert.deepEqual(
        [line.unitPrice, line.listPrice, line.offerId, line.offerName, line.total, priced.total],
        ['2.99', '3.50', rizaOffer.id, 'MO Riza week', '8.97', '8.97'],
      );
      assert.ok((await audits(rizaOffer.id)).includes('menu.offers.created'));
      // Editing the offer, then ending it, never touches the order already taken.
      rizaOffer = (
        await call('put', 'offers/' + rizaOffer.id)
          .send({ version: rizaOffer.version, data: { name: 'MO Riza week', active: true, startsAt: days(-1), endsAt: days(3), productIds: [riza.id], kind: 'FIXED_PRICE', offerPrice: '2.49' } })
          .expect(200)
      ).body;
      assert.equal((await getProduct(riza.id)).activeOffer.price, '2.49');
      rizaOffer = (
        await call('put', 'offers/' + rizaOffer.id)
          .send({ version: rizaOffer.version, data: { name: 'MO Riza week', active: false, startsAt: days(-1), endsAt: days(3), productIds: [riza.id], kind: 'FIXED_PRICE', offerPrice: '2.49' } })
          .expect(200)
      ).body;
      assert.equal(rizaOffer.status, 'INACTIVE');
      assert.ok((await audits(rizaOffer.id)).includes('menu.offers.deactivated'));
      const history = (await call('get', 'orders/' + draft.id).expect(200)).body;
      assert.deepEqual([history.items[0].unitPrice, history.total], ['2.99', '8.97']);
      // With the offer off, the base price is back for new lines.
      assert.equal((await getProduct(riza.id)).activeOffer, null);
      const later = await addItem(await order(), riza.id);
      assert.deepEqual([later.items[0].unitPrice, later.items[0].offerId], ['3.50', null]);
    });
    await test('future and expired offers leave the base price in place', async () => {
      const future = await offer({ name: 'MO future', productIds: [riza.id], ...live, startsAt: days(2), endsAt: days(5) });
      assert.equal(future.status, 'SCHEDULED');
      const expired = await offer({ name: 'MO expired', productIds: [riza.id], ...live, startsAt: days(-5), endsAt: days(-2) });
      assert.equal(expired.status, 'EXPIRED');
      assert.equal((await getProduct(riza.id)).activeOffer, null);
      const line = (await addItem(await order(), riza.id)).items[0];
      assert.deepEqual([line.unitPrice, line.offerId], ['3.50', null]);
    });
    await test('overlapping offers for one product are refused, adjacent ones are allowed', async () => {
      // "MO future" occupies days 2 to 5.
      const clash = await offer({ name: 'MO clash', productIds: [riza.id], ...live, startsAt: days(4), endsAt: days(8) }, 409);
      assert.equal(clash.message, 'MO Riza Burger Deluxe already has the offer MO future at that time');
      await offer({ name: 'MO adjacent', productIds: [riza.id], ...live, startsAt: days(5), endsAt: days(8) });
      // An inactive offer holds no window, so it does not block.
      await offer({ name: 'MO draft', productIds: [riza.id], ...live, active: false, startsAt: days(4), endsAt: days(8) });
    });
    await test('percentage offers are exact to the cent and a fixed price must undercut the base', async () => {
      const fries = await product('MO Pomfrit', 'MO-FRIES', burgers.id, '3.50');
      const percent = await offer({ name: 'MO fries', productIds: [fries.id], kind: 'PERCENT_OFF', percentOff: '15.00' });
      // 3.50 less 15% is 2.975, which rounds half up to 2.98.
      assert.equal(percent.products[0].offerPrice, '2.98');
      const line = (await addItem(await order(), fries.id, 201, 7)).items[0];
      assert.deepEqual([line.unitPrice, line.total], ['2.98', '20.86']);
      const water = await product('MO Ujë', 'MO-WATER', drinks.id, '1.00');
      const tooHigh = await offer({ name: 'MO water', productIds: [water.id], kind: 'FIXED_PRICE', offerPrice: '1.00' }, 409);
      assert.equal(tooHigh.message, 'The offer price must be below the normal price of MO Ujë');
      await offer({ name: 'MO mixed', productIds: [water.id], kind: 'FIXED_PRICE', offerPrice: '0.80', percentOff: '5.00' }, 400);
      await offer({ name: 'MO backwards', productIds: [water.id], ...live, startsAt: days(3), endsAt: days(1) }, 400);
    });
    await test('the database refuses an inconsistent offer or order-line snapshot', async () => {
      const row = await db.offer.findFirstOrThrow({ where: { id: rizaOffer.id } });
      await assert.rejects(db.offer.update({ where: { id: row.id }, data: { percentOff: '10.00' } }));
      await assert.rejects(db.offer.update({ where: { id: row.id }, data: { endsAt: row.startsAt } }));
      const item = await db.orderItem.findFirstOrThrow({ where: { offerId: rizaOffer.id } });
      await assert.rejects(db.orderItem.update({ where: { id: item.id }, data: { unitPrice: '9.99' } }));
      await assert.rejects(db.orderItem.update({ where: { id: item.id }, data: { offerName: null } }));
      // An offer that priced an order can be archived, never removed.
      await assert.rejects(
        db.$transaction(async (tx) => {
          await tx.offerProduct.deleteMany({ where: { offerId: rizaOffer.id } });
          await tx.offer.delete({ where: { id: rizaOffer.id } });
        }),
      );
      assert.equal(await db.offerProduct.count({ where: { offerId: rizaOffer.id } }), 1);
    });
    await test('categories and products keep an explicit, version-checked display order', async () => {
      const categories = (await call('get', 'menu/categories?limit=100').expect(200)).body.items;
      const reversed = [...categories].reverse().map((c) => ({ id: c.id, version: c.version }));
      const saved = (await call('post', 'menu/categories/reorder').send({ items: reversed }).expect(201)).body;
      assert.deepEqual(saved.map((c) => c.sortOrder), reversed.map((_, i) => (i + 1) * 10));
      const listed = (await call('get', 'menu/categories?limit=100').expect(200)).body.items;
      assert.deepEqual(listed.map((c) => c.id), reversed.map((c) => c.id));
      // Reordering over an older version, or with rows missing, is refused.
      await call('post', 'menu/categories/reorder').send({ items: reversed }).expect(409);
      await call('post', 'menu/categories/reorder').send({ items: listed.slice(1).map((c) => ({ id: c.id, version: c.version })) }).expect(409);
      const inBurgers = (await call('get', 'menu/products?limit=100').expect(200)).body.items.filter((p) => p.categoryId === burgers.id && !p.deletedAt);
      const order = [...inBurgers].reverse().map((p) => ({ id: p.id, version: p.version }));
      await call('post', 'menu/products/reorder').send({ items: order }).expect(409);
      const products = (await call('post', 'menu/products/reorder').send({ categoryId: burgers.id, items: order }).expect(201)).body;
      assert.deepEqual(products.map((p) => p.id), order.map((p) => p.id));
      assert.ok((await db.auditLog.count({ where: { action: 'menu.products.reordered' } })) >= 1);
    });
    await test('offers are archived, not deleted, and stay out of pricing', async () => {
      const current = (await call('get', 'offers/' + rizaOffer.id).expect(200)).body;
      const archived = (await call('post', `offers/${rizaOffer.id}/archive`).send({ version: current.version }).expect(201)).body;
      assert.equal(archived.status, 'ARCHIVED');
      const listed = (await call('get', 'offers').expect(200)).body;
      assert.equal(listed.some((o) => o.id === rizaOffer.id), false);
      assert.ok((await call('get', 'offers?archived=true').expect(200)).body.some((o) => o.id === rizaOffer.id));
      await call('get', 'offers/' + randomUUID()).expect(404);
    });
    console.log(`Menu offers integration suite passed: ${count} checks.`);
  } finally {
    await db.$disconnect();
  }
}
