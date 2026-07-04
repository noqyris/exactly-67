import type { LevelPack } from '../types'

/**
 * Pack 2 — Prime Time (global levels 25–48).
 *
 * Theme: 67 is prime, and so is nearly everything in these trays.
 * Sums of odd primes are even, so players constantly need the 2,
 * a balloon, or an odd-sized handful — parity is the hidden puzzle.
 * Signature constraint: piece budgets (maxWeights) that outlaw the
 * obvious many-piece stack and force a bigger rethink.
 */
export const pack2: LevelPack = {
  id: 'pack-2',
  name: 'Prime Time',
  tagline: '67 is prime — build it from its own kind.',
  levels: [
    // 1 — warm-up, two 3-piece routes; 3+31+31 lands on 65 for tension.
    { weights: [3, 5, 31, 31, 59] },

    // 2 — tiny tray, one route (7+13+47); 53+13 = 66 teases.
    { weights: [7, 13, 47, 53] },

    // 3 — overshoot practice: 41+29 = 70, balloon pulls back 3.
    { weights: [17, 29, 41, -3] },

    // 4 — parity lesson: three odd primes can't do it, the 2 can. Min 4.
    { weights: [2, 7, 17, 29, 41] },

    // 5 — BUDGET DEBUT: 3+5+13+17+29 works but is outlawed; find 17+19+31 or 7+29+31.
    {
      weights: [3, 5, 7, 13, 17, 19, 29, 31],
      maxWeights: 3,
      hint: 'Piece budget: only 3 weights fit on the pan.',
    },
    // 6 — overshoot again: 53+31 = 84, pull back 17.
    { weights: [5, 7, 19, 31, 53, -17] },

    // 7 — locked 29: route around it via 61-23 or 43-5. 29+41 = 70 teases.
    { weights: [29, 61, -23, 43, -5, 41], locked: [0] },

    // 8 — useAll breather: every piece, balloons included.
    { weights: [61, 43, -19, -23, 5], useAll: true },

    // 9 — budget 3: big route 47+37-17 or sneaky 37+11+19.
    { weights: [47, 37, -17, 11, 13, 19, 5], maxWeights: 3 },

    // 10 — min 4 with a forced balloon: 2+31+37-3. 41+31-3 = 69 stings.
    { weights: [2, 11, 31, 37, 41, -3, -19] },

    // 11 — min 4, parity again: 2+17+19+29. 17+19+29 = 65, 23+43 = 66.
    { weights: [2, 17, 19, 23, 29, 43, 53, -13] },

    // 12 — budget 3 kills the greedy 2+3+5+7+13+37 stack; 47+13+7 or 37+23+7.
    { weights: [2, 3, 5, 7, 13, 23, 37, 47], maxWeights: 3 },

    // 13 — a LOCKED BALLOON: the pan starts 29 light; 43+53 overshoots into place.
    { weights: [-29, 43, 53, 31, 19, 41, 13], locked: [0] },

    // 14 — budget 4: 2+5+11+31+41-23 fits the sum but not the budget; 2+41+47-23 does.
    { weights: [2, 5, 11, 17, 31, 41, 47, -23], maxWeights: 4 },

    // 15 — composite impostor: 15 looks helpful, lands on 65/68. 53+37-23 wins.
    { weights: [3, 7, 13, 15, 19, 31, 37, 53, -23] },

    // 16 — useAll with double balloon.
    { weights: [2, 13, 41, 59, -19, -29], useAll: true },

    // 17 — budget 4: 3+5+7+23+29 is too many pieces; 61+23-17 or 2+13+23+29.
    { weights: [2, 3, 5, 7, 13, 23, 29, 61, -17], maxWeights: 4 },

    // 18 — two 4-piece routes plus a 5-piece double-balloon flourish (29+37+43-19-23).
    { weights: [2, 5, 11, 17, 29, 37, 43, -19, -23] },

    // 19 — locked 53 AND budget 3: only 19-5 completes it. 53+13 = 66 taunts.
    { weights: [53, 19, 2, 31, -5, 41, 13, 23], locked: [0], maxWeights: 3 },

    // 20 — min 5, double balloon required; 4-piece tries land on 65/66/68.
    { weights: [23, 61, 19, 37, -29, 41, 31, 43, -19, 29] },

    // 21 — five 13s + 2 make 67... but the budget is 5. Spot 41+13+13.
    { weights: [13, 2, 13, 41, 13, 53, 13, -11, 13, 5], maxWeights: 5 },

    // 22 — useAll finale rehearsal: seven pieces, three balloons.
    { weights: [59, 47, 31, -29, -41, 3, -3], useAll: true },

    // 23 — budget 4, one needle in the haystack: 2+37+47-19.
    { weights: [2, 17, 23, 29, 37, 43, 47, 53, -19, -41], maxWeights: 4 },

    // 24 — finale: one solution in 1024 subsets — 29+37+43, then both balloons.
    { weights: [17, 23, 29, 37, 43, 47, 53, 59, -11, -31] },
  ],
}
