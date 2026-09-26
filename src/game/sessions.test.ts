import { describe, expect, it } from 'vitest'
import { returnIsNewSession, SESSION_GAP_MS } from './sessions'

const T0 = Date.UTC(2026, 8, 26, 10, 0, 0)
const MIN = 60 * 1000

describe('returnIsNewSession', () => {
  it('a visible with no hidden before it is not a return', () => {
    expect(returnIsNewSession(null, T0, '2026-09-26')).toBe(false)
  })

  it('a short switch away continues the session', () => {
    const pause = { at: T0, day: '2026-09-26' }
    expect(returnIsNewSession(pause, T0 + 5 * 1000, '2026-09-26')).toBe(false)
    expect(returnIsNewSession(pause, T0 + 29 * MIN, '2026-09-26')).toBe(false)
  })

  it('30 minutes or more away starts a new session', () => {
    const pause = { at: T0, day: '2026-09-26' }
    expect(SESSION_GAP_MS).toBe(30 * MIN)
    expect(returnIsNewSession(pause, T0 + SESSION_GAP_MS - 1, '2026-09-26')).toBe(false)
    expect(returnIsNewSession(pause, T0 + SESSION_GAP_MS, '2026-09-26')).toBe(true)
    expect(returnIsNewSession(pause, T0 + 3 * 24 * 60 * MIN, '2026-09-26')).toBe(true)
  })

  it('a return into a new day is always a new session, however short the pause', () => {
    const pause = { at: T0, day: '2026-09-26' }
    expect(returnIsNewSession(pause, T0 + 2 * MIN, '2026-09-27')).toBe(true)
  })

  it('a clock set back within the same day is not a new session', () => {
    const pause = { at: T0, day: '2026-09-26' }
    expect(returnIsNewSession(pause, T0 - 45 * MIN, '2026-09-26')).toBe(false)
  })

  it('a clock set back into another day is a new session (the day key decides)', () => {
    const pause = { at: T0, day: '2026-09-26' }
    expect(returnIsNewSession(pause, T0 - 24 * 60 * MIN, '2026-09-25')).toBe(true)
  })
})
