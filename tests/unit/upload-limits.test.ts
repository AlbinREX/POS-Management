import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MEDIA_LIMIT_BYTES } from '../../apps/api/src/media/media.service';
import { apiUpload, ApiFailure } from '../../apps/admin/src/lib/api';

const size = (value: string) => {
  const match = /^(\d+)([km]?)$/i.exec(value)!;
  const unit = match[2]!.toLowerCase();
  return Number(match[1]) * (unit === 'm' ? 1024 * 1024 : unit === 'k' ? 1024 : 1);
};
const limits = (conf: string) =>
  [...conf.matchAll(/client_max_body_size\s+(\S+);/g)].map((m) => size(m[1]!));
const block = (conf: string, location: string) =>
  new RegExp(`location ${location.replace(/[/.]/g, '\\$&')} \\{([^}]*)\\}`).exec(conf)?.[1];
const headers = (body: string) => body.match(/proxy_set_header [^;]+;/g) ?? [];

describe('the reverse proxy lets a menu photo reach the API, and nothing else grows', () => {
  for (const file of ['infrastructure/nginx/default.conf', 'infrastructure/nginx/production.conf']) {
    const conf = readFileSync(file, 'utf8');
    it(`${file}: 32 KB everywhere except the exact upload route`, () => {
      // Server-wide default stays at the JSON limit the API itself applies: it is set at
      // server level, before any location, so every route inherits it.
      const serverLevel = conf.slice(0, conf.indexOf('location '));
      expect(limits(serverLevel)).toEqual([32 * 1024]);
      const upload = block(conf, '= /api/media/menu');
      expect(upload, 'dedicated upload location').toBeDefined();
      const [uploadLimit] = limits(upload!);
      // Large enough for the API to see, and so answer, any file up to its own limit.
      expect(uploadLimit).toBeGreaterThanOrEqual(MEDIA_LIMIT_BYTES);
      expect(uploadLimit).toBeLessThanOrEqual(8 * 1024 * 1024);
      // The canonical path is forwarded, never the client's raw URI, so the larger limit
      // can only ever reach the upload route.
      expect(upload).toContain('proxy_pass http://api:4000/api/media/menu;');
      // Same forwarding headers as every other API call (Origin, client address, scheme).
      expect(headers(upload!)).toEqual(headers(block(conf, '/api/')!));
      // Exactly two limits in the file: the default and the upload route.
      expect(limits(conf).sort((a, b) => a - b)).toEqual([32 * 1024, uploadLimit]);
    });
  }
});

describe('an upload refused by the proxy says why', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('turns a proxy HTML 413 into the image size message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>413 Request Entity Too Large</html>', { status: 413, headers: { 'Content-Type': 'text/html' } })));
    const failure = await apiUpload('media/menu', new Blob([new Uint8Array(10)], { type: 'image/png' })).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(ApiFailure);
    expect((failure as ApiFailure).message).toBe('Images must be 5 MB or smaller');
    expect((failure as ApiFailure).status).toBe(413);
  });
  it('keeps the API message when the API itself answers 413', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ statusCode: 413, message: 'Images must be 5 MB or smaller' }, { status: 413 })));
    const failure = await apiUpload('media/menu', new Blob([new Uint8Array(10)])).catch((e: unknown) => e);
    expect((failure as ApiFailure).message).toBe('Images must be 5 MB or smaller');
  });
});
