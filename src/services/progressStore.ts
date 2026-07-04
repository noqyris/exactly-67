import type { Progress } from '../game/progress'
import { emptyProgress, mergeClear } from '../game/progress'
import { loadProgress, saveProgress } from './storage'

/**
 * In-memory copy of the persisted progress, loaded once at boot so scenes
 * can read it synchronously. Every clear is merged and written through.
 */
let current: Progress = emptyProgress()

export async function initProgress(): Promise<void> {
  current = await loadProgress()
}

export function progress(): Progress {
  return current
}

export function recordClear(globalLevel: number, stars: number, weightsUsed: number): void {
  current = mergeClear(current, globalLevel, stars, weightsUsed)
  void saveProgress(current)
}
