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
  return config;
}
export const ACCESS_SECONDS = 300;
export const SESSION_MS = 12 * 60 * 60 * 1000;
export const COOKIE_NAME = 'restaurant_refresh';
