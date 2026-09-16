// Exact money arithmetic for report aggregation. Sums accumulate as bigint cents and
// the only division (average ticket) runs through decimal.js with ROUND_HALF_UP, so no
// figure passes through binary floating point.
import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@restaurant/database';
import { cents, money } from '../payments/payment-money';
const D = Prisma.Decimal.clone({ precision: 50, rounding: Prisma.Decimal.ROUND_HALF_UP });
const max = new D('999999999999.99');
const bounded = (value: Prisma.Decimal) => {
  if (value.abs().gt(max))
    throw new BadRequestException('Report total exceeds the supported range');
  return value.toFixed(2);
};
/** A database decimal as fixed two-place text; null aggregates read as zero. */
export const moneyText = (value: Prisma.Decimal | null | undefined) => value?.toFixed(2) ?? '0.00';
export const minusMoney = (a: string, b: string) => bounded(new D(a).minus(b));
export const averageMoney = (total: string, count: number) =>
  count > 0 ? bounded(new D(total).div(count).toDecimalPlaces(2)) : '0.00';
export const compareMoney = (a: string, b: string) => {
  const x = cents(a),
    y = cents(b);
  return x < y ? -1 : x > y ? 1 : 0;
};
export const maxMoney = (a: string, b: string) => (compareMoney(a, b) >= 0 ? a : b);
export { cents, money };
