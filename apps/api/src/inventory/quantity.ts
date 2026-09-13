import { BadRequestException } from '@nestjs/common';
import type { InventoryUnitCode } from '@restaurant/shared-types';

const scale = 1_000_000n;
const limit = 10n ** 20n;
export const units: Record<InventoryUnitCode, { dimension: string; factor: bigint }> = {
  kg: { dimension: 'MASS', factor: 1000n }, g: { dimension: 'MASS', factor: 1n },
  l: { dimension: 'VOLUME', factor: 1000n }, ml: { dimension: 'VOLUME', factor: 1n },
  pcs: { dimension: 'COUNT', factor: 1n },
};
export function quantityMicros(value: string) {
  if (!/^-?\d+(\.\d{1,6})?$/.test(value)) throw new BadRequestException('Use an exact decimal quantity with up to six places');
  const [whole, fraction = ''] = value.replace('-', '').split('.');
  const result = (BigInt(whole) * scale + BigInt(fraction.padEnd(6, '0'))) * (value.startsWith('-') ? -1n : 1n);
  if (result <= -limit || result >= limit) throw new BadRequestException('Inventory quantity exceeds supported range');
  return result;
}
export function quantityText(value: bigint) {
  if (value <= -limit || value >= limit) throw new BadRequestException('Inventory quantity exceeds supported range');
  const absolute = value < 0n ? -value : value;
  return `${value < 0n ? '-' : ''}${absolute / scale}.${(absolute % scale).toString().padStart(6, '0')}`;
}
export function convertQuantity(value: string, from: InventoryUnitCode, to: InventoryUnitCode) {
  const a = units[from], b = units[to];
  if (!a || !b || a.dimension !== b.dimension) throw new BadRequestException('Incompatible inventory units');
  const numerator = quantityMicros(value) * a.factor;
  if (numerator % b.factor) throw new BadRequestException('Unit conversion would require rounding');
  return quantityText(numerator / b.factor);
}
