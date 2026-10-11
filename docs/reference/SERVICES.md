# Module reference — `src/services` (platform abstraction)

Per-file reference for the platform boundary: audio synthesis, haptics,
persistence, the progress cache, sharing, build flags, and monetization — the ad
policy layer, its provider seam and the two providers, IAP, and the rating prompt.
Every service is **guarded and fire-and-forget**: it degrades to a silent no-op
where its platform is missing (web/dev) and never throws into a scene. Deeper than
[`ARCHITECTURE.md` §5](../ARCHITECTURE.md). Line anchors (`:n`) are approximate —
files have grown since they were first written.

> **Layer rule:** `services/` may import the `game/` data model and platform SDKs,
> but never `render/` (and never Phaser — the ad layer gets the game loop through
> callbacks). One-way chains, no cycles: `iap.ts → ads.ts`;
> `ads.ts → adProvider.ts`, `providers/*`, `audio.ts`, `music.ts`, `storage.ts`,
> `game/levels`; `providers/* → adProvider.ts`.

---

## `audio.ts` — Web Audio synth (zero files)

Every SFX is synthesized at play time from `OscillatorNode` + `GainNode`
envelopes; the game ships **no audio files**. The music bed lives in `music.ts`;
both are covered in depth by [`AUDIO.md`](../AUDIO.md).

| Export | Behavior |
|---|---|
| `setSoundEnabled` / `soundEnabled` | Toggle + read the effects flag. |
| `audioContext()` | The one shared `AudioContext`, **not** gated on the effects toggle (`music.ts` uses it). |
| `resumeAudio()` | Nudge a suspended/`interrupted` context back to running; if unrecoverable, drop it so the next play rebuilds a fresh one. |
| `playPlace` / `playPlaceBalloon` / `playRemove` / `playRefuse` | Placement, balloon, removal and refusal sounds. |
| `playHintChime` | The hint demo's cue. |
| `playWinJingle` / `playCelebration` | The two beats of a level clear: the "six-seven" jingle (impact), then the fanfare (reward). |

**Gotchas:**
- The private `context()` lazily creates the context, returns `null` when effects
  are off, and resumes any non-`running` state — so the **first user tap unlocks
  audio** on iOS.
- Exponential gain ramps go `0.0001 → gain → 0.0001`, never to exactly `0`.
- **Audio after an ad:** a full-screen ad, a phone call or backgrounding leaves the
  iOS context suspended/`interrupted`. A module-level `visibilitychange` listener
  resumes it on return, and `ads.ts` calls `resumeAudio()` (and `startMusic()`)
  whenever a full-screen ad is over, however it ended.
- **Music under an ad:** `music.ts` exports `suppressMusic(on: boolean)`, a counted
  hold that `startMusic()` obeys (`Math.max(0, …)`, so an extra release banks nothing).
  `ads.ts` takes it before `stopMusic()` and releases it just before its final
  `startMusic()`, so the bed's own visibility / focus / pageshow listeners cannot start
  the pad under an ad that is still on screen. See [`AUDIO.md`](../AUDIO.md).

---

## `haptics.ts` — Capacitor haptics, web no-op

Wraps `@capacitor/haptics`. Every call is gated by the `enabled` flag and is
fire-and-forget with `.catch(() => {})`, so on web it silently no-ops.

| Export | Feedback |
|---|---|
| `setHapticsEnabled` / `hapticsEnabled` | Toggle + read. |
| `placeTap` / `removeTap` | `ImpactStyle.Light`. |
| `refuseTap` | `NotificationType.Warning`. |
| `winTap` | `NotificationType.Success`. |

---

## `storage.ts` — Capacitor Preferences

Wraps `@capacitor/preferences` (native key/value on iOS/Android, `localStorage` on
web — web keys are prefixed `CapacitorStorage.`). Every read/write is try/caught
and degrades to a safe default.

**Keys** (all namespaced `exactly67.*`):

| Key | Type | Default when missing |
|---|---|---|
| `exactly67.progress` | JSON `{ stars, best }` (via `parseProgress`) | empty |
| `exactly67.sound` | `'on'`/`'off'` | **on** (`value !== 'off'`) |
| `exactly67.haptics` | `'on'`/`'off'` | **on** |
| `exactly67.music` | `'on'`/`'off'` | the `fallback` passed in — `MUSIC_ON_BY_DEFAULT` in `main.ts` |
| `exactly67.adClears` | integer string (interstitial cadence counter) | `0` |
| `exactly67.adsRemoved` | `'on'`/`'off'` — owns **either** ad-removal product | `false` (`value === 'on'`) |
| `exactly67.unlimitedHints` | `'on'`/`'off'` — owns the $4.99 unlock | **`null`** = pre-split install; `main.ts` grandfathers it from `adsRemoved` and writes it back |
| `exactly67.hintFreeDate` | UTC `YYYY-MM-DD` of the last free daily hint | `''` |
| `exactly67.hintCount` | integer string — the banked hint inventory | `0` |
| `exactly67.reviewRequested` | `'on'`/`'off'` — the one-shot rating ask | `false` |
| `exactly67.dailyDone` | UTC `YYYY-MM-DD` of the last Daily Challenge clear | `''` |
| `exactly67.levelplayConsentMigrated` | `'on'` once the one-time LevelPlay consent reset has run (`ads.initAds()`, or the first question if earlier) | `false` — and an **unreadable** store also reads `false`, unlike `loadFlag`: a hiccup costs one more consent question, skipping the reset could start the SDK on a Google-era answer |
| `exactly67.adConsentAskedAt` | Epoch ms the ad-consent question was last shown (`loadAdConsentAskedAt` / `saveAdConsentAskedAt`) — option A's 180-day re-ask rule | `0` — never recorded (every answer from before option A, which is asked once more on a tap) |
| `exactly67.adConsentTally` | JSON counts of answers to the question, `"<afterLevel\|adTap\|settings>:<granted\|denied\|unanswered>"` → n (`tallyAdConsentAnswer` / `loadAdConsentTally`) — no time, no identifier, never sent | `{}` |

**Exports:** `loadProgress`/`saveProgress`, `loadSoundEnabled`/`saveSoundEnabled`,
`loadHapticsEnabled`/`saveHapticsEnabled`, `loadMusicEnabled(fallback)`/`saveMusicEnabled`,
`loadAdClears`/`saveAdClears`, `loadAdsRemoved`/`saveAdsRemoved`,
`loadUnlimitedHints`/`saveUnlimitedHints`, `loadFreeHintDate`/`saveFreeHintDate`,
`loadHintCount`/`saveHintCount`, `loadReviewRequested`/`saveReviewRequested`,
`loadDailyDone`/`saveDailyDone`, `loadConsentMigrated()`/`saveConsentMigrated()` (the
save takes no argument: it only ever writes `'on'`, and a failed write just runs the
reset once more next launch).

> **Renaming any key silently orphans player data** — and for `adsRemoved` /
> `unlimitedHints`, silently strips a paid entitlement. Do not collapse
> `loadUnlimitedHints()` to a plain boolean: its `null` is how pre-split owners keep
> the perk they paid for. The ad consent decision is **not** stored here; the
> LevelPlay plugin keeps it natively. Only whether the one-time reset of that decision
> has run is stored here.

---

## `progressStore.ts` — in-memory progress cache

| Export | Behavior |
|---|---|
| `initProgress()` | Loads `current` once at boot (awaited before Phaser starts). |
| `progress()` | Synchronous read of the cache. |
| `recordClear(globalLevel, stars, weightsUsed)` | Merges via `mergeClear`, then `void saveProgress(current)` **without awaiting** — a slow/failed native write never blocks gameplay. |

---

## `buildFlags.ts` — build-time flags

| Export | Behavior |
|---|---|
| `allLevelsUnlocked()` | `import.meta.env.VITE_UNLOCK_ALL === '1'`. Only `npm run build:tf` (→ `ios:testflight`) sets it; `LevelMapScene` then opens every level. |
| `UNLOCK_ALL_MARKER` | `'UNLOCKALL:1'` in that build, `''` otherwise — the literal the release gates count. |
| `stampBuildFlags(root?)` | Called once at boot: writes the marker to `<html data-build-flags>`. Reading it from live code is what keeps the literal in the bundle, and the `live` gate refuses any bundle that carries it. |

Every flag here is **off unless explicitly enabled**, so forgetting one costs a test
build, never a broken App Store build.

---

## `share.ts` — result sharing

| Export | Behavior |
|---|---|
| `shareSupported()` | Whether `navigator.share` exists. |
| `shareText(text)` | OS share sheet via `navigator.share`; on cancel or absence, the clipboard. Resolves `'shared' \| 'copied' \| 'unavailable'`, never throws. The text itself is built by `game/share.ts` (route glyphs, never a weight value). |

---

## `ads.ts` — the ad policy layer

Decides **when** an ad may appear and what happens around it; it does not know
**who** serves it. Every network call goes through the `AdProvider` seam. Same
guarded, fire-and-forget pattern as `haptics.ts`. See
[`MONETIZATION.md`](../MONETIZATION.md) for the reasoning behind every rule.

**Constants** (all pinned by `adsPolicy.test.ts`; unchanged by the network move):

| Const | Value | Meaning |
|---|---|---|
| `CLEARS_PER_INTERSTITIAL` | `3` | Clears since the last presented interstitial before another may show. |
| `ONBOARDING_LEVELS` | `8` | No interstitial for a cleared global ≤ 8. |
| `MIN_SECONDS_BETWEEN_ADS` | `180` | Spacing floor between interstitials. |
| `FIRST_AD_MIN_SESSION_SECONDS` | `90` | Per-session warm-up. |
| `MAX_ADS_PER_SESSION` | `3` | Session cap. |
| `REWARDED_SUPPRESS_SECONDS` | `300` | No interstitial this long after an earned rewarded hint. |
| `PACK_FINALES` | 24, 48, …, 600 | Derived from `PACKS`: every pack-complete clear lands ad-free. |
| `AD_LOAD_TIMEOUT_MS` / `AD_SHOW_TIMEOUT_MS` | 15 s / 180 s | Deadlock breakers — timing out loses the ad, never locks the game. |
| `REWARD_AFTER_CLOSE_MS` | 800 ms | Grace for adapters that emit *closed* before *rewarded*. |

**Availability & entitlements**

| Export | Behavior |
|---|---|
| `adsSupported()` | `false` when `VITE_ADS=off`; `true` for `VITE_ADS=mock` on any platform; otherwise `Capacitor.isNativePlatform()`. |
| `adsRemoved()` / `setAdsRemoved(v)` / `primeAdsRemoved(v)` | Either ad-removal product. `set*` persists and destroys the banner; `prime*` only reflects the stored value at boot. |
| `hintsUnlimited()` / `setUnlimitedHints(v)` / `primeUnlimitedHints(v)` | The $4.99 unlock only. **Gate free hints on this, never on `adsRemoved()`.** |

**Lifecycle**

| Export | Behavior |
|---|---|
| `initAds()` | No-op without an ad surface, for Unlimited owners, or on a second call. **Asks nothing** (option A). Loads the cadence counter and the consent ask time, registers `onReady → showBanner` and `onConsentChange` (a no → `removeBanner()`), then — only if `loadConsentMigrated()` is false — `provider.resetConsent()` followed by `saveConsentMigrated()` (one shared run, which any earlier question also waits for), then `provider.init()` (applies a stored answer; the SDK only on a stored yes, ATT first). Reset first, flag after: a kill in between only asks once more. A failed init is swallowed; parked banner requests are released either way. |
| `adsForegrounded()` | On every return to the foreground: `provider.retryInit()` and, unless a full-screen ad is up, `showBanner()`. |
| `openPrivacyOptions()` | Settings → "Privacy & ads" (and the menu's corner link): asks the consent question whatever the answer, however recent (`provider.askConsent('settings')`). No-op without an ad surface and for Unlimited owners. |
| `adConsentState(): ConsentState` | The stored answer (`UNKNOWN` / `GRANTED` / `DENIED`); a provider with no question reports yes/no through `adsAllowed()`. |
| `setGameLoopHooks({ pause, resume } \| null)` / `GameLoopHooks` | `main.ts` registers the Phaser loop's sleep/wake so a full-screen ad gets the whole device. |

**Banner**

| Export | Behavior |
|---|---|
| `BANNER_RESERVE_DESIGN_PX` | `58` (re-exported from `adProvider.ts`). |
| `bannerReserve()` | `58` when a banner will be requested (ad surface, nothing bought), else `0`. Intent-based, so the first layout already leaves the gap. |
| `showBanner()` | Idempotent and self-healing: waits for the SDK gate, then asks consent (`provider.adsAllowed()`) — only after the gate, since before it the modal may be unanswered — creates once (concurrent callers share one creation), resumes afterwards; a purchase or a withdrawal that landed mid-creation removes the new banner at once. A refusal just leaves the strip empty until the next re-ask. |
| `hideBanner()` / `removeBanner()` | Hide under a full-screen ad / destroy on a purchase or a consent withdrawal. Both also act on a banner that was only **requested** (private `bannerRequested`, set before `bannerShow()` and cleared only by `removeBanner()`): the plugin attaches the view before it loads and leaves it attached when the load fails, for LevelPlay to fill later. No plugin call if nothing was ever requested (an owned product re-delivered at boot). |

**Interstitial**

| Export | Behavior |
|---|---|
| `noteCleared()` | Count one clear toward the cadence (persisted). |
| `interstitialWouldShow(global)` | The whole gate as a non-consuming predicate, consent included (false while the provider's answer is not `GRANTED`); the win overlay reads it to keep the review ask off an ad win. |
| `maybeShowInterstitial(global, ctx)` | The break on the way out of a win card. **Option A:** for a player with no consent answer — once per session, never for an ad-free owner, never after a card with `cardAsk` / `rewardPrompt` — the consent question takes this break's place (`'afterLevel'`; resolves `false`, no ad presented, once answered). Otherwise the interstitial gate above. |
| `maybeShowInterstitial(global): Promise<boolean>` | Gate → load (on LevelPlay, from the prefetch cache only) → show under `underFullScreenAd` → resolves **after the dismissal** (or at once when nothing shows). `true` only if an ad was presented, and only then is the cadence spent. |

**Rewarded**

| Export | Behavior |
|---|---|
| `rewardedOffered(): boolean` | Whether any "Watch ad" offer may be drawn, read at draw time. `true` where there is no ad surface (the reward takes its free-grant path); never for an Unlimited owner; otherwise option A: with consent, or where a tap would ask (no answer; a refusal with no recorded time or older than 180 days) — **hidden inside a refusal's 180-day quiet period**, and until the stored answer is read. Deliberately **not** "is an ad loaded": no fill is a moment, and the button's "Loading…" state and the modal's note cover it. |
| `RewardedOutcome` | `'earned' \| 'unavailable' \| 'not-earned' \| 'no-consent'`. `unavailable`: no video was ever shown (no fill, a failed or timed-out load, no consent and no question to ask, another full-screen ad up). `not-earned`: a video was handed to the SDK and did not pay out (closed early, failed to present, never displayed in time). `no-consent`: the tap asked for consent and got no yes — nothing loaded or shown; screens say nothing. |
| `watchRewardedHint(): Promise<RewardedOutcome>` | One video for one hint (`watchRewarded(placement)` for every placement). `'earned'` without an ad where there is no ad surface (dev / `ADS:off`); `'unavailable'` at once when no offer stands or another full-screen ad is up; without consent the tap asks first (`'adTap'`; anything but a yes → `'no-consent'`); otherwise load → show under `underFullScreenAd`. The caller grants the reward on `'earned'` only. |
| `showRewardedHint(): Promise<boolean>` | `watchRewardedHint()` folded to a boolean: `true` only on `'earned'`. |

**Hint inventory**

| Export | Behavior |
|---|---|
| `initHintState()` | Load the stash; the first boot of a new UTC day adds the free hint. Awaited at boot. |
| `hintCountValue()` / `hasHint()` | Read the stash. |
| `useHint()` | Spend one; `false` and no change when empty. |
| `grantHint()` / `grantHints(n)` | After an earned video / a hint-pack purchase. |

**Under a full-screen ad** (`underFullScreenAd`, private): pause the loop,
`suppressMusic(true)`, stop the music, then inside the `try` hide the banner and attach
the dismissal watcher **before** `show()`; afterwards, in a `finally`, cancel the
watcher, wake the loop, `resumeAudio()`, `suppressMusic(false)`, `startMusic()`,
`showBanner()`. A throw — even from `hideBanner()` or the watcher — can never leave the
game asleep or the music held.

---

## `adProvider.ts` — the seam

| Export | Behavior |
|---|---|
| `AdProvider` | `id`, `testing`, `supports(format)`, `init()`, `bannerShow/Resume/Hide/Remove()`, `loadInterstitial()`, `showInterstitial()` (resolves on present), `loadRewarded()`, `showRewarded()` (settles **only** on the reward), `resolvesOnPresent(format)`, `watchDismissal(format, timeoutMs)`; optional `rewardedReady()`, `adsAllowed()` (synchronous: may this network serve anything right now; omitted = no consent gate), `consentState()` (the stored answer, `UNKNOWN` until read), `askConsent(trigger)` (show the question now, resolve with the answer; a yes has gone on to ATT and the SDK), `onConsentChange(listener)` (every change of answer), `resetConsent()` (forget every stored decision; never rejects; called once per install before the first `init()` and any question), `retryInit()`, `onReady(listener)`. `init()` asks nothing. |
| `AdFormat` / `DismissWatcher` | `'banner' \| 'interstitial' \| 'rewarded'` / `{ done, cancel }`. |
| `adsOff()` / `adsMock()` | Read `VITE_ADS` at call time (so tests can stub it). |
| `ADS_MARKER` | `'ADS:off' \| 'ADS:mock' \| 'ADS:on'`, folded once at build time; rides on each provider's `id`. |
| `BANNER_RESERVE_DESIGN_PX` | `58`: LevelPlay's fixed 320×50 pt `BANNER`, pinned to the safe-area bottom, plus 8 pt of air. Lives here so the mock can draw at exactly this height without importing the policy layer. |

---

## `providers/levelplay.ts` — Unity LevelPlay

Ported from KVIZKO (same plugin, `capacitor-levelplay-ads` **0.1.42**, in production
there). Every network-specific detail lives here.

| Export | Behavior |
|---|---|
| `levelplayProvider` | The `AdProvider`. `id` = `` `levelplay ${AD_MODE_MARKER} ${ADS_MARKER}` `` — the gate markers ride on it. `testing: false`, hard-wired: LevelPlay has no test inventory. |
| `askConsent(trigger)` (on the provider) | The question: `requestConsentInfo` while unanswered, `showPrivacyOptions` for `'settings'` or to re-ask a refusal (120 s ceiling); options from `services/adConsentCopy.ts` (`CONSENT_COPY`, `consentMessage(trigger)` — one more sentence for `'adTap'` — `PRIVACY_POLICY_URL`, `privacyButtonText`). A yes → ATT → SDK (bounded); a no → neither. One alert at a time. |
| `advertisingId()` | The advertising id the dashboard's Test Devices list wants (`''` off-device; all zeros when ATT was declined). A pin does **not** make tapping safe. |
| `__resetForTests(config?)` | Test seam: forget SDK/consent state and optionally stand in a configured key + units. Never called by the app. |

**Config (module constants):**
- `TESTING = import.meta.env.VITE_AD_MODE !== 'live'` → passed as `isTesting` (which
  only unlocks Unity's Test Suite) and folded into `AD_MODE_MARKER`
  (`'ADMODE:test' | 'ADMODE:live'`).
- `APP_KEYS` / `UNITS_BY_PLATFORM` — **iOS is real** (LevelPlay app created
  2026-09-16): app key `282af3d55`; banner `bkov9ky03m5q7nb5`, interstitial
  `037b2c2vtwjlz5bg`, rewarded `v9y4469brsj85byl`; Unity Ads bids on all three (Game
  ID `800374923`, placements `BP_*_iOS`). **Android is empty** — it has no LevelPlay
  app, and `init()` refuses the empty key. Keep them plain string literals:
  `scripts/check-levelplay-config.mjs` parses this file.
- `CHILD_DIRECTED = false`. (The policy URL and the question's words are in
  `services/adConsentCopy.ts`, shared with the mock.)

**`init()` order (a legal requirement, pinned by `levelplay.test.ts`):** throw on an
empty app key (Android) → attach the consent listener → read the stored answer; **none →
stop: no alert, no ATT, no SDK** (option A: the question is `askConsent()`'s) → apply
the stored answer with no UI (`requestConsentInfo`, 20 s ceiling) → read it again;
**only `GRANTED`** continues → ATT (20 s ceiling; once per process once iOS has
answered) → `setCCPAConsent` (`doNotSell: false`) + `setChildDirected(false)` →
`initialize({ appKey, isTesting })` → prefetch one interstitial and one rewarded →
`onReady` listeners.

**Consent, as the policy layer sees it:**
- `adsAllowed()` returns the recorded decision: `true` only for `GRANTED`, the same rule
  that decides whether the SDK starts.
- `consentState()` keeps "no answer yet" apart from "no" for option A's rules.
- `onConsentChange(listener)` hears every change of answer, once — `init()`'s read, the
  question from any of its three moments; a listener that throws is contained, so it
  cannot cost the SDK start after a yes.
- `resetConsent()` calls the plugin's `LevelPlayAds.resetConsent()` (removes
  `levelplay_consent_status` and the IAB TCF keys the plugin's `custom` provider would
  otherwise read as a decision), bounded by the 20 s ATT ceiling, resolving even when
  the plugin refuses. It does nothing while the SDK is starting or up. The `UNKNOWN`
  status event the call emits is harmless: the policy layer runs it before `init()`
  and before any question subscribes, and a non-`GRANTED` status only ever records a no.

**Behaviour worth knowing:**
- A consent change at any later time is watched: `GRANTED` goes through ATT to the
  SDK; a withdrawal on a running SDK sets `doNotSell: true` (the policy layer then
  removes the banner and stops every ad).
- A failed `initialize()` retries after 30 s, 60 s, 120 s, then once per
  `retryInit()` (every foreground), always only while consent is `GRANTED` and always
  behind ATT — a retry never overtakes an ATT alert still on screen.
- Every load/show is an **event race** with listeners attached before the call and a
  timeout that reads as failure, never a hang. A second load of a format joins the
  one in flight (the plugin would otherwise supersede it).
- **Prefetch.** Both formats are loaded as soon as the SDK is up, again 1.5 s after
  every close or failed present, and retried with backoff (30 s doubling to 5 min)
  after a miss. The two formats answer a cache miss differently:
  `loadInterstitial()` → `fromCache()` answers from `isReady` **only** — a miss is
  `false` at once and starts a prefetch unless a backoff retry is already waiting, and
  a load already in flight is not joined (nobody asked for this ad, and the win card is
  locked while it is decided). `loadRewarded()` → `loadOrCached()` may load at tap time
  (the player asked, and the button shows "Loading…"); a tap-time miss re-arms the
  backoff, a hit resets it.
- **Rewarded display deadline.** The native `showRewarded()` resolves as soon as it
  hands the ad over, so `showRewarded()` also waits for `RewardedDisplayed`: absent
  within `SHOW_EVENT_TIMEOUT_MS` (10 s) it resolves `null` (not shown) and detaches its
  listeners. Once displayed it waits for the reward however long the video runs.
- The banner is `createBanner({ adSize: 'BANNER', position: 'BOTTOM', isAutoShow: true })`
  once, then `showBanner()` / `hideBanner()` / `destroyBanner()`.

---

## `providers/mock.ts` — fake ads

`mockProvider`: the provider for `VITE_ADS=mock` (`npm run dev:mock`,
`build:mock`, `ios:sync:mock`). A banner, an interstitial, a rewarded video that pays
out only after **5 s**, and a FAKE consent window, all drawn in the DOM over the
canvas, with 250 ms of fake latency and **no network**. Consent works like the real
provider (option A): `init()` reads the stored fake answer (`exactly67.mockConsent`,
never the plugin's key) and asks nothing; `askConsent()` draws the window with the real
words and three identical buttons (Accept / Don't accept / Privacy policy); nothing is
loaded or shown without a yes, and a no takes the banner down. `resetConsent()` is a
no-op (the policy layer never runs the migration in a mock build). Every surface reads
"FAKE AD — MOCK BUILD" (the window "FAKE CONSENT WINDOW — MOCK BUILD") and carries
`data-e67-mock="banner|interstitial|rewarded|consent"`; close buttons carry
`data-e67-mock-close`, the window's buttons `data-e67-mock-consent="accept|decline|policy"`. It proves *our* flow, never that the real
waterfall fills. Tree-shaken out of every non-mock bundle, and refused by every store
target of the release gates.

---

## `adConsentCopy.ts` — the consent question's words

| Export | Behavior |
|---|---|
| `CONSENT_COPY` | `title` "Ads and your data", `message` (who shows the ads — Exactly 67 / Noqyris via Unity LevelPlay; who receives what — Unity Technologies, Unity Ads and ironSource Exchange: device and app data, ads seen and tapped, the advertising id only with tracking; why; what a no means — no ads, no ad rewards, hints still come from playing; where to change it — Settings → Privacy & ads), `adTapLead` ("This reward comes with an ad."), `accept` "Accept", `decline` "Don't accept", `privacyButton` "Privacy policy", `settingsRow` "Privacy & ads". Never "Allow", "support us" or "plays the same". |
| `PRIVACY_POLICY_URL` | `https://noqyris.github.io/exactly-67/privacy.html` |
| `consentMessage(trigger)` | The message, with `adTapLead` in front for `'adTap'`. |

Shared by `providers/levelplay.ts` and `providers/mock.ts` — its own module because the
mock must not import the LevelPlay provider (a second `ADMODE` marker in a mock bundle).

## `report.ts` — "Report an ad"

| Export | Behavior |
|---|---|
| `REPORT_ADDRESS` | The support address the support page and the privacy policy give. |
| `AD_REPORT` | The Settings row label and the mail's subject and prompts. |
| `adReportUrl({ platform, version })` | Pure: `mailto:` with the subject "Exactly 67 — ad report · <version>" and a body of three prompts (what, where, when) with "Exactly 67 <version> · <platform>" at the bottom, URI-encoded. |
| `reportAd()` | Opens it (`window.location.assign`; the iOS shell hands the scheme to Mail). `version` is `__APP_VERSION__`, read from `project.pbxproj` at build time by `vite.config.ts`. Never throws. |

---

## `iap.ts` — in-app purchases

StoreKit / Google Play Billing through `cordova-plugin-purchase` (the `CdvPurchase`
global — injected natively, never imported into the web bundle; types via a
`/// <reference>`). No backend, no receipt server.

| Export | Behavior |
|---|---|
| `REMOVE_ADS_ID` | `'com.noqyris.exactly67.removeads'` — the $4.99 **Unlimited hints + no ads** non-consumable (pre-split owners bought it at $0.99 with both perks). |
| `NO_ADS_ID` | `'com.noqyris.exactly67.noads'` — the $0.99 **No ads** non-consumable. Never grants unlimited hints. |
| `HINT_PACKS` / `HintPack` | Consumables `hints10` / `hints30` / `hints100` → 10 / 30 / 100 hints. |
| `iapSupported()` | `isNativePlatform() && typeof CdvPurchase !== 'undefined'` — the `typeof` guard means web never ReferenceErrors. |
| `initIap()` | Registers all five products, wires `approved` → grant → `finish()`, initializes the platform store (`APPLE_APPSTORE` / `GOOGLE_PLAY` picked at runtime). |
| `setIapListener(cb)` / `setHintPurchaseListener(cb)` | UI refresh on product/ownership changes / after a pack is bought. |
| `removeAdsPrice()` / `noAdsPrice()` / `hintPackPrice(id)` | Localized price, or `null` before metadata loads (the Store hides an offer without a price). |
| `buyRemoveAds()` / `buyNoAds()` / `buyHintPack(id)` | Start a purchase; StoreKit shows its own sheet. |
| `restorePurchases()` | Re-delivers owned non-consumables as `approved` → grant. A required visible action. |

**Entitlement is granted only** on an `approved`/`finished` transaction that actually
contains the product — a genuine purchase or restore. A cancel fires `error`, never
`approved`. It deliberately does **not** grant off `store.owned()` /
`receiptUpdated`. `grant()` never revokes, so a restore that re-delivers only the
cheap product cannot strip unlimited hints from a bundle owner.

---

## `review.ts` — rating prompt

| Export | Behavior |
|---|---|
| `initReview()` | Load the one-shot flag at boot. |
| `maybeRequestReview(global, stars)` | Native only, once ever: on a 3★ clear at global ≥ 8, or any clear at global ≥ 12. Spends the flag before calling `InAppReview.requestReview()`. The win overlay calls it only when `interstitialWouldShow` is false. |

---

## Boot ordering

`main.ts` awaits `initProgress()`, the settings, both entitlement flags and
`initHintState()` **before** constructing Phaser, then primes the entitlements and
reserves the banner strip, so no scene reads an empty cache or a wrong entitlement.
Ads start after boot **and after the splash is gone**
(`splashGone.then(initAds).then(showBanner)`); `initIap()` and `initReview()` run
after boot, so first paint is never blocked on the network.
