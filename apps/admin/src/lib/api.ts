import type { AuthResult } from '@restaurant/shared-types';
let accessToken: string | undefined;
let refreshInFlight: Promise<AuthResult> | undefined;
export class ApiFailure extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}
async function parse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new ApiFailure(
      body.message ?? 'The local server is unavailable. Try again.',
      response.status,
    );
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}
export async function refresh(): Promise<AuthResult> {
  if (!refreshInFlight) {
    const perform = async () => {
      const result = await parse<AuthResult>(
        await fetch('/api/auth/refresh', {
          method: 'POST',
          credentials: 'same-origin',
          cache: 'no-store',
        }),
      );
      accessToken = result.accessToken;
      return result;
    };
    // Serializes cookie rotation across tabs where Web Locks is available.
    const run = async (): Promise<AuthResult> =>
      'locks' in navigator
        ? await navigator.locks.request('restaurant-refresh', perform)
        : perform();
    refreshInFlight = run().finally(() => {
      refreshInFlight = undefined;
    });
  }
  return refreshInFlight;
}
export async function login(body: unknown) {
  const result = await parse<AuthResult>(
    await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(body),
      cache: 'no-store',
    }),
  );
  accessToken = result.accessToken;
  return result;
}
export async function logout() {
  await parse<void>(
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' }),
  );
  accessToken = undefined;
}
export async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const request = () =>
    fetch(`/api/${path}`, {
      method,
      credentials: 'same-origin',
      cache: 'no-store',
      headers: {
        Authorization: `Bearer ${accessToken ?? ''}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  let response = await request();
  if (response.status === 401) {
    await refresh();
    response = await request();
  }
  return parse<T>(response);
}
// Binary sibling of api() for CSV exports: same bearer token and refresh-retry, but the
// body is returned as a Blob with the server's filename instead of being parsed as JSON.
export async function apiBlob(path: string): Promise<{ blob: Blob; filename: string }> {
  const request = () =>
    fetch(`/api/${path}`, {
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { Authorization: `Bearer ${accessToken ?? ''}` },
    });
  let response = await request();
  if (response.status === 401) {
    await refresh();
    response = await request();
  }
  if (!response.ok) await parse<never>(response);
  const disposition = response.headers.get('Content-Disposition') ?? '';
  const match = /filename="([^"]+)"/.exec(disposition);
  return { blob: await response.blob(), filename: match?.[1] ?? 'report.csv' };
}
