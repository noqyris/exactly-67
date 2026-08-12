import { TARGET } from '../../src/game/types'
import type { LevelDef } from '../../src/game/types'

// mulberry32 — 12 lines, deterministic, no deps
function rng(seed: number) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
function seedFromDate(d: string) { let h = 2166136261; for (const c of d) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619) } return h >>> 0 }
function popcount(m: number) { let n = 0; while (m) { m &= m - 1; n++ } return n }

function analyze(weights: number[], maxWeights?: number) {
  const n = weights.length, full = (1 << n) - 1
  const sols: number[] = []
  for (let mask = 0; mask <= full; mask++) {
    const c = popcount(mask)
    if (maxWeights !== undefined && c > maxWeights) continue
    let s = 0
    for (let i = 0; i < n; i++) if (mask & (1 << i)) s += weights[i]
    if (s === TARGET) sols.push(mask)
  }
  const min = sols.length ? Math.min(...sols.map(popcount)) : null
  return { sols, min, minCount: sols.filter(m => popcount(m) === min).length }
}

// Generate: pick a hidden solution first (guarantees solvability), then decoys.
function generate(date: string) {
  const r = rng(seedFromDate(date))
  const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)]
  for (let attempt = 0; attempt < 4000; attempt++) {
    const solSize = pick([3, 4, 4, 5])
    const nBalloons = pick([1, 1, 2])
    const sol: number[] = []
    // balloons in the solution
    for (let i = 0; i < nBalloons; i++) sol.push(-(5 + Math.floor(r() * 40)))
    // positives to make it total 67
    const rest = solSize - nBalloons
    let remaining = TARGET - sol.reduce((a, b) => a + b, 0)
    let ok = true
    for (let i = 0; i < rest - 1; i++) {
      const maxTake = remaining - (rest - 1 - i) * 2
      if (maxTake < 2) { ok = false; break }
      const v = 2 + Math.floor(r() * Math.min(maxTake - 1, 95))
      sol.push(v); remaining -= v
    }
    if (!ok || remaining < 2 || remaining > 99) continue
    sol.push(remaining)
    // decoys
    const n = solSize + pick([3, 4, 4, 5])
    const weights = sol.slice()
    while (weights.length < n) {
      const v = r() < 0.35 ? -(5 + Math.floor(r() * 45)) : 2 + Math.floor(r() * 95)
      if (v !== 0 && Math.abs(v) <= 99) weights.push(v)
    }
    // shuffle
    for (let i = weights.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [weights[i], weights[j]] = [weights[j], weights[i]] }
    const a = analyze(weights)
    // Quality band: solvable, minimum in 3..5, and NOT trivially many solutions
    if (a.min === null) continue
    if (a.min < 3 || a.min > 5) continue
    if (a.sols.length > 8) continue
    if (a.minCount < 2 || a.minCount > 4) continue
    const peak = weights.filter(w => w > 0).reduce((x, y) => x + y, 0)
    return { weights, min: a.min, sols: a.sols.length, minCount: a.minCount, attempt, peak }
  }
  return null
}

let fails = 0; const attempts: number[] = []
const rows: string[] = []
for (let day = 0; day < 40; day++) {
  const d = new Date(Date.UTC(2026, 6, 28 + day)).toISOString().slice(0, 10)
  const g = generate(d)
  if (!g) { fails++; rows.push(`${d}  FAILED`); continue }
  attempts.push(g.attempt)
  rows.push(`${d}  n=${String(g.weights.length).padStart(2)} min=${g.min} sols=${g.sols} minSols=${g.minCount} tries=${String(g.attempt).padStart(4)}  [${g.weights.join(', ')}]`)
}
console.log(rows.join('\n'))
console.log(`\nfailures: ${fails}/40   median tries: ${attempts.sort((a,b)=>a-b)[Math.floor(attempts.length/2)]}   max tries: ${Math.max(...attempts)}`)
const t0 = Date.now(); for (let i = 0; i < 200; i++) generate('2026-0' + (i % 9 + 1) + '-1' + (i % 9)); 
console.log(`200 generations in ${Date.now() - t0}ms`)
