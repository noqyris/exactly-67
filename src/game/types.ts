/** The fixed target on the left pan. The whole game is about matching it. */
export const TARGET = 67

/**
 * One level: a tray of weights the player may place on the right pan.
 * Positive values are down-weights, negative values are lift-weights
 * (balloons). The right-pan total is simply the sum of placed values.
 */
export interface LevelDef {
  /** Signed weight values. Order is the tray order. */
  weights: number[]
  /** Indices of weights that start on the pan and cannot be removed. */
  locked?: number[]
  /** Piece budget: at most this many weights on the pan (locked included). */
  maxWeights?: number
  /** Every weight must be on the pan to clear the level. */
  useAll?: boolean
  /** Short onboarding line shown above the tray. */
  hint?: string
}

export interface LevelPack {
  id: string
  name: string
  /** One-line flavor shown on the level map. */
  tagline: string
  levels: LevelDef[]
}

/** What the beam/HUD needs to know after any change to the pan. */
export interface Evaluation {
  /** Sum of placed values (down-weights minus balloon lift). */
  total: number
  /** total - TARGET; 0 means the beam is level. */
  gap: number
  /** The beam is level (total === TARGET) — not necessarily a win. */
  balanced: boolean
  /** Level cleared: balanced AND all constraints satisfied. */
  won: boolean
  /** When balanced but not won, the constraint that still blocks the win. */
  blockedReason?: 'use-all'
}
