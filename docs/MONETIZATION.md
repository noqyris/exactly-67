# Monetization — Ads & IAP

How *Exactly 67* makes money, how the ad code is wired, and the exact steps to
take it from **test ads** to **live, App-Store-approved revenue**.

> **Status (2026-07-15):** Ads + IAP are wired for **both platforms**. Real
> AdMob apps and ad units exist for **iOS and Android**, and their IDs are in
> `LIVE_UNITS_IOS` / `LIVE_UNITS_ANDROID` — but `ads.ts` `TESTING = true`, so the
> app still serves Google's safe **test** fillers everywhere. The Android app is
> live on **Play internal testing** with the full store listing + all 9 App
> content declarations done; the privacy policy is hosted at
> <https://noqyris.github.io/exactly-67/privacy.html>. The one remaining step to
> real revenue is flipping **`TESTING = false`** and shipping to production on
> each store (see [Going live](#going-live)). The Remove-Ads IAP transacts once
> its store product exists (App Store product is created; Play needs the same —
> see [Phase 2](#phase-2--remove-ads-099-iap)).

---

## Strategy (the decisions)

A polished 72-level puzzle lives or dies on its rating and retention, so the
model favors opt-in and light-touch over ad saturation:

| Format | Role | Where |
|---|---|---|
| **Rewarded** | Primary earner. Opt-in → highest eCPM, best goodwill. Grants a **hint** (highlights one weight from a winning build). | 💡 button in the game HUD |
| **Interstitial** | Occasional full-screen at a natural break. | On leaving a cleared level, **every 5 clears**, never during onboarding (levels 1–5) |
| **Banner** | Passive fill. | Bottom-anchored, **all screens incl. gameplay** |
| **Remove Ads (IAP)** | Most reliable revenue in casual games. **$0.99**, one-time. Kills banner + interstitial; **keeps** the rewarded hint. | Phase 2 |

**Network:** **AdMob** (`@capacitor-community/admob` v8) — first-class Capacitor
support, largest demand pool. Revisit mediation (AppLovin MAX / Unity LevelPlay,
+15–30% eCPM) only past ~100k MAU; below that it is not worth the complexity.

**Revenue reality:** ads monetize *volume*. Without user acquisition, expect
coffee money — the **Remove-Ads IAP** and rewarded hints typically out-earn
banner/interstitial at low scale. Don't over-index on impression count.

### The banner-on-gameplay safety note ⚠️

The game is drag-and-drop, and AdMob bans ads placed where they cause accidental
clicks. To keep the bottom banner on the gameplay screen **safely**, the layout
**reserves a fixed strip** at the physical bottom and shrinks the drag area
above it, so a dragged weight never physically overlaps the ad. This is the
difference between "ad under interactive content" (bannable) and "ad in a
reserved strip" (fine). Do **not** remove that reservation (see
[`layout.ts`](../src/render/layout.ts) `setAdBannerReserve` / `adBannerReserve`).

---

## How it's wired (Phase 1)

Strict layering is preserved: `src/game` stays pure (the hint is just a new
solver query); all ad code lives in `services` + `render`.

| File | Change |
|---|---|
| [`src/game/solver.ts`](../src/game/solver.ts) | New `minimalSolution(level)` → indices of one minimal exact-67 subset (honors locked/useAll/maxWeights). `solveLevel` shape unchanged. |
| [`src/services/ads.ts`](../src/services/ads.ts) | **The whole ad wrapper.** Toggle-gated, fire-and-forget, **no-ops off-device** (like `haptics.ts`). Init + consent, banner, interstitial cadence, rewarded hint. |
| [`src/services/storage.ts`](../src/services/storage.ts) | Keys `exactly67.adClears` (interstitial counter) + `exactly67.adsRemoved` (Phase 2 IAP flag). |
| [`src/render/layout.ts`](../src/render/layout.ts) | `setAdBannerReserve()` folds the banner height into `safeArea().bottom` so every scene keeps content above the banner. |
| [`src/render/GameScene.ts`](../src/render/GameScene.ts) | 💡 hint button → rewarded ad → `WeightView.highlight()`; `noteCleared()` on win; interstitial on Next/Map/End (not Retry). |
| [`src/render/WeightView.ts`](../src/render/WeightView.ts) | `highlight()` — expanding pulse ring to point the eye at the hinted weight. |
| [`src/render/ui.ts`](../src/render/ui.ts) | `drawHintIcon` (lightbulb). |
| [`src/main.ts`](../src/main.ts) | Reserves the banner strip pre-layout, then `initAds().then(showBanner)` + `initIap()` after boot. |
| [`src/services/iap.ts`](../src/services/iap.ts) | **Remove-Ads IAP wrapper** (Phase 2). StoreKit via `CdvPurchase`, web-no-op, mirrors ownership into `setAdsRemoved()`. |
| [`src/render/MenuScene.ts`](../src/render/MenuScene.ts) | "Remove ads · _price_" + "Restore purchases" — device only, hidden once bought. |
| [`ios/App/App/Info.plist`](../ios/App/App/Info.plist) | `GADApplicationIdentifier`, `NSUserTrackingUsageDescription`, `SKAdNetworkItems`. |

**Tuning knobs** live at the top of [`ads.ts`](../src/services/ads.ts):
`TESTING`, the per-platform `TEST_UNITS_IOS` / `TEST_UNITS_ANDROID` /
`LIVE_UNITS_IOS` / `LIVE_UNITS_ANDROID` (picked by `IS_ANDROID`),
`CLEARS_PER_INTERSTITIAL` (5), `ONBOARDING_LEVELS` (5),
`BANNER_RESERVE_DESIGN_PX` (60). The banner also reports its real height at
runtime (`BannerAdPluginEvents.SizeChanged`) and the layout reserves exactly
that — see `setBannerHeightHandler` in [`main.ts`](../src/main.ts).

---

## Going live

Serving real, billable ads is now **one flag away** on each platform. The AdMob
apps, ad units, store listings, and compliance declarations are already done;
what's left is flipping `TESTING = false`, rebuilding, and shipping to
production. Until then the app serves Google's safe test fillers.

### The real AdMob IDs (already wired into `ads.ts`)

AdMob apps are **per platform** (same publisher `ca-app-pub-3307486877162157`):

| | iOS app `~6787…` | Android app `~2480617239` |
|---|---|---|
| **App ID** (manifest / plist) | `ca-app-pub-3307486877162157~1451034229` | `ca-app-pub-3307486877162157~2480617239` |
| Banner | `…/9242462556` | `…/3342538697` |
| Interstitial | `…/9437490984` | `…/1989662641` |
| Rewarded | `…/2677054209` | `…/2097473852` |

These are in `LIVE_UNITS_IOS` / `LIVE_UNITS_ANDROID`; the app-level IDs are in
[`Info.plist`](../ios/App/App/Info.plist) (`GADApplicationIdentifier`) and
[`AndroidManifest.xml`](../android/app/src/main/AndroidManifest.xml)
(`com.google.android.gms.ads.APPLICATION_ID`).

### ✅ Already done
- Both AdMob apps + 3 ad units each created; IDs wired.
- Android: **Play internal testing** live, full store listing, **all 9 App
  content declarations** (ads, data safety, content rating, target audience 13+,
  advertising ID, …).
- Privacy policy **live + accurate** at
  <https://noqyris.github.io/exactly-67/privacy.html> (GitHub Pages, main `/docs`)
  — discloses AdMob, the advertising identifier, ATT, and Remove Ads.
- iOS: `NSUserTrackingUsageDescription`, App Store privacy nutrition labels, and
  the Remove-Ads IAP product all created.

### The flip (per platform, when you're ready to earn)
1. Test the current **test-ads** build on a **real device** first (test ads
   serve where simulators/emulators don't; live ads won't fill until AdMob
   approves the now-public app).
2. Set **`TESTING = false`** in [`ads.ts`](../src/services/ads.ts).
3. Rebuild:
   - **Android:** bump `versionCode` in `android/app/build.gradle`, `npm run
     ios:sync` is web-only — for Android run `npm run build && npx cap sync
     android` (**Node ≥ 22**) then assemble a signed AAB (`./gradlew
     bundleRelease`, keystore via the gitignored `keystore.properties`).
   - **iOS:** `npm run ios:sync` (**Node ≥ 22**) → archive/upload (fastlane
     `build_and_upload`).
4. Promote: Play → Production track (new release + rollout); App Store → replace
   the in-review build and submit. AdMob approves each app for full ad serving
   within a few days of it being public.

### Remaining compliance nits
- [ ] `SKAdNetworkItems` (iOS) — the plist has a starter set; replace with
      **Google's full current partner list** (AdMob iOS setup docs) to maximize
      revenue.
- [ ] ATT + UMP consent (`initAds()`) — verify the prompts appear on a real
      device.
- [ ] **Never tap your own live ads** → invalid traffic → AdMob ban. Register
      your device as a test device, or keep `TESTING = true` while developing.

---

## Phase 2 — Remove Ads ($0.99 IAP)

Implemented as a skeleton against **StoreKit via `cordova-plugin-purchase`** (the
`CdvPurchase` global) — no third-party backend or account. It lives in
[`src/services/iap.ts`](../src/services/iap.ts): registers one non-consumable,
verifies + finishes transactions, mirrors ownership into `setAdsRemoved()`
(hides the banner, skips interstitials, **keeps** the rewarded hint), and exposes
buy / restore. The menu surfaces "Remove ads" + "Restore purchases". The
`exactly67.adsRemoved` flag persists and gates `main.ts` on boot; `initIap()`
reconciles on every launch, so a restore after reinstall clears the banner.

`iap.ts` already picks the store platform at runtime (`APPLE_APPSTORE` on iOS,
`GOOGLE_PLAY` on Android), so the same code transacts on both once each store has
the product.

**To make it transact:**
1. **App Store Connect** → create a **Non-Consumable** IAP with product id
   `com.noqyris.exactly67.removeads` (must match `REMOVE_ADS_ID` in `iap.ts`),
   price tier $0.99. *(Already created.)*
2. **Google Play Console** → Monetise with Play → In-app products → create a
   one-time product with the **same** id `com.noqyris.exactly67.removeads`,
   ~$0.99. *(Still to do before Android production.)*
3. `cap sync ios` / `cap sync android` (**Node ≥ 22**) to pull the Cordova
   plugin's native code in.
4. Test with a **sandbox tester** (Apple) / **licence tester** (Play) on a real
   device.
5. The web bundle never includes the plugin (no import; types via a `///
   <reference>`), so dev/browser stays unaffected.

> Pricing note: $0.99 is an easy yes; under Apple's **Small Business Program**
> (likely eligible, revenue < $1M) commission is 15%, so ~$0.84 nets through.
> $1.99 earns more per buyer at similar conversion if you want to revisit.

---

## Further reading
- [`docs/ARCHITECTURE.md`](ARCHITECTURE.md) — layers, services pattern the ad
  wrapper follows.
- `@capacitor-community/admob` — [npm](https://www.npmjs.com/package/@capacitor-community/admob) · [Capacitor Ads guide](https://capacitorjs.com/docs/guides/ads).
- [AdMob iOS privacy strategies](https://developers.google.com/admob/ios/privacy/strategies) — ATT / SKAdNetwork / UMP.
