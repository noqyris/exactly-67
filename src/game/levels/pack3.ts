import type { LevelPack } from '../types'

/**
 * Pack 3 — Heavy Lifting (global levels 49–72, the endgame).
 *
 * Theme: big numbers and heavy constraints. Down-weights run 40–99, so
 * almost any two overshoot — the signature overshoot-then-balloon move is
 * required nearly everywhere. Ten levels start with locked weights (the pan
 * begins wrong and must be rescued), five useAll levels cancel a whole tray
 * to exactly 67, and six tight piece budgets outlaw the easy stacks. The
 * final stretch (69–72) is the hardest in the game: 10–12 weights, dozens
 * of near-misses, and a single path through. No hints — you know the ropes.
 */
export const pack3: LevelPack = {
  id: 'pack-3',
  name: 'Heavy Lifting',
  tagline: 'Massive weights, deep overshoots.',
  levels: [
    // 49 — big numbers arrive: 90−23 or 55+12; the 56 baits 56+12=68.
    { weights: [90, 56, 55, -23, 12] },
    // 50 — every down-weight is huge; 80−13 or 72−5, while 74−5=69 stings.
    { weights: [80, 72, 74, 48, -13, -5] },
    // 51 — the pan starts overshot at 88: 88−21, or 88−15−6. All five = 68.
    { weights: [88, -21, -15, 22, -6], locked: [0] },
    // 52 — use-all: the whole tray cancels to exactly 67
    { weights: [95, 60, -44, -30, -14], useAll: true },
    // 53 — only two pieces allowed; 45+24 lands on a cruel 69
    { weights: [90, 82, 45, 24, -23, -15], maxWeights: 2 },
    // 54 — a balloon is stuck on the pan: −25+92=67, but −25+93=68 taunts
    { weights: [-25, 92, 93, 48, 44, -8], locked: [0] },
    // 55 — use-all: three downs, three balloons, perfect cancellation
    { weights: [50, 45, 38, -26, -19, -21], useAll: true },
    // 56 — double-balloon signature: 68+48, then −26−23. Bare 65 and 68 tease.
    { weights: [68, 65, 49, 48, -26, -25, -23] },
    // 57 — locked 96, three balloons: −29 lands it, −28 gives 68, −31 gives 65
    { weights: [52, 44, -28, -31, -29, 29, 28], locked: [0, 1] },
    // 58 — use-all: seven pieces net to 67
    { weights: [72, 66, 45, -39, -28, -31, -18], useAll: true },
    // 59 — three-piece budget with 66 and 68 traps
    { weights: [51, 46, 42, 39, -22, -26, -14], maxWeights: 3 },
    // 60 — the 99 is locked; shed exactly 32
    { weights: [99, -19, -13, -25, 41, -7, 30], locked: [0] },
    // 61 — four-piece budget, two downs + two balloons required
    { weights: [70, 63, 57, 46, -34, -25, -19, -11], maxWeights: 4 },
    // 62 — locked pair overshoots to 126; find the 59 of lift
    { weights: [85, 41, -31, -28, -24, -17, 22, 13], locked: [0, 1] },
    // 63 — use-all: eight pieces, 211 down vs 144 up
    { weights: [61, 54, 49, 47, -42, -35, -38, -29], useAll: true },
    // 64 — locked 96 plus a three-piece cap; -31 and -28 are lies
    { weights: [96, -31, -16, -13, 24, -28, 33, -20], locked: [0], maxWeights: 3 },
    // 65 — use-all: nine pieces in perfect balance
    { weights: [58, 52, 47, 44, 41, -40, -37, -33, -65], useAll: true },
    // 66 — a -48 balloon is locked on; climb 115 back up
    { weights: [-48, 62, 53, 46, -19, 71, 38, -26, 15], locked: [0] },
    // 67 — four-piece budget over nine weights, near-misses everywhere
    { weights: [88, 76, 59, 46, 33, -41, -37, -27, -16], maxWeights: 4 },
    // 68 — locked 78+64=142; exactly two balloons undo the damage
    { weights: [78, 64, -44, -31, -38, -26, -19, 27, 12, 9], locked: [0, 1] },
    // 69 — endgame: ten weights, four-piece cap, one path through
    { weights: [92, 81, 74, 66, 57, 49, -43, -35, -29, -18], maxWeights: 4 },
    // 70 — locked 91: one five-piece rescue in 1024 tries, 42 near-misses
    { weights: [91, 48, 38, 27, 23, -38, -31, -28, -21, -17, -14], locked: [0] },
    // 71 — twelve free weights, one needle in 4096 haystacks
    { weights: [90, 77, 72, 65, 53, 49, -41, -40, -28, -25, -21, -12] },
    // 72 — finale: locked 95+86=181, six pieces to perfection, one way only
    { weights: [95, 86, 16, 9, -44, -40, -29, -28, -25, -19, -16, -12], locked: [0, 1] },
  ],
}
