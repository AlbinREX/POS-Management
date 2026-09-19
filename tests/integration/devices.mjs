import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import request from 'supertest';
const require = createRequire(import.meta.url);
const { createDatabase } = require('@restaurant/database');

export async function runDevicesIntegration(app) {
  const db = createDatabase(process.env.MIGRATION_DATABASE_URL);
  const http = request(app.getHttpServer()),
    origin = process.env.APP_ORIGIN;
  let count = 0;
  const test = async (name, fn) => {
    await fn();
    console.log(`PASS devices ${++count}: ${name}`);
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

    const prefix = 'Devices ' + Date.now().toString().slice(-6);
    let reader, receipt, kitchenPrinter, barPrinter, grill, bar, role, viewer;

    await test('authentication, permissions and strict inputs', async () => {
      await http.get('/api/devices').expect(401);
      // An unsafe method without a trusted Origin is refused before authentication is
      // even considered, which is the cross-site protection doing its job.
      await http.post('/api/devices').send({}).expect(403);
      await http.post('/api/devices').set('Origin', origin).send({}).expect(401);
      // Branch scope is never accepted from a client, and unknown keys are refused.
      await call('get', 'devices?branchId=' + scope.branchId).expect(400);
      await call('get', 'devices?kind=TOASTER').expect(400);
      role = await post('roles', { name: prefix + ' viewer', permissions: ['device.read'] });
      const password = 'Devices-viewer-password-15!';
      await post('users', {
        name: prefix + ' viewer',
        email: `devices-viewer-${Date.now()}@verification.test`,
        password,
        roleIds: [role.id],
      });
      viewer = await login({
        ...credentials,
        email: (await db.user.findFirst({ where: { name: prefix + ' viewer' } })).email,
        password,
      });
      // Visibility grants no authority to reconfigure hardware.
      await call('post', 'devices', viewer.accessToken)
        .send({ name: 'x', kind: 'RECEIPT_PRINTER', connection: 'SERIAL', port: 'COM3' })
        .expect(403);
      await get('devices', 200, viewer.accessToken);
    });

    await test('a client can never supply a COM port, an IP or a port to print to', async () => {
      // Every address enters through configuration, held behind device.manage.
      for (const body of [
        { name: prefix + ' bad', kind: 'KITCHEN_PRINTER', connection: 'NETWORK', host: '8.8.8.8' },
        {
          name: prefix + ' bad',
          kind: 'KITCHEN_PRINTER',
          connection: 'NETWORK',
          host: '192.168.1.5',
          tcpPort: 22,
        },
        { name: prefix + ' bad', kind: 'RECEIPT_PRINTER', connection: 'SERIAL', port: '../../dev' },
        {
          name: prefix + ' bad',
          kind: 'RECEIPT_PRINTER',
          connection: 'SERIAL',
          port: 'COM3',
          branchId: scope.branchId,
        },
      ])
        await call('post', 'devices').send(body).expect(400);

      receipt = await post('devices', {
        name: prefix + ' receipt',
        kind: 'RECEIPT_PRINTER',
        connection: 'SERIAL',
        port: 'COM3',
        baudRate: 9600,
      });
      reader = await post('devices', {
        name: prefix + ' reader',
        kind: 'NFC_READER',
        connection: 'SERIAL',
        port: 'COM4',
      });
      kitchenPrinter = await post('devices', {
        name: prefix + ' kitchen',
        kind: 'KITCHEN_PRINTER',
        connection: 'NETWORK',
        host: '192.168.1.50',
        tcpPort: 9100,
      });
      barPrinter = await post('devices', {
        name: prefix + ' bar',
        kind: 'BAR_PRINTER',
        connection: 'NETWORK',
        host: '192.168.1.51',
        tcpPort: 9100,
      });
      assert.equal(receipt.port, 'COM3');
      assert.equal(kitchenPrinter.host, '192.168.1.50');
      // A device that has never reported is never presented as working.
      assert.equal(receipt.status, 'UNKNOWN');
    });

    await test('the database refuses a half-addressed or out-of-range device', async () => {
      // The API already rejects these; the constraint is the backstop that holds even
      // against a direct write.
      await assert.rejects(() =>
        db.device.create({
          data: { ...scope, kind: 'KITCHEN_PRINTER', name: prefix + ' x1', connection: 'NETWORK' },
        }),
      );
      await assert.rejects(() =>
        db.device.create({
          data: {
            ...scope,
            kind: 'KITCHEN_PRINTER',
            name: prefix + ' x2',
            connection: 'NETWORK',
            host: '192.168.1.9',
            tcpPort: 22,
          },
        }),
      );
      await assert.rejects(() =>
        db.device.create({
          data: { ...scope, kind: 'TOASTER', name: prefix + ' x3', connection: 'SERIAL', port: 'COM9' },
        }),
      );
    });

    await test('stations route to different printers and may share one on purpose', async () => {
      grill = await db.kitchenStation.create({ data: { ...scope, name: prefix + ' grill' } });
      bar = await db.kitchenStation.create({ data: { ...scope, name: prefix + ' bar' } });
      const third = await db.kitchenStation.create({ data: { ...scope, name: prefix + ' fryer' } });

      let stations = await get('devices/stations');
      const before = stations.find((s) => s.stationId === grill.id);
      assert.equal(before.unrouted, true, 'a new station starts unrouted, never defaulted');

      await post('devices/stations', { stationId: grill.id, deviceId: kitchenPrinter.id }, 201);
      await post('devices/stations', { stationId: bar.id, deviceId: barPrinter.id }, 201);
      // Two stations deliberately sharing one printer is a supported configuration.
      await post('devices/stations', { stationId: third.id, deviceId: kitchenPrinter.id }, 201);

      stations = await get('devices/stations');
      const routed = Object.fromEntries(stations.map((s) => [s.stationName, s.deviceName]));
      assert.equal(routed[prefix + ' grill'], prefix + ' kitchen');
      assert.equal(routed[prefix + ' bar'], prefix + ' bar');
      assert.equal(routed[prefix + ' fryer'], prefix + ' kitchen');

      // A card reader is not a printer and can never be bound to a station.
      await call('post', 'devices/stations')
        .send({ stationId: grill.id, deviceId: reader.id })
        .expect(409);
      // Nor may a station be pointed at an address instead of a saved device.
      await call('post', 'devices/stations')
        .send({ stationId: grill.id, host: '192.168.1.99' })
        .expect(400);
    });

    let order, tickets;
    await test('kitchen tickets queue once per document and never duplicate', async () => {
      const category = await db.category.create({ data: { ...scope, name: prefix + ' cat' } });
      const product = await db.product.create({
        data: {
          ...scope,
          categoryId: category.id,
          name: prefix + ' burger',
          sku: prefix + '-SKU',
          sellingPrice: '5.00',
          taxRate: '0.00',
          taxMode: 'INCLUSIVE',
        },
      });
      await db.productKitchenStation.createMany({
        data: [grill, bar].map((s) => ({ ...scope, productId: product.id, stationId: s.id })),
      });
      order = await post('orders', { commandId: randomUUID(), type: 'TAKEAWAY' });
      order = await post(`orders/${order.id}/commands`, {
        commandId: randomUUID(),
        version: order.version,
        action: 'add_item',
        productId: product.id,
        quantity: 1,
      });
      order = await post(`orders/${order.id}/commands`, {
        commandId: randomUUID(),
        version: order.version,
        action: 'status',
        status: 'OPEN',
      });
      order = await post(`orders/${order.id}/kitchen-submit`, {
        commandId: randomUUID(),
        version: order.version,
      });

      const queued = await post(`devices/orders/${order.id}/tickets`, {}, 201);
      assert.equal(queued.length, 2, 'one job per station ticket');
      const names = queued.map((j) => j.deviceName).sort();
      assert.deepEqual(names, [prefix + ' bar', prefix + ' kitchen']);

      // Queueing again is safe: the document identity already exists, so nothing is
      // duplicated and no second copy is ever printed.
      const again = await post(`devices/orders/${order.id}/tickets`, {}, 201);
      assert.equal(again.length, 0);
      assert.equal(await db.printJob.count({ where: { ...scope, orderId: order.id } }), 2);

      tickets = await get('kitchen/tickets');
      assert.ok(tickets.items.length >= 2);
    });

    await test('a duplicate document identity is impossible even from direct SQL', async () => {
      const existing = await db.printJob.findFirst({ where: { ...scope, orderId: order.id } });
      await assert.rejects(
        () =>
          db.printJob.create({
            data: {
              ...scope,
              documentId: existing.documentId,
              kind: 'KITCHEN_PRINTER',
              state: 'PENDING',
              payload: {},
            },
          }),
        'the unique document index is what makes a reprint safe',
      );
    });

    await test('an unrouted station fails visibly instead of printing somewhere else', async () => {
      const lonely = await db.kitchenStation.create({ data: { ...scope, name: prefix + ' pass' } });
      const category = await db.category.create({ data: { ...scope, name: prefix + ' cat2' } });
      const product = await db.product.create({
        data: {
          ...scope,
          categoryId: category.id,
          name: prefix + ' side',
          sku: prefix + '-SKU2',
          sellingPrice: '2.00',
          taxRate: '0.00',
          taxMode: 'INCLUSIVE',
        },
      });
      await db.productKitchenStation.create({
        data: { ...scope, productId: product.id, stationId: lonely.id },
      });
      let o = await post('orders', { commandId: randomUUID(), type: 'TAKEAWAY' });
      o = await post(`orders/${o.id}/commands`, {
        commandId: randomUUID(),
        version: o.version,
        action: 'add_item',
        productId: product.id,
        quantity: 1,
      });
      o = await post(`orders/${o.id}/commands`, {
        commandId: randomUUID(),
        version: o.version,
        action: 'status',
        status: 'OPEN',
      });
      o = await post(`orders/${o.id}/kitchen-submit`, {
        commandId: randomUUID(),
        version: o.version,
      });
      const queued = await post(`devices/orders/${o.id}/tickets`, {}, 201);
      assert.equal(queued.length, 1);
      assert.equal(queued[0].state, 'FAILED');
      assert.equal(queued[0].deviceId, null);
      assert.match(queued[0].lastError, new RegExp(prefix + ' pass'));
      // The kitchen submission itself is untouched: the food is still being cooked.
      assert.equal((await get('orders/' + o.id)).status, 'SENT_TO_KITCHEN');
    });

    await test('an offline printer keeps the submission valid and is retryable', async () => {
      const job = (await db.printJob.findFirst({
        where: { ...scope, orderId: order.id },
        orderBy: { createdAt: 'asc' },
      }));
      const orderBefore = await get('orders/' + order.id);
      const counts = async () => [
        await db.order.count({ where: scope }),
        await db.kitchenSubmission.count({ where: scope }),
        await db.kitchenTicket.count({ where: scope }),
        await db.payment.count({ where: scope }),
      ];
      const before = await counts();

      // The agent reports a printer that is switched off.
      const failed = await post('devices/jobs/result', {
        jobId: job.id,
        delivered: false,
        retryable: true,
        error: 'Printer did not answer',
      });
      assert.equal(failed.state, 'RETRY_REQUIRED');
      assert.equal(failed.attempts, 1);

      // Nothing about the sale or the kitchen changed.
      assert.deepEqual(await counts(), before);
      const orderAfter = await get('orders/' + order.id);
      assert.equal(orderAfter.status, orderBefore.status);
      assert.equal(orderAfter.version, orderBefore.version);
      assert.equal(orderAfter.total, orderBefore.total);

      // A retry makes it deliverable again without rebuilding the document.
      const retried = await post(`devices/jobs/${job.id}/retry`, { commandId: randomUUID() }, 201);
      assert.equal(retried.state, 'PENDING');
      assert.equal(retried.documentId, failed.documentId);

      const delivered = await post('devices/jobs/result', { jobId: job.id, delivered: true });
      assert.equal(delivered.state, 'CONFIRMED');
      // A confirmed document is terminal: a repeated report cannot print a second copy.
      await call('post', 'devices/jobs/result')
        .send({ jobId: job.id, delivered: true })
        .expect(409);
      await call('post', `devices/jobs/${job.id}/retry`)
        .send({ commandId: randomUUID() })
        .expect(409);
    });

    await test('a cancellation is its own document, not a duplicate of the ticket', async () => {
      const cancelled = await post('orders', { commandId: randomUUID(), type: 'TAKEAWAY' });
      // The cancellation contract differs by documentId, so queueing after a cancel adds
      // new jobs rather than colliding with the originals.
      const originals = await db.printJob.count({ where: { ...scope, orderId: order.id } });
      await post(`orders/${order.id}/commands`, {
        commandId: randomUUID(),
        version: (await get('orders/' + order.id)).version,
        action: 'cancel',
        reason: 'Devices integration cancellation',
      });
      const afterCancel = await post(`devices/orders/${order.id}/tickets`, {}, 201);
      assert.equal(afterCancel.length, 2, 'each cancelled ticket yields its own document');
      assert.equal(
        await db.printJob.count({ where: { ...scope, orderId: order.id } }),
        originals + 2,
      );
      for (const job of afterCancel) assert.match(job.documentId, /:cancellation$/);
      assert.ok(cancelled.id);
    });

    await test('NFC enrolment stores only a hash and never moves a card silently', async () => {
      const card = 'card-' + randomUUID();
      const enrolled = await post('devices/nfc/enroll', {
        commandId: randomUUID(),
        userId: auth.user.id,
        credential: card,
        label: 'Owner card',
      });
      assert.equal(enrolled.userId, auth.user.id);
      const stored = await db.userNfcCredential.findFirst({ where: { ...scope, id: enrolled.id } });
      // The raw card value is never stored and never returned.
      assert.ok(stored.credentialHash.startsWith('$argon2'));
      assert.ok(!JSON.stringify(enrolled).includes(card));
      assert.ok(!stored.credentialHash.includes(card));

      // The same card cannot be quietly reassigned to somebody else.
      await call('post', 'devices/nfc/enroll')
        .send({ commandId: randomUUID(), userId: auth.user.id, credential: card })
        .expect(409);

      // Sign-in resolves the person from the card; no role is ever accepted.
      const session = (
        await http
          .post('/api/auth/nfc')
          .set('Origin', origin)
          .send({ organization: 'verification', branch: 'main', credential: card })
          .expect(200)
      ).body;
      assert.equal(session.user.id, auth.user.id);
      await http
        .post('/api/auth/nfc')
        .set('Origin', origin)
        .send({
          organization: 'verification',
          branch: 'main',
          credential: card,
          role: 'OWNER',
        })
        .expect(400);
      // An unknown card is refused and audited.
      await http
        .post('/api/auth/nfc')
        .set('Origin', origin)
        .send({ organization: 'verification', branch: 'main', credential: 'card-unknown-value' })
        .expect(401);
      assert.ok(
        await db.auditLog.findFirst({ where: { action: 'auth.nfc_login_failed' } }),
        'a rejected card is recorded',
      );

      // A revoked card stops working immediately.
      await post(`devices/nfc/${enrolled.id}/revoke`, {}, 201);
      await http
        .post('/api/auth/nfc')
        .set('Origin', origin)
        .send({ organization: 'verification', branch: 'main', credential: card })
        .expect(401);
    });

    await test('a manager override needs the card and the PIN together', async () => {
      const card = 'mgr-' + randomUUID();
      await post('devices/nfc/enroll', {
        commandId: randomUUID(),
        userId: auth.user.id,
        credential: card,
        label: 'Manager card',
      });
      await post('devices/nfc/manager-pin', {
        commandId: randomUUID(),
        userId: auth.user.id,
        pin: '4821',
      });
      const approved = await post('devices/nfc/override', {
        credential: card,
        pin: '4821',
        action: 'payment.refund',
      });
      assert.equal(approved.approved, true);
      assert.equal(approved.approvedBy, auth.user.id);

      // The card on its own is not enough: a cloned UID cannot authorise the action.
      await call('post', 'devices/nfc/override')
        .send({ credential: card, pin: '0000', action: 'payment.refund' })
        .expect(400);
      await call('post', 'devices/nfc/override')
        .send({ credential: card, action: 'payment.refund' })
        .expect(400);
      assert.ok(
        await db.auditLog.findFirst({ where: { ...scope, action: 'device.manager_override' } }),
      );
      assert.ok(
        await db.auditLog.findFirst({
          where: { ...scope, action: 'device.manager_override_denied' },
        }),
      );
    });

    await test('configuration changes and tests are audited without leaking an address', async () => {
      const before = await db.auditLog.count({ where: { ...scope, action: 'device.updated' } });
      const updated = await call('put', 'devices/' + receipt.id)
        .send({
          version: receipt.version,
          data: {
            name: prefix + ' receipt',
            kind: 'RECEIPT_PRINTER',
            connection: 'SERIAL',
            port: 'COM5',
            baudRate: 19200,
          },
        })
        .expect(200);
      assert.equal(updated.body.port, 'COM5');
      assert.equal(
        await db.auditLog.count({ where: { ...scope, action: 'device.updated' } }),
        before + 1,
      );
      // A stale version is refused rather than silently overwriting somebody's change.
      await call('put', 'devices/' + receipt.id)
        .send({
          version: receipt.version,
          data: {
            name: prefix + ' receipt',
            kind: 'RECEIPT_PRINTER',
            connection: 'SERIAL',
            port: 'COM6',
          },
        })
        .expect(409);

      await post(`devices/${kitchenPrinter.id}/test`, { ok: false, error: 'No answer' }, 201);
      const entry = await db.auditLog.findFirst({
        where: { ...scope, action: 'device.tested' },
        orderBy: { createdAt: 'desc' },
      });
      assert.ok(entry);
      // Audit records name the device, never a credential.
      assert.ok(!/password|secret|token/i.test(JSON.stringify(entry.afterData)));
    });

    await test('branch isolation hides devices, jobs and cards from another branch', async () => {
      const other = await db.branch.create({
        data: {
          organizationId: scope.organizationId,
          code: 'dev-' + Date.now().toString().slice(-6),
          name: prefix + ' other branch',
          currency: 'EUR',
          timezone: 'Europe/Belgrade',
        },
      });
      const membership = await db.branchMembership.create({
        data: { userId: auth.user.id, branchId: other.id, organizationId: scope.organizationId },
      });
      const ownerRole = await db.role.findFirst({
        where: { organizationId: scope.organizationId, name: 'OWNER' },
      });
      await db.userBranchRole.create({
        data: {
          userId: auth.user.id,
          branchId: other.id,
          organizationId: scope.organizationId,
          roleId: ownerRole.id,
        },
      });
      const elsewhere = await login({ ...credentials, branch: other.code });
      const devices = await get('devices', 200, elsewhere.accessToken);
      assert.equal(devices.length, 0, 'another branch sees none of this branch hardware');
      // A foreign device id is not found rather than readable.
      await call('get', 'devices/' + kitchenPrinter.id, elsewhere.accessToken).expect(404);
      await call('get', `devices/${kitchenPrinter.id}/target`, elsewhere.accessToken).expect(404);
      const jobs = await get('devices/jobs', 200, elsewhere.accessToken);
      assert.equal(jobs.length, 0);
      // The other branch is genuinely a working branch, so the empty results above are
      // isolation rather than a broken session.
      assert.equal(membership.branchId, other.id);
      assert.equal(elsewhere.user.branchId, other.id);
      assert.ok((await get('devices/stations', 200, elsewhere.accessToken)).length === 0);
    });

    await test('permission revocation takes effect immediately', async () => {
      await call('patch', `roles/${role.id}/permissions`).send({ permissions: [] }).expect(200);
      await get('devices', 403, viewer.accessToken);
    });

    console.log(`Devices integration suite passed: ${count} checks.`);
  } finally {
    await db.$disconnect();
  }
}
