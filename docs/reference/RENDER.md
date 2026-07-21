# Module reference — `src/render` (Phaser scenes + vector art)

Per-file reference for the visible layer. All art is `Phaser.Graphics`
primitives; there are **no image assets**. Deeper than
[`ARCHITECTURE.md` §4](../ARCHITECTURE.md). Anchors are `file:line`.

> **Layer rule:** `render/` may import both `game/` and `services/` (plus
> Phaser). Nothing imports `render/`.

---

## `../main.ts` — boot

`boot()` (`:27`) constructs Phaser after the platform is ready:

1. `await document.fonts.ready` — so first paint uses bundled **Baloo 2**, not a
   fallback.
2. `Promise.all([initProgress(), loadSoundEnabled(), loadHapticsEnabled(),
   loadAdsRemoved()])` → push flags into `setSoundEnabled` / `setHapticsEnabled`,
   and `primeAdsRemoved(adsAlreadyRemoved)` so scenes read `adsRemoved()`
   correctly before `initAds()` runs (owners skip SDK init).
3. If `wantAds` (native && !adsRemoved): `setAdBannerReserve(BANNER_RESERVE_DESIGN_PX
   * DPR)` **before** scenes lay out, so the drag area clears the banner from the
   first frame.
4. `new Phaser.Game({ ..., scene: [MenuScene, LevelMapScene, GameScene] })` —
   index 0 (`Menu`) auto-starts.
5. After boot: register `setBannerHeightHandler` (reserve the banner's real
   height + relayout), `initAds().then(showBanner)`, `initIap()`, `initHintState()`.

**Manual DPR retina scaling** (`main.ts`): canvas is `innerWidth*DPR ×
innerHeight*DPR` with `Scale.NONE` + `zoom: 1/DPR`. `Phaser.Scale.RESIZE` can't give
a physical-pixel backing store, so it's avoided. A `window 'resize'` listener calls
`game.scale.resize(...)`. **`vite base: './'` is load-bearing** — assets resolve
from `capacitor://localhost`; don't change it to `'/'`.

---

## `layout.ts` — DPR, content frame, safe area, banner reserve

| Export | Signature | Behavior |
|---|---|---|
| `DPR` | `const` (`:6`) | `clamp(devicePixelRatio, 1, 3)`. |
| `u` | `(n: number) => number` (`:8`) | `n * DPR`. **1 design unit = 1 CSS px.** Every fixed dimension goes through this. |
| `MAX_CONTENT_W` / `MAX_CONTENT_H` | `680` / `940` | Play-area cap in design points. |
| `contentFrame` | `(screenW, screenH) => { ox, oy, ew, eh, cx }` (`:32`) | Caps the play area to `u(680)×u(940)` and centers it — full-screen on phones, a centered column on tablets. |
| `setAdBannerReserve` | `(px: number) => void` (`:54`) | Device-px strip folded into `safeArea().bottom`. |
| `adBannerReserve` | `() => number` (`:58`) | Current reserve. |
| `safeArea` | `() => { top, bottom, left, right }` (`:72`) | iOS notch/home-indicator `env()` insets (from `style.css`) → device px. **`bottom` includes the ad-banner reserve.** |
| `prefersReducedMotion` | `() => boolean` (`:82`) | `matchMedia` guard. |

> **Do not remove the banner reserve** — it is what keeps a dragged weight from
> physically overlapping the ad (AdMob bans ads under interactive content). See
> [`MONETIZATION.md`](../MONETIZATION.md).

**`u()` double-apply gotcha:** `TEXT.ink`/`TEXT.cream` already apply `u()` to font
sizes. A few labels whose size is **already** in device pixels (the 67 block, level
buttons) use a raw px font on purpose, or the DPR scale would apply twice.

---

## `palette.ts` — the single color/typography source

All colors, `INK`, `BG`, candy fills, semantic `GOOD`/`OVER`/`UNDER`, `OUTLINE =
u(4)`, and `FONT` live here. Helpers: `weightColor(value)` (buckets fill by
magnitude), `labelColorFor(fill)` (ink vs cream for contrast). Change a color once,
here — nowhere else references raw hex.

---

## `ui.ts` — shared UI + icon drawers

| Export | Signature | Behavior |
|---|---|---|
| `makeButton` | `(scene, label, width, height, fill, labelColor, onTap) => Container` (`:6`) | Chunky rounded button with an ink drop-shadow slab; presses down `drop` px on `pointerdown`, releases on `pointerup`/`pointerout`. **No debounce built in** — callers that need it guard themselves (see GameScene win overlay). |
| `makeIconButton` | `(scene, size, render, onTap) => Container & { refresh() }` (`:63`) | Square icon button; `render(g, size)` draws the glyph; `refresh()` redraws it (e.g. muted state). |
| `drawStar` | `(g, x, y, radius, filled)` (`:97`) | Five-pointed star, filled (`STAR`) or empty (`STAR_EMPTY`). |
| `drawSoundIcon` / `drawHapticsIcon` | `(g, size, on)` (`:118` / `:135`) | Speaker / buzzing-phone; a slash is drawn when off. |
| `drawBackIcon` | `(g, size)` (`:149`) | Chevron. |
| `drawHintIcon` | `(g, size)` (`:160`) | Lightbulb for the rewarded-hint button. |
| `TEXT` | `{ ink(size, weight?), cream(size, weight?) }` (`:175`) | Text-style factory; **applies `u()`** to the font size. |

---

## `MenuScene.ts` — title + idle scale + play/settings

`create()` (`:24`) builds: the "EXACTLY" title, the chunky **67** block, the
subtitle, a live idle `ScaleView` "heartbeat", the button column (Play → first
uncleared level via `isCleared` scan; Level map; and, on device with the IAP
loaded, "Remove ads · _price_" + "Restore purchases"), and the sound/haptics
toggles.

**Responsive scale placement (the layout the QA fix hardened):**

- The button column is **bottom-anchored** just above the banner strip
  (`columnDrop = removeAdsVisible ? u(221) : u(161)`).
- The idle scale **always shows**, sized to the gap between the subtitle and the
  buttons. It shrinks uniformly (`k`) on cramped screens instead of disappearing,
  and its bottom is **hard-clamped** to never cross into the Play button:
  `cy = Math.min(gapTop + upReach + topPad, gapBottom - scaleDrop)`.
- On the smallest/oldest screens with a banner **and** the Remove-ads button, the
  scale shrinks and rides up toward the subtitle rather than overlap the button.

> This replaced an earlier version that positioned the scale by a fixed offset and
> could climb behind the Play button under ads. See
> [`TESTING.md` — finding #1](../TESTING.md#the-5-confirmed-bugs-all-fixed).

When a Remove-ads purchase lands, `setIapListener` restarts the scene so the button
clears.

---

## `LevelMapScene.ts` — scrollable star/level map

`create()` (`:29`) builds a sticky header (back button → `Menu`, "Levels" title, a
`totalStars/216` chip) over a scrolling 4-column grid of the three packs.

- `init({ scrollTo? })` (`:25`) lands a given level in view.
- `levelButton(global, x, y, size)` (`:129`) draws each cell: **unlocked** →
  number + (if cleared) three stars, tappable → `scene.start('Game', { level })`;
  **locked** → dimmed with a padlock, no input. `current` (unlocked, 0 stars) uses
  the `BEAM` fill so the next-to-play level stands out.
- `bindScrolling(headerH)` (`:188`) implements custom drag + wheel scrolling with a
  `moved` flag so a scroll-drag doesn't fire a tap; content clamps within
  `[minY, 0]`. The header backdrop is `setInteractive()` so buttons scrolled under
  it can't be tapped through.

---

## `GameScene.ts` — the play loop (~700 LOC)

`init({ level? })` defaults to 1 and resolves via `levelByGlobal`, throwing on an
unknown level. `create()` builds `initialPlacement`, precomputes `minWeights =
solveLevel(level).minWeights`, then the `ScaleView`, tray, `WeightView`s, and HUD,
and snaps everything with `settleImmediately()` + `steerWeights(1)`.

**Core data flow** (every tap/drag routes here):

```
placeWeight / removeWeight
  → canPlace/place  (or canRemove/remove)     [game/rules]
  → SFX + haptics
  → afterChange()
      → evaluate(level, placed)               [game/rules] → Evaluation
      → scaleView.setTargetAngle(beamAngleDeg(ev.total))
      → updateHud(ev)                          // total chip color + gap message
      → if ev.won && !wonState → winSequence()
```

`update(time, delta)` advances the `ScaleView` spring and `steerWeights(1 -
exp(-12·dt))` — a frame-rate-independent lerp gliding every non-dragging weight
toward its tray-home or pan slot.

### HUD gap message (`updateHud`)

Branches on the `Evaluation`: won → "PERFECT — exactly 67!"; balanced (useAll not
done) → "Balanced! Now use every weight."; nothing placed → "Load the right pan to
67"; over (`gap > 0`) → **"N too heavy — balloons lift!"** only when an *unplaced
balloon actually exists*, otherwise **"N too heavy — remove a weight"**; under →
"N to go".

> The balloon/remove-a-weight branch is an audit fix — positive-only levels (1–5)
> used to advise a balloon mechanic they don't have. See
> [`TESTING.md` — finding #4](../TESTING.md#the-5-confirmed-bugs-all-fixed).

### Hint button, interstitial, win overlay

- The 💡 button spends today's **free** hint (`freeHintAvailable`), else prompts a
  **rewarded ad** ("Watch ad"); on reward it calls `WeightView.highlight()` on a
  weight from `minimalSolution(level)`.
- `winSequence()` sets `wonState`, `scaleView.setWon(true)`, computes
  `starsForClear(placedCount, minWeights)`, `recordClear(...)`, then shakes, plays
  the jingle, and shows the overlay.
- `leaveAfterClear(go)` runs a cadence-gated interstitial then navigates either
  way: `maybeShowInterstitial(global).finally(go)`.
- The win overlay (Retry / Map / Next) **locks all buttons on the first press** (a
  local `once()` guard) so a second tap during the awaited interstitial can't queue
  a competing navigation.

> The `once()` lock is an audit fix. See
> [`TESTING.md` — finding #5](../TESTING.md#the-5-confirmed-bugs-all-fixed).

---

## `ScaleView.ts` — the beam spring

`ScaleView` (`:33`) builds the fulcrum, a rotating beam `Container`, two upright
hanging pans, the string Vs, and the fixed "67" block on the left pan — all
`Graphics`. The beam angle is an **under-damped angular spring**, not the target
itself.

| Method | Behavior |
|---|---|
| `setTargetAngle(deg)` (`:82`) | Sets the goal only; the beam visibly springs toward it (`K` stiffness, `C` damping, plus a gentle idle sway). |
| `settleImmediately()` (`:87`) | Snaps to the target — call on scene start/reset to avoid a visible spring from 0°. |
| `setWon(true)` (`:94`) | Forces `targetAngle = 0`, kills the idle sway, firmer damping (`C = 10`) — locks the beam level under the win overlay. |
| `rightPanAnchor()` (`:100`) | Drop-target / weight-stacking anchor GameScene reads. |
| `layout(geo)` (`:68`) | Rebuild at new geometry (used on resize). |

The pans are **separate** Containers, not rotated with the beam; `positionPans()`
(`:137`) re-derives each pan's world position from the beam ends every frame and
hangs it straight down so dishes stay upright.

---

## `WeightView.ts` — Graphics-only draggable weight

`WeightView extends Phaser.GameObjects.Container` (`:21`): `value > 0` → handled
candy block (`drawBlock`), `value < 0` → balloon whose string terminates at the
container **origin** (`drawBalloon`), so placing the origin on the pan rim floats
the balloon above it.

| Member | Behavior |
|---|---|
| `sizeFor(value)` (`:67`, static) | Body scales by magnitude, clamped `u(44..84)`. |
| `bodyRect()` (`:82`) | Local rect of the visible body for hit/drop math. |
| `makeInteractive()` (`:185`) | Hit area authored in **displayOrigin-relative** coords (Phaser adds `displayOrigin` to the pointer before `Contains`) — get this wrong and only one quadrant drags. |
| `centerOffsetY(scale)` (`:208`) | Tray-slot centering offset. |
| `wiggle()` (`:213`) | Refusal shake. |
| `highlight()` (`:229`) | Expanding pulse ring (rewarded-hint reveal); a child, so it rides the container's steered position/scale. |

Locked weights get a `LOCKED_TINT` + padlock badge and no input.

---

## Testing this layer

The render layer is exercised via **manual E2E** (the unit tests only cover
`game/`). The whole game runs identically in the browser (`npm run dev`), which is
how gameplay is driven for testing. See the
[E2E matrix and how-to-drive](../TESTING.md#4-manual-e2e-test-matrix) in
`TESTING.md`.
