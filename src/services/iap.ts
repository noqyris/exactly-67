/// <reference types="cordova-plugin-purchase" />
import { Capacitor } from '@capacitor/core'
import { WELCOME_HINTS } from '../game/economy'
import { adsRemoved, grantHints, hintsUnlimited, setAdsRemoved, setUnlimitedHints } from './ads'
import { notePurchase, noteWelcomeBought, welcomeOffered } from './progression'

/**
 * In-app purchase service — the one-time "Remove Ads" unlock. Same shape as
 * ads.ts: native-only, guarded, silently no-ops on web/dev.
 *
 * Talks straight to StoreKit via cordova-plugin-purchase (the `CdvPurchase`
 * global) — no third-party backend or account. Capacitor injects the plugin's
 * JS at runtime on device, so we never `import` it into the web bundle (the
 * browser build is unaffected); types come from the ambient namespace via the
 * reference directive above. Every entry point guards on `iapSupported()`, and
 * that guard uses `typeof` so touching `CdvPurchase` can never ReferenceError
 * on web.
 *
 * Entitlement is granted ONLY when StoreKit delivers an `approved` transaction
 * that (a) is in a purchased state and (b) actually contains our product — a
 * genuine purchase or a restore. A cancelled payment fires `error`, never
 * `approved`, so it can't remove ads. We deliberately do NOT grant off
 * `store.owned()` / `receiptUpdated`, which can read true for a cancelled
 * transaction in the sandbox when no receipt validator is configured. Once
 * granted, `setAdsRemoved` persists locally, so relaunch needs no store round
 * trip; a fresh install restores via the "Restore purchases" button.
 */

/**
 * The premium unlock ($4.99, Non-Consumable): removes ads **and** grants
 * unlimited hints. Owners from before the store split bought this same product
 * at $0.99 with both perks, so it must keep granting both — see the
 * grandfathering note in `storage.loadUnlimitedHints`.
 */
export const REMOVE_ADS_ID = 'com.noqyris.exactly67.removeads'

/**
 * Ads-only unlock ($0.99, Non-Consumable). Removes ads and nothing else —
 * hints stay consumable. Deliberately does NOT grant unlimited hints, which is
 * the only thing keeping the $4.99 tier meaningful.
 */
export const NO_ADS_ID = 'com.noqyris.exactly67.noads'

/**
 * Consumable hint packs — buy hints outright, repeatable. Bigger packs give
 * more hints per dollar. Each `id` must exist as a Consumable IAP in App Store
 * Connect and Google Play; until it does, its price reads null and the buy
 * button is hidden, so the app degrades gracefully.
 */
export interface HintPack {
  id: string
  hints: number
}
export const HINT_PACKS: readonly HintPack[] = [
  { id: 'com.noqyris.exactly67.hints10', hints: 10 },
  { id: 'com.noqyris.exactly67.hints30', hints: 30 },
  { id: 'com.noqyris.exactly67.hints100', hints: 100 },
]
const HINT_PACK_IDS = new Set(HINT_PACKS.map((p) => p.id))

/**
 * One-time Welcome pack (Consumable): WELCOME_HINTS hints at the lowest price
 * tier, once per player (progression.welcomeOffered). While it is on offer it
 * REPLACES the 10-hint card, so nobody sees more-for-less beside it. Until the
 * product exists in App Store Connect its price reads null and every surface
 * that would show it falls back to the ordinary ladder.
 */
export const WELCOME_ID = 'com.noqyris.exactly67.welcome'

let initialized = false
let onChange: (() => void) | null = null
let onHintsPurchased: ((n: number) => void) | null = null

/** Register a callback fired after a hint pack is purchased (refresh HUD/modal). */
export function setHintPurchaseListener(cb: ((n: number) => void) | null): void {
  onHintsPurchased = cb
}

export function iapSupported(): boolean {
  // A fake-ads build buys from the fake store (providers/mockIap), in a browser
  // too; in every other build the env read folds to false and this is unchanged.
  return (Capacitor.isNativePlatform() || import.meta.env.VITE_ADS === 'mock') && typeof CdvPurchase !== 'undefined'
}

/** Register a callback fired when ownership/products change, to refresh the UI. */
export function setIapListener(cb: (() => void) | null): void {
  onChange = cb
}

/** Localized price (e.g. "$0.99"), or null before the product metadata loads. */
export function removeAdsPrice(): string | null {
  if (!iapSupported()) return null
  const offer = CdvPurchase.store.get(REMOVE_ADS_ID)?.getOffer()
  return offer?.pricingPhases?.[0]?.price ?? null
}

/** Initialize StoreKit and wire the purchase flow. Safe to call once. */
export async function initIap(): Promise<void> {
  // A fake-ads build buys from a FAKE store instead of StoreKit
  // (providers/mockIap): a build installed over the cable would ask for a Sandbox
  // Apple Account on every purchase and every receipt refresh. It swaps the
  // CdvPurchase global before anything below reads it. The env read stays
  // inline at the import so Vite drops the module from every other bundle.
  if (import.meta.env.VITE_ADS === 'mock' && !initialized) {
    const { installMockIap } = await import('./providers/mockIap')
    await installMockIap()
  }
  if (!iapSupported() || initialized) return
  initialized = true
  const store = CdvPurchase.store
  const storePlatform =
    Capacitor.getPlatform() === 'android'
      ? CdvPurchase.Platform.GOOGLE_PLAY
      : CdvPurchase.Platform.APPLE_APPSTORE
  store.register([
    {
      id: REMOVE_ADS_ID,
      type: CdvPurchase.ProductType.NON_CONSUMABLE,
      platform: storePlatform,
    },
    {
      id: NO_ADS_ID,
      type: CdvPurchase.ProductType.NON_CONSUMABLE,
      platform: storePlatform,
    },
    ...HINT_PACKS.map((p) => ({
      id: p.id,
      type: CdvPurchase.ProductType.CONSUMABLE,
      platform: storePlatform,
    })),
    {
      id: WELCOME_ID,
      type: CdvPurchase.ProductType.CONSUMABLE,
      platform: storePlatform,
    },
  ])
  store
    .when()
    .approved((transaction) => {
      // Genuine purchase or restore delivered by StoreKit — grant iff it really
      // is our product in a purchased state, then acknowledge it. (Cancel never
      // reaches here; it fires `error`.)
      if (grantsProduct(transaction, REMOVE_ADS_ID)) grant(true)
      else if (grantsProduct(transaction, NO_ADS_ID)) grant(false)
      const pack = hintPackFor(transaction)
      if (pack) {
        notePurchase()
        grantHints(pack.hints)
        onHintsPurchased?.(pack.hints)
      }
      if (grantsProduct(transaction, WELCOME_ID)) {
        // Persist "bought" before paying, so a relaunch mid-grant can't offer it again.
        noteWelcomeBought()
        grantHints(WELCOME_HINTS)
        onHintsPurchased?.(WELCOME_HINTS)
      }
      void transaction.finish()
    })
    .productUpdated(() => onChange?.())
  store.error(() => {
    // Cancelled payment / no fill / offline — never grant anything.
  })
  try {
    await store.initialize([storePlatform])
  } catch {
    // offline / unavailable — buttons just no-op
  }
  onChange?.()
}

/** True only for an approved/finished transaction that includes the given product. */
function grantsProduct(t: CdvPurchase.Transaction, id: string): boolean {
  const state = t.state
  const purchased =
    state === CdvPurchase.TransactionState.APPROVED ||
    state === CdvPurchase.TransactionState.FINISHED
  const mine = (t.products ?? []).some((p) => p.id === id)
  return purchased && mine
}

/** The hint pack a purchased (approved/finished) transaction grants, or null. */
function hintPackFor(t: CdvPurchase.Transaction): HintPack | null {
  const state = t.state
  const purchased =
    state === CdvPurchase.TransactionState.APPROVED ||
    state === CdvPurchase.TransactionState.FINISHED
  if (!purchased) return null
  const ids = new Set((t.products ?? []).map((p) => p.id))
  return HINT_PACKS.find((p) => ids.has(p.id)) ?? null
}

/**
 * Apply an ad-removal entitlement. `withUnlimitedHints` is true only for the
 * $4.99 bundle; the $0.99 product must never flip that flag on. Never revokes:
 * a restore that re-delivers only the cheap product must not strip unlimited
 * hints from someone who also owns the bundle.
 */
function grant(withUnlimitedHints: boolean): void {
  notePurchase()
  if (!adsRemoved()) setAdsRemoved(true)
  if (withUnlimitedHints && !hintsUnlimited()) setUnlimitedHints(true)
  onChange?.()
}

/** Start the purchase flow (StoreKit shows its own sheet). */
export async function buyRemoveAds(): Promise<void> {
  if (!iapSupported()) return
  const offer = CdvPurchase.store.get(REMOVE_ADS_ID)?.getOffer()
  // On success StoreKit delivers an `approved` transaction (grants above); on
  // cancel it rejects / fires `error` — nothing is granted.
  if (offer) await offer.order()
}

/** Localized price of the ads-only unlock, or null before metadata loads. */
export function noAdsPrice(): string | null {
  if (!iapSupported()) return null
  const offer = CdvPurchase.store.get(NO_ADS_ID)?.getOffer()
  return offer?.pricingPhases?.[0]?.price ?? null
}

/** Start the purchase flow for the ads-only unlock. */
export async function buyNoAds(): Promise<void> {
  if (!iapSupported()) return
  const offer = CdvPurchase.store.get(NO_ADS_ID)?.getOffer()
  if (offer) await offer.order()
}

/** Localized price for a hint pack (e.g. "$0.99"), or null before metadata loads. */
export function hintPackPrice(id: string): string | null {
  if (!iapSupported()) return null
  const offer = CdvPurchase.store.get(id)?.getOffer()
  return offer?.pricingPhases?.[0]?.price ?? null
}

/** Start the purchase flow for a consumable hint pack. Grants hints on `approved`. */
export async function buyHintPack(id: string): Promise<void> {
  if (!iapSupported() || !HINT_PACK_IDS.has(id)) return
  const offer = CdvPurchase.store.get(id)?.getOffer()
  if (offer) await offer.order()
}

/** Localized price of the Welcome pack, or null (not on offer, or not loaded / not created yet). */
export function welcomePrice(): string | null {
  if (!iapSupported() || !welcomeOffered()) return null
  const offer = CdvPurchase.store.get(WELCOME_ID)?.getOffer()
  return offer?.pricingPhases?.[0]?.price ?? null
}

/** Start the purchase flow for the Welcome pack (only while it is on offer). */
export async function buyWelcomePack(): Promise<void> {
  if (!iapSupported() || !welcomeOffered()) return
  const offer = CdvPurchase.store.get(WELCOME_ID)?.getOffer()
  if (offer) await offer.order()
}

/**
 * Price per hint for a pack, formatted in the store's currency ("5.0¢" style is
 * locale-dependent, so this uses the currency with 2–3 decimals), or null.
 * Computed from StoreKit's micros so a "Best value" badge stays TRUE after any
 * reprice in App Store Connect.
 */
export function perHintPrice(id: string, hints: number): { value: number; label: string } | null {
  if (!iapSupported() || hints <= 0) return null
  const phase = CdvPurchase.store.get(id)?.getOffer()?.pricingPhases?.[0]
  if (!phase || !phase.priceMicros || !phase.currency) return null
  const value = phase.priceMicros / 1_000_000 / hints
  try {
    const label = new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: phase.currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 3,
    }).format(value)
    return { value, label }
  } catch {
    return null
  }
}

/** Restore a prior purchase — App Store requires a visible Restore action. */
export async function restorePurchases(): Promise<void> {
  if (!iapSupported()) return
  try {
    // Re-delivers owned non-consumables as `approved` transactions → grant.
    await CdvPurchase.store.restorePurchases()
  } catch {
    // noop
  }
  onChange?.()
}
