/**
 * The FAKE store of a `VITE_ADS=mock` build — the purchase twin of mock.ts.
 *
 * Why: a development-signed build installed over the cable buys through Apple's
 * sandbox, which asks for a Sandbox Apple Account on every purchase and on every
 * receipt refresh (`store.initialize()` runs one at boot). The owner tests on
 * such builds, and TestFlight was down on his phone (2026-09-26), so the Store
 * could not be tested at all. In a mock build the real plugin is therefore never
 * initialised: this module replaces the `CdvPurchase` global BEFORE `initIap()`
 * runs, so StoreKit is never asked for anything and nothing prompts for a login.
 *
 * Everything else is the REAL code path. `services/iap.ts` is unchanged: it
 * registers the products, listens on `when().approved` and grants through its
 * own code — hint packs, the Welcome pack, No Ads, Unlimited hints and Restore
 * behave exactly as with a real purchase. Only the payment is fake: a DOM sheet
 * "FAKE PURCHASE — MOCK BUILD" with Cancel / Confirm, no money, no Apple.
 *
 * Gating: iap.ts (initIap) imports this module only under `import.meta.env.VITE_ADS
 * === 'mock'`, read inline so Vite drops it from every other bundle, and
 * `scripts/check-iap-mock-off.mjs` proves it on every build chain by looking for
 * IAP_MOCK_MARKER (rendered on the sheet, so no minifier can drop it).
 * Recipe: the mobile-game-playbook skill, references/monetization.md.
 */
import { HINT_PACKS, NO_ADS_ID, REMOVE_ADS_ID, WELCOME_ID } from '../iap'

/** The gate's needle. Never used by any real code path. */
export const IAP_MOCK_MARKER = 'IAP:mock'

const OWNED_KEY = 'exactly67.fakeIap.owned'
/** Above the mock ad overlays (mock.ts Z). */
const Z = 2147483001
const FONT = "'Baloo 2', system-ui, sans-serif"

/** What the sheet shows: App Store Connect's display name and USA price for each product. */
const PRODUCTS: Readonly<Record<string, { name: string; usd: number }>> = {
  [REMOVE_ADS_ID]: { name: 'Unlimited Hints + No Ads', usd: 4.99 },
  [NO_ADS_ID]: { name: 'No Ads', usd: 0.99 },
  [WELCOME_ID]: { name: 'Welcome Pack: 25 Hints', usd: 0.99 },
  [HINT_PACKS[0].id]: { name: '10 Hints', usd: 0.99 },
  [HINT_PACKS[1].id]: { name: '30 Hints', usd: 1.99 },
  [HINT_PACKS[2].id]: { name: '100 Hints', usd: 2.99 },
}

interface FakeTransaction {
  transactionId: string
  state: string
  products: { id: string }[]
  finish(): Promise<void>
}
type Callback = (t: FakeTransaction) => unknown

const TransactionState = {
  INITIATED: 'initiated',
  PENDING: 'pending',
  APPROVED: 'approved',
  CANCELLED: 'cancelled',
  FINISHED: 'finished',
  OWNED: 'owned',
  UNKNOWN_STATE: '',
} as const

const ErrorCode = { PAYMENT_CANCELLED: 6777006, UNKNOWN: 6777000 } as const

let registered = new Map<string, { id: string; type: string }>()
const approvedCbs: Callback[] = []
let seq = 0
/** Node (tests) has no localStorage: owned products live here instead. */
let memoryOwned: string[] = []

const nonConsumable = (id: string): boolean => id === REMOVE_ADS_ID || id === NO_ADS_ID

function loadOwned(): Set<string> {
  try {
    if (typeof localStorage === 'undefined') return new Set(memoryOwned)
    const raw = localStorage.getItem(OWNED_KEY)
    return new Set(raw ? (JSON.parse(raw) as string[]) : [])
  } catch {
    return new Set(memoryOwned)
  }
}

function saveOwned(ids: Set<string>): void {
  memoryOwned = [...ids]
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(OWNED_KEY, JSON.stringify(memoryOwned))
  } catch {
    // private mode — the persisted entitlement flags (storage.ts) still hold it
  }
}

const usd = (id: string): number => PRODUCTS[id]?.usd ?? 0.99
const fakePrice = (id: string): string => `$${usd(id).toFixed(2)} · TEST`

async function deliver(id: string): Promise<void> {
  const txn: FakeTransaction = {
    transactionId: `fake-${Date.now()}-${++seq}`,
    state: TransactionState.APPROVED,
    products: [{ id }],
    finish: async () => {},
  }
  for (const cb of approvedCbs) await cb(txn)
}

/** The stand-in for Apple's payment sheet. Resolves true on Confirm. */
function domSheet(id: string): Promise<boolean> {
  return new Promise((resolve) => {
    const root = document.createElement('div')
    root.setAttribute('data-e67-iap', IAP_MOCK_MARKER)
    // Presses stop here: they must never reach the canvas underneath (the same
    // isolation the mock ad overlays use).
    for (const type of ['touchstart', 'touchend', 'touchcancel', 'mousedown', 'mouseup', 'pointerdown', 'pointerup', 'click']) {
      root.addEventListener(type, (e) => e.stopPropagation())
    }
    Object.assign(root.style, {
      position: 'fixed',
      inset: '0',
      zIndex: String(Z),
      background: 'rgba(0,0,0,.6)',
      display: 'flex',
      alignItems: 'flex-end',
      justifyContent: 'center',
    })
    const card = document.createElement('div')
    Object.assign(card.style, {
      width: 'min(92vw, 420px)',
      margin: '0 0 calc(var(--safe-bottom, 0px) + 16px)',
      background: '#2b2f3a',
      border: '2px solid #ff5a5a',
      borderRadius: '16px',
      padding: '18px 18px 14px',
      color: '#ffd6d1',
      font: `700 16px/1.35 ${FONT}`,
      textAlign: 'center',
    })
    const line = (text: string, style: Partial<CSSStyleDeclaration>): HTMLDivElement => {
      const d = document.createElement('div')
      d.textContent = text
      Object.assign(d.style, style)
      return d
    }
    const title = line('FAKE PURCHASE — MOCK BUILD', { color: '#ff5a5a', fontWeight: '800', fontSize: '15px', letterSpacing: '.04em' })
    const item = line(PRODUCTS[id]?.name ?? id, { margin: '10px 0 2px', fontSize: '19px', fontWeight: '800', color: '#fff' })
    const price = line(fakePrice(id), { color: '#ffc940', fontWeight: '800', fontSize: '17px' })
    const note = line('No money, no Apple — the game grants it exactly as a real purchase.', {
      margin: '6px 0 14px',
      color: '#b8bcc6',
      fontSize: '13px',
      fontWeight: '600',
    })
    const row = document.createElement('div')
    Object.assign(row.style, { display: 'flex', gap: '10px' })
    const button = (label: string, primary: boolean, value: boolean): HTMLButtonElement => {
      const b = document.createElement('button')
      b.type = 'button'
      b.textContent = label
      b.setAttribute('data-e67-iap-action', value ? 'confirm' : 'cancel')
      Object.assign(b.style, {
        flex: '1',
        minHeight: '48px',
        borderRadius: '12px',
        border: primary ? '0' : '2px solid #4a4f5c',
        background: primary ? '#ffc940' : 'transparent',
        color: primary ? '#2b2440' : '#ffd6d1',
        font: `800 16px ${FONT}`,
      })
      b.addEventListener('click', () => {
        root.remove()
        resolve(value)
      })
      return b
    }
    row.append(button('Cancel', false, false), button('Confirm', true, true))
    card.append(title, item, price, note, row)
    root.append(card)
    document.body.appendChild(root)
  })
}

let confirmSheet: (id: string) => Promise<boolean> = domSheet

function makeOffer(id: string) {
  return {
    id,
    get canPurchase(): boolean {
      return !(nonConsumable(id) && loadOwned().has(id))
    },
    pricingPhases: [{ price: fakePrice(id), priceMicros: Math.round(usd(id) * 1_000_000), currency: 'USD' }],
    async order(): Promise<{ code: number; message: string } | undefined> {
      const yes = await confirmSheet(id)
      if (!yes) return { code: ErrorCode.PAYMENT_CANCELLED, message: 'cancelled (fake store)' }
      if (nonConsumable(id)) {
        const owned = loadOwned()
        owned.add(id)
        saveOwned(owned)
      }
      // Like StoreKit: the approval arrives after the sheet, not inside order().
      setTimeout(() => void deliver(id), 50)
      return undefined
    },
  }
}

/**
 * Wait for Cordova to finish setting its globals — the real plugin's
 * `CdvPurchase` lands on `window` when the plugins load, and a fake installed
 * earlier would simply be overwritten. `deviceready` is sticky (a late listener
 * fires at once); the timeout covers a page with no Cordova at all.
 */
function cordovaSettled(timeoutMs = 5000): Promise<void> {
  if (typeof document === 'undefined' || !(globalThis as { cordova?: unknown }).cordova) return Promise.resolve()
  return new Promise((resolve) => {
    const done = () => resolve()
    document.addEventListener('deviceready', done, { once: true })
    setTimeout(done, timeoutMs)
  })
}

/**
 * Replace the `CdvPurchase` global with the fake store, after Cordova has set
 * the real one. Resolves once the fake is in place — call `initIap()` after it.
 */
export async function installMockIap(): Promise<void> {
  await cordovaSettled()
  registered = new Map()
  const whenApi = {
    approved(cb: Callback) {
      approvedCbs.push(cb)
      return whenApi
    },
    pending: () => whenApi,
    productUpdated: () => whenApi,
    finished: () => whenApi,
  }
  const store = {
    register(products: { id: string; type: string }[]) {
      for (const p of products) registered.set(p.id, p)
    },
    when: () => whenApi,
    error() {},
    async initialize() {
      // Nothing to ask Apple. Re-deliver owned non-consumables, as StoreKit does.
      for (const id of loadOwned()) if (registered.has(id)) await deliver(id)
    },
    get(id: string) {
      return registered.has(id) ? { id, getOffer: () => makeOffer(id) } : undefined
    },
    async restorePurchases() {
      for (const id of loadOwned()) if (registered.has(id)) await deliver(id)
    },
  }
  const fake = {
    store,
    Platform: { APPLE_APPSTORE: 'ios-appstore', GOOGLE_PLAY: 'android-playstore' },
    ProductType: {
      CONSUMABLE: 'consumable',
      NON_CONSUMABLE: 'non consumable',
      PAID_SUBSCRIPTION: 'paid subscription',
      FREE_SUBSCRIPTION: 'free subscription',
      NON_RENEWING_SUBSCRIPTION: 'non renewing subscription',
      APPLICATION: 'application',
    },
    TransactionState,
    ErrorCode,
  }
  // defineProperty, not assignment: Cordova may have installed the real one as a
  // getter, which a plain assignment cannot replace in strict mode.
  Object.defineProperty(globalThis, 'CdvPurchase', { value: fake, writable: true, configurable: true })
}

/** @internal Test seams. */
export function __setConfirmForTests(fn: ((id: string) => Promise<boolean>) | null): void {
  confirmSheet = fn ?? domSheet
}
export function __resetMockIapForTests(): void {
  approvedCbs.length = 0
  registered = new Map()
  seq = 0
  memoryOwned = []
  confirmSheet = domSheet
}
