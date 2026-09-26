import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import {
  imageUrlSchema,
  isMenuMediaPath,
  isOfferLive,
  menuReorderSchema,
  offerInputSchema,
  offerUnitPrice,
  productSchema,
} from '@restaurant/validation';
import { renderMenuImage, sniffImage } from '../../apps/api/src/media/media.service';
import { offerStatus } from '../../apps/api/src/menu/offers.service';

const fixed = (offerPrice: string) => ({ kind: 'FIXED_PRICE' as const, offerPrice, percentOff: null });
const percent = (percentOff: string) => ({ kind: 'PERCENT_OFF' as const, offerPrice: null, percentOff });

describe('offer pricing is exact and never raises a price', () => {
  it('uses a fixed offer price below the base price', () => {
    expect(offerUnitPrice('3.50', fixed('2.99'))).toBe('2.99');
    expect(offerUnitPrice('3.50', fixed('0.00'))).toBe('0.00');
  });
  it('keeps the base price when a fixed offer is no longer below it', () => {
    // The base price may have dropped after the offer was set up.
    expect(offerUnitPrice('2.50', fixed('2.99'))).toBe('2.50');
  });
  it('takes a percentage off and rounds half up to the cent', () => {
    expect(offerUnitPrice('3.50', percent('15.00'))).toBe('2.98'); // 2.975
    expect(offerUnitPrice('3.50', percent('10.00'))).toBe('3.15');
    expect(offerUnitPrice('0.05', percent('50.00'))).toBe('0.03'); // 0.025
    expect(offerUnitPrice('0.05', percent('99.99'))).toBe('0.00');
    expect(offerUnitPrice('999999999999.99', percent('0.01'))).toBe('999899999999.99');
  });
  it('agrees with integer arithmetic where binary floating point would drift', () => {
    // 1.15 * 0.9 is 1.0349999... in floating point; the exact answer rounds to 1.04.
    expect(offerUnitPrice('1.15', percent('10.00'))).toBe('1.04');
    expect(offerUnitPrice('0.29', percent('50.00'))).toBe('0.15');
  });
});

describe('offer windows', () => {
  const now = new Date('2026-09-26T12:00:00.000Z');
  const window = { active: true, deletedAt: null, startsAt: '2026-09-26T00:00:00.000Z', endsAt: '2026-09-30T00:00:00.000Z' };
  it('applies only while active, not archived and inside the half-open window', () => {
    expect(isOfferLive(window, now)).toBe(true);
    expect(isOfferLive({ ...window, active: false }, now)).toBe(false);
    expect(isOfferLive({ ...window, deletedAt: now }, now)).toBe(false);
    expect(isOfferLive(window, new Date(window.startsAt))).toBe(true);
    expect(isOfferLive(window, new Date(window.endsAt))).toBe(false);
    expect(isOfferLive(window, new Date('2026-09-25T23:59:59.999Z'))).toBe(false);
  });
  it('derives a status for management views', () => {
    const row = { active: true, deletedAt: null, startsAt: new Date(window.startsAt), endsAt: new Date(window.endsAt) };
    expect(offerStatus(row, now)).toBe('LIVE');
    expect(offerStatus(row, new Date('2026-09-20T00:00:00Z'))).toBe('SCHEDULED');
    expect(offerStatus(row, new Date('2026-10-01T00:00:00Z'))).toBe('EXPIRED');
    expect(offerStatus({ ...row, active: false }, now)).toBe('INACTIVE');
    expect(offerStatus({ ...row, deletedAt: now }, now)).toBe('ARCHIVED');
  });
});

describe('offer input', () => {
  const base = {
    name: 'Riza week',
    kind: 'FIXED_PRICE',
    offerPrice: '2.99',
    startsAt: '2026-09-26T00:00:00+02:00',
    endsAt: '2026-09-30T23:59:00+02:00',
    productIds: ['8b6f2f4e-9e7b-4c6a-9d1e-2f3a4b5c6d7e'],
  };
  it('accepts a fixed or a percentage offer, each with only its own value', () => {
    expect(offerInputSchema.safeParse(base).success).toBe(true);
    expect(offerInputSchema.safeParse({ ...base, kind: 'PERCENT_OFF', offerPrice: null, percentOff: '12.50' }).success).toBe(true);
    expect(offerInputSchema.safeParse({ ...base, percentOff: '10.00' }).success).toBe(false);
    expect(offerInputSchema.safeParse({ ...base, kind: 'PERCENT_OFF', offerPrice: null }).success).toBe(false);
  });
  it('refuses a percentage outside 0 to 100, a backwards window, no products and money floats', () => {
    for (const percentOff of ['0.00', '100.00', '12.5', '-5.00'])
      expect(offerInputSchema.safeParse({ ...base, kind: 'PERCENT_OFF', offerPrice: null, percentOff }).success).toBe(false);
    expect(offerInputSchema.safeParse({ ...base, endsAt: base.startsAt }).success).toBe(false);
    expect(offerInputSchema.safeParse({ ...base, productIds: [] }).success).toBe(false);
    expect(offerInputSchema.safeParse({ ...base, offerPrice: 2.99 }).success).toBe(false);
    expect(offerInputSchema.safeParse({ ...base, branchId: base.productIds[0] }).success).toBe(false);
  });
  it('requires complete, duplicate-free reorder lists with versions', () => {
    const id = base.productIds[0]!;
    expect(menuReorderSchema.safeParse({ items: [{ id, version: 1 }] }).success).toBe(true);
    expect(menuReorderSchema.safeParse({ items: [{ id }] }).success).toBe(false);
    expect(menuReorderSchema.safeParse({ items: [{ id, version: 1 }, { id, version: 1 }] }).success).toBe(false);
  });
});

describe('product images stay on one field', () => {
  it('recognises only the exact managed upload path', () => {
    expect(isMenuMediaPath('/api/media/menu/8b6f2f4e-9e7b-4c6a-9d1e-2f3a4b5c6d7e.webp')).toBe(true);
    expect(isMenuMediaPath('/api/media/menu/../../etc/passwd')).toBe(false);
    expect(isMenuMediaPath('/food/riza-burger.webp')).toBe(false);
  });
  it('keeps bundled paths and http(s) URLs, and refuses scripts and data URLs', () => {
    expect(imageUrlSchema.safeParse('/food/riza-burger.webp').success).toBe(true);
    expect(imageUrlSchema.safeParse('javascript:alert(1)').success).toBe(false);
    expect(imageUrlSchema.safeParse('data:image/png;base64,AAAA').success).toBe(false);
    expect(imageUrlSchema.safeParse('//evil.example/x.png').success).toBe(false);
  });
  it('treats sold-out as optional so an edit that omits it keeps the stored value', () => {
    const product = {
      kind: 'products',
      name: 'Riza Burger',
      sku: 'RIZA',
      categoryId: '8b6f2f4e-9e7b-4c6a-9d1e-2f3a4b5c6d7e',
      sellingPrice: '3.50',
      taxRate: '0.00',
      taxMode: 'INCLUSIVE',
    };
    expect(productSchema.parse(product).soldOut).toBeUndefined();
    expect(productSchema.parse({ ...product, soldOut: true }).soldOut).toBe(true);
  });
});

describe('menu image uploads', () => {
  const image = (format: 'png' | 'jpeg' | 'webp', width = 400, height = width) =>
    sharp({ create: { width, height, channels: 3, background: '#f4c451' } })[format]().toBuffer();
  it('identifies formats by their bytes, not by any declared type', async () => {
    expect(sniffImage(await image('png'))).toBe('png');
    expect(sniffImage(await image('jpeg'))).toBe('jpeg');
    expect(sniffImage(await image('webp'))).toBe('webp');
    expect(sniffImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull();
    expect(sniffImage(Buffer.from('GIF89a'))).toBeNull();
  });
  it('renders every accepted format as a 1024 px WebP square, cropped to cover', async () => {
    for (const [format, width, height] of [['png', 400, 400], ['jpeg', 1600, 900], ['webp', 300, 1200]] as const) {
      const out = await sharp(await renderMenuImage(await image(format, width, height))).metadata();
      expect([out.format, out.width, out.height]).toEqual(['webp', 1024, 1024]);
    }
  });
  it('refuses empty, unknown, damaged, too small and too large images', async () => {
    await expect(renderMenuImage(Buffer.alloc(0))).rejects.toThrow('Choose a PNG, JPEG or WebP image');
    await expect(renderMenuImage(Buffer.from('plain text'))).rejects.toThrow('Choose a PNG, JPEG or WebP image');
    const png = await image('png');
    await expect(renderMenuImage(png.subarray(0, 60))).rejects.toThrow('This image is damaged or incomplete');
    await expect(renderMenuImage(await image('png', 120))).rejects.toThrow('at least 200');
    await expect(renderMenuImage(await image('png', 8200, 300))).rejects.toThrow('at most 8000');
    await expect(renderMenuImage(Buffer.concat([png, Buffer.alloc(5 * 1024 * 1024)]))).rejects.toThrow('5 MB');
  });
});
