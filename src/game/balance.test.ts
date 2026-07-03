import { describe, expect, it } from 'vitest'
import { beamAngleDeg, gapToTarget, isBalanced, MAX_BEAM_ANGLE_DEG, panTotal } from './balance'
import { TARGET } from './types'

describe('panTotal', () => {
  it('sums an empty pan to 0', () => {
    expect(panTotal([])).toBe(0)
  })

  it('adds down-weights and subtracts balloon lift via signed values', () => {
    // 40 + 32 down, 5 of lift: 72 - 5 = 67
    expect(panTotal([40, 32, -5])).toBe(67)
  })
})

describe('gap and balance', () => {
  it('is balanced only at exactly 67', () => {
    expect(isBalanced(TARGET)).toBe(true)
    expect(isBalanced(66)).toBe(false)
    expect(isBalanced(68)).toBe(false)
  })

  it('reports the signed gap', () => {
    expect(gapToTarget(67)).toBe(0)
    expect(gapToTarget(70)).toBe(3)
    expect(gapToTarget(60)).toBe(-7)
  })
})

describe('beamAngleDeg', () => {
  it('is exactly level at 67', () => {
    expect(beamAngleDeg(TARGET)).toBe(0)
  })

  it('tips right-side-down when the right pan is heavier', () => {
    expect(beamAngleDeg(70)).toBeGreaterThan(0)
    expect(beamAngleDeg(60)).toBeLessThan(0)
  })

  it('is antisymmetric around the target', () => {
    expect(beamAngleDeg(67 + 9)).toBeCloseTo(-beamAngleDeg(67 - 9), 10)
  })

  it('is monotonic in the gap', () => {
    let prev = beamAngleDeg(0)
    for (let total = 1; total <= 140; total++) {
      const angle = beamAngleDeg(total)
      expect(angle).toBeGreaterThan(prev)
      prev = angle
    }
  })

  it('saturates instead of tipping past the max angle', () => {
    expect(Math.abs(beamAngleDeg(1000))).toBeLessThanOrEqual(MAX_BEAM_ANGLE_DEG)
    expect(Math.abs(beamAngleDeg(-1000))).toBeLessThanOrEqual(MAX_BEAM_ANGLE_DEG)
    // But a huge overshoot still gets close to it.
    expect(Math.abs(beamAngleDeg(1000))).toBeGreaterThan(MAX_BEAM_ANGLE_DEG * 0.95)
  })

  it('shows a visible tilt for a gap of 1', () => {
    expect(Math.abs(beamAngleDeg(68))).toBeGreaterThan(0.5)
  })
})
