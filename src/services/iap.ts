/// <reference types="cordova-plugin-purchase" />
import { Capacitor } from '@capacitor/core'
import { adsRemoved, setAdsRemoved } from './ads'

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

/** App Store Connect product id — a Non-Consumable IAP ($0.99). */
export const REMOVE_ADS_ID = 'com.noqyris.exactly67.removeads'

let initialized = false
let onChange: (() => void) | null = null

export function iapSupported(): boolean {
  return Capacitor.isNativePlatform() && typeof CdvPurchase !== 'undefined'
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
  if (!iapSupported() || initialized) return
  initialized = true
  const store = CdvPurchase.store
  store.register([
    {
      id: REMOVE_ADS_ID,
      type: CdvPurchase.ProductType.NON_CONSUMABLE,
      platform: CdvPurchase.Platform.APPLE_APPSTORE,
    },
  ])
  store
    .when()
    .approved((transaction) => {
      // Genuine purchase or restore delivered by StoreKit — grant iff it really
      // is our product in a purchased state, then acknowledge it. (Cancel never
      // reaches here; it fires `error`.)
      if (grantsRemoveAds(transaction)) grant()
      void transaction.finish()
    })
    .productUpdated(() => onChange?.())
  store.error(() => {
    // Cancelled payment / no fill / offline — never grant anything.
  })
  try {
    await store.initialize([CdvPurchase.Platform.APPLE_APPSTORE])
  } catch {
    // offline / unavailable — buttons just no-op
  }
  onChange?.()
}

/** True only for an approved/finished transaction that includes our product. */
function grantsRemoveAds(t: CdvPurchase.Transaction): boolean {
  const state = t.state
  const purchased =
    state === CdvPurchase.TransactionState.APPROVED ||
    state === CdvPurchase.TransactionState.FINISHED
  const mine = (t.products ?? []).some((p) => p.id === REMOVE_ADS_ID)
  return purchased && mine
}

function grant(): void {
  if (!adsRemoved()) setAdsRemoved(true)
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
