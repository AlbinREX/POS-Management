import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import request from 'supertest';
const require = createRequire(import.meta.url);
const { createDatabase } = require('@restaurant/database');

// Branch-local midnight in UTC, computed independently of the API's own helper.
function localMidnightUtc(ymd, timeZone) {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const offset = (d) => {
    const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - d.getTime();
  };
  const [y, m, d] = ymd.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d);
  return new Date(guess - offset(new Date(guess - offset(new Date(guess)))));
}
const localDate = (instant, timeZone) => {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
      .formatToParts(instant)
      .map((x) => [x.type, x.value]),
  );
  return `${p.year}-${p.month}-${p.day}`;
};
const shift = (ymd, days) => {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
};
const add = (...values) =>
  (values.reduce((n, v) => n + BigInt(v.replace('.', '')), 0n) / 100n).toString() +
  '.' +
  (values.reduce((n, v) => n + BigInt(v.replace('.', '')), 0n) % 100n).toString().padStart(2, '0');

export async function runReportingIntegration(app) {
  const db = createDatabase(process.env.MIGRATION_DATABASE_URL);
  const http = request(app.getHttpServer()),
    origin = process.env.APP_ORIGIN,
    timezone = 'Europe/Belgrade';
  let count = 0;
  const test = async (name, fn) => {
    await fn();
    console.log(`PASS reporting ${++count}: ${name}`);
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
    const main = await login(credentials);
    const organizationId = main.user.organizationId;
    // A dedicated branch gives exact, fully known figures; the main branch, already
    // populated by every earlier suite, is used for regression and isolation checks.
    const branch = await db.branch.create({
      data: {
        organizationId,
        code: 'reports',
        name: 'Reporting branch',
        currency: 'EUR',
        timezone,
      },
    });
    const ownerRole = await db.role.findFirstOrThrow({ where: { organizationId, name: 'OWNER' } });
    await db.branchMembership.create({
      data: { branchId: branch.id, organizationId, userId: main.user.id },
    });
    await db.userBranchRole.create({
      data: { branchId: branch.id, organizationId, userId: main.user.id, roleId: ownerRole.id },
    });
    const auth = await login({ ...credentials, branch: 'reports' });
    const scope = { branchId: branch.id, organizationId };
    const call = (method, path, token = auth.accessToken) =>
      http[method]('/api/' + path)
        .set('Origin', origin)
        .set('Authorization', 'Bearer ' + token);
    const post = async (path, data, status = 201, token) =>
      (await call('post', path, token).send(data).expect(status)).body;
    const get = async (path, status = 200, token) =>
      (await call('get', path, token).expect(status)).body;
    const cmd = (x) => ({ commandId: randomUUID(), ...x });
    const command = (o, input) =>
      post(`orders/${o.id}/commands`, cmd({ version: o.version, ...input }));
    const today = localDate(new Date(), timezone);

    // Fixtures: a taxed and an untaxed product, a table, a POS terminal and an open shift.
    const category = await post('menu/categories', { kind: 'categories', name: 'Report meals' });
    const menu = async (name, sku, sellingPrice, taxRate) =>
      post('menu/products', {
        kind: 'products',
        name,
        sku,
        categoryId: category.id,
        sellingPrice,
        taxRate,
        taxMode: 'INCLUSIVE',
      });
    const taxed = await menu('Report steak', 'RPT-STEAK', '12.00', '20.00');
    const plain = await menu('Report soup', 'RPT-SOUP', '5.00', '0.00');
    const area = await post('layout/areas', { name: 'Report hall', sortOrder: 1 });
    const table = await post('layout/tables', {
      areaId: area.id,
      name: 'R1',
      number: 1,
      capacity: 2,
      positionX: 0,
      positionY: 0,
      width: 80,
      height: 80,
      shape: 'SQUARE',
    });
    const terminal = await db.terminal.create({
      data: { ...scope, name: 'Report POS', type: 'POS' },
    });
    let shiftRecord = await post(
      'payments/shifts',
      cmd({ terminalId: terminal.id, openingAmount: '20.00' }),
    );
    const newOrder = async ({ dine = false, waiter = false, lines }) => {
      let o = await post(
        'orders',
        cmd({
          type: dine ? 'DINE_IN' : 'TAKEAWAY',
          tableId: dine ? table.id : null,
          waiterId: waiter ? auth.user.id : null,
        }),
      );
      for (const [productId, quantity] of lines)
        o = await command(o, { action: 'add_item', productId, quantity });
      return o;
    };
    const waiting = async (o) => {
      o = await command(o, { action: 'status', status: 'OPEN' });
      return command(o, { action: 'status', status: 'WAITING_PAYMENT' });
    };
    const collect = (o, tenders) =>
      post(`payments/orders/${o.id}/collect`, cmd({ version: o.version, mode: 'AMOUNT', tenders }));

    // Order 1: cash, discounted, with a voided line that must never count.
    let one = await newOrder({
      waiter: true,
      lines: [
        [taxed.id, 2],
        [plain.id, 1],
      ],
    });
    const voided = one.items.find((i) => i.productId === plain.id);
    one = await command(one, { action: 'void_item', itemId: voided.id, reason: 'Wrong table' });
    one = await command(one, { action: 'discount', amount: '4.00', reason: 'Loyalty' });
    one = await waiting(one);
    assert.equal(one.total, '20.00');
    await collect(one, [
      { method: 'CASH', amount: '20.00', tendered: '20.00', shiftId: shiftRecord.id },
    ]);
    // Order 2: dine-in card.
    let two = await waiting(await newOrder({ dine: true, waiter: true, lines: [[plain.id, 3]] }));
    await collect(two, [
      { method: 'CARD', amount: '15.00', transactionReference: 'rpt-' + randomUUID() },
    ]);
    // Order 3: cancelled; its totals survive in the row and must be excluded from revenue.
    const three = await newOrder({ lines: [[plain.id, 1]] });
    await command(three, { action: 'cancel', reason: 'Guest left' });
    // Order 4: card, then a 2.00 refund.
    let four = await waiting(await newOrder({ lines: [[taxed.id, 1]] }));
    await collect(four, [
      { method: 'CARD', amount: '12.00', transactionReference: 'rpt-' + randomUUID() },
    ]);
    const fourPayment = (await get(`payments/orders/${four.id}`)).payments[0];
    await post(
      `payments/${fourPayment.id}/reverse`,
      cmd({
        kind: 'REFUND',
        amount: '2.00',
        reason: 'Cold plate',
        transactionReference: 'rpt-' + randomUUID(),
      }),
    );
    // Order 5: company account.
    const company = await post('companies', cmd({ name: 'Report Co' }));
    const contract = await post(
      'companies/directory/contracts',
      cmd({
        companyId: company.id,
        contractNumber: 'RPT-1',
        startDate: '2026-01-01',
        endDate: null,
        creditLimit: '100.00',
        discountPercentage: '0.00',
        paymentTermsDays: 30,
        billingCycle: 'MONTHLY',
      }),
    );
    await post(
      `companies/directory/contracts/${contract.id}/status`,
      cmd({ version: contract.version, status: 'ACTIVE', reason: 'Signed' }),
    );
    let five = await waiting(await newOrder({ lines: [[plain.id, 2]] }));
    await collect(five, [{ method: 'COMPANY_ACCOUNT', amount: '10.00', companyId: company.id }]);
    await post(
      'companies/directory/statements',
      cmd({ companyId: company.id, periodStart: shift(today, -1), periodEnd: today }),
    );
    // Cash drawer movements. The cash payment above advanced the shift version.
    shiftRecord = (await get(`payments/shifts/${shiftRecord.id}`)).shift;
    shiftRecord = await post(
      `payments/shifts/${shiftRecord.id}/commands`,
      cmd({ version: shiftRecord.version, action: 'cash_in', amount: '5.00', reason: 'Float' }),
    );
    shiftRecord = await post(
      `payments/shifts/${shiftRecord.id}/commands`,
      cmd({
        version: shiftRecord.version,
        action: 'cash_out',
        amount: '2.00',
        reason: 'Petty cash',
      }),
    );
    // Inventory and purchasing.
    const warehouse = await post('inventory/warehouses', cmd({ name: 'Report store' }));
    const item = await post(
      'inventory/items',
      cmd({ name: 'Report flour', sku: 'RPT-FLOUR', kind: 'INGREDIENT', unitCode: 'g' }),
    );
    await post(
      'inventory/movements',
      cmd({
        warehouseId: warehouse.id,
        itemId: item.id,
        kind: 'ADJUSTMENT',
        quantity: '1',
        unitCode: 'kg',
        reason: 'Opening count',
      }),
    );
    const position = (await get(`inventory/stock?warehouseId=${warehouse.id}&itemId=${item.id}`))
      .items[0];
    await post(
      'inventory/thresholds',
      cmd({
        warehouseId: warehouse.id,
        itemId: item.id,
        version: position.version,
        lowStockThreshold: '5',
        unitCode: 'kg',
      }),
    );
    const supplier = await post('purchasing/suppliers', cmd({ name: 'Report supplier' }));
    let purchase = await post(
      'purchasing/orders',
      cmd({
        supplierId: supplier.id,
        warehouseId: warehouse.id,
        reference: 'RPT-PO',
        items: [
          { itemId: item.id, quantity: '2', unitCode: 'kg', unitPrice: '10.0000', taxRate: '0.00' },
        ],
      }),
    );
    purchase = await post(
      `purchasing/orders/${purchase.id}/order`,
      cmd({ version: purchase.version }),
    );
    const receipt = await post(
      `purchasing/orders/${purchase.id}/receive`,
      cmd({
        version: purchase.version,
        reference: 'RPT-DEL-1',
        invoiceNumber: 'RPT-INV-1',
        invoiceDate: today,
        items: [{ purchaseItemId: purchase.items[0].id, quantity: '2' }],
      }),
    );
    assert.equal(receipt.total, '20.00');
    await post(
      'purchasing/payments',
      cmd({
        receiptId: receipt.id,
        amount: '5.00',
        method: 'BANK_TRANSFER',
        reference: 'RPT-PAY',
        reason: 'Partial',
      }),
    );
    const orders = {};
    for (const [key, o] of Object.entries({ one, two, four, five }))
      orders[key] = await get('orders/' + o.id);
    const expectedTax = add(...Object.values(orders).map((o) => o.tax));

    let reader, role, kinds;
    await test('reports need a session and report.read; operational roles are refused', async () => {
      await http.get('/api/reports/overview').expect(401);
      kinds = [
        'sales',
        'orders',
        'products',
        'staff',
        'cash',
        'inventory',
        'purchasing',
        'companies',
      ];
      role = await post('roles', { name: 'Report viewer', permissions: ['report.read'] });
      const password = 'Report-viewer-password-11!';
      await post('users', {
        name: 'Report viewer',
        email: 'report-viewer@verification.test',
        password,
        roleIds: [role.id],
      });
      // Users created through the API are members of the session's branch.
      reader = await login({
        ...credentials,
        branch: 'reports',
        email: 'report-viewer@verification.test',
        password,
      });
      for (const kind of ['overview', ...kinds])
        await get(`reports/${kind}`, 200, reader.accessToken);
      await get('reports/sales/export', 200, reader.accessToken);
      // A report-only account has no operational access.
      await get('orders', 403, reader.accessToken);
      await get('payments/shifts', 403, reader.accessToken);
      await get('companies', 403, reader.accessToken);
      const roles = await get('roles');
      const cashierRole = roles.find((r) => r.name === 'CASHIER');
      await post('users', {
        name: 'Report cashier',
        email: 'report-cashier@verification.test',
        password,
        roleIds: [cashierRole.id],
      });
      const cashier = await login({
        ...credentials,
        branch: 'reports',
        email: 'report-cashier@verification.test',
        password,
      });
      for (const kind of ['overview', ...kinds])
        await get(`reports/${kind}`, 403, cashier.accessToken);
      await get('reports/sales/export', 403, cashier.accessToken);
    });

    await test('inputs are strict and no client scope is accepted', async () => {
      await get('reports/sales?branchId=' + branch.id, 400);
      await get('reports/sales?organizationId=' + organizationId, 400);
      await get('reports/sales?preset=custom', 400);
      await get('reports/sales?preset=custom&from=2026-01-02&to=2026-01-01', 400);
      await get('reports/sales?preset=custom&from=2025-01-01&to=2026-06-01', 400);
      await get('reports/sales?preset=today&from=2026-01-01&to=2026-01-02', 400);
      await get('reports/sales?preset=lifetime', 400);
      await get('reports/inventory?limit=101', 400);
      await get('reports/ledger/export', 400);
      await get('reports/ledger', 404);
      await call('post', 'reports/sales').send({}).expect(404);
    });

    await test('sales KPIs reconcile to the cent with the immutable order and payment records', async () => {
      const s = await get('reports/sales');
      assert.equal(s.currency, 'EUR');
      assert.equal(s.range.timezone, timezone);
      assert.equal(s.orderCount, 4);
      assert.equal(s.grossSales, '61.00');
      assert.equal(s.discounts, '4.00');
      assert.equal(s.salesAfterDiscount, '57.00');
      assert.equal(s.tax, expectedTax);
      assert.equal(s.netSales, add('57.00', '-' + expectedTax));
      assert.equal(s.averageOrderValue, '14.25');
      assert.deepEqual(s.dineIn, { count: 1, total: '15.00' });
      assert.deepEqual(s.takeaway, { count: 3, total: '42.00' });
      assert.deepEqual(s.byMethod, [
        {
          method: 'CASH',
          count: 1,
          collected: '20.00',
          cancelled: '0.00',
          refunded: '0.00',
          net: '20.00',
        },
        {
          method: 'CARD',
          count: 2,
          collected: '27.00',
          cancelled: '0.00',
          refunded: '2.00',
          net: '25.00',
        },
        {
          method: 'COMPANY_ACCOUNT',
          count: 1,
          collected: '10.00',
          cancelled: '0.00',
          refunded: '0.00',
          net: '10.00',
        },
      ]);
      assert.equal(s.collected, '57.00');
      assert.equal(s.refunds, '2.00');
      assert.equal(s.cancellations, '0.00');
      assert.equal(s.netReceipts, '55.00');
      assert.deepEqual(s.companyAccount, { count: 1, charged: '10.00' });
      // The refund is a separate line: it never restates the settled sale.
      assert.equal(s.salesAfterDiscount, add(...Object.values(orders).map((o) => o.total)));
    });

    await test('orders, products and staff are derived from settlements and frozen line snapshots', async () => {
      const o = await get('reports/orders');
      assert.equal(o.byDay.length, 1);
      assert.equal(o.byDay[0].date, today);
      assert.equal(o.byDay[0].orderCount, 4);
      assert.equal(o.byDay[0].total, '57.00');
      assert.equal(o.byDay[0].netSales, add('57.00', '-' + expectedTax));
      assert.equal(o.byHour.length, 24);
      assert.equal(
        o.byHour.reduce((n, h) => n + h.orderCount, 0),
        4,
      );
      assert.equal(o.byStatus.find((x) => x.status === 'PAID').count, 4);
      assert.equal(o.byStatus.find((x) => x.status === 'CANCELLED').count, 1);
      assert.equal(o.voidedItems, 1);
      assert.equal(o.topOrders[0].total, '20.00');
      assert.equal(o.topOrders.length, 4);
      assert.deepEqual(o.tableUsage, [
        { tableId: table.id, tableName: 'R1', orders: 1, total: '15.00' },
      ]);
      const p = await get('reports/products');
      assert.equal(p.productCount, 2);
      assert.equal(p.quantity, 8);
      // Line snapshots sum exactly to the settled order headers; the voided line is absent.
      assert.equal(p.sales, '57.00');
      assert.deepEqual(
        p.top.map((r) => [r.productName, r.quantity, r.lines, r.sales]),
        [
          ['Report steak', 3, 2, '32.00'],
          ['Report soup', 5, 2, '25.00'],
        ],
      );
      assert.equal(p.low[0].productName, 'Report soup');
      assert.deepEqual(p.byCategory, [
        { categoryName: 'Report meals', quantity: 8, sales: '57.00' },
      ]);
      assert.deepEqual(p.modifiers, []);
      // A later price change must not alter historical product revenue.
      await call('put', `menu/products/${plain.id}`)
        .send({
          version: plain.version,
          data: {
            kind: 'products',
            name: 'Report soup',
            sku: 'RPT-SOUP',
            categoryId: category.id,
            sellingPrice: '99.00',
            taxRate: '0.00',
            taxMode: 'INCLUSIVE',
          },
        })
        .expect(200);
      assert.equal((await get('reports/products')).sales, '57.00');
      const st = await get('reports/staff');
      assert.deepEqual(
        st.waiters.map((w) => [w.userId, w.orders, w.sales, w.averageTicket, w.dineIn, w.takeaway]),
        [
          [auth.user.id, 2, '35.00', '17.50', 1, 1],
          [null, 2, '22.00', '11.00', 0, 2],
        ],
      );
      assert.equal(st.waiters[1].name, 'Unassigned');
      assert.deepEqual(
        st.cashiers.map((c) => [c.userId, c.orders, c.sales]),
        [[auth.user.id, 4, '57.00']],
      );
    });

    await test('cash shifts report stored counts and signed movements without mutation', async () => {
      let c = await get('reports/cash');
      assert.equal(c.shifts.length, 1);
      let row = c.shifts[0];
      assert.equal(row.status, 'OPEN');
      assert.equal(row.openingAmount, '20.00');
      assert.equal(row.cashIn, '5.00');
      assert.equal(row.cashOut, '-2.00');
      assert.equal(row.cashPayments, '20.00');
      assert.equal(row.cashReversals, '0.00');
      assert.equal(row.expectedAmount, '43.00');
      assert.equal(row.closingAmount, null);
      assert.equal(c.totals.openShifts, 1);
      assert.equal(c.totals.expected, '43.00');
      assert.equal(c.companyAccountSettled, '10.00');
      assert.equal(c.netReceipts, '55.00');
      // The live shift endpoint agrees with the report.
      assert.equal((await get(`payments/shifts/${shiftRecord.id}`)).shift.expectedAmount, '43.00');
      shiftRecord = await post(
        `payments/shifts/${shiftRecord.id}/commands`,
        cmd({
          version: shiftRecord.version,
          action: 'close',
          closingAmount: '40.00',
          reason: 'Short',
        }),
      );
      c = await get('reports/cash');
      row = c.shifts[0];
      assert.equal(row.status, 'CLOSED');
      assert.equal(row.closingAmount, '40.00');
      assert.equal(row.difference, '-3.00');
      assert.equal(row.closingReason, 'Short');
      assert.deepEqual(
        [
          c.totals.shifts,
          c.totals.openShifts,
          c.totals.counted,
          c.totals.difference,
          c.totals.discrepancies,
        ],
        [1, 0, '40.00', '-3.00', 1],
      );
    });

    await test('inventory, purchasing and company figures equal the operational endpoints', async () => {
      const inv = await get('reports/inventory?limit=1');
      assert.equal(inv.positions, 1);
      assert.equal(inv.lowStock, 1);
      assert.equal(inv.negativeStock, 0);
      assert.deepEqual(
        inv.stock.items.map((r) => [
          r.itemName,
          r.quantity,
          r.unitCode,
          r.lowStockThreshold,
          r.lowStock,
          r.negative,
        ]),
        [['Report flour', '3000.000000', 'g', '5000.000000', true, false]],
      );
      assert.equal(inv.stock.hasMore, false);
      assert.deepEqual(
        inv.movements.map((m) => [m.kind, m.count]),
        [
          ['ADJUSTMENT', 1],
          ['PURCHASE', 1],
        ],
      );
      assert.deepEqual(
        inv.byItem.map((m) => [m.kind, m.quantity]),
        [
          ['ADJUSTMENT', '1000.000000'],
          ['PURCHASE', '2000.000000'],
        ],
      );
      const live = (await get(`inventory/stock?warehouseId=${warehouse.id}`)).items[0];
      assert.equal(live.quantity, inv.stock.items[0].quantity);
      assert.equal(live.lowStock, inv.stock.items[0].lowStock);
      const pur = await get('reports/purchasing');
      assert.deepEqual(
        pur.suppliers.map((s) => [
          s.supplierName,
          s.receipts,
          s.receivedValue,
          s.payments,
          s.outstanding,
          s.receivedInRange,
        ]),
        [['Report supplier', 1, '20.00', '-5.00', '15.00', '20.00']],
      );
      assert.deepEqual(
        [pur.receiptsInRange, pur.receivedInRange, pur.paidInRange, pur.outstanding],
        [1, '20.00', '-5.00', '15.00'],
      );
      assert.equal(pur.recentReceipts[0].outstanding, '15.00');
      assert.equal(pur.ordersByStatus.find((x) => x.status === 'RECEIVED').count, 1);
      const account = await get(`purchasing/suppliers/${supplier.id}/account`);
      assert.equal(account.outstanding, pur.suppliers[0].outstanding);
      assert.equal(account.receivedValue, pur.suppliers[0].receivedValue);
      const co = await get('reports/companies');
      const rowCo = co.companies[0];
      assert.deepEqual(
        [
          rowCo.companyName,
          rowCo.contractStatus,
          rowCo.creditLimit,
          rowCo.charged,
          rowCo.paid,
          rowCo.balance,
          rowCo.available,
          rowCo.chargedInRange,
          rowCo.ordersInRange,
          rowCo.overdue,
        ],
        ['Report Co', 'ACTIVE', '100.00', '10.00', '0.00', '10.00', '90.00', '10.00', 1, '0.00'],
      );
      assert.deepEqual(co.totals, {
        companies: 1,
        exposure: '10.00',
        creditLimit: '100.00',
        available: '90.00',
        overdue: '0.00',
        chargedInRange: '10.00',
      });
      assert.equal(co.statements.length, 1);
      assert.equal(co.statements[0].closingBalance, '10.00');
      assert.equal(co.statements[0].overdue, false);
      const companyAccount = await get(`companies/${company.id}/account`);
      assert.equal(companyAccount.balance, rowCo.balance);
      assert.equal(companyAccount.paid, rowCo.paid);
      assert.equal(companyAccount.available, rowCo.available);
      const ov = await get('reports/overview');
      assert.equal(ov.branchName, 'Reporting branch');
      assert.equal(ov.timezone, timezone);
      assert.deepEqual(ov.sales, await get('reports/sales'));
      assert.deepEqual(
        [
          ov.positions,
          ov.lowStock,
          ov.negativeStock,
          ov.openShifts,
          ov.companyExposure,
          ov.supplierOutstanding,
        ],
        [1, 1, 0, 0, '10.00', '15.00'],
      );
    });

    await test('date ranges resolve on the branch calendar and exclude other days', async () => {
      const s = await get('reports/sales');
      assert.equal(s.range.fromDate, today);
      assert.equal(s.range.from, localMidnightUtc(today, timezone).toISOString());
      assert.equal(s.range.to, localMidnightUtc(shift(today, 1), timezone).toISOString());
      const yesterday = await get('reports/sales?preset=yesterday');
      assert.equal(yesterday.orderCount, 0);
      assert.equal(yesterday.salesAfterDiscount, '0.00');
      assert.equal(yesterday.range.fromDate, shift(today, -1));
      const past = await get('reports/orders?preset=custom&from=2000-01-01&to=2000-01-03');
      assert.equal(past.byDay.length, 3);
      assert.equal(
        past.byDay.reduce((n, d) => n + d.orderCount, 0),
        0,
      );
      const span = await get(`reports/sales?preset=custom&from=${shift(today, -1)}&to=${today}`);
      assert.equal(span.orderCount, 4);
      const week = await get('reports/sales?preset=week');
      assert.ok(week.range.fromDate <= today && week.range.toDate === today);
      assert.equal(week.orderCount, 4);
      const month = await get('reports/sales?preset=month');
      assert.equal(month.range.fromDate, today.slice(0, 8) + '01');
      assert.equal(month.orderCount, 4);
    });

    await test('csv exports carry exact values, headers and attachment metadata', async () => {
      const res = await call('get', 'reports/sales/export').expect(200);
      assert.match(res.headers['content-type'], /^text\/csv/);
      assert.equal(
        res.headers['content-disposition'],
        `attachment; filename="sales-${today}-to-${today}.csv"`,
      );
      const text = res.text.replace(/^\uFEFF/, '');
      const lines = text.split('\r\n').filter(Boolean);
      assert.equal(lines[0], 'date,orderCount,grossSales,discounts,tax,total,netSales');
      assert.equal(
        lines[1],
        `${today},4,61.00,4.00,${expectedTax},57.00,${add('57.00', '-' + expectedTax)}`,
      );
      const products = (await call('get', 'reports/products/export').expect(200)).text
        .replace(/^\uFEFF/, '')
        .split('\r\n');
      assert.equal(products[0], 'productId,productName,categoryName,quantity,lines,sales');
      assert.equal(products[1], `${taxed.id},Report steak,Report meals,3,2,32.00`);
      const ordersCsv = (await call('get', 'reports/orders/export').expect(200)).text
        .replace(/^\uFEFF/, '')
        .split('\r\n')
        .filter(Boolean);
      assert.equal(ordersCsv.length, 5);
      assert.ok(ordersCsv.every((l, i) => i === 0 || l.includes(',PAID,')));
      const cash = (await call('get', 'reports/cash/export').expect(200)).text.replace(
        /^\uFEFF/,
        '',
      );
      // A negative ledger figure is protected from formula interpretation.
      assert.ok(cash.includes(",'-2.00,"));
      assert.ok(cash.includes(',CLOSED,'));
      for (const kind of kinds)
        await call('get', `reports/${kind}/export?preset=month`).expect(200);
      const companies = (await call('get', 'reports/companies/export').expect(200)).text;
      assert.ok(companies.includes('Report Co,ACTIVE,100.00,10.00,0.00,10.00,90.00,10.00,1,0.00'));
    });

    await test('branch isolation: the main branch never sees reporting-branch figures', async () => {
      const mainSales = await get('reports/sales', 200, main.accessToken);
      assert.notEqual(mainSales.range.timezone, undefined);
      const mainCompanies = await get('reports/companies', 200, main.accessToken);
      assert.ok(!mainCompanies.companies.some((c) => c.companyId === company.id));
      assert.deepEqual(
        (await get(`reports/companies?companyId=${company.id}`, 200, main.accessToken)).companies,
        [],
      );
      assert.deepEqual(
        (await get(`reports/purchasing?supplierId=${supplier.id}`, 200, main.accessToken))
          .suppliers,
        [],
      );
      assert.equal(
        (await get(`reports/inventory?warehouseId=${warehouse.id}`, 200, main.accessToken))
          .positions,
        0,
      );
      const mainStaff = await get('reports/staff', 200, main.accessToken);
      assert.ok(
        !mainStaff.waiters.some(
          (w) => w.sales === '35.00' && w.dineIn === 1 && w.takeaway === 1 && w.orders === 2,
        ),
      );
      const mainCash = await get('reports/cash', 200, main.accessToken);
      assert.ok(!mainCash.shifts.some((s) => s.id === shiftRecord.id));
      assert.ok(
        !(await get('reports/orders', 200, main.accessToken)).tableUsage.some(
          (t) => t.tableId === table.id,
        ),
      );
    });

    await test('regression: report figures equal the payments, inventory, purchasing and company endpoints on the main branch', async () => {
      const token = main.accessToken;
      const range = `preset=custom&from=${shift(today, -1)}&to=${today}`;
      const cash = await get(`reports/cash?${range}`, 200, token);
      const shifts = (await get('payments/shifts?page=1&limit=100', 200, token)).items;
      assert.ok(shifts.length > 0);
      for (const s of shifts) {
        const row = cash.shifts.find((r) => r.id === s.id);
        assert.ok(row, 'shift present in report');
        assert.equal(row.expectedAmount, s.expectedAmount);
        assert.equal(row.difference, s.difference);
        assert.equal(row.closingAmount, s.closingAmount);
      }
      const inv = await get('reports/inventory?limit=100', 200, token);
      const stock = (await get('inventory/stock?page=1&limit=100', 200, token)).items;
      assert.ok(stock.length > 0);
      for (const s of stock) {
        const row = inv.stock.items.find((r) => r.positionId === s.id);
        assert.ok(row, 'position present in report');
        assert.equal(row.quantity, s.quantity);
        assert.equal(row.lowStock, s.lowStock);
        assert.equal(row.negative, s.quantity.startsWith('-'));
      }
      assert.equal(inv.negativeStock, inv.stock.items.filter((r) => r.negative).length);
      const pur = await get('reports/purchasing', 200, token);
      const suppliers = (await get('purchasing/suppliers?page=1&limit=100', 200, token)).items;
      assert.ok(suppliers.length > 0);
      for (const s of suppliers.filter((x) => !x.deletedAt)) {
        const account = await get(`purchasing/suppliers/${s.id}/account`, 200, token);
        const row = pur.suppliers.find((r) => r.supplierId === s.id);
        assert.ok(row, 'supplier present in report');
        assert.equal(row.outstanding, account.outstanding);
        assert.equal(row.receivedValue, account.receivedValue);
        assert.equal(row.receipts, account.receiptCount);
      }
      const co = await get('reports/companies', 200, token);
      const companies = (await get('companies?page=1&limit=100', 200, token)).items;
      assert.ok(companies.length > 0);
      for (const c of companies.filter((x) => !x.deletedAt)) {
        const account = await get(`companies/${c.id}/account`, 200, token);
        const row = co.companies.find((r) => r.companyId === c.id);
        assert.ok(row, 'company present in report');
        assert.equal(row.balance, account.balance);
        assert.equal(row.charged, account.charged);
        assert.equal(row.paid, account.paid);
        assert.equal(row.available, account.available);
        assert.equal(row.creditLimit, account.creditLimit);
      }
      const overview = await get('reports/overview', 200, token);
      assert.equal(overview.companyExposure, add(...co.companies.map((c) => c.balance), '0.00'));
      // Every PAID order settled today on the main branch is counted exactly once.
      const sales = await get('reports/sales', 200, token);
      const paid = await db.order.findMany({
        where: {
          branchId: main.user.branchId,
          status: 'PAID',
          settlement: {
            createdAt: { gte: new Date(sales.range.from), lt: new Date(sales.range.to) },
          },
        },
        select: { total: true },
      });
      assert.equal(sales.orderCount, paid.length);
      assert.equal(sales.salesAfterDiscount, add(...paid.map((o) => o.total.toFixed(2)), '0.00'));
    });

    await test('reporting writes nothing and revocation takes effect immediately', async () => {
      const counts = async () => [
        await db.order.count(),
        await db.payment.count(),
        await db.paymentReversal.count(),
        await db.cashMovement.count(),
        await db.stockMovement.count(),
        await db.companyLedgerEntry.count(),
        await db.supplierEntry.count(),
        await db.auditLog.count(),
      ];
      const before = await counts();
      for (const kind of ['overview', ...kinds]) {
        await get(`reports/${kind}`);
        await get(`reports/${kind}?preset=month`, 200, main.accessToken);
      }
      for (const kind of kinds) await call('get', `reports/${kind}/export`).expect(200);
      assert.deepEqual(await counts(), before);
      await call('patch', `roles/${role.id}/permissions`).send({ permissions: [] }).expect(200);
      await get('reports/overview', 403, reader.accessToken);
      await get('reports/sales/export', 403, reader.accessToken);
    });

    console.log(`Reporting integration suite passed: ${count} checks.`);
  } finally {
    await db.$disconnect();
  }
}
