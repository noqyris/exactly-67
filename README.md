# Exactly 67

A balance-scale number puzzle for iOS (and Android-ready). The left pan holds a
fixed **67**. Fill the right pan with down-weights (positive) and lift-weight
balloons (negative) until the total is **exactly 67** and the beam locks level.

- 72 hand-tuned levels in 3 packs (Warm-Up · Prime Time · Heavy Lifting)
- Balloons unlock at level 6 — overshoot, then pull back
- Locked weights, piece budgets and use-every-weight constraints
- 1–3 stars for efficiency: the solver-proven minimum earns 3
- Fully offline, no ads, no tracking; all art drawn in code, all audio synthesized

## Stack

Phaser 3 + TypeScript + Vite, wrapped with Capacitor 8. Portrait only.

- `src/game/` — pure logic (balance math, rules, brute-force solver, levels, progress). No Phaser imports; fully unit-tested.
- `src/render/` — Phaser scenes and Graphics-only art.
- `src/services/` — WebAudio synth, Capacitor Haptics + Preferences.

## Develop

```bash
npm install
npm run dev        # browser dev server
npm test           # vitest: logic + level validation
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
npm run ios:sync   # build web + cap sync ios
npm run ios:open   # open in Xcode
```

In Xcode: select the **App** scheme and an iPhone simulator (or a device with
your signing team set under *Signing & Capabilities*), then **Run**. Bundle id
`com.noqyris.exactly67`, display name "Exactly 67", portrait-only, universal
(iPhone + iPad, layout centers into a content frame on tablets).

## Shipping to the App Store

Everything that can be prepared without your Apple account is done and lives in
[store/](store/):

- `icon-1024.png` — the source app icon (Xcode generates all sizes).
- `screenshots/iphone-6.9/` and `screenshots/ipad-13/` — App Store screenshots at the required sizes.
- `STORE_LISTING.md` — ASO-tuned name, subtitle, keywords, description, categories.
- `PRIVACY_POLICY.md` — a ready-to-host privacy policy (the app collects no data).
- `SUBMISSION.md` — the step-by-step path to "Submit for Review", flagging exactly which
  steps need your Apple Developer account.

The bundled `ios/App/App/PrivacyInfo.xcprivacy` declares no tracking / no data collected.
