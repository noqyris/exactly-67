import { TARGET } from './types'

/** Maximum visual tilt of the beam, in degrees (right side down = positive). */
export const MAX_BEAM_ANGLE_DEG = 13

/**
 * Gap at which the beam is near its maximum tilt. Small gaps still read
 * clearly (gap 1 ≈ 1°) while huge overshoots saturate instead of flipping
 * the scale over.
 */
const ANGLE_SOFTNESS = 18

export function panTotal(values: readonly number[]): number {
  return values.reduce((sum, v) => sum + v, 0)
}

export function gapToTarget(total: number): number {
  return total - TARGET
}

export function isBalanced(total: number): boolean {
  return total === TARGET
}

/**
 * Deterministic beam angle from the totals alone. Positive = right pan
 * sinks (right side heavier), negative = right pan rises. Exactly 67 → 0.
 */
export function beamAngleDeg(total: number): number {
  return MAX_BEAM_ANGLE_DEG * Math.tanh(gapToTarget(total) / ANGLE_SOFTNESS)
}
