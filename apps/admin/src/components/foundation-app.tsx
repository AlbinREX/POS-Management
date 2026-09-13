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
import { MenuCatalog } from './menu-catalog';
import { RestaurantLayout } from './restaurant-layout';
import { OrdersWorkspace } from './orders-workspace';
import { KitchenDisplay } from './kitchen-display';
import { Brand, NavIcon } from './riza-ui';
import { PaymentsWorkspace } from './payments-workspace';

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
  | 'Payments';
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
function message(error: unknown) {
  return error instanceof ApiFailure
    ? error.message
    : 'Cannot reach the local server. Check your restaurant connection and try again.';
}

export function FoundationApp({ kitchenOnly = false }: { kitchenOnly?: boolean }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const restore = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setUser((await refresh()).user);
    } catch (error) {
      if (!(error instanceof ApiFailure && error.status === 401)) setError(message(error));
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
    setError('');
    try {
      setUser((await login(Object.fromEntries(form))).user);
    } catch (error) {
      setError(message(error));
    } finally {
      setPending(false);
    }
  }
  async function signOut() {
    setPending(true);
    setError('');
    try {
      await logout();
      setUser(null);
    } catch (error) {
      setError(message(error));
    } finally {
      setPending(false);
    }
  }
  if (loading)
    return (
      <main className="flex min-h-screen items-center justify-center">
        <p role="status">Connecting to your restaurant…</p>
      </main>
    );
  if (user && kitchenOnly)
    return (
      <div className="min-h-screen p-4 md:p-8">
        <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold">Kitchen display</h1>
            <p>
              {user.branchName} · {user.name}
            </p>
          </div>
          <Button variant="outline" onClick={() => void signOut()} disabled={pending}>
            Sign out
          </Button>
        </header>
        {error ? <Notice>{error}</Notice> : null}
        {user.permissions.includes('kitchen.read') ? (
          <KitchenDisplay user={user} />
        ) : (
          <Notice>Kitchen access is not granted to this account.</Notice>
        )}
      </div>
    );
  if (user)
    return (
      <Workspace
        user={user}
        onLogout={() => void signOut()}
        pending={pending}
        sessionError={error}
      />
    );
  return (
    <main className="grid min-h-screen lg:grid-cols-2">
      <section className="riza-login flex flex-col justify-between px-8 py-10 lg:p-16">
        <Brand />
        <div className="my-12 max-w-lg">
          <h1 className="text-4xl font-semibold leading-tight lg:text-5xl">
            Made for the rush.
            <br />
            Ready for service.
          </h1>
          <p className="mt-5 text-lg leading-relaxed">
            Your menu, your team and every order. One focused workspace for FastFood Riza.
          </p>
        </div>
        <p className="text-sm">Connect using your restaurant network.</p>
      </section>
      <section className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-md">
          <h2 className="text-3xl font-semibold tracking-tight">Sign in</h2>
          <p className="mb-8 mt-3 text-muted-foreground">
            Use the account provided by your administrator.
          </p>
          {error ? (
            <div className="mb-5">
              <Notice>{error}</Notice>
            </div>
          ) : null}
          <form onSubmit={(event) => void signIn(event)} className="flex flex-col gap-5">
            <div className="grid grid-cols-2 gap-4">
              <Field label="Organization" name="organization" autoComplete="off" />
              <Field label="Branch code" name="branch" autoComplete="off" />
            </div>
            <Field label="Email" name="email" type="email" autoComplete="username" />
            <Field
              label="Password"
              name="password"
              type="password"
              autoComplete="current-password"
            />
            <Button type="submit" size="lg" disabled={pending}>
              {pending ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>
          <p className="mt-6 text-sm leading-relaxed text-muted-foreground">
            Need access? Contact your restaurant administrator.
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
  const [tab, setTab] = useState<Tab>('Workspace');
  const [paymentOrder, setPaymentOrder] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('CASH');
  const labels: Partial<Record<Tab, string>> = { Workspace: 'Home', Layout: 'Tables' };
  const can = (permission: PermissionKey) => user.permissions.includes(permission);
  const tabs: Tab[] = [
    'Workspace',
    ...(can('order.read') ? ['POS' as const] : []),
    ...(can('menu.read') ? ['Menu' as const] : []),
    ...(can('layout.read') ? ['Layout' as const] : []),
    ...(can('order.read') ? ['Orders' as const] : []),
    ...(can('kitchen.read') ? ['Kitchen' as const] : []),
    ...(can('payment.read') || can('cash.shift.read') ? ['Payments' as const] : []),
    ...(can('user.read') ? ['Team' as const] : []),
    ...(can('role.read') ? ['Roles' as const] : []),
    ...(can('terminal.read') ? ['Terminals' as const] : []),
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
          <div className="text-right">
            <p className="font-medium">{user.name}</p>
            <p className="text-sm text-muted-foreground">{user.email}</p>
          </div>
          <Button variant="outline" disabled={pending} onClick={onLogout}>
            Sign out
          </Button>
        </div>
      </header>
      <div className="riza-shell">
        <nav aria-label="Administration" className="riza-nav">
          {tabs.map((item) => (
            <Button
              key={item}
              variant={tab === item ? 'secondary' : 'ghost'}
              className="shrink-0 justify-start gap-3"
              aria-current={tab === item ? 'page' : undefined}
              onClick={() => {
                setTab(item);
                setPaymentOrder('');
              }}
            >
              <NavIcon name={item} />
              {labels[item] ?? item}
            </Button>
          ))}
        </nav>
        <main className="riza-main">
          {sessionError ? <Notice>{sessionError}</Notice> : null}
          <h1 className={tab === 'POS' ? 'sr-only' : 'mb-2 text-3xl font-semibold tracking-tight'}>
            {labels[tab] ?? tab}
          </h1>
          <p className={tab === 'POS' ? 'sr-only' : 'mb-6 text-sm text-muted-foreground'}>
            {
              {
                Workspace: 'Welcome back. Your restaurant, ready for service.',
                POS: 'Choose an order, explore the menu and make it yours.',
                Menu: 'Configure the menu available in this branch.',
                Layout: 'Manage your areas, floor plan and table availability.',
                Orders: 'Create and manage dine-in and takeaway orders.',
                Kitchen: 'Station tickets, preparation progress and history.',
                Payments: 'Collections, payment history and cash register shifts.',
                Team: 'Manage the people who can access this branch.',
                Roles: 'Control what each role can do.',
                Terminals: 'Register and manage restaurant devices.',
                'Audit history': 'A permanent record of sensitive changes in this branch.',
              }[tab]
            }
          </p>
          {tab === 'Workspace' ? (
            <>
              <div className="riza-home-grid">
                {tabs
                  .filter((item) =>
                    ['POS', 'Orders', 'Layout', 'Kitchen', 'Menu', 'Payments'].includes(item),
                  )
                  .map((item) => (
                    <button key={item} className="riza-home-card" onClick={() => setTab(item)}>
                      <NavIcon name={item} />
                      <strong>{labels[item] ?? item}</strong>
                      <span>
                        Open workspace <span aria-hidden="true">↗</span>
                      </span>
                    </button>
                  ))}
              </div>
              <Overview user={user} />
            </>
          ) : null}
          {tab === 'Menu' ? <MenuCatalog canManage={can('menu.manage')} /> : null}
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
  return (
    <section className="rounded-lg border bg-card p-6">
      <h2 className="text-xl font-semibold">{user.branchName}</h2>
      <dl className="mt-6 grid gap-6 sm:grid-cols-2">
        <div>
          <dt className="text-sm text-muted-foreground">Signed in as</dt>
          <dd className="mt-1 font-medium">{user.name}</dd>
        </div>
        <div>
          <dt className="text-sm text-muted-foreground">Access</dt>
          <dd className="mt-1">
            {user.permissions.length
              ? `${user.permissions.length} assigned permissions`
              : 'Account access only'}
          </dd>
        </div>
      </dl>
      <div className="mt-8 border-t pt-6">
        <h3 className="font-medium">Available permissions</h3>
        {user.permissions.length ? (
          <ul className="mt-3 grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">
            {user.permissions.map((permission) => (
              <li key={permission}>{permission.replace('.', ' / ')}</li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">
            Your operational application will be available when enabled by your administrator.
          </p>
        )}
      </div>
    </section>
  );
}
function useRows<T>(path: string, enabled = true) {
  const [rows, setRows] = useState<T[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const reload = useCallback(async () => {
    if (!enabled) {
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      setRows(await api<T[]>(path));
    } catch (error) {
      setError(message(error));
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
    list.setError('');
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
      list.setError(message(error));
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
      list.setError(message(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex flex-col gap-6">
      {list.error || roles.error ? <Notice>{list.error || roles.error}</Notice> : null}
      {success ? <p role="status">{success}</p> : null}
      {canManage && user.permissions.includes('role.read') ? (
        <form
          onSubmit={(event) => void create(event)}
          className="grid gap-4 rounded-lg border bg-card p-5 sm:grid-cols-2"
        >
          <Field label="Full name" name="name" autoComplete="off" />
          <Field label="Email address" name="email" type="email" autoComplete="off" />
          <Field
            label="Initial password"
            name="password"
            type="password"
            minLength={12}
            autoComplete="new-password"
          />
          <div className="flex flex-col gap-2">
            <Label htmlFor="role">Role</Label>
            <select id="role" name="role" required defaultValue="">
              <option value="" disabled>
                Select role
              </option>
              {roles.rows
                .filter((role) => !role.protected)
                .map((role) => (
                  <option key={role.id} value={role.id}>
                    {role.name}
                  </option>
                ))}
            </select>
          </div>
          <div>
            <Button disabled={busy || roles.loading} type="submit">
              Add team member
            </Button>
          </div>
        </form>
      ) : null}
      {list.loading ? (
        <p role="status">Loading team…</p>
      ) : (
        <div className="rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Access</TableHead>
                <TableHead>Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.rows.map((member) => (
                <TableRow key={member.user.id}>
                  <TableCell>
                    <p className="font-medium">{member.user.name}</p>
                    <p className="mt-1 text-muted-foreground">{member.user.email}</p>
                  </TableCell>
                  <TableCell>{member.roles.map((r) => r.role.name).join(', ')}</TableCell>
                  <TableCell>{member.active ? 'Active' : 'Disabled'}</TableCell>
                  <TableCell>
                    {canManage &&
                    member.user.id !== user.id &&
                    !member.roles.some((r) => r.role.name === 'OWNER') ? (
                      <Button variant="outline" disabled={busy} onClick={() => void toggle(member)}>
                        {member.active ? 'Disable access' : 'Enable access'}
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
        Showing up to 200 branch members. Access changes apply immediately.
      </p>
    </div>
  );
}
function Roles({ user }: { user: SessionUser }) {
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
    list.setError('');
    try {
      if (role) await api(`roles/${role.id}/permissions`, 'PATCH', { permissions });
      else await api('roles', 'POST', { name: new FormData(form).get('roleName'), permissions });
      await list.reload();
      setSuccess('Role permissions saved.');
    } catch (error) {
      list.setError(message(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex flex-col gap-5">
      {list.error ? <Notice>{list.error}</Notice> : null}
      {success ? <p role="status">{success}</p> : null}
      <form
        onSubmit={(event) => void save(event)}
        className="flex flex-col gap-5 rounded-lg border bg-card p-6"
      >
        <div className="flex flex-col gap-2">
          <Label htmlFor="role-editor">Role</Label>
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
            <option value="">Create a new role</option>
            {list.rows.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </div>
        {!role ? <Field label="Role name" name="roleName" /> : null}
        <fieldset disabled={!canEdit || busy}>
          <legend className="mb-3 font-medium">Permissions</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            {PERMISSIONS.map((key) => (
              <label key={key} className="flex min-h-11 items-center gap-3">
                <input
                  type="checkbox"
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
                <span className="text-sm">{key.replace('.', ' / ')}</span>
              </label>
            ))}
          </div>
        </fieldset>
        {role?.protected ? (
          <p className="text-sm text-muted-foreground">
            Owner access is protected from accidental changes.
          </p>
        ) : canEdit ? (
          <div>
            <Button type="submit" disabled={busy || list.loading}>
              Save permissions
            </Button>
          </div>
        ) : null}
      </form>
    </div>
  );
}
function Terminals({ user }: { user: SessionUser }) {
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
      list.setError(message(error));
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
      list.setError(message(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex flex-col gap-6">
      {list.error ? <Notice>{list.error}</Notice> : null}
      {success ? <p role="status">{success}</p> : null}
      {canManage ? (
        <form
          onSubmit={(event) => void create(event)}
          className="grid items-end gap-4 rounded-lg border bg-card p-5 sm:grid-cols-[1fr_1fr_auto]"
        >
          <Field label="Terminal name" name="name" />
          <div className="flex flex-col gap-2">
            <Label htmlFor="terminal-type">Type</Label>
            <select id="terminal-type" name="type">
              {['POS', 'KDS', 'WAITER', 'ADMIN', 'OWNER', 'KIOSK'].map((type) => (
                <option key={type}>{type}</option>
              ))}
            </select>
          </div>
          <Button type="submit" disabled={busy}>
            Register terminal
          </Button>
        </form>
      ) : null}
      {list.loading ? (
        <p role="status">Loading terminals…</p>
      ) : list.rows.length ? (
        <div className="rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Device</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Last seen</TableHead>
                <TableHead>Access</TableHead>
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
                  <TableCell>{terminal.type}</TableCell>
                  <TableCell>
                    {terminal.lastSeenAt
                      ? new Date(terminal.lastSeenAt).toLocaleString()
                      : 'Not connected yet'}
                  </TableCell>
                  <TableCell>
                    {canManage ? (
                      <Button
                        variant="outline"
                        disabled={busy}
                        onClick={() => void toggle(terminal)}
                      >
                        {terminal.active ? 'Disable' : 'Enable'}
                      </Button>
                    ) : terminal.active ? (
                      'Active'
                    ) : (
                      'Disabled'
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <div className="rounded-lg border bg-card p-8">
          <h2 className="text-lg font-semibold">No terminals registered</h2>
          <p className="mt-2 text-muted-foreground">
            Register a device to identify it in restaurant sessions.
          </p>
        </div>
      )}
    </div>
  );
}
function AuditHistory() {
  const list = useRows<AuditRow>('audit-logs');
  return (
    <div className="flex flex-col gap-5">
      <div>
        <Button variant="outline" disabled={list.loading} onClick={() => void list.reload()}>
          Refresh history
        </Button>
      </div>
      {list.error ? <Notice>{list.error}</Notice> : null}
      {list.loading ? (
        <p role="status">Loading history…</p>
      ) : (
        <div className="rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Time</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Record</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="whitespace-nowrap">
                    {new Date(row.createdAt).toLocaleString()}
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
        Latest 100 events. Times are shown in your device timezone.
      </p>
    </div>
  );
}
