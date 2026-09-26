import { presentTray } from '../tray'
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
import { pack14 } from './pack14'
import { pack15 } from './pack15'
import { pack16 } from './pack16'
import { pack17 } from './pack17'
import { pack18 } from './pack18'
import { pack19 } from './pack19'
import { pack20 } from './pack20'
import { pack21 } from './pack21'
import { pack22 } from './pack22'
import { pack23 } from './pack23'
import { pack24 } from './pack24'
import { pack25 } from './pack25'

/**
 * Packs 1-3 are hand-authored; 4+ come from `tools/generate-levels.ts`.
 * ORDER IS LOAD-BEARING: progress is persisted by global level number, so
 * packs may be appended but never reordered or resized.
 */
export const PACKS: readonly LevelPack[] = [pack1, pack2, pack3, pack4, pack5, pack6, pack7, pack8, pack9, pack10, pack11, pack12, pack13, pack14, pack15, pack16, pack17, pack18, pack19, pack20, pack21, pack22, pack23, pack24, pack25]

export const TOTAL_LEVELS = PACKS.reduce((n, p) => n + p.levels.length, 0)

export interface LevelRef {
  /** The PRESENTED level: the authored one with its tray de-ordered (`tray.ts`). */
  def: LevelDef
  pack: LevelPack
  packIndex: number
  /** Index within the pack, 0-based. */
  levelIndex: number
  /** 1-based number across all packs — the player-facing level number. */
  global: number
}

/**
 * Presented defs by global number: one shuffle search per level per session.
 * `tools/generate-levels.ts` rewrites this file wholesale, so its template has to
 * carry this presentation step too, or a regeneration silently drops it.
 */
const presented = new Map<number, LevelDef>()

/**
 * Resolve a 1-based global level number to its pack and definition. The def is
 * the one players see — the authored tray de-ordered by `presentTray`, seeded by
 * the global number — so everything downstream (the scene, stars, "way N of M",
 * the capture director) works on one order. `PACKS` itself stays raw: it is
 * what the build gate validates and what authors edit.
 */
export function levelByGlobal(global: number): LevelRef | null {
  let offset = 0
  for (let p = 0; p < PACKS.length; p++) {
    const pack = PACKS[p]
    if (global <= offset + pack.levels.length) {
      const levelIndex = global - offset - 1
      if (levelIndex < 0) return null
      let def = presented.get(global)
      if (!def) {
        def = presentTray(pack.levels[levelIndex], global)
        presented.set(global, def)
      }
      return { def, pack, packIndex: p, levelIndex, global }
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
