'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type {
  DeviceKind,
  DeviceOverview,
  DeviceRecord,
  DeviceStatus,
  PrintJobState,
  SessionUser,
} from '@restaurant/shared-types';
import { Button } from '@restaurant/ui/button';
import { Input } from '@restaurant/ui/input';
import { Label } from '@restaurant/ui/label';
import { api, ApiFailure } from '../lib/api';
import { agentRequest, agentConfigured } from '../lib/device-agent';
import { MESSAGES, serverMessage, useI18n, type MessageKey, type Translate } from '../lib/i18n';

/**
 * Settings → Devices.
 *
 * Lists the restaurant's hardware with its address and live status, and offers Test and
 * Configure for each. The browser never talks to hardware itself: Test asks the local
 * Device Agent to probe the device, and the result is recorded through the API so the
 * status an operator sees is the status the server holds.
 *
 * Device kinds, connection types and statuses are identifiers: they are sent to the API
 * and stored unchanged, and only their labels are translated. Messages from the API or
 * the agent stay English in state, because a failed test is also recorded as the
 * device's last error, and are translated only where they are shown.
 */
const KIND_KEYS: Record<DeviceKind, MessageKey> = {
  RECEIPT_PRINTER: 'devices.receiptPrinter',
  NFC_READER: 'devices.nfcReader',
  KITCHEN_PRINTER: 'devices.kitchenPrinter',
  BAR_PRINTER: 'devices.barPrinter',
};
const STATUS_KEYS: Record<DeviceStatus, MessageKey> = {
  ONLINE: 'devices.connected',
  OFFLINE: 'devices.offline',
  UNKNOWN: 'devices.notTested',
  DISABLED: 'devices.disabled',
};
const STATUS_TONE: Record<DeviceStatus, 'ok' | 'warn' | 'bad' | 'idle'> = {
  ONLINE: 'ok',
  OFFLINE: 'bad',
  UNKNOWN: 'warn',
  DISABLED: 'idle',
};
const JOB_STATE_KEYS: Record<PrintJobState, MessageKey> = {
  PENDING: 'devices.jobPending',
  SENT: 'devices.jobSent',
  CONFIRMED: 'devices.jobConfirmed',
  FAILED: 'devices.jobFailed',
  RETRY_REQUIRED: 'devices.jobRetryRequired',
};
const message = (error: unknown) =>
  error instanceof ApiFailure ? error.message : MESSAGES['session.unreachableRetry'].en;

/** The address as an operator recognises it: a COM port or an IP and port. */
function address(device: DeviceRecord, t: Translate): string {
  if (device.connection === 'NETWORK')
    return device.host ? `${device.host}:${device.tcpPort ?? 9100}` : t('devices.noAddress');
  return device.port ?? device.windowsPrinterName ?? t('devices.noAddress');
}

export function DevicesWorkspace({ user }: { user: SessionUser }) {
  const { t, locale } = useI18n();
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
      setNotice(
        t(probe.delivered ? 'devices.answered' : 'devices.noAnswer', { name: device.name }),
      );
    } catch (e) {
      // A missing agent is a normal state on a machine that has not been set up yet, and
      // it is reported as such rather than as a device fault.
      const reason = e instanceof Error ? e.message : MESSAGES['devices.agentNoResponse'].en;
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
      setNotice(t('devices.requeued'));
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy('');
      await load();
    }
  }

  if (!overview)
    return <p role="status">{error ? serverMessage(error, locale) : t('devices.loading')}</p>;

  return (
    <section className="space-y-5" aria-label={t('nav.devices')}>
      {!agentConfigured() ? (
        <p className="device-hint" role="status">
          {t('devices.agentMissingHint')}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-destructive">
          {serverMessage(error, locale)}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="text-sm">
          {notice}
        </p>
      ) : null}

      {canManage ? (
        <Button onClick={() => setEditing('new')} disabled={Boolean(busy)}>
          {t('devices.add')}
        </Button>
      ) : null}

      {editing ? (
        <DeviceEditor
          key={editing === 'new' ? 'new' : editing.id + editing.version}
          device={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            setNotice(t('devices.saved'));
            await load();
          }}
        />
      ) : null}

      <ul className="device-list" aria-label={t('devices.configuredList')}>
        {overview.devices.map((device) => (
          <li key={device.id} className="device-card" data-testid={`device-${device.kind}`}>
            <div className="device-identity">
              <strong>{t(KIND_KEYS[device.kind])}</strong>
              <span className="device-name">{device.name}</span>
              <span className="device-address">{address(device, t)}</span>
            </div>
            <span className="device-status" data-tone={STATUS_TONE[device.status]}>
              {t(STATUS_KEYS[device.status])}
            </span>
            {device.lastError ? (
              <span className="device-error">{serverMessage(device.lastError, locale)}</span>
            ) : null}
            <div className="device-actions">
              <Button
                variant="outline"
                size="sm"
                disabled={busy === device.id || !canManage}
                onClick={() => void test(device)}
              >
                {device.kind === 'NFC_READER' ? t('devices.testNfc') : t('devices.testPrint')}
              </Button>
              {canManage ? (
                <Button variant="outline" size="sm" onClick={() => setEditing(device)}>
                  {t('devices.configure')}
                </Button>
              ) : null}
            </div>
          </li>
        ))}
        {overview.devices.length === 0 ? (
          <li className="device-empty">{t('devices.empty')}</li>
        ) : null}
      </ul>

      <section aria-label={t('devices.stationPrinters')} className="space-y-2">
        <h2 className="text-lg font-semibold">{t('devices.stationPrintersTitle')}</h2>
        <p className="text-sm text-muted-foreground">{t('devices.stationPrintersHint')}</p>
        <ul className="device-station-list">
          {overview.stations.map((station) => (
            <li key={station.stationId} className="device-station">
              <span>{station.stationName}</span>
              {canManage ? (
                <select
                  aria-label={t('devices.printerFor', { station: station.stationName })}
                  value={station.deviceId ?? ''}
                  onChange={async (event) => {
                    try {
                      await api('devices/stations', 'POST', {
                        stationId: station.stationId,
                        deviceId: event.target.value || null,
                      });
                      setNotice(t('devices.stationPrinterSaved'));
                      await load();
                    } catch (e) {
                      setError(message(e));
                    }
                  }}
                >
                  <option value="">{t('devices.noPrinter')}</option>
                  {overview.devices
                    .filter((d) => d.kind !== 'NFC_READER' && d.enabled)
                    .map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                </select>
              ) : (
                <span>{station.deviceName ?? t('devices.noPrinter')}</span>
              )}
            </li>
          ))}
        </ul>
      </section>

      {overview.unresolvedJobs.length ? (
        <section aria-label={t('devices.unprinted')} className="space-y-2">
          <h2 className="text-lg font-semibold">{t('devices.waitingToPrint')}</h2>
          <p className="text-sm text-muted-foreground">{t('devices.waitingHint')}</p>
          <ul className="device-job-list">
            {overview.unresolvedJobs.map((job) => (
              <li key={job.id} className="device-job">
                <span>{job.deviceName ?? t('devices.noPrinterAssigned')}</span>
                <span className="device-job-state">{t(JOB_STATE_KEYS[job.state])}</span>
                {job.lastError ? (
                  <span className="device-error">{serverMessage(job.lastError, locale)}</span>
                ) : null}
                {canManage ? (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy === job.id}
                    onClick={() => void retryJob(job.id)}
                  >
                    {t('action.retry')}
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
  const { t, locale } = useI18n();
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
    <form aria-label={t('devices.configurationForm')} onSubmit={submit} className="device-form">
      <h2 className="text-lg font-semibold">
        {device ? t('devices.configureTitle') : t('devices.add')}
      </h2>
      {error ? (
        <p role="alert" className="text-destructive">
          {serverMessage(error, locale)}
        </p>
      ) : null}
      <div className="space-y-2">
        <Label htmlFor="device-name">{t('devices.name')}</Label>
        <Input id="device-name" name="name" defaultValue={device?.name} maxLength={100} required />
      </div>
      <div className="space-y-2">
        <Label htmlFor="device-kind">{t('devices.type')}</Label>
        <select
          id="device-kind"
          value={kind}
          onChange={(e) => setKind(e.target.value as DeviceKind)}
        >
          {(Object.keys(KIND_KEYS) as DeviceKind[]).map((k) => (
            <option key={k} value={k}>
              {t(KIND_KEYS[k])}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-2">
        <Label htmlFor="device-connection">{t('devices.connection')}</Label>
        <select
          id="device-connection"
          value={connection}
          onChange={(e) => setConnection(e.target.value as DeviceRecord['connection'])}
        >
          <option value="SERIAL">{t('devices.connectionSerial')}</option>
          <option value="USB">{t('devices.connectionUsb')}</option>
          <option value="WINDOWS_PRINTER">{t('devices.connectionWindows')}</option>
          <option value="NETWORK">{t('devices.connectionNetwork')}</option>
        </select>
      </div>
      {connection === 'SERIAL' || connection === 'USB' ? (
        <div className="space-y-2">
          <Label htmlFor="device-port">{t('devices.comPort')}</Label>
          <Input
            id="device-port"
            name="port"
            defaultValue={device?.port ?? ''}
            placeholder={t('devices.comPortExample')}
          />
        </div>
      ) : null}
      {connection === 'SERIAL' ? (
        <div className="space-y-2">
          <Label htmlFor="device-baud">{t('devices.baudRate')}</Label>
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
          <Label htmlFor="device-queue">{t('devices.windowsPrinterName')}</Label>
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
            <Label htmlFor="device-host">{t('devices.printerIp')}</Label>
            <Input
              id="device-host"
              name="host"
              defaultValue={device?.host ?? ''}
              placeholder="192.168.1.50"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="device-tcp">{t('devices.port')}</Label>
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
        {t('devices.inUse')}
      </label>
      <div className="flex flex-wrap gap-3">
        <Button type="submit">{t('devices.saveDevice')}</Button>
        <Button type="button" variant="outline" onClick={onClose}>
          {t('action.cancel')}
        </Button>
      </div>
    </form>
  );
}
