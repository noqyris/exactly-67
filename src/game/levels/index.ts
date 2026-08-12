import type { LevelDef, LevelPack } from '../types'
import { pack1 } from './pack1'
import { pack2 } from './pack2'
import { pack3 } from './pack3'
import { pack4 } from './pack4'
import { pack5 } from './pack5'
import { pack6 } from './pack6'
import { pack7 } from './pack7'
import { pack8 } from './pack8'
import { pack9 } from './pack9'
import { pack10 } from './pack10'
import { pack11 } from './pack11'
import { pack12 } from './pack12'
import { pack13 } from './pack13'

/**
 * Packs 1-3 are hand-authored; 4+ come from `tools/generate-levels.ts`.
 * ORDER IS LOAD-BEARING: progress is persisted by global level number, so
 * packs may be appended but never reordered or resized.
 */
export const PACKS: readonly LevelPack[] = [pack1, pack2, pack3, pack4, pack5, pack6, pack7, pack8, pack9, pack10, pack11, pack12, pack13]

export const TOTAL_LEVELS = PACKS.reduce((n, p) => n + p.levels.length, 0)

export interface LevelRef {
  def: LevelDef
  pack: LevelPack
  packIndex: number
  /** Index within the pack, 0-based. */
  levelIndex: number
  /** 1-based number across all packs — the player-facing level number. */
  global: number
}

/** Resolve a 1-based global level number to its pack and definition. */
export function levelByGlobal(global: number): LevelRef | null {
  let offset = 0
  for (let p = 0; p < PACKS.length; p++) {
    const pack = PACKS[p]
    if (global <= offset + pack.levels.length) {
      const levelIndex = global - offset - 1
      if (levelIndex < 0) return null
      return { def: pack.levels[levelIndex], pack, packIndex: p, levelIndex, global }
    }
    offset += pack.levels.length
  }
  return null
}

export function globalOf(packIndex: number, levelIndex: number): number {
  let offset = 0
  for (let p = 0; p < packIndex; p++) offset += PACKS[p].levels.length
  return offset + levelIndex + 1
}
