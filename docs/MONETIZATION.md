# Monetization — Ads & IAP

How *Exactly 67* makes money, how the ad code is wired, and the exact steps to
take it from **test ads** to **live, App-Store-approved revenue**.

> **Status:** Phase 1 (ads) is implemented against **Google test ad units** and
> is safe to run today. It will not earn or risk your AdMob account until you
> drop in real IDs and flip one flag (see [Going live](#going-live)). Phase 2
> (Remove-Ads IAP) is designed but not yet built.

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
| [`src/main.ts`](../src/main.ts) | Reserves the banner strip pre-layout, then `initAds().then(showBanner)` after boot. |
| [`ios/App/App/Info.plist`](../ios/App/App/Info.plist) | `GADApplicationIdentifier`, `NSUserTrackingUsageDescription`, `SKAdNetworkItems`. |

**Tuning knobs** live at the top of [`ads.ts`](../src/services/ads.ts):
`TESTING`, `TEST_UNITS` / `LIVE_UNITS`, `CLEARS_PER_INTERSTITIAL` (5),
`ONBOARDING_LEVELS` (5), `BANNER_RESERVE_DESIGN_PX` (56).

---

## Going live

Everything below is **required** to serve real, billable ads. Until you do it,
the app serves Google's safe test fillers.

### 1. AdMob account
1. Create an [AdMob](https://admob.google.com) account; register the app
   (bundle `com.noqyris.exactly67`) → get the **App ID**
   (`ca-app-pub-XXXXXXXXXXXXXXXX~YYYYYYYYYY`).
2. Create **3 ad units** → Banner, Interstitial, Rewarded → 3 ad-unit IDs.

### 2. Wire the IDs
- [`src/services/ads.ts`](../src/services/ads.ts): paste the 3 unit IDs into
  `LIVE_UNITS`, then set **`TESTING = false`**.
- [`ios/App/App/Info.plist`](../ios/App/App/Info.plist): replace the test
  `GADApplicationIdentifier` with your real App ID.

### 3. Compliance (blocks App Store approval)
- [ ] `NSUserTrackingUsageDescription` present — **already added** (a missing key
      is an instant rejection once the SDK links).
- [ ] `SKAdNetworkItems` — replace the single starter ID with **Google's full
      current partner list** (their AdMob iOS setup docs) to maximize revenue.
- [ ] ATT + UMP consent — handled by `initAds()` (`requestConsentInfo` →
      `showConsentForm` → `requestTrackingAuthorization`). Verify the prompts
      appear on a real device.
- [ ] **Update [`docs/privacy.html`](privacy.html)** — the app now collects
      device identifiers / usage for ads. The old "no data collected" claim is
      no longer true.
- [ ] **Update App Store privacy nutrition labels** in App Store Connect
      ("Data Used to Track You: Identifiers", etc.).

### 4. Build & test
- `cap sync ios` needs **Node ≥ 22** (`nvm use 22`); the web build/tests run on
  any recent Node.
- Test on a **real device** with `TESTING = true` first — simulators don't serve
  ads reliably.
- **Never tap your own live ads** → invalid traffic → AdMob ban. Register your
  device as a test device, or keep `isTesting` on while developing.

---

## Phase 2 — Remove Ads ($0.99 IAP)

Designed, not yet built. Plan:

1. Add an IAP plugin — **RevenueCat** (easier receipts/restore) or
   `@capacitor-community/in-app-purchases`.
2. App Store Connect: **Non-Consumable** "Remove Ads", product id e.g.
   `com.noqyris.exactly67.removeads`, tier $0.99.
3. On purchase/restore → `setAdsRemoved(true)` (already in `ads.ts`): hides the
   banner, skips interstitials, **keeps** the rewarded hint. The
   `exactly67.adsRemoved` flag already persists and gates `main.ts` on boot.
4. Add a **"Restore Purchases"** button (Apple requires it).

> Pricing note: $0.99 is an easy yes; under Apple's **Small Business Program**
> (likely eligible, revenue < $1M) commission is 15%, so ~$0.84 nets through.
> $1.99 earns more per buyer at similar conversion if you want to revisit.

---

## Further reading
- [`docs/ARCHITECTURE.md`](ARCHITECTURE.md) — layers, services pattern the ad
  wrapper follows.
- `@capacitor-community/admob` — [npm](https://www.npmjs.com/package/@capacitor-community/admob) · [Capacitor Ads guide](https://capacitorjs.com/docs/guides/ads).
- [AdMob iOS privacy strategies](https://developers.google.com/admob/ios/privacy/strategies) — ATT / SKAdNetwork / UMP.
