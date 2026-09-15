import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@restaurant/database';
import type {
  CompanyAccount,
  ContractRecord,
  ContractStatus,
  CompanyEmployeeRecord,
  StatementRecord,
} from '@restaurant/shared-types';
import type {
  CompanyInput,
  CompanyUpdate,
  ContractInput,
  ContractUpdate,
  ContractStatusInput,
  CompanyEmployeeInput,
  CompanyEmployeeUpdate,
  CompanyPaymentInput,
  CompanyListInput,
  StatementInput,
} from '@restaurant/validation';
import { DatabaseService } from '../database.service';
import type { Principal } from '../auth/auth.service';
import { audit } from '../audit';
import { hash } from '../orders/orders.service';
import { inventoryScope as scope } from '../inventory/inventory.transactions';
import { availableCredit, exceedsMoney, negateMoney, sumMoney, withinCredit } from './company-money';
type Tx = Prisma.TransactionClient;
const paging = (q: CompanyListInput) => ({ skip: (q.page - 1) * q.limit, take: q.limit + 1 });
const page = <T>(rows: T[], q: CompanyListInput) => ({
  items: rows.slice(0, q.limit),
  hasMore: rows.length > q.limit,
  page: q.page,
});
const isoDate = (v: Date | null) => v?.toISOString().slice(0, 10) ?? null;
const date = (v: string) => new Date(v + 'T00:00:00.000Z');
const serialize = (v: unknown): Prisma.InputJsonObject =>
  JSON.parse(
    JSON.stringify(v, (_, value) => (typeof value === 'bigint' ? value.toString() : value)),
  );
const addDays = (from: Date, days: number) =>
  new Date(from.getTime() + days * 24 * 60 * 60 * 1000);
@Injectable()
export class CompaniesService {
  constructor(private readonly db: DatabaseService) {}
  private mutate(
    p: Principal,
    commandId: string,
    body: unknown,
    action: string,
    fn: (tx: Tx) => Promise<{
      id: string;
      companyId?: string;
      contractId?: string;
      response: unknown;
      before?: unknown;
    }>,
  ) {
    return this.db.client.$transaction(
      async (tx) => {
        const revision = await tx.companiesRevision.upsert({
          where: { branchId: p.branchId },
          create: { ...scope(p), revision: 1n },
          update: { revision: { increment: 1n } },
        });
        const requestHash = hash(body),
          old = await tx.companiesEvent.findFirst({ where: { ...scope(p), commandId } });
        if (old) {
          if (old.userId !== p.userId || old.requestHash !== requestHash)
            throw new ConflictException('Company command ID was already used');
          return old.response;
        }
        const r = await fn(tx),
          response = serialize(r.response);
        await audit(
          tx,
          {
            ...scope(p),
            userId: p.userId,
            terminalId: p.terminalId,
            ip: p.ip,
            requestId: p.requestId,
          },
          action,
          'Companies',
          r.id,
          r.before === undefined ? undefined : serialize(r.before),
          response,
        );
        await tx.companiesEvent.create({
          data: {
            ...scope(p),
            userId: p.userId,
            commandId,
            requestHash,
            revision: revision.revision,
            action,
            entityId: r.id,
            companyId: r.companyId,
            contractId: r.contractId,
            response,
          },
        });
        return response;
      },
      { isolationLevel: 'Serializable', timeout: 20000 },
    );
  }
  companies(p: Principal, q: CompanyListInput) {
    return this.db.client.company
      .findMany({
        where: {
          ...scope(p),
          ...(q.includeArchived === 'true' ? {} : { deletedAt: null }),
          OR: [
            { name: { contains: q.search, mode: 'insensitive' as const } },
            { businessNumber: { contains: q.search, mode: 'insensitive' as const } },
          ],
        },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        ...paging(q),
      })
      .then((rows) => page(rows, q));
  }
  saveCompany(p: Principal, input: CompanyInput | CompanyUpdate, id?: string) {
    return this.mutate(
      p,
      input.commandId,
      { id, input },
      id ? 'company.updated' : 'company.created',
      async (tx) => {
        let before;
        if (id) {
          before = await tx.company.findFirst({ where: { ...scope(p), id, deletedAt: null } });
          if (!before) throw new NotFoundException('Company not found');
          if (!('version' in input) || input.version !== before.version)
            throw new ConflictException('Reload this company');
        }
        const { commandId: _c, ...fields } = input;
        const row = id
          ? await tx.company.update({
              where: { ...scope(p), id },
              data: { ...fields, version: { increment: 1 } },
            })
          : await tx.company.create({ data: { ...scope(p), ...fields } });
        return { id: row.id, companyId: row.id, before, response: row };
      },
    );
  }
  archiveCompany(p: Principal, id: string, input: { commandId: string; version: number }) {
    return this.mutate(p, input.commandId, { id, input }, 'company.archived', async (tx) => {
      const before = await tx.company.findFirst({ where: { ...scope(p), id, deletedAt: null } });
      if (!before) throw new NotFoundException('Company not found');
      if (before.version !== input.version) throw new ConflictException('Reload this company');
      if (
        await tx.companyContract.count({
          where: { ...scope(p), companyId: id, status: { in: ['DRAFT', 'ACTIVE', 'SUSPENDED'] } },
        })
      )
        throw new ConflictException('Terminate open contracts before archiving');
      const balance = await this.balance(tx, p, id);
      if (balance !== '0.00')
        throw new ConflictException('Settle the account balance before archiving');
      const row = await tx.company.update({
        where: { id, ...scope(p) },
        data: { active: false, deletedAt: new Date(), version: { increment: 1 } },
      });
      return { id, companyId: id, before, response: row };
    });
  }
  private async company(tx: Tx, p: Principal, id: string) {
    const row = await tx.company.findFirst({ where: { ...scope(p), id } });
    if (!row) throw new NotFoundException('Company not found');
    return row;
  }
  private async balance(tx: Tx, p: Principal, companyId: string) {
    const sum = await tx.companyLedgerEntry.aggregate({
      where: { ...scope(p), companyId },
      _sum: { amount: true },
    });
    return sum._sum.amount?.toFixed(2) ?? '0.00';
  }
  private contractRecord(
    row: Prisma.CompanyContractGetPayload<{ include: { company: true } }>,
  ): ContractRecord {
    return {
      id: row.id,
      companyId: row.companyId,
      companyName: row.company.name,
      contractNumber: row.contractNumber,
      startDate: isoDate(row.startDate)!,
      endDate: isoDate(row.endDate),
      creditLimit: row.creditLimit.toFixed(2),
      discountPercentage: row.discountPercentage.toFixed(2),
      paymentTermsDays: row.paymentTermsDays,
      billingCycle: row.billingCycle,
      notes: row.notes,
      status: row.status,
      currency: row.currency,
      version: row.version,
      createdAt: row.createdAt.toISOString(),
    };
  }
  contracts(p: Principal, q: CompanyListInput) {
    return this.db.client.companyContract
      .findMany({
        where: {
          ...scope(p),
          companyId: q.companyId,
          status: q.status,
          contractNumber: { contains: q.search, mode: 'insensitive' as const },
        },
        include: { company: true },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        ...paging(q),
      })
      .then((rows) => page(rows.map((r) => this.contractRecord(r)), q));
  }
  saveContract(p: Principal, input: ContractInput | ContractUpdate, id?: string) {
    return this.mutate(
      p,
      input.commandId,
      { id, input },
      id ? 'contract.updated' : 'contract.created',
      async (tx) => {
        const company = await this.company(tx, p, input.companyId);
        if (company.deletedAt) throw new ConflictException('Company is archived');
        let before;
        if (id) {
          const old = await tx.companyContract.findFirst({
            where: { ...scope(p), id },
            include: { company: true },
          });
          if (!old) throw new NotFoundException('Contract not found');
          if (!('version' in input) || input.version !== old.version)
            throw new ConflictException('Reload this contract');
          if (old.status !== 'DRAFT')
            throw new ConflictException('Only draft contracts may be edited');
          if (old.companyId !== input.companyId)
            throw new ConflictException('Contract company is immutable');
          before = this.contractRecord(old);
        }
        const branch = await tx.branch.findFirstOrThrow({
          where: { id: p.branchId, organizationId: p.organizationId },
        });
        const { commandId: _c, companyId, startDate, endDate, ...rest } = input;
        const data = {
          ...rest,
          startDate: date(startDate),
          endDate: endDate ? date(endDate) : null,
        };
        const row = id
          ? await tx.companyContract.update({
              where: { ...scope(p), id },
              data: { ...data, version: { increment: 1 } },
              include: { company: true },
            })
          : await tx.companyContract.create({
              data: { ...scope(p), ...data, companyId, currency: branch.currency },
              include: { company: true },
            });
        return {
          id: row.id,
          companyId: row.companyId,
          contractId: row.id,
          before,
          response: this.contractRecord(row),
        };
      },
    );
  }
  contractStatus(p: Principal, id: string, input: ContractStatusInput) {
    return this.mutate(p, input.commandId, { id, input }, 'contract.status', async (tx) => {
      const old = await tx.companyContract.findFirst({
        where: { ...scope(p), id },
        include: { company: true },
      });
      if (!old) throw new NotFoundException('Contract not found');
      if (old.version !== input.version) throw new ConflictException('Reload this contract');
      if (old.status === input.status)
        throw new ConflictException('Contract already has this status');
      const allowed: Record<ContractStatus, ContractStatus[]> = {
        DRAFT: ['ACTIVE', 'TERMINATED'],
        ACTIVE: ['SUSPENDED', 'EXPIRED', 'TERMINATED'],
        SUSPENDED: ['ACTIVE', 'EXPIRED', 'TERMINATED'],
        EXPIRED: ['TERMINATED'],
        TERMINATED: [],
      };
      if (!(allowed[old.status] ?? []).includes(input.status))
        throw new ConflictException('Unsupported contract status transition');
      if (input.status === 'ACTIVE') {
        if (old.company.deletedAt) throw new ConflictException('Company is archived');
        const other = await tx.companyContract.count({
          where: { ...scope(p), companyId: old.companyId, status: 'ACTIVE', id: { not: id } },
        });
        if (other) throw new ConflictException('Company already has an active contract');
      }
      const row = await tx.companyContract.update({
        where: { ...scope(p), id },
        data: {
          status: input.status,
          statusReason: input.reason || null,
          version: { increment: 1 },
        },
        include: { company: true },
      });
      return {
        id,
        companyId: old.companyId,
        contractId: id,
        before: this.contractRecord(old),
        response: this.contractRecord(row),
      };
    });
  }
  async employees(p: Principal, q: CompanyListInput) {
    const rows = await this.db.client.companyEmployee.findMany({
      where: {
        ...scope(p),
        companyId: q.companyId,
        ...(q.includeArchived === 'true' ? {} : { deletedAt: null }),
        name: { contains: q.search, mode: 'insensitive' as const },
      },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      ...paging(q),
    });
    const records: CompanyEmployeeRecord[] = [];
    for (const row of rows) {
      const consumed = await this.db.client.companyLedgerEntry.aggregate({
        where: { ...scope(p), employeeId: row.id, kind: 'CHARGE' },
        _sum: { amount: true },
        _count: true,
      });
      records.push({
        id: row.id,
        companyId: row.companyId,
        name: row.name,
        code: row.code,
        email: row.email,
        phone: row.phone,
        active: row.active,
        deletedAt: row.deletedAt?.toISOString() ?? null,
        version: row.version,
        consumedTotal: consumed._sum.amount?.toFixed(2) ?? '0.00',
        orderCount: consumed._count,
      });
    }
    return page(records, q);
  }
  saveEmployee(p: Principal, input: CompanyEmployeeInput | CompanyEmployeeUpdate, id?: string) {
    return this.mutate(
      p,
      input.commandId,
      { id, input },
      id ? 'company.employee_updated' : 'company.employee_created',
      async (tx) => {
        const company = await this.company(tx, p, input.companyId);
        if (company.deletedAt) throw new ConflictException('Company is archived');
        let before;
        if (id) {
          before = await tx.companyEmployee.findFirst({
            where: { ...scope(p), id, deletedAt: null },
          });
          if (!before) throw new NotFoundException('Company employee not found');
          if (!('version' in input) || input.version !== before.version)
            throw new ConflictException('Reload this employee');
          if (before.companyId !== input.companyId)
            throw new ConflictException('Employee company is immutable');
        }
        const { commandId: _c, companyId, ...fields } = input;
        const row = id
          ? await tx.companyEmployee.update({
              where: { ...scope(p), id },
              data: { ...fields, version: { increment: 1 } },
            })
          : await tx.companyEmployee.create({ data: { ...scope(p), ...fields, companyId } });
        return { id: row.id, companyId: row.companyId, before, response: row };
      },
    );
  }
  archiveEmployee(p: Principal, id: string, input: { commandId: string; version: number }) {
    return this.mutate(
      p,
      input.commandId,
      { id, input },
      'company.employee_archived',
      async (tx) => {
        const before = await tx.companyEmployee.findFirst({
          where: { ...scope(p), id, deletedAt: null },
        });
        if (!before) throw new NotFoundException('Company employee not found');
        if (before.version !== input.version) throw new ConflictException('Reload this employee');
        const row = await tx.companyEmployee.update({
          where: { id, ...scope(p) },
          data: { active: false, deletedAt: new Date(), version: { increment: 1 } },
        });
        return { id, companyId: before.companyId, before, response: row };
      },
    );
  }
  account(p: Principal, companyId: string, q: CompanyListInput): Promise<CompanyAccount> {
    return this.db.client.$transaction(
      async (tx) => {
        await this.company(tx, p, companyId);
        const branch = await tx.branch.findFirstOrThrow({
          where: { id: p.branchId, organizationId: p.organizationId },
        });
        const contract = await tx.companyContract.findFirst({
          where: { ...scope(p), companyId, status: 'ACTIVE' },
          orderBy: [{ startDate: 'desc' }, { id: 'asc' }],
        });
        const sums = await tx.companyLedgerEntry.groupBy({
          by: ['kind'],
          where: { ...scope(p), companyId },
          _sum: { amount: true },
        });
        const charges = await tx.companyLedgerEntry.aggregate({
          where: { ...scope(p), companyId, kind: 'CHARGE' },
          _count: true,
          _max: { createdAt: true },
        });
        const rows = await tx.companyLedgerEntry.findMany({
          where: { ...scope(p), companyId },
          include: {
            actor: { include: { user: true } },
            employee: true,
            order: true,
            reversal: true,
          },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          ...paging(q),
        });
        const charged = sums.find((s) => s.kind === 'CHARGE')?._sum.amount?.toFixed(2) ?? '0.00';
        const balance = sumMoney(sums.map((s) => s._sum.amount?.toFixed(2) ?? '0.00'));
        const creditLimit = contract?.creditLimit.toFixed(2) ?? '0.00';
        return {
          companyId,
          currency: branch.currency,
          contractId: contract?.id ?? null,
          contractStatus: contract?.status ?? null,
          creditLimit,
          charged,
          paid: sumMoney(
            sums
              .filter((s) => s.kind !== 'CHARGE')
              .map((s) => s._sum.amount?.toFixed(2) ?? '0.00'),
          ),
          balance,
          available: availableCredit(creditLimit, balance),
          lastChargeAt: charges._max.createdAt?.toISOString() ?? null,
          orderCount: charges._count,
          ...page(
            rows.map((r) => ({
              id: r.id,
              kind: r.kind,
              amount: r.amount.toFixed(2),
              orderId: r.orderId,
              orderNumber: r.order?.orderNumber.toString() ?? null,
              employeeId: r.employeeId,
              employeeName: r.employee?.name ?? null,
              method: r.method,
              reference: r.reference,
              reason: r.reason,
              reversesId: r.reversesId,
              reversed: !!r.reversal,
              createdAt: r.createdAt.toISOString(),
              userName: r.actor.user.name,
            })),
            q,
          ),
        };
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }
  recordPayment(p: Principal, input: CompanyPaymentInput) {
    return this.mutate(p, input.commandId, input, 'company.payment_recorded', async (tx) => {
      await this.company(tx, p, input.companyId);
      const balance = await this.balance(tx, p, input.companyId);
      if (exceedsMoney(input.amount, balance))
        throw new ConflictException('Company payment exceeds the outstanding balance');
      const row = await tx.companyLedgerEntry.create({
        data: {
          ...scope(p),
          companyId: input.companyId,
          userId: p.userId,
          kind: 'PAYMENT',
          amount: negateMoney(input.amount),
          method: input.method,
          reference: input.reference,
          reason: input.reason,
        },
      });
      return { id: row.id, companyId: input.companyId, response: row };
    });
  }
  reversePayment(p: Principal, id: string, input: { commandId: string; reason: string }) {
    return this.mutate(p, input.commandId, { id, input }, 'company.payment_reversed', async (tx) => {
      const old = await tx.companyLedgerEntry.findFirst({
        where: { ...scope(p), id, kind: 'PAYMENT' },
        include: { reversal: true },
      });
      if (!old) throw new NotFoundException('Company payment not found');
      if (old.reversal) throw new ConflictException('Company payment already reversed');
      const row = await tx.companyLedgerEntry.create({
        data: {
          ...scope(p),
          companyId: old.companyId,
          userId: p.userId,
          kind: 'PAYMENT_REVERSAL',
          amount: negateMoney(old.amount.toFixed(2)),
          reason: input.reason,
          reversesId: id,
        },
      });
      return { id: row.id, companyId: old.companyId, before: old, response: row };
    });
  }
  private async statementRecord(tx: Tx, p: Principal, id: string): Promise<StatementRecord> {
    const s = await tx.companyStatement.findFirst({
      where: { ...scope(p), id },
      include: {
        company: true,
        contract: true,
        actor: { include: { user: true } },
        items: { orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }] },
      },
    });
    if (!s) throw new NotFoundException('Statement not found');
    return {
      id: s.id,
      companyId: s.companyId,
      companyName: s.company.name,
      contractId: s.contractId,
      contractNumber: s.contract.contractNumber,
      number: s.number.toString(),
      periodStart: isoDate(s.periodStart)!,
      periodEnd: isoDate(s.periodEnd)!,
      dueDate: isoDate(s.dueDate)!,
      currency: s.currency,
      openingBalance: s.openingBalance.toFixed(2),
      charges: s.charges.toFixed(2),
      payments: s.payments.toFixed(2),
      closingBalance: s.closingBalance.toFixed(2),
      createdAt: s.createdAt.toISOString(),
      issuedBy: s.actor.user.name,
      items: s.items.map((l) => ({
        id: l.id,
        entryId: l.entryId,
        kind: l.kind,
        amount: l.amount.toFixed(2),
        orderNumber: l.orderNumber,
        employeeName: l.employeeName,
        reason: l.reason,
        occurredAt: l.occurredAt.toISOString(),
      })),
    };
  }
  getStatement(p: Principal, id: string) {
    return this.db.client.$transaction((tx) => this.statementRecord(tx, p, id), {
      isolationLevel: 'RepeatableRead',
    });
  }
  statements(p: Principal, q: CompanyListInput) {
    return this.db.client.$transaction(
      async (tx) => {
        const rows = await tx.companyStatement.findMany({
          where: { ...scope(p), companyId: q.companyId },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          ...paging(q),
        });
        const results = [];
        for (const r of rows) results.push(await this.statementRecord(tx, p, r.id));
        return page(results, q);
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }
  // A statement is an immutable document: it freezes the period's ledger lines and the
  // balance carried into and out of that period.
  generateStatement(p: Principal, input: StatementInput) {
    return this.mutate(p, input.commandId, input, 'company.statement_issued', async (tx) => {
      await this.company(tx, p, input.companyId);
      const contract = await tx.companyContract.findFirst({
        where: { ...scope(p), companyId: input.companyId, status: 'ACTIVE' },
        orderBy: [{ startDate: 'desc' }, { id: 'asc' }],
      });
      if (!contract) throw new NotFoundException('Company has no active contract');
      const start = date(input.periodStart),
        end = date(input.periodEnd),
        endExclusive = addDays(end, 1);
      if (
        await tx.companyStatement.findFirst({
          where: { ...scope(p), companyId: input.companyId, periodStart: start, periodEnd: end },
        })
      )
        throw new ConflictException('Statement for this period already exists');
      const before = await tx.companyLedgerEntry.aggregate({
        where: { ...scope(p), companyId: input.companyId, createdAt: { lt: start } },
        _sum: { amount: true },
      });
      const entries = await tx.companyLedgerEntry.findMany({
        where: {
          ...scope(p),
          companyId: input.companyId,
          createdAt: { gte: start, lt: endExclusive },
        },
        include: { employee: true, order: true },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      });
      if (!entries.length) throw new ConflictException('No account activity in this period');
      const openingBalance = before._sum.amount?.toFixed(2) ?? '0.00';
      const charges = sumMoney(
        entries.filter((e) => e.kind === 'CHARGE').map((e) => e.amount.toFixed(2)),
      );
      const payments = sumMoney(
        entries.filter((e) => e.kind !== 'CHARGE').map((e) => e.amount.toFixed(2)),
      );
      const closingBalance = sumMoney([openingBalance, charges, payments]);
      const revision = await tx.companiesRevision.update({
        where: { branchId: p.branchId },
        data: { nextNumber: { increment: 1 } },
      });
      const statement = await tx.companyStatement.create({
        data: {
          ...scope(p),
          companyId: input.companyId,
          contractId: contract.id,
          userId: p.userId,
          number: revision.nextNumber,
          periodStart: start,
          periodEnd: end,
          dueDate: addDays(end, contract.paymentTermsDays),
          currency: contract.currency,
          openingBalance,
          charges,
          payments,
          closingBalance,
        },
      });
      for (const entry of entries)
        await tx.companyStatementLine.create({
          data: {
            ...scope(p),
            statementId: statement.id,
            entryId: entry.id,
            kind: entry.kind,
            amount: entry.amount,
            orderNumber: entry.order?.orderNumber.toString() ?? null,
            employeeName: entry.employee?.name ?? null,
            reason: entry.reason,
            occurredAt: entry.createdAt,
          },
        });
      return {
        id: statement.id,
        companyId: input.companyId,
        contractId: contract.id,
        response: await this.statementRecord(tx, p, statement.id),
      };
    });
  }
  // Restricted picker for the payments workspace: identity and credit headroom only.
  async chargeable(p: Principal, q: CompanyListInput) {
    const rows = await this.db.client.company.findMany({
      where: {
        ...scope(p),
        active: true,
        deletedAt: null,
        name: { contains: q.search, mode: 'insensitive' as const },
        contracts: { some: { ...scope(p), status: 'ACTIVE' } },
      },
      include: {
        contracts: {
          where: { status: 'ACTIVE' },
          orderBy: [{ startDate: 'desc' }, { id: 'asc' }],
          take: 1,
        },
        employees: {
          where: { active: true, deletedAt: null },
          orderBy: [{ name: 'asc' }, { id: 'asc' }],
          take: 200,
        },
      },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      ...paging(q),
    });
    const balances = await this.db.client.companyLedgerEntry.groupBy({
      by: ['companyId'],
      where: { ...scope(p), companyId: { in: rows.map((r) => r.id) } },
      _sum: { amount: true },
    });
    const items = [];
    for (const row of rows) {
      // The query selects only companies holding an active contract, so the take:1 row exists.
      const contract = row.contracts.at(0);
      if (!contract) continue;
      const balance =
        balances.find((b) => b.companyId === row.id)?._sum.amount?.toFixed(2) ?? '0.00';
      const creditLimit = contract.creditLimit.toFixed(2);
      items.push({
        id: row.id,
        name: row.name,
        contractId: contract.id,
        discountPercentage: contract.discountPercentage.toFixed(2),
        creditLimit,
        balance,
        available: availableCredit(creditLimit, balance),
        employees: row.employees.map((e) => ({ id: e.id, name: e.name, code: e.code })),
      });
    }
    return page(items, q);
  }
  // Per-company history resolves the company first, so a foreign id is a 404 like every
  // other scoped read rather than an empty success.
  async history(p: Principal, companyId: string, after: string, limit: number) {
    if (!(await this.db.client.company.findFirst({ where: { ...scope(p), id: companyId } })))
      throw new NotFoundException('Company not found');
    return this.events(p, after, limit, companyId);
  }
  async events(p: Principal, after: string, limit: number, companyId?: string) {
    const rows = await this.db.client.companiesEvent.findMany({
      where: { ...scope(p), revision: { gt: BigInt(after) }, companyId },
      orderBy: { revision: 'asc' },
      take: limit + 1,
    });
    return {
      events: rows.slice(0, limit).map((r) => ({
        id: r.id,
        action: r.action,
        entityId: r.entityId,
        revision: r.revision.toString(),
        createdAt: r.createdAt.toISOString(),
        ...(companyId ? { response: r.response } : {}),
      })),
      cursor: rows.slice(0, limit).at(-1)?.revision.toString() ?? after,
      hasMore: rows.length > limit,
    };
  }
}
// Shared with the payments module: charge a company account inside the existing
// settlement transaction. Credit is enforced here and backstopped by check_company_credit.
export async function chargeCompanyAccount(
  tx: Tx,
  p: Principal,
  input: {
    companyId: string;
    employeeId: string | null;
    orderId: string;
    paymentId: string;
    amount: string;
    orderNumber: string;
  },
) {
  const company = await tx.company.findFirst({
    where: { ...scope(p), id: input.companyId, active: true, deletedAt: null },
  });
  if (!company) throw new NotFoundException('Active company not found');
  const contract = await tx.companyContract.findFirst({
    where: { ...scope(p), companyId: input.companyId, status: 'ACTIVE' },
    orderBy: [{ startDate: 'desc' }, { id: 'asc' }],
  });
  if (!contract) throw new ConflictException('Company has no active contract');
  if (input.employeeId) {
    const employee = await tx.companyEmployee.findFirst({
      where: {
        ...scope(p),
        id: input.employeeId,
        companyId: input.companyId,
        active: true,
        deletedAt: null,
      },
    });
    if (!employee) throw new ConflictException('Employee is not authorized for this company');
  }
  const sum = await tx.companyLedgerEntry.aggregate({
    where: { ...scope(p), companyId: input.companyId },
    _sum: { amount: true },
  });
  const balance = sum._sum.amount?.toFixed(2) ?? '0.00';
  if (!withinCredit(contract.creditLimit.toFixed(2), balance, input.amount))
    throw new ConflictException('Company credit limit exceeded');
  return tx.companyLedgerEntry.create({
    data: {
      ...scope(p),
      companyId: input.companyId,
      employeeId: input.employeeId,
      orderId: input.orderId,
      paymentId: input.paymentId,
      userId: p.userId,
      kind: 'CHARGE',
      amount: input.amount,
      reason: 'Company account order ' + input.orderNumber,
    },
  });
}
