'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type {
  DeviceKind,
  DeviceOverview,
  DeviceRecord,
  DeviceStatus,
  SessionUser,
} from '@restaurant/shared-types';
import { Button } from '@restaurant/ui/button';
import { Input } from '@restaurant/ui/input';
import { Label } from '@restaurant/ui/label';
import { api, ApiFailure } from '../lib/api';
import { agentRequest, agentConfigured } from '../lib/device-agent';

/**
 * Settings → Devices.
 *
 * Lists the restaurant's hardware with its address and live status, and offers Test and
 * Configure for each. The browser never talks to hardware itself: Test asks the local
 * Device Agent to probe the device, and the result is recorded through the API so the
 * status an operator sees is the status the server holds.
 *
 * Text here is English only. The Albanian/English translation layer lives on its own
 * branch and will absorb this workspace once both are merged, so this file deliberately
 * does not carry a second, smaller translation mechanism of its own.
 */
const KIND_LABELS: Record<DeviceKind, string> = {
  RECEIPT_PRINTER: 'Receipt Printer',
  NFC_READER: 'NFC Reader',
  KITCHEN_PRINTER: 'Kitchen Printer',
  BAR_PRINTER: 'Bar Printer',
};
const STATUS_LABELS: Record<DeviceStatus, string> = {
  ONLINE: 'Connected',
  OFFLINE: 'Offline',
  UNKNOWN: 'Not tested',
  DISABLED: 'Disabled',
};
const STATUS_TONE: Record<DeviceStatus, 'ok' | 'warn' | 'bad' | 'idle'> = {
  ONLINE: 'ok',
  OFFLINE: 'bad',
  UNKNOWN: 'warn',
  DISABLED: 'idle',
};
const message = (error: unknown) =>
  error instanceof ApiFailure ? error.message : 'Cannot reach the local server. Try again.';

/** The address as an operator recognises it: a COM port or an IP and port. */
function address(device: DeviceRecord): string {
  if (device.connection === 'NETWORK')
    return device.host ? `${device.host}:${device.tcpPort ?? 9100}` : 'No address';
  return device.port ?? device.windowsPrinterName ?? 'No address';
}

export function DevicesWorkspace({ user }: { user: SessionUser }) {
  const canManage = user.permissions.includes('device.manage');
  const [overview, setOverview] = useState<DeviceOverview | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState('');
  const [editing, setEditing] = useState<DeviceRecord | 'new' | null>(null);

  const load = useCallback(async () => {
    try {
      setOverview(await api<DeviceOverview>('devices/overview'));
      setError('');
    } catch (e) {
      setError(message(e));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Test a device.
   *
   * The agent is asked to probe it and the outcome is posted back, so the recorded
   * status always reflects a real probe rather than an optimistic assumption.
   */
  async function test(device: DeviceRecord) {
    setBusy(device.id);
    setError('');
    setNotice('');
    try {
      const probe = await agentRequest<{ delivered: boolean; error?: string }>('test', {
        deviceId: device.id,
      });
      await api(`devices/${device.id}/test`, 'POST', {
        ok: probe.delivered,
        ...(probe.error ? { error: probe.error } : {}),
      });
      setNotice(probe.delivered ? `${device.name} answered.` : `${device.name} did not answer.`);
    } catch (e) {
      // A missing agent is a normal state on a machine that has not been set up yet, and
      // it is reported as such rather than as a device fault.
      const reason = e instanceof Error ? e.message : 'The device agent did not respond.';
      await api(`devices/${device.id}/test`, 'POST', { ok: false, error: reason }).catch(() => {});
      setError(reason);
    } finally {
      setBusy('');
      await load();
    }
  }

  async function retryJob(jobId: string) {
    setBusy(jobId);
    try {
      await api(`devices/jobs/${jobId}/retry`, 'POST', { commandId: crypto.randomUUID() });
      setNotice('Queued for printing again.');
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy('');
      await load();
    }
  }

  if (!overview) return <p role="status">{error || 'Loading devices…'}</p>;

  return (
    <section className="space-y-5" aria-label="Devices">
      {!agentConfigured() ? (
        <p className="device-hint" role="status">
          The local device agent is not configured on this machine, so hardware cannot be
          tested or printed to from here. Devices can still be configured.
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="text-sm">
          {notice}
        </p>
      ) : null}

      {canManage ? (
        <Button onClick={() => setEditing('new')} disabled={Boolean(busy)}>
          Add device
        </Button>
      ) : null}

      {editing ? (
        <DeviceEditor
          key={editing === 'new' ? 'new' : editing.id + editing.version}
          device={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            setNotice('Device saved.');
            await load();
          }}
        />
      ) : null}

      <ul className="device-list" aria-label="Configured devices">
        {overview.devices.map((device) => (
          <li key={device.id} className="device-card" data-testid={`device-${device.kind}`}>
            <div className="device-identity">
              <strong>{KIND_LABELS[device.kind]}</strong>
              <span className="device-name">{device.name}</span>
              <span className="device-address">{address(device)}</span>
            </div>
            <span className="device-status" data-tone={STATUS_TONE[device.status]}>
              {STATUS_LABELS[device.status]}
            </span>
            {device.lastError ? <span className="device-error">{device.lastError}</span> : null}
            <div className="device-actions">
              <Button
                variant="outline"
                size="sm"
                disabled={busy === device.id || !canManage}
                onClick={() => void test(device)}
              >
                {device.kind === 'NFC_READER' ? 'Test NFC' : 'Test Print'}
              </Button>
              {canManage ? (
                <Button variant="outline" size="sm" onClick={() => setEditing(device)}>
                  Configure
                </Button>
              ) : null}
            </div>
          </li>
        ))}
        {overview.devices.length === 0 ? (
          <li className="device-empty">
            No devices configured yet. Add the receipt printer, the card reader and the
            kitchen and bar printers.
          </li>
        ) : null}
      </ul>

      <section aria-label="Station printers" className="space-y-2">
        <h2 className="text-lg font-semibold">Kitchen station printers</h2>
        <p className="text-sm text-muted-foreground">
          Each station prints to one printer. Stations may share a printer; a station with
          none cannot print its tickets.
        </p>
        <ul className="device-station-list">
          {overview.stations.map((station) => (
            <li key={station.stationId} className="device-station">
              <span>{station.stationName}</span>
              {canManage ? (
                <select
                  aria-label={`Printer for ${station.stationName}`}
                  value={station.deviceId ?? ''}
                  onChange={async (event) => {
                    try {
                      await api('devices/stations', 'POST', {
                        stationId: station.stationId,
                        deviceId: event.target.value || null,
                      });
                      setNotice('Station printer saved.');
                      await load();
                    } catch (e) {
                      setError(message(e));
                    }
                  }}
                >
                  <option value="">No printer</option>
                  {overview.devices
                    .filter((d) => d.kind !== 'NFC_READER' && d.enabled)
                    .map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                </select>
              ) : (
                <span>{station.deviceName ?? 'No printer'}</span>
              )}
            </li>
          ))}
        </ul>
      </section>

      {overview.unresolvedJobs.length ? (
        <section aria-label="Unprinted documents" className="space-y-2">
          <h2 className="text-lg font-semibold">Waiting to print</h2>
          <p className="text-sm text-muted-foreground">
            These documents have not reached a printer. The orders and kitchen tickets
            themselves are unaffected.
          </p>
          <ul className="device-job-list">
            {overview.unresolvedJobs.map((job) => (
              <li key={job.id} className="device-job">
                <span>{job.deviceName ?? 'No printer assigned'}</span>
                <span className="device-job-state">{job.state.replace('_', ' ').toLowerCase()}</span>
                {job.lastError ? <span className="device-error">{job.lastError}</span> : null}
                {canManage ? (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy === job.id}
                    onClick={() => void retryJob(job.id)}
                  >
                    Retry
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </section>
  );
}

/** Configuration form. The address fields shown follow the chosen connection type. */
function DeviceEditor({
  device,
  onClose,
  onSaved,
}: {
  device?: DeviceRecord;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [kind, setKind] = useState<DeviceKind>(device?.kind ?? 'RECEIPT_PRINTER');
  const [connection, setConnection] = useState(device?.connection ?? 'SERIAL');
  const [error, setError] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const text = (key: string) => String(form.get(key) ?? '').trim();
    const data: Record<string, unknown> = {
      name: text('name'),
      kind,
      connection,
      enabled: form.has('enabled'),
      terminalId: null,
    };
    if (connection === 'SERIAL') {
      data.port = text('port');
      data.baudRate = Number(text('baudRate') || 9600);
    } else if (connection === 'NETWORK') {
      data.host = text('host');
      data.tcpPort = Number(text('tcpPort') || 9100);
    } else if (connection === 'WINDOWS_PRINTER') {
      data.windowsPrinterName = text('windowsPrinterName');
    } else {
      // USB is either a virtual COM port or a spooler queue, never both.
      if (text('port')) data.port = text('port');
      else data.windowsPrinterName = text('windowsPrinterName');
    }
    try {
      if (device) await api(`devices/${device.id}`, 'PUT', { version: device.version, data });
      else await api('devices', 'POST', data);
      onSaved();
    } catch (e) {
      setError(message(e));
    }
  }

  return (
    <form aria-label="Device configuration" onSubmit={submit} className="device-form">
      <h2 className="text-lg font-semibold">{device ? 'Configure device' : 'Add device'}</h2>
      {error ? (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      ) : null}
      <div className="space-y-2">
        <Label htmlFor="device-name">Device name</Label>
        <Input id="device-name" name="name" defaultValue={device?.name} maxLength={100} required />
      </div>
      <div className="space-y-2">
        <Label htmlFor="device-kind">Device type</Label>
        <select
          id="device-kind"
          value={kind}
          onChange={(e) => setKind(e.target.value as DeviceKind)}
        >
          {(Object.keys(KIND_LABELS) as DeviceKind[]).map((k) => (
            <option key={k} value={k}>
              {KIND_LABELS[k]}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-2">
        <Label htmlFor="device-connection">Connection</Label>
        <select
          id="device-connection"
          value={connection}
          onChange={(e) => setConnection(e.target.value as DeviceRecord['connection'])}
        >
          <option value="SERIAL">Serial / COM</option>
          <option value="USB">USB</option>
          <option value="WINDOWS_PRINTER">Windows printer</option>
          <option value="NETWORK">Network (LAN)</option>
        </select>
      </div>
      {connection === 'SERIAL' || connection === 'USB' ? (
        <div className="space-y-2">
          <Label htmlFor="device-port">COM port</Label>
          <Input
            id="device-port"
            name="port"
            defaultValue={device?.port ?? ''}
            placeholder="COM3"
          />
        </div>
      ) : null}
      {connection === 'SERIAL' ? (
        <div className="space-y-2">
          <Label htmlFor="device-baud">Baud rate</Label>
          <select id="device-baud" name="baudRate" defaultValue={String(device?.baudRate ?? 9600)}>
            {[9600, 19200, 38400, 57600, 115200].map((rate) => (
              <option key={rate} value={rate}>
                {rate}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      {connection === 'WINDOWS_PRINTER' || connection === 'USB' ? (
        <div className="space-y-2">
          <Label htmlFor="device-queue">Windows printer name</Label>
          <Input
            id="device-queue"
            name="windowsPrinterName"
            defaultValue={device?.windowsPrinterName ?? ''}
          />
        </div>
      ) : null}
      {connection === 'NETWORK' ? (
        <>
          <div className="space-y-2">
            <Label htmlFor="device-host">Printer IP address</Label>
            <Input
              id="device-host"
              name="host"
              defaultValue={device?.host ?? ''}
              placeholder="192.168.1.50"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="device-tcp">Port</Label>
            <Input
              id="device-tcp"
              name="tcpPort"
              type="number"
              defaultValue={String(device?.tcpPort ?? 9100)}
            />
          </div>
        </>
      ) : null}
      <label className="flex min-h-11 items-center gap-2 text-sm">
        <input type="checkbox" name="enabled" defaultChecked={device?.enabled ?? true} />
        In use
      </label>
      <div className="flex flex-wrap gap-3">
        <Button type="submit">Save device</Button>
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
