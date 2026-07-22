# App Store listing — Exactly 67

Copy-paste these into **App Store Connect → your app → (version) → App Information / Product Page**.
Everything here is tuned for App Store Optimization (ASO) so the app is easy to find.

> **Source of truth for the live iOS listing is `ios/App/fastlane/metadata/en-US/*.txt`** — that's
> what `fastlane deliver` pushes. This file is the human-readable mirror; keep the two in sync.
> As of 1.1.0 the app is **monetized** (AdMob banner + interstitial + rewarded, and a one-time
> "Remove Ads" in-app purchase), so the copy and the App Privacy answers below reflect that
> honestly — the earlier "no ads / no data" wording was removed.

---

## App name (max 30 chars)
```
Exactly 67: Number Puzzle
```
*(25 chars. The name is the single strongest search-ranking factor, so it carries the top
keyword "Number Puzzle" while keeping the brand first. The home-screen name stays the short
"Exactly 67" — that's `CFBundleDisplayName`, separate from this store name.)*

## Subtitle (max 30 chars)
```
Balance scale brain teaser
```
*(26 chars. Adds "balance", "scale", "brain teaser" — none repeated from the name, so no wasted
keyword space.)*

## Keywords (max 100 chars, comma-separated, NO spaces after commas)
```
math,logic,iq,games,weights,offline,zen,mental,riddle,sums,addition,mind,tricky,solve,relax
```
*(91 chars. Deliberately excludes words already in the name/subtitle — Apple indexes those
automatically, and repeating them wastes the 100-char budget. Singular forms are used because the
App Store matches plurals automatically. `games` is the high-value multiplier: it combines with the
name/subtitle to form "number games", "math games", "logic games", "offline games", etc. — so it
was worth dropping the redundant "brainteaser" (the subtitle already carries "brain teaser").)*

## Promotional text (max 170 chars — editable anytime without review)
```
Land on exactly 67! Drop weights, lift balloons, balance the scale across 72 handcrafted levels. Stuck? Grab a hint. Calm, clever number puzzling — play anywhere.
```

## Description (max 4000 chars)
```
Can you land on EXACTLY 67?

Exactly 67 is a chunky, satisfying number puzzle built around one deceptively simple goal: fill the
right pan of a balance scale so it totals exactly 67. Hit it and the beam settles perfectly level
with a happy little "six-seven" chime.

The twist is the balloons. Weights pull the pan DOWN. Balloons pull it UP. So you can overshoot 67
with a heavy weight, then pull it back down — up, really — with a balloon. That plus-and-minus
tug-of-war is the whole game, and it makes every level a tiny, tactile brain teaser.

HOW IT PLAYS
- Drag weights and balloons from the tray onto the pan (or just tap to place).
- Watch the beam tip toward whichever side is heavier — the closer to 67, the closer to level.
- Land on exactly 67 to clear the level.
- No timers. No fail states. Rearrange as much as you like. It's a calm, think-at-your-own-pace
  puzzle, not a reflex test.

72 HANDCRAFTED LEVELS
Three packs, each with its own flavour and a gentle difficulty ramp:
- Warm-Up — learn the ropes and meet the balloons.
- Prime Time — prime-heavy sets where hitting 67 gets sneaky.
- Heavy Lifting — big numbers and deep overshoots that only balloons can rescue.
Along the way you'll meet locked weights, tight piece budgets, and "use every weight" puzzles that
keep the ideas fresh right to the end.

EARN THREE STARS
Every level has a known minimum number of pieces. Solve it in the fewest weights for a perfect
three-star rating. Chasing efficiency turns even a solved level into a fresh challenge.

MADE TO FEEL GOOD
- Bold, candy-colored, hand-drawn look with a chunky physics-toy feel.
- Gentle haptics and an original, generated soundtrack — no licensed audio.
- Optimized for both iPhone and iPad.
- Respects Reduced Motion.

FREE TO PLAY
- Free to download, with all 72 levels unlocked from the start.
- A banner and the occasional full-screen ad help keep the game free.
- Stuck? Watch a short optional video to bank an extra hint — and collect one free hint every day.
- Prefer a clean board? Remove ads forever with one small in-app purchase, and your hints become unlimited.
- No timers, no energy meters, no fail states — play at your own pace.

PLAY ANYWHERE
- The puzzles are fully offline; ads simply pause when you're off the grid.
- No account and no sign-in. Your level progress is saved right on your device.

If you love number puzzles, math games, logic brain teasers, or just a calm way to keep your mind
busy, Exactly 67 is a pocketful of quiet "aha" moments. Grab a balloon and balance the scale.
```

## What's New (release notes for v1.0.0)
```
The first release of Exactly 67!
- 72 handcrafted levels across three packs
- Weights, balloons, locked pieces, piece budgets and use-every-weight puzzles
- Three-star efficiency ratings, fully offline, no ads
Thanks for playing — land on exactly 67!
```

---

## Categories
- **Primary:** Games → Puzzle
- **Secondary:** Games → Board  *(or Education, if you'd rather target learners)*

## Age rating
**4+** — no objectionable content of any kind.

## Price
**Free**, with a single in-app purchase: **"Remove Ads"** (Non-Consumable, $0.99, product id
`com.noqyris.exactly67.removeads`). It also grants unlimited hints.

## App Privacy (Data collection) — MUST match the AdMob reality
The app serves Google AdMob ads, so the old "we do not collect data" answer is **no longer correct**
and would be misleading. In App Store Connect → App Privacy, declare what the Google Mobile Ads SDK
collects. A standard, honest configuration:

- **Data Used to Track You** (drives the ATT prompt — we ship `NSUserTrackingUsageDescription`):
  - **Identifiers → Device ID** (IDFA) — *Used for Tracking* + *Third-Party Advertising*.
  - **Usage Data → Product Interaction** — *Used for Tracking* + *Third-Party Advertising*.
- **Data Linked / Not Linked to You:** AdMob's identifiers are **Not Linked** to an identity (we have
  no accounts). Mark Device ID and Product Interaction as collected for *Third-Party Advertising* and
  *Analytics*, **Not Linked to the user**.
- **Diagnostics → Crash/Performance Data** — only if you enable it; by default we don't.
- Our own on-device progress (UserDefaults) is **not** "collected" in the privacy-label sense — it
  never leaves the device — but it stays declared as a required-reason API in `PrivacyInfo.xcprivacy`.

> Confirm the exact toggles against Google's current "AdMob & App Privacy" guidance before submitting
> — the SDK's declared collection can change with SDK versions.

## URLs you must provide
- **Privacy Policy URL** — REQUIRED by Apple. A ready-to-host policy is in
  `store/PRIVACY_POLICY.md`; publish it somewhere public (GitHub Pages, a Notion page, your site)
  and paste the link here.
- **Support URL** — REQUIRED. Can be a simple page or even a mailto-style contact page.
- **Marketing URL** — optional.
```
