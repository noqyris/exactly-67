import { dayKey } from '../game/days'
import type { Meta } from '../game/meta'
import { emptyMeta, parseMeta } from '../game/meta'
import { loadMetaRaw, saveMetaRaw } from './storage'

/**
 * In-memory copy of the meta-game blob (game/meta.ts), loaded once at boot so
 * scenes and services read it synchronously, and written through on every
 * change — the same shape as progressStore.ts. No game rules live here: the
 * orchestration is services/progression.ts, the rules are src/game.
 */
let current: Meta = emptyMeta()
/** Whether a blob existed on disk at boot (false = first 1.3.0 launch or new install). */
let existed = false

export async function initMeta(): Promise<void> {
  const raw = await loadMetaRaw()
  existed = raw !== null
  current = parseMeta(raw)
}

export function metaExisted(): boolean {
  return existed
}

export function meta(): Meta {
  return current
}

/** Apply a change and persist it. Returns the new value. */
export function updateMeta(change: (m: Meta) => Meta): Meta {
  const next = change(current)
  if (next !== current) {
    current = next
    void saveMetaRaw(JSON.stringify(current))
  }
  return current
}

/** Today's local day key — the one clock every daily rule reads. */
export function today(): string {
  return dayKey(new Date())
}

/** Test seam: reset module state. */
export function _resetMetaForTests(m: Meta = emptyMeta()): void {
  current = m
  existed = false
}
