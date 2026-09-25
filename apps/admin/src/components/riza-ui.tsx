'use client';

import { useState, type ReactNode } from 'react';
import { useI18n } from '../lib/i18n';

export function Brand() {
  const { t } = useI18n();
  return (
    <div className="riza-brand">
      <span className="riza-mark" aria-hidden="true">
        R
      </span>
      <div>
        <strong>FastFood Riza</strong>
        <span>{t('brand.workspace')}</span>
      </div>
    </div>
  );
}

export function NavIcon({ name }: { name: string }) {
  const paths: Record<string, string> = {
    Workspace: 'm3 10 9-7 9 7v11h-6v-7H9v7H3Z',
    Dashboard: 'M3 21h18M6 17V10M11 17V5M16 17v-4M21 17V8',
    POS: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',
    Orders: 'M6 3h12v18l-3-2-3 2-3-2-3 2ZM9 7h6M9 11h6M9 15h3',
    Layout: 'M4 7h16v10H4ZM7 3v4M17 3v4M7 17v4M17 17v4',
    Kitchen: 'M4 15h16M6 15a6 6 0 0 1 12 0M12 7V5M3 19h18',
    Menu: 'M4 4h7a3 3 0 0 1 3 3v14a3 3 0 0 0-3-3H4ZM14 7a3 3 0 0 1 3-3h4v14h-4a3 3 0 0 0-3 3',
    Purchasing:
      'M3 5h11v12H3ZM14 9h4l4 5v3h-8M6 21a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM18 21a2 2 0 1 0 0-4 2 2 0 0 0 0 4',
    Inventory: 'm12 3 9 5v9l-9 5-9-5V8ZM3 8l9 5 9-5M12 13v9M7 5l10 5',
    Companies: 'M3 21h18M5 21V7l7-4 7 4v14M9 10h2M9 14h2M13 10h2M13 14h2M11 21v-4h2v4',
    Payments: 'M3 5h18v14H3ZM3 10h18M7 15h4',
    Team: 'M8 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM2 21v-3a6 6 0 0 1 12 0v3M17 4a4 4 0 0 1 0 8M18 15a5 5 0 0 1 4 5',
    Roles: 'm12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6ZM8 12l3 3 5-6',
    Terminals: 'M3 3h18v14H3ZM8 21h8M12 17v4',
    Devices: 'M4 7h16v6H4ZM7 13v6h10v-6M8 4h8v3H8ZM8 16h3',
    'Audit history': 'M12 7v5l3 2M3 12a9 9 0 1 0 3-7M3 3v5h5',
  };
  return (
    <svg
      width="21"
      height="21"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name] ?? paths.POS} />
    </svg>
  );
}

export function ProductImage({ name, src }: { name: string; src?: string | null }) {
  const { t } = useI18n();
  const [failed, setFailed] = useState<string | null>(null);
  return (
    <div className="product-image">
      {src && failed !== src ? (
        // Configured catalog URLs can belong to a restaurant's LAN; no image proxy is required.
        <img src={src} alt={name} loading="lazy" onError={() => setFailed(src)} />
      ) : (
        <div className="product-placeholder" aria-label={t('report.noImage', { name })}>
          <span aria-hidden="true">{name.slice(0, 1).toUpperCase()}</span>
          <small>{t('report.freshFromOurKitchen')}</small>
        </div>
      )}
    </div>
  );
}

export function OptionalDetails({
  compact,
  title,
  children,
}: {
  compact: boolean;
  title: string;
  children: ReactNode;
}) {
  return compact ? (
    <details className="riza-details">
      <summary>{title}</summary>
      <div className="space-y-3 pt-3">{children}</div>
    </details>
  ) : (
    <>{children}</>
  );
}
