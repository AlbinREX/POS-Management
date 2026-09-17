'use client';
import { useCallback, useEffect, useState } from 'react';
import type { FiscalHandoffState, FiscalOrderStatus, SessionUser } from '@restaurant/shared-types';
import { Button } from '@restaurant/ui/button';
import { api, ApiFailure } from '../lib/api';

/**
 * Compact fiscal handoff state for one order.
 *
 * This reports delivery to the external fiscal provider, never the payment itself. A
 * failed handoff says nothing about whether the sale was paid: the order remains PAID
 * and its totals are untouched, which the wording here is careful not to blur.
 */
const LABEL: Record<FiscalHandoffState, string> = {
  PENDING: 'Fiscal: pending',
  SENT: 'Fiscal: sent',
  CONFIRMED: 'Fiscal: confirmed',
  FAILED: 'Fiscal: failed',
  RETRY_REQUIRED: 'Fiscal: retry required',
};
const TONE: Record<FiscalHandoffState, 'ok' | 'warn' | 'bad'> = {
  PENDING: 'warn',
  SENT: 'warn',
  CONFIRMED: 'ok',
  FAILED: 'bad',
  RETRY_REQUIRED: 'bad',
};

export function FiscalStatus({ user, orderId }: { user: SessionUser; orderId: string }) {
  const canRead = user.permissions.includes('fiscal.read');
  const canRetry = user.permissions.includes('fiscal.retry');
  const [status, setStatus] = useState<FiscalOrderStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!canRead) return;
    try {
      setStatus(await api<FiscalOrderStatus>(`fiscal/orders/${orderId}`));
    } catch {
      // Fiscal visibility is supplementary: a failure here must never disturb the
      // payment view, which is the authoritative record of the sale.
      setStatus(null);
    }
  }, [canRead, orderId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!canRead || !status || status.state === null) return null;
  const retry = async () => {
    setBusy(true);
    setError('');
    try {
      await api(`fiscal/orders/${orderId}/retry`, 'POST', {});
      await load();
    } catch (e) {
      setError(e instanceof ApiFailure ? e.message : 'The fiscal handoff could not be retried.');
    } finally {
      setBusy(false);
    }
  };
  const unresolved = status.state !== 'CONFIRMED' && status.state !== 'SENT';
  return (
    <p className="fiscal-status" role="status" aria-label={LABEL[status.state]}>
      <span className="fiscal-dot" data-tone={TONE[status.state]} aria-hidden="true" />
      <span>{LABEL[status.state]}</span>
      {status.providerReference ? <span>· {status.providerReference}</span> : null}
      {canRetry && unresolved ? (
        <Button
          type="button"
          size="xs"
          variant="outline"
          disabled={busy}
          onClick={() => void retry()}
        >
          Retry
        </Button>
      ) : null}
      {error ? <span className="fiscal-error">{error}</span> : null}
    </p>
  );
}
