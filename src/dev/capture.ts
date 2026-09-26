/**
 * Dev-only **capture director** — scripted, repeatable gameplay for marketing
 * video (TikTok / Reels / Shorts).
 *
 * Like `testBridge.ts`, it is imported behind an `import.meta.env.DEV` guard in
 * `main.ts`, so Vite tree-shakes the whole module out of the shipped bundle —
 * no capture surface ever reaches the App Store / Play build.
 *
 * It drives the game through the same `placeWeight` path a real tap uses (the
 * `window.__exactly67` dev bridge GameScene installs), so sounds, haptics,
 * tweens, the beam spring and the win sequence all fire exactly as they do for
 * a player. Nothing about the recording is faked.
 *
 * ## Usage
 *
 *   npm run dev
 *   open http://localhost:5173/?rec=71
 *
 * Then screen-record the window (QuickTime / OBS). Size the browser window to
 * 9:16 first — see `marketing/TIKTOK_PLAYBOOK.md`.
 *
 * ## URL parameters
 *
 * | Param   | Default | Meaning |
 * |---------|---------|---------|
 * | `rec`   | —       | Global level number (1–72). **Required** — absent = normal game. |
 * | `mode`  | `solve` | `solve` = clean win. `fail` = stop on the nearest legal wrong answer. `asmr` = chain levels. `decoy` = land on exactly 67 and get refused (see below). |
 * | `pace`  | `620`   | Milliseconds between placements. Lower = snappier. |
 * | `lead`  | `1400`  | Milliseconds to hold on the untouched board before the first move. |
 * | `hold`  | `2600`  | Milliseconds to hold after the win overlay (or after the near-miss). |
 * | `chain` | `3`     | `mode=asmr` only: how many consecutive levels to play (max 24 — a 60-120s chain is the format that actually gets views). |
 * | `loop`  | `0`     | `1` = restart forever (attract mode / B-roll). |
 * | `mute`  | `0`     | `1` = silence the synth SFX (for clips you score yourself). |
 * | `seed`  | `1`     | `1` = mark every earlier level cleared so the map looks lived-in. Costs one reload. |
 * | `auto`  | `0`     | `1` = start immediately instead of waiting for a click. **Records silent** — see below. |
 * | `armed` | `0`     | `1` = hold once the board is up until `window.__e67go()` is called. Used by `tools/render-clip.mjs`; not useful by hand. |
 * | `wav`   | `0`     | `<seconds>` = re-render the SFX offline into a WAV buffer of that length (see `audioRender.ts`). Renderer-only. |
 * | `human` | `1`     | `0` = place pieces instantly on a metronome. The default mimes a player — see below. |
 *
 * ## Looking played, not driven
 *
 * Pieces are dragged, not teleported: `humanDrag` dispatches real mouse events
 * along an arced, eased path, so the game runs its own
 * dragstart/drag/dragend handlers and the weight follows the pointer exactly as
 * it would under a finger. The timing is a rhythm rather than a metronome —
 * a longer read of the board up front, a pause before the piece that decides
 * the level, quicker work through the obvious middle. All of it comes from a
 * seeded PRNG, so a clip still re-renders bit-for-bit and the separate audio
 * and video passes agree.
 *
 * ## Why it waits for a click
 *
 * Browsers refuse to start an AudioContext until the page has seen a user
 * gesture, so a capture that auto-plays on load renders **completely silent** —
 * and the synth SFX are half the reason the clip is watchable. So the director
 * arms itself and waits for your first click or keypress. The intended flow is:
 * open the URL → start the screen recorder → click once → the run begins with
 * audio unlocked. Pass `auto=1` only when you are muting anyway (`mute=1`) and
 * scoring the clip yourself.
 *
 * ## `mode=decoy` — the refusal
 *
 * The most interesting thing the game does, and the only one that was never
 * filmed: on a `useAll` level, a *proper subset* can total exactly 67. The beam
 * locks dead level, the HUD reads 67 — and the game refuses the win, because
 * every weight still has to come aboard. `rules.ts` marks it
 * `blockedReason: 'use-all'`, the only blocked reason in the codebase.
 *
 * That is a visibly correct answer rejected by its own software, which is the
 * one thing in this product a stranger can argue about. Six levels can produce
 * it — 17, 22, 46, 55, 63 and 65 (65 has three different refusals).
 *
 * Unlike `fail`, nothing is withheld: the payoff *lands* (level beam, 67 on the
 * HUD, the win chime's setup) and is then denied. The clip resolves.
 *
 * ## The "drama order"
 *
 * Pieces are not placed in tray order. Positives go down first, **biggest
 * first**, so the beam slams over and the total overshoots hard; the balloons
 * come last and haul it back to exactly 67. That overshoot → rescue → level
 * arc is the whole reason the clip is watchable. Peak overshoot for a level is
 * therefore the sum of the balloons in its minimal solution — which is what
 * `tools/cinematic-levels.ts` ranks every level by.
 */
import type Phaser from 'phaser'
import { levelByGlobal, TOTAL_LEVELS } from '../game/levels'
import { minimalSolution } from '../game/solver'
import type { LevelDef } from '../game/types'
import { TARGET } from '../game/types'
import { resumeAudio, setSoundEnabled } from '../services/audio'

type Mode = 'solve' | 'fail' | 'asmr' | 'decoy'

interface CaptureOpts {
  level: number
  mode: Mode
  pace: number
  lead: number
  hold: number
  chain: number
  loop: boolean
  mute: boolean
  seed: boolean
  auto: boolean
  armed: boolean
  /** Seconds of offline SFX to render, or 0 for none. */
  wav: number
  /** Mime a real player: arced drags and uneven timing. */
  human: boolean
}

/**
 * Progress beacon read by the offline renderer (`tools/render-clip.mjs`), which
 * drives this module under Chrome's virtual-time clock and needs to know when
 * the run is over rather than guessing a frame count.
 */
interface CaptureStatus {
  /** Total scheduled runtime in ms, once the first level's order is known. */
  plannedMs: number
  /** True when every level in the run (chain included) has finished. */
  done: boolean
  /** `armed=1` only: the board is up and untouched, waiting for `__e67go()`. */
  armed: boolean
}

function status(): CaptureStatus {
  const w = window as unknown as { __e67capture?: CaptureStatus }
  w.__e67capture ??= { plannedMs: 0, done: false, armed: false }
  return w.__e67capture
}

/**
 * `armed=1`: hold once the level is on screen and untouched, until the renderer
 * calls `window.__e67go()`. The offline renderer needs a hard guarantee that
 * frame 0 is the pristine board — it has to warm the page up (boot, fonts,
 * scene create) on virtual time first, and without this handshake that warm-up
 * silently eats the lead-in and the first placements.
 */
function waitForGo(): Promise<void> {
  return new Promise<void>((resolve) => {
    ;(window as unknown as { __e67go?: () => void }).__e67go = () => {
      status().armed = false
      resolve()
    }
    status().armed = true
  })
}

/** The dev bridge GameScene installs on `window` in create() (DEV only). */
interface SceneBridge {
  place: (i: number) => void
  remove: (i: number) => void
  state: () => { total: number; won: boolean }
  level: { global: number; def: LevelDef }
  /** GameScene itself. Private fields are reachable at runtime via cast — used
   *  for the drop zone and live weight positions when miming a real drag. */
  scene: unknown
}

interface SceneInternals {
  dropZone: { x: number; y: number; width: number; height: number }
  weights: { x: number; y: number }[]
  placed: boolean[]
}

const internals = (b: SceneBridge) => b.scene as SceneInternals

/**
 * Deterministic PRNG (mulberry32). `Math.random` is not an option: the video
 * and audio passes are separate runs that must produce the same timeline, and
 * re-rendering a clip has to reproduce it exactly.
 */
function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const SEED_MARK = 'e67.capture.seeded'

function clampInt(raw: string | null, fallback: number, lo: number, hi: number): number {
  const n = raw === null ? NaN : parseInt(raw, 10)
  if (!Number.isFinite(n)) return fallback
  return Math.min(hi, Math.max(lo, n))
}

function parseOpts(): CaptureOpts | null {
  const q = new URLSearchParams(window.location.search)
  const rec = q.get('rec')
  if (rec === null) return null

  const level = clampInt(rec, 1, 1, TOTAL_LEVELS)
  const rawMode = q.get('mode')
  const mode: Mode =
    rawMode === 'fail' || rawMode === 'asmr' || rawMode === 'decoy' ? rawMode : 'solve'

  return {
    level,
    mode,
    pace: clampInt(q.get('pace'), 620, 60, 6000),
    lead: clampInt(q.get('lead'), 1400, 0, 20000),
    hold: clampInt(q.get('hold'), 2600, 0, 30000),
    chain: clampInt(q.get('chain'), 3, 1, 24),
    loop: q.get('loop') === '1',
    mute: q.get('mute') === '1',
    seed: q.get('seed') !== '0',
    auto: q.get('auto') === '1',
    armed: q.get('armed') === '1',
    wav: clampInt(q.get('wav'), 0, 0, 300),
    human: q.get('human') !== '0',
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/**
 * Schedule position in ms, advanced by exactly the amount each wait intends to
 * take. `audioRender.ts` schedules notes against this rather than a wall clock,
 * so the real-time audio pass and the virtual-time video pass agree exactly.
 * Every wait in a capture must go through `tick`, or the two drift apart.
 */
let logicalMs = 0
let audioClock: ((ms: number) => void) | null = null

async function tick(ms: number): Promise<void> {
  logicalMs += ms
  audioClock?.(logicalMs)
  await sleep(ms)
}

/**
 * Dispatch a real input event on the canvas at a world position. The game
 * cannot tell this from a hand, which is the point: the drag runs through
 * WeightView's own dragstart/drag/dragend handlers rather than shortcutting to
 * placeWeight, so the piece follows the pointer and lands like a real one.
 *
 * **MouseEvent, not PointerEvent.** Phaser boots its MouseManager against the
 * canvas and — with no touch hardware present — never sets up a TouchManager,
 * so it listens for `mousedown`/`mousemove`/`mouseup` only. PointerEvents reach
 * the DOM and are ignored: the canvas fires its listener, Phaser's own pointer
 * stays at 0,0, and every drag silently falls back to a direct place().
 */
function mouseAt(game: Phaser.Game, type: string, wx: number, wy: number): void {
  const canvas = game.canvas
  const rect = canvas.getBoundingClientRect()
  const scale = rect.width / game.scale.width
  canvas.dispatchEvent(
    new MouseEvent(type, {
      clientX: rect.left + wx * scale,
      clientY: rect.top + wy * scale,
      bubbles: true,
      cancelable: true,
      button: 0,
      buttons: type === 'mouseup' ? 0 : 1,
    }),
  )
}

const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2)

/**
 * Drag one weight from the tray onto the pan the way a hand does: an arced
 * path rather than a straight line, eased so it starts slow and slows into the
 * drop, with a slight overshoot that settles back. Falls back to a direct
 * place() if the drag did not register, so a clip can never silently lose a
 * piece.
 */
async function humanDrag(
  game: Phaser.Game,
  bridge: SceneBridge,
  index: number,
  ms: number,
  random: () => number,
): Promise<void> {
  const sc = internals(bridge)
  const view = sc.weights[index]
  const zone = sc.dropZone
  if (!view || !zone) {
    bridge.place(index)
    return
  }

  const from = { x: view.x, y: view.y }
  // Aim off-centre so repeated drops don't stack on one pixel.
  const to = {
    x: zone.x + zone.width * (0.35 + random() * 0.3),
    y: zone.y + zone.height * (0.35 + random() * 0.3),
  }

  // Arc perpendicular to the travel direction — a hand swings, it doesn't rule.
  const dx = to.x - from.x
  const dy = to.y - from.y
  const dist = Math.hypot(dx, dy) || 1
  const arc = (random() * 0.18 + 0.08) * dist * (random() < 0.5 ? -1 : 1)

  const steps = 16
  mouseAt(game, 'mousedown', from.x, from.y)
  await tick(Math.round(ms * 0.12))

  for (let i = 1; i <= steps; i++) {
    const t = easeInOut(i / steps)
    // Overshoot slightly past the target, then settle back on the last steps.
    const over = 1 + 0.06 * Math.sin(Math.PI * Math.min(1, (i / steps) * 1.25))
    const bow = Math.sin(Math.PI * (i / steps)) * arc
    mouseAt(
      game,
      'mousemove',
      from.x + dx * t * over - (dy / dist) * bow,
      from.y + dy * t * over + (dx / dist) * bow,
    )
    await tick(Math.max(1, Math.round((ms * 0.76) / steps)))
  }

  mouseAt(game, 'mousemove', to.x, to.y)
  mouseAt(game, 'mouseup', to.x, to.y)
  await tick(Math.round(ms * 0.12))

  // Safety net: if Phaser never started the drag, place it outright.
  if (!sc.placed?.[index]) bridge.place(index)
}

/**
 * Mark every level below `upTo` as three-star cleared, so the level map reads
 * as a played-in save instead of a fresh install. Mirrors the key format in
 * `services/storage.ts` (the Capacitor Preferences web backend prefixes keys).
 */
function seedProgress(upTo: number): void {
  const stars: Record<string, number> = {}
  const best: Record<string, number> = {}
  for (let i = 1; i <= upTo; i++) {
    stars[i] = 3
    best[i] = 1
  }
  localStorage.setItem(
    'CapacitorStorage.exactly67.progress',
    JSON.stringify({ stars, best }),
  )
}

/**
 * Placement order tuned for video: heaviest weights first (the beam slams and
 * the total overshoots), balloons last (the rescue back down to 67).
 * Locked pieces are already aboard and are skipped.
 */
function dramaOrder(def: LevelDef, solution: number[]): number[] {
  const locked = new Set(def.locked ?? [])
  const free = solution.filter((i) => !locked.has(i))
  const heavy = free
    .filter((i) => def.weights[i] > 0)
    .sort((a, b) => def.weights[b] - def.weights[a])
  const balloons = free
    .filter((i) => def.weights[i] < 0)
    .sort((a, b) => def.weights[a] - def.weights[b])
  return [...heavy, ...balloons]
}

/**
 * The most infuriating wrong answer: the legal subset whose total is closest to
 * 67 without hitting it (ties broken toward fewer pieces). Exhaustive over
 * 2^n ≤ 4096 subsets, same constraint handling as `solver.ts`.
 * Returns null when the level admits no near miss (a `useAll` level has exactly
 * one legal subset), in which case the caller falls back to a partial solve.
 */
function nearMiss(def: LevelDef): number[] | null {
  const n = def.weights.length
  let lockedMask = 0
  for (const i of def.locked ?? []) lockedMask |= 1 << i

  const full = (1 << n) - 1
  let bestMask = -1
  let bestDiff = Infinity
  let bestCount = Infinity

  for (let mask = 0; mask <= full; mask++) {
    if ((mask & lockedMask) !== lockedMask) continue
    if (def.useAll && mask !== full) continue
    let count = 0
    let sum = 0
    for (let i = 0; i < n; i++) {
      if (mask & (1 << i)) {
        sum += def.weights[i]
        count++
      }
    }
    if (count === 0 || sum === TARGET) continue
    const diff = Math.abs(sum - TARGET)
    if (diff < bestDiff || (diff === bestDiff && count < bestCount)) {
      bestDiff = diff
      bestCount = count
      bestMask = mask
    }
  }

  if (bestMask < 0) return null
  const out: number[] = []
  for (let i = 0; i < n; i++) if (bestMask & (1 << i)) out.push(i)
  return out
}

/**
 * Show an "armed" curtain and resolve on the first click/keypress, which is
 * what unlocks the AudioContext (browsers block it until a gesture — an
 * auto-started capture records silent). The curtain removes itself before the
 * run begins, so it is never in frame.
 */
async function waitForArmingGesture(opts: CaptureOpts): Promise<void> {
  const curtain = document.createElement('div')
  curtain.setAttribute('data-e67-capture', 'curtain')
  curtain.style.cssText = [
    'position:fixed', 'inset:0', 'z-index:99999',
    'display:flex', 'flex-direction:column',
    'align-items:center', 'justify-content:center', 'gap:10px',
    'background:#F5EFE3', 'color:#2E2640', 'cursor:pointer',
    'font:700 20px/1.4 system-ui,sans-serif', 'text-align:center',
    '-webkit-user-select:none', 'user-select:none',
  ].join(';')
  curtain.innerHTML =
    '<div>Start your screen recorder, then click.</div>' +
    `<div style="font-weight:500;font-size:14px;opacity:.65">level ${opts.level} · ${opts.mode} · ${opts.pace}ms pace</div>`
  document.body.appendChild(curtain)

  await new Promise<void>((resolve) => {
    const go = () => {
      window.removeEventListener('pointerdown', go)
      window.removeEventListener('keydown', go)
      resolve()
    }
    window.addEventListener('pointerdown', go, { once: true })
    window.addEventListener('keydown', go, { once: true })
  })

  curtain.remove()
  resumeAudio()
  // Let the curtain's removal paint before the lead-in starts.
  await sleep(250)
}

/**
 * The largest proper subset of a `useAll` level that still totals exactly 67 —
 * the placement the game will refuse. Largest on purpose: the more of the tray
 * that is already aboard when the refusal lands, the more unreasonable it looks.
 *
 * `mask < full` excludes the genuine winning placement by construction, so this
 * can only ever return something the game rejects. Returns null on any level
 * without `useAll`, which is most of them.
 */
function decoySubset(def: LevelDef): number[] | null {
  if (!def.useAll) return null
  const n = def.weights.length
  let lockedMask = 0
  for (const i of def.locked ?? []) lockedMask |= 1 << i

  const full = (1 << n) - 1
  let best: number[] | null = null
  for (let mask = 0; mask < full; mask++) {
    if ((mask & lockedMask) !== lockedMask) continue
    let count = 0
    let sum = 0
    for (let i = 0; i < n; i++) {
      if (mask & (1 << i)) {
        sum += def.weights[i]
        count++
      }
    }
    if (!count || sum !== TARGET) continue
    if (!best || count > best.length) {
      const idx: number[] = []
      for (let i = 0; i < n; i++) if (mask & (1 << i)) idx.push(i)
      best = idx
    }
  }
  return best
}

/**
 * Poll for the GameScene dev bridge, once it is live on the requested level.
 * Goes through `tick` so the scene-transition gap is on the schedule in both
 * passes: the scene is always ready on the first poll (create() runs on the
 * next game step, ~16ms), so both passes spend exactly one interval here.
 */
async function waitForScene(level: number): Promise<SceneBridge | null> {
  for (let tries = 0; tries < 200; tries++) {
    const b = (window as unknown as { __exactly67?: SceneBridge }).__exactly67
    if (b && b.level.global === level) return b
    await tick(50)
  }
  console.warn(`[capture] GameScene for level ${level} never became ready`)
  return null
}

function startLevel(game: Phaser.Game, level: number): void {
  game.scene.stop('Menu')
  game.scene.stop('LevelMap')
  game.scene.stop('Game')
  game.scene.start('Game', { level })
}

/** Play one level end to end. Resolves once the post-win hold has elapsed. */
async function runLevel(
  game: Phaser.Game,
  level: number,
  opts: CaptureOpts,
  first: boolean,
): Promise<void> {
  if (!levelByGlobal(level)) return

  startLevel(game, level)
  const bridge = await waitForScene(level)
  if (!bridge) return

  // Every placement below is an index into the tray, so it must come from the
  // def the scene is actually showing — the presented, de-ordered tray
  // (`game/tray.ts`) — never from the authored pack data.
  const def = bridge.level.def
  const solution = minimalSolution(def)
  if (!solution) {
    console.warn(`[capture] level ${level} has no solution — nothing to record`)
    return
  }

  let order: number[]
  if (opts.mode === 'decoy') {
    const decoy = decoySubset(def)
    if (!decoy) {
      console.warn(
        `[capture] level ${level} has no decoy — needs useAll; try 17, 22, 46, 55, 63, 65`,
      )
      return
    }
    order = dramaOrder(def, decoy)
  } else if (opts.mode === 'fail') {
    const miss = nearMiss(def)
    // No legal near miss (useAll level): drop the last balloon instead, which
    // leaves the pan overshooting — still a wrong answer, still bait.
    order = miss
      ? dramaOrder(def, miss)
      : dramaOrder(def, solution).slice(0, -1)
  } else {
    order = dramaOrder(def, solution)
  }

  status().plannedMs += opts.lead + order.length * opts.pace + opts.hold

  // The board is now up and untouched — the renderer's frame 0.
  if (opts.armed && first) await waitForGo()

  if (opts.human) {
    // Seeded per level so every clip differs from its neighbours but each one
    // re-renders identically.
    const random = rng(level * 7919 + order.length)

    // A player reads the board before touching anything, and the read is
    // longer the more pieces there are to weigh up.
    await tick(Math.round(opts.lead * (0.85 + random() * 0.5)))

    for (let i = 0; i < order.length; i++) {
      const last = i === order.length - 1

      // The variance belongs in the thinking, not the moving — a hand travels
      // at roughly one speed, while the pause before choosing a piece is what
      // actually stretches and shrinks. Putting the jitter in the drag instead
      // just averages out across the gaps and still reads as a metronome.
      if (i > 0) {
        // Long look before the piece that lands the level; brisk through the
        // obvious middle, with the odd double-take.
        let think = last ? 1.3 + random() * 0.7 : 0.25 + random() * 0.65
        if (!last && random() < 0.25) think += 0.7
        await tick(Math.round(opts.pace * think))
      }

      await humanDrag(game, bridge, order[i], Math.round(240 + random() * 140), random)
      // A beat to watch the beam react before reaching for the next one.
      await tick(Math.round(120 + random() * 130))
    }
  } else {
    await tick(opts.lead)
    for (const index of order) {
      bridge.place(index)
      await tick(opts.pace)
    }
  }

  console.info(
    `[capture] level ${level} · mode=${opts.mode} · total=${bridge.state().total}`,
  )
  await tick(opts.hold)
}

export async function installCapture(game: Phaser.Game): Promise<void> {
  const opts = parseOpts()
  if (!opts) return

  // Seeding has to land before boot reads progress, so write it and reload
  // once. The session marker keeps that from becoming a reload loop.
  if (opts.seed && sessionStorage.getItem(SEED_MARK) !== String(opts.level)) {
    seedProgress(opts.level - 1)
    sessionStorage.setItem(SEED_MARK, String(opts.level))
    window.location.reload()
    return
  }

  // Must happen before the first sound plays — services/audio.ts caches its
  // context on first use, so a late swap would render an empty buffer.
  if (opts.wav > 0) {
    const m = await import('./audioRender')
    m.installOfflineAudio(opts.wav)
    audioClock = m.setAudioClock
  }

  if (opts.mute) setSoundEnabled(false)
  if (!opts.auto) await waitForArmingGesture(opts)

  const count = opts.mode === 'asmr' ? opts.chain : 1

  let first = true
  do {
    for (let k = 0; k < count; k++) {
      const level = opts.level + k
      if (level > TOTAL_LEVELS) break
      await runLevel(game, level, opts, first)
      first = false
    }
  } while (opts.loop)

  status().done = true
}
