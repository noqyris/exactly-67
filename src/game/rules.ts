import { isBalanced, panTotal } from './balance'
import type { Evaluation, LevelDef } from './types'
import { TARGET } from './types'

/** placed[i] === true means weights[i] is on the right pan. */
export type Placement = boolean[]

export function initialPlacement(level: LevelDef): Placement {
  const placed = level.weights.map(() => false)
  for (const i of level.locked ?? []) placed[i] = true
  return placed
}

export function isLocked(level: LevelDef, index: number): boolean {
  return (level.locked ?? []).includes(index)
}

export function placedCount(placed: Placement): number {
  return placed.reduce((n, p) => n + (p ? 1 : 0), 0)
}

export function placedValues(level: LevelDef, placed: Placement): number[] {
  return level.weights.filter((_, i) => placed[i])
}

export function rightTotal(level: LevelDef, placed: Placement): number {
  return panTotal(placedValues(level, placed))
}

export type PlaceRefusal = 'already-placed' | 'budget-full'

/** Can weights[index] move from the tray to the pan right now? */
export function canPlace(
  level: LevelDef,
  placed: Placement,
  index: number,
): { ok: boolean; reason?: PlaceRefusal } {
  if (placed[index]) return { ok: false, reason: 'already-placed' }
  if (level.maxWeights !== undefined && placedCount(placed) >= level.maxWeights) {
    return { ok: false, reason: 'budget-full' }
  }
  return { ok: true }
}

/** Locked weights never come back off the pan. */
export function canRemove(level: LevelDef, placed: Placement, index: number): boolean {
  return placed[index] === true && !isLocked(level, index)
}

export function place(level: LevelDef, placed: Placement, index: number): Placement {
  if (!canPlace(level, placed, index).ok) return placed
  const next = placed.slice()
  next[index] = true
  return next
}

export function remove(level: LevelDef, placed: Placement, index: number): Placement {
  if (!canRemove(level, placed, index)) return placed
  const next = placed.slice()
  next[index] = false
  return next
}

/**
 * The single source of truth after any pan change: totals, beam state and
 * whether the level is actually cleared. A `useAll` level can sit balanced
 * at 67 without being won — the remaining weights must come aboard too
 * (they net to zero thanks to balloons).
 */
export function evaluate(level: LevelDef, placed: Placement): Evaluation {
  const total = rightTotal(level, placed)
  const balanced = isBalanced(total)
  const allPlaced = placed.every(Boolean)
  const blockedByUseAll = balanced && level.useAll === true && !allPlaced
  return {
    total,
    gap: total - TARGET,
    balanced,
    won: balanced && !blockedByUseAll,
    ...(blockedByUseAll ? { blockedReason: 'use-all' as const } : {}),
  }
}
