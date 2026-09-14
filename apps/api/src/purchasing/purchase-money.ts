import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@restaurant/database';
const D = Prisma.Decimal.clone({ precision: 50, rounding: Prisma.Decimal.ROUND_HALF_UP });
const max = new D('999999999999.99');
export function purchaseLine(quantity: string, unitPrice: string, taxRate: string) {
  const q = new D(quantity),
    p = new D(unitPrice),
    r = new D(taxRate);
  if (!q.isPositive() || p.isNegative() || r.isNegative() || r.gt(100))
    throw new BadRequestException('Invalid purchase quantity, price or tax');
  const subtotal = q.times(p).toDecimalPlaces(2),
    tax = subtotal.times(r).div(100).toDecimalPlaces(2),
    total = subtotal.plus(tax);
  if (total.gt(max)) throw new BadRequestException('Purchase amount exceeds supported range');
  return { subtotal: subtotal.toFixed(2), tax: tax.toFixed(2), total: total.toFixed(2) };
}
export function purchaseTotals(lines: { subtotal: string; tax: string; total: string }[]) {
  const sum = (key: 'subtotal' | 'tax' | 'total') =>
    lines.reduce((v, l) => v.plus(l[key]), new D(0));
  if (sum('total').gt(max)) throw new BadRequestException('Purchase total exceeds supported range');
  return {
    subtotal: sum('subtotal').toFixed(2),
    tax: sum('tax').toFixed(2),
    total: sum('total').toFixed(2),
  };
}
export function sumMoney(values: string[]) {
  return values.reduce((v, s) => v.plus(s), new D(0)).toFixed(2);
}
export function negateMoney(value: string) {
  return new D(value).negated().toFixed(2);
}
export function exceedsMoney(a: string, b: string) {
  return new D(a).gt(b);
}
