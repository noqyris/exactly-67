import { Preferences } from '@capacitor/preferences'

/**
 * Session-level signals that cross scenes without scenes knowing each other.
 *
 * Onboarding gate: on a brand-new install the ad layer (and with it the ATT
 * alert and the "Ads and your data" consent modal) waits until the player has
 * finished their first level, instead of stacking two native prompts over the
 * first frame of Level 1. Consent is still asked BEFORE the SDK starts — this
 * only moves when that moment comes (main.ts). Returning players never wait.
 */
let markDone: (() => void) | null = null
const done = new Promise<void>((resolve) => {
  markDone = resolve
})

/** Resolves once the first level has been played through (or immediately, see main.ts). */
export function onboardingDone(): Promise<void> {
  return done
}

/** The player has left their first win card, or reached the menu. Idempotent. */
export function signalOnboardingDone(): void {
  markDone?.()
  markDone = null
}

/**
 * Where a tapped reminder wants to go, held until a screen can act on it. A
 * reminder can arrive before any scene exists (a cold launch from the
 * notification) or while a level is in progress; it never pulls anyone out of a
 * board — the menu consumes it the next time it appears.
 */
export type PendingRoute = 'daily' | 'map' | 'menu'
let pendingRoute: PendingRoute | null = null

export function setPendingRoute(route: PendingRoute): void {
  pendingRoute = route
}

export function takePendingRoute(): PendingRoute | null {
  const r = pendingRoute
  pendingRoute = null
  return r
}

/**
 * A cold launch from a tapped reminder, as the native scene delegate saved it
 * (ios/App/App/SceneDelegate.swift). Under UIScene iOS hands that tap to the
 * scene before the local-notifications plugin may be listening, so the plugin
 * can miss it; when it does not, it delivers the same tap again once main.ts
 * registers its listener — the echo below.
 */
const COLD_ROUTE_KEY = 'exactly67.pendingRoute'
/** A plugin tap for the same route this soon after the saved one was read is its echo. */
const COLD_ECHO_MS = 10_000
let coldRoute: { route: PendingRoute; at: number } | null = null

/** Read and clear the saved cold-launch route. Never throws; null when there is none. */
export async function takeColdLaunchRoute(): Promise<PendingRoute | null> {
  let value: string | null = null
  try {
    value = (await Preferences.get({ key: COLD_ROUTE_KEY })).value
    // Cleared at once: a route left behind would re-route some later launch.
    if (value !== null) await Preferences.remove({ key: COLD_ROUTE_KEY })
  } catch {
    return null
  }
  if (value !== 'daily' && value !== 'map' && value !== 'menu') return null
  coldRoute = { route: value, at: Date.now() }
  return value
}

/** True, once, for the plugin's re-delivery of the tap takeColdLaunchRoute() already routed. */
export function isColdLaunchEcho(route: PendingRoute, now = Date.now()): boolean {
  const c = coldRoute
  if (!c || c.route !== route || now - c.at > COLD_ECHO_MS) return false
  coldRoute = null
  return true
}

/** Settles when the studio sting is off the screen (main.ts). The first-run
 *  demo waits on it: a demo playing under the splash teaches nobody. */
let markSplash: (() => void) | null = null
const splashGone = new Promise<void>((resolve) => {
  markSplash = resolve
})
export function splashFinished(): Promise<void> {
  return splashGone
}
export function signalSplashFinished(): void {
  markSplash?.()
  markSplash = null
}
