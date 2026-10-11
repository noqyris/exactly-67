import { describe, expect, it } from 'vitest'
import { adOffersVisible, CONSENT, consentAskOnTap, consentDueAfterLevel } from './adConsent'

const DAY = 86_400_000
const NOW = 1_800_000_000_000

describe('consentDueAfterLevel — the first question waits for a finished level', () => {
  const base = { state: 'UNKNOWN' as const, adsRemoved: false, askedThisSession: false, cardAsked: false }

  it('asks a player with no answer, at the break after a level', () => {
    expect(consentDueAfterLevel(base)).toBe(true)
  })

  it('never asks a player who already answered, either way', () => {
    expect(consentDueAfterLevel({ ...base, state: 'GRANTED' })).toBe(false)
    expect(consentDueAfterLevel({ ...base, state: 'DENIED' })).toBe(false)
  })

  it('asks a No ads or Unlimited owner only on a tap, never after a level', () => {
    expect(consentDueAfterLevel({ ...base, adsRemoved: true })).toBe(false)
  })

  it('tries once per session', () => {
    expect(consentDueAfterLevel({ ...base, askedThisSession: true })).toBe(false)
  })

  it('waits for a plain break when the win card already asked something or offered a video', () => {
    expect(consentDueAfterLevel({ ...base, cardAsked: true })).toBe(false)
  })
})

describe('consentAskOnTap — a refusal is re-asked only on a tap, and not again for 180 days', () => {
  it('always asks a player who never answered', () => {
    expect(consentAskOnTap({ state: 'UNKNOWN', lastAskedAt: NOW - DAY, nowMs: NOW })).toBe(true)
  })

  it('never asks a player who said yes', () => {
    expect(consentAskOnTap({ state: 'GRANTED', lastAskedAt: 0, nowMs: NOW })).toBe(false)
  })

  it('asks a refusal with no recorded time once (the answer came from 1.3.0, which recorded none)', () => {
    expect(consentAskOnTap({ state: 'DENIED', lastAskedAt: 0, nowMs: NOW })).toBe(true)
  })

  it('holds a refusal for the whole quiet period, then asks on the next tap', () => {
    expect(CONSENT.reaskAfterDays).toBe(180)
    const asked = NOW - CONSENT.reaskAfterDays * DAY
    expect(consentAskOnTap({ state: 'DENIED', lastAskedAt: asked + 1, nowMs: NOW })).toBe(false)
    expect(consentAskOnTap({ state: 'DENIED', lastAskedAt: asked, nowMs: NOW })).toBe(true)
  })

  it('treats a clock that went backwards as "not yet"', () => {
    expect(consentAskOnTap({ state: 'DENIED', lastAskedAt: NOW + DAY, nowMs: NOW })).toBe(false)
  })
})

describe('adOffersVisible — never a button that leads nowhere', () => {
  it('draws offers with consent, and where a tap would ask', () => {
    expect(adOffersVisible({ state: 'GRANTED', lastAskedAt: NOW, nowMs: NOW })).toBe(true)
    expect(adOffersVisible({ state: 'UNKNOWN', lastAskedAt: 0, nowMs: NOW })).toBe(true)
    expect(adOffersVisible({ state: 'DENIED', lastAskedAt: 0, nowMs: NOW })).toBe(true)
  })

  it('hides them inside a refusal’s quiet period', () => {
    expect(adOffersVisible({ state: 'DENIED', lastAskedAt: NOW - DAY, nowMs: NOW })).toBe(false)
  })
})
