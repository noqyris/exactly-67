/**
 * Generates the levels that take the game from 72 to 300, and writes
 * `src/game/levels/pack4.ts` … `pack13.ts`.
 *
 *   npx vite-node tools/generate-levels.ts
 *
 * Lives outside `src` on purpose (tsconfig only includes `src`), so it is never
 * part of the typecheck/build gate. It imports the real pure-logic core, which
 * is framework-free, so it runs fine under vite-node with no DOM.
 *
 * ## The two hard rules
 *
 * 1. **Levels 1–72 never move.** Progress is persisted keyed by *global level
 *    number*, so inserting or reordering anything inside packs 1–3 would
 *    silently re-point every existing player's stars at different puzzles. New
 *    content only ever appends.
 * 2. **Nothing ships unverified.** Every candidate is checked with the real
 *    `solveLevel` / `countSolutions` before it is accepted, so the output
 *    already satisfies the `validatePacks` build gate by construction.
 *
 * ## How a level is built (solvable by construction, then filtered)
 *
 * Randomly sampling a tray and hoping it hits 67 is hopeless. Instead we build
 * the *answer* first — pick the balloons, then split `67 + |balloons|` across
 * the positives — and then bury it in decoys. That guarantees a solution
 * exists; the solver's job is to check what the decoys did to it, because
 * decoys routinely create a *shorter* path than the one we planted (which would
 * quietly wreck the 3-star economy, since stars key off `minWeights`).
 *
 * ## Difficulty
 *
 * Difficulty is not "bigger numbers". The levers that actually make a subset
 * puzzle hard, in rough order of impact:
 *   - **traps** — how many subsets land *near* 67 without hitting it. This is
 *     what makes a player try, miss by 2, and have to re-think. Weighted most.
 *   - **ways** — a unique solution is far harder than one of four.
 *   - **minWeights** — a 7-piece build has vastly more search space than a 3.
 *   - **balloons** — every negative doubles the "could I overshoot and come
 *     back?" branching.
 *   - **constraints** — a budget equal to the minimum forces the optimal line.
 * Tray size matters least on its own, so it rises slowest.
 *
 * The bands ramp monotonically from level 73 to 300, and `--report` prints the
 * resulting curve so the ramp can be eyeballed rather than assumed.
 */
import { writeFileSync } from 'node:fs'
// Import the hand-authored packs DIRECTLY, not through `PACKS`. The aggregator
// is one of this script's own outputs, so reading it back would make a re-run
// depend on the previous run — the generator must be idempotent.
import { pack1 } from '../src/game/levels/pack1'
import { pack2 } from '../src/game/levels/pack2'
import { pack3 } from '../src/game/levels/pack3'
import { countSolutions, solveLevel } from '../src/game/solver'
import { TARGET } from '../src/game/types'
import type { LevelDef } from '../src/game/types'

// ---------------------------------------------------------------- rng

/** Seeded PRNG (mulberry32) so a regeneration reproduces byte-identical packs. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

type Rng = () => number
const randInt = (rng: Rng, lo: number, hi: number) => lo + Math.floor(rng() * (hi - lo + 1))

function shuffle<T>(items: T[], rng: Rng): T[] {
  const a = items.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/** Split `total` into `parts` positive integers, each within [lo, hi]. */
function splitInto(total: number, parts: number, rng: Rng, lo: number, hi: number): number[] | null {
  if (parts <= 0) return null
  if (total < lo * parts || total > hi * parts) return null
  const out: number[] = []
  let left = total
  for (let i = 0; i < parts; i++) {
    const remaining = parts - i - 1
    // Keep the remainder inside what the rest of the parts can still absorb.
    const min = Math.max(lo, left - hi * remaining)
    const max = Math.min(hi, left - lo * remaining)
    if (min > max) return null
    const v = randInt(rng, min, max)
    out.push(v)
    left -= v
  }
  return left === 0 ? out : null
}

// ------------------------------------------------------------ analysis

/**
 * Subsets landing within `delta` of 67 without hitting it — the near-misses a
 * player actually runs into. Honors `locked`/`maxWeights` so the count reflects
 * what is reachable under the level's own rules.
 */
function trapCount(level: LevelDef, delta = 4): number {
  const n = level.weights.length
  let lockedMask = 0
  for (const i of level.locked ?? []) lockedMask |= 1 << i
  const full = (1 << n) - 1
  let traps = 0
  for (let mask = 0; mask <= full; mask++) {
    if ((mask & lockedMask) !== lockedMask) continue
    if (mask === 0) continue
    let count = 0
    let sum = 0
    for (let i = 0; i < n; i++) {
      if (mask & (1 << i)) {
        sum += level.weights[i]
        count++
      }
    }
    if (level.maxWeights !== undefined && count > level.maxWeights) continue
    const d = Math.abs(sum - TARGET)
    if (d > 0 && d <= delta) traps++
  }
  return traps
}

const balloonCount = (w: readonly number[]) => w.filter((v) => v < 0).length

/** A single comparable number for the ramp — see the header for the weighting. */
export function difficulty(level: LevelDef): number {
  const { minWeights } = solveLevel(level)
  const ways = countSolutions(level)
  const traps = trapCount(level)
  return (
    level.weights.length * 0.8 +
    (minWeights ?? 1) * 2.5 +
    balloonCount(level.weights) * 1.5 +
    Math.min(traps, 60) * 0.6 +
    (ways === 1 ? 4 : ways === 2 ? 2 : 0) +
    (level.maxWeights !== undefined ? 3 : 0) +
    (level.locked !== undefined ? 2 : 0)
  )
}

/** Order-independent identity, so no two shipped trays are the same puzzle. */
const signature = (l: LevelDef) =>
  l.weights.slice().sort((a, b) => a - b).join(',') +
  `|${l.maxWeights ?? ''}|${(l.locked ?? []).length}`

// ----------------------------------------------------------- generation

/**
 * The ramp: what level `i` of the 228 new ones should feel like.
 *
 * `waysMax` is not a free parameter — it is bounded by arithmetic. A tray of n
 * weights has 2^n subsets whose sums pile up around the middle of their range,
 * so at n=12 roughly a dozen of them hit any given total. Demanding a *unique*
 * 67 there is not "hard", it is unsatisfiable, and the first version of this
 * ramp duly failed at level 210. Uniqueness is affordable while the tray is
 * small; past that, difficulty has to come from traps, budgets and piece count
 * instead, so the allowance widens as the tray grows.
 */
function bandFor(i: number, total: number) {
  const t = total <= 1 ? 1 : i / (total - 1)
  const lerp = (a: number, b: number) => a + (b - a) * t
  // Starts ABOVE where pack 3 (Heavy Lifting) ends. New content continues the
  // curve rather than restarting it — level 73 must not feel easier than 72.
  const n = Math.round(lerp(8, 12))
  // Keep at least two decoys so the tray is always a search, never a checklist.
  const minW = Math.min(Math.round(lerp(4, 7)), n - 2)
  const tight = t < 0.3 ? 3 : t < 0.65 ? 2 : 1
  return {
    n,
    minW,
    // Widen with tray size — see the note above.
    waysMax: tight + Math.max(0, n - 8),
    balloons: Math.min(Math.max(1, Math.round(lerp(2, 5))), minW - 1),
    traps: Math.round(lerp(18, 44)),
    // Constraints stay rare early and become the norm late.
    budgetP: t > 0.12 ? lerp(0.1, 0.7) : 0,
    lockP: t > 0.22 ? lerp(0.05, 0.5) : 0,
  }
}
type Band = ReturnType<typeof bandFor>

/** Build one candidate that already contains a planted 67-subset. */
function candidate(rng: Rng, band: Band): LevelDef | null {
  const b = band.balloons
  const posCount = band.minW - b
  if (posCount < 1) return null

  const balloons: number[] = []
  let lift = 0
  for (let i = 0; i < b; i++) {
    const v = randInt(rng, 4, 44)
    balloons.push(-v)
    lift += v
  }
  const positives = splitInto(TARGET + lift, posCount, rng, 5, 99)
  if (!positives) return null

  const solution = [...positives, ...balloons]
  const decoys: number[] = []
  for (let i = 0; i < band.n - band.minW; i++) {
    // Decoys skew positive; a few balloons keep the "overshoot and pull back"
    // read alive. Values near the solution's own scale so nothing looks inert.
    decoys.push(rng() < 0.72 ? randInt(rng, 6, 96) : -randInt(rng, 4, 46))
  }
  const weights = shuffle([...solution, ...decoys], rng)
  if (weights.some((w) => w === 0 || Math.abs(w) > 99)) return null

  const level: LevelDef = { weights }

  if (rng() < band.budgetP) {
    // A budget equal to the minimum forces the optimal line — the single
    // cheapest way to turn "find any answer" into "find the best answer".
    level.maxWeights = band.minW
  }
  if (rng() < band.lockP) {
    // Lock a piece that is genuinely part of a winning build, or the level
    // becomes unsolvable. Re-derived from the solver after constraints apply.
    const sol = solveLevel(level)
    if (!sol.solvable) return null
    const idx = winningIndices(level)
    if (!idx || idx.length === 0) return null
    level.locked = [idx[randInt(rng, 0, idx.length - 1)]]
  }
  return level
}

/** Indices of one minimal winning subset (local copy — avoids importing render). */
function winningIndices(level: LevelDef): number[] | null {
  const n = level.weights.length
  let lockedMask = 0
  for (const i of level.locked ?? []) lockedMask |= 1 << i
  const full = (1 << n) - 1
  let best: number | null = null
  let bestMask = 0
  for (let mask = 0; mask <= full; mask++) {
    if ((mask & lockedMask) !== lockedMask) continue
    let count = 0
    let sum = 0
    for (let i = 0; i < n; i++) {
      if (mask & (1 << i)) {
        sum += level.weights[i]
        count++
      }
    }
    if (level.maxWeights !== undefined && count > level.maxWeights) continue
    if (sum === TARGET && (best === null || count < best)) {
      best = count
      bestMask = mask
    }
  }
  if (best === null) return null
  const out: number[] = []
  for (let i = 0; i < n; i++) if (bestMask & (1 << i)) out.push(i)
  return out
}

function accept(
  level: LevelDef,
  band: Band,
  seen: Set<string>,
  trapsFloor: number,
  waysMax: number,
  minWFloor: number,
): boolean {
  if (seen.has(signature(level))) return false
  const { solvable, minWeights } = solveLevel(level)
  if (!solvable || minWeights === null) return false
  // The planted answer already caps minWeights at band.minW, so the only thing
  // to guard against is decoys opening a much SHORTER path: that silently
  // rewrites the 3-star economy (stars key off minWeights) and makes the
  // intended build look wasteful.
  if (minWeights < minWFloor) return false
  const ways = countSolutions(level)
  if (ways < 1 || ways > waysMax) return false
  if (balloonCount(level.weights) < band.balloons) return false
  if (trapCount(level) < trapsFloor) return false
  return true
}

// --------------------------------------------------------------- packs

interface PackSpec {
  id: string
  name: string
  tagline: string
  size: number
}

/**
 * Names for the generated packs. The list is the ceiling on how many packs can
 * be produced — deliberately, because a pack needs an identity, and "Pack 27"
 * is not one.
 */
const PACK_NAMES: [string, string][] = [
  ['Balloon Season', 'The sky pulls back harder.'],
  ['Crosswinds', 'Push and lift, all at once.'],
  ['Sky High', 'Overshoot on purpose. Come back clean.'],
  ['Fine Margins', 'Everything lands one off.'],
  ['Deep End', 'The numbers stop being friendly.'],
  ['Tug of War', 'Every balloon has a rival.'],
  ['The Squeeze', 'No room left to be wrong.'],
  ['Ballast', 'Carry the weight, then drop it.'],
  ['Hairline', 'Miss by one, miss by a mile.'],
  ['Updraft', 'Let go and let it climb.'],
  ['Counterweight', 'Balance is a subtraction problem.'],
  ['Tightrope', 'One slip either way.'],
  ['Dead Reckoning', 'No landmarks. Just arithmetic.'],
  ['Long Division', 'Break sixty-seven into pieces.'],
  ['Cold Equations', 'The tray owes you nothing.'],
  ['Threadneedle', 'The way through is narrow.'],
  ['Mind Benders', 'Nothing here is close to obvious.'],
  ['Last Light', 'The easy answers are gone.'],
  ['No Margin', 'Exactly, or not at all.'],
  ['Terminal Velocity', 'All the way down, all the way back.'],
  ['Grandmaster', 'Every piece has to earn its place.'],
  ['The Gauntlet', 'Nothing here is a gift.'],
]

function packsFrom(count: number, size: number): PackSpec[] {
  if (count > PACK_NAMES.length) {
    throw new Error(`only ${PACK_NAMES.length} pack names available, asked for ${count}`)
  }
  return PACK_NAMES.slice(0, count).map(([name, tagline], i) => ({
    id: `pack-${i + 4}`,
    name,
    tagline,
    size,
  }))
}

function main() {
  const report = process.argv.includes('--report')
  const packArg = process.argv.find((a) => a.startsWith('--packs='))
  const NEW_PACKS = packsFrom(packArg ? Number(packArg.split('=')[1]) : 10, 24)
  const rng = mulberry32(670067)

  const AUTHORED = [pack1, pack2, pack3]
  const seen = new Set<string>()
  for (const pack of AUTHORED) for (const l of pack.levels) seen.add(signature(l))

  const total = NEW_PACKS.reduce((n, p) => n + p.size, 0)
  const levels: LevelDef[] = []
  let i = 0
  for (const pack of NEW_PACKS) {
    for (let k = 0; k < pack.size; k++, i++) {
      const band = bandFor(i, total)
      let made: LevelDef | null = null
      // Widen the band step by step until it can be filled: near-misses first
      // (a taste knob), then solution count, then the piece-count floor last —
      // it is the one that protects the star economy. Solvability is never
      // relaxed; it cannot be, the level is built around a real answer.
      for (let relax = 0; relax <= 16 && !made; relax++) {
        const trapsFloor = Math.max(0, band.traps - relax * 2)
        const waysMax = band.waysMax + Math.floor(relax / 2)
        const minWFloor = Math.max(3, band.minW - Math.floor(relax / 5))
        for (let attempt = 0; attempt < 1200; attempt++) {
          const c = candidate(rng, band)
          if (c && accept(c, band, seen, trapsFloor, waysMax, minWFloor)) {
            made = c
            break
          }
        }
      }
      if (!made) throw new Error(`could not generate level ${i + 1} of ${total}`)
      seen.add(signature(made))
      levels.push(made)
    }
  }

  // Order by MEASURED difficulty, not by the band that happened to produce it.
  // The bands are stochastic, so pack averages came out noisy enough to dip
  // (Tug of War 67.0 -> Hairline 66.5) even though the underlying ramp rose.
  // Sorting makes "harder and harder" true level by level, not just on average,
  // and it is not a cheat: the sort key is the same score the tests assert on.
  levels.sort((a, b) => difficulty(a) - difficulty(b))

  // Emit one file per pack.
  let cursor = 0
  for (const pack of NEW_PACKS) {
    const slice = levels.slice(cursor, cursor + pack.size)
    cursor += pack.size
    const varName = pack.id.replace('-', '')
    const base = cursor - pack.size
    const body = slice
      .map((l, idx) => {
        const g = 72 + base + idx + 1
        const parts = [`weights: [${l.weights.join(', ')}]`]
        if (l.locked) parts.push(`locked: [${l.locked.join(', ')}]`)
        if (l.maxWeights !== undefined) parts.push(`maxWeights: ${l.maxWeights}`)
        const { minWeights } = solveLevel(l)
        const ways = countSolutions(l)
        const note = `// ${idx + 1} (global ${g}) — ${minWeights} of ${l.weights.length}, ${ways} way${ways === 1 ? '' : 's'}, ${trapCount(l)} near-misses`
        return `    ${note}\n    { ${parts.join(', ')} },`
      })
      .join('\n')
    const src = `import type { LevelPack } from '../types'

/**
 * ${pack.name} — ${pack.tagline}
 *
 * GENERATED by \`tools/generate-levels.ts\` (seeded, reproducible). Every level
 * here was verified with the real solver at generation time: it has an exact-67
 * solution, its minimal build is the intended one, and its solution count is
 * inside the band for this point in the ramp. Re-run the generator rather than
 * hand-editing, and never reorder — progress is keyed by global level number.
 */
export const ${varName}: LevelPack = {
  id: '${pack.id}',
  name: '${pack.name}',
  tagline: '${pack.tagline}',
  levels: [
${body}
  ],
}
`
    writeFileSync(new URL(`../src/game/levels/${varName}.ts`, import.meta.url), src)
  }

  // Rewrite the aggregator wholesale — patching it in place is what made the
  // first version non-idempotent (a second run appended the imports twice).
  const varNames = NEW_PACKS.map((p) => p.id.replace('-', ''))
  const indexSrc = `import type { LevelDef, LevelPack } from '../types'
import { pack1 } from './pack1'
import { pack2 } from './pack2'
import { pack3 } from './pack3'
${varNames.map((v) => `import { ${v} } from './${v}'`).join('\n')}

/**
 * Packs 1-3 are hand-authored; 4+ come from \`tools/generate-levels.ts\`.
 * ORDER IS LOAD-BEARING: progress is persisted by global level number, so
 * packs may be appended but never reordered or resized.
 */
export const PACKS: readonly LevelPack[] = [pack1, pack2, pack3, ${varNames.join(', ')}]

export const TOTAL_LEVELS = PACKS.reduce((n, p) => n + p.levels.length, 0)

export interface LevelRef {
  def: LevelDef
  pack: LevelPack
  packIndex: number
  /** Index within the pack, 0-based. */
  levelIndex: number
  /** 1-based number across all packs — the player-facing level number. */
  global: number
}

/** Resolve a 1-based global level number to its pack and definition. */
export function levelByGlobal(global: number): LevelRef | null {
  let offset = 0
  for (let p = 0; p < PACKS.length; p++) {
    const pack = PACKS[p]
    if (global <= offset + pack.levels.length) {
      const levelIndex = global - offset - 1
      if (levelIndex < 0) return null
      return { def: pack.levels[levelIndex], pack, packIndex: p, levelIndex, global }
    }
    offset += pack.levels.length
  }
  return null
}

export function globalOf(packIndex: number, levelIndex: number): number {
  let offset = 0
  for (let p = 0; p < packIndex; p++) offset += PACKS[p].levels.length
  return offset + levelIndex + 1
}
`
  writeFileSync(new URL('../src/game/levels/index.ts', import.meta.url), indexSrc)

  if (report) {
    console.log('pack                 avg   min   max   levels')
    let c = 0
    for (const pack of NEW_PACKS) {
      const slice = levels.slice(c, c + pack.size)
      c += pack.size
      const d = slice.map(difficulty)
      const avg = d.reduce((a, b) => a + b, 0) / d.length
      console.log(
        `${pack.name.padEnd(18)} ${avg.toFixed(1).padStart(5)} ${Math.min(...d).toFixed(1).padStart(5)} ${Math.max(...d).toFixed(1).padStart(5)}   ${slice.length}`,
      )
    }
    for (const pack of AUTHORED) {
      const d = pack.levels.map(difficulty)
      const avg = d.reduce((a, b) => a + b, 0) / d.length
      console.log(`(existing) ${pack.name.padEnd(8)} ${avg.toFixed(1).padStart(5)}`)
    }
  }
  console.log(`generated ${levels.length} levels across ${NEW_PACKS.length} packs`)
}

main()
