import type { LevelPack } from '../types'

export const pack1: LevelPack = {
  id: 'pack-1',
  name: 'Warm-Up',
  tagline: 'Learn the ropes — and the balloons.',
  levels: [
    // 1 — tutorial: one drag, one win.
    { weights: [67], hint: 'Drag weights onto the right pan to match 67.' },
    // 2 — two weights stack up.
    { weights: [40, 27] },
    // 3 — first choice: 30+37 works, 30+35 lands on 65.
    { weights: [30, 37, 35] },
    // 4 — two paths: 12+55 or 40+12+15. 55+15 overshoots to 70.
    { weights: [12, 55, 40, 15] },
    // 5 — unique triple 20+22+25; 44 baits 64/66/68/69 near-misses.
    { weights: [20, 22, 25, 44, 4] },
    // 6 — BALLOON INTRO: 72 is locked and tips the beam; only the balloon saves it.
    { weights: [72, -5], locked: [0], hint: 'Balloons pull the pan UP. 72 − 5 = 67.' },
    // 7 — free balloon play: 70−3, or 45+25−3.
    { weights: [70, -3, 45, 25] },
    // 8 — signature move: overshoot to 80, pull back 13. 50+18 teases 68.
    { weights: [50, 30, -13, 18] },
    // 9 — big overshoot: 95−28. 40+25 stalls at 65.
    { weights: [95, -28, 40, 25, -8] },
    // 10 — 24+55−12; 55+9=64 and 24+33+9=66 sting.
    { weights: [24, 55, -12, 33, 9] },
    // 11 — USE-ALL DEBUT: everything on the pan sums to 67.
    { weights: [30, 25, -8, 20], useAll: true, hint: 'New rule: every weight must end up on the pan.' },
    // 12 — 34+45−12; 45+23=68 and 34+23+8=65 are traps.
    { weights: [34, 45, -12, 23, 19, 8] },
    // 13 — twin paths: 90−14−9 or 31+22+14.
    { weights: [90, -14, -9, 31, 22, 14] },
    // 14 — BUDGET DEBUT: 40+20+7 fits the math but not the budget; 80−13 does both.
    { weights: [80, -13, 40, 20, 7], maxWeights: 2, hint: 'Piece budget: at most 2 weights fit on the pan.' },
    // 15 — four-piece build; 26+42=68, 31+42−8=65, 18+42+9=69 all miss.
    { weights: [26, 31, 18, -8, 42, 15, 9] },
    // 16 — 48+30−11, or double-balloon 48+45−15−11. 48+21=69, 45+21=66.
    { weights: [48, 45, -15, -11, 30, 21] },
    // 17 — use-all with two balloons: 107 down, 40 of lift.
    { weights: [25, 34, -18, 40, -22, 8], useAll: true },
    // 18 — LOCKED DEBUT: a stuck balloon lifts −20; build 87 of down-weight.
    {
      weights: [-20, 52, 35, 18, 29, 33],
      locked: [0],
      hint: 'The gray weight is stuck on the pan — build around it.',
    },
    // 19 — budget 3: 74−7 in two, or 30+25+12 right at the cap. 25+41=66.
    { weights: [74, -7, 30, 25, 12, 41], maxWeights: 3 },
    // 20 — eight-weight spread; 46+22=68, 29+45−9=65, 23+27+16=66 near-misses.
    { weights: [23, 29, 27, -12, 45, 16, -9, 35] },
    // 21 — locked 58: 58+34−25 lands it; 58+19−11=66 and 58+16+19−25=68 taunt.
    { weights: [58, 34, -25, 19, -11, 42, 16], locked: [0] },
    // 22 — use-all finale rehearsal: 133 of iron, 66 of lift.
    { weights: [21, 39, -16, 28, -24, 45, -26], useAll: true },
    // 23 — budget 3 crunch: 40+26=66 and 12+54=66 both die at the cap; 85−30+12 wins.
    { weights: [85, -30, 12, 40, 26, 54, -21], maxWeights: 3 },
    // 24 — finale: five pieces (31+28+24−19+3); 46+22=68, 31+28+24−19=64, 46+28−8=66.
    { weights: [31, 28, 24, -19, 3, 46, 22, -8] },
  ],
}
