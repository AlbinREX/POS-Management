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

// A photo bundled with the app under /food/. Its name may contain spaces, but never a
// separator, drive colon, percent-escape or parent-directory step. Control characters are
// refused for every value below.
const BUNDLED_PATH = /^\/food\/(?!.*\.\.)[^\\/%:]+$/;
// Tabs, newlines and other control characters are stripped by URL parsers, so a value
// containing one could resolve to something other than what validation saw.
const hasControlCharacter = (value: string) =>
  [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code < 0x20 || code === 0x7f;
  });

/**
 * Where a product or offer image may point. An absolute http(s) URL can reach a
 * restaurant's own LAN host. Root-relative values are an allowlist, not a guess: an
 * uploaded menu image or a photo bundled with the app. That keeps stored rows portable
 * across localhost, a LAN address and any deployment, and guarantees that a photo chosen
 * on this PC is stored as its upload, never as a local path in any spelling (C:\...,
 * /C:/..., /c/Users/..., /C%3A/..., UNC or file:).
 */
export const imageUrlSchema = z
  .string()
  .trim()
  .max(2048)
  .refine(
    (url) =>
      !hasControlCharacter(url) &&
      !url.includes('\\') &&
      (/^https?:\/\/[^/]/i.test(url) || MENU_MEDIA_PATH.test(url) || BUNDLED_PATH.test(url)),
    'Use an HTTP or HTTPS image URL, or an app path such as /food/burger.webp',
  )
  .nullable()
  .default(null);
