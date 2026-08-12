import { describe, expect, it } from 'vitest'
import { peakOf, shareCard, traceGlyphs, undoCount } from './share'

describe('traceGlyphs', () => {
  it('marks a landing on 67 with the green square', () => {
    expect(traceGlyphs([67])).toBe('🟩')
  })

  it('reads rises as weights and falls as balloons', () => {
    // 72 down, then a balloon back to 67.
    expect(traceGlyphs([72, 67])).toBe('⬛🟩')
  })

  it('shows the overshoot-then-rescue shape the game is built on', () => {
    // Level 71's real route: 72 → 125 → 100 → 79 → 67.
    expect(traceGlyphs([72, 125, 100, 79, 67])).toBe('⬛⬛🎈🎈🟩')
  })

  it('marks a piece coming back off', () => {
    expect(traceGlyphs([40, 40, 67])).toBe('⬛↩︎🟩')
  })

  it('does not green a final total that is not 67', () => {
    expect(traceGlyphs([40, 68])).toBe('⬛⬛')
  })
})

describe('peakOf', () => {
  it('reports the furthest the pan got from the target', () => {
    expect(peakOf([72, 125, 100, 79, 67])).toBe(125)
  })

  it('ignores a low start — an unfinished pan is not an overshoot', () => {
    expect(peakOf([-20, 30, 67])).toBe(67)
    expect(peakOf([31, 59, 83, 64, 67])).toBe(83)
  })

  it('is the target itself when nothing ever left it', () => {
    expect(peakOf([67])).toBe(67)
  })
})

describe('undoCount', () => {
  it('counts removals', () => {
    expect(undoCount([40, 40, 67])).toBe(1)
    expect(undoCount([72, 125, 100, 79, 67])).toBe(0)
  })
})

describe('shareCard', () => {
  it('encodes the route and never the answer', () => {
    const card = shareCard(
      { level: 71, pieces: 5, stars: 3, way: 1, waysTotal: 1 },
      [72, 125, 100, 79, 67],
    )
    expect(card).toBe('Exactly 67 · Level 71\n⬛⬛🎈🎈🟩\n5 pieces · peak 125 · the only way · ★★★')
    // Spoiler-free: no individual weight value appears as a standalone number.
    // (Substring matching would be wrong here — "12" lives inside "peak 125",
    // and the peak is a total we deliberately publish.)
    const numbers = card.match(/\d+/g) ?? []
    for (const w of ['72', '53', '41', '40', '12']) expect(numbers).not.toContain(w)
  })

  it('names which way when the level has several', () => {
    const card = shareCard(
      { level: 30, pieces: 4, stars: 2, way: 2, waysTotal: 3 },
      [50, 90, 67],
    )
    expect(card).toContain('way 2/3')
  })

  it('includes a time only when one was recorded', () => {
    const base = { level: 5, pieces: 2, stars: 3, waysTotal: 1 }
    expect(shareCard(base, [67])).not.toMatch(/\ds/)
    expect(shareCard({ ...base, seconds: 12.4 }, [67])).toContain('12s')
  })

  it('omits the peak when the pan never went over 67', () => {
    expect(shareCard({ level: 1, pieces: 1, stars: 3, waysTotal: 1 }, [67]))
      .not.toContain('peak')
    expect(shareCard({ level: 1, pieces: 3, stars: 3, waysTotal: 1 }, [20, 50, 67]))
      .not.toContain('peak')
  })

  it('is three lines', () => {
    expect(shareCard({ level: 9, pieces: 3, stars: 1, waysTotal: 2, way: 1 }, [80, 70, 67])
      .split('\n')).toHaveLength(3)
  })
})
