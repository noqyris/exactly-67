/**
 * Efficiency rating for a cleared level. `used` is how many weights ended
 * up on the pan (locked included); `minWeights` comes from the solver.
 * Hitting the minimum earns 3 stars; close misses still feel rewarded.
 */
export function starsForClear(used: number, minWeights: number): 1 | 2 | 3 {
  if (used <= minWeights) return 3
  if (used <= minWeights + 2) return 2
  return 1
}
