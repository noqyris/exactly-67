import { PACKS, TOTAL_LEVELS, levelByGlobal } from '../../src/game/levels'
import { TARGET } from '../../src/game/types'
import type { LevelDef } from '../../src/game/types'

function popcount(m: number) { let n = 0; while (m) { m &= m - 1; n++ } return n }

function analyze(level: LevelDef) {
  const n = level.weights.length
  let lockedMask = 0
  for (const i of level.locked ?? []) lockedMask |= 1 << i
  const full = (1 << n) - 1
  const sols: number[] = []
  const decoys: number[] = []   // sums to 67 but rejected by useAll
  for (let mask = 0; mask <= full; mask++) {
    if ((mask & lockedMask) !== lockedMask) continue
    let sum = 0
    for (let i = 0; i < n; i++) if (mask & (1 << i)) sum += level.weights[i]
    if (sum !== TARGET) continue
    const count = popcount(mask)
    const budgetOk = level.maxWeights === undefined || count <= level.maxWeights
    const useAllOk = !level.useAll || mask === full
    if (budgetOk && useAllOk) sols.push(mask)
    else if (budgetOk && !useAllOk) decoys.push(mask)
  }
  const min = sols.length ? Math.min(...sols.map(popcount)) : null
  const minSols = sols.filter((m) => popcount(m) === min)
  return { n, sols, decoys, min, minCount: minSols.length, minSols }
}

let oneSol = 0, multiMin = 0
const rows: string[] = []
const decoyLevels: string[] = []
for (let g = 1; g <= TOTAL_LEVELS; g++) {
  const ref = levelByGlobal(g)!
  const a = analyze(ref.def)
  if (a.sols.length === 1) oneSol++
  if (a.minCount > 1) multiMin++
  rows.push(`L${g}\tn=${a.n}\tsols=${a.sols.length}\tmin=${a.min}\tminSols=${a.minCount}\tdecoys=${a.decoys.length}\tuseAll=${!!ref.def.useAll}\tmax=${ref.def.maxWeights ?? '-'}\tw=[${ref.def.weights.join(',')}]`)
  if (a.decoys.length) decoyLevels.push(`L${g} decoys=${a.decoys.length} weights=[${ref.def.weights.join(',')}] useAll=${!!ref.def.useAll}`)
}
console.log(rows.join('\n'))
console.log('\n=== SUMMARY ===')
console.log('total levels', TOTAL_LEVELS)
console.log('levels with exactly ONE valid solution:', oneSol)
console.log('levels with >1 MINIMAL solution:', multiMin)
console.log('\n=== DECOY (sums to 67 but blocked) ===')
console.log(decoyLevels.join('\n'))
