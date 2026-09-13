import { Prisma } from '@restaurant/database';

// Local constructor: do not mutate global Decimal precision used by other modules.
const D = Prisma.Decimal.clone({ precision: 40, rounding: Prisma.Decimal.ROUND_HALF_UP });
const max = new D('999999999999.99');
const cents = (v: InstanceType<typeof D>) => BigInt(v.toDecimalPlaces(2).times(100).toFixed(0));
const money = (v: bigint) => new D(v.toString()).div(100).toFixed(2);
export interface PriceLine {
  id: string;
  unitPrice: string;
  quantity: number;
  taxRate: string;
  taxMode: 'INCLUSIVE' | 'EXCLUSIVE';
  adjustments: string[];
}
export function calculateOrder(lines: PriceLine[], discount: string) {
  const prepared = lines.map((line) => {
    const unit = line.adjustments.reduce((sum, value) => sum.plus(value), new D(line.unitPrice));
    if (unit.isNegative()) throw new Error('Modifiers produce a negative unit price');
    const factor = new D(line.taxRate).div(100).plus(1);
    const gross = unit
      .times(line.quantity)
      .times(line.taxMode === 'EXCLUSIVE' ? factor : 1)
      .toDecimalPlaces(2);
    if (gross.gt(max)) throw new Error('Order amount exceeds supported range');
    return { id: line.id, gross: cents(gross), factor, allocation: 0n, remainder: 0n };
  });
  const subtotal = prepared.reduce((sum, line) => sum + line.gross, 0n);
  const off = cents(new D(discount));
  if (off < 0n || off > subtotal) throw new Error('Discount exceeds order subtotal');
  if (new D(money(subtotal)).gt(max)) throw new Error('Order amount exceeds supported range');
  if (subtotal > 0n) {
    for (const line of prepared) {
      line.allocation = (off * line.gross) / subtotal;
      line.remainder = (off * line.gross) % subtotal;
    }
    let remaining = off - prepared.reduce((sum, line) => sum + line.allocation, 0n);
    for (const line of [...prepared].sort((a, b) =>
      a.remainder === b.remainder ? a.id.localeCompare(b.id) : a.remainder > b.remainder ? -1 : 1,
    )) {
      if (remaining === 0n) break;
      line.allocation++;
      remaining--;
    }
  }
  let tax = 0n;
  const items = prepared.map((line) => {
    const total = line.gross - line.allocation;
    const gross = new D(money(total));
    const includedTax = cents(gross.minus(gross.div(line.factor)));
    tax += includedTax;
    return {
      id: line.id,
      subtotal: money(line.gross),
      discount: money(line.allocation),
      total: money(total),
      tax: money(includedTax),
    };
  });
  return {
    subtotal: money(subtotal),
    discount: money(off),
    total: money(subtotal - off),
    tax: money(tax),
    items,
  };
}
