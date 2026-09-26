import { addDays, monthOf } from '../game/days'
import {
  fillJar,
  giftAvailable,
  giftDayAfter,
  giftHintsFor,
  giftStreakAfterClaim,
  JAR_START_NEW,
  monthProgress,
  NEW_INSTALL_HINTS,
  noAdsNudgeDue,
  packMedal,
  welcomeEligible,
  type Medal,
} from '../game/economy'
import { levelByGlobal, PACKS, TOTAL_LEVELS } from '../game/levels'
import { addDailySolved, giftAlreadyPaid, migrateMeta, withTrophy } from '../game/meta'
import { isCleared, rangeStats, starsFor, totalStars } from '../game/progress'
import {
  addFreeze,
  canEarnFreezeByAd,
  canRepair,
  FREEZE_HINT_COST,
  reconcile,
  recordSolve,
  reopenDay,
  repair,
  REPAIR_HINT_COST,
  solvedToday,
  type MilestoneReward,
  type ReconcileEvent,
  type Streak,
} from '../game/streak'
import { adsRemoved, grantHints, hintCountValue, hintsUnlimited, interstitialsPossible, spendHints } from './ads'
import { initMeta, meta, metaExisted, today, updateMeta } from './metaStore'
import { setReminderContext } from './notifications'
import { progress, recordClear } from './progressStore'
import { loadDailyDone, loadFreeHintDate } from './storage'

/**
 * The meta-game, wired: streak, Daily Challenge calendar, Star Jar, pack
 * rewards, the daily gift and the offer history. The RULES are pure and live in
 * src/game (streak.ts, economy.ts, meta.ts); this module only applies them to
 * the persisted state (metaStore) and pays hints into the one stash (ads.ts).
 *
 * Every reward is paid in hints and every "watch an ad" is an upgrade on top of
 * a free base reward, never a toll: the win card pays the free amount the moment
 * the level is won, and a video only adds on top. See docs/RETENTION.md.
 */

let freshInstall = false
/** What reconciling the streak did at boot/foreground, until a screen shows it. */
let streakNotice: ReconcileEvent | null = null
let reconciledOn = ''

/** First index of each pack in global numbering. */
const PACK_FIRST: readonly number[] = (() => {
  const firsts: number[] = []
  let g = 1
  for (const pack of PACKS) {
    firsts.push(g)
    g += pack.levels.length
  }
  return firsts
})()

/**
 * Load the meta blob and bring it up to today. Call once at boot, after
 * initProgress() and initHintState() (it reads both). Returns whether this is a
 * brand-new install — the first run goes straight into Level 1.
 */
export async function initProgression(): Promise<{ freshInstall: boolean }> {
  await initMeta()
  const day = today()
  if (!metaExisted()) {
    const [dailyDone, freeDate] = await Promise.all([loadDailyDone(), loadFreeHintDate()])
    freshInstall = totalStars(progress()) === 0 && !dailyDone && !freeDate && hintCountValue() === 0
    if (freshInstall) {
      // The first day's gift, pre-claimed: a few hints to learn the 💡 with, and
      // a jar that opens inside the first session (endowed progress). It is day 1
      // of the gift ladder, so tomorrow's gift is already day 2.
      grantHints(NEW_INSTALL_HINTS)
      updateMeta((m) => ({ ...m, jar: { stars: JAR_START_NEW }, giftDay: day, giftStreak: 1 }))
    } else {
      // An upgrade from 1.2.x. Its silent daily hint may already have been paid
      // today (stored as a UTC date then) — never pay the gift twice.
      const now = new Date()
      const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate())
      const paid = giftAlreadyPaid(freeDate, midnight.toISOString().slice(0, 10), now.toISOString().slice(0, 10))
      const giftDay = paid ? day : null
      // Packs already finished before rewards existed are marked paid, so a
      // replay does not pour a back-dated pack bonus on top of the player.
      const packRewards = PACKS.map((_, i) => i).filter((i) => packComplete(i))
      // The ladder starts at 0: a silent 1.2.x hint was no rung of it, so the
      // first gift the player actually takes is day 1.
      updateMeta((m) => ({ ...migrateMeta(m, dailyDone, day), giftDay, giftStreak: 0, packRewards }))
    }
  }
  updateMeta((m) => ({ ...m, offers: { ...m.offers, sessions: m.offers.sessions + 1 } }))
  refreshDay()
  return { freshInstall }
}

/** True until a brand-new install has cleared Level 1. */
export function isFirstRun(): boolean {
  return freshInstall && starsFor(progress(), 1) === 0
}

/**
 * Re-apply the day rules if the local day changed (a return to the foreground
 * after midnight): spend freezes on missed days, or break the streak.
 */
export function refreshDay(): void {
  const day = today()
  if (reconciledOn === day) return
  reconciledOn = day
  let event: ReconcileEvent = { kind: 'none' }
  updateMeta((m) => {
    const r = reconcile(m.streak, day)
    event = r.event
    return r.event.kind === 'none' && r.streak.lost === m.streak.lost ? m : { ...m, streak: r.streak }
  })
  if (event.kind !== 'none') streakNotice = event
}

/** The streak as of today (reconciled). */
export function streak(): Streak {
  refreshDay()
  return meta().streak
}

/**
 * The streak cannot break today: today's puzzle is solved, or — once, on the
 * day a 1.2.x player in the Americas upgrades — the board they solved last night
 * was keyed to tomorrow's UTC date. Copy asking the player to "keep" it would be false.
 */
export function streakSafeToday(): boolean {
  const s = streak()
  return s.current > 0 && s.lastDay !== null && s.lastDay >= today()
}

export function dailyDoneToday(): boolean {
  return solvedToday(streak(), today()) || meta().daily.includes(today())
}

/** A freeze was spent or the streak broke since the player last looked — once. */
export function takeStreakNotice(): ReconcileEvent | null {
  const n = streakNotice
  streakNotice = null
  return n
}

export function dailySolvedOn(day: string): boolean {
  return meta().daily.includes(day)
}

export function monthInfo(month: string = monthOf(today())) {
  return { ...monthProgress(meta().daily, month), trophy: meta().trophies[month] ?? null }
}

export interface DailyWin {
  /** Counted toward the streak (today's board, first solve today). */
  counted: boolean
  streak: number
  milestone: MilestoneReward | null
  /** A monthly trophy tier reached by this solve, if any. */
  trophy: Medal | null
  month: ReturnType<typeof monthInfo>
}

/**
 * A Daily Challenge solved. `day` is the board's date: today's counts toward the
 * streak; an earlier day of this month (replayed from the calendar) only toward
 * the monthly trophy. Milestone HINTS are the caller's to grant (so it can offer
 * "watch an ad to double"); milestone freezes are applied here.
 */
export function recordDailyWin(day: string, openedAsToday = false): DailyWin {
  const now = today()
  const month = monthOf(day)
  const trophyBefore = meta().trophies[month] ?? null
  // The streak counts today's board — and yesterday's when it was opened as
  // "today's puzzle" before midnight and solved after it (23:58 → 00:01), so a
  // late-evening solve is never ticked on the calendar yet counted as missed.
  const streakDay = day === now ? now : openedAsToday && day === addDays(now, -1) ? day : null
  let counted = false
  let milestone: MilestoneReward | null = null
  // Asserted, not annotated: set inside the updater, which narrowing can't see.
  let undone = 'none' as ReconcileEvent['kind']
  updateMeta((m) => {
    let next = addDailySolved(m, day, now)
    if (streakDay) {
      let s = next.streak
      if (streakDay !== now) {
        // The grace solve: if the app came back to the foreground after midnight
        // while this board was open, refreshDay() already counted its day as
        // missed (broke the streak, or spent a freeze on it). Take that back.
        const reopened = reopenDay(s, streakDay, m.daily.includes(streakDay))
        s = reopened.streak
        undone = reopened.undone
      }
      const r = recordSolve(reconcile(s, streakDay).streak, streakDay)
      counted = r.counted
      milestone = r.milestone
      next = { ...next, streak: r.streak }
    }
    return withTrophy(next, month, monthProgress(next.daily, month).tier)
  })
  // …and never tell the menu about a break or a freeze that no longer happened.
  // A notice spanning more frozen days keeps the rest.
  const notice = streakNotice
  if (undone === 'broken' && notice?.kind === 'broken') streakNotice = null
  if (undone === 'frozen' && notice?.kind === 'frozen') {
    streakNotice = notice.days > 1 ? { kind: 'frozen', days: notice.days - 1 } : null
  }
  const trophyAfter = meta().trophies[month] ?? null
  syncReminders()
  return {
    counted,
    streak: meta().streak.current,
    milestone,
    trophy: trophyAfter !== trophyBefore ? trophyAfter : null,
    month: monthInfo(month),
  }
}

export interface LevelWin {
  /** Stars gained over the level's previous best (what goes into the jar). */
  gained: number
  jarBefore: number
  jarAfter: number
  /** Jars filled by this clear (their hints are the caller's to grant). */
  opened: number
  /** Set when this clear completed a pack for the first time. */
  pack: { index: number; name: string; medal: Medal | null; reward: boolean } | null
  /** The pack's medal improved (e.g. silver → gold) on a replay. */
  medalUp: Medal | null
}

function packComplete(index: number): boolean {
  const pack = PACKS[index]
  return rangeStats(progress(), PACK_FIRST[index], pack.levels.length).cleared === pack.levels.length
}

/** A pack's stars, clears and medal right now. */
export function packInfo(index: number): { stars: number; cleared: number; levels: number; medal: Medal | null } {
  const levels = PACKS[index].levels.length
  const { stars, cleared } = rangeStats(progress(), PACK_FIRST[index], levels)
  return { stars, cleared, levels, medal: packMedal(stars, cleared, levels) }
}

/**
 * Record a level clear (progress + Star Jar + pack completion). Replaces the
 * bare recordClear() in the win sequence.
 */
export function recordLevelWin(global: number, stars: number, used: number): LevelWin {
  const ref = levelByGlobal(global)
  const before = starsFor(progress(), global)
  const medalBefore = ref ? packInfo(ref.packIndex).medal : null
  recordClear(global, stars, used)
  const gained = Math.max(0, stars - before)
  const jarBefore = meta().jar.stars
  let opened = 0
  // Unlimited owners have nothing to gain from hints: no jar for them.
  if (!hintsUnlimited() && gained > 0) {
    const r = fillJar(meta().jar, gained)
    opened = r.opened
    updateMeta((m) => ({ ...m, jar: r.jar }))
  }
  let pack: LevelWin['pack'] = null
  let medalUp: Medal | null = null
  if (ref) {
    const info = packInfo(ref.packIndex)
    if (info.cleared === info.levels && !meta().packRewards.includes(ref.packIndex)) {
      updateMeta((m) => ({ ...m, packRewards: [...m.packRewards, ref.packIndex] }))
      pack = { index: ref.packIndex, name: ref.pack.name, medal: info.medal, reward: !hintsUnlimited() }
    } else if (info.medal && info.medal !== medalBefore) {
      medalUp = info.medal
    }
  }
  return { gained, jarBefore, jarAfter: meta().jar.stars, opened, pack, medalUp }
}

export function jarStars(): number {
  return meta().jar.stars
}

/** Pay hints into the stash (a claimed reward). */
export function claimHints(n: number): void {
  grantHints(n)
}

// --- daily gift ---------------------------------------------------------------------

export function giftDue(): boolean {
  if (hintsUnlimited()) return false
  return giftAvailable(meta().giftDay, today())
}

export interface GiftRung {
  /** Ladder day, 1–5. */
  day: number
  /** Free hints on that day (the video adds GIFT_AD_BONUS on top). */
  hints: number
}

/**
 * The gift ladder as of today: today's rung (still to take, or taken) and
 * `next`, the rung tomorrow pays once today's is claimed — what the gift card
 * promises ("come back tomorrow for N") the moment either button takes it.
 */
export function giftInfo(): GiftRung & { next: GiftRung } {
  const m = meta()
  const day = today()
  const rung = giftDayAfter(m.giftDay, m.giftStreak, day)
  const after = giftStreakAfterClaim(m.giftDay, m.giftStreak, day)
  const next = giftDayAfter(day, after, addDays(day, 1))
  return { day: rung, hints: giftHintsFor(rung), next: { day: next, hints: giftHintsFor(next) } }
}

/**
 * Claim today's gift: `hints` (the rung's free amount, or that plus the video's
 * bonus) — and climb the ladder. False when it was already claimed (a second
 * gift card left open) — nothing is paid and nothing climbs, so the caller must
 * not say otherwise.
 */
export function claimGift(hints: number): boolean {
  if (!giftDue()) return false
  const day = today()
  // Persist the claim — and the climb — before paying, so a crash can't pay it twice.
  updateMeta((m) => ({ ...m, giftDay: day, giftStreak: giftStreakAfterClaim(m.giftDay, m.giftStreak, day) }))
  grantHints(hints)
  // Tomorrow's rung is now a promise the reminder can make.
  syncReminders()
  return true
}

/**
 * Tomorrow's rung, for the reminder — only once today's gift is claimed (a day
 * without a claim resets the ladder, so nothing else is a true promise) and
 * never for an Unlimited owner, who gets no gift.
 */
function giftTomorrow(): GiftRung | null {
  if (hintsUnlimited() || meta().giftDay !== today()) return null
  return giftInfo().next
}

// --- streak safety nets -------------------------------------------------------------

export function freezeAdOpen(): boolean {
  return canEarnFreezeByAd(streak(), today())
}

/** Call after a rewarded freeze paid out. */
export function earnFreezeByAd(): void {
  updateMeta((m) => ({ ...m, streak: addFreeze(m.streak, today()) }))
  syncReminders()
}

export function canBuyFreeze(): boolean {
  return streak().freezes < 2 && (hintsUnlimited() || hintCountValue() >= FREEZE_HINT_COST)
}

/** Trade hints for a freeze (Unlimited owners pay nothing). */
export function buyFreeze(): boolean {
  if (!canBuyFreeze()) return false
  if (!hintsUnlimited() && !spendHints(FREEZE_HINT_COST)) return false
  updateMeta((m) => ({ ...m, streak: addFreeze(m.streak) }))
  syncReminders()
  return true
}

export function repairOpen(): boolean {
  return canRepair(streak(), today())
}

export function lostStreak(): number {
  return streak().lost?.streak ?? 0
}

export interface RepairResult {
  /** The streak after the repair. */
  streak: number
  /** Hints of the milestones the repair jumped over — already granted. */
  bonusHints: number
  /** Freezes of those milestones — already applied (after the cap). */
  bonusFreezes: number
  /** The highest milestone jumped over, or null. */
  milestoneDay: number | null
}

/**
 * Restore the broken streak — `paid` by an ad already watched, else with hints.
 * Null when nothing was repaired. A repair that lands on or past a milestone
 * pays it here (see streak.repair), so the result says what to celebrate.
 */
export function repairStreak(paid: 'ad' | 'hints'): RepairResult | null {
  if (!repairOpen()) return null
  if (paid === 'hints' && !hintsUnlimited() && !spendHints(REPAIR_HINT_COST)) return null
  const r = repair(streak(), today())
  if (!r) return null
  // Persist the streak before paying, so a crash can't pay the bonus twice.
  updateMeta((m) => ({ ...m, streak: r.streak }))
  // Unlimited owners have nothing to gain from hints (as with the jar).
  const bonusHints = hintsUnlimited() ? 0 : r.hints
  grantHints(bonusHints)
  syncReminders()
  return { streak: r.streak.current, bonusHints, bonusFreezes: r.freezes, milestoneDay: r.milestoneDay }
}

/**
 * Hand the reminder planner the facts it plans from — the streak, its freezes,
 * today's daily, the next level, tomorrow's gift. Called by every change to them
 * here (a freeze earned or bought, a repair, a daily solved, the gift claimed),
 * so the lapse copy never says "start a new streak" while a freeze just bought
 * still keeps it alive, and tomorrow's reminder can name tomorrow's gift.
 */
export function syncReminders(): void {
  const p = progress()
  let next = 1
  while (next < TOTAL_LEVELS && isCleared(p, next)) next++
  const s = streak()
  setReminderContext({
    streak: s.current,
    dailyDoneToday: dailyDoneToday(),
    nextLevel: next,
    freezes: s.freezes,
    giftTomorrow: giftTomorrow(),
  })
}

/** "Yesterday" for copy like "missed yesterday". */
export function yesterday(): string {
  return addDays(today(), -1)
}

// --- offers -------------------------------------------------------------------------

export function notePurchase(): void {
  if (meta().offers.purchased) return
  updateMeta((m) => ({ ...m, offers: { ...m.offers, purchased: true } }))
}

export function noteWelcomeBought(): void {
  updateMeta((m) => ({ ...m, offers: { ...m.offers, purchased: true, welcomeBought: true } }))
}

export function welcomeOffered(): boolean {
  return welcomeEligible(meta().offers, { adsRemoved: adsRemoved(), unlimited: hintsUnlimited() })
}

/** The quiet "remove ads between levels" link — only while such ads can come. */
export function noAdsNudgeNow(): boolean {
  // A player whose consent is withdrawn gets no interstitials: nothing to remove.
  if (!interstitialsPossible()) return false
  return noAdsNudgeDue(meta().offers, { adsRemoved: adsRemoved(), unlimited: hintsUnlimited() }, Date.now())
}

export function noteNoAdsNudge(): void {
  updateMeta((m) => ({ ...m, offers: { ...m.offers, noAdsNudges: m.offers.noAdsNudges + 1, noAdsLastAt: Date.now() } }))
}

export function sessions(): number {
  return meta().offers.sessions
}
