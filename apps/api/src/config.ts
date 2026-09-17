import { z } from 'zod';
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().startsWith('postgresql://'),
  JWT_SECRET: z
    .string()
    .min(64)
    .refine((value) => !value.includes('CHANGE_ME'), 'Placeholder secrets are prohibited'),
  APP_ORIGIN: z.url(),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  TRUST_PROXY: z.enum(['0', '1']).default('0'),
});
// A production deployment must never start on placeholder or example configuration.
// The seed already refuses placeholders at bootstrap; this refuses them at every API
// start, so a half-configured stack fails immediately and visibly rather than serving.
const PLACEHOLDER = /CHANGE_ME|example\.invalid|^changeme$/i;
function assertProductionSecrets(config: z.infer<typeof schema>) {
  if (config.NODE_ENV !== 'production') return;
  const url = new URL(config.DATABASE_URL);
  const password = decodeURIComponent(url.password);
  if (!password) throw new Error('Production requires a database password');
  if (PLACEHOLDER.test(password))
    throw new Error('Production rejects placeholder database credentials');
  if (password.length < 24)
    throw new Error('Production requires a database password of at least 24 characters');
  if (PLACEHOLDER.test(config.JWT_SECRET))
    throw new Error('Production rejects placeholder secrets');
  if (new Set(config.JWT_SECRET).size < 16)
    throw new Error('JWT_SECRET must be high-entropy random material');
  if (['localhost', '127.0.0.1', '[::1]'].includes(new URL(config.APP_ORIGIN).hostname))
    throw new Error('Production APP_ORIGIN must not be loopback');
}
export function getConfig() {
  const config = schema.parse(process.env);
  const origin = new URL(config.APP_ORIGIN);
  if (origin.origin !== config.APP_ORIGIN || origin.username || origin.password)
    throw new Error('APP_ORIGIN must be an exact origin without a trailing slash');
  if (config.NODE_ENV === 'production' && origin.protocol !== 'https:')
    throw new Error('Production requires an HTTPS APP_ORIGIN');
  if (
    origin.protocol !== 'https:' &&
    !['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)
  )
    throw new Error('HTTP is allowed only on loopback');
  assertProductionSecrets(config);
  return config;
}
export const ACCESS_SECONDS = 300;
export const SESSION_MS = 12 * 60 * 60 * 1000;
export const COOKIE_NAME = 'restaurant_refresh';
