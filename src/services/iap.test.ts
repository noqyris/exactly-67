import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The purchase service's grant path, against a stand-in for the plugin's
 * `CdvPurchase` global: what each delivered transaction pays, that a consumable
 * is paid once per transaction however often StoreKit re-delivers it (the plugin
 * fires `approved` again for the same transaction after five seconds), and what
 * a purchase attempt reports back to the Store screen.
 */

const calls = {
  hints: [] as number[],
  adsRemoved: 0,
  unlimited: 0,
  purchases: 0,
  welcomeBought: 0,
}
let stored: string[] = []
const saved: string[][] = []

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => true, getPlatform: () => 'ios' },
}))
vi.mock('./ads', () => ({
  adsRemoved: () => calls.adsRemoved > 0,
  hintsUnlimited: () => calls.unlimited > 0,
  grantHints: (n: number) => {
    calls.hints.push(n)
  },
  setAdsRemoved: () => {
    calls.adsRemoved++
  },
  setUnlimitedHints: () => {
    calls.unlimited++
  },
}))
vi.mock('./progression', () => ({
  notePurchase: () => {
    calls.purchases++
  },
  noteWelcomeBought: () => {
    calls.welcomeBought++
  },
  welcomeOffered: () => true,
}))
vi.mock('./storage', () => ({
  loadIapPaid: async () => [...stored],
  saveIapPaid: async (ids: string[]) => {
    saved.push([...ids])
    stored = [...ids]
  },
}))

const CANCELLED = 6777006
type Approved = (t: unknown) => void
let approved: Approved[] = []
let orderResult: () => Promise<unknown> = async () => undefined
const finished: string[] = []

function installStore(): void {
  approved = []
  const chain = {
    approved(cb: Approved) {
      approved.push(cb)
      return chain
    },
    productUpdated() {
      return chain
    },
  }
  ;(globalThis as unknown as { CdvPurchase: unknown }).CdvPurchase = {
    store: {
      register: () => {},
      when: () => chain,
      error: () => {},
      initialize: async () => {},
      restorePurchases: async () => {},
      get: (id: string) =>
        id.startsWith('com.noqyris.exactly67.') ? { getOffer: () => ({ pricingPhases: [{ price: '$0.99' }], order: () => orderResult() }) } : undefined,
    },
    Platform: { APPLE_APPSTORE: 'ios-appstore', GOOGLE_PLAY: 'android-playstore' },
    ProductType: { CONSUMABLE: 'consumable', NON_CONSUMABLE: 'non consumable' },
    TransactionState: { APPROVED: 'approved', FINISHED: 'finished' },
    ErrorCode: { PAYMENT_CANCELLED: CANCELLED },
  }
}

/** StoreKit delivers transaction `id` for `product`. */
function deliver(id: string | undefined, product: string): void {
  const t = {
    transactionId: id,
    state: 'approved',
    products: [{ id: product }],
    finish: async () => {
      finished.push(id ?? '?')
    },
  }
  for (const cb of approved) cb(t)
}

async function boot() {
  vi.resetModules()
  // These tests drive the real grant path against their own stand-in. In a
  // VITE_ADS=mock run (the fake-ads build chain runs this suite too) initIap()
  // would swap in the fake store instead, so the env is pinned here.
  vi.stubEnv('VITE_ADS', 'off')
  installStore()
  const iap = await import('./iap')
  await iap.initIap()
  return iap
}

const HINTS30 = 'com.noqyris.exactly67.hints30'
const WELCOME = 'com.noqyris.exactly67.welcome'
const NO_ADS = 'com.noqyris.exactly67.noads'
const UNLIMITED = 'com.noqyris.exactly67.removeads'

afterEach(() => {
  vi.unstubAllEnvs()
})

beforeEach(() => {
  calls.hints = []
  calls.adsRemoved = 0
  calls.unlimited = 0
  calls.purchases = 0
  calls.welcomeBought = 0
  stored = []
  saved.length = 0
  finished.length = 0
  orderResult = async () => undefined
})

describe('what a delivered transaction pays', () => {
  it('a hint pack pays its hints once per transaction, however often StoreKit re-delivers it', async () => {
    await boot()
    deliver('t1', HINTS30)
    deliver('t1', HINTS30)
    expect(calls.hints).toEqual([30])
    // …and every delivery is still finished, so StoreKit stops re-delivering it.
    expect(finished).toEqual(['t1', 't1'])
    // The id was recorded before the hints were paid.
    expect(saved).toEqual([['t1']])
  })

  it('a second purchase of the same pack is a new transaction, and pays again', async () => {
    await boot()
    deliver('t1', HINTS30)
    deliver('t2', HINTS30)
    expect(calls.hints).toEqual([30, 30])
  })

  it('the ledger survives a relaunch: a transaction paid last session pays nothing now', async () => {
    stored = ['t1']
    await boot()
    deliver('t1', HINTS30)
    expect(calls.hints).toEqual([])
    expect(finished).toEqual(['t1'])
  })

  it('the Welcome pack is paid, and marked bought, once per transaction', async () => {
    await boot()
    deliver('w1', WELCOME)
    deliver('w1', WELCOME)
    expect(calls.hints).toEqual([25])
    expect(calls.welcomeBought).toBe(1)
  })

  it('a transaction without an id is paid as before (nothing to tell it apart by)', async () => {
    await boot()
    deliver(undefined, HINTS30)
    expect(calls.hints).toEqual([30])
  })

  it('the unlocks grant on every delivery (a restore), and the $0.99 one never grants unlimited hints', async () => {
    await boot()
    deliver('n1', NO_ADS)
    deliver('n1', NO_ADS)
    expect(calls.adsRemoved).toBe(1)
    expect(calls.unlimited).toBe(0)
    deliver('u1', UNLIMITED)
    expect(calls.unlimited).toBe(1)
    expect(calls.hints).toEqual([])
  })

  it('keeps only the newest 200 ids', async () => {
    await boot()
    for (let i = 0; i < 205; i++) deliver(`t${i}`, HINTS30)
    const last = saved[saved.length - 1]
    expect(last).toHaveLength(200)
    expect(last[0]).toBe('t5')
  })
})

describe('what a purchase attempt reports', () => {
  it('started, cancelled, failed — from what the plugin returns', async () => {
    const iap = await boot()
    orderResult = async () => undefined
    await expect(iap.buyHintPack(HINTS30)).resolves.toBe('started')
    orderResult = async () => ({ code: CANCELLED })
    await expect(iap.buyNoAds()).resolves.toBe('cancelled')
    orderResult = async () => ({ code: 6777003 })
    await expect(iap.buyRemoveAds()).resolves.toBe('failed')
    orderResult = async () => {
      throw new Error('bridge gone')
    }
    await expect(iap.buyWelcomePack()).resolves.toBe('failed')
  })

  it('unavailable when there is nothing to buy', async () => {
    const iap = await boot()
    await expect(iap.buyHintPack('com.example.unknown')).resolves.toBe('unavailable')
  })
})
