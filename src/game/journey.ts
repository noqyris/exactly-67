/**
 * Where the player stands on the 600-level journey, as pure rules the screens
 * share: the next level to play, the pack it sits in, what each level-map cell
 * and pack card shows, and how a Daily calendar day reads.
 *
 * The menu's Continue button, the Daily screen's Continue button and the level
 * map's open shelf must all name the same level, so it is computed once, here.
 */
import { isUnlocked, starsFor } from './progress'
import type { Progress } from './progress'

/** The first level not yet cleared (the last level once every one is). */
export function nextLevel(p: Progress, total: number): number {
  let next = 1
  while (next < total && starsFor(p, next) > 0) next++
  return next
}

/** The pack (0-based) holding a global level, from the packs' sizes in order. */
export function packIndexOf(packSizes: readonly number[], global: number): number {
  let first = 1
  for (let i = 0; i < packSizes.length; i++) {
    if (global < first + packSizes[i]) return i
    first += packSizes[i]
  }
  return Math.max(0, packSizes.length - 1)
}

/**
 * What a level-map cell shows:
 * - `cleared`: its number and stars;
 * - `open`: playable, not cleared yet (the "current" cell);
 * - `next`: locked, but the very next one to open (its predecessor is open);
 * - `locked`: the rest of the road.
 * `unlockAll` is the opt-in test build's every-level-open flag (buildFlags.ts).
 */
export type CellState = 'cleared' | 'open' | 'next' | 'locked'

export function cellState(p: Progress, global: number, unlockAll = false): CellState {
  if (unlockAll || isUnlocked(p, global)) return starsFor(p, global) > 0 ? 'cleared' : 'open'
  return global > 1 && isUnlocked(p, global - 1) ? 'next' : 'locked'
}

/**
 * A pack is locked while none of its levels is playable. Not "its first level
 * is locked": a stray clear further in (an every-level-open test build, an old
 * save) opens that level, and its pack must not read as closed around it.
 */
export function packLocked(p: Progress, firstGlobal: number, count: number, unlockAll = false): boolean {
  if (unlockAll) return false
  for (let g = firstGlobal; g < firstGlobal + count; g++) if (isUnlocked(p, g)) return false
  return true
}

/** What opens a locked pack: clearing the last level of the pack before it. */
export function packUnlockLevel(firstGlobal: number): number {
  return Math.max(1, firstGlobal - 1)
}

/**
 * How a day of the Daily calendar reads. `missed` is a past day of this month
 * without a solve: still replayable (it counts toward the monthly trophy), so it
 * has to look different from both a solved day and a day still to come.
 */
export type DayMark = 'solved' | 'today' | 'missed' | 'future'

export function dayMark(key: string, todayKey: string, solved: boolean): DayMark {
  if (key > todayKey) return 'future'
  if (key === todayKey) return solved ? 'solved' : 'today'
  return solved ? 'solved' : 'missed'
}
