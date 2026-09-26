/**
 * Calendar days as `YYYY-MM-DD` keys, in the player's LOCAL time zone.
 *
 * Everything that happens "once a day" — the Daily Challenge board, the streak,
 * the daily gift, the rewarded-ad caps — keys off these, so it all rolls over
 * together at the player's own midnight (the Wordle model: the same board for
 * the same calendar date everywhere). It used to be UTC, which put the rollover
 * at 17:00 in Los Angeles and 01:00 in Belgrade — a streak deadline in the
 * middle of an American afternoon.
 *
 * Arithmetic works on the key, never on a local Date: `Date.UTC` of the key's
 * y/m/d has no DST, so "add one day" is always exactly one calendar day even
 * across a 23- or 25-hour local day. Pure: no DOM, no Capacitor.
 */

const MS_PER_DAY = 86_400_000

const pad = (n: number) => String(n).padStart(2, '0')

/** The local calendar day of `now`, e.g. "2026-09-23". */
export function dayKey(now: Date): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

/** True for a well-formed key (used to validate persisted data). */
export function isDayKey(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [y, m, d] = value.split('-').map(Number)
  return m >= 1 && m <= 12 && d >= 1 && d <= daysInMonthOf(y, m)
}

function parts(key: string): [number, number, number] {
  const [y, m, d] = key.split('-').map(Number)
  return [y, m, d]
}

/** Days since 1970-01-01 for the key's calendar date — a DST-free day number. */
export function dayNumber(key: string): number {
  const [y, m, d] = parts(key)
  return Math.round(Date.UTC(y, m - 1, d) / MS_PER_DAY)
}

function fromDayNumber(n: number): string {
  const date = new Date(n * MS_PER_DAY)
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
}

/** The key `n` calendar days after `key` (negative goes back). */
export function addDays(key: string, n: number): string {
  return fromDayNumber(dayNumber(key) + n)
}

/** Whole calendar days from `a` to `b` (positive when `b` is later). */
export function daysBetween(a: string, b: string): number {
  return dayNumber(b) - dayNumber(a)
}

/** "2026-09" for "2026-09-23". */
export function monthOf(key: string): string {
  return key.slice(0, 7)
}

function daysInMonthOf(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}

/** Number of days in the month of `key` (or of a "YYYY-MM" month key). */
export function daysInMonth(key: string): number {
  const [y, m] = key.split('-').map(Number)
  return daysInMonthOf(y, m)
}

/** Every day key of the month `month` ("YYYY-MM"), first to last. */
export function monthDays(month: string): string[] {
  const n = daysInMonth(month)
  return Array.from({ length: n }, (_, i) => `${month}-${pad(i + 1)}`)
}

/** Weekday of `key`, Monday = 0 … Sunday = 6 (calendar grids start on Monday). */
export function weekdayMon0(key: string): number {
  const [y, m, d] = parts(key)
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7
}

/** Milliseconds from `now` until the next local midnight — the next board. */
export function msUntilNextDay(now: Date): number {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
  return Math.max(0, next.getTime() - now.getTime())
}

/** "5h 20m" / "12m" — a short, true countdown to the next board. */
export function formatCountdown(ms: number): string {
  const totalMin = Math.max(1, Math.ceil(ms / 60_000))
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}
