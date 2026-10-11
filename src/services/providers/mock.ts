import { Preferences } from '@capacitor/preferences'
import type { ConsentState, ConsentTrigger } from '../../game/adConsent'
import { CONSENT_COPY, PRIVACY_POLICY_URL, consentMessage } from '../adConsentCopy'
import { ADS_MARKER, BANNER_RESERVE_DESIGN_PX, type AdFormat, type AdProvider, type DismissWatcher } from '../adProvider'

/**
 * The FAKE ad network — the build you test the ad flow on (`npm run dev:mock`,
 * `npm run build:mock`).
 *
 * Why it exists: LevelPlay has no test inventory. Its `isTesting` flag only
 * unlocks the Test Suite, the Test Suite serves live ads for every non-bidding
 * line, and the Unity Ads adapter hardcodes `withTestMode:NO` — verified by
 * KVIZKO on 2026-09-14 against the adapter source. There is no way to make the
 * real network serve an ad that is safe to look at, let alone tap.
 *
 * So we draw our own. Everything below renders in the DOM, over the canvas —
 * the same layer a native banner occupies — and touches no network at all. Zero
 * impressions, zero billing, and every surface is safe to tap as hard as you
 * like.
 *
 * What it is FOR: proving OUR code is right — that the reserved strip matches
 * the banner, that the interstitial honours the cadence in services/ads.ts and
 * navigation waits for it to close, that a finished hint video grants a hint
 * and an abandoned one does not, that the game loop pauses and the music stops
 * and both come back. All of that is our logic and none of it needs a real
 * advertiser.
 *
 * What it is NOT for: proving the real waterfall fills. Only LevelPlay's
 * reports can say that. Do not let a green mock run stand in for it.
 *
 * Consent works like the real thing (option A): nothing is asked at launch, a
 * FAKE consent window with the real words and two equal answers comes after
 * the first finished level, on a tapped ad offer and from Settings → "Privacy
 * & ads", and nothing is loaded or shown without a yes — so the whole path can
 * be walked on a phone. iOS's ATT prompt is the one step it cannot show.
 *
 * Every surface is deliberately ugly and says FAKE AD — MOCK BUILD in large
 * letters, so nobody ever wonders which build is on the phone in their hand.
 * The release gates refuse this bundle for every store target anyway
 * (`scripts/check-ad-mode.mjs`); the gates protect the store, the lettering
 * protects the human.
 *
 * E2E hooks: every surface carries `data-e67-mock="banner|interstitial|rewarded|consent"`,
 * each full-screen ad's button carries `data-e67-mock-close`, and the consent
 * window's buttons `data-e67-mock-consent="accept|decline|policy"`.
 */

/** Seconds a fake rewarded video runs before closing it earns the reward. */
const REWARD_SECONDS = 5
/** Fake network latency, so nothing in the policy layer is tested at zero delay. */
const LOAD_MS = 250

const Z = 2147483000
const TAG = 'FAKE AD — MOCK BUILD'

let bannerEl: HTMLElement | null = null
/** The fake "SDK" is up: only ever after a yes, like the real one. */
let initialized = false
const readyListeners = new Set<() => void>()
const consentListeners = new Set<(granted: boolean) => void>()

/** Resolvers for the dismissal watchers, by format. */
const dismissWaiters: Partial<Record<AdFormat, Array<() => void>>> = {}

function fireDismissed(format: AdFormat): void {
  const waiting = dismissWaiters[format]
  dismissWaiters[format] = []
  waiting?.forEach((r) => r())
}

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

function styleOn(el: HTMLElement, css: Record<string, string>): void {
  for (const [k, v] of Object.entries(css)) el.style.setProperty(k, v)
}

/**
 * Every half of a press that must stay on OUR layer. Phaser takes the release
 * half of a press from `window` — so a drag that leaves the canvas still ends —
 * and re-hit-tests it on the canvas; these sheets sit over the canvas, so a
 * press on one of their buttons bubbled up to `window` and released whatever
 * canvas button lay underneath: "Accept" in the fake consent window closed the
 * Settings card below it (found walking option A at 320×568, 2026-10-11).
 * KVIZKO and Quadshot met the same with their fake ads.
 */
const ISOLATED_INPUT_EVENTS = ['touchstart', 'touchend', 'touchcancel', 'mousedown', 'mouseup', 'pointerdown', 'pointerup'] as const

/**
 * Stop a DOM layer's presses at its root. Propagation only, never
 * `preventDefault`: the browser still turns the press into a `click` on our own
 * buttons, and the page still scrolls where it would.
 */
function isolateInput(el: HTMLElement): void {
  for (const type of ISOLATED_INPUT_EVENTS) el.addEventListener(type, (e) => e.stopPropagation(), { passive: true })
}

const FONT = 'ui-sans-serif, system-ui, sans-serif'

// ── banner ───────────────────────────────────────────────────────────────────

function makeBanner(): HTMLElement {
  const el = document.createElement('div')
  el.setAttribute('data-e67-mock', 'banner')
  styleOn(el, {
    position: 'fixed',
    // Where the real one sits: LevelPlay pins its banner to the bottom of the
    // SAFE AREA, above the home indicator. `--safe-bottom` is style.css's
    // variable, the same one layout.ts reads, and the scenes keep
    // `safe-bottom + BANNER_RESERVE_DESIGN_PX` clear — so this strip starts
    // exactly where the layout stopped.
    left: 'var(--safe-left, 0px)',
    right: 'var(--safe-right, 0px)',
    bottom: 'var(--safe-bottom, 0px)',
    height: `${BANNER_RESERVE_DESIGN_PX}px`,
    'box-sizing': 'border-box',
    'z-index': String(Z),
    display: 'flex',
    'align-items': 'center',
    'justify-content': 'center',
    background: 'repeating-linear-gradient(45deg,#2b2f3a,#2b2f3a 12px,#242833 12px,#242833 24px)',
    'border-top': '2px solid #ff5a5a',
    color: '#ffd6d1',
    font: `700 13px/1.2 ${FONT}`,
    'letter-spacing': '.04em',
    'text-align': 'center',
    'user-select': 'none',
    '-webkit-user-select': 'none',
  })
  const idle = `${TAG} · banner · tap freely`
  el.textContent = idle
  // Tapping is the whole point: it must be provably harmless here.
  el.addEventListener('click', () => {
    el.textContent = 'tapped — nothing happened, which is the point'
    setTimeout(() => {
      el.textContent = idle
    }, 1400)
  })
  return el
}

// ── full-screen surfaces ─────────────────────────────────────────────────────

function sheet(kind: string): HTMLElement {
  const root = document.createElement('div')
  root.setAttribute('data-e67-mock', kind)
  // Its presses are its own: none may release a game button underneath.
  isolateInput(root)
  styleOn(root, {
    position: 'fixed',
    inset: '0',
    // A real full-screen ad covers everything, and so does this one — but its
    // controls must stay reachable, clear of the notch and the home indicator.
    'padding-top': 'calc(24px + var(--safe-top, 0px))',
    'padding-bottom': 'calc(24px + var(--safe-bottom, 0px))',
    'padding-left': 'calc(24px + var(--safe-left, 0px))',
    'padding-right': 'calc(24px + var(--safe-right, 0px))',
    'box-sizing': 'border-box',
    'z-index': String(Z + 1),
    background: '#11141c',
    display: 'flex',
    'flex-direction': 'column',
    'align-items': 'center',
    'justify-content': 'center',
    gap: '18px',
    color: '#e8eaf0',
    font: `600 15px/1.5 ${FONT}`,
    'text-align': 'center',
    'user-select': 'none',
    '-webkit-user-select': 'none',
    // style.css sets `touch-action: none` on the body for the game; the fake
    // sheet is DOM, so let taps through as taps.
    'touch-action': 'manipulation',
  })
  return root
}

function textBlock(text: string, css: Record<string, string>): HTMLElement {
  const el = document.createElement('div')
  styleOn(el, css)
  el.textContent = text
  return el
}

function button(): HTMLButtonElement {
  const btn = document.createElement('button')
  btn.setAttribute('data-e67-mock-close', '')
  styleOn(btn, {
    appearance: 'none',
    border: '0',
    'border-radius': '999px',
    padding: '12px 26px',
    font: `800 15px/1 ${FONT}`,
    cursor: 'pointer',
  })
  return btn
}

/**
 * Show a fake full-screen ad. Resolves TRUE when the player sat through it (or
 * closed an interstitial, which has nothing to sit through), FALSE when they
 * left a rewarded early. `onPresented` fires the moment it is on screen, which
 * is what `resolvesOnPresent` promises the policy layer for interstitials.
 */
function showFullScreen(format: 'interstitial' | 'rewarded', onPresented: () => void): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const rewarded = format === 'rewarded'
    const root = sheet(format)

    const title = textBlock(TAG, { font: `800 24px/1.15 ${FONT}`, color: '#ff5a5a', 'letter-spacing': '.03em' })
    const kind = textBlock(rewarded ? 'Rewarded video — 1 hint' : 'Interstitial', {
      font: `800 18px/1.2 ${FONT}`,
      color: '#e8eaf0',
    })
    const body = textBlock(
      rewarded
        ? `No network was called and nothing is billed. Wait ${REWARD_SECONDS} seconds and close to earn the hint, or close early to check that no hint arrives.`
        : 'No network was called and nothing is billed. Close it to carry on.',
      { color: '#9aa2b0', 'max-width': '30rem' },
    )

    const tapzone = textBlock('tap me — it is safe', {
      width: 'min(70vw, 260px)',
      height: 'min(24vh, 160px)',
      border: '2px dashed #3a4152',
      'border-radius': '14px',
      display: 'grid',
      'place-items': 'center',
      color: '#6b7484',
      font: `700 13px/1.3 ${FONT}`,
    })
    tapzone.addEventListener('click', () => {
      tapzone.textContent = 'nothing happened ✓'
    })

    const btn = button()
    root.append(title, kind, body, tapzone, btn)
    document.body.appendChild(root)
    onPresented()

    let left = rewarded ? REWARD_SECONDS : 0
    let earned = left === 0
    let timer = 0

    const close = () => {
      window.clearInterval(timer)
      root.remove()
      fireDismissed(format)
      resolve(earned)
    }

    const paint = () => {
      if (left > 0) {
        btn.textContent = `Close — no reward (${left})`
        btn.style.setProperty('background', '#2a3140')
        btn.style.setProperty('color', '#9aa2b0')
      } else {
        // An interstitial awards nothing, so its button must not promise
        // anything — `earned` is true from the start there only because there
        // is nothing to wait for.
        btn.textContent = rewarded ? 'Close and get the hint' : 'Close'
        btn.style.setProperty('background', '#ffc940')
        btn.style.setProperty('color', '#11141c')
      }
    }
    paint()
    btn.addEventListener('click', close)

    if (left > 0) {
      timer = window.setInterval(() => {
        left -= 1
        if (left <= 0) {
          window.clearInterval(timer)
          left = 0
          earned = true
        }
        paint()
      }, 1000)
    }
  })
}

// ── consent (option A) ───────────────────────────────────────────────────────

/** Where the fake answer is kept — never the plugin's key, which a real build on this phone reads. */
const MOCK_CONSENT_KEY = 'exactly67.mockConsent'

/** The fake answer. Like the real one, nothing is loaded or shown without a yes. */
let consent: ConsentState = 'UNKNOWN'
let consentOpen: Promise<ConsentState> | null = null

async function loadMockConsent(): Promise<ConsentState> {
  try {
    const { value } = await Preferences.get({ key: MOCK_CONSENT_KEY })
    return value === 'GRANTED' || value === 'DENIED' ? value : 'UNKNOWN'
  } catch {
    return 'UNKNOWN'
  }
}

/** The fake SDK comes up on a yes — the policy layer then asks for the banner (onReady). */
function fakeSdkUp(): void {
  if (initialized) return
  initialized = true
  readyListeners.forEach((l) => l())
}

function recordConsent(state: ConsentState): void {
  consent = state
  void Preferences.set({ key: MOCK_CONSENT_KEY, value: state }).catch(() => {})
  // A no ends the ad path at once, like the real provider's withdrawal: the
  // policy layer takes the banner down when it hears it, and so does this.
  if (state !== 'GRANTED') {
    bannerEl?.remove()
    bannerEl = null
  }
  consentListeners.forEach((l) => l(state === 'GRANTED'))
  if (state === 'GRANTED') fakeSdkUp()
}

/**
 * The fake build's consent question — the same title, text and three equal
 * buttons as LevelPlay's native alert with PATCHED-EQUAL-BUTTONS, drawn in the
 * DOM and labelled FAKE, so option A's whole path — after the first finished
 * level, on a tapped offer, from Settings — can be walked on a phone without a
 * real ad network ever being told anything. Resolves with the answer; a second
 * call while it is up returns the same promise.
 */
function showMockConsent(trigger: ConsentTrigger): Promise<ConsentState> {
  if (consentOpen) return consentOpen
  consentOpen = new Promise<ConsentState>((resolve) => {
    const root = sheet('consent')
    root.style.setProperty('background', 'rgba(17, 20, 28, 0.82)')

    const card = document.createElement('div')
    styleOn(card, {
      'max-width': '22rem',
      'max-height': '100%',
      'overflow-y': 'auto',
      'box-sizing': 'border-box',
      background: '#11141c',
      border: '2px dashed #ff5a5a',
      'border-radius': '16px',
      padding: '18px',
      display: 'flex',
      'flex-direction': 'column',
      gap: '12px',
      color: '#e8eaf0',
      font: `500 14px/1.45 ${FONT}`,
    })

    const tag = textBlock('FAKE CONSENT WINDOW — MOCK BUILD · the answer goes to no network', {
      font: `800 12px/1.2 ${FONT}`,
      color: '#ff5a5a',
      'letter-spacing': '.03em',
    })
    const title = textBlock(CONSENT_COPY.title, { font: `800 18px/1.25 ${FONT}` })
    const body = textBlock(consentMessage(trigger), { color: '#c3c8d2', 'text-align': 'left' })

    const finish = (state: ConsentState) => {
      root.remove()
      consentOpen = null
      recordConsent(state)
      resolve(state)
    }
    // Accept and Don't accept are drawn identically — the whole point of option
    // A's rule 3 is that neither answer is dressed up — and so is the policy link.
    const choice = (kind: 'accept' | 'decline' | 'policy', label: string, onTap: () => void): HTMLButtonElement => {
      const btn = document.createElement('button')
      btn.setAttribute('data-e67-mock-consent', kind)
      styleOn(btn, {
        appearance: 'none',
        border: '1px solid #3a4150',
        'border-radius': '12px',
        padding: '12px 16px',
        'min-height': '44px',
        font: `700 15px/1 ${FONT}`,
        cursor: 'pointer',
        background: '#1c212c',
        color: '#e8eaf0',
      })
      btn.textContent = label
      btn.addEventListener('click', onTap)
      return btn
    }
    const accept = choice('accept', CONSENT_COPY.accept, () => finish('GRANTED'))
    const decline = choice('decline', CONSENT_COPY.decline, () => finish('DENIED'))
    const policy = choice('policy', CONSENT_COPY.privacyButton, () => {
      window.open(PRIVACY_POLICY_URL, '_blank')
    })

    card.append(tag, title, body, accept, decline, policy)
    root.append(card)
    document.body.appendChild(root)
  })
  return consentOpen
}

// ── the provider ─────────────────────────────────────────────────────────────

export const mockProvider: AdProvider = {
  // ADMODE stays `test` — a mock build is never a store build, and the gate
  // reads ADS:mock to tell it apart from an ordinary test bundle.
  id: `mock ADMODE:test ${ADS_MARKER}`,
  // FALSE, exactly as on LevelPlay. `testing` means "this build serves the
  // NETWORK's test inventory", and there is no network here at all.
  testing: false,

  supports: () => true,

  async init() {
    // Like the real init(): a stored (fake) answer is read, nothing is asked,
    // and the fake SDK comes up only on a yes.
    consent = await loadMockConsent()
    await wait(LOAD_MS)
    if (consent === 'GRANTED') fakeSdkUp()
  },

  onReady(listener: () => void) {
    readyListeners.add(listener)
    if (initialized) listener()
  },

  consentState: () => consent,
  askConsent: (trigger: ConsentTrigger) => showMockConsent(trigger),
  // Only a yes lets a fake surface show, exactly as on LevelPlay.
  adsAllowed: () => consent === 'GRANTED',
  onConsentChange(listener: (granted: boolean) => void) {
    consentListeners.add(listener)
  },
  // Nothing stored to forget. Present so the seam reads the same as on a
  // device; the policy layer never runs the migration in a mock build (it
  // would save the flag a later real build on this phone needs).
  resetConsent: async () => {},

  async bannerShow() {
    await wait(LOAD_MS)
    // Refused without consent, like LevelPlay's before initialize(): the policy
    // layer asks again when the fake SDK comes up.
    if (consent !== 'GRANTED') throw new Error('mock: no consent — no banner')
    if (!bannerEl) {
      bannerEl = makeBanner()
      document.body.appendChild(bannerEl)
    }
    bannerEl.style.setProperty('display', 'flex')
  },
  async bannerResume() {
    if (consent !== 'GRANTED') throw new Error('mock: no consent — no banner')
    bannerEl?.style.setProperty('display', 'flex')
  },
  async bannerHide() {
    bannerEl?.style.setProperty('display', 'none')
  },
  async bannerRemove() {
    bannerEl?.remove()
    bannerEl = null
  },

  async loadInterstitial() {
    await wait(LOAD_MS)
    return consent === 'GRANTED'
  },
  showInterstitial() {
    if (consent !== 'GRANTED') return Promise.resolve(false)
    // Resolves on PRESENT, like LevelPlay's — waiting for the player to be done
    // is watchDismissal's job, and conflating the two breaks the policy layer.
    return new Promise<boolean>((resolve) => {
      void showFullScreen('interstitial', () => resolve(true))
    })
  },

  async loadRewarded() {
    await wait(LOAD_MS)
    return consent === 'GRANTED'
  },
  showRewarded() {
    if (consent !== 'GRANTED') return Promise.resolve(null)
    // Settles ONLY on an earned reward, like LevelPlay's: a video closed early
    // leaves this pending, and the policy layer's dismissal watcher wins the
    // race and reads it as skipped.
    return new Promise<unknown | null>((resolve) => {
      void showFullScreen('rewarded', () => {}).then((earned) => {
        if (earned) resolve({ type: 'mock', amount: 1 })
      })
    })
  },
  rewardedReady: () => consent === 'GRANTED',

  resolvesOnPresent: (format: AdFormat) => format === 'interstitial',

  watchDismissal(format: AdFormat, timeoutMs: number): DismissWatcher {
    let timer = 0
    let settle: (() => void) | null = null
    const done = new Promise<void>((resolve) => {
      settle = resolve
      ;(dismissWaiters[format] ??= []).push(resolve)
      timer = window.setTimeout(resolve, timeoutMs)
    })
    return {
      done,
      cancel: () => {
        window.clearTimeout(timer)
        const list = dismissWaiters[format]
        if (list && settle) dismissWaiters[format] = list.filter((r) => r !== settle)
        settle?.()
      },
    }
  },
}
