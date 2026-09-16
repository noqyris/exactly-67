# Module reference — `src/render` (Phaser scenes + vector art)

Per-file reference for the visible layer. All art is `Phaser.Graphics`
primitives; there are **no image assets**. Deeper than
[`ARCHITECTURE.md` §4](../ARCHITECTURE.md). Anchors are `file:line`.

> **Layer rule:** `render/` may import both `game/` and `services/` (plus
> Phaser). Nothing imports `render/`.

---

## `../main.ts` — boot

`boot()` constructs Phaser after the platform is ready:

1. `initSplash()` first, before any await — the studio sting plays **over** the boot
   and returns `splashGone`, which ads wait on. `stampBuildFlags()` marks a
   `VITE_UNLOCK_ALL` build on `<html data-build-flags>`.
2. `await document.fonts.ready` — so first paint uses bundled **Baloo 2**, not a
   fallback.
3. `Promise.all([initProgress(), loadSoundEnabled(), loadHapticsEnabled(),
   loadMusicEnabled(MUSIC_ON_BY_DEFAULT), loadAdsRemoved(), loadUnlimitedHints(),
   initHintState()])` → push the flags into audio/haptics/music, then
   `primeAdsRemoved()` and `primeUnlimitedHints()` (a `null` unlimited flag is a
   pre-split install: grandfathered from `adsRemoved` and written back).
4. `setAdBannerReserve(bannerReserve() * DPR)` **before** scenes lay out — 58 design
   px when a banner will be requested, 0 with no ad surface or for either unlock —
   so the drag area clears the banner from the first frame.
5. `new Phaser.Game({ ..., scene: [MenuScene, LevelMapScene, GameScene, StoreScene] })` —
   index 0 (`Menu`) auto-starts.
6. After construction: `setGameLoopHooks({ pause: game.loop.sleep, resume: game.loop.wake })`;
   dev-only test bridge + capture director behind `import.meta.env.DEV`;
   `splashGone.then(initAds).then(showBanner)` (unconditional — the ads service decides
   who gets what); `adsForegrounded()` on `visibilitychange` to visible; music armed on
   the first `pointerdown` (capture phase); `initIap()`; `initReview()`.

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
| `safeArea` | `() => { top, bottom, left, right }` (`:72`) | iOS notch/home-indicator `env()` insets (from `style.css`) → device px. **`bottom` includes the ad-banner reserve** (on top of the home-indicator inset, which the native banner sits above). |
| `prefersReducedMotion` | `() => boolean` (`:82`) | `matchMedia` guard. |

> **Do not remove the banner reserve** — it is what keeps a dragged weight from
> physically overlapping the ad (ad networks, Unity's Placement Policy included, ban
> placements where mis-taps are likely). The reserve is set once at boot and is not
> collapsed if an unlock is bought mid-session. See
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
| `drawSoundIcon` / `drawHapticsIcon` / `drawMusicIcon` | `(g, size, on)` | Speaker / buzzing-phone / note; a slash is drawn when off. |
| `drawBackIcon` | `(g, size)` (`:149`) | Chevron. |
| `drawHintIcon` | `(g, size, state)` | Lightbulb for the hint button: `'have'` (lit) or `'empty'`. The count badge is a separate Text child that `GameScene.refreshHint()` keeps in sync. |
| `TEXT` | `{ ink(size, weight?), cream(size, weight?) }` (`:175`) | Text-style factory; **applies `u()`** to the font size. |

---

## `MenuScene.ts` — title + idle scale + play/settings

`create()` builds: the "EXACTLY" title, the chunky **67** block, the subtitle, a
live idle `ScaleView` "heartbeat", the button column (Play → first uncleared level
via `isCleared` scan; Daily Challenge; Level map; and **Store** when
`iapSupported() && !hintsUnlimited()`), the sound / music / haptics toggles, and the
**"Privacy choices"** link.

**Privacy choices.** A quiet text link (12 pt, soft ink, padded to a ~44 pt touch
target) at the **top-right** of the content frame, deliberately far from the bottom
banner — a control next to an ad is a mis-tap waiting to be counted as a click. It
calls `ads.openPrivacyOptions()`, which re-opens the ad-consent modal so a player who
declined can accept and one who accepted can withdraw. Shown only when
`adsSupported() && !hintsUnlimited()`: never in a browser or an `ADS:off` build, and
never for Unlimited owners, whose SDK never starts.

**Responsive scale placement (the layout the QA fix hardened):**

- The button column is **bottom-anchored** just above the banner strip
  (`safeArea().bottom`, which includes the reserve), taller when the Store button
  shows.
- The idle scale is sized to the gap between the subtitle and the buttons and its
  bottom is **hard-clamped** never to cross into the Play button. When the gap
  cannot hold it at all (a short screen with the banner strip reserved), it is
  **not built** and the big 67 block carries the visual.

> This replaced an earlier version that positioned the scale by a fixed offset and
> could climb behind the Play button under ads. See
> [`TESTING.md` — finding #1](../TESTING.md#the-5-confirmed-bugs-all-fixed).

When a purchase changes whether the Store button should show, `setIapListener`
restarts the scene.

---

## `LevelMapScene.ts` — scrollable star/level map

`create()` builds a sticky header (back button → `Menu`, "Levels" title, a
`totalStars/(TOTAL_LEVELS × 3)` chip — `/1800`) over a scrolling, virtualized
4-column grid of all 25 packs. In a `VITE_UNLOCK_ALL` build it also prints
**"TEST BUILD · all levels unlocked"** under the title and opens every level.

- `init({ scrollTo? })` (`:25`) lands a given level in view.
- `levelButton(global, x, y, size)` (`:129`) draws each cell: **unlocked** →
  number + (if cleared) three stars, tappable → `scene.start('Game', { level })`;
  **locked** → dimmed with a padlock, no input. `current` (unlocked, 0 stars) uses
  the `BEAM` fill so the next-to-play level stands out.
- `bindScrolling(headerH)` (`:188`) implements custom drag + wheel scrolling with a
  `moved` flag so a scroll-drag doesn't fire a tap; content clamps within
  `[minY, 0]`. The header backdrop is `setInteractive()` so buttons scrolled under
  it can't be tapped through.
- **Footer over the banner strip** (`FOOTER_GAP = 16`). When `adBannerReserve() > 0`,
  `create()` adds an opaque `BG` rectangle at depth 5, `setInteractive()` like the
  header, of height `safeArea().bottom + u(16)` — the home-indicator inset, the 58 pt
  strip and 16 pt more — stored as `footerH`. The map is the one screen whose tappable
  things scroll: without the footer a tile slid through the strip's 8 pt of air and
  under the native banner, putting a finger beside the ad (Unity's placement policy
  forbids ads where fingers land by accident, and accidental clicks are what closed the
  AdMob account). The nearest visible, tappable tile edge is now 24 pt above the ad.
  With no reserve (No ads, Unlimited, no ad surface) `footerH` is 0 and there is no
  footer. `contentHeight` pads past `max(safe.bottom, footerH)` so the last row scrolls
  fully clear, and `scrollTo` centres the level in the band between header and footer.
  `scrollY` is still reset on every `create()` (Phaser reuses the scene instance).

---

## `GameScene.ts` — the play loop (~1,400 LOC)

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

- The 💡 button (`doHint`) points at the next unplaced piece of
  `minimalSolution(level)` with a ghost demo + `WeightView.highlight()`. Unlimited
  owners (`hintsUnlimited()`, never `adsRemoved()`) get it free; everyone else
  spends one **banked** hint, and a re-tap on the same board replays it free. At zero
  hints it opens the hint modal (`showHintMenu`), described below.
- `create()` calls `void showBanner()` on every level start — idempotent, and it heals
  a first banner request that found no fill or an SDK still waiting on consent.
- `winSequence()` sets `wonState`, `scaleView.setWon(true)`, computes
  `starsForClear(placedCount, minWeights)`, `recordClear(...)`, then shakes, plays
  the jingle, and shows the overlay.
- `noteCleared()` runs on every win. `leaveAfterClear(go)` —
  `maybeShowInterstitial(global).finally(go)` — is wired to **Next**, **The End!** and
  **Map** (never Retry, never the Daily Challenge's Done/Menu). It resolves only once
  the player has dismissed the ad (the game loop sleeps meanwhile), so the next level
  never starts underneath a live ad.
- The overlay asks for a rating (`maybeRequestReview`) only when
  `interstitialWouldShow(global)` is false.
- The win overlay (Retry / Map / Next) **locks all buttons on the first press** (a
  local `once()` guard) so a second tap during the awaited interstitial can't queue
  a competing navigation.

### The hint modal (`showHintMenu`, `watchForHint`, `HINT_COPY`)

All of its words live in the module constant `HINT_COPY`, because Unity's Rewarded
Inventory Policy requires the reward **and** the required action to be named before
the player opts in, and bars "support us" framing:

| Key | Text |
|---|---|
| `watch` / `watchShort` | "Watch ad: +1 hint" / "Ad: +1 hint" |
| `loading` | "Loading…" |
| `body(n)` | n = 0: "Out of hints — watch a short ad for 1 hint, or grab a pack." · otherwise "You have N hint(s). Watch a short ad for 1 more." |
| `videosOff` | "Hint videos are off because ads were declined. Turn them on under Privacy choices on the menu, or grab a pack." |
| `earned` / `unavailable` / `notEarned` | "Hint earned!" / "No video available right now — try again soon" / "No hint this time — the ad didn't play to the end" |

- **Layout.** Title, a body box, "More hints in the Store" (launches `StoreScene` as an
  overlay with `{ returnTo: 'Game' }` so the board survives), then a button row: *Done*
  on the left (a third of the row), the watch button on the right. The body box is
  sized once for the longest text it can show (`body(0)`, `body(99)`, `videosOff`), so
  the card never resizes and the buttons never move under a thumb.
- **Label fit.** `hintWatchLabel()` measures `HINT_COPY.watch` in `makeButton`'s own
  font and size against the button width minus `u(20)`, and falls back to
  `watchShort` when it does not fit (a 320 pt phone). Measured once per modal.
- **`refresh()`** re-reads everything each time it runs — the stash, `hintBusy`, and
  `ads.rewardedOffered()` — and rebuilds the buttons. When the offer stands: body
  `body(hintCountValue())`, both buttons. When it does not (no ad consent): body
  `videosOff`, **no watch button**, *Done* alone and centred. A yes given later from
  Privacy choices brings the watch button back the next time the modal draws. It
  returns early once the body Text is destroyed.
- **Messages** go to a note just **under the card** (cream text with an ink stroke,
  fades after 1.8 s), not to the scene toast, which sits under the dim and behind the
  card on 320 and 390 pt phones. Once the modal has closed they fall back to the toast.
- **`watchForHint()`** sets `hintBusy` and refreshes: the watch button reads "Loading…"
  at 60% opacity with input off, *Done* and the Store link dim, and none of the three
  (nor the dim layer) closes the modal. It awaits `ads.watchRewardedHint()`, clears
  `hintBusy`, **grants the hint first** on `'earned'` (the stash is global, and a video
  watched to the end is owed its hint whatever happened to the board), then returns if
  the scene is no longer active. Otherwise it refreshes the badge and the modal, and —
  unless the board has been won meanwhile — says `earned`, or nothing if consent was
  withdrawn (the refreshed body already says why), or `unavailable` / `notEarned` by
  outcome. `doHint()` does nothing while `hintBusy` is set.

---

## `StoreScene.ts` — the shop

The price ladder, fitted without scrolling: hint packs, **No ads**, **Unlimited hints**
(the hero card), and Restore purchases. An offer without a loaded price is hidden.

- **Card fit.** Cards shrink between `u(58)` and `u(84)` to fit the space above the
  footer; the hero card is 12% taller, so it counts as 1.12 rows. When even
  minimum-height cards cannot fit with full gaps (a 320×568 phone with the banner strip
  reserved), the gaps shrink from 12 pt down to 4 pt before the list may overlap
  "Hints never expire.".
- **No ads sublabel.** `offerCard({ sublabel })` accepts a string or a list of
  candidates, longest first; the first that clears the price chip wins (measured, since
  Baloo's widths vary and a localized price widens the chip). No ads passes
  `['hints not included · hint videos stay', 'without hints · hint videos stay',
  'hint videos stay']`: the card always says the hint video stays, because the $0.99
  product removes the banner and the between-level ads but not the rewarded video, and
  a buyer who met one after paying would feel cheated.
- **Unlimited hints** reads "and no ads, forever".

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
