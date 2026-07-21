# Module reference — `src/services` (platform abstraction)

Per-file reference for the platform boundary: audio synthesis, haptics,
persistence, the progress cache, ads, and IAP. Every service is **guarded and
fire-and-forget** — it degrades to a silent no-op off-device (web/dev). Deeper than
[`ARCHITECTURE.md` §5](../ARCHITECTURE.md). Anchors are `file:line`.

> **Layer rule:** `services/` may import the `game/` data model and platform SDKs,
> but never `render/`. `iap.ts` imports `ads.ts`, and `ads.ts` imports `audio.ts`
> — a one-way chain, no cycles.

---

## `audio.ts` — Web Audio synth (zero files)

Every SFX is synthesized at play time from `OscillatorNode` + `GainNode`
envelopes; the game ships **no audio files**.

| Export | Signature | Behavior |
|---|---|---|
| `setSoundEnabled` / `soundEnabled` | `(on) / ()` (`:8`/`:12`) | Toggle + read the enabled flag. |
| `resumeAudio` | `() => void` (`:38`) | Nudge a suspended/`interrupted` context back to running; if unrecoverable, drop it so the next play rebuilds a fresh one. |
| `playPlace` | `()` (`:61`) | Down-weight lands: low "thock". |
| `playPlaceBalloon` | `()` (`:69`) | Balloon clips on: rising squeak. |
| `playRemove` | `()` (`:76`) | Weight comes off. |
| `playRefuse` | `()` (`:83`) | Refused action: flat double buzz. |
| `playWinJingle` | `()` (`:94`) | "six-seven" win jingle (C5 → G5 + octave sparkle). |

**Internals & gotchas:**
- `context()` (`:20`) lazily creates the `AudioContext`, returns `null` when sound
  is off, and calls `ctx.resume()` on any non-`running` state — so the **first user
  tap unlocks audio** on iOS (contexts start suspended, and iOS WebKit can report
  the non-standard `'interrupted'`).
- `tone()` (`:43`) uses exponential gain ramps `0.0001 → gain → 0.0001` — never
  targeting exactly `0` (an exponential ramp to 0 throws / clicks).
- **`resumeAudio()` + the `visibilitychange` listener** (module-level, `:56`) are
  the audio-after-ad fix: a full-screen ad, phone call, or home-button background
  leaves the iOS context suspended/`interrupted`, silencing later sounds. On
  returning to the foreground the listener resumes it; `ads.ts` also calls
  `resumeAudio()` on interstitial/rewarded **Dismissed**. If `resume()` fails the
  context is nulled so the next tap recreates it.

> This is an audit-era fix. See
> [`TESTING.md` — finding #2](../TESTING.md#the-5-confirmed-bugs-all-fixed).

---

## `haptics.ts` — Capacitor haptics, web no-op

Wraps `@capacitor/haptics`. Every call is gated by the `enabled` flag and is
fire-and-forget with `.catch(() => {})`, so on web (no vibration plugin) it
silently no-ops.

| Export | Feedback |
|---|---|
| `setHapticsEnabled` / `hapticsEnabled` | Toggle + read. |
| `placeTap` / `removeTap` (`:16`/`:22`) | `ImpactStyle.Light`. |
| `refuseTap` (`:28`) | `NotificationType.Warning`. |
| `winTap` (`:34`) | `NotificationType.Success`. |

---

## `storage.ts` — Capacitor Preferences

Wraps `@capacitor/preferences` (native key/value on iOS/Android, `localStorage` on
web — web keys are prefixed `CapacitorStorage.`). Every read/write is try/caught and
degrades to a safe default.

**Keys** (all namespaced `exactly67.*`):

| Key | Type | Default when missing |
|---|---|---|
| `exactly67.progress` | JSON `{ stars, best }` (via `parseProgress`) | empty |
| `exactly67.sound` | `'on'`/`'off'` | **on** (`value !== 'off'`) |
| `exactly67.haptics` | `'on'`/`'off'` | **on** |
| `exactly67.adClears` | integer string (interstitial cadence counter) | `0` |
| `exactly67.adsRemoved` | `'on'`/`'off'` | `false` (`value === 'on'`) |
| `exactly67.hintFreeDate` | UTC `YYYY-MM-DD` of last free hint | `''` |

**Exports:** `loadProgress`/`saveProgress`, `loadSoundEnabled`/`saveSoundEnabled`,
`loadHapticsEnabled`/`saveHapticsEnabled`, `loadAdClears`/`saveAdClears`,
`loadAdsRemoved`/`saveAdsRemoved`, `loadFreeHintDate`/`saveFreeHintDate`.

> **Renaming any key silently orphans player data.** Sound/haptics default **on**;
> `adsRemoved` defaults **off**. Seeding `exactly67.progress` (see
> [`TESTING.md`](../TESTING.md#seeding-progress-for-testing)) is how you jump to a
> specific level during testing.

---

## `progressStore.ts` — in-memory progress cache

A module-global `current: Progress` so scenes read progress **synchronously**.

| Export | Behavior |
|---|---|
| `initProgress()` (`:11`) | Loads `current` once at boot (awaited before Phaser starts). |
| `progress()` (`:15`) | Synchronous read of the cache. |
| `recordClear(globalLevel, stars, weightsUsed)` (`:19`) | Merges via `mergeClear`, then `void saveProgress(current)` **without awaiting** — a slow/failed native write never blocks gameplay. |

---

## `ads.ts` — AdMob wrapper (toggle-gated, web no-op)

The whole ad layer: init + GDPR/UMP consent + ATT, banner, interstitial cadence,
rewarded hint, and the daily free-hint clock. Mirrors the `haptics.ts` pattern.

**Tuning knobs (top of file):**

| Const | Value | Meaning |
|---|---|---|
| `TESTING` | `false` | `true` = Google **test** ads (safe, never billed); `false` = real billable ads. |
| `TEST_UNITS_IOS/ANDROID`, `LIVE_UNITS_IOS/ANDROID` | — | Per-platform ad-unit ids; `IS_ANDROID` (`Capacitor.getPlatform()`) picks the set. |
| `CLEARS_PER_INTERSTITIAL` | `5` | Interstitial every N clears. |
| `ONBOARDING_LEVELS` | `5` | No interstitials through level 5. |
| `BANNER_RESERVE_DESIGN_PX` | `60` | Initial bottom reserve before the banner reports its real height. |

**Key exports:** `adsSupported`, `adsRemoved`, `primeAdsRemoved`, `setAdsRemoved`,
`initAds`, `setBannerHeightHandler`, `showBanner`/`hideBanner`/`removeBanner`,
`noteCleared`, `maybeShowInterstitial`, `showRewardedHint`, `initHintState`,
`freeHintAvailable`, `consumeFreeHint`.

**Behavior notes:**
- `initAds()` initializes AdMob, requests consent + ATT, and registers
  interstitial/rewarded **`Dismissed`** listeners that call `resumeAudio()`.
- The banner reserves its **real** height at runtime via
  `BannerAdPluginEvents.SizeChanged` → `setBannerHeightHandler` → relayout.
- `maybeShowInterstitial(clearedGlobal)` no-ops when ads are removed, off-device,
  or still onboarding, and only when `clearsSinceInterstitial >=
  CLEARS_PER_INTERSTITIAL`. It resets the counter **only after
  `showInterstitial()` resolves** — a no-fill/offline break leaves the counter
  armed so the next clear retries.

> The reset-after-show ordering is an audit fix (it used to reset before the
> attempt, burning the cadence on a no-fill). See
> [`TESTING.md` — finding #2/6](../TESTING.md#the-5-confirmed-bugs-all-fixed).

---

## `iap.ts` — "Remove Ads" IAP wrapper

The one-time Remove-Ads unlock via **StoreKit / Google Play Billing** through
`cordova-plugin-purchase` (the `CdvPurchase` global — injected natively, never
imported into the web bundle; types via a `/// <reference>`).

| Export | Signature | Behavior |
|---|---|---|
| `REMOVE_ADS_ID` | `const = 'com.noqyris.exactly67.removeads'` (`:28`) | Must match the store product id on both App Store Connect and Play. |
| `iapSupported` | `() => boolean` (`:33`) | `isNativePlatform() && typeof CdvPurchase !== 'undefined'` — the `typeof` guard means touching `CdvPurchase` never ReferenceErrors on web. |
| `setIapListener` | `(cb \| null) => void` (`:38`) | UI refresh callback (product load / purchase). |
| `removeAdsPrice` | `() => string \| null` (`:43`) | Localized price, or `null` before metadata loads (drives the menu button's visibility). |
| `initIap` | `() => Promise<void>` (`:50`) | Registers the non-consumable, wires the purchase flow, picks `APPLE_APPSTORE`/`GOOGLE_PLAY` at runtime. |
| `buyRemoveAds` | `() => Promise<void>` (`:102`) | Starts the purchase (StoreKit shows its own sheet). |
| `restorePurchases` | `() => Promise<void>` (`:111`) | Re-delivers owned non-consumables as `approved` → grant. Required visible action. |

**Entitlement is granted ONLY** on an `approved`/`finished` transaction that
actually contains our product (`grantsRemoveAds`, `:87`) — a genuine purchase or
restore. A cancelled payment fires `error`, never `approved`, so it can't remove
ads. The service deliberately does **not** grant off `store.owned()` /
`receiptUpdated` (can read true for a cancelled sandbox transaction). On grant,
`setAdsRemoved(true)` persists locally so relaunch needs no store round-trip.

> Go-live steps (create the store products, sandbox/licence testing) are in
> [`MONETIZATION.md` — Phase 2](../MONETIZATION.md#phase-2--remove-ads-099-iap) and
> [`RELEASE.md`](../RELEASE.md). The Play product is still blocked on a Google
> Payments profile.

---

## Boot ordering

`main.ts` awaits `initProgress()` **before** constructing Phaser, so no scene ever
reads an empty cache, and `primeAdsRemoved()` runs before scenes read
`adsRemoved()`. Ads/IAP init **after** boot so the first paint is never blocked on
the network.
