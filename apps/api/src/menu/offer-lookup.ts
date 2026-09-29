import type { Prisma } from '@restaurant/database';
import type { ProductOffer } from '@restaurant/shared-types';
import { offerUnitPrice } from '@restaurant/validation';

type Scope = { organizationId: string; branchId: string };
export type OfferRow = Prisma.OfferGetPayload<object>;

/**
 * The offer that applies to each product at one instant.
 *
 * Overlapping offers for a product are refused when saved, so at most one is live. The
 * ordering is still explicit so that, whatever the data, a product is priced by exactly
 * one offer, the most recently started, and offers never stack.
 */
export async function liveOffers(
  tx: Prisma.TransactionClient,
  scope: Scope,
  productIds: string[],
  at: Date,
): Promise<Map<string, OfferRow>> {
  const live = new Map<string, OfferRow>();
  if (!productIds.length) return live;
  const links = await tx.offerProduct.findMany({
    where: {
      ...scope,
      productId: { in: productIds },
      offer: { active: true, deletedAt: null, startsAt: { lte: at }, endsAt: { gt: at } },
    },
    include: { offer: true },
    orderBy: [{ offer: { startsAt: 'desc' } }, { offerId: 'asc' }],
  });
  for (const link of links) if (!live.has(link.productId)) live.set(link.productId, link.offer);
  return live;
}

export const offerTerms = (offer: OfferRow) => ({
  kind: offer.kind,
  offerPrice: offer.offerPrice?.toFixed(2) ?? null,
  percentOff: offer.percentOff?.toFixed(2) ?? null,
});

export function productOffer(basePrice: string, offer: OfferRow): ProductOffer {
  return {
    id: offer.id,
    name: offer.name,
    kind: offer.kind,
    price: offerUnitPrice(basePrice, offerTerms(offer)),
    endsAt: offer.endsAt.toISOString(),
  };
}
