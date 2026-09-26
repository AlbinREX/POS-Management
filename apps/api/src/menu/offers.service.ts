import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@restaurant/database';
import type { OfferRecord, OfferStatus } from '@restaurant/shared-types';
import { offerUnitPrice, type OfferInput } from '@restaurant/validation';
import type { Principal } from '../auth/auth.service';
import { audit } from '../audit';
import { DatabaseService } from '../database.service';
import { MediaService } from '../media/media.service';
import { offerTerms } from './offer-lookup';

const scope = (p: Principal) => ({ organizationId: p.organizationId, branchId: p.branchId });
const context = (p: Principal) => ({
  ...scope(p),
  userId: p.userId,
  terminalId: p.terminalId,
  requestId: p.requestId,
  ip: p.ip,
});
const include = {
  products: { include: { product: true }, orderBy: { productId: 'asc' as const } },
};
type Row = Prisma.OfferGetPayload<{ include: typeof include }>;

export function offerStatus(
  offer: { active: boolean; deletedAt: Date | null; startsAt: Date; endsAt: Date },
  at: Date,
): OfferStatus {
  if (offer.deletedAt) return 'ARCHIVED';
  if (!offer.active) return 'INACTIVE';
  if (at < offer.startsAt) return 'SCHEDULED';
  if (at >= offer.endsAt) return 'EXPIRED';
  return 'LIVE';
}

function record(row: Row, at: Date): OfferRecord {
  const terms = offerTerms(row);
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    imageUrl: row.imageUrl,
    kind: row.kind,
    offerPrice: terms.offerPrice,
    percentOff: terms.percentOff,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    active: row.active,
    status: offerStatus(row, at),
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    deletedAt: row.deletedAt?.toISOString() ?? null,
    products: row.products.map(({ product }) => ({
      id: product.id,
      name: product.name,
      basePrice: product.sellingPrice.toFixed(2),
      offerPrice: offerUnitPrice(product.sellingPrice.toFixed(2), terms),
    })),
  };
}

/**
 * Promotions. An offer never changes a product's normal price: POS reads show what it
 * would charge now, and the order service freezes that price onto each order line.
 */
@Injectable()
export class OffersService {
  constructor(
    private readonly db: DatabaseService,
    private readonly media: MediaService,
  ) {}
  private async row(tx: Prisma.TransactionClient, p: Principal, id: string) {
    const row = await tx.offer.findFirst({ where: { id, ...scope(p) }, include });
    if (!row) throw new NotFoundException('Offer not found');
    return row;
  }
  async get(p: Principal, id: string) {
    return record(await this.row(this.db.client, p, id), new Date());
  }
  async list(p: Principal, archived: boolean) {
    const rows = await this.db.client.offer.findMany({
      where: { ...scope(p), deletedAt: archived ? { not: null } : null },
      include,
      orderBy: [{ startsAt: 'desc' }, { id: 'asc' }],
      take: 200,
    });
    const now = new Date();
    return rows.map((row) => record(row, now));
  }
  private editable(row: Row, version: number) {
    if (row.deletedAt) throw new ConflictException('Archived records cannot be changed');
    if (row.version !== version)
      throw new ConflictException('This record changed. Reload before saving.');
  }
  async save(p: Principal, input: OfferInput, id?: string, version?: number) {
    let replacedImage: string | null | undefined;
    const saved = await this.db.client.$transaction(
      async (tx) => {
        const before = id ? await this.row(tx, p, id) : undefined;
        if (before) this.editable(before, version!);
        const products = await tx.product.findMany({
          where: { ...scope(p), id: { in: input.productIds }, deletedAt: null },
        });
        if (products.length !== input.productIds.length)
          throw new ConflictException('An offer product is unavailable');
        if (input.kind === 'FIXED_PRICE') {
          const offer = new Prisma.Decimal(input.offerPrice!);
          const tooHigh = products.find((product) => offer.gte(product.sellingPrice));
          if (tooHigh)
            throw new ConflictException(
              `The offer price must be below the normal price of ${tooHigh.name}`,
            );
        }
        const startsAt = new Date(input.startsAt);
        const endsAt = new Date(input.endsAt);
        // Offers never stack: an active offer may not share a product and any moment
        // with another active offer. Serializable isolation keeps two concurrent saves
        // from both passing this check.
        if (input.active) {
          const clash = await tx.offerProduct.findFirst({
            where: {
              ...scope(p),
              productId: { in: input.productIds },
              ...(id ? { offerId: { not: id } } : {}),
              offer: { active: true, deletedAt: null, startsAt: { lt: endsAt }, endsAt: { gt: startsAt } },
            },
            include: { offer: true, product: true },
            orderBy: [{ productId: 'asc' }, { offerId: 'asc' }],
          });
          if (clash)
            throw new ConflictException(
              `${clash.product.name} already has the offer ${clash.offer.name} at that time`,
            );
        }
        if (input.imageUrl !== (before?.imageUrl ?? null))
          await this.media.assertAvailable(tx, input.imageUrl);
        const data = {
          name: input.name,
          description: input.description,
          imageUrl: input.imageUrl,
          kind: input.kind,
          offerPrice: input.offerPrice === null ? null : new Prisma.Decimal(input.offerPrice),
          percentOff: input.percentOff === null ? null : new Prisma.Decimal(input.percentOff),
          startsAt,
          endsAt,
          active: input.active,
        };
        const savedId = (
          id
            ? await tx.offer.update({
                where: { id, ...scope(p), version, deletedAt: null },
                data: { ...data, version: { increment: 1 } },
              })
            : await tx.offer.create({ data: { ...scope(p), ...data } })
        ).id;
        if (id) await tx.offerProduct.deleteMany({ where: { offerId: id, ...scope(p) } });
        await tx.offerProduct.createMany({
          data: input.productIds.map((productId) => ({ ...scope(p), offerId: savedId, productId })),
        });
        const now = new Date();
        const after = record(await this.row(tx, p, savedId), now);
        const snapshot = (value: OfferRecord) => JSON.parse(JSON.stringify(value));
        await audit(
          tx,
          context(p),
          id ? 'menu.offers.updated' : 'menu.offers.created',
          'offers',
          savedId,
          before ? snapshot(record(before, now)) : undefined,
          snapshot(after),
        );
        if (before && before.active !== after.active)
          await audit(
            tx,
            context(p),
            after.active ? 'menu.offers.activated' : 'menu.offers.deactivated',
            'offers',
            savedId,
            { active: before.active },
            { active: after.active },
          );
        if (before && before.imageUrl !== after.imageUrl) replacedImage = before.imageUrl;
        return after;
      },
      { isolationLevel: 'Serializable', timeout: 15000 },
    );
    await this.media.release(replacedImage);
    return saved;
  }
  /** Archive rather than delete: order lines priced by this offer keep referring to it. */
  archive(p: Principal, id: string, version: number) {
    return this.db.client.$transaction(
      async (tx) => {
        const before = await this.row(tx, p, id);
        this.editable(before, version);
        await tx.offer.update({
          where: { id, ...scope(p), version, deletedAt: null },
          data: { active: false, deletedAt: new Date(), version: { increment: 1 } },
        });
        const now = new Date();
        const after = record(await this.row(tx, p, id), now);
        await audit(
          tx,
          context(p),
          'menu.offers.archived',
          'offers',
          id,
          JSON.parse(JSON.stringify(record(before, now))),
          JSON.parse(JSON.stringify(after)),
        );
        return after;
      },
      { isolationLevel: 'Serializable', timeout: 15000 },
    );
  }
}
