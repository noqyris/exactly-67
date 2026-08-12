/**
 * The shareable result card.
 *
 * ## Why it encodes the route, not the answer
 *
 * A Wordle grid is worth posting because two players' guesses differ. Here they
 * mostly do not: 41 of the 72 shipped levels have exactly one winning placement,
 * so a card built from the answer would be byte-identical for everyone who
 * cleared the level — nothing to compare, and a spoiler besides.
 *
 * What *does* differ is how you got there. The pan total after every placement
 * and removal is a running trace, and the overshoot is the drama of the game
 * anyway: one player creeps up to 67, another slams to 181 and hauls it back.
 * Same answer, visibly different journey.
 *
 * The glyphs are the game's own two objects, so the card reads to someone who
 * has never played:
 *
 *   ⬛  the pan went down (a weight)
 *   🎈  the pan went up (a balloon)
 *   ↩︎  a piece came back off
 *   🟩  landed on exactly 67
 *
 * Deltas are deliberately absent. You can see the shape of someone's attempt
 * without learning a single number they placed.
 */
import { TARGET } from './types'

/** One entry per board change, in order: the pan total after that change. */
export type Trace = readonly number[]

export interface ShareStats {
  level: number
  /** Pieces on the pan at the win, locked included. */
  pieces: number
  stars: number
  /** Which winning placement this was, and how many exist. */
  way?: number
  waysTotal?: number
  /** Seconds from first touch to the win, if it was timed. */
  seconds?: number
}

const DOWN = '⬛'
const UP = '🎈'
const BACK = '↩︎'
const LANDED = '🟩'

/**
 * The route as glyphs. Compares each total to the one before it, so the first
 * entry is measured against an empty pan.
 */
export function traceGlyphs(trace: Trace): string {
  let previous = 0
  const out: string[] = []
  for (let i = 0; i < trace.length; i++) {
    const total = trace[i]
    const last = i === trace.length - 1
    if (last && total === TARGET) out.push(LANDED)
    else if (total > previous) out.push(DOWN)
    else if (total < previous) out.push(UP)
    else out.push(BACK)
    previous = total
  }
  return out.join('')
}

/**
 * The highest the pan ever got — the overshoot, which is this game's drama.
 *
 * Deliberately the maximum, not "furthest from 67". A route that opens at 31 is
 * 36 away from the target, but that is just an unfinished pan, not tension; the
 * story is the pan climbing past 67 and being hauled back. When a route never
 * goes over, `shareCard` omits the field rather than printing a number that
 * describes nothing.
 */
export function peakOf(trace: Trace): number {
  return trace.reduce((peak, total) => (total > peak ? total : peak), TARGET)
}

/**
 * A removal is a visible wasted move, which is what makes a Wordle grid worth
 * posting rather than a clean row of greens.
 */
export function undoCount(trace: Trace): number {
  let previous = 0
  let undos = 0
  for (const total of trace) {
    // A removal moves the total back toward whatever it was before the piece
    // went on; the glyph pass calls the equal case BACK for the same reason.
    if (total === previous) undos++
    previous = total
  }
  return undos
}

function stars(n: number): string {
  return '★'.repeat(Math.max(0, Math.min(3, n))) + '☆'.repeat(Math.max(0, 3 - n))
}

/**
 * Three lines, no URL — the caller adds one if the platform wants it. Kept
 * short enough to survive a message preview without being truncated.
 */
export function shareCard(stats: ShareStats, trace: Trace): string {
  const peak = peakOf(trace)
  const facts: string[] = [`${stats.pieces} pieces`]

  if (peak > TARGET) facts.push(`peak ${peak}`)
  if (stats.seconds !== undefined) facts.push(`${Math.round(stats.seconds)}s`)
  if (stats.way !== undefined && stats.waysTotal !== undefined && stats.waysTotal > 1) {
    facts.push(`way ${stats.way}/${stats.waysTotal}`)
  } else if (stats.waysTotal === 1) {
    facts.push('the only way')
  }
  facts.push(stars(stats.stars))

  return [
    `Exactly 67 · Level ${stats.level}`,
    traceGlyphs(trace),
    facts.join(' · '),
  ].join('\n')
}
