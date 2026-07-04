/**
 * Persistent player progress, keyed by global level number (1-based, across
 * all packs in order). Pure merge logic lives here so it can be unit-tested;
 * reading/writing the store is services/storage.ts.
 */
export interface Progress {
  /** Best star rating per cleared level (1–3). */
  stars: Record<string, number>
  /** Fewest weights ever used to clear the level. */
  best: Record<string, number>
}

export function emptyProgress(): Progress {
  return { stars: {}, best: {} }
}

/** Record a clear, keeping the best star rating and lowest weight count. */
export function mergeClear(
  progress: Progress,
  globalLevel: number,
  stars: number,
  weightsUsed: number,
): Progress {
  const key = String(globalLevel)
  const prevStars = progress.stars[key] ?? 0
  const prevBest = progress.best[key]
  return {
    stars: { ...progress.stars, [key]: Math.max(prevStars, stars) },
    best: {
      ...progress.best,
      [key]: prevBest === undefined ? weightsUsed : Math.min(prevBest, weightsUsed),
    },
  }
}

export function starsFor(progress: Progress, globalLevel: number): number {
  return progress.stars[String(globalLevel)] ?? 0
}

export function bestFor(progress: Progress, globalLevel: number): number | undefined {
  return progress.best[String(globalLevel)]
}

export function isCleared(progress: Progress, globalLevel: number): boolean {
  return starsFor(progress, globalLevel) > 0
}

/**
 * Level 1 is always open; each level unlocks when the previous is cleared.
 * A cleared level itself always stays replayable.
 */
export function isUnlocked(progress: Progress, globalLevel: number): boolean {
  return (
    globalLevel === 1 ||
    isCleared(progress, globalLevel) ||
    isCleared(progress, globalLevel - 1)
  )
}

export function totalStars(progress: Progress): number {
  return Object.values(progress.stars).reduce((sum, s) => sum + s, 0)
}

/** Defensive parse of a persisted blob — bad data degrades to a fresh start. */
export function parseProgress(raw: string | null | undefined): Progress {
  if (!raw) return emptyProgress()
  try {
    const data = JSON.parse(raw) as Partial<Progress>
    const clean = (rec: unknown, max: number): Record<string, number> => {
      const out: Record<string, number> = {}
      if (rec && typeof rec === 'object') {
        for (const [k, v] of Object.entries(rec as Record<string, unknown>)) {
          const n = Number(v)
          if (Number.isInteger(n) && n >= 1 && n <= max && /^\d+$/.test(k)) out[k] = n
        }
      }
      return out
    }
    return { stars: clean(data.stars, 3), best: clean(data.best, 99) }
  } catch {
    return emptyProgress()
  }
}
