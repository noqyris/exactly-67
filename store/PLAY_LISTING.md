# Google Play listing — Exactly 67

Copy-paste into **Play Console → Store presence → Main store listing** and **App content**.

> **⚠️ Android is not being released, and this file predates the current game.** Written for the
> AdMob-era 1.2.0 Android build. Ads now come from **Unity LevelPlay** (Unity Ads demand), but there
> is no LevelPlay Android app and no gated Android build chain yet (see
> [`docs/RELEASE.md`](../docs/RELEASE.md#android-release)). The ad-network facts, the privacy URL,
> Data safety and pricing below are brought up to date; the **description and release notes are
> not** (they still say 72 handcrafted levels); only their purchase lines were corrected, since the
> $0.99 "No ads" keeps the optional hint videos and "remove them forever" was not true of it. Before
> any Play upload, re-derive them from `ios/App/fastlane/metadata/en-US/description.txt` and check Data
> safety against Unity's current Google Play guidance.

---

## App name (max 30 chars)
```
Exactly 67: Number Puzzle
```

## Short description (max 80 chars)
```
Number puzzle: balance the scale to land on exactly 67 with weights & balloons.
```
*(79 chars. Play ranks on the short description's keywords, so it leads with "Number puzzle" and
still carries "balance", "scale", "weights", "balloons" — while keeping the "exactly 67" hook.)*

## Full description (max 4000 chars)
```
Can you land on EXACTLY 67?

Exactly 67 is a chunky, satisfying number puzzle built around one deceptively simple goal: fill the right pan of a balance scale so it totals exactly 67. Hit it and the beam settles perfectly level with a happy little "six-seven" chime.

The twist is the balloons. Weights pull the pan DOWN. Balloons pull it UP. So you can overshoot 67 with a heavy weight, then pull it back down — up, really — with a balloon. That plus-and-minus tug-of-war is the whole game, and it makes every level a tiny, tactile brain teaser.

HOW IT PLAYS
- Drag weights and balloons from the tray onto the pan (or just tap to place).
- Watch the beam tip toward whichever side is heavier — the closer to 67, the closer to level.
- Land on exactly 67 to clear the level.
- No timers. No fail states. Rearrange as much as you like. It's a calm, think-at-your-own-pace puzzle, not a reflex test.

72 HANDCRAFTED LEVELS
Three packs, each with its own flavour and a gentle difficulty ramp:
- Warm-Up — learn the ropes and meet the balloons.
- Prime Time — prime-heavy sets where hitting 67 gets sneaky.
- Heavy Lifting — big numbers and deep overshoots that only balloons can rescue.
Along the way you'll meet locked weights, tight piece budgets, and "use every weight" puzzles that keep the ideas fresh right to the end.

EARN THREE STARS
Every level has a known minimum number of pieces. Solve it in the fewest weights for a perfect three-star rating. Chasing efficiency turns even a solved level into a fresh challenge.

MADE TO FEEL GOOD
- Bold, candy-colored, hand-drawn look with a chunky physics-toy feel.
- Gentle haptics and an original, generated soundtrack — no licensed audio.
- Optimized for phones and tablets.
- Respects Reduced Motion.

FREE TO PLAY
- Free to download and play all 600 levels.
- A banner and an occasional full-screen ad help keep the game free.
- Stuck? Watch a short optional video to earn an extra hint — you also get one free hint every day.
- Prefer fewer ads? "No ads" removes the banner and the ads between levels (the optional hint videos stay); "Unlimited hints" removes all ads and gives unlimited hints.
- Play offline anytime — the puzzles never need a connection; ads simply pause when you're off the grid.
- Your level progress is saved on your device.

If you love number puzzles, math games, logic brain teasers, or just a calm way to keep your mind busy, Exactly 67 is a pocketful of quiet "aha" moments. Grab a balloon and balance the scale.
```

## Release notes (en-GB)
```
First Android release. Balance the scale to land on exactly 67 across 600 levels that keep getting harder — weights, balloons, locked pieces and three-star ratings. Free to play with ads, hint packs, and two one-time purchases: "No ads" and "Unlimited hints".
```

---

## App content answers

- **Privacy policy URL:** https://noqyris.github.io/exactly-67/privacy.html (published from `docs/privacy.html`)
- **Ads:** Yes, this app contains ads.
- **App access:** All functionality is available without special access (no login).
- **Content rating:** questionnaire → no violence/sexual/etc. → expect Everyone / PEGI 3.
- **Target audience:** 13+ (avoid the "designed for children / Families" programme, since the app shows ads and collects an advertising identifier).
- **Data safety:** see below.
- **Government/financial/health/news:** No to all.

### Data safety (because of the ad SDK)
- **Data collected/shared:** Yes, by the ad SDK (Unity LevelPlay with Unity Ads), and only after the
  player accepts the consent prompt — a decline means the SDK never starts. What it may collect is
  what [`docs/privacy.html`](../docs/privacy.html) lists: the advertising ID, IP address, device
  and system information, and ad interaction data. Map that to Play's categories the way the iOS
  label does (Identifiers, Location, Usage Data, Diagnostics — see
  [`STORE_LISTING.md`](STORE_LISTING.md#app-privacy)):
  - **Device or other IDs** — collected & shared — Advertising or marketing; Analytics; Fraud prevention. Not linked to an account.
  - **Approximate location** (from the IP address), **App interactions** and **Diagnostics** — for the same purposes.
- **Data encrypted in transit:** Yes.
- **Users can request deletion:** No account, so nothing to delete server-side; progress lives on-device. Ad data requests go to Unity, as the privacy policy says.

## Categories
- **Category:** Games → Puzzle
- **Tags:** brain games, logic, numbers

## Pricing
- **Free**, with ads and five in-app products: three hint packs, **No ads** and **Unlimited hints + no ads** (ids and prices in [`STORE_LISTING.md`](STORE_LISTING.md#in-app-purchases-app-store-connect-ui)). Play Console still needs them created, which is blocked on a Google Payments profile (see [`docs/MONETIZATION.md`](../docs/MONETIZATION.md)).
