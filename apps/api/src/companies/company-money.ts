import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@restaurant/database';
const D = Prisma.Decimal.clone({ precision: 50, rounding: Prisma.Decimal.ROUND_HALF_UP });
const max = new D('999999999999.99');
// Contract discount applies to the gross order total; the order's own immutable
// line snapshots are never rewritten by a company agreement.
export function contractDiscount(total: string, percentage: string) {
  const t = new D(total),
    r = new D(percentage);
  if (t.isNegative() || r.isNegative() || r.gt(100))
    throw new BadRequestException('Invalid contract total or discount percentage');
  const discount = t.times(r).div(100).toDecimalPlaces(2);
  return { discount: discount.toFixed(2), payable: t.minus(discount).toFixed(2) };
}
export function sumMoney(values: string[]) {
  const total = values.reduce((v, s) => v.plus(s), new D(0));
  if (total.abs().gt(max)) throw new BadRequestException('Company amount exceeds supported range');
  return total.toFixed(2);
}
export function negateMoney(value: string) {
  return new D(value).negated().toFixed(2);
}
export function exceedsMoney(a: string, b: string) {
  return new D(a).gt(b);
}
// Credit headroom never reports a negative figure: an over-limit account has zero available.
export function availableCredit(creditLimit: string, balance: string) {
  const available = new D(creditLimit).minus(balance);
  return available.isNegative() ? '0.00' : available.toFixed(2);
}
export function withinCredit(creditLimit: string, balance: string, amount: string) {
  return new D(balance).plus(amount).lte(creditLimit);
}
