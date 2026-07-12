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
 */

/** App Store Connect product id — create this as a Non-Consumable IAP ($0.99). */
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

export function isRemoveAdsOwned(): boolean {
  return iapSupported() && CdvPurchase.store.owned(REMOVE_ADS_ID)
}

/** Localized price (e.g. "$0.99"), or null before the product metadata loads. */
export function removeAdsPrice(): string | null {
  if (!iapSupported()) return null
  const offer = CdvPurchase.store.get(REMOVE_ADS_ID)?.getOffer()
  return offer?.pricingPhases?.[0]?.price ?? null
}

/** Initialize StoreKit, register the product, and reconcile ownership. Once. */
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
    .approved((transaction) => transaction.verify())
    .verified((receipt) => receipt.finish())
    .receiptUpdated(() => reconcile())
    .productUpdated(() => onChange?.())
  store.error(() => {
    // swallow: leave the UI as-is on any store error
  })
  try {
    await store.initialize([CdvPurchase.Platform.APPLE_APPSTORE])
  } catch {
    // offline / unavailable — buttons just no-op
  }
  reconcile()
}

/** Mirror store ownership into the ads flag, then notify the UI. */
function reconcile(): void {
  if (iapSupported() && CdvPurchase.store.owned(REMOVE_ADS_ID) && !adsRemoved()) {
    setAdsRemoved(true)
  }
  onChange?.()
}

/** Start the purchase flow (StoreKit shows its own sheet). */
export async function buyRemoveAds(): Promise<void> {
  if (!iapSupported()) return
  const offer = CdvPurchase.store.get(REMOVE_ADS_ID)?.getOffer()
  if (offer) await offer.order()
}

/** Restore a prior purchase — App Store requires a visible Restore action. */
export async function restorePurchases(): Promise<void> {
  if (!iapSupported()) return
  try {
    await CdvPurchase.store.restorePurchases()
  } catch {
    // noop
  }
  reconcile()
}
