'use client';
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
const label = (v: string) => v.toLowerCase().replaceAll('_', ' ');
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
      {error ? <p className="purchase-notice">{error}</p> : null}
      {notice ? <p className="purchase-notice">{notice}</p> : null}
      {pending?.path ? (
        <p className="purchase-notice">
          A company command is unresolved.{' '}
          <Button type="button" disabled={busy} onClick={() => void execute(pending)}>
            Retry saved command
          </Button>
        </p>
      ) : null}
      <div role="group" aria-label="Company views" className="purchase-filters">
        {views.map((item) => (
          <Button
            key={item}
            type="button"
            variant={view === item ? 'default' : 'outline'}
            onClick={() => setView(item)}
          >
            {item}
          </Button>
        ))}
        <Input
          aria-label="Search companies"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search companies"
        />
        <label>
          <input
            type="checkbox"
            checked={archived}
            onChange={(e) => setArchived(e.target.checked)}
          />{' '}
          Include archived
        </label>
        <Button type="button" disabled={busy} onClick={() => void reload()}>
          Refresh
        </Button>
      </div>
      <div className="purchase-grid">
        <div>
          <h2>Companies</h2>
          {manage ? (
            <Button type="button" disabled={locked} onClick={() => setEditor('company')}>
              Add company
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
                    <span>{c.businessNumber || 'No business number'}</span>
                    {c.deletedAt ? <span className="stock-badge">Archived</span> : null}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="purchase-empty">No companies are configured.</p>
          )}
        </div>
        <section aria-label="Company detail" className="purchase-detail">
          {!company ? (
            <p className="purchase-empty">Select a company.</p>
          ) : view === 'Companies' ? (
            <>
              <h2>{company.name}</h2>
              <dl className="purchase-totals">
                <div>
                  <dt>Business number</dt>
                  <dd>{company.businessNumber || '—'}</dd>
                </div>
                <div>
                  <dt>Tax number</dt>
                  <dd>{company.taxNumber || '—'}</dd>
                </div>
                <div>
                  <dt>Contact</dt>
                  <dd>{company.contactPerson || '—'}</dd>
                </div>
              </dl>
              <p>
                {company.address || '—'} · {company.phone || '—'} · {company.email || '—'}
              </p>
              {manage && !company.deletedAt ? (
                <>
                  <Button type="button" disabled={locked} onClick={() => setEditor('company-edit')}>
                    Edit company
                  </Button>
                  <Button
                    type="button"
                    disabled={locked}
                    onClick={() =>
                      submit(`/${company.id}/archive`, { version: company.version })
                    }
                  >
                    Archive
                  </Button>
                </>
              ) : null}
            </>
          ) : view === 'Contracts' ? (
            <>
              <h2>Contracts</h2>
              {contractManage ? (
                <Button type="button" disabled={locked} onClick={() => setEditor('contract')}>
                  Add contract
                </Button>
              ) : null}
              {contracts.length ? (
                <ul className="company-list">
                  {contracts.map((c) => (
                    <li key={c.id}>
                      <strong>{c.contractNumber}</strong>
                      <span className="stock-badge">{label(c.status)}</span>
                      <span>
                        Limit {c.creditLimit} {c.currency} · {c.discountPercentage}% · net{' '}
                        {c.paymentTermsDays} days · {label(c.billingCycle)}
                      </span>
                      <span>
                        {c.startDate} → {c.endDate ?? 'open'}
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
                              Activate
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
                              Suspend
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
                            Terminate
                          </Button>
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="purchase-empty">This company has no contracts.</p>
              )}
            </>
          ) : view === 'Employees' ? (
            <>
              <h2>Authorized employees</h2>
              {manage ? (
                <Button type="button" disabled={locked} onClick={() => setEditor('employee')}>
                  Add employee
                </Button>
              ) : null}
              {employees.length ? (
                <ul className="company-list">
                  {employees.map((e) => (
                    <li key={e.id}>
                      <strong>{e.name}</strong>
                      <span>{e.code || 'No code'}</span>
                      <span>
                        Consumed {e.consumedTotal} across {e.orderCount} orders
                      </span>
                      {e.deletedAt ? <span className="stock-badge">Archived</span> : null}
                      {manage && !e.deletedAt ? (
                        <Button
                          type="button"
                          disabled={locked}
                          onClick={() =>
                            submit(`/directory/employees/${e.id}/archive`, { version: e.version })
                          }
                        >
                          Archive
                        </Button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="purchase-empty">No authorized employees.</p>
              )}
            </>
          ) : view === 'Account' ? (
            <>
              <h2>Account</h2>
              {account ? (
                <>
                  <dl className="purchase-totals">
                    <div>
                      <dt>Balance</dt>
                      <dd>
                        {account.balance} {account.currency}
                      </dd>
                    </div>
                    <div>
                      <dt>Credit limit</dt>
                      <dd>{account.creditLimit}</dd>
                    </div>
                    <div>
                      <dt>Available</dt>
                      <dd>{account.available}</dd>
                    </div>
                  </dl>
                  <p>
                    Charged {account.charged} · paid {account.paid} · {account.orderCount} orders ·
                    contract {account.contractStatus ? label(account.contractStatus) : 'none'}
                  </p>
                  {recordPayment && account.balance !== '0.00' ? (
                    <Button type="button" disabled={locked} onClick={() => setEditor('payment')}>
                      Record payment
                    </Button>
                  ) : null}
                  {account.items.length ? (
                    <ul className="company-list">
                      {account.items.map((entry) => (
                        <li key={entry.id} className="purchase-entry">
                          <strong>{label(entry.kind)}</strong>
                          <span>{entry.amount}</span>
                          <span>
                            {entry.orderNumber ? `Order ${entry.orderNumber}` : entry.reference}
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
                              Reverse
                            </Button>
                          ) : null}
                          {entry.reversed ? <span className="stock-badge">Reversed</span> : null}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="purchase-empty">No account activity.</p>
                  )}
                </>
              ) : null}
            </>
          ) : (
            <>
              <h2>Statements</h2>
              {statementManage ? (
                <Button type="button" disabled={locked} onClick={() => setEditor('statement')}>
                  Generate statement
                </Button>
              ) : null}
              {statements.length ? (
                <ul className="company-list">
                  {statements.map((s) => (
                    <li key={s.id}>
                      <strong>Statement {s.number}</strong>
                      <span>
                        {s.periodStart} → {s.periodEnd} · due {s.dueDate}
                      </span>
                      <span>
                        Opening {s.openingBalance} · charges {s.charges} · payments {s.payments} ·
                        closing {s.closingBalance} {s.currency}
                      </span>
                      <span>
                        {s.items.length} lines · issued by {s.issuedBy}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="purchase-empty">No statements have been issued.</p>
              )}
            </>
          )}
        </section>
      </div>
      {editor ? (
        <dialog className="purchase-dialog riza-dialog" aria-label="Company editor" ref={(el) => { if (el && !el.open) el.showModal(); }}>
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
                  ? 'Contract'
                  : editor === 'employee'
                    ? 'Authorized employee'
                    : editor === 'payment'
                      ? 'Record company payment'
                      : editor === 'statement'
                        ? 'Generate statement'
                        : 'Company'}
              </legend>
              {editor === 'company' || editor === 'company-edit' ? (
                <>
                  <label>
                    Company name
                    <Input name="name" required defaultValue={editor === 'company-edit' ? company?.name : ''} />
                  </label>
                  <label>
                    Business number
                    <Input name="businessNumber" defaultValue={editor === 'company-edit' ? company?.businessNumber : ''} />
                  </label>
                  <label>
                    Tax number
                    <Input name="taxNumber" defaultValue={editor === 'company-edit' ? company?.taxNumber : ''} />
                  </label>
                  <label>
                    Address
                    <Input name="address" defaultValue={editor === 'company-edit' ? company?.address : ''} />
                  </label>
                  <label>
                    Phone
                    <Input name="phone" defaultValue={editor === 'company-edit' ? company?.phone : ''} />
                  </label>
                  <label>
                    Email
                    <Input name="email" type="email" defaultValue={editor === 'company-edit' ? company?.email : ''} />
                  </label>
                  <label>
                    Contact person
                    <Input name="contactPerson" defaultValue={editor === 'company-edit' ? company?.contactPerson : ''} />
                  </label>
                </>
              ) : null}
              {editor === 'contract' ? (
                <>
                  <label>
                    Contract number
                    <Input name="contractNumber" required />
                  </label>
                  <label>
                    Start date
                    <Input name="startDate" type="date" required />
                  </label>
                  <label>
                    End date
                    <Input name="endDate" type="date" />
                  </label>
                  <label>
                    Credit limit
                    <Input name="creditLimit" required defaultValue="0.00" />
                  </label>
                  <label>
                    Discount percentage
                    <Input name="discountPercentage" required defaultValue="0.00" />
                  </label>
                  <label>
                    Payment terms (days)
                    <Input name="paymentTermsDays" type="number" required defaultValue="30" />
                  </label>
                  <label>
                    Billing cycle
                    <select name="billingCycle" defaultValue="MONTHLY">
                      <option value="MONTHLY">MONTHLY</option>
                      <option value="BIWEEKLY">BIWEEKLY</option>
                      <option value="WEEKLY">WEEKLY</option>
                    </select>
                  </label>
                  <label>
                    Notes
                    <Input name="notes" />
                  </label>
                </>
              ) : null}
              {editor === 'employee' ? (
                <>
                  <label>
                    Employee name
                    <Input name="name" required />
                  </label>
                  <label>
                    Code
                    <Input name="code" />
                  </label>
                  <label>
                    Email
                    <Input name="email" type="email" />
                  </label>
                  <label>
                    Phone
                    <Input name="phone" />
                  </label>
                </>
              ) : null}
              {editor === 'payment' ? (
                <>
                  <label>
                    Amount
                    <Input name="amount" required />
                  </label>
                  <label>
                    Method
                    <select name="method" defaultValue="BANK_TRANSFER">
                      <option value="BANK_TRANSFER">BANK_TRANSFER</option>
                      <option value="CASH">CASH</option>
                      <option value="CARD">CARD</option>
                      <option value="OTHER">OTHER</option>
                    </select>
                  </label>
                  <label>
                    Reference
                    <Input name="reference" required />
                  </label>
                  <label>
                    Reason
                    <Input name="reason" required defaultValue="Company account settlement" />
                  </label>
                </>
              ) : null}
              {editor === 'statement' ? (
                <>
                  <label>
                    Period start
                    <Input name="periodStart" type="date" required />
                  </label>
                  <label>
                    Period end
                    <Input name="periodEnd" type="date" required />
                  </label>
                </>
              ) : null}
            </fieldset>
            <div className="purchase-filters">
              <Button type="submit" disabled={locked}>
                Save
              </Button>
              <Button type="button" onClick={() => setEditor(null)}>
                Cancel
              </Button>
            </div>
          </form>
        </dialog>
      ) : null}
    </section>
  );
}
