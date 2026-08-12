/**
 * Dev-only level verifier — runs the REAL solver on candidate level(s) so a
 * redesign can be checked before it ever touches the pack files.
 *
 *   npx vite-node tools/check-level.ts '{"weights":[30,25,-8,20,5]}'
 *   npx vite-node tools/check-level.ts '[{"weights":[...]},{"weights":[...]}]'
 *
 * Prints one JSON line per level with everything a redesign needs:
 *   solvable       — an exact-67 subset exists (build gate requires this)
 *   minWeights     — fewest pieces that hit 67 (drives the 3-star threshold)
 *   pieceCount     — total pieces in the tray
 *   decoys         — pieceCount - minWeights (0 = no choice = a non-puzzle!)
 *   solutionCount  — distinct winning placements (1-2 = elegant; many = mushy)
 *   fullSum        — sum of ALL pieces (== 67 AND decoys 0 => useAll-style bug)
 *   realChoice     — true when the player must actually SELECT a subset
 *   ok             — solvable && realChoice && not useAll (the bar to clear)
 */
import { solveLevel, countSolutions, minimalSolution } from '../src/game/solver'
import type { LevelDef } from '../src/game/types'

const arg = process.argv[2]
if (!arg) {
  console.error("usage: vite-node tools/check-level.ts '<json level or array of levels>'")
  process.exit(1)
}

const parsed = JSON.parse(arg) as LevelDef | LevelDef[]
const levels: LevelDef[] = Array.isArray(parsed) ? parsed : [parsed]

let allOk = true
for (const level of levels) {
  const n = level.weights.length
  const fullSum = level.weights.reduce((a, b) => a + b, 0)
  const { solvable, minWeights } = solveLevel(level)
  const solutionCount = solvable ? countSolutions(level) : 0
  const sol = minimalSolution(level)
  const exampleSolution = sol ? sol.map((i) => level.weights[i]) : null
  const decoys = minWeights === null ? 0 : n - minWeights
  const realChoice = solvable && decoys > 0
  const ok = solvable && realChoice && level.useAll !== true
  if (!ok) allOk = false
  console.log(
    JSON.stringify({
      weights: level.weights,
      pieceCount: n,
      fullSum,
      solvable,
      minWeights,
      decoys,
      solutionCount,
      exampleSolution,
      realChoice,
      ok,
    }),
  )
}
process.exit(allOk ? 0 : 1)
