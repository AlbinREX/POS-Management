import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import request from 'supertest';
const require = createRequire(import.meta.url);
const { createDatabase } = require('@restaurant/database');
export async function runCompaniesIntegration(app) {
  const db = createDatabase(process.env.MIGRATION_DATABASE_URL),
    runtime = createDatabase();
  const http = request(app.getHttpServer()),
    origin = process.env.APP_ORIGIN;
  let count = 0;
  const test = async (name, fn) => {
    await fn();
    console.log(`PASS companies ${++count}: ${name}`);
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
    const put = async (path, data, status = 200, token) =>
      (await call('put', path, token).send(data).expect(status)).body;
    const get = async (path, status = 200, token) =>
      (await call('get', path, token).expect(status)).body;
    const cmd = (x) => ({ commandId: randomUUID(), ...x });
    // Menu fixtures used to build real orders that settle on a company account.
    const category = await post('menu/categories', { kind: 'categories', name: 'Company meals' });
    const product = await post('menu/products', {
      kind: 'products',
      name: 'Company lunch',
      sku: 'CO9-LUNCH',
      categoryId: category.id,
      sellingPrice: '10.00',
      taxRate: '0.00',
      taxMode: 'INCLUSIVE',
    });
    const order = async (quantity = 1) => {
      let o = await post('orders', cmd({ type: 'TAKEAWAY' }));
      o = await post(
        `orders/${o.id}/commands`,
        cmd({ version: o.version, action: 'add_item', productId: product.id, quantity }),
      );
      o = await post(
        `orders/${o.id}/commands`,
        cmd({ version: o.version, action: 'status', status: 'OPEN' }),
      );
      return post(
        `orders/${o.id}/commands`,
        cmd({ version: o.version, action: 'status', status: 'WAITING_PAYMENT' }),
      );
    };
    const charge = (o, companyId, extra = {}, status = 201, token) =>
      post(
        `payments/orders/${o.id}/collect`,
        cmd({
          version: o.version,
          mode: 'AMOUNT',
          tenders: [{ method: 'COMPANY_ACCOUNT', amount: o.total, companyId, ...extra }],
        }),
        status,
        token,
      );
    const account = (id) => get(`companies/${id}/account?page=1&limit=100`);
    let company, contract, employee, reader, role, paidOrder;

    await test('strict inputs, company CRUD and read/manage/charge permission separation', async () => {
      await http.get('/api/companies').expect(401);
      company = await post(
        'companies',
        cmd({ name: 'Acme Ltd', businessNumber: 'BIZ-9', email: 'ap@acme.test' }),
      );
      await post('companies', cmd({ name: 'Bad', branchId: randomUUID() }), 400);
      await post('companies', cmd({ name: '' }), 400);
      role = await post('roles', { name: 'Company viewer', permissions: ['company.read'] });
      reader = await post('users', {
        email: 'company-reader@example.test',
        name: 'Company viewer',
        password: 'Company-viewer-password-9!',
        roleIds: [role.id],
      });
      reader.token = (
        await http
          .post('/api/auth/login')
          .set('Origin', origin)
          .send({
            organization: 'verification',
            branch: 'main',
            email: 'company-reader@example.test',
            password: 'Company-viewer-password-9!',
          })
          .expect(200)
      ).body.accessToken;
      await get('companies', 200, reader.token);
      await get(`companies/${company.id}/account`, 200, reader.token);
      await post('companies', cmd({ name: 'Denied' }), 403, reader.token);
      await post(
        'companies/directory/contracts',
        cmd({
          companyId: company.id,
          contractNumber: 'X',
          startDate: '2026-09-01',
          endDate: null,
          creditLimit: '10.00',
          discountPercentage: '0.00',
          paymentTermsDays: 30,
          billingCycle: 'MONTHLY',
        }),
        403,
        reader.token,
      );
      await post(
        'companies/directory/payments',
        cmd({
          companyId: company.id,
          amount: '1.00',
          method: 'BANK_TRANSFER',
          reference: 'r',
          reason: 'x',
        }),
        403,
        reader.token,
      );
    });

    await test('contract lifecycle enforces one active contract and terminal states', async () => {
      const draft = cmd({
        companyId: company.id,
        contractNumber: 'C-2026-001',
        startDate: '2026-09-01',
        endDate: null,
        creditLimit: '50.00',
        discountPercentage: '10.00',
        paymentTermsDays: 30,
        billingCycle: 'MONTHLY',
      });
      contract = await post('companies/directory/contracts', draft);
      assert.equal(contract.status, 'DRAFT');
      assert.equal(contract.creditLimit, '50.00');
      // A draft may be edited; an active contract may not.
      contract = await put(
        `companies/directory/contracts/${contract.id}`,
        cmd({ ...draft, commandId: randomUUID(), creditLimit: '40.00', version: contract.version }),
      );
      assert.equal(contract.creditLimit, '40.00');
      contract = await post(
        `companies/directory/contracts/${contract.id}/status`,
        cmd({ version: contract.version, status: 'ACTIVE', reason: 'Signed' }),
      );
      assert.equal(contract.status, 'ACTIVE');
      await put(
        `companies/directory/contracts/${contract.id}`,
        cmd({ ...draft, commandId: randomUUID(), version: contract.version }),
        409,
      );
      const second = await post(
        'companies/directory/contracts',
        cmd({ ...draft, commandId: randomUUID(), contractNumber: 'C-2026-002' }),
      );
      await post(
        `companies/directory/contracts/${second.id}/status`,
        cmd({ version: second.version, status: 'ACTIVE', reason: 'Duplicate' }),
        409,
      );
      await post(
        `companies/directory/contracts/${second.id}/status`,
        cmd({ version: second.version, status: 'EXPIRED', reason: 'Not reachable from draft' }),
        409,
      );
      const terminated = await post(
        `companies/directory/contracts/${second.id}/status`,
        cmd({ version: second.version, status: 'TERMINATED', reason: 'Superseded' }),
      );
      await post(
        `companies/directory/contracts/${second.id}/status`,
        cmd({ version: terminated.version, status: 'ACTIVE', reason: 'Reopen' }),
        409,
      );
    });

    await test('authorized employees are branch-scoped and consumption is derived', async () => {
      employee = await post(
        'companies/directory/employees',
        cmd({ companyId: company.id, name: 'Ada Employee', code: 'E-1' }),
      );
      const list = await get(`companies/directory/employees?companyId=${company.id}`);
      assert.equal(list.items.length, 1);
      assert.equal(list.items[0].consumedTotal, '0.00');
      assert.equal(list.items[0].orderCount, 0);
    });

    await test('an order settles on the company account without touching a cash drawer', async () => {
      const o = await order();
      const receipt = await charge(o, company.id, { companyEmployeeId: employee.id });
      assert.equal(receipt.settled, true);
      paidOrder = await get('orders/' + o.id);
      assert.equal(paidOrder.status, 'PAID');
      const a = await account(company.id);
      assert.equal(a.balance, '10.00');
      assert.equal(a.charged, '10.00');
      assert.equal(a.available, '30.00');
      assert.equal(a.orderCount, 1);
      assert.equal(a.items[0].kind, 'CHARGE');
      assert.equal(a.items[0].employeeName, 'Ada Employee');
      // No drawer movement exists for a house account payment.
      const payment = await db.payment.findFirstOrThrow({ where: { orderId: o.id } });
      assert.equal(payment.method, 'COMPANY_ACCOUNT');
      assert.equal(payment.shiftId, null);
      assert.equal(await db.cashMovement.count({ where: { paymentId: payment.id } }), 0);
      assert.equal(
        await db.companyLedgerEntry.count({ where: { paymentId: payment.id, kind: 'CHARGE' } }),
        1,
      );
      const consumed = await get(`companies/directory/employees?companyId=${company.id}`);
      assert.equal(consumed.items[0].consumedTotal, '10.00');
      assert.equal(consumed.items[0].orderCount, 1);
    });

    await test('the credit limit is a hard block at its exact boundary', async () => {
      const o = await order(3); // 30.00 -> balance would reach 40.00 exactly
      await charge(o, company.id);
      assert.equal((await account(company.id)).balance, '40.00');
      assert.equal((await account(company.id)).available, '0.00');
      const over = await order();
      await charge(over, company.id, {}, 409);
      assert.equal((await account(company.id)).balance, '40.00');
      // The database refuses the same over-limit charge even without the service.
      await assert.rejects(
        db.companyLedgerEntry.create({
          data: {
            ...scope,
            companyId: company.id,
            userId: auth.user.id,
            kind: 'CHARGE',
            amount: '10.00',
            orderId: over.id,
            paymentId: randomUUID(),
            reason: 'Direct over-limit charge',
          },
        }),
      );
    });

    await test('account-level payments settle many orders and reversals restore the balance', async () => {
      const payment = await post(
        'companies/directory/payments',
        cmd({
          companyId: company.id,
          amount: '40.00',
          method: 'BANK_TRANSFER',
          reference: 'WIRE-1',
          reason: 'Monthly settlement',
        }),
      );
      assert.equal((await account(company.id)).balance, '0.00');
      // Overpayment beyond the outstanding balance is refused.
      await post(
        'companies/directory/payments',
        cmd({
          companyId: company.id,
          amount: '1.00',
          method: 'BANK_TRANSFER',
          reference: 'WIRE-2',
          reason: 'Overpay',
        }),
        409,
      );
      const reversal = await post(
        `companies/directory/payments/${payment.id}/reverse`,
        cmd({ reason: 'Recorded against the wrong company' }),
      );
      assert.equal((await account(company.id)).balance, '40.00');
      await post(
        `companies/directory/payments/${payment.id}/reverse`,
        cmd({ reason: 'Twice' }),
        409,
      );
      assert.ok(reversal.id);
      // Settle again so later assertions start from a known balance.
      await post(
        'companies/directory/payments',
        cmd({
          companyId: company.id,
          amount: '40.00',
          method: 'BANK_TRANSFER',
          reference: 'WIRE-3',
          reason: 'Re-settled',
        }),
      );
      assert.equal((await account(company.id)).balance, '0.00');
    });

    await test('command replay returns the original receipt and conflicting reuse is rejected', async () => {
      const input = cmd({
        companyId: company.id,
        name: 'Replay employee',
        code: 'E-REPLAY',
        email: '',
        phone: '',
      });
      const first = await post('companies/directory/employees', input);
      assert.deepEqual(await post('companies/directory/employees', input), first);
      await post(
        'companies/directory/employees',
        { ...input, name: 'Different body' },
        409,
      );
      assert.equal(
        await db.companyEmployee.count({ where: { ...scope, code: 'E-REPLAY' } }),
        1,
      );
    });

    await test('concurrent charges on one account cannot exceed the credit limit', async () => {
      const a = await order(2),
        b = await order(2); // 20.00 each against a 40.00 limit
      const results = await Promise.all([
        call('post', `payments/orders/${a.id}/collect`).send(
          cmd({
            version: a.version,
            mode: 'AMOUNT',
            tenders: [{ method: 'COMPANY_ACCOUNT', amount: a.total, companyId: company.id }],
          }),
        ),
        call('post', `payments/orders/${b.id}/collect`).send(
          cmd({
            version: b.version,
            mode: 'AMOUNT',
            tenders: [{ method: 'COMPANY_ACCOUNT', amount: b.total, companyId: company.id }],
          }),
        ),
      ]);
      for (const r of results) assert.ok([201, 409].includes(r.status), String(r.status));
      const balance = (await account(company.id)).balance;
      assert.ok(balance === '20.00' || balance === '40.00', balance);
      assert.ok(Number(balance) <= 40);
    });

    await test('a missing or draft contract and a foreign employee cannot be charged', async () => {
      const bare = await post('companies', cmd({ name: 'No contract Ltd' }));
      const o = await order();
      await charge(o, bare.id, {}, 409);
      // A contract that exists but is still DRAFT grants no credit.
      await post(
        'companies/directory/contracts',
        cmd({
          companyId: bare.id,
          contractNumber: 'C-DRAFT-ONLY',
          startDate: '2026-09-01',
          endDate: null,
          creditLimit: '100.00',
          discountPercentage: '0.00',
          paymentTermsDays: 30,
          billingCycle: 'MONTHLY',
        }),
      );
      await charge(o, bare.id, {}, 409);
      const other = await post('companies', cmd({ name: 'Other Ltd' }));
      const otherEmployee = await post(
        'companies/directory/employees',
        cmd({ companyId: other.id, name: 'Wrong company employee' }),
      );
      await charge(o, company.id, { companyEmployeeId: otherEmployee.id }, 409);
      assert.equal((await get('orders/' + o.id)).status, 'WAITING_PAYMENT');
    });

    await test('a house-account payment reverses without a drawer and returns account credit', async () => {
      const before = (await account(company.id)).balance;
      const payment = await db.payment.findFirstOrThrow({
        where: { ...scope, orderId: paidOrder.id },
      });
      await post(
        `payments/${payment.id}/reverse`,
        cmd({ kind: 'REFUND', amount: '4.00', reason: 'Partial company refund' }),
      );
      const after = await account(company.id);
      assert.equal(Number(before) - Number(after.balance), 4);
      // A company reversal takes neither a cash shift nor a card reference.
      await post(
        `payments/${payment.id}/reverse`,
        cmd({
          kind: 'REFUND',
          amount: '1.00',
          reason: 'Wrong shape',
          transactionReference: 'TERMINAL-X',
        }),
        409,
      );
      assert.equal((await get('orders/' + paidOrder.id)).status, 'PAID');
    });

    await test('statements freeze the period ledger and are idempotent per period', async () => {
      const input = cmd({
        companyId: company.id,
        periodStart: '2026-01-01',
        periodEnd: '2099-12-31',
      });
      const statement = await post('companies/directory/statements', input);
      assert.ok(statement.items.length > 0);
      assert.equal(
        statement.closingBalance,
        (await account(company.id)).balance,
      );
      const recomputed =
        Number(statement.openingBalance) + Number(statement.charges) + Number(statement.payments);
      assert.equal(recomputed.toFixed(2), statement.closingBalance);
      assert.deepEqual(await post('companies/directory/statements', input), statement);
      await post(
        'companies/directory/statements',
        { ...input, commandId: randomUUID() },
        409,
      );
      const fetched = await get(`companies/directory/statements/${statement.id}`);
      assert.equal(fetched.number, statement.number);
    });

    await test('forced ledger failure rolls back the payment, settlement and PAID status', async () => {
      // A dedicated company with ample headroom, so the injected failure is the only
      // reason the charge can fail rather than the credit limit reached by earlier groups.
      const isolated = await post('companies', cmd({ name: 'Rollback fixture Ltd' }));
      const isolatedContract = await post(
        'companies/directory/contracts',
        cmd({
          companyId: isolated.id,
          contractNumber: 'C-ROLLBACK-1',
          startDate: '2026-09-01',
          endDate: null,
          creditLimit: '999.00',
          discountPercentage: '0.00',
          paymentTermsDays: 30,
          billingCycle: 'MONTHLY',
        }),
      );
      await post(
        `companies/directory/contracts/${isolatedContract.id}/status`,
        cmd({ version: isolatedContract.version, status: 'ACTIVE', reason: 'Fixture' }),
      );
      const o = await order();
      const before = await db.auditLog.count({ where: scope });
      await db.$executeRawUnsafe(
        `CREATE FUNCTION phase9_fail_entry() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'forced company ledger failure'; END $$`,
      );
      await db.$executeRawUnsafe(
        'CREATE TRIGGER phase9_fail_entry BEFORE INSERT ON "CompanyLedgerEntry" FOR EACH ROW EXECUTE FUNCTION phase9_fail_entry()',
      );
      try {
        await charge(o, isolated.id, {}, 500);
      } finally {
        await db.$executeRawUnsafe('DROP TRIGGER phase9_fail_entry ON "CompanyLedgerEntry"');
        await db.$executeRawUnsafe('DROP FUNCTION phase9_fail_entry()');
      }
      assert.equal((await account(isolated.id)).balance, '0.00');
      assert.equal((await get('orders/' + o.id)).status, 'WAITING_PAYMENT');
      assert.equal(await db.payment.count({ where: { orderId: o.id } }), 0);
      assert.equal(await db.orderSettlement.count({ where: { orderId: o.id } }), 0);
      assert.equal(await db.auditLog.count({ where: scope }), before);
    });

    await test('event failure rolls back company writes and their audit together', async () => {
      const before = await db.auditLog.count({ where: scope });
      await db.$executeRawUnsafe(
        `CREATE FUNCTION phase9_fail_event() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'forced companies event failure'; END $$`,
      );
      await db.$executeRawUnsafe(
        'CREATE TRIGGER phase9_fail_event BEFORE INSERT ON "CompaniesEvent" FOR EACH ROW EXECUTE FUNCTION phase9_fail_event()',
      );
      try {
        await post('companies', cmd({ name: 'Rolled back Ltd' }), 500);
      } finally {
        await db.$executeRawUnsafe('DROP TRIGGER phase9_fail_event ON "CompaniesEvent"');
        await db.$executeRawUnsafe('DROP FUNCTION phase9_fail_event()');
      }
      assert.equal(await db.company.count({ where: { ...scope, name: 'Rolled back Ltd' } }), 0);
      assert.equal(await db.auditLog.count({ where: scope }), before);
    });

    await test('database guards protect ledger, statement and event history', async () => {
      const entry = await db.companyLedgerEntry.findFirstOrThrow({
        where: { ...scope, kind: 'CHARGE' },
      });
      // Even the migration owner cannot rewrite or delete immutable history.
      await assert.rejects(
        db.companyLedgerEntry.update({ where: { id: entry.id }, data: { amount: '1.00' } }),
      );
      await assert.rejects(db.companyLedgerEntry.delete({ where: { id: entry.id } }));
      await assert.rejects(
        db.companiesEvent.updateMany({ where: scope, data: { action: 'tampered' } }),
      );
      await assert.rejects(db.companyStatement.deleteMany({ where: scope }));
      // The restricted runtime role cannot either.
      await assert.rejects(
        runtime.companyLedgerEntry.update({ where: { id: entry.id }, data: { amount: '2.00' } }),
      );
      await assert.rejects(runtime.companyStatementLine.deleteMany({ where: scope }));
      // A terminated contract is final and versions are monotonic.
      const active = await db.companyContract.findFirstOrThrow({
        where: { ...scope, status: 'ACTIVE' },
      });
      await assert.rejects(
        db.companyContract.update({ where: { id: active.id }, data: { version: active.version } }),
      );
    });

    await test('archiving requires terminated contracts and a settled balance', async () => {
      const a = await account(company.id);
      const current = await get(`companies/directory/contracts?companyId=${company.id}`);
      const live = current.items.find((c) => c.status === 'ACTIVE');
      if (Number(a.balance) !== 0)
        await post(
          'companies/directory/payments',
          cmd({
            companyId: company.id,
            amount: a.balance,
            method: 'BANK_TRANSFER',
            reference: 'WIRE-FINAL',
            reason: 'Closing settlement',
          }),
        );
      const fresh = await get('companies?page=1&limit=100');
      const row = fresh.items.find((c) => c.id === company.id);
      // An active contract blocks archival.
      await post(`companies/${company.id}/archive`, cmd({ version: row.version }), 409);
      await post(
        `companies/directory/contracts/${live.id}/status`,
        cmd({ version: live.version, status: 'TERMINATED', reason: 'Closed' }),
      );
      const settled = (await get('companies?page=1&limit=100')).items.find(
        (c) => c.id === company.id,
      );
      await post(`companies/${company.id}/archive`, cmd({ version: settled.version }));
      const archived = (await get('companies?page=1&limit=100&includeArchived=true')).items.find(
        (c) => c.id === company.id,
      );
      assert.ok(archived.deletedAt);
      assert.equal(archived.active, false);
      // History remains readable after archival.
      assert.ok((await account(company.id)).items.length > 0);
    });

    await test('branch isolation covers companies, contracts, accounts and statements', async () => {
      const branch = await db.branch.create({
        data: {
          organizationId: scope.organizationId,
          code: 'companies-other',
          name: 'Other companies branch',
          currency: 'EUR',
          timezone: 'Europe/Pristina',
        },
      });
      const foreign = await db.company.create({
        data: {
          branchId: branch.id,
          organizationId: scope.organizationId,
          name: 'Foreign company',
        },
      });
      await get(`companies/${foreign.id}/account`, 404);
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
      const foreignToken = (
        await http
          .post('/api/auth/login')
          .set('Origin', origin)
          .send({
            organization: 'verification',
            branch: 'companies-other',
            email: process.env.SEED_OWNER_EMAIL,
            password: process.env.SEED_OWNER_PASSWORD,
          })
          .expect(200)
      ).body.accessToken;
      await get(`companies/${company.id}/account`, 404, foreignToken);
      await get(`companies/${company.id}/history`, 404, foreignToken);
      assert.equal((await get('companies', 200, foreignToken)).items.length, 1);
      assert.equal(
        (await get('companies/directory/contracts', 200, foreignToken)).items.length,
        0,
      );
      assert.equal(
        (await get('companies/directory/statements', 200, foreignToken)).items.length,
        0,
      );
      // A composite foreign key prevents associating across branches.
      await assert.rejects(
        db.companyContract.create({
          data: {
            ...scope,
            companyId: foreign.id,
            contractNumber: 'CROSS-1',
            startDate: new Date('2026-09-01T00:00:00.000Z'),
            creditLimit: '10.00',
            discountPercentage: '0.00',
            paymentTermsDays: 30,
            currency: 'EUR',
          },
        }),
      );
    });

    await test('event cursors page above the JavaScript safe integer range', async () => {
      const feed = await get('companies/directory/events?after=0&limit=5');
      assert.ok(feed.events.length > 0);
      assert.equal(typeof feed.cursor, 'string');
      const beyond = await get(`companies/directory/events?after=${Number.MAX_SAFE_INTEGER}0`);
      assert.equal(beyond.events.length, 0);
      assert.equal(beyond.hasMore, false);
      // Permission revocation takes effect on the existing session immediately.
      await call('patch', `roles/${role.id}/permissions`).send({ permissions: [] }).expect(200);
      await get('companies', 403, reader.token);
    });

    console.log(`Companies integration suite passed: ${count} checks.`);
  } finally {
    await db.$disconnect();
    await runtime.$disconnect();
  }
}
