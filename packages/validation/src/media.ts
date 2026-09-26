import { z } from 'zod';

/**
 * A menu image uploaded to this installation. The API stores every upload under a random
 * UUID, re-encoded to WebP, so this exact shape is the only managed path; anything else is
 * an external URL or an image bundled with the app.
 */
export const MENU_MEDIA_PATH =
  /^\/api\/media\/menu\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.webp$/;
export const isMenuMediaPath = (value: string | null | undefined): value is string =>
  typeof value === 'string' && MENU_MEDIA_PATH.test(value);

export const imageUrlSchema = z
  .string()
  .trim()
  .max(2048)
  .refine(
    // An absolute http(s) URL can point at a restaurant's own LAN host, and a
    // root-relative path lets images bundled with the app, and uploaded menu images, stay
    // portable across localhost, a LAN address and any deployment without rewriting
    // stored rows. Protocol-relative ("//host") and scheme-bearing values such as
    // javascript: or data: remain rejected.
    (url) => /^https?:\/\/[^/]/i.test(url) || /^\/[^/]/.test(url),
    'Use an HTTP or HTTPS image URL, or an app path such as /food/burger.webp',
  )
  .nullable()
  .default(null);
