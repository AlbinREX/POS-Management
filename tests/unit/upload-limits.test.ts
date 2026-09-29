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

describe('the reverse proxy lets a menu photo reach the API, and nothing else grows', () => {
  for (const file of ['infrastructure/nginx/default.conf', 'infrastructure/nginx/production.conf']) {
    const conf = readFileSync(file, 'utf8');
    it(`${file}: 32 KB everywhere except the exact upload route`, () => {
      // Server-wide default stays at the JSON limit the API itself applies.
      expect(conf).toMatch(/server_tokens off;[\s\S]*?client_max_body_size 32k;/);
      const upload = /location = \/api\/media\/menu \{([\s\S]*?)\}/.exec(conf);
      expect(upload, 'dedicated upload location').not.toBeNull();
      const [uploadLimit] = limits(upload![1]!);
      // Large enough for the API to see, and so answer, any file up to its own limit.
      expect(uploadLimit).toBeGreaterThanOrEqual(MEDIA_LIMIT_BYTES);
      expect(uploadLimit).toBeLessThanOrEqual(8 * 1024 * 1024);
      expect(upload![1]).toContain('proxy_pass http://api:4000;');
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
