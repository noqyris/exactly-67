import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CONSENT_COPY, consentMessage, PRIVACY_POLICY_URL } from '../adConsentCopy'

/**
 * The fake-ads build (VITE_ADS=mock) walks option A on a phone without any ad
 * network: nothing asked at launch, a FAKE consent window with the real words
 * and identical answers, and not one fake ad loaded or shown without a yes.
 * The suite runs in node, so the window is drawn into a DOM just big enough
 * to hold it — elements with attributes, styles, children and click listeners.
 */

class FakeElement {
  readonly attrs = new Map<string, string>()
  readonly styles = new Map<string, string>()
  readonly children: FakeElement[] = []
  readonly listeners = new Map<string, Array<(e?: unknown) => void>>()
  parent: FakeElement | null = null
  textContent = ''
  readonly style = {
    setProperty: (k: string, v: string) => {
      this.styles.set(k, v)
    },
  }
  constructor(readonly tag: string) {}
  setAttribute(k: string, v: string): void {
    this.attrs.set(k, v)
  }
  getAttribute(k: string): string | null {
    return this.attrs.get(k) ?? null
  }
  append(...els: FakeElement[]): void {
    for (const el of els) {
      el.parent = this
      this.children.push(el)
    }
  }
  appendChild(el: FakeElement): FakeElement {
    this.append(el)
    return el
  }
  addEventListener(type: string, fn: (e?: unknown) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn])
  }
  /** Deliver an event to this element's own listeners; returns whether one stopped it. */
  fire(type: string): boolean {
    let stopped = false
    const e = { stopPropagation: () => (stopped = true), preventDefault: () => {} }
    for (const fn of this.listeners.get(type) ?? []) fn(e)
    return stopped
  }
  remove(): void {
    if (!this.parent) return
    this.parent.children.splice(this.parent.children.indexOf(this), 1)
    this.parent = null
  }
  click(): void {
    for (const fn of this.listeners.get('click') ?? []) fn()
  }
  /** This element and everything under it. */
  all(): FakeElement[] {
    return [this, ...this.children.flatMap((c) => c.all())]
  }
}

let body = new FakeElement('body')
const opened: string[] = []
const prefs = new Map<string, string>()

vi.mock('@capacitor/preferences', () => ({
  Preferences: {
    get: async ({ key }: { key: string }) => ({ value: prefs.get(key) ?? null }),
    set: async ({ key, value }: { key: string; value: string }) => {
      prefs.set(key, value)
    },
  },
}))

type Mock = typeof import('./mock')

async function freshMock(): Promise<Mock> {
  vi.resetModules()
  return import('./mock')
}

const consentWindow = () => body.children.find((c) => c.getAttribute('data-e67-mock') === 'consent')
const button = (kind: 'accept' | 'decline' | 'policy') =>
  consentWindow()
    ?.all()
    .find((el) => el.getAttribute('data-e67-mock-consent') === kind)

beforeEach(() => {
  vi.useFakeTimers()
  body = new FakeElement('body')
  opened.length = 0
  prefs.clear()
  vi.stubGlobal('document', { createElement: (tag: string) => new FakeElement(tag), body })
  vi.stubGlobal('window', {
    open: (url: string) => {
      opened.push(url)
    },
  })
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('the fake-ads build asks like the real one', () => {
  it('init() reads the stored fake answer and asks nothing; without a yes not one fake ad is loaded or shown', async () => {
    const { mockProvider: p } = await freshMock()
    const init = p.init()
    await vi.advanceTimersByTimeAsync(300)
    await init
    expect(body.children).toHaveLength(0)
    expect(p.consentState?.()).toBe('UNKNOWN')
    expect(p.adsAllowed?.()).toBe(false)
    const banner = p.bannerShow()
    const refused = expect(banner).rejects.toThrow(/no consent/)
    await vi.advanceTimersByTimeAsync(300)
    await refused
    const loads = Promise.all([p.loadInterstitial(), p.loadRewarded()])
    await vi.advanceTimersByTimeAsync(300)
    expect(await loads).toEqual([false, false])
    await expect(p.showInterstitial()).resolves.toBe(false)
    await expect(p.showRewarded()).resolves.toBeNull()
    expect(p.rewardedReady?.()).toBe(false)
    expect(body.children).toHaveLength(0)
  })

  it('the FAKE window carries the real words and three identical buttons — neither answer dressed up', async () => {
    const { mockProvider: p } = await freshMock()
    void p.askConsent?.('adTap')
    const w = consentWindow()
    expect(w).toBeDefined()
    const texts = w!.all().map((el) => el.textContent)
    expect(texts.some((t) => /FAKE CONSENT WINDOW — MOCK BUILD/.test(t))).toBe(true)
    expect(texts).toContain(CONSENT_COPY.title)
    expect(texts).toContain(consentMessage('adTap'))
    expect(button('accept')!.textContent).toBe('Accept')
    expect(button('decline')!.textContent).toBe("Don't accept")
    expect(button('policy')!.textContent).toBe('Privacy policy')
    expect([...button('decline')!.styles]).toEqual([...button('accept')!.styles])
    expect([...button('policy')!.styles]).toEqual([...button('accept')!.styles])
    expect(Number.parseInt(button('accept')!.styles.get('min-height') ?? '0', 10)).toBeGreaterThanOrEqual(44)
  })

  it('Accept records a fake yes: the fake SDK comes up and every surface may serve', async () => {
    const { mockProvider: p } = await freshMock()
    const ready = vi.fn()
    p.onReady?.(ready)
    const answer = p.askConsent?.('afterLevel')
    button('accept')!.click()
    await expect(answer).resolves.toBe('GRANTED')
    expect(consentWindow()).toBeUndefined()
    expect(ready).toHaveBeenCalledTimes(1)
    expect(p.adsAllowed?.()).toBe(true)
    expect(p.rewardedReady?.()).toBe(true)
    // Kept under the mock's own key — never the plugin's, which a real build on this phone reads.
    expect(prefs.get('exactly67.mockConsent')).toBe('GRANTED')
    expect([...prefs.keys()]).toEqual(['exactly67.mockConsent'])
  })

  it('Don\'t accept records a fake no: the banner comes down and nothing serves', async () => {
    const { mockProvider: p } = await freshMock()
    const heard: boolean[] = []
    p.onConsentChange?.((granted) => heard.push(granted))
    const yes = p.askConsent?.('afterLevel')
    button('accept')!.click()
    await yes
    const shown = p.bannerShow()
    await vi.advanceTimersByTimeAsync(300)
    await shown
    expect(body.children.some((c) => c.getAttribute('data-e67-mock') === 'banner')).toBe(true)
    const no = p.askConsent?.('settings')
    button('decline')!.click()
    await expect(no).resolves.toBe('DENIED')
    expect(body.children.some((c) => c.getAttribute('data-e67-mock') === 'banner')).toBe(false)
    expect(p.adsAllowed?.()).toBe(false)
    expect(heard).toEqual([true, false])
  })

  it('its presses stay on it: a release never reaches the game underneath (Phaser listens on window)', async () => {
    const { mockProvider: p } = await freshMock()
    void p.askConsent?.('settings')
    const w = consentWindow()!
    for (const type of ['touchstart', 'touchend', 'touchcancel', 'mousedown', 'mouseup', 'pointerdown', 'pointerup']) {
      expect(w.fire(type), type).toBe(true)
    }
    // …and only propagation is stopped: the press still becomes a click on our own button.
    button('decline')!.click()
    await vi.advanceTimersByTimeAsync(0)
    expect(consentWindow()).toBeUndefined()
  })

  it('the policy button opens the policy and leaves the question up; one window at a time', async () => {
    const { mockProvider: p } = await freshMock()
    const first = p.askConsent?.('settings')
    const second = p.askConsent?.('adTap')
    expect(second).toBe(first)
    expect(body.children.filter((c) => c.getAttribute('data-e67-mock') === 'consent')).toHaveLength(1)
    button('policy')!.click()
    expect(opened).toEqual([PRIVACY_POLICY_URL])
    expect(consentWindow()).toBeDefined()
    button('decline')!.click()
    await expect(first).resolves.toBe('DENIED')
  })

  it('a stored fake yes is read at the next launch, and the fake SDK comes up with no question', async () => {
    prefs.set('exactly67.mockConsent', 'GRANTED')
    const { mockProvider: p } = await freshMock()
    const ready = vi.fn()
    p.onReady?.(ready)
    const init = p.init()
    await vi.advanceTimersByTimeAsync(300)
    await init
    expect(p.consentState?.()).toBe('GRANTED')
    expect(ready).toHaveBeenCalledTimes(1)
    expect(consentWindow()).toBeUndefined()
  })
})
