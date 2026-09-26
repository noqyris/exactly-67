# Retention — the 1.3.0 meta-game

Why players come back, and what the game pays them for it. Researched 2026-09-23
(retention mechanics, monetization, local notifications, iPhone Duo, ASO — five
parallel research passes, sources below), then built. The rules are pure and
unit-tested in `src/game` (`days.ts`, `streak.ts`, `economy.ts`, `meta.ts`,
`reminders.ts`); `src/services/progression.ts` applies them; the scenes only draw.

## The decisions, and why

| Decision | Why |
|---|---|
| **Streak on the Daily Challenge** (not on "any play") | The logic-puzzle leaders (NYT Games, Easybrain) all run *daily puzzle + calendar + trophy + streak*. Duolingo's data on streaks is the strongest in the industry: letting one lesson keep the streak gave +3.3% D14; the streak wager +14% D7; a 7-day-streak user is 2.4× as likely to return tomorrow. |
| **Safety nets before they are needed** — 2 freezes max, free on day 3 and every 7th day, 1/day by rewarded ad, or 2 hints; a 2-day repair window once per 30 days | Selling the net at the moment of loss is the pattern that earns 1★ reviews. Duolingo's 2-freeze allowance +0.38% DAU; its weekend amulet +4% week-later return. A frozen day keeps the streak but never adds to it. |
| **Local midnight, not UTC** | UTC put the rollover at 17:00 in Los Angeles — a streak deadline in the middle of an American afternoon. Wordle's model: the same board for the same calendar date everywhere. |
| **Month calendar + tiered trophy** (bronze 10, silver 20, gold every day); past days of the month replayable, counting toward the trophy only | Sudoku.com's month trophy, softened from all-or-nothing, so a missed day is a setback, not a wipe-out. |
| **Star Jar** (20 new stars → 1 hint, or 3 by ad), new installs start at 5/20 | Goal-gradient (people speed up near a reward) and endowed progress (a pre-filled card: 34% completion vs 19%). At ~2.4★/level a jar opens about every 8 levels; the first opens inside the first session. Only NEW stars count — a replay at the same score adds nothing. Existing players start at 0 (no back-dated flood). |
| **Pack medals + a one-time pack bonus** (3 hints, 6 by ad) | A reason to replay for 3★ (more sessions, more interstitial slots) with no new currency. Packs finished before 1.3.0 are marked paid. |
| **Hints stay the only currency — no coins** | One hint type → a coin would only be a hint behind an exchange rate; EU consumer guidance on virtual currencies (2025) argues against adding one; Brain Test thrives on one currency. Stars are the earned, never-lost progress that pays in hints. |
| **No lives, no energy, no timers, no fail states** | There is no failure to price; lives cut sessions (ad revenue scales with minutes played — Block Blast has none); energy is the most disliked F2P mechanic. |
| **Visible daily gift on a five-day ladder** — days in a row pay 1, 2, 4, 6, 8 hints, then it starts over at 1; a day without a claim drops back to day 1. The video adds a flat +2. Replaces 1.2's silent +1 at boot | A claimed reward is a reason to open the app, and a rewarded placement. A flat gift is worth the same whenever it is taken; a climbing one is worth more only if the player comes back *tomorrow* — the login-calendar pattern, with the whole ladder shown up front so the next rung is a known, fixed number (no random boxes). The ad bonus is **flat, never a double**: a doubled day 5 would pay 16 hints for one ad, more than the $0.99 10-pack, and the rewarded faucet must never undercut the packs. A new install's pre-claimed first gift is day 1 (tomorrow pays 2); a 1.2.x upgrade starts the ladder at its first real claim. |
| **First run goes straight into Level 1**, which demos its own first move after the splash; ads (ATT + consent) wait until Level 1 is done | Royal Match's "gameplay within seconds"; ~20% of players drop in the first tutorial. Two native prompts over the first frame is the worst first impression possible. |
| **Local reminders, asked in context** | See `services/notifications.ts`: an inline "Remind me daily" after the first Daily clear (Apple's "ask in context"), never at boot, one a day at the player's habit time, rotating copy, a 30-day taper that ends with "We'll stop the reminders here". Once today's gift is claimed, the next day's reminder names tomorrow's rung on alternate days ("Day 3 gift: 4 hints"), from day 2 up and never for an Unlimited owner; the later lapse rungs never name one — an unclaimed day has reset the ladder by then. |

## Rewarded placements (all capped per local day in `economy.ts`)

| Placement | Where | Free | With ad | Cap/day |
|---|---|---|---|---|
| `hint` | hint modal at 0 hints | — | +1 hint | 6 |
| `gift` | menu, first visit each day | 1 · 2 · 4 · 6 · 8 hints (days in a row) | +2 on any rung | 1 |
| `jar` | win card, jar full | 1 hint | 3 hints | 3 |
| `pack` | win card, pack finished (+ any jar) | 3 (+jar) | 6 (+jar×3) | 3 |
| `milestone` | daily win card, 7/14/30/50/100/200/365 | milestone hints | ×2 | 2 |
| `store` | Store tile | — | +1 hint | 2 |
| `freeze` | Daily screen | (2 hints) | +1 freeze | 1 |
| `repair` | Daily screen, streak broken | (3 hints) | restore | 1 |

All together: **12 a day**. Every button names the ad and the reward (Unity's
rewarded policy). The free amount is always there, the ad is always optional. On
the win card the free amount is paid the moment the level is won — closing the
app on the card loses nothing — and the video adds "+N more" on top. A clear that offers a reward never also
shows an interstitial. Players without ad consent see only the free options.

## What we deliberately did not build

Lives/energy/timers; paid or random rewards (loot boxes, spin wheels); fake
urgency or invented "popular" badges; IAP pop-ups at celebration or stuck
moments (the Welcome pack is shown in the Store, on the Store button and in the
out-of-hints modal only); a win-streak bonus (there is no losing); XP/levels;
server leaderboards; guilt-tripping notifications or more than one a day.

**Game Center** (achievements + a streak/stars leaderboard; the iOS 26 Games app
re-engages even after uninstall) is the next cheap win, but there is no
maintained Capacitor 8 + SPM plugin — it needs a ~100-line local Swift plugin.

## Measuring it

App Store Connect → App Analytics retention (D1/D7/D30) per version; LevelPlay
impressions per DAU and ARPDAU. The plugin passes no placement name, so the
per-placement split is only in the local caps, not the dashboard. If hint-pack
revenue drops after 1.3.0, look at the gift ladder first — a player who comes back
every day now gets 21 free hints per five days (1.2 gave 5): flatten its top rungs
(`GIFT_LADDER`, e.g. 1, 2, 3, 4, 5), then raise `JAR_CAPACITY` to 25–30.

## Sources

Duolingo: [improving the streak](https://blog.duolingo.com/improving-the-streak), [streaks](https://blog.duolingo.com/how-streaks-keep-duolingo-learners-committed-to-their-language-goals/), [KDD 2020 reminders paper](https://research.duolingo.com/papers/yancey.kdd20.pdf), [Lenny's — growth](https://www.lennysnewsletter.com/p/how-duolingo-reignited-user-growth) ·
Goal gradient: [Kivetz 2006](https://home.uchicago.edu/ourminsky/Goal-Gradient_Illusionary_Goal_Progress.pdf) · Endowed progress: [Nunes & Drèze](https://www.researchgate.net/publication/23547282_The_Endowed_Progress_Effect_How_Artificial_Advancement_Increases_Effort) ·
Unity: [top puzzle rewarded placements](https://unity.com/blog/top-5-rewarded-video-placements-to-boost-puzzle-game-revenue), [Rewarded Inventory Policy](https://unity.com/legal/rewarded-inventory-policy) ·
[Sudoku.com challenges](https://sudoku.com/challenges) · [Royal Match (Naavik)](https://naavik.co/digest/royal-match-finding-success-through-iteration/) · [MF2P on energy](https://mobilefreetoplay.com/eliminating-energy/) ·
[Apple: asking permission for notifications](https://developer.apple.com/documentation/usernotifications/asking-permission-to-use-notifications) · [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/) ·
[EU virtual-currency principles](https://www.reedsmith.com/articles/qas-on-the-eu-consumer-protection-authorities-joint-guidance-paper/)
