import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_ROLE_PERMISSIONS, PERMISSIONS } from '@restaurant/shared-types';

// getConfig() reads process.env at call time, so each case sets a complete environment
// and restores it afterwards. These guards are the last line before a production API
// serves traffic on placeholder or weak configuration.
const ORIGINAL = { ...process.env };
afterEach(() => {
  for (const key of Object.keys(process.env)) if (!(key in ORIGINAL)) delete process.env[key];
  Object.assign(process.env, ORIGINAL);
});

const STRONG_SECRET = 'a7Kq2ZmX9pR4tY6wL1nB8vC3dF5gH0jS2kM4qP6rT8uW0xY1zA3bE5cG7iJ9lN2o';
const STRONG_DB_PASSWORD = 'k4Jd82nZq0vXm5Tb7Yc1Rw9Ps3Lh6Ge';

function env(overrides: Record<string, string | undefined> = {}) {
  for (const key of Object.keys(process.env))
    if (key.startsWith('SEED_') || key.startsWith('APP_') || key.startsWith('POSTGRES_'))
      delete process.env[key];
  Object.assign(process.env, {
    NODE_ENV: 'production',
    DATABASE_URL: `postgresql://restaurant_app:${STRONG_DB_PASSWORD}@db:5432/restaurant`,
    JWT_SECRET: STRONG_SECRET,
    APP_ORIGIN: 'https://pos.restaurant.invalid',
    PORT: '4000',
    TRUST_PROXY: '1',
    ...overrides,
  });
}

async function load() {
  // The module caches nothing, but a fresh import keeps each case independent.
  const module = await import('../../apps/api/src/config');
  return module.getConfig;
}

describe('production configuration guards', () => {
  it('accepts a fully configured production environment', async () => {
    env();
    const getConfig = await load();
    expect(getConfig().NODE_ENV).toBe('production');
  });
  it('refuses placeholder database credentials', async () => {
    env({
      DATABASE_URL:
        'postgresql://restaurant_app:CHANGE_ME_RANDOM_RUNTIME_PASSWORD@db:5432/restaurant',
    });
    const getConfig = await load();
    expect(() => getConfig()).toThrow(/placeholder database credentials/i);
  });
  it('refuses a short database password even when it is not a placeholder', async () => {
    env({ DATABASE_URL: 'postgresql://restaurant_app:short-password@db:5432/restaurant' });
    const getConfig = await load();
    expect(() => getConfig()).toThrow(/at least 24 characters/i);
  });
  it('refuses a placeholder JWT secret', async () => {
    env({ JWT_SECRET: 'CHANGE_ME_GENERATE_64_OR_MORE_RANDOM_CHARACTERS_AAAAAAAAAAAAAAAAAAA' });
    const getConfig = await load();
    expect(() => getConfig()).toThrow(/placeholder/i);
  });
  it('refuses a long but low-entropy JWT secret', async () => {
    // Length alone is not strength: a repeated character passes min(64) but is not random.
    env({ JWT_SECRET: 'a'.repeat(80) });
    const getConfig = await load();
    expect(() => getConfig()).toThrow(/high-entropy/i);
  });
  it('refuses a loopback production origin', async () => {
    env({ APP_ORIGIN: 'https://localhost' });
    const getConfig = await load();
    expect(() => getConfig()).toThrow(/must not be loopback/i);
  });
  it('still refuses a non-HTTPS production origin', async () => {
    env({ APP_ORIGIN: 'http://pos.restaurant.invalid' });
    const getConfig = await load();
    expect(() => getConfig()).toThrow(/HTTPS/i);
  });
  it('leaves development and test environments unrestricted by the production guards', async () => {
    // Local development must keep working with loopback HTTP and simple local secrets.
    env({
      NODE_ENV: 'development',
      APP_ORIGIN: 'http://localhost:3000',
      DATABASE_URL: 'postgresql://restaurant_app:short@127.0.0.1:5432/restaurant',
    });
    const getConfig = await load();
    expect(getConfig().NODE_ENV).toBe('development');
  });
});

describe('operational permission defaults', () => {
  it('registers ops.read and grants it only to owner, admin and manager', () => {
    expect(PERMISSIONS).toContain('ops.read');
    for (const role of ['OWNER', 'ADMIN', 'MANAGER'] as const)
      expect(DEFAULT_ROLE_PERMISSIONS[role]).toContain('ops.read');
    for (const role of ['CASHIER', 'WAITER', 'KITCHEN', 'STOREKEEPER'] as const)
      expect(DEFAULT_ROLE_PERMISSIONS[role]).not.toContain('ops.read');
  });
});
