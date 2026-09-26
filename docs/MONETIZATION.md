# Monetization — Ads & IAP

How *Exactly 67* makes money: when an ad may appear, how the ad code is layered,
how consent works, how purchases grant entitlements, and what is left before the
first LevelPlay release.

> **Status (16 September 2026)**
> - **Network: Unity LevelPlay**, through `capacitor-levelplay-ads` pinned
>   exactly `0.1.42`, mediating **Unity Ads** only (`package.json` →
>   `levelplay.networks: ["unityads"]`).
> - **AdMob is gone entirely** — the dependency, every line of code, the
>   `Info.plist` app id and SKAdNetwork id, and the Android manifest id. Google
>   terminated publisher account `pub-3307486877162157` on 2026-08-18 for invalid
>   traffic, after real-ads builds reached TestFlight and the owner tapped his own
>   ads; the appeal was refused on 2026-08-19, and it is final. Google ad revenue is
>   permanently gone, and a Google network must never come back
>   (`scripts/check-no-google.mjs` fails every sync chain if one does).
> - **iOS: the LevelPlay app and its ad units exist (created 2026-09-16)**, and
>   their ids are in [`providers/levelplay.ts`](../src/services/providers/levelplay.ts):
>   app key `282af3d55`; banner `bkov9ky03m5q7nb5`, interstitial `037b2c2vtwjlz5bg`,
>   rewarded `v9y4469brsj85byl`. `npm run ads:config -- ios` passes. **Every iOS
>   build with ads on now asks ATT and consent, and on consent serves real ads.** See
>   [Going live](#going-live--what-is-left).
> - **Android has no LevelPlay app** and is not being released: its entries stay
>   empty, `init()` refuses the empty key, and `npm run ads:config -- android` fails.
> - **App Store:** 1.2.0 is live (AdMob-era; its ads went dark with the account).
>   1.2.1 is the first LevelPlay release and has not been submitted.
> - Privacy policy: [`docs/privacy.html`](privacy.html), served at
>   <https://noqyris.github.io/exactly-67/privacy.html> once `docs/` is published.
>
> Build and release mechanics, including the two-build release:
> [`RELEASE.md`](RELEASE.md).

---

## 1.3.0 — what changed (2026-09-23)

Researched first (see [`RETENTION.md`](RETENTION.md) for the retention side and its
sources), then built:

- **Eight rewarded placements, not one** — hint modal, daily gift, Star Jar, pack
  bonus, streak milestone, the Store's free tile, streak freeze, streak repair. Each
  is an optional upgrade on a free base reward (the gift: "Take 4" / "Watch ad: +2 more";
  the win card pays its free part at once and offers "Watch ad: +N more"), names
  the ad and the reward, and is capped per local day in code (`economy.ts`
  `PLACEMENT_CAPS`, 12 a day in total) because the LevelPlay plugin's
  `showRewarded()` takes no placement name — the dashboard cannot cap them apart.
  Apps with 3+ rewarded placements earn materially more ad ARPDAU; Unity's own
  data puts the end-of-level multiplier first for puzzle games.
- **No interstitial on a clear that offers a reward** (`InterstitialContext
  .rewardPrompt`): two ad prompts on one win is the double tax players remember.
  The clear counter is not spent, so the break moves to the next clear.
- **Payers see half the interstitials**: every 6th clear instead of every 3rd once
  anything has been bought (`clearsPerInterstitial`, fed by `meta.offers.purchased`,
  which 1.3.0 sets on every purchase). Nothing in the UI promises it. **A 1.2.x
  hint-pack buyer counts as a non-payer** (every 3rd clear) until they buy again: a
  consumable leaves no local record from before 1.3.0, and StoreKit restores only
  non-consumables. The unlock owners are unaffected — they see no interstitials.
- **Welcome pack** — `com.noqyris.exactly67.welcome`, consumable, **25 hints at the
  lowest tier ($0.99)**, **once per install** for a player who never bought anything
  and owns no unlock (a consumable cannot be restored, so a reinstall can show it
  again, and a 1.2.x hint-pack buyer — no record, see above — is offered it too; the
  copy says "welcome offer" / "for new players", never "one-time").
  While it shows it **replaces the 10-hint tile**, so nobody is offered more-for-less
  beside it. Shown in the Store (hero card), as "Welcome pack!" on the menu's Store
  button and in the out-of-hints modal's link — never as a pop-up. Until the
  product exists in App Store Connect its price reads null and every surface falls
  back to the ordinary ladder.
- **Store** — hero card, free rewarded tile with a true "N left today", the packs
  as tiles with a per-hint price from StoreKit's micros, **"Best value" computed at
  runtime** (so it stays true after any reprice), No ads, Unlimited.
- **The quiet no-ads nudge** — after 8 interstitials seen, a text link "Remove ads
  between levels" on a win card that is not followed by an interstitial; at most
  every 7 days, 4 times ever.
- **The daily free hint is now the visible daily gift, on a five-day ladder**:
  days in a row pay **1, 2, 4, 6, 8 hints**, day 6 starts over at 1, and a day
  without a claim drops back to day 1 (`economy.ts` `GIFT_LADDER`). The video adds
  a **flat +2** on any rung (`GIFT_AD_BONUS`), never a double: a doubled day 5
  would pay 16 hints for one ad, more than the $0.99 10-pack, and the rewarded
  faucet must never undercut the packs. A player who comes back every day gets
  21 free hints per five days (1.2 gave 5); the ladder is the lever if pack
  revenue drops. Tomorrow's rung is what the next day's reminder may name.

**Recommended, not done (owner's call — it changes what live players pay):**
the research found the ladder priced well below comparable games (Flow Free sells
5 hints for £0.99; standalone remove-ads in the top-100 games is $2.50–$10). If
wanted, reprice in App Store Connect in this order so Unlimited always stays above
the biggest pack: `removeads` → **$9.99**, then `hints100` → **$4.99**, then `noads`
→ **$2.99** (optionally a lower custom price in Serbia and other low-income
storefronts). No code change is needed — every price and the "Best value" badge
come from StoreKit.

**Not built:** a subscription (no receipt server to verify expiry), paid or random
rewards, coins, iCloud backup of the hint balance (consumables cannot be restored,
so a reinstall loses bought hints — worth a small native plugin before raising
pack prices).

## Strategy (the decisions)

A calm, no-fail puzzle lives or dies on its rating and retention, so the model
favours opt-in and light-touch over ad saturation:

| Format | Role | Where |
|---|---|---|
| **Rewarded** | The opt-in earner. Hints are a **banked inventory**: the free **daily gift** (1.3.0: a five-day ladder of 1, 2, 4, 6, 8 hints on days in a row — it replaced 1.2's silent +1 per UTC day at boot) and **+1 per rewarded hint video watched to the end**. A video banks a hint; it does not reveal one, so the player spends hints on their own terms. Offered only while the player's ad consent is `GRANTED`. | **"Watch ad: +1 hint"** ("Ad: +1 hint" where that does not fit, a 320 pt phone) in the hint modal, which opens when the 💡 is tapped with zero hints; **"Watch ad: +2 more"** on the menu's daily-gift card (a flat +2 on any rung, once a day). Every placement and cap: [`RETENTION.md`](RETENTION.md#rewarded-placements-all-capped-per-local-day-in-economyts) |
| **Interstitial** | Occasional full-screen ad at a natural break, under a **hybrid gate**: a clear count decides *where*, time + session + opt-in state decide *whether*. | On the leave-tap after a win (Next / The End! / Map), never on Retry, never mid-level, never in the Daily Challenge. See the cadence table below. |
| **Banner** | Passive fill. | Bottom-anchored, in a **reserved strip** every scene keeps clear |
| **Hint packs (IAP)** | Consumables for players who want help without the unlock: **10 / 30 / 100 hints at $0.99 / $1.99 / $2.99**. Bought hints join the same inventory and never expire (a plain persisted counter, no decay). | Store screen |
| **No ads (IAP)** | **$0.99**, one-time. Removes the banner and the ads between levels (interstitials) and **nothing else** — hints stay consumable, and the opt-in hint video stays available. The Store card says so in its sublabel ("hints not included · hint videos stay", shortened to fit on a 320 pt phone but always naming the hint videos), and so do the App Store description and release notes. | Store screen |
| **Unlimited hints (IAP)** | **$4.99**, one-time. **Unlimited free hints and no ads.** Owners never start the ad SDK at all. The hero tier at the top of the ladder. | Store screen |
| **Rate this app** | Not revenue, but the App Store rating *is* the funnel. The native StoreKit prompt, requested **once**, at a post-win delight peak. | `review.ts`, from the win overlay |

**No app-open ad, ever.** LevelPlay has no such format, and Unity's Placement
Policy bars placements *"launched before an Application has opened"*. Do not
reach for a second SDK to add one.

**No "support us" framing near any ad.** Unity's Rewarded Inventory Policy requires
the reward **and** the required action to be disclosed for each reward ("View this Ad
to receive 10 gems"), withholds payment for inventory that does not, and names
"support us" as a violation. So the button names both — **"Watch ad: +1 hint"** — and
the modal's body does too ("Out of hints — watch a short ad for 1 hint, or grab a
pack." / "You have N hints. Watch a short ad for 1 more."). The old "Watch video" said
neither. All of the modal's copy lives in one `HINT_COPY` constant in `GameScene.ts`;
nothing appeals to helping the developer. The consent modal follows the same rule.

**Revenue reality:** ads monetize *volume*. Without user acquisition, expect
coffee money; the one-time unlocks and the rewarded hint typically out-earn
banner and interstitial at low scale. Don't over-index on impression count.

### The banner — never on a level in play ⚠️

The game is drag-and-drop, and ad networks ban placements where mis-taps are
likely: Unity's Placement Policy bars ads "close to or underneath buttons" and "in
areas where End-Users will randomly click or place their fingers". Until 1.3.0 the
banner sat under the level screen too, with the tray's bottom row 8 pt above it —
where a dragging finger lands. Accidental taps are invalid traffic, the thing that
closed this developer's previous ad account, so **since 1.3.0 a level in play
(`GameScene`: levels and the Daily) carries no banner**. `GameScene.create()` calls
`setBannerStrip(false)` (layout: the board takes the strip) and
`ads.setBannerOnScreen(false)` before it lays out, and both go back on at its
`shutdown`, so the menu, level map, Daily screen and Store keep the banner. Off
**destroys** the banner instead of hiding it: a level lasts minutes, and a hidden
banner view may keep refreshing out of sight; the next banner screen creates a new
one. `showBanner()` is a no-op while it is off — the end of a full-screen ad, a
return to the foreground or the SDK coming up late never bring it back inside a
level — and a banner still being created when a level starts is destroyed once it
lands. A Store launched over a paused level keeps it off. The research behind it
(2026-09-26): the banner on the play screen earns about 10 % of ad revenue at most;
the account is the one thing that cannot be replaced.

On the screens that do carry it, the layout **reserves a fixed strip** at the
bottom and shrinks the content above it, so nothing tappable overlaps the ad:

- LevelPlay's `BANNER` size is a fixed **320×50 pt**, pinned by the plugin to the
  bottom of the **safe area** (above the home indicator). The reserve is
  `BANNER_RESERVE_DESIGN_PX = 58` ([`adProvider.ts`](../src/services/adProvider.ts)):
  50 pt of ad plus 8 pt of air.
- `main.ts` applies `bannerReserve() × DPR` through `setAdBannerReserve()` **before
  any scene lays out**, and [`layout.ts`](../src/render/layout.ts) folds it into
  `safeArea().bottom` on top of the home-indicator inset — on every scene but
  `GameScene`, which turns the strip off (`setBannerStrip`). The reserve is
  intent-based (58 when a banner will be requested, else 0), so the first frame
  already leaves the gap; there is no reflow when the banner arrives.
- The menu's "Privacy choices" link sits in the **top** corner, far from the banner.
- The **level map** is the one screen whose tappable things *scroll*: without help a
  tile slides through the strip's 8 pt of air and under the native banner, putting a
  finger right beside the ad. So whenever a strip is reserved, `LevelMapScene` draws
  an **opaque, tap-swallowing footer** (like its header backdrop) over the
  home-indicator inset, the 58 pt strip and 16 pt more (`FOOTER_GAP`): the nearest
  visible, tappable tile edge sits 24 pt above the ad. The scroll end is padded past
  the footer and a `scrollTo` level is centred between header and footer. With no
  strip (No ads, Unlimited, no ad surface) there is no footer.

Do **not** remove that reservation, or the map's footer.

Known limitations:
- If No ads or Unlimited hints is bought mid-session, the banner is destroyed at once
  but the empty strip stays until the next launch (collapsing it would need a
  re-layout hook).
- A player who **declined** consent keeps the empty strip too, on every launch: the
  reserve is decided at boot, before the consent answer is read, and dropping it later
  would reflow the layout under the player. Reading a stored `DENIED` before
  `setAdBannerReserve` in `main.ts` would fix later launches; not done.

---

## Who gets what

Two entitlements, never confused ([`iap.ts`](../src/services/iap.ts)):
`adsRemoved()` is true for **either** unlock; `hintsUnlimited()` only for the
$4.99 one. Gameplay gates free hints on `hintsUnlimited()`, never on
`adsRemoved()`, or the cheap product would hand out the expensive perk.

| | Nothing bought | No ads ($0.99) | Unlimited hints ($4.99) |
|---|---|---|---|
| ATT + consent prompt, SDK start | yes (the SDK starts only on `GRANTED`) | yes — the hint video is a real rewarded ad | **no SDK at all** |
| Banner + reserved strip | strip on every screen but a level in play; banner there while consent is `GRANTED` | no | no |
| Interstitials | while consent is `GRANTED` | no | no |
| Hint video ("Watch ad: +1 hint") | yes, while consent is `GRANTED` | yes, while consent is `GRANTED` | never needed — hints are free |
| "Privacy choices" link on the menu | yes | yes | hidden (nothing to choose) |
| Store offers | packs, No ads, Unlimited hints | packs only | "You're all set" |

**Grandfathering.** Before the store split, the single "Remove ads" product
(`com.noqyris.exactly67.removeads`, then $0.99) granted no ads **and** unlimited
hints. `exactly67.unlimitedHints` is tri-state on read: absent means a pre-split
install, and `main.ts` derives it from `exactly67.adsRemoved` and writes it back,
so those buyers keep the perk they paid for and a later $0.99 No ads purchase is
never mistaken for a legacy owner.

---

## How it's wired

Strict layering is preserved: `src/game` stays pure (a hint is just the
`solver.minimalSolution` query), and the scenes talk only to the policy layer,
never to a network.

```
main.ts · MenuScene · GameScene · StoreScene
        │   policy calls only (initAds, showBanner, maybeShowInterstitial,
        │   rewardedOffered, watchRewardedHint, openPrivacyOptions, hint inventory …)
        v
services/ads.ts          POLICY: cadence, entitlements, hint economy, banner strip,
        │                consent gate, loop + music hold around full-screen ads.
        │                Knows no network.
        │   AdProvider seam — services/adProvider.ts
        ├──> services/providers/levelplay.ts   Unity LevelPlay (the real network)
        └──> services/providers/mock.ts        fake DOM ads, VITE_ADS=mock builds only
```

Which provider a bundle carries is decided **inline** in `ads.ts`:
`import.meta.env.VITE_ADS === 'mock' ? mockProvider : levelplayProvider`. Vite folds
that to a literal, so a store bundle contains no fake-ad code and a mock bundle no
LevelPlay provider (verified by counting markers in built bundles). Through a
function call it could not tree-shake either.

| File | Role |
|---|---|
| [`src/services/ads.ts`](../src/services/ads.ts) | **The policy layer.** Availability (`adsSupported`), both entitlements, `initAds` (with the one-time consent reset) / `adsForegrounded` / `openPrivacyOptions`, the banner (`bannerReserve`, `showBanner`, `hideBanner`, `removeBanner`), the interstitial gate (`noteCleared`, `interstitialWouldShow`, `maybeShowInterstitial`), the rewarded hint (`rewardedOffered`, `watchRewardedHint` → `RewardedOutcome`, and the boolean `showRewardedHint`), the game-loop hooks (`setGameLoopHooks`), and the hint inventory (`initHintState`, `hintCountValue`, `hasHint`, `useHint`, `grantHint`, `grantHints`). Every surface reads the provider's current consent answer. |
| [`src/services/adProvider.ts`](../src/services/adProvider.ts) | **The seam.** `AdProvider` interface; `adsOff()` / `adsMock()`; `ADS_MARKER`; `BANNER_RESERVE_DESIGN_PX`. |
| [`src/services/providers/levelplay.ts`](../src/services/providers/levelplay.ts) | **Unity LevelPlay**, ported from KVIZKO (same plugin version, in production there since 1.2.1). Consent before init, `adsAllowed` / `onConsentChange` / `resetConsent`, event races, prefetch (interstitial from the cache only), init retry, `APP_KEYS` / `UNITS_BY_PLATFORM`, `CONSENT_COPY`, `AD_MODE_MARKER`. |
| [`src/services/providers/mock.ts`](../src/services/providers/mock.ts) | **Fake ads** for `npm run dev:mock` / `build:mock`: a banner, an interstitial, a 5-second rewarded video and a privacy sheet drawn in the DOM, each lettered "FAKE AD — MOCK BUILD", no network. |
| [`src/services/buildFlags.ts`](../src/services/buildFlags.ts) | The TestFlight-only `VITE_UNLOCK_ALL` flag and its `UNLOCKALL:1` marker. |
| [`src/services/storage.ts`](../src/services/storage.ts) | Keys `exactly67.adClears` (interstitial counter), `exactly67.adsRemoved`, `exactly67.unlimitedHints`, `exactly67.hintFreeDate`, `exactly67.hintCount`, `exactly67.reviewRequested`, `exactly67.levelplayConsentMigrated` (the one-time consent reset has run). The consent decision itself is stored natively by the plugin. |
| [`src/services/music.ts`](../src/services/music.ts) | `suppressMusic(on)`: the counted hold `ads.ts` takes for the length of every full-screen ad. |
| [`src/render/layout.ts`](../src/render/layout.ts) | `setAdBannerReserve()` / `adBannerReserve()`; `safeArea().bottom` includes the strip. |
| [`src/render/GameScene.ts`](../src/render/GameScene.ts) | `showBanner()` on every level start (idempotent, heals a refused first request). 💡 → `doHint()`: Unlimited owners get the ghost demo free; otherwise spend one banked hint (a re-tap on the same board replays free) or, at zero, open the hint modal — see [The rewarded hint](#the-rewarded-hint). `noteCleared()` on every win; `leaveAfterClear()` awaits `maybeShowInterstitial()` before navigating. |
| [`src/render/LevelMapScene.ts`](../src/render/LevelMapScene.ts) | The opaque footer over the banner strip, only when a strip is reserved (see the banner safety note). |
| [`src/render/MenuScene.ts`](../src/render/MenuScene.ts) | "Privacy choices" text link → `openPrivacyOptions()`, only when `adsSupported() && !hintsUnlimited()`. "Store" button when `iapSupported() && !hintsUnlimited()`. |
| [`src/render/StoreScene.ts`](../src/render/StoreScene.ts) | The price ladder: packs, No ads (sublabel names the hint videos that stay), Unlimited hints, Restore purchases. |
| [`src/services/iap.ts`](../src/services/iap.ts) | StoreKit via `cordova-plugin-purchase`: `REMOVE_ADS_ID`, `NO_ADS_ID`, `HINT_PACKS`. |
| [`src/services/review.ts`](../src/services/review.ts) | One-shot rating prompt via `@capacitor-community/in-app-review`. |
| [`src/main.ts`](../src/main.ts) | Primes both entitlements, reserves the strip, registers loop sleep/wake, `splashGone.then(initAds).then(showBanner)`, `adsForegrounded()` on visibility, `initIap()`, `initReview()`. |
| [`ios/App/App/Info.plist`](../ios/App/App/Info.plist) | `NSUserTrackingUsageDescription` (identical to `package.json` → `levelplay.userTrackingDescription`), 76 `SKAdNetworkItems` (Unity's published partner list without Google's id, plus ironSource's `su67r6k2v3`), `LevelPlayCMPProvider = custom`. No AdMob keys. |
| `package.json` | The `levelplay` block, the three `postinstall` patches, and the `capacitor:sync:after` manifest hook. |

### Consent, then init

The order is a **legal requirement**, not style. ironSource: *"You must obtain user
consent before initializing any third-party SDK, including LevelPlay and ironSource
ad network. If consent is not obtained, do not initialize the LevelPlay SDK."*
`initialize()` is not inert — it transmits device and app data to configure the
waterfall. The old Google stack initialised first and asked afterwards; a straight
port carries that shape over unnoticed. `levelplay.test.ts` pins the order.

1. `main.ts` waits for the splash to be gone (the consent modal and the ATT alert
   are native views that would draw over it), then calls `initAds()`.
2. `initAds()` returns at once where there is no ad surface, and for Unlimited
   owners. Otherwise it registers `onReady → showBanner` and `onConsentChange` (a no
   removes the banner), then — **once per install, before the first `init()`** —
   runs the consent reset (below), then calls `provider.init()`.
3. `levelplay init()`:
   - **No app key → throws** before any prompt or SDK call (Android's state: it has
     no LevelPlay app, so its key is empty).
   - Attaches the consent listener, then asks **ATT** (20 s ceiling), then shows the
     **consent modal** (`requestConsentInfo`, 120 s ceiling — it is *read*, so it
     gets a long one).
   - Reads the stored status. **Only `GRANTED` continues**; `DENIED` and `UNKNOWN`
     both mean "not obtained".
   - Sets the regulation flags first — `setCCPAConsent({ doNotSell: false })` and
     `setChildDirected({ isChildDirected: false })` (a general-audience app) — then
     `initialize({ appKey, isTesting })`.
   - On success it prefetches one interstitial and one rewarded ad, and fires the
     `onReady` listeners (the banner).
4. **Late decisions still count.** The `ConsentStatusChanged` listener starts the SDK
   whenever consent becomes `GRANTED`: a player who read the modal past its ceiling,
   or one who declined at boot and later said yes under Privacy choices. Every
   decision — at boot, from the modal, from Privacy choices — is recorded and passed
   to the policy layer (`onConsentChange`), and `adsAllowed()` reads it at any time.
   A later **withdrawal** cannot stop a running SDK, so the network is told
   `doNotSell: true` and the **policy layer keeps the promise the modal makes**: the
   banner comes down at once (also one still being created, once it lands), and every
   later banner request, interstitial and hint-video offer reads `consentAllows()` and
   stays away for as long as the answer is no. A later yes in the same session brings
   them back, because the SDK is still running. From the next launch the stored
   `DENIED` keeps the SDK off.
5. **A failed init is not final.** Retries at 30 s, 60 s and 120 s, then one more on
   every return to the foreground (`adsForegrounded()` → `retryInit`), always only
   while consent is `GRANTED`.

**A decline means no ads of any kind**, hint videos included. The hint modal does not
offer a video it can never play: `rewardedOffered()` is false, so there is **no watch
button**, only a centred *Done*, and the body says why and where the decision lives —
*"Hint videos are off because ads were declined. Turn them on under Privacy choices on
the menu, or grab a pack."* A yes given later from Privacy choices brings the button
back the next time the modal draws. (Android has no LevelPlay app key, so there
`adsAllowed()` is false as well and this copy would be wrong; revisit it before any
Android release with ads.)

**The one-time consent reset.** 1.2.0 asked for ad consent through Google's form,
which, wherever a GDPR message was live, writes IAB TCF keys (`IABTCF_*`) into the same
`UserDefaults` the LevelPlay plugin reads. Its `custom` provider treats any such key as
a decision it already has and skips "Ads and your data", so an upgrader could come back
`GRANTED` (Unity's SDK started on consent given to a different network) or `DENIED`
(never asked). Whether any Exactly 67 install carries them can no longer be checked —
the AdMob console is gone — and the reset is free, so `initAds()` runs
`provider.resetConsent()` once per install before the first `init()`:

- LevelPlay calls the plugin's `resetConsent()` (removes `levelplay_consent_status` and
  every IAB TCF key), bounded by the 20 s ceiling, and never rejects. It does nothing
  while the SDK is starting or up, so it can never wipe the decision a running SDK was
  started on. The `UNKNOWN` status event the reset emits is harmless: nothing has
  subscribed yet, and a non-`GRANTED` status can only record a no.
- Then `exactly67.levelplayConsentMigrated` is saved as `'on'`. Reset first, flag
  after: a kill between the two only means the modal is asked once more. A missing or
  unreadable flag counts as "not yet".
- Consequence: the first launch of 1.2.1 shows ATT (if still undecided) and the consent
  modal **once more to every existing install on an ads-on build**, No ads owners and
  TestFlight testers who already answered included. Unlimited owners and ads-off builds
  never run it. Pinned by `adsEntitlements.test.ts` and `levelplay.test.ts`.

**The consent modal's words** (`CONSENT_COPY`) — title *Ads and your data*,
buttons *Accept* / *Decline*, and:

> Exactly 67 shows ads through Unity LevelPlay. With your consent, our ad partners
> use your device's advertising identifier and information about the ads you see to
> personalise those ads. If you decline, the ad system does not start: every level
> still plays, but there are no ads and no hint videos. You can change this any time
> under Privacy choices on the main menu.

It links to `https://noqyris.github.io/exactly-67/privacy.html`. Passing no copy is
not "sensible defaults": the plugin then shows a generic text and silently drops
the privacy-policy button.

**The plugin's consent bug is patched.** Upstream `capacitor-levelplay-ads` records
a decline correctly and then reads it back as `GRANTED` from the second launch
(its `isGranted()` short-circuits on `gdprApplies == 0` before reading the recorded
decision), which would defeat "only GRANTED starts the SDK" from underneath.
`scripts/patch-levelplay-consent.mjs` reorders the checks on iOS and Android at
every `npm install`, and exits 1 if the code no longer has the known shape.

### Interstitial cadence — the hybrid gate

Tuned from a dedicated psychology + revenue + competitive-teardown study (three
independent research passes converging on *keep interstitials but run them light;
recover revenue through the opt-in rewarded hint and the unlocks, not interstitial
frequency*). Being **no-fail**, the game structurally lacks the fail/retry slot
that carries most casual ad revenue, and its lifetime value is dominated by rating
and retention. **These values did not change in the move to LevelPlay** — only the
network plumbing did, and `adsPolicy.test.ts` pins every one of them.

`interstitialWouldShow(clearedGlobal)` is the single source of truth (a
non-consuming predicate); `maybeShowInterstitial` acts on it, and the win overlay
reads it to keep the rating ask off the same win. It returns true only when
**every** condition holds, and never for an owner of either unlock or where there
is no ad surface:

| Constant | Value | Guard |
|---|---|---|
| `ONBOARDING_LEVELS` | `8` | Cleared global must be `> 8` — the balloon mechanic debuts at L6, so the player hasn't met the hook before ~L8. |
| `PACK_FINALES` | 24, 48, …, 600 | Never on the last level of any pack; the L600 "The End!" never gets an ad chaser. **Derived from `PACKS`**, not written down (the old `24/48/72` stopped covering anything once packs 4–25 arrived). |
| `CLEARS_PER_INTERSTITIAL` | `3` | ≥ 3 clears since the last *presented* ad (a learnable "every 3rd win" rhythm). |
| `MIN_SECONDS_BETWEEN_ADS` | `180` | Hard spacing floor — never two ads closer than 3 min. |
| `FIRST_AD_MIN_SESSION_SECONDS` | `90` | Per-session warm-up — no ad in the first 90 s of a session. |
| `MAX_ADS_PER_SESSION` | `3` | Session cap (the 4th impression is lowest-value, highest-annoyance). |
| `DAILY_INTERSTITIAL_CAP` (`game/economy.ts`) | `6` | Per local day, all sessions together (`meta.interstitialDay`). Sessions reset on a 30-min return, so the session cap alone would let a player who comes back five times a day see fifteen; the harm of ad load lands on exactly that habit (see *Why this cadence* below). |
| `SESSION_GAP_MS` (`game/sessions.ts`) | 30 min | What a **session** is: a cold launch, **or** a return from the background after ≥ 30 min, **or** a return into a new local day. |
| `REWARDED_SUPPRESS_SECONDS` | `300` | No interstitial for 5 min after an earned rewarded hint — don't double-tax volunteered attention. |

**The flow.** `maybeShowInterstitial` asks the provider for a loaded ad, and on
LevelPlay that answer comes **from the prefetch cache only**: nobody asked for this ad,
and every win-card button is already locked while it is decided, so a tap-time load
would hold the player on a dead card for up to 15 s. A miss (never filled, or the cached
ad expired) is "no ad this time" at once, keeps the cadence armed, and starts a fetch
for the next break — unless a backoff retry is already waiting, which is the same
fetch. A load already in flight is not joined either; it carries on for next time. The
15 s ceiling now only guards a provider that never answers. Then, under a full-screen
ad: the Phaser loop sleeps, the music stops and is **held down** (`suppressMusic`, so
no visibility or focus event can restart it under the ad), the banner hides, and the
dismissal watcher is attached **before** `show()` (a fast close would otherwise fire
while nothing listens). `show()` resolves when the ad is
*displayed*; only then is the cadence spent (counter reset, `lastInterstitialAt`,
`adsThisSession++`). The call resolves when the player **dismisses** the ad (180 s
ceiling as a deadlock breaker), after which the loop wakes, the audio context is
nudged, the music hold is released and the music restarts, and the banner returns. `GameScene` navigates only after
that, so the next level never starts under a live ad. A no-fill or failed present
leaves the cadence armed for the next clear.

**Review mutual exclusion:** the win overlay only calls `maybeRequestReview` when
`interstitialWouldShow` is false, so a rating ask and an ad never stack on one win.

Net effect: zero interstitials until genuinely hooked (L9+, past the 90 s warm-up),
then at most one every 3rd win, ≥ 3 min apart, ≤ 3 per session, never right after a
rewarded hint, never on a pack final, never on the review beat. `exactly67.adClears`
persists across launches; `lastInterstitialAt` / `lastRewardedAt` live in memory from
the cold launch on, and only the cap and the warm-up (`adsThisSession`, the session
start) are per session. The values are constants in code — there is no remote config.

**What a session is (1.3.0).** Until 1.3.0 a session was a cold launch, and iOS keeps a
suspended game alive for days: a daily player who never swiped Exactly 67 away stayed in
session 1 — three interstitials, then none for as long as the app lived in memory, and
the warm-up never applied again. Now `main.ts` records the **first** `hidden` of a pause
(time + local day) and, on `visible`, asks the pure `returnIsNewSession()`
(`game/sessions.ts`): a different day key is always a new session, 30 min or more away
is one, a clock set back within the day is not, and a `visible` with no `hidden` before it
is not a return. On a new session it calls `ads.startAdSession()` (cap to 0, warm-up
re-armed, so the first clear after coming back is never an ad) and bumps
`meta.offers.sessions`. The 180 s floor, the every-3rd-clear counter, the rewarded quiet
window and the daily rewarded caps are **not** per session and carry over. Nothing on
that path starts the ad layer: `visibilitychange` fires on `willEnterForeground`, while the
app is still inactive, and an ATT request there shows nothing and reads `notDetermined`
(the LevelPlay provider's foreground `retryInit()` only restarts an SDK whose consent is
already GRANTED, so it never reaches ATT).

**Why this cadence (research, 2026-09-26).** Three parallel reviews — competitor
teardowns, the ad-load/retention literature, and a revenue model on this game's
numbers — agreed on keeping the rhythm and changed two things (the daily cap, and no
banner on a level in play):
- Ours is on the gentle side of the market. Most top level-based games show an
  interstitial after every level, while "every 3rd level" was the rarest cadence in a
  top-100 teardown ([PocketGamer.biz, 2025](https://www.pocketgamer.biz/the-key-to-success-how-top-100-downloaded-games-implement-interstitial-ads-and-related-in-app-purchases/)).
- The strongest evidence says that is right for a habit game. Pandora's 21-month
  randomised test on 35M users ([arXiv 2412.05516](https://arxiv.org/abs/2412.05516))
  found each extra ad per hour cost ~2 % of active days, linearly, with no safe knee.
  The long-run effect was ~3× the one-month one, and 82 % of it was people coming back
  less often.
- More ads raise ad-free purchases only weakly: about 2.4 users lost per convert
  ([Marketing Science 2025](https://pubsonline.informs.org/doi/10.1287/mksc.2022.0357)).
- The model put "every 2nd clear, 120 s" at +8–15 % ad revenue: about $1 a day per
  1,000 DAU in tier-2, erased by a 2-point D7 drop.
- Re-tune from real LevelPlay reports (impressions per DAU, fill, D1/D7/D30), judged on
  D30 active days, never on a short test.

### The rewarded hint

**The offer.** The hint modal opens at zero hints. Its watch button exists only while
`rewardedOffered()` is true — always where there is no ad surface (the hint then takes
its free-grant path), otherwise only while consent is `GRANTED` (see the decline above).
The label is **"Watch ad: +1 hint"**, measured at run time in the button's own font; on
a 320 pt phone it falls back to **"Ad: +1 hint"**. The body box is sized once for the
longest thing it can say, so the card never resizes under a thumb.

**The watch.** `watchRewardedHint()` resolves to one of three outcomes:

| Outcome | When | What the modal says (in a note under the card) |
|---|---|---|
| `earned` | The reward event arrived. | "Hint earned!" |
| `unavailable` | No video was ever shown: no fill, a load that failed or timed out, no consent, or another full-screen ad still up. | "No video available right now — try again soon" |
| `not-earned` | A video was handed to the SDK and did not pay out: closed early, failed to present, or never *displayed* within 10 s. | "No hint this time — the ad didn't play to the end" |

`showRewardedHint()` is the same call folded to a boolean (true only on `earned`).
`show()` settles only when the reward event arrives, and it races the dismissal
watcher; because some LevelPlay adapters emit *closed* before *rewarded*, a close
waits 800 ms for a reward already on its way before reading the race as "skipped".
The plugin's native `showRewarded()` resolves as soon as it hands the ad over, so the
provider also waits for `RewardedDisplayed`: without it within 10 s the show resolves
as not shown, instead of leaving the game asleep for the 180 s ceiling with no ad on
screen. Once displayed, the wait belongs to the player however long the video runs.
Where there is no ad surface (browser dev, an `ADS:off` build) it resolves `earned`
without an ad, so the hint flow stays testable; no store player can reach that path.

**While it runs**, the modal is held shut (`hintBusy`): the watch button reads
"Loading…" at 60% opacity with input off, and *Done* and the Store link dim and do
nothing. A modal closed during the load used to let the video present late — over the
level map, or over a board already won, where the reward was thrown away. The hint is
granted **first** on `earned`, before any question about where the player now is (the
stash is global); messages fall back to the scene's toast once the modal is gone.
Unlike the interstitial, the rewarded video **may load at tap time** when the cache is
empty (the player asked, and the button shows "Loading…"), and a tap-time load that
misses re-arms the prefetch backoff so the slot refills without another tap.

---

## Build modes, markers and gates

Summary; the full table and every gate are in [`RELEASE.md`](RELEASE.md).

| Env at build time | Marker in the bundle | Meaning |
|---|---|---|
| `VITE_AD_MODE=live` / anything else | `ADMODE:live` / `ADMODE:test` | Declared App Store build or not. **Fails safe**: only the literal `live` declares live. |
| `VITE_ADS=off` / `mock` / anything else | `ADS:off` / `ADS:mock` / `ADS:on` | No ad surface / fake ads / the real network. |
| `VITE_UNLOCK_ALL=1` | `UNLOCKALL:1` (absent otherwise) | TestFlight "all levels unlocked". A live build must not carry it. |

**On LevelPlay, `ADMODE:test` is not test inventory.** The same unit ids ship in
every build; `isTesting` only unlocks Unity's Test Suite (the plugin maps it to
`setMetaDataWithKey("is_test_suite", "enable")`). **Every `ADS:on` build serves the
real waterfall**, TestFlight included, and mediated ads carry no test label. A
dashboard Test Device pin gives *"ads exclusively from that specific ad network"*,
*"will reset within the hour"*, and *"non-bidding ad networks can only test live
ads"* — exclusivity of source, not a safe device. That is why `provider.testing` is
hard-wired `false` and the old TEST ADS badge is gone.

> ### ⛔ Never tap an ad — on any build, on any phone
> There is no build of this app on which tapping an ad is safe. Unity terminates for
> invalid traffic exactly as Google did, and its first remedy is to claw the money
> back. To test **our** ad flow, use the mock build (`npm run dev:mock`, or
> `npm run ios:sync:mock` on a device): every surface is ours, touches no network and
> is safe to tap as hard as you like. Only LevelPlay's own reports can say whether
> the real waterfall fills — a green mock run proves nothing about that.

---

## Going live — what is left

### Done — the iOS LevelPlay app (2026-09-16)

The owner's dashboards (`platform.ironsrc.com`, the same Unity login as
`cloud.unity.com`); nobody else enters credentials.

| What | Value |
|---|---|
| LevelPlay app | iOS, **"Exactly 67: Number Puzzle"** (App Store `id6787536995`), category **Puzzle: Board**, COPPA **not child-directed** (matches `CHILD_DIRECTED = false`) |
| App key | `282af3d55` |
| Ad units | banner `bkov9ky03m5q7nb5` · interstitial `037b2c2vtwjlz5bg` · rewarded `v9y4469brsj85byl` (the rewarded unit's reward name and amount are reporting metadata only; the app grants the hint itself) |
| Network | **Unity Ads** as a **bidder** on all three units — Unity Ads Game ID `800374923` (numeric, from `cloud.unity.com`; *not* the LevelPlay App Key), placements `BP_Banner_iOS`, `BP_Interstitial_iOS`, `BP_Rewarded_iOS`. **No Google network**, ever. |
| In code | `APP_KEYS.ios` / `UNITS_BY_PLATFORM.ios` in [`providers/levelplay.ts`](../src/services/providers/levelplay.ts), as **plain string literals** (the config gate parses the source file, not the bundle). `npm run ads:config -- ios` exits 0. |
| Android | **No LevelPlay app.** Android is a separate app with its own key and unit ids, created only if Android ships; its entries stay empty. Never reuse the iOS ids or paste KVIZKO's — the gate refuses both. |

The native side matches KVIZKO's shipped build: the SPM graph is held at LevelPlay
**9.6.0**, UnityAds adapter **5.11.0** and Unity Ads **4.20.0** in `Package.resolved`
(bumping is a deliberate change that starts in `scripts/lib/levelplay-versions.mjs`),
and the App target links with **`OTHER_LDFLAGS = -ObjC`** — without it the linker
strips the Unity Ads SDK/adapter classes and categories LevelPlay loads by name, and
the SDK crashed at `initialize()` (KVIZKO BUG-9).

### Left to do

The release-blocking items are the [pre-release checklist in
`RELEASE.md`](RELEASE.md#0-before-you-start--the-pre-release-checklist): publish
`docs/privacy.html` and `docs/index.html` to `main`, the Unity Ad Controls age setting
for a 4+ app, renaming the `removeads` IAP in App Store Connect, and re-captured
screenshots. Beyond those:

1. **Dashboard follow-ups:** expect "pending approval" and emails about the published
   app; nothing fills until they are answered. Optional **Test Devices** pin — read
   what it does (above) first: it does not make tapping safe.
2. To check: whether LevelPlay requires an `app-ads.txt` on the developer website
   listed in the store (the marketing URL is `https://noqyris.github.io/exactly-67/`).
   No `app-ads.txt` is kept in this repo; if one is added, declare it in
   `package.json` → `adSafety.appAdsTxt` so `check-no-google.mjs` validates it.
3. **Integration check on a device, eyes only:** `npm run ios:sync:test` builds the
   real waterfall (`ADMODE:test` + `ADS:on`), and Xcode builds it only as a Run with
   `AD_TARGET=test` stated. Confirm the consent modal text and privacy link, the ATT
   alert, that `initialize()` does not crash, the banner filling the strip, an
   interstitial after the cadence, a hint video, and that a withdrawal from Privacy
   choices takes the banner down. **These are real ads: look, never tap**, and never
   upload this build. Afterwards `npm run ios:sync` to leave the tree ads-off.
4. **App Store Connect → App Privacy** needs no change: the label declares
   Identifiers, Location and Usage Data used for tracking, plus Diagnostics. It was
   written in the AdMob era and is network-agnostic — the data *types* the ad SDK
   collects did not change with the move to LevelPlay — and it agrees with
   [`privacy.html`](privacy.html). Re-check it only if a network is added.
5. **Publish** the updated `docs/privacy.html` and `docs/index.html` (GitHub Pages
   serves `main` `/docs`) before the live upload, so the URL in the consent modal and
   the store listing says what the app does. The Fastfile's privacy gate refuses every
   live upload and `submit` until the published page names LevelPlay and no longer
   mentions AdMob. The page should also be brought up to date with the code on two
   points: a withdrawal now stops ads and hint videos for the rest of the session (the
   page still says ads "may continue until the app is next started"), and the device
   stores a flag that the one-time consent reset ran.
6. **Release** with the two-build procedure in [`RELEASE.md`](RELEASE.md): live build
   N, then the ads-off build N+1 immediately, then submit N; expire every real-ads
   TestFlight build once N is `READY_FOR_SALE`.

---

## The Store (hint packs + the two unlocks)

> **Read this before touching prices.** The products form a deliberate ladder:
> `10 hints = $0.99 < 30 = $1.99 < 100 = $2.99 < Unlimited hints + no ads = $4.99`,
> with **No ads ($0.99)** beside it buying a different thing (quiet, not hints). The
> $4.99 unlock grants unlimited hints, so it must always cost **more than the largest
> pack**. When it was $0.99 it strictly dominated every pack (cheaper *and*
> unlimited), which turned the packs into dominated decoys — anyone who bought one
> paid more for less. That is both self-cannibalising and the exact harm the EU CPC
> Network names (Mar 2025): *"causing consumers to overspend compared to what they
> otherwise would have."* Keep `unlock > largest pack`, or delete the packs.
>
> [`StoreScene.ts`](../src/render/StoreScene.ts) also deliberately omits countdown
> timers, fake scarcity, "Most Popular" badges (no sales data, so untrue) and
> crossed-out prices we never charged. Its one badge, "Best pack value", is true by
> construction and scoped to the packs. Don't add the others.

Implemented against **StoreKit via `cordova-plugin-purchase`** (the `CdvPurchase`
global, injected natively, never imported into the web bundle) — no third-party
backend or receipt server. [`iap.ts`](../src/services/iap.ts):

| Product id | Type | Grants |
|---|---|---|
| `com.noqyris.exactly67.hints10` / `hints30` / `hints100` | Consumable | `grantHints(10 \| 30 \| 100)` |
| `com.noqyris.exactly67.noads` (`NO_ADS_ID`) | Non-consumable | `setAdsRemoved(true)` only |
| `com.noqyris.exactly67.removeads` (`REMOVE_ADS_ID`) | Non-consumable | `setAdsRemoved(true)` **and** `setUnlimitedHints(true)` |

- Entitlement is granted **only** on an `approved` transaction in a purchased state
  that actually contains the product (a genuine purchase or a restore). A cancelled
  payment fires `error`, never `approved`. The service deliberately does not grant
  off `store.owned()` / `receiptUpdated`, which can read true for a cancelled sandbox
  transaction when no validator is configured.
- Grants never revoke: a restore that re-delivers only the cheap product must not
  strip unlimited hints from someone who also owns the bundle.
- Either unlock destroys the banner at once (`removeBanner()`), including a banner
  whose request failed to load: the plugin attaches the view before it loads, so a
  requested banner is torn down whether or not it ever filled.
- A **No ads** owner is never offered ad removal again (neither product) and keeps
  buying hints by the pack. An **Unlimited** owner sees "You're all set" instead of
  offers, and the menu hides the Store button.
- The purchase flags persist locally, so relaunch needs no store round trip; a fresh
  install restores through **Restore purchases** (an App Store requirement).
- `iap.ts` picks `APPLE_APPSTORE` or `GOOGLE_PLAY` at runtime, so the same code
  transacts on Android once Play has the products.

**Store products (last recorded state):**
1. **App Store Connect:** `removeads` repriced to **$4.99**; `noads` created at $0.99
   (READY_TO_SUBMIT when created); the three packs at $0.99 / $1.99 / $2.99. A
   first-time IAP must be submitted **together with** an app version, and needs its
   own App Review screenshot — see [`RELEASE.md`](RELEASE.md). **`removeads`'s display
   name was last recorded as "Remove Ads"**, which is what StoreKit's purchase sheet
   shows for the $4.99 *Unlimited hints* card, beside the $0.99 "No Ads": rename it
   (e.g. *Unlimited Hints + No Ads*) with a matching description before 1.2.1 goes to
   review, and give `noads` a description that says the hint videos stay.
2. **Google Play Console:** the same ids and prices still need creating, which was
   blocked on a Google **Payments profile** (legal name, bank, tax) — the developer's
   own financial data.
3. Test with an Apple **sandbox tester** / Play **licence tester** on a real device.

> Pricing note: under Apple's **Small Business Program** (revenue < $1M), commission
> is 15%, so ~$4.24 nets through on the $4.99 unlock and ~$0.84 on a $0.99 product.

---

## Further reading
- [`RELEASE.md`](RELEASE.md) — the four ad targets, every gate, the Xcode guard,
  fastlane, the two-build release.
- [`ARCHITECTURE.md`](ARCHITECTURE.md) — layers and the services pattern the ad layer
  follows. · [`reference/SERVICES.md`](reference/SERVICES.md) — every export.
- [`TESTING.md`](TESTING.md) — the ad suites and how to drive the mock build.
- [`privacy.html`](privacy.html) — the published privacy policy.
- The user-level `mobile-game-playbook` skill, `references/levelplay.md` — the
  LevelPlay migration in depth (plugin defects, consent, dashboard, test devices).
