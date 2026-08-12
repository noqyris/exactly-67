# Monetization — Ads & IAP

How *Exactly 67* makes money, how the ad code is wired, and the exact steps to
take it from **test ads** to **live, App-Store-approved revenue**.

> **Status (1.1.0, current):** Ads + IAP are wired for **both platforms** and
> **`TESTING = false`** — the app now serves **real** ads. Real AdMob apps + ad
> units exist for iOS and Android (`LIVE_UNITS_IOS` / `LIVE_UNITS_ANDROID`).
> - **iOS:** build **9** with the Remove-Ads IAP is **submitted to App Review
>   together** (Manual release). The iOS AdMob app is approved and serving.
> - **Android:** a signed production **AAB (versionCode 2)** is built and ready;
>   internal testing is live with the full store listing + all 9 App content
>   declarations. The Android AdMob app fills once the app is public.
> - Privacy policy live at <https://noqyris.github.io/exactly-67/privacy.html>.
> - **Remaining for full IAP revenue:** the **Play** Remove-Ads product still
>   needs to be created, which is blocked on a **Google Payments profile** (bank +
>   tax). The App Store product already exists. See
>   [Phase 2](#phase-2--remove-ads-099-iap).
>
> Ship/release mechanics: [`RELEASE.md`](RELEASE.md).

---

## Strategy (the decisions)

A polished 72-level puzzle lives or dies on its rating and retention, so the
model favors opt-in and light-touch over ad saturation:

| Format | Role | Where |
|---|---|---|
| **Rewarded** | Primary earner. Opt-in → highest eCPM, best goodwill. Hints are a **banked inventory**: **+1 free per day** (top-up at boot) and **+1 per rewarded video** (collect as many as you like). A video **banks** a hint — it does **not** reveal — so the player spends them on their own terms. The 💡 badge shows the **count** (green disc + number, or blue **▶** at zero); tapping spends one to highlight a winning weight. | 💡 button in the game HUD |
| **Interstitial** | Occasional full-screen at a natural break, under a **hybrid gate**: a clear count decides *where*, time + session + opt-in state decide *whether*. Tuned light (psychology + revenue study). | On the leave-tap after a win, past onboarding (levels 1–8), never on a pack final; see the cadence rule below |
| **Banner** | Passive fill. | Bottom-anchored, **all screens incl. gameplay** |
| **Hint packs (IAP)** | Consumables for players who want help without buying the unlock: **10 / 30 / 100 hints at $0.99 / $1.99 / $2.99**. Purchased hints are added to the same banked inventory and **never expire** (Apple requires this, and the balance is a plain persisted counter with no decay). | Store screen |
| **Remove Ads (IAP)** | Most reliable revenue in casual games. **$4.99**, one-time. Kills banner + interstitial **and grants unlimited free hints** (owners never see an ad — the 💡 is always lit, no cost, no video). Sits at the **top** of the Store ladder as the hero tier. | Store screen |
| **Rate this app** | Not revenue — but the App Store rating *is* the funnel. Fires the native StoreKit prompt **once**, at a post-win delight peak. | `review.ts`, from the win overlay (~1.8s after the star pop) |

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
| [`src/services/storage.ts`](../src/services/storage.ts) | Keys `exactly67.adClears` (interstitial counter), `exactly67.adsRemoved` (IAP flag), `exactly67.hintFreeDate` (daily-top-up date), `exactly67.hintCount` (hint inventory), `exactly67.reviewRequested` (one-shot rate prompt). |
| [`src/render/layout.ts`](../src/render/layout.ts) | `setAdBannerReserve()` folds the banner height into `safeArea().bottom` so every scene keeps content above the banner. |
| [`src/render/GameScene.ts`](../src/render/GameScene.ts) | 💡 hint button → rewarded ad → `WeightView.highlight()`; `noteCleared()` on win; interstitial on Next/Map/End (not Retry). |
| [`src/render/WeightView.ts`](../src/render/WeightView.ts) | `highlight()` — expanding pulse ring to point the eye at the hinted weight. |
| [`src/render/ui.ts`](../src/render/ui.ts) | `drawHintIcon(g, size, state)` — lightbulb with a corner badge: `'have'` (lit bulb + green disc) / `'empty'` (dim bulb + blue **▶** chip). The stash count is a Text child of the button (Graphics can't draw text); `GameScene.refreshHint()` keeps icon + number in sync. |
| [`src/services/review.ts`](../src/services/review.ts) | **Rate-this-app wrapper** (`@capacitor-community/in-app-review` v8 → native StoreKit `AppStore.requestReview`). One-shot, web-no-op. `maybeRequestReview(global, stars)` fires from the win overlay on the first 3★ clear at global ≥ 8 (delight) or by global ≥ 12 (fallback). |
| [`src/main.ts`](../src/main.ts) | Reserves the banner strip pre-layout, then `initAds().then(showBanner)` + `initIap()` after boot; `initHintState()` + `initReview()` load the daily-hint and one-shot-review flags. |
| [`src/services/iap.ts`](../src/services/iap.ts) | **Remove-Ads IAP wrapper** (Phase 2). StoreKit via `CdvPurchase`, web-no-op, mirrors ownership into `setAdsRemoved()`. |
| [`src/render/MenuScene.ts`](../src/render/MenuScene.ts) | "Remove ads · _price_" + "Restore purchases" — device only, hidden once bought. |
| [`ios/App/App/Info.plist`](../ios/App/App/Info.plist) | `GADApplicationIdentifier`, `NSUserTrackingUsageDescription`, `SKAdNetworkItems`. |

**Tuning knobs** live at the top of [`ads.ts`](../src/services/ads.ts):
`TESTING`, the per-platform `TEST_UNITS_IOS` / `TEST_UNITS_ANDROID` /
`LIVE_UNITS_IOS` / `LIVE_UNITS_ANDROID` (picked by `IS_ANDROID`),
`BANNER_RESERVE_DESIGN_PX` (60), and the interstitial cadence constants below.
The banner also reports its real height at runtime
(`BannerAdPluginEvents.SizeChanged`) and the layout reserves exactly that — see
`setBannerHeightHandler` in [`main.ts`](../src/main.ts).

### Interstitial cadence — the hybrid gate

Tuned from a dedicated **psychology + revenue + competitive-teardown** study
(three independent 2024-25 research passes, all converging: *keep interstitials
but run them light; recover revenue via the opt-in rewarded hint + Remove-Ads
IAP, not interstitial frequency* — this game's LTV is dominated by its App Store
rating and retention, and being **no-fail** it structurally lacks the fail/retry
slot that carries most casual ad revenue).

`interstitialWouldShow(clearedGlobal)` is the single source of truth (a
non-consuming predicate); `maybeShowInterstitial` acts on it, and the win overlay
reads it to keep the rating ask off the same win. It returns true only when
**every** condition holds — a count decides *where* (a natural break), time /
session / opt-in state decide *whether*:

| Constant | Value | Guard |
|---|---|---|
| `ONBOARDING_LEVELS` | `8` | Cleared global must be `> 8` — the balloon mechanic debuts at L6, so the player hasn't met the hook before ~L8. |
| — (pack finals) | `24 / 48 / 72` | Never on a pack-complete clear; the L72 "The End!" must never get an ad chaser. |
| `CLEARS_PER_INTERSTITIAL` | `3` | ≥ 3 clears since the last shown ad (a learnable "every 3rd win" rhythm). |
| `MIN_SECONDS_BETWEEN_ADS` | `180` | Hard spacing floor — never two ads closer than 3 min (reads "calm/premium"). |
| `FIRST_AD_MIN_SESSION_SECONDS` | `90` | Per-session warm-up — no ad in the first 90 s after launch. |
| `MAX_ADS_PER_SESSION` | `3` | Session cap (the 4th impression is lowest-value / highest-annoyance). |
| `REWARDED_SUPPRESS_SECONDS` | `300` | Mute interstitials for 5 min after an opt-in rewarded hint — don't double-tax volunteered attention. |

Fires **only** on the player's own "leave" tap after a win — `leaveAfterClear` →
Next / "The End!" / Map, never on Retry, mid-level, the win overlay, or app-open.
That tap-gating is the placement fix: the ad lands as a neutral page-turn *between*
levels (peak-end rule), after the player has savored the star reveal at their own
pace — no artificial delay needed.

**Review mutual-exclusion:** the win overlay only fires `maybeRequestReview` when
`interstitialWouldShow` is false, so a rating ask and an ad never stack on one
win (the review is one-shot and simply defers to the next clean win).

Net effect: zero ads until genuinely hooked (~L9, past the 90 s warm-up), then a
predictable ad ~every 3rd win, ≥ 3 min apart, ≤ 3/session, never right after a
rewarded hint, never on a pack final, never on the review beat. The counter
(`exactly67.adClears`) persists across launches; the warm-up + spacing neutralize
a stale cross-session count. `lastInterstitialAt` / `adsThisSession` /
`lastRewardedAt` are in-memory (per session). All values are defaults to
**A/B-test via remote config** (D7 retention × blended ad+IAP LTV as target,
1-star rate / D1 uninstall as guardrails — never raw week-1 ARPDAU).

---

## Going live

**Done:** `TESTING = false` is committed, so the app serves real ads. The AdMob
apps, ad units, store listings, and compliance declarations are complete. What
remains is shipping each store build to **production** and letting AdMob approve
the now-public apps for full fill (a few days). Note: AdMob treats
simulators/emulators as test devices, so even with `TESTING = false` you see
"Test mode" fillers there — that is expected and never billed.

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

### Ship to production (per platform)
1. Test the build on a **real device** first (live ads won't fill until AdMob
   approves the now-public app; do **not** tap your own live ads).
2. Build (`TESTING = false` is already committed):
   - **iOS:** `npm run ios:sync` (**Node ≥ 22**) → `fastlane build_and_upload`.
   - **Android:** bump `versionCode` in `android/app/build.gradle` → `npm run
     build && npx cap sync android` (**Node ≥ 22**) → signed AAB (`./gradlew
     bundleRelease`, `JAVA_HOME` = Android Studio JBR, keystore via the gitignored
     `keystore.properties`).
3. Promote: App Store → submit the version + IAP together, then **Release** after
   approval; Play → Production track (new release + rollout). AdMob approves each
   app for full ad serving within a few days of it being public.

Step-by-step build/upload/submission commands and gotchas: [`RELEASE.md`](RELEASE.md).

### Remaining compliance nits
- [ ] `SKAdNetworkItems` (iOS) — the plist has a starter set; replace with
      **Google's full current partner list** (AdMob iOS setup docs) to maximize
      revenue.
- [ ] ATT + UMP consent (`initAds()`) — verify the prompts appear on a real
      device.
- [ ] **Never tap your own live ads** → invalid traffic → AdMob ban. Register
      your device as a test device, or keep `TESTING = true` while developing.

---

## Phase 2 — the Store (hint packs + Remove Ads)

> **Read this before touching prices.** The four products form a deliberate ladder:
> `10 = $0.99 < 30 = $1.99 < 100 = $2.99 < unlimited+no-ads = $4.99`. The unlock
> grants unlimited hints, so it must always cost **more than the largest pack**.
> When it was $0.99 it strictly dominated every pack (cheaper *and* unlimited),
> which turned the packs into dominated decoys — anyone who bought one paid more
> for less. That is both self-cannibalising and the exact harm the EU CPC Network
> names (Mar 2025): *"causing consumers to overspend compared to what they
> otherwise would have."* Keep `unlock > largest pack`, or delete the packs.
>
> [`StoreScene.ts`](../src/render/StoreScene.ts) also deliberately omits countdown
> timers, fake scarcity, "Most Popular" badges (no sales data ⇒ untrue) and
> crossed-out prices we never charged. Truthfully-disclosed fake reference prices
> measurably *reduce* willingness to buy. Don't add them.

## Phase 2a — Remove Ads (non-consumable)

Implemented as a skeleton against **StoreKit via `cordova-plugin-purchase`** (the
`CdvPurchase` global) — no third-party backend or account. It lives in
[`src/services/iap.ts`](../src/services/iap.ts): registers one non-consumable,
verifies + finishes transactions, mirrors ownership into `setAdsRemoved()`
(hides the banner, skips interstitials, **keeps** the rewarded hint), and exposes
buy / restore. The menu surfaces a single **"Store"** button; the Store screen
carries the packs, the unlock and "Restore purchases". The
`exactly67.adsRemoved` flag persists and gates `main.ts` on boot; `initIap()`
reconciles on every launch, so a restore after reinstall clears the banner.

Owners are **never** shown a pack: `adsRemoved()` already makes hints unlimited
(`GameScene.doHint` bypasses the stash), so a pack would be selling nothing.
`StoreScene` renders an owned state for them instead.

`iap.ts` already picks the store platform at runtime (`APPLE_APPSTORE` on iOS,
`GOOGLE_PLAY` on Android), so the same code transacts on both once each store has
the product.

**To make it transact:**
1. **App Store Connect** → create a **Non-Consumable** IAP with product id
   `com.noqyris.exactly67.removeads` (must match `REMOVE_ADS_ID` in `iap.ts`),
   price **$4.99**. *(Already created; repriced from $0.99 — see the ladder note
   above.)* The three consumables (`…hints10/30/100`, matching `HINT_PACKS`) are
   created too, at $0.99 / $1.99 / $2.99, all **Ready to Submit**.
2. **Google Play Console** → Monetise with Play → In-app products → create the
   one-time product with the **same** id `com.noqyris.exactly67.removeads`
   (~$4.99) **and** the three consumables at the same prices as iOS.
   *(Blocked: needs a **Google Payments profile** — legal name, bank
   account, tax info — created first at Play Console → Settings → Payments profile.
   This is the developer's own financial/legal data. Android production can ship
   with ads meanwhile; the Remove-Ads product can be added later without a new
   build.)*
3. `cap sync ios` / `cap sync android` (**Node ≥ 22**) to pull the Cordova
   plugin's native code in.
4. Test with a **sandbox tester** (Apple) / **licence tester** (Play) on a real
   device.
5. The web bundle never includes the plugin (no import; types via a `///
   <reference>`), so dev/browser stays unaffected.

> Pricing note: under Apple's **Small Business Program** (likely eligible,
> revenue < $1M) commission is 15%, so ~$4.24 nets through on the $4.99 unlock
> and ~$0.84 on the $0.99 pack.

---

## Further reading
- [`docs/ARCHITECTURE.md`](ARCHITECTURE.md) — layers, services pattern the ad
  wrapper follows.
- `@capacitor-community/admob` — [npm](https://www.npmjs.com/package/@capacitor-community/admob) · [Capacitor Ads guide](https://capacitorjs.com/docs/guides/ads).
- [AdMob iOS privacy strategies](https://developers.google.com/admob/ios/privacy/strategies) — ATT / SKAdNetwork / UMP.
