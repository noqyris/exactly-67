# Exactly 67

A balance-scale number puzzle for iOS (and Android-ready). The left pan holds a
fixed **67**. Fill the right pan with down-weights (positive) and lift-weight
balloons (negative) until the total is **exactly 67** and the beam locks level.

- 600 levels in 25 packs, each harder than the last — 72 hand-tuned (Warm-Up · Prime Time · Heavy Lifting), then 528 generated and solver-verified (`npm run levels:generate`)
- Balloons unlock at level 6 — overshoot, then pull back
- Locked weights and piece budgets
- 1–3 stars for efficiency: the solver-proven minimum earns 3
- Plays fully offline; all art drawn in code, all audio synthesized
- A Daily Challenge: one solver-verified board per UTC day, the same for everyone
- Free with ads (Unity LevelPlay, Unity Ads demand), hint-pack IAPs and two one-time unlocks — No ads, and Unlimited hints + no ads (see `docs/MONETIZATION.md`)

## Stack

Phaser 3 + TypeScript + Vite, wrapped with Capacitor 8. Portrait only.

- `src/game/` — pure logic (balance math, rules, brute-force solver, levels, progress). No Phaser imports; fully unit-tested.
- `src/render/` — Phaser scenes and Graphics-only art.
- `src/services/` — WebAudio synth + generative music, Capacitor Haptics + Preferences, and monetization: the ad policy layer (`ads.ts`) over a provider seam (`adProvider.ts` → `providers/levelplay.ts`, or `providers/mock.ts` for fake ads), StoreKit IAP (`iap.ts`), the rating prompt (`review.ts`).

## Develop

```bash
npm install        # Node >= 22; postinstall patches the LevelPlay plugin (fails loudly if it can't)
npm run dev        # browser dev server (no ad surface in a browser)
npm run dev:mock   # same, with fake ads we draw ourselves — test the ad flow safely
npm test           # vitest: logic, level validation, the ad policy + provider suites
npm run build      # tsc + tests + vite build — FAILS if any level is unsolvable
```

Dev keyboard in a level: `1–9,0` toggle weights, `R` restart, `N` next after a
win, `M` mute, `Esc` level map.

## Levels

Levels are plain data (`src/game/levels/pack*.ts`): a list of signed weights
plus optional `locked` indices, `maxWeights` budget, `useAll` flag and a `hint`.
`levels.test.ts` runs the solver over every shipped level, so an unsolvable or
malformed level fails `npm run build`. The solver's minimum weight count drives
the 3-star threshold at runtime.

## iOS

Requires Node ≥ 22 for the Capacitor CLI (`nvm use 22`) and Xcode 15+.

```bash
npm run ios:sync   # ads-OFF build, release gates, cap sync ios
npm run ios:open   # open in Xcode
```

`ios:sync` is deliberately the **ads-off** build: nothing on the device can load an ad.
The App target's first build phase, the Ad-mode guard, refuses anything it cannot prove: an
`ios:sync:test` (real-ads) bundle builds only with `AD_TARGET=test` stated and is never archived,
and live reload (`npx cap run ios -l`) does not build because it writes `server.url`.
Every build that serves ads on Unity LevelPlay serves **real** ads — there is no test
inventory and no build that is safe to tap — so never tap an ad on any build. The App
Store build (`npm run ios:appstore`) and the two-build release are in
[`CLAUDE.md`](CLAUDE.md) ("Ad safety") and [`docs/RELEASE.md`](docs/RELEASE.md).

In Xcode: select the **App** scheme and an iPhone simulator (or a device with
your signing team set under *Signing & Capabilities*), then **Run**. Bundle id
`com.noqyris.exactly67`, display name "Exactly 67", portrait-only, universal
(iPhone + iPad, layout centers into a content frame on tablets).

## Shipping to the App Store

The release runbook — the pre-release checklist, the two-build release, the ad gates, fastlane with
its upload ledger and privacy gate, the App Store Connect submission — is
[`docs/RELEASE.md`](docs/RELEASE.md). Version and build number live only in
`ios/App/App.xcodeproj/project.pbxproj`. The listing text fastlane pushes lives in
`ios/App/fastlane/metadata/`. Collateral in [store/](store/):

- `icon-1024.png` — the source app icon (Xcode generates all sizes).
- `screenshots/iphone-6.9/` and `screenshots/ipad-13/` — App Store screenshots at the required sizes.
- `STORE_LISTING.md` — internal mirror of the fastlane metadata, plus the App Store Connect-only answers (in-app purchases, App Privacy).
- `PRIVACY_POLICY.md` — a short internal summary of the published policy, [`docs/privacy.html`](docs/privacy.html). Never publish it.
- `SUBMISSION.md` — the historical 1.0.0 first-submission walkthrough; do not follow it for a release.
- `PLAY_LISTING.md` — the Google Play listing (Android is not being released).

The bundled `ios/App/App/PrivacyInfo.xcprivacy` declares no tracking and no collected data **for the app's own code**; the LevelPlay and Unity Ads SDKs ship their own privacy manifests, and App Store Connect's App Privacy answers cover the ad SDK's collection. The comment in that file explains why `NSPrivacyTracking` stays `false`.
