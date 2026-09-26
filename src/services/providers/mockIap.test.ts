import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The product ids only — the real iap.ts pulls in the whole ad/progression stack.
vi.mock('../iap', () => ({
  REMOVE_ADS_ID: 'com.noqyris.exactly67.removeads',
  NO_ADS_ID: 'com.noqyris.exactly67.noads',
  WELCOME_ID: 'com.noqyris.exactly67.welcome',
  HINT_PACKS: [
    { id: 'com.noqyris.exactly67.hints10', hints: 10 },
    { id: 'com.noqyris.exactly67.hints30', hints: 30 },
    { id: 'com.noqyris.exactly67.hints100', hints: 100 },
  ],
}))

import { __resetMockIapForTests, __setConfirmForTests, IAP_MOCK_MARKER, installMockIap } from './mockIap'

interface Txn {
  transactionId: string
  state: string
  products: { id: string }[]
}
interface FakeStore {
  store: {
    register(p: { id: string; type: string }[]): void
    when(): { approved(cb: (t: Txn) => unknown): unknown }
    initialize(): Promise<void>
    restorePurchases(): Promise<void>
    get(id: string): { getOffer(): { canPurchase: boolean; pricingPhases: { price: string; priceMicros: number; currency: string }[]; order(): Promise<unknown> } } | undefined
  }
  ProductType: { CONSUMABLE: string; NON_CONSUMABLE: string }
  TransactionState: { APPROVED: string }
  ErrorCode: { PAYMENT_CANCELLED: number }
}

const NO_ADS = 'com.noqyris.exactly67.noads'
const UNLIMITED = 'com.noqyris.exactly67.removeads'
const HINTS30 = 'com.noqyris.exactly67.hints30'

async function fresh(): Promise<{ cdv: FakeStore; approved: Txn[] }> {
  __resetMockIapForTests()
  await installMockIap()
  const cdv = (globalThis as unknown as { CdvPurchase: FakeStore }).CdvPurchase
  cdv.store.register([
    { id: UNLIMITED, type: cdv.ProductType.NON_CONSUMABLE },
    { id: NO_ADS, type: cdv.ProductType.NON_CONSUMABLE },
    { id: HINTS30, type: cdv.ProductType.CONSUMABLE },
  ])
  const approved: Txn[] = []
  cdv.store.when().approved((t) => {
    approved.push(t)
  })
  return { cdv, approved }
}

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  __resetMockIapForTests()
  vi.useRealTimers()
})

describe('the fake store (VITE_ADS=mock only)', () => {
  it('replaces the CdvPurchase global and prices every product as a TEST price in USD', async () => {
    const { cdv } = await fresh()
    const offer = cdv.store.get(HINTS30)!.getOffer()
    expect(offer.pricingPhases[0]).toEqual({ price: '$1.99 · TEST', priceMicros: 1_990_000, currency: 'USD' })
    expect(cdv.store.get(UNLIMITED)!.getOffer().pricingPhases[0].price).toBe('$4.99 · TEST')
    expect(cdv.store.get('com.example.unknown')).toBeUndefined()
  })

  it('Confirm delivers an APPROVED transaction for the product, after order() returns — as StoreKit does', async () => {
    const { cdv, approved } = await fresh()
    __setConfirmForTests(async () => true)
    await expect(cdv.store.get(HINTS30)!.getOffer().order()).resolves.toBeUndefined()
    expect(approved).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(60)
    expect(approved).toHaveLength(1)
    expect(approved[0].state).toBe(cdv.TransactionState.APPROVED)
    expect(approved[0].products).toEqual([{ id: HINTS30 }])
    expect(approved[0].transactionId).toMatch(/^fake-\d+-1$/)
    // a consumable can be bought again
    expect(cdv.store.get(HINTS30)!.getOffer().canPurchase).toBe(true)
  })

  it('Cancel grants nothing and answers PAYMENT_CANCELLED', async () => {
    const { cdv, approved } = await fresh()
    __setConfirmForTests(async () => false)
    await expect(cdv.store.get(NO_ADS)!.getOffer().order()).resolves.toMatchObject({ code: cdv.ErrorCode.PAYMENT_CANCELLED })
    await vi.advanceTimersByTimeAsync(200)
    expect(approved).toHaveLength(0)
    expect(cdv.store.get(NO_ADS)!.getOffer().canPurchase).toBe(true)
  })

  it('an owned non-consumable cannot be bought again, and comes back on initialize and Restore', async () => {
    let { cdv, approved } = await fresh()
    __setConfirmForTests(async () => true)
    await cdv.store.get(NO_ADS)!.getOffer().order()
    await vi.advanceTimersByTimeAsync(60)
    expect(cdv.store.get(NO_ADS)!.getOffer().canPurchase).toBe(false)
    expect(cdv.store.get(UNLIMITED)!.getOffer().canPurchase).toBe(true)

    await cdv.store.restorePurchases()
    expect(approved.map((t) => t.products[0].id)).toEqual([NO_ADS, NO_ADS])

    // A relaunch: a new store instance, the owned list survives.
    const owned = [NO_ADS]
    __setConfirmForTests(null)
    ;({ cdv, approved } = await (async () => {
      await installMockIap()
      const c = (globalThis as unknown as { CdvPurchase: FakeStore }).CdvPurchase
      c.store.register([{ id: NO_ADS, type: c.ProductType.NON_CONSUMABLE }])
      const a: Txn[] = []
      c.store.when().approved((t) => {
        a.push(t)
      })
      return { cdv: c, approved: a }
    })())
    await cdv.store.initialize()
    expect(approved.map((t) => t.products[0].id)).toEqual(owned)
  })

  it('carries the marker the bundle gate looks for', () => {
    expect(IAP_MOCK_MARKER).toBe('IAP:mock')
  })
})

describe('the fake store never reaches another bundle', () => {
  const SRC = join(__dirname, '..', '..')
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const p = join(dir, name)
      return statSync(p).isDirectory() ? files(p) : /\.ts$/.test(name) && !/\.test\.ts$/.test(name) ? [p] : []
    })

  it('iap.ts imports it only dynamically, under an inline VITE_ADS === mock read', () => {
    const iap = readFileSync(join(SRC, 'services', 'iap.ts'), 'utf8')
    expect(iap).toMatch(/if \(import\.meta\.env\.VITE_ADS === 'mock' && !initialized\) \{\s*const \{ installMockIap \} = await import\('\.\/providers\/mockIap'\)/)
    expect(iap).not.toMatch(/from '\.\/providers\/mockIap'/)
  })

  it('no other source file imports it', () => {
    const importsIt = /(?:from\s+|import\s*\(\s*)['"][^'"]*providers\/mockIap['"]/
    const importers = files(SRC).filter((f) => !f.endsWith('mockIap.ts') && importsIt.test(readFileSync(f, 'utf8')))
    expect(importers.map((f) => f.slice(SRC.length + 1))).toEqual(['services/iap.ts'])
  })
})
