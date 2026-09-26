/**
 * Ranks every level by how well it films, and writes
 * `marketing/CINEMATIC_LEVELS.md`.
 *
 *   npm run capture:levels
 *
 * Lives outside `src` on purpose: tsconfig only includes `src`, so this script
 * is never part of the typecheck/build gate. It imports the real pure-logic
 * core (`src/game/**`), which is framework-free, so it runs fine under
 * vite-node with no DOM.
 *
 * ## Why these metrics
 *
 * Under the capture director's "drama order" (`src/dev/capture.ts`) the heavy
 * weights go down first and the balloons come last. So the pan total peaks at
 * `67 + |sum of balloons in the solution|` before being hauled back to exactly
 * 67. That peak — `overshoot` below — *is* the visual drama: it drives how far
 * the beam slams over before it settles level.
 *
 * `beamAngleDeg` saturates at ±13° via `13 * tanh(gap / 18)`, so an overshoot
 * past roughly 45 buys no extra tilt. The drama score is capped accordingly.
 *
 * It ranks the PRESENTED tray (`levelByGlobal`, de-ordered by
 * `src/game/tray.ts`), the one the game shows and the director films: where a
 * level has several fewest-piece builds, which one `minimalSolution` picks
 * depends on tray order, and so do the overshoot and the balloon count.
 */
import { beamAngleDeg } from '../src/game/balance'
import { levelByGlobal, PACKS, TOTAL_LEVELS } from '../src/game/levels'
import { minimalSolution, solveLevel } from '../src/game/solver'
import type { LevelDef } from '../src/game/types'
import { TARGET } from '../src/game/types'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT = resolve(HERE, '../marketing/CINEMATIC_LEVELS.md')

/** Default pacing in `src/dev/capture.ts` — used to estimate clip length. */
const LEAD_MS = 1400
const PACE_MS = 620
const HOLD_MS = 2600

interface Row {
  global: number
  pack: string
  weights: number[]
  n: number
  minWeights: number
  /** Free (non-locked) pieces the director actually places. */
  moves: number
  /** Peak pan total above 67 before the balloons rescue it. */
  overshoot: number
  peakAngle: number
  balloons: number
  /** Smallest |total - 67| reachable without hitting 67 — the `mode=fail` bait. */
  missBy: number | null
  constraints: string
  seconds: number
  score: number
}

function analyse(global: number): Row | null {
  const ref = levelByGlobal(global)
  if (!ref) return null
  // The presented def, not PACKS: the capture director plays the scene's own.
  const def: LevelDef = ref.def
  const solution = minimalSolution(def)
  const min = solveLevel(def).minWeights
  if (!solution || min === null) return null

  const locked = new Set(def.locked ?? [])
  const free = solution.filter((i) => !locked.has(i))
  const balloons = solution.filter((i) => def.weights[i] < 0)
  const overshoot = balloons.reduce((s, i) => s - def.weights[i], 0)

  const constraints: string[] = []
  if (def.locked?.length) constraints.push(`locked×${def.locked.length}`)
  if (def.maxWeights !== undefined) constraints.push(`max ${def.maxWeights}`)
  if (def.useAll) constraints.push('useAll')

  // Score: 100 = the perfect clip. See the header comment for the reasoning.
  const drama = (Math.min(overshoot, 45) / 45) * 40
  const density = (Math.min(def.weights.length, 12) / 12) * 25
  const rescue = balloons.length >= 2 ? 25 : balloons.length === 1 ? 18 : 0
  const crisp = min <= 3 ? 10 : min <= 4 ? 7 : min <= 5 ? 4 : 2

  return {
    global,
    pack: ref.pack.name,
    weights: def.weights,
    n: def.weights.length,
    minWeights: min,
    moves: free.length,
    overshoot,
    peakAngle: Math.abs(beamAngleDeg(TARGET + overshoot)),
    balloons: balloons.length,
    missBy: nearMissDiff(def),
    constraints: constraints.length ? constraints.join(', ') : '—',
    seconds: (LEAD_MS + free.length * PACE_MS + HOLD_MS) / 1000,
    score: Math.round(drama + density + rescue + crisp),
  }
}

/** Mirrors `nearMiss()` in src/dev/capture.ts, but returns only the distance. */
function nearMissDiff(def: LevelDef): number | null {
  const n = def.weights.length
  let lockedMask = 0
  for (const i of def.locked ?? []) lockedMask |= 1 << i
  const full = (1 << n) - 1
  let best: number | null = null

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
    if (best === null || diff < best) best = diff
  }
  return best
}

const rows: Row[] = []
for (let g = 1; g <= TOTAL_LEVELS; g++) {
  const r = analyse(g)
  if (r) rows.push(r)
}

const byScore = [...rows].sort((a, b) => b.score - a.score || b.overshoot - a.overshoot)

/** Highest drama in the fewest moves — a hook has ~2s before people swipe. */
const punchy = [...rows]
  .filter((r) => r.moves <= 4 && r.overshoot >= 20)
  .sort((a, b) => b.overshoot - a.overshoot)

/** Dense board + tight solution = the honest "only 1% solve this" framing.
 *  Balloon-finished only: a flat landing on 67 has no rescue beat to film. */
const impossible = [...rows]
  .filter((r) => r.n >= 9 && r.balloons >= 1)
  .sort((a, b) => b.n - a.n || a.minWeights - b.minWeights)

/** Off by one is the most infuriating wrong answer you can post. */
const bait = [...rows]
  .filter((r) => r.missBy !== null && r.missBy <= 1 && r.n >= 6)
  .sort((a, b) => (a.missBy ?? 9) - (b.missBy ?? 9) || b.n - a.n)

/** Short, clean, balloon-finished — chains well into a silent ASMR reel. */
const asmr = [...rows]
  .filter((r) => r.balloons >= 1 && r.moves >= 2 && r.moves <= 3)
  .sort((a, b) => b.overshoot - a.overshoot)

const table = (list: Row[], limit = Infinity) =>
  [
    '| Lvl | Pack | Score | Moves | Overshoot | Beam | Balloons | Min | Off-by | Constraints | ~Clip |',
    '|----:|------|------:|------:|----------:|-----:|---------:|----:|-------:|-------------|------:|',
    ...list
      .slice(0, limit)
      .map(
        (r) =>
          `| **${r.global}** | ${r.pack} | ${r.score} | ${r.moves} | +${r.overshoot} | ${r.peakAngle.toFixed(1)}° | ${r.balloons} | ${r.minWeights} | ${r.missBy ?? '—'} | ${r.constraints} | ${r.seconds.toFixed(1)}s |`,
      ),
  ].join('\n')

const shortList = (list: Row[], limit: number) =>
  list
    .slice(0, limit)
    .map((r) => {
      const arc =
        r.balloons === 0
          ? 'no balloon rescue — the pan climbs straight onto 67'
          : `overshoots to **${TARGET + r.overshoot}** (${r.peakAngle.toFixed(1)}° beam) before ${r.balloons === 1 ? 'a balloon hauls' : `${r.balloons} balloons haul`} it back to 67`
      return `- **Level ${r.global}** — ${r.n} weights, ${r.moves} moves, ${arc}. \`?rec=${r.global}\``
    })
    .join('\n')

const md = `# Cinematic level ranking

<!-- GENERATED by tools/cinematic-levels.ts — run \`npm run capture:levels\`. Do not hand-edit. -->

Every one of the ${TOTAL_LEVELS} levels, scored on how well it films under the capture
director's drama order (heavy weights first, balloons last). See
[\`marketing/TIKTOK_PLAYBOOK.md\`](TIKTOK_PLAYBOOK.md) for what to do with them.

**Columns.** *Moves* = pieces the director actually places (locked ones start aboard).
*Overshoot* = how far past 67 the pan climbs before the balloons rescue it — this is the
drama. *Beam* = peak tilt in degrees (saturates at 13°, so anything past ~+45 overshoot
looks identical). *Off-by* = the closest legal wrong answer, which is what \`mode=fail\`
lands on. *~Clip* = estimated runtime at default pacing.

---

## Use these first

### "Only 1% can solve this" — dense boards
${shortList(impossible, 5)}

### Punchy hooks — max drama in ≤ 4 moves
${shortList(punchy, 5)}

### Rage bait — \`&mode=fail\` lands one off 67
${bait.length ? shortList(bait, 5) : '_No level admits an off-by-one near miss._'}

### ASMR reel — short, balloon-finished, chains cleanly
${shortList(asmr, 5)}

---

## Top 20 overall

${table(byScore, 20)}

---

## All ${TOTAL_LEVELS} levels, by level number

${table(rows)}
`

mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, md)

console.log(`Analysed ${rows.length} levels across ${PACKS.length} packs → ${OUT}`)
console.log(`Top pick: level ${byScore[0].global} (score ${byScore[0].score}, overshoot +${byScore[0].overshoot})`)
