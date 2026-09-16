// Branch-local date boundaries resolved to UTC instants with no dependency beyond Intl.
// Every report bucket is a civil day in the branch's IANA timezone, so DST transition
// days are legitimately 23 or 25 hours long and never split or double-count a sale.
import { BadRequestException } from '@nestjs/common';

export type RangePreset = 'today' | 'yesterday' | 'week' | 'month' | 'custom';
export interface UtcRange {
  from: Date;
  to: Date;
  fromDate: string;
  toDate: string;
  timezone: string;
}
const ymd = /^(\d{4})-(\d{2})-(\d{2})$/;
function split(date: string): [number, number, number] {
  const m = ymd.exec(date);
  if (!m) throw new BadRequestException('Dates must be YYYY-MM-DD');
  const parts: [number, number, number] = [Number(m[1]), Number(m[2]), Number(m[3])];
  // Date.UTC rolls month 13 or February 30 forward instead of failing; reject those.
  const utc = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  if (utc.toISOString().slice(0, 10) !== date) throw new BadRequestException('Invalid date');
  return parts;
}
const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(timezone: string) {
  let f = formatters.get(timezone);
  if (!f) {
    try {
      f = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        hourCycle: 'h23',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        weekday: 'short',
      });
    } catch {
      throw new BadRequestException('Branch timezone is not a valid IANA zone');
    }
    formatters.set(timezone, f);
  }
  return f;
}
function parts(instant: Date, timezone: string) {
  const p = Object.fromEntries(
    formatter(timezone)
      .formatToParts(instant)
      .map((x) => [x.type, x.value]),
  );
  return {
    year: Number(p.year),
    month: Number(p.month),
    day: Number(p.day),
    hour: Number(p.hour),
    minute: Number(p.minute),
    second: Number(p.second),
    weekday: String(p.weekday),
  };
}
// Offset (ms) between the branch wall clock and UTC at a given instant.
function offsetMs(instant: Date, timezone: string) {
  const p = parts(instant, timezone);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - instant.getTime();
}
/** The UTC instant of local midnight at the start of a branch calendar day. */
export function localMidnightUtc(date: string, timezone: string): Date {
  const [y, m, d] = split(date);
  const guess = Date.UTC(y, m - 1, d);
  // Two passes converge across a DST transition: the first offset is measured at the
  // naive guess, the second at the corrected instant.
  let offset = offsetMs(new Date(guess), timezone);
  offset = offsetMs(new Date(guess - offset), timezone);
  return new Date(guess - offset);
}
/** The branch calendar date (YYYY-MM-DD) that contains a UTC instant. */
export function localDate(instant: Date, timezone: string): string {
  const p = parts(instant, timezone);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}
/** The branch local hour (0-23) of a UTC instant. */
export function localHour(instant: Date, timezone: string): number {
  return parts(instant, timezone).hour;
}
function shiftDate(date: string, days: number): string {
  const [y, m, d] = split(date);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}
/** Inclusive calendar range [fromDate, toDate] as a half-open UTC interval [from, to). */
export function dayRange(fromDate: string, toDate: string, timezone: string): UtcRange {
  const from = localMidnightUtc(fromDate, timezone);
  const to = localMidnightUtc(shiftDate(toDate, 1), timezone);
  if (to.getTime() <= from.getTime())
    throw new BadRequestException('Range end must not precede its start');
  return { from, to, fromDate, toDate, timezone };
}
/** Enumerate every branch calendar day in a range, in order. */
export function eachDay(range: UtcRange): string[] {
  const days: string[] = [];
  for (let d = range.fromDate; d <= range.toDate; d = shiftDate(d, 1)) days.push(d);
  return days;
}
/** Resolve a named preset to a branch-local calendar range anchored on `now`. */
export function presetRange(
  preset: Exclude<RangePreset, 'custom'>,
  timezone: string,
  now = new Date(),
): UtcRange {
  const today = localDate(now, timezone);
  if (preset === 'today') return dayRange(today, today, timezone);
  if (preset === 'yesterday') {
    const y = shiftDate(today, -1);
    return dayRange(y, y, timezone);
  }
  if (preset === 'week') {
    // ISO week: Monday through Sunday, in the branch calendar.
    const weekday = parts(now, timezone).weekday;
    const back = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 }[weekday] ?? 0;
    return dayRange(shiftDate(today, -back), today, timezone);
  }
  return dayRange(today.slice(0, 8) + '01', today, timezone);
}
