'use client';
import { useI18n, serverMessage, type Translate } from '../lib/i18n';
import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  SessionUser,
  CompanyRecord,
  ContractRecord,
  CompanyEmployeeRecord,
  CompanyAccount,
  StatementRecord,
} from '@restaurant/shared-types';
import { Button } from '@restaurant/ui/button';
import { Input } from '@restaurant/ui/input';
import { api, ApiFailure } from '../lib/api';
type Page<T> = { items: T[]; hasMore: boolean };
type Pending = { path: string; method: string; body: Record<string, unknown> };
type View = 'Companies' | 'Contracts' | 'Employees' | 'Account' | 'Statements';
const label = (v: string, t?: Translate) => {
  const keys = {
    DRAFT: 'operations.statusDraft', ACTIVE: 'operations.active', EXPIRED: 'operations.statusExpired', SUSPENDED: 'operations.statusSuspended', TERMINATED: 'operations.statusTerminated',
    MONTHLY: 'operations.monthly', BIWEEKLY: 'operations.biweekly', WEEKLY: 'operations.weekly',
    CHARGE: 'operations.entryCharge', PAYMENT: 'operations.entryPayment', PAYMENT_REVERSAL: 'operations.entryPaymentReversal', CREDIT: 'operations.entryCredit',
  } as const;
  return v in keys && t ? t(keys[v as keyof typeof keys]) : v.toLowerCase().replaceAll('_', ' ');
};
const form = (e: React.FormEvent<HTMLFormElement>) => {
  e.preventDefault();
  return Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
};
async function all<T>(path: string) {
  const rows: T[] = [];
  for (let page = 1; ; page++) {
    const result = await api<Page<T>>(
      `${path}${path.includes('?') ? '&' : '?'}page=${page}&limit=100`,
    );
    rows.push(...result.items);
    if (!result.hasMore) return rows;
  }
}
export function CompaniesWorkspace({ user }: { user: SessionUser }) {
  const { t, locale } = useI18n();
  const can = (p: SessionUser['permissions'][number]) => user.permissions.includes(p),
    manage = can('company.manage'),
    contractManage = can('contract.manage'),
    recordPayment = can('company.payment.record'),
    reversePayment = can('company.payment.reverse'),
    statementManage = can('company.statement.manage');
  const [view, setView] = useState<View>('Companies');
  const [search, setSearch] = useState(''),
    [archived, setArchived] = useState(false);
  const [companies, setCompanies] = useState<CompanyRecord[]>([]),
    [contracts, setContracts] = useState<ContractRecord[]>([]),
    [employees, setEmployees] = useState<CompanyEmployeeRecord[]>([]),
    [statements, setStatements] = useState<StatementRecord[]>([]),
    [account, setAccount] = useState<CompanyAccount | null>(null);
  const [selected, setSelected] = useState(''),
    [editor, setEditor] = useState<string | null>(null);
  const [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false),
    [stale, setStale] = useState(false),
    [pending, setPending] = useState<Pending | null>(null);
  const generation = useRef(0),
    saving = useRef(false),
    key = `restaurant-companies-command:v1:${user.organizationId}:${user.branchId}:${user.id}`;
  useEffect(() => {
    const saved = sessionStorage.getItem(key);
    if (saved)
      try {
        const p = JSON.parse(saved);
        if (
          !p.path?.startsWith('companies') ||
          !['POST', 'PUT'].includes(p.method) ||
          !p.body?.commandId
        )
          throw new Error();
        setPending(p);
      } catch {
        setError('Saved company command is unreadable. Check history before another change.');
        setPending({ path: '', method: '', body: {} });
      }
  }, [key]);
  const reload = useCallback(async () => {
    const current = ++generation.current;
    setBusy(true);
    try {
      const query = `search=${encodeURIComponent(search)}&includeArchived=${archived}`;
      const rows = await all<CompanyRecord>(`companies?${query}`);
      if (current !== generation.current || saving.current) return;
      setCompanies(rows);
      const company = rows.find((c) => c.id === selected)?.id ?? rows[0]?.id ?? '';
      if (company) {
        const [c, e, s, a] = await Promise.all([
          all<ContractRecord>(`companies/directory/contracts?companyId=${company}`),
          all<CompanyEmployeeRecord>(`companies/directory/employees?companyId=${company}`),
          all<StatementRecord>(`companies/directory/statements?companyId=${company}`),
          api<CompanyAccount>(`companies/${company}/account?page=1&limit=100`),
        ]);
        if (current !== generation.current || saving.current) return;
        setContracts(c);
        setEmployees(e);
        setStatements(s);
        setAccount(a);
        if (!selected) setSelected(company);
      } else {
        setContracts([]);
        setEmployees([]);
        setStatements([]);
        setAccount(null);
      }
      setStale(false);
      setError('');
    } catch (failure) {
      if (current !== generation.current) return;
      setStale(true);
      setError(
        failure instanceof ApiFailure
          ? failure.message
          : 'Companies are unavailable. Reconnect before making changes.',
      );
    } finally {
      if (current === generation.current) setBusy(false);
    }
  }, [search, archived, selected]);
  useEffect(() => {
    void reload();
    const timer = setInterval(() => {
      if (!saving.current) void reload();
    }, 10000);
    const ref = generation;
    return () => {
      clearInterval(timer);
      ref.current++;
    };
  }, [reload]);
  const execute = useCallback(
    async (command: Pending) => {
      saving.current = true;
      generation.current++;
      setBusy(true);
      setError('');
      setNotice('');
      sessionStorage.setItem(key, JSON.stringify(command));
      setPending(command);
      try {
        await api(command.path, command.method, command.body);
        sessionStorage.removeItem(key);
        setPending(null);
        setNotice('Saved.');
        setEditor(null);
      } catch (failure) {
        if (failure instanceof ApiFailure && failure.status >= 400 && failure.status < 500) {
          sessionStorage.removeItem(key);
          setPending(null);
          setError(failure.message);
        } else
          setError(
            'The result of this change is unknown. Retry the saved command before repeating it.',
          );
      } finally {
        saving.current = false;
        setStale(true);
        setBusy(false);
        void reload();
      }
    },
    [key, reload],
  );
  const locked = busy || stale || !!pending;
  const submit = (path: string, body: Record<string, unknown>, method = 'POST') => {
    if (!locked) void execute({ path: 'companies' + path, method, body: { ...body, commandId: crypto.randomUUID() } });
  };
  const company = companies.find((c) => c.id === selected) ?? null;
  const views: View[] = ['Companies', 'Contracts', 'Employees', 'Account', 'Statements'];
  return (
    <section className="company-workspace">
      {error ? <p className="purchase-notice">{serverMessage(error, locale)}</p> : null}
      {notice ? <p className="purchase-notice">{serverMessage(notice, locale)}</p> : null}
      {pending?.path ? (
        <p className="purchase-notice">
          {t('operations.aCompanyCommandIsUnresolved')}{' '}
          <Button type="button" disabled={busy} onClick={() => void execute(pending)}>
            {t('operations.retrySavedCommand')}
          </Button>
        </p>
      ) : null}
      <div role="group" aria-label={t('operations.companyViews')} className="purchase-filters">
        {views.map((item) => (
          <Button
            key={item}
            type="button"
            variant={view === item ? 'default' : 'outline'}
            onClick={() => setView(item)}
          >
            {t(({ Companies: 'operations.companies', Contracts: 'operations.contracts', Employees: 'operations.employees', Account: 'operations.account', Statements: 'operations.statements' } as const)[item])}
          </Button>
        ))}
        <Input
          aria-label={t('operations.searchCompanies')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('operations.searchCompanies')}
        />
        <label>
          <input
            type="checkbox"
            checked={archived}
            onChange={(e) => setArchived(e.target.checked)}
          />{' '}
          {t('operations.includeArchived')}
        </label>
        <Button type="button" disabled={busy} onClick={() => void reload()}>
          {t('operations.refresh')}
        </Button>
      </div>
      <div className="purchase-grid">
        <div>
          <h2>{t('operations.companies')}</h2>
          {manage ? (
            <Button type="button" disabled={locked} onClick={() => setEditor('company')}>
              {t('operations.addCompany')}
            </Button>
          ) : null}
          {companies.length ? (
            <ul className="company-list">
              {companies.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    aria-current={c.id === selected}
                    onClick={() => setSelected(c.id)}
                  >
                    <strong>{c.name}</strong>
                    <span>{c.businessNumber || t('operations.noBusinessNumber')}</span>
                    {c.deletedAt ? <span className="stock-badge">{t('operations.archived')}</span> : null}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="purchase-empty">{t('operations.noCompaniesAreConfigured')}</p>
          )}
        </div>
        <section aria-label={t('operations.companyDetail')} className="purchase-detail">
          {!company ? (
            <p className="purchase-empty">{t('operations.selectACompany')}</p>
          ) : view === 'Companies' ? (
            <>
              <h2>{company.name}</h2>
              <dl className="purchase-totals">
                <div>
                  <dt>{t('operations.businessNumber')}</dt>
                  <dd>{company.businessNumber || '—'}</dd>
                </div>
                <div>
                  <dt>{t('operations.taxNumber')}</dt>
                  <dd>{company.taxNumber || '—'}</dd>
                </div>
                <div>
                  <dt>{t('operations.contact')}</dt>
                  <dd>{company.contactPerson || '—'}</dd>
                </div>
              </dl>
              <p>
                {company.address || '—'} · {company.phone || '—'} · {company.email || '—'}
              </p>
              {manage && !company.deletedAt ? (
                <>
                  <Button type="button" disabled={locked} onClick={() => setEditor('company-edit')}>
                    {t('operations.editCompany')}
                  </Button>
                  <Button
                    type="button"
                    disabled={locked}
                    onClick={() =>
                      submit(`/${company.id}/archive`, { version: company.version })
                    }
                  >
                    {t('operations.archive')}
                  </Button>
                </>
              ) : null}
            </>
          ) : view === 'Contracts' ? (
            <>
              <h2>{t('operations.contracts')}</h2>
              {contractManage ? (
                <Button type="button" disabled={locked} onClick={() => setEditor('contract')}>
                  {t('operations.addContract')}
                </Button>
              ) : null}
              {contracts.length ? (
                <ul className="company-list">
                  {contracts.map((c) => (
                    <li key={c.id}>
                      <strong>{c.contractNumber}</strong>
                      <span className="stock-badge">{label(c.status)}</span>
                      <span>
                        {t('operations.limit')} {c.creditLimit} {c.currency} · {c.discountPercentage}{t('operations.net')}{' '}
                        {c.paymentTermsDays} {t('operations.days')} {label(c.billingCycle)}
                      </span>
                      <span>
                        {c.startDate} → {c.endDate ?? t('operations.openEnded')}
                      </span>
                      {contractManage && c.status !== 'TERMINATED' ? (
                        <span>
                          {c.status === 'DRAFT' ? (
                            <Button
                              type="button"
                              disabled={locked}
                              onClick={() =>
                                submit(`/directory/contracts/${c.id}/status`, {
                                  version: c.version,
                                  status: 'ACTIVE',
                                  reason: 'Activated',
                                })
                              }
                            >
                              {t('operations.activate')}
                            </Button>
                          ) : null}
                          {c.status === 'ACTIVE' ? (
                            <Button
                              type="button"
                              disabled={locked}
                              onClick={() =>
                                submit(`/directory/contracts/${c.id}/status`, {
                                  version: c.version,
                                  status: 'SUSPENDED',
                                  reason: 'Suspended',
                                })
                              }
                            >
                              {t('operations.suspend')}
                            </Button>
                          ) : null}
                          <Button
                            type="button"
                            disabled={locked}
                            onClick={() =>
                              submit(`/directory/contracts/${c.id}/status`, {
                                version: c.version,
                                status: 'TERMINATED',
                                reason: 'Terminated',
                              })
                            }
                          >
                            {t('operations.terminate')}
                          </Button>
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="purchase-empty">{t('operations.thisCompanyHasNoContracts')}</p>
              )}
            </>
          ) : view === 'Employees' ? (
            <>
              <h2>{t('operations.authorizedEmployees')}</h2>
              {manage ? (
                <Button type="button" disabled={locked} onClick={() => setEditor('employee')}>
                  {t('operations.addEmployee')}
                </Button>
              ) : null}
              {employees.length ? (
                <ul className="company-list">
                  {employees.map((e) => (
                    <li key={e.id}>
                      <strong>{e.name}</strong>
                      <span>{e.code || t('operations.noCode')}</span>
                      <span>
                        {t('operations.consumed')} {e.consumedTotal} {t('operations.across')} {e.orderCount} {t('operations.orders')}
                      </span>
                      {e.deletedAt ? <span className="stock-badge">{t('operations.archived')}</span> : null}
                      {manage && !e.deletedAt ? (
                        <Button
                          type="button"
                          disabled={locked}
                          onClick={() =>
                            submit(`/directory/employees/${e.id}/archive`, { version: e.version })
                          }
                        >
                          {t('operations.archive')}
                        </Button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="purchase-empty">{t('operations.noAuthorizedEmployees')}</p>
              )}
            </>
          ) : view === 'Account' ? (
            <>
              <h2>{t('operations.account')}</h2>
              {account ? (
                <>
                  <dl className="purchase-totals">
                    <div>
                      <dt>{t('operations.balance')}</dt>
                      <dd>
                        {account.balance} {account.currency}
                      </dd>
                    </div>
                    <div>
                      <dt>{t('operations.creditLimit')}</dt>
                      <dd>{account.creditLimit}</dd>
                    </div>
                    <div>
                      <dt>{t('operations.available')}</dt>
                      <dd>{account.available}</dd>
                    </div>
                  </dl>
                  <p>
                    {t('operations.charged')} {account.charged} {t('operations.paid')} {account.paid} · {account.orderCount} {t('operations.ordersContract')} {account.contractStatus ? label(account.contractStatus) : 'none'}
                  </p>
                  {recordPayment && account.balance !== '0.00' ? (
                    <Button type="button" disabled={locked} onClick={() => setEditor('payment')}>
                      {t('operations.recordPayment')}
                    </Button>
                  ) : null}
                  {account.items.length ? (
                    <ul className="company-list">
                      {account.items.map((entry) => (
                        <li key={entry.id} className="purchase-entry">
                          <strong>{label(entry.kind)}</strong>
                          <span>{entry.amount}</span>
                          <span>
                            {entry.orderNumber ? t('operations.orderNumber', { number: entry.orderNumber }) : entry.reference}
                            {entry.employeeName ? ` · ${entry.employeeName}` : ''}
                          </span>
                          <span>{entry.reason}</span>
                          {reversePayment && entry.kind === 'PAYMENT' && !entry.reversed ? (
                            <Button
                              type="button"
                              disabled={locked}
                              onClick={() =>
                                submit(`/directory/payments/${entry.id}/reverse`, {
                                  reason: 'Recorded in error',
                                })
                              }
                            >
                              {t('operations.reverse')}
                            </Button>
                          ) : null}
                          {entry.reversed ? <span className="stock-badge">{t('operations.reversed')}</span> : null}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="purchase-empty">{t('operations.noAccountActivity')}</p>
                  )}
                </>
              ) : null}
            </>
          ) : (
            <>
              <h2>{t('operations.statements')}</h2>
              {statementManage ? (
                <Button type="button" disabled={locked} onClick={() => setEditor('statement')}>
                  {t('operations.generateStatement')}
                </Button>
              ) : null}
              {statements.length ? (
                <ul className="company-list">
                  {statements.map((s) => (
                    <li key={s.id}>
                      <strong>{t('operations.statement')} {s.number}</strong>
                      <span>
                        {s.periodStart} → {s.periodEnd} {t('operations.due')} {s.dueDate}
                      </span>
                      <span>
                        {t('operations.opening')} {s.openingBalance} {t('operations.charges')} {s.charges} {t('operations.payments')} {s.payments} {t('operations.closing')} {s.closingBalance} {s.currency}
                      </span>
                      <span>
                        {s.items.length} {t('operations.linesIssuedBy')} {s.issuedBy}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="purchase-empty">{t('operations.noStatementsHaveBeenIssued')}</p>
              )}
            </>
          )}
        </section>
      </div>
      {editor ? (
        <dialog className="purchase-dialog riza-dialog" aria-label={t('operations.companyEditor')} ref={(el) => { if (el && !el.open) el.showModal(); }}>
          <form
            onSubmit={(e) => {
              const data = form(e);
              if (editor === 'company')
                submit('', {
                  name: data.name,
                  businessNumber: data.businessNumber,
                  taxNumber: data.taxNumber,
                  address: data.address,
                  phone: data.phone,
                  email: data.email,
                  contactPerson: data.contactPerson,
                });
              else if (editor === 'company-edit' && company)
                submit(
                  `/${company.id}`,
                  {
                    name: data.name,
                    businessNumber: data.businessNumber,
                    taxNumber: data.taxNumber,
                    address: data.address,
                    phone: data.phone,
                    email: data.email,
                    contactPerson: data.contactPerson,
                    active: true,
                    version: company.version,
                  },
                  'PUT',
                );
              else if (editor === 'contract' && company)
                submit('/directory/contracts', {
                  companyId: company.id,
                  contractNumber: data.contractNumber,
                  startDate: data.startDate,
                  endDate: data.endDate || null,
                  creditLimit: data.creditLimit,
                  discountPercentage: data.discountPercentage,
                  paymentTermsDays: Number(data.paymentTermsDays),
                  billingCycle: data.billingCycle,
                  notes: data.notes,
                });
              else if (editor === 'employee' && company)
                submit('/directory/employees', {
                  companyId: company.id,
                  name: data.name,
                  code: data.code,
                  email: data.email,
                  phone: data.phone,
                });
              else if (editor === 'payment' && company)
                submit('/directory/payments', {
                  companyId: company.id,
                  amount: data.amount,
                  method: data.method,
                  reference: data.reference,
                  reason: data.reason,
                });
              else if (editor === 'statement' && company)
                submit('/directory/statements', {
                  companyId: company.id,
                  periodStart: data.periodStart,
                  periodEnd: data.periodEnd,
                });
            }}
          >
            <fieldset disabled={locked} className="purchase-form-grid">
              <legend>
                {editor === 'contract'
                  ? t('operations.contract')
                  : editor === 'employee'
                    ? t('operations.authorizedEmployee')
                    : editor === 'payment'
                      ? t('operations.recordCompanyPayment')
                      : editor === 'statement'
                        ? t('operations.generateStatement')
                        : t('operations.company')}
              </legend>
              {editor === 'company' || editor === 'company-edit' ? (
                <>
                  <label>
                    {t('operations.companyName')}
                    <Input name="name" required defaultValue={editor === 'company-edit' ? company?.name : ''} />
                  </label>
                  <label>
                    {t('operations.businessNumber')}
                    <Input name="businessNumber" defaultValue={editor === 'company-edit' ? company?.businessNumber : ''} />
                  </label>
                  <label>
                    {t('operations.taxNumber')}
                    <Input name="taxNumber" defaultValue={editor === 'company-edit' ? company?.taxNumber : ''} />
                  </label>
                  <label>
                    {t('operations.address')}
                    <Input name="address" defaultValue={editor === 'company-edit' ? company?.address : ''} />
                  </label>
                  <label>
                    {t('operations.phone')}
                    <Input name="phone" defaultValue={editor === 'company-edit' ? company?.phone : ''} />
                  </label>
                  <label>
                    {t('operations.email')}
                    <Input name="email" type="email" defaultValue={editor === 'company-edit' ? company?.email : ''} />
                  </label>
                  <label>
                    {t('operations.contactPerson')}
                    <Input name="contactPerson" defaultValue={editor === 'company-edit' ? company?.contactPerson : ''} />
                  </label>
                </>
              ) : null}
              {editor === 'contract' ? (
                <>
                  <label>
                    {t('operations.contractNumber')}
                    <Input name="contractNumber" required />
                  </label>
                  <label>
                    {t('operations.startDate')}
                    <Input name="startDate" type="date" required />
                  </label>
                  <label>
                    {t('operations.endDate')}
                    <Input name="endDate" type="date" />
                  </label>
                  <label>
                    {t('operations.creditLimit')}
                    <Input name="creditLimit" required defaultValue="0.00" />
                  </label>
                  <label>
                    {t('operations.discountPercentage')}
                    <Input name="discountPercentage" required defaultValue="0.00" />
                  </label>
                  <label>
                    {t('operations.paymentTermsDays')}
                    <Input name="paymentTermsDays" type="number" required defaultValue="30" />
                  </label>
                  <label>
                    {t('operations.billingCycle')}
                    <select name="billingCycle" defaultValue="MONTHLY">
                      <option value="MONTHLY">{t('operations.monthly')}</option>
                      <option value="BIWEEKLY">{t('operations.biweekly')}</option>
                      <option value="WEEKLY">{t('operations.weekly')}</option>
                    </select>
                  </label>
                  <label>
                    {t('operations.notes')}
                    <Input name="notes" />
                  </label>
                </>
              ) : null}
              {editor === 'employee' ? (
                <>
                  <label>
                    {t('operations.employeeName')}
                    <Input name="name" required />
                  </label>
                  <label>
                    {t('operations.code')}
                    <Input name="code" />
                  </label>
                  <label>
                    {t('operations.email')}
                    <Input name="email" type="email" />
                  </label>
                  <label>
                    {t('operations.phone')}
                    <Input name="phone" />
                  </label>
                </>
              ) : null}
              {editor === 'payment' ? (
                <>
                  <label>
                    {t('operations.amount2')}
                    <Input name="amount" required />
                  </label>
                  <label>
                    {t('operations.method')}
                    <select name="method" defaultValue="BANK_TRANSFER">
                      <option value="BANK_TRANSFER">{t('operations.bankTransfer2')}</option>
                      <option value="CASH">{t('operations.cash')}</option>
                      <option value="CARD">{t('operations.card')}</option>
                      <option value="OTHER">{t('operations.other2')}</option>
                    </select>
                  </label>
                  <label>
                    {t('operations.reference2')}
                    <Input name="reference" required />
                  </label>
                  <label>
                    {t('operations.reason')}
                    <Input name="reason" required defaultValue="Company account settlement" />
                  </label>
                </>
              ) : null}
              {editor === 'statement' ? (
                <>
                  <label>
                    {t('operations.periodStart')}
                    <Input name="periodStart" type="date" required />
                  </label>
                  <label>
                    {t('operations.periodEnd')}
                    <Input name="periodEnd" type="date" required />
                  </label>
                </>
              ) : null}
            </fieldset>
            <div className="purchase-filters">
              <Button type="submit" disabled={locked}>
                {t('operations.save')}
              </Button>
              <Button type="button" onClick={() => setEditor(null)}>
                {t('operations.cancel')}
              </Button>
            </div>
          </form>
        </dialog>
      ) : null}
    </section>
  );
}
