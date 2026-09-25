'use client';

import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import type { PermissionKey, SessionUser } from '@restaurant/shared-types';
import { PERMISSIONS } from '@restaurant/shared-types';
import { Button } from '@restaurant/ui/button';
import { Input } from '@restaurant/ui/input';
import { Label } from '@restaurant/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@restaurant/ui/table';
import { api, ApiFailure, login, logout, refresh } from '../lib/api';
import { formatDateTime, serverMessage, useI18n, type Locale, type MessageKey, type Translate } from '../lib/i18n';
import { LanguageSwitcher } from './language-switcher';
import { MenuCatalog } from './menu-catalog';
import { RestaurantLayout } from './restaurant-layout';
import { OrdersWorkspace } from './orders-workspace';
import { KitchenDisplay } from './kitchen-display';
import { Brand, NavIcon } from './riza-ui';
import { CompaniesWorkspace } from './companies-workspace';
import { SyncIndicator } from './sync-indicator';
import { DashboardWorkspace } from './dashboard-workspace';
import { WaiterApp } from './waiter-app';
import { PurchasingWorkspace } from './purchasing-workspace';
import { InventoryWorkspace } from './inventory-workspace';
import { PaymentsWorkspace } from './payments-workspace';
import { DevicesWorkspace } from './devices-workspace';

type Tab =
  | 'Workspace'
  | 'POS'
  | 'Team'
  | 'Roles'
  | 'Terminals'
  | 'Audit history'
  | 'Menu'
  | 'Layout'
  | 'Orders'
  | 'Kitchen'
  | 'Payments'
  | 'Inventory'
  | 'Purchasing'
  | 'Companies'
  | 'Devices'
  | 'Dashboard';
const roleLabels: Record<string, MessageKey> = {
  OWNER: 'role.OWNER', ADMIN: 'role.ADMIN', MANAGER: 'role.MANAGER',
  CASHIER: 'role.CASHIER', WAITER: 'role.WAITER', KITCHEN: 'role.KITCHEN', STOREKEEPER: 'role.STOREKEEPER',
};
const roleLabel = (name: string, t: Translate) => roleLabels[name] ? t(roleLabels[name]!) : name;

interface Role {
  id: string;
  name: string;
  protected: boolean;
  permissions: { permissionKey: PermissionKey }[];
}
interface Member {
  active: boolean;
  user: { id: string; name: string; email: string; active: boolean };
  roles: { role: { id: string; name: string } }[];
}
interface Terminal {
  id: string;
  name: string;
  type: string;
  active: boolean;
  lastSeenAt: string | null;
}
interface AuditRow {
  id: string;
  createdAt: string;
  action: string;
  entityType: string;
  entityId: string | null;
  userId: string | null;
}
const terminalLabels: Record<string, MessageKey> = {
  POS: 'terminal.POS', KDS: 'terminal.KDS', WAITER: 'terminal.WAITER',
  ADMIN: 'terminal.ADMIN', OWNER: 'terminal.OWNER', KIOSK: 'terminal.KIOSK',
};
function Field({
  label,
  name,
  type = 'text',
  autoComplete,
  minLength,
}: {
  label: string;
  name: string;
  type?: string;
  autoComplete?: string;
  minLength?: number;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={name}>{label}</Label>
      <Input
        id={name}
        data-testid={`field-${name}`}
        name={name}
        type={type}
        autoComplete={autoComplete}
        minLength={minLength}
        required
      />
    </div>
  );
}
function Notice({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="rounded-md border border-destructive p-3 text-sm text-destructive">
      {children}
    </p>
  );
}
/**
 * Errors are stored raw and rendered through this, so switching language also
 * re-renders any error already on screen rather than leaving it in the old one.
 */
function message(error: unknown, t: Translate, locale: Locale) {
  return error instanceof ApiFailure
    ? serverMessage(error.message, locale)
    : t('session.unreachable');
}

export function FoundationApp({
  kitchenOnly = false,
  waiterOnly = false,
}: {
  kitchenOnly?: boolean;
  waiterOnly?: boolean;
}) {
  const { t, locale } = useI18n();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [pending, setPending] = useState(false);
  const restore = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setUser((await refresh()).user);
    } catch (error) {
      if (!(error instanceof ApiFailure && error.status === 401)) setError(error);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void restore();
  }, [restore]);
  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError(null);
    try {
      setUser((await login(Object.fromEntries(form))).user);
    } catch (error) {
      setError(error);
    } finally {
      setPending(false);
    }
  }
  async function signOut() {
    setPending(true);
    setError(null);
    try {
      await logout();
      setUser(null);
    } catch (error) {
      setError(error);
    } finally {
      setPending(false);
    }
  }
  if (loading)
    return (
      <main className="flex min-h-screen items-center justify-center">
        <p role="status">{t('session.connecting')}</p>
      </main>
    );
  if (user && kitchenOnly)
    return (
      <div className="min-h-screen p-4 md:p-8">
        <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold">{t('kitchen.displayTitle')}</h1>
            <p>
              {user.branchName} · {user.name}
            </p>
          </div>
          <div className="flex items-center gap-4">
            <LanguageSwitcher />
            <Button variant="outline" onClick={() => void signOut()} disabled={pending}>
              {t('shell.signOut')}
            </Button>
          </div>
        </header>
        {error ? <Notice>{message(error, t, locale)}</Notice> : null}
        {user.permissions.includes('kitchen.read') ? (
          <KitchenDisplay user={user} />
        ) : (
          <Notice>{t('kitchen.noAccess')}</Notice>
        )}
      </div>
    );
  if (user && waiterOnly)
    return (
      <div className="min-h-screen">
        <div className="waiter-shell">
          <header className="waiter-header">
            <Brand />
            <div className="flex items-center gap-3">
              <LanguageSwitcher />
              <Button variant="outline" onClick={() => void signOut()} disabled={pending}>
                {t('shell.signOut')}
              </Button>
            </div>
          </header>
          <p className="text-sm text-muted-foreground">
            {user.branchName} · {user.name}
          </p>
          {error ? <Notice>{message(error, t, locale)}</Notice> : null}
          {user.permissions.includes('order.read') ? (
            <WaiterApp user={user} />
          ) : (
            <Notice>{t('waiter.noAccess')}</Notice>
          )}
        </div>
      </div>
    );
  if (user)
    return (
      <Workspace
        user={user}
        onLogout={() => void signOut()}
        pending={pending}
        sessionError={error ? message(error, t, locale) : ''}
      />
    );
  return (
    <main className="grid min-h-screen lg:grid-cols-2">
      <section className="riza-login flex flex-col justify-between px-8 py-10 lg:p-16">
        <Brand />
        <div className="my-12 max-w-lg">
          <h1 className="text-4xl font-semibold leading-tight lg:text-5xl">
            {t('login.headline1')}
            <br />
            {t('login.headline2')}
          </h1>
          <p className="mt-5 text-lg leading-relaxed">
            {t('login.intro')}
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <p className="text-sm">{t('login.network')}</p>
          {/* Offered before sign-in: whoever is at the terminal should be able to
              read the login form in their own language. */}
          <LanguageSwitcher />
        </div>
      </section>
      <section className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-md">
          <h2 className="text-3xl font-semibold tracking-tight">{t('login.title')}</h2>
          <p className="mb-8 mt-3 text-muted-foreground">
            {t('login.subtitle')}
          </p>
          {error ? (
            <div className="mb-5">
              <Notice>{message(error, t, locale)}</Notice>
            </div>
          ) : null}
          <form onSubmit={(event) => void signIn(event)} className="flex flex-col gap-5">
            <div className="grid grid-cols-2 gap-4">
              <Field label={t('login.organization')} name="organization" autoComplete="off" />
              <Field label={t('login.branch')} name="branch" autoComplete="off" />
            </div>
            <Field label={t('login.email')} name="email" type="email" autoComplete="username" />
            <Field
              label={t('login.password')}
              name="password"
              type="password"
              autoComplete="current-password"
            />
            <Button type="submit" size="lg" disabled={pending} data-testid="login-submit">
              {pending ? t('login.pending') : t('action.signIn')}
            </Button>
          </form>
          <p className="mt-6 text-sm leading-relaxed text-muted-foreground">
            {t('login.help')}
          </p>
        </div>
      </section>
    </main>
  );
}

function Workspace({
  user,
  onLogout,
  pending,
  sessionError,
}: {
  user: SessionUser;
  onLogout: () => void;
  pending: boolean;
  sessionError: string;
}) {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>('Workspace');
  const [paymentOrder, setPaymentOrder] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('CASH');
  // The Tab union is an identifier: it drives state, NavIcon lookup and render
  // guards. Only its presentation is translated, so nothing downstream shifts.
  const navKeys: Record<Tab, MessageKey> = {
    Workspace: 'nav.workspace',
    Dashboard: 'nav.dashboard',
    POS: 'nav.pos',
    Inventory: 'nav.inventory',
    Purchasing: 'nav.purchasing',
    Companies: 'nav.companies',
    Menu: 'nav.menu',
    Layout: 'nav.layout',
    Orders: 'nav.orders',
    Kitchen: 'nav.kitchen',
    Payments: 'nav.payments',
    Team: 'nav.team',
    Roles: 'nav.roles',
    Terminals: 'nav.terminals',
    Devices: 'nav.devices',
    'Audit history': 'nav.audit',
  };
  const hintKeys: Record<Tab, MessageKey> = {
    Workspace: 'tab.workspace.hint',
    Dashboard: 'tab.dashboard.hint',
    POS: 'tab.pos.hint',
    Inventory: 'tab.inventory.hint',
    Purchasing: 'tab.purchasing.hint',
    Companies: 'tab.companies.hint',
    Menu: 'tab.menu.hint',
    Layout: 'tab.layout.hint',
    Orders: 'tab.orders.hint',
    Kitchen: 'tab.kitchen.hint',
    Payments: 'tab.payments.hint',
    Team: 'tab.team.hint',
    Roles: 'tab.roles.hint',
    Terminals: 'tab.terminals.hint',
    Devices: 'tab.devices.hint',
    'Audit history': 'tab.audit.hint',
  };
  const can = (permission: PermissionKey) => user.permissions.includes(permission);
  const tabs: Tab[] = [
    'Workspace',
    ...(can('report.read') ? ['Dashboard' as const] : []),
    ...(can('order.read') ? ['POS' as const] : []),
    ...(can('inventory.read') ? ['Inventory' as const] : []),
    ...(can('purchase.read') || can('supplier.read') ? ['Purchasing' as const] : []),
    ...(can('company.read') ? ['Companies' as const] : []),
    ...(can('menu.read') ? ['Menu' as const] : []),
    ...(can('layout.read') ? ['Layout' as const] : []),
    ...(can('order.read') ? ['Orders' as const] : []),
    ...(can('kitchen.read') ? ['Kitchen' as const] : []),
    ...(can('payment.read') || can('cash.shift.read') ? ['Payments' as const] : []),
    ...(can('user.read') ? ['Team' as const] : []),
    ...(can('role.read') ? ['Roles' as const] : []),
    ...(can('terminal.read') ? ['Terminals' as const] : []),
    ...(can('device.read') ? ['Devices' as const] : []),
    ...(can('audit.read') ? ['Audit history' as const] : []),
  ];
  return (
    <div className="min-h-screen">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b bg-card px-6 py-4 lg:px-10">
        <div>
          <Brand />
          <p className="mt-1 text-sm text-muted-foreground">{user.branchName}</p>
        </div>
        <div className="flex items-center gap-5">
          <SyncIndicator user={user} />
          <LanguageSwitcher />
          <div className="text-right">
            <p className="font-medium">{user.name}</p>
            <p className="text-sm text-muted-foreground">{user.email}</p>
          </div>
          <Button variant="outline" disabled={pending} onClick={onLogout}>
            {t('shell.signOut')}
          </Button>
        </div>
      </header>
      <div className="riza-shell">
        <nav aria-label={t('shell.administration')} className="riza-nav">
          {tabs.map((item) => (
            <Button
              key={item}
              data-testid={`nav-${item.toLowerCase().replaceAll(' ', '-')}`}
              variant={tab === item ? 'secondary' : 'ghost'}
              className="shrink-0 justify-start gap-3"
              aria-current={tab === item ? 'page' : undefined}
              onClick={() => {
                setTab(item);
                setPaymentOrder('');
              }}
            >
              <NavIcon name={item} />
              {t(navKeys[item])}
            </Button>
          ))}
        </nav>
        <main className="riza-main">
          {sessionError ? <Notice>{sessionError}</Notice> : null}
          <h1 className={tab === 'POS' ? 'sr-only' : 'mb-2 text-3xl font-semibold tracking-tight'}>
            {t(navKeys[tab])}
          </h1>
          <p className={tab === 'POS' ? 'sr-only' : 'mb-6 text-sm text-muted-foreground'}>
            {t(hintKeys[tab])}
          </p>
          {tab === 'Workspace' ? (
            <>
              <div className="riza-home-grid">
                {tabs
                  .filter((item) =>
                    [
                      'Dashboard',
                      'POS',
                      'Orders',
                      'Layout',
                      'Kitchen',
                      'Menu',
                      'Payments',
                      'Inventory',
                      'Purchasing',
                      'Companies',
                    ].includes(item),
                  )
                  .map((item) => (
                    <button key={item} className="riza-home-card" onClick={() => setTab(item)}>
                      <NavIcon name={item} />
                      <strong>{t(navKeys[item])}</strong>
                      <span>
                        {t('home.openWorkspace')} <span aria-hidden="true">↗</span>
                      </span>
                    </button>
                  ))}
              </div>
              <Overview user={user} />
            </>
          ) : null}
          {tab === 'Dashboard' ? <DashboardWorkspace user={user} /> : null}
          {tab === 'Companies' ? <CompaniesWorkspace user={user} /> : null}
          {tab === 'Purchasing' ? <PurchasingWorkspace user={user} /> : null}
          {tab === 'Inventory' ? <InventoryWorkspace user={user} /> : null}
          {tab === 'Menu' ? <MenuCatalog canManage={can('menu.manage')} /> : null}
          {tab === 'Devices' ? <DevicesWorkspace user={user} /> : null}
          {tab === 'POS' ? (
            <OrdersWorkspace
              user={user}
              view="pos"
              onPayment={(id, method) => {
                setPaymentOrder(id);
                setPaymentMethod(method);
                setTab('Payments');
              }}
            />
          ) : null}
          {tab === 'Orders' ? <OrdersWorkspace user={user} /> : null}
          {tab === 'Kitchen' ? <KitchenDisplay user={user} /> : null}
          {tab === 'Payments' ? (
            <PaymentsWorkspace
              user={user}
              initialOrderId={paymentOrder}
              initialMethod={paymentMethod}
            />
          ) : null}
          {tab === 'Layout' ? (
            <RestaurantLayout
              canManage={can('layout.manage')}
              canStatus={can('layout.status.manage')}
            />
          ) : null}
          {tab === 'Team' ? <Team user={user} /> : null}
          {tab === 'Roles' ? <Roles user={user} /> : null}
          {tab === 'Terminals' ? <Terminals user={user} /> : null}
          {tab === 'Audit history' ? <AuditHistory /> : null}
        </main>
      </div>
    </div>
  );
}
function Overview({ user }: { user: SessionUser }) {
  const { t } = useI18n();
  return (
    <section className="rounded-lg border bg-card p-6">
      <h2 className="text-xl font-semibold">{user.branchName}</h2>
      <dl className="mt-6 grid gap-6 sm:grid-cols-2">
        <div>
          <dt className="text-sm text-muted-foreground">{t('overview.signedInAs')}</dt>
          <dd className="mt-1 font-medium">{user.name}</dd>
        </div>
        <div>
          <dt className="text-sm text-muted-foreground">{t('overview.access')}</dt>
          <dd className="mt-1">
            {user.permissions.length
              ? t('roles.assigned', { count: user.permissions.length })
              : t('overview.accountOnly')}
          </dd>
        </div>
      </dl>
      <div className="mt-8 border-t pt-6">
        <h3 className="font-medium">{t('overview.availablePermissions')}</h3>
        {user.permissions.length ? (
          <ul className="mt-3 grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">
            {user.permissions.map((permission) => (
              <li key={permission} title={permission}>{t(permission)}</li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">
            {t('overview.pendingAccess')}
          </p>
        )}
      </div>
    </section>
  );
}
function useRows<T>(path: string, enabled = true) {
  const [rows, setRows] = useState<T[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const reload = useCallback(async () => {
    if (!enabled) {
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setRows(await api<T[]>(path));
    } catch (error) {
      setError(error);
    } finally {
      setLoading(false);
    }
  }, [path, enabled]);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { rows, error, setError, loading, reload };
}
function Team({ user }: { user: SessionUser }) {
  const { t, locale } = useI18n();
  const list = useRows<Member>('users');
  const roles = useRows<Role>('roles', user.permissions.includes('role.read'));
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState('');
  const canManage = user.permissions.includes('user.manage');
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setBusy(true);
    list.setError(null);
    setSuccess('');
    try {
      await api('users', 'POST', {
        name: data.get('name'),
        email: data.get('email'),
        password: data.get('password'),
        roleIds: [data.get('role')],
      });
      form.reset();
      await list.reload();
      setSuccess('Team member created.');
    } catch (error) {
      list.setError(error);
    } finally {
      setBusy(false);
    }
  }
  async function toggle(member: Member) {
    setBusy(true);
    try {
      await api(`users/${member.user.id}/access`, 'PATCH', { active: !member.active });
      await list.reload();
    } catch (error) {
      list.setError(error);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex flex-col gap-6">
      {list.error || roles.error ? (
        <Notice>{message(list.error || roles.error, t, locale)}</Notice>
      ) : null}
      {success ? <p role="status">{serverMessage(success, locale)}</p> : null}
      {canManage && user.permissions.includes('role.read') ? (
        <form
          onSubmit={(event) => void create(event)}
          className="grid gap-4 rounded-lg border bg-card p-5 sm:grid-cols-2"
        >
          <Field label={t('team.fullName')} name="name" autoComplete="off" />
          <Field label={t('team.emailAddress')} name="email" type="email" autoComplete="off" />
          <Field
            label={t('team.initialPassword')}
            name="password"
            type="password"
            minLength={12}
            autoComplete="new-password"
          />
          <div className="flex flex-col gap-2">
            <Label htmlFor="role">{t('team.role')}</Label>
            <select id="role" name="role" required defaultValue="">
              <option value="" disabled>
                {t('team.selectRole')}
              </option>
              {roles.rows
                .filter((role) => !role.protected)
                .map((role) => (
                  <option key={role.id} value={role.id}>
                    {roleLabel(role.name, t)}
                  </option>
                ))}
            </select>
          </div>
          <div>
            <Button disabled={busy || roles.loading} type="submit">
              {t('team.addTeamMember')}
            </Button>
          </div>
        </form>
      ) : null}
      {list.loading ? (
        <p role="status">{t('team.loading')}</p>
      ) : (
        <div className="rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('team.colName')}</TableHead>
                <TableHead>{t('team.colRole')}</TableHead>
                <TableHead>{t('team.colAccess')}</TableHead>
                <TableHead>{t('team.colAction')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.rows.map((member) => (
                <TableRow key={member.user.id}>
                  <TableCell>
                    <p className="font-medium">{member.user.name}</p>
                    <p className="mt-1 text-muted-foreground">{member.user.email}</p>
                  </TableCell>
                  <TableCell>{member.roles.map((r) => roleLabel(r.role.name, t)).join(', ')}</TableCell>
                  <TableCell>{member.active ? t('common.active') : t('team.disabled')}</TableCell>
                  <TableCell>
                    {canManage &&
                    member.user.id !== user.id &&
                    !member.roles.some((r) => r.role.name === 'OWNER') ? (
                      <Button variant="outline" disabled={busy} onClick={() => void toggle(member)}>
                        {member.active ? t('team.disableAccess') : t('team.enableAccess')}
                      </Button>
                    ) : (
                      '—'
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <p className="text-sm text-muted-foreground">
        {t('team.limitHint')}
      </p>
    </div>
  );
}
function Roles({ user }: { user: SessionUser }) {
  const { t, locale } = useI18n();
  const list = useRows<Role>('roles');
  const [selected, setSelected] = useState('');
  const [permissions, setPermissions] = useState<PermissionKey[]>([]);
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState('');
  const role = list.rows.find((item) => item.id === selected);
  const canEdit = user.permissions.includes('role.manage') && !role?.protected;
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setBusy(true);
    setSuccess('');
    list.setError(null);
    try {
      if (role) await api(`roles/${role.id}/permissions`, 'PATCH', { permissions });
      else await api('roles', 'POST', { name: new FormData(form).get('roleName'), permissions });
      await list.reload();
      setSuccess('Role permissions saved.');
    } catch (error) {
      list.setError(error);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex flex-col gap-5">
      {list.error ? <Notice>{message(list.error, t, locale)}</Notice> : null}
      {success ? <p role="status">{serverMessage(success, locale)}</p> : null}
      <form
        onSubmit={(event) => void save(event)}
        className="flex flex-col gap-5 rounded-lg border bg-card p-6"
      >
        <div className="flex flex-col gap-2">
          <Label htmlFor="role-editor">{t('roles.role')}</Label>
          <select
            id="role-editor"
            value={selected}
            onChange={(event) => {
              const next = list.rows.find((r) => r.id === event.target.value);
              setSelected(event.target.value);
              setPermissions(next?.permissions.map((p) => p.permissionKey) ?? []);
              setSuccess('');
            }}
          >
            <option value="">{t('roles.createNew')}</option>
            {list.rows.map((r) => (
              <option key={r.id} value={r.id}>
                {roleLabel(r.name, t)}
              </option>
            ))}
          </select>
        </div>
        {!role ? <Field label={t('roles.roleName')} name="roleName" /> : null}
        <fieldset disabled={!canEdit || busy}>
          <legend className="mb-3 font-medium">{t('roles.permissionsLegend')}</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            {PERMISSIONS.map((key) => (
              <label key={key} className="flex min-h-11 items-center gap-3">
                <input
                  type="checkbox"
                  data-testid={`permission-${key}`}
                  checked={permissions.includes(key)}
                  disabled={!user.permissions.includes(key)}
                  onChange={(event) =>
                    setPermissions(
                      event.target.checked
                        ? [...permissions, key]
                        : permissions.filter((p) => p !== key),
                    )
                  }
                />
                <span className="text-sm" title={key}>{t(key)}</span>
              </label>
            ))}
          </div>
        </fieldset>
        {role?.protected ? (
          <p className="text-sm text-muted-foreground">
            {t('roles.protectedHint')}
          </p>
        ) : canEdit ? (
          <div>
            <Button type="submit" disabled={busy || list.loading}>
              {t('roles.save')}
            </Button>
          </div>
        ) : null}
      </form>
    </div>
  );
}
function Terminals({ user }: { user: SessionUser }) {
  const { t, locale } = useI18n();
  const list = useRows<Terminal>('terminals');
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState('');
  const canManage = user.permissions.includes('terminal.manage');
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setBusy(true);
    setSuccess('');
    try {
      await api('terminals', 'POST', Object.fromEntries(data));
      form.reset();
      await list.reload();
      setSuccess('Terminal registered.');
    } catch (error) {
      list.setError(error);
    } finally {
      setBusy(false);
    }
  }
  async function toggle(terminal: Terminal) {
    setBusy(true);
    try {
      await api(`terminals/${terminal.id}`, 'PATCH', { active: !terminal.active });
      await list.reload();
    } catch (error) {
      list.setError(error);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex flex-col gap-6">
      {list.error ? <Notice>{message(list.error, t, locale)}</Notice> : null}
      {success ? <p role="status">{serverMessage(success, locale)}</p> : null}
      {canManage ? (
        <form
          onSubmit={(event) => void create(event)}
          className="grid items-end gap-4 rounded-lg border bg-card p-5 sm:grid-cols-[1fr_1fr_auto]"
        >
          <Field label={t('terminals.terminalName')} name="name" />
          <div className="flex flex-col gap-2">
            <Label htmlFor="terminal-type">{t('terminals.typeLabel')}</Label>
            <select id="terminal-type" name="type">
              {['POS', 'KDS', 'WAITER', 'ADMIN', 'OWNER', 'KIOSK'].map((type) => (
                <option key={type} value={type}>
                  {t(terminalLabels[type]!)}
                </option>
              ))}
            </select>
          </div>
          <Button type="submit" disabled={busy}>
            {t('terminals.register')}
          </Button>
        </form>
      ) : null}
      {list.loading ? (
        <p role="status">{t('terminals.loading')}</p>
      ) : list.rows.length ? (
        <div className="rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('terminals.colDevice')}</TableHead>
                <TableHead>{t('terminals.colType')}</TableHead>
                <TableHead>{t('terminals.colLastSeen')}</TableHead>
                <TableHead>{t('terminals.colAccess')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.rows.map((terminal) => (
                <TableRow key={terminal.id}>
                  <TableCell>
                    <p className="font-medium">{terminal.name}</p>
                    <p
                      className="mt-1 max-w-56 truncate text-xs text-muted-foreground"
                      title={terminal.id}
                    >
                      {terminal.id}
                    </p>
                  </TableCell>
                  <TableCell>{terminalLabels[terminal.type] ? t(terminalLabels[terminal.type]!) : terminal.type}</TableCell>
                  <TableCell>
                    {terminal.lastSeenAt
                      ? formatDateTime(terminal.lastSeenAt, locale)
                      : t('terminal.notConnected')}
                  </TableCell>
                  <TableCell>
                    {canManage ? (
                      <Button
                        variant="outline"
                        disabled={busy}
                        onClick={() => void toggle(terminal)}
                      >
                        {terminal.active ? t('terminal.disable') : t('terminal.enable')}
                      </Button>
                    ) : terminal.active ? (
                      t('common.active')
                    ) : (
                      t('team.disabled')
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <div className="rounded-lg border bg-card p-8">
          <h2 className="text-lg font-semibold">{t('terminals.empty')}</h2>
          <p className="mt-2 text-muted-foreground">
            {t('terminals.emptyHint')}
          </p>
        </div>
      )}
    </div>
  );
}
function AuditHistory() {
  const { t, locale } = useI18n();
  const list = useRows<AuditRow>('audit-logs');
  return (
    <div className="flex flex-col gap-5">
      <div>
        <Button variant="outline" disabled={list.loading} onClick={() => void list.reload()}>
          {t('audit.refresh')}
        </Button>
      </div>
      {list.error ? <Notice>{message(list.error, t, locale)}</Notice> : null}
      {list.loading ? (
        <p role="status">{t('audit.loading')}</p>
      ) : (
        <div className="rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('audit.colTime')}</TableHead>
                <TableHead>{t('audit.colAction')}</TableHead>
                <TableHead>{t('audit.colRecord')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="whitespace-nowrap">
                    {formatDateTime(row.createdAt, locale)}
                  </TableCell>
                  <TableCell>{row.action}</TableCell>
                  <TableCell>
                    {row.entityType}
                    <p
                      className="mt-1 max-w-48 truncate text-xs text-muted-foreground"
                      title={row.entityId ?? ''}
                    >
                      {row.entityId}
                    </p>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <p className="text-sm text-muted-foreground">
        {t('audit.note')}
      </p>
    </div>
  );
}
