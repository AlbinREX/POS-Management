import { z } from 'zod';
import { imageUrlSchema } from './media';

const id = z.uuid();
const version = z.number().int().positive();
const money = z.string().regex(/^(0|[1-9]\d{0,11})\.\d{2}$/);
// Two decimals, strictly between 0 and 100: 0.01 to 99.99.
const percent = z
  .string()
  .regex(/^\d{1,2}\.\d{2}$/, 'Use a percentage such as 15.00')
  .refine((value) => value !== '0.00', 'Use a percentage above 0');
const uniqueIds = z
  .array(id)
  .refine((ids) => new Set(ids).size === ids.length, 'Duplicate IDs');

export const OFFER_KINDS = ['FIXED_PRICE', 'PERCENT_OFF'] as const;
export type OfferKind = (typeof OFFER_KINDS)[number];

export const offerInputSchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    description: z.string().trim().max(2000).nullable().default(null),
    imageUrl: imageUrlSchema,
    active: z.boolean().default(true),
    kind: z.enum(OFFER_KINDS),
    offerPrice: money.nullable().default(null),
    percentOff: percent.nullable().default(null),
    startsAt: z.iso.datetime({ offset: true }),
    endsAt: z.iso.datetime({ offset: true }),
    productIds: uniqueIds.min(1, 'Choose at least one product').max(100),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.kind === 'FIXED_PRICE' && (value.offerPrice === null || value.percentOff !== null))
      ctx.addIssue({ code: 'custom', path: ['offerPrice'], message: 'Enter the offer price' });
    if (value.kind === 'PERCENT_OFF' && (value.percentOff === null || value.offerPrice !== null))
      ctx.addIssue({ code: 'custom', path: ['percentOff'], message: 'Enter the percentage off' });
    if (Date.parse(value.endsAt) <= Date.parse(value.startsAt))
      ctx.addIssue({ code: 'custom', path: ['endsAt'], message: 'The offer must end after it starts' });
  });
export type OfferInput = z.infer<typeof offerInputSchema>;
export const offerUpdateSchema = z.object({ version, data: offerInputSchema }).strict();
export const offerArchiveSchema = z.object({ version }).strict();
export const offerListSchema = z
  .object({ archived: z.enum(['false', 'true']).default('false') })
  .strict();

/**
 * A new display order. Every row carries the version the operator saw, so reordering
 * over someone else's newer edit is refused instead of silently winning.
 */
export const menuReorderSchema = z
  .object({
    categoryId: id.optional(),
    items: z
      .array(z.object({ id, version }).strict())
      .min(1)
      .max(500)
      .refine((items) => new Set(items.map((i) => i.id)).size === items.length, 'Duplicate IDs'),
  })
  .strict();

// Integer cents throughout: no floating-point value ever touches a price.
const cents = (value: string) => {
  const [whole, fraction] = value.split('.');
  return BigInt(whole!) * 100n + BigInt(fraction!);
};
const amount = (value: bigint) => `${value / 100n}.${String(value % 100n).padStart(2, '0')}`;

/**
 * The unit price an offer produces for a product, as an exact two-decimal string.
 *
 * A fixed offer price never raises the price: if the base price has since dropped below
 * it, the base price stands. A percentage is taken off the base price and rounded half
 * up to the cent. This is the single implementation: the API charges with it and the
 * admin preview shows it, so the two cannot disagree.
 */
export function offerUnitPrice(
  basePrice: string,
  offer: { kind: OfferKind; offerPrice: string | null; percentOff: string | null },
): string {
  const base = cents(basePrice);
  if (offer.kind === 'FIXED_PRICE') {
    const fixed = cents(offer.offerPrice!);
    return amount(fixed < base ? fixed : base);
  }
  const basisPoints = cents(offer.percentOff!);
  return amount((base * (10000n - basisPoints) * 2n + 10000n) / 20000n);
}

/** Whether an offer applies at a given instant: active, not archived, inside its window. */
export function isOfferLive(
  offer: {
    active: boolean;
    deletedAt: string | Date | null;
    startsAt: string | Date;
    endsAt: string | Date;
  },
  at: Date,
): boolean {
  const time = at.getTime();
  return (
    offer.active &&
    !offer.deletedAt &&
    new Date(offer.startsAt).getTime() <= time &&
    time < new Date(offer.endsAt).getTime()
  );
}
