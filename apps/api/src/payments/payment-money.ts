// Integer cents only. No rounding through binary floating point.
export function cents(value: string): bigint {
  if (!/^-?(0|[1-9]\d{0,11})\.\d{2}$/.test(value)) throw new Error('Invalid decimal money');
  return BigInt(value.replace('.', ''));
}
export function money(value: bigint): string {
  const absolute = value < 0n ? -value : value;
  if (absolute > 99999999999999n) throw new Error('Money exceeds supported range');
  return `${value < 0n ? '-' : ''}${absolute / 100n}.${(absolute % 100n).toString().padStart(2, '0')}`;
}
export function unitCents(total: string, quantity: number, unit: number): bigint {
  if (
    !Number.isInteger(quantity) ||
    quantity < 1 ||
    !Number.isInteger(unit) ||
    unit < 1 ||
    unit > quantity
  )
    throw new Error('Invalid unit selection');
  const amount = cents(total),
    count = BigInt(quantity);
  if (amount < 0n) throw new Error('Invalid line total');
  return amount / count + (BigInt(unit) <= amount % count ? 1n : 0n);
}
export function cashChange(amount: string, tendered: string): string {
  const due = cents(amount),
    received = cents(tendered);
  if (due <= 0n || received < due) throw new Error('Tendered cash is less than payment');
  return money(received - due);
}
