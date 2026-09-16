import { audioContext } from './audio'

/**
 * The background music bed — generated from oscillators at play time, like
 * every other sound in this game. There is no audio file, so it costs the
 * bundle nothing and can never be the reason a download is slow.
 *
 * It is *generative*, not a loop: the chord progression cycles, but the melody
 * is re-rolled from a pentatonic scale every bar. That matters more than it
 * sounds — a fixed 15-second loop under a puzzle you might sit on for five
 * minutes is the thing players mute. Pentatonic is the trick that makes this
 * safe: every note in it consonates with every chord below, so a random pick
 * can be sparse and surprising but never wrong.
 *
 * Three rules it must obey:
 *   - **Its own toggle.** Effects and music are separate switches; muting one
 *     must not touch the other. `audio.ts` owns the effects flag.
 *   - **Sit under everything.** The bed peaks well below the SFX so the place
 *     "thock" and the win jingle always cut through — and it ducks itself for
 *     the win (see `duckMusic`).
 *   - **Never play into an ad or a background.** A suspended iOS context
 *     freezes `currentTime`; scheduling against it would queue a burst of notes
 *     that all fire at once on resume. The scheduler re-syncs instead.
 */

// --- composition ---------------------------------------------------------
// The tunable block. Everything below this is machinery.

const BPM = 70
const BEAT = 60 / BPM
const EIGHTH = BEAT / 2
/** Eighth-notes per chord — 4 beats, so the progression turns every ~13.7s. */
const STEPS_PER_CHORD = 8

/** Master level. SFX peak around 0.25, so the bed sits roughly a third under. */
const LEVEL = 0.075

/** MIDI note number → Hz. C4 = 60, A4 = 69 = 440Hz. */
function hz(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12)
}

/**
 * I – vi – IV – V in C, voiced as sevenths and sixths. Sevenths are what keep
 * it warm rather than nursery-bright; the plain triads read as a jingle.
 */
const CHORDS: { bass: number; pad: number[] }[] = [
  { bass: 48, pad: [60, 64, 67, 71] }, // Cmaj7
  { bass: 45, pad: [57, 60, 64, 67] }, // Am7
  { bass: 41, pad: [53, 57, 60, 64] }, // Fmaj7
  { bass: 43, pad: [55, 59, 62, 64] }, // G6
]

/** C major pentatonic — the scale with no wrong note over the chords above. */
const MELODY = [72, 74, 76, 79, 81, 84]

/** Chance of a melody note on any given eighth. Sparse on purpose. */
const MELODY_DENSITY = 0.32

// --- machinery -----------------------------------------------------------

/** How far ahead notes are queued, and how often the scheduler wakes. */
const LOOKAHEAD_S = 0.3
const TICK_MS = 60

let enabled = false
/** Holders of "not now" — a full-screen ad, see suppressMusic(). */
let suppressed = 0
let ctx: AudioContext | null = null
let master: GainNode | null = null
let timer: number | null = null
let nextTime = 0
let step = 0
let lastMelodyStep = -9

export function musicEnabled(): boolean {
  return enabled
}

/** Reflect the persisted flag at boot, before anything can start (no write). */
export function primeMusicEnabled(on: boolean): void {
  enabled = on
}

/**
 * Turn music on or off. Persisting is the caller's job (same split as the
 * sound/haptics toggles). Starting is safe to call before the audio context is
 * unlocked — nothing happens until `startMusic` gets a running context.
 */
export function setMusicEnabled(on: boolean): void {
  enabled = on
  if (on) startMusic()
  else stopMusic()
}

/**
 * Hold the bed down while something else owns the speaker — a full-screen ad.
 * Counted, so two holders cannot release each other; `services/ads` takes it
 * before stopping the music and gives it back just before restarting it.
 *
 * Why a stopMusic() is not enough: the listeners at the bottom of this file
 * restart the bed on every visibilitychange, focus and pageshow. A player who
 * taps through an ad to the App Store and comes back can land on a web view that
 * reports "visible" while the ad is still on screen — whether it does depends
 * on how the network presents, which nobody can check without playing a real
 * ad — and without this the pad would start under the ad's own soundtrack. The ad layer imports this module,
 * never the reverse, so the hold lives here rather than as a question asked of it.
 */
export function suppressMusic(on: boolean): void {
  suppressed = Math.max(0, suppressed + (on ? 1 : -1))
}

/**
 * Begin (or resume) the bed. Idempotent, and a no-op while muted or held down
 * by suppressMusic(), so it can be called from every "the player just touched
 * something" path — which is what unlocks audio on iOS in the first place.
 */
export function startMusic(): void {
  if (!enabled || suppressed > 0 || timer !== null) return
  const ac = audioContext()
  if (!ac) return
  // A context can be thrown away and rebuilt after an unrecoverable iOS
  // interruption (see resumeAudio); rebuild our chain onto the new one.
  if (ctx !== ac || !master) {
    ctx = ac
    master = ac.createGain()
    master.gain.setValueAtTime(LEVEL, ac.currentTime)
    master.connect(ac.destination)
  }
  nextTime = 0
  timer = window.setInterval(tick, TICK_MS)
  tick()
}

/** Stop the bed and drop the scheduler. Notes already queued ring out. */
export function stopMusic(): void {
  if (timer !== null) {
    window.clearInterval(timer)
    timer = null
  }
  const ac = ctx
  if (ac && master) {
    // Fade rather than cut, or the pad's tail clicks.
    const t = ac.currentTime
    try {
      master.gain.cancelScheduledValues(t)
      master.gain.setValueAtTime(Math.max(master.gain.value, 0.0001), t)
      master.gain.exponentialRampToValueAtTime(0.0001, t + 0.25)
    } catch {
      /* context died under us — nothing to fade */
    }
  }
  nextTime = 0
}

/**
 * Pull the bed down for a moment so something louder can land — the win jingle
 * mainly. Standard mixing move: without it the jingle and the pad fight, and
 * the win reads as mush at the exact instant it should read as a reward.
 */
export function duckMusic(depth = 0.25, seconds = 1.8): void {
  const ac = ctx
  if (!ac || !master || timer === null) return
  const t = ac.currentTime
  try {
    master.gain.cancelScheduledValues(t)
    master.gain.setValueAtTime(Math.max(master.gain.value, 0.0001), t)
    master.gain.exponentialRampToValueAtTime(Math.max(LEVEL * depth, 0.0001), t + 0.12)
    master.gain.exponentialRampToValueAtTime(LEVEL, t + seconds)
  } catch {
    /* non-fatal: worst case the jingle is a touch muddier */
  }
}

function tick(): void {
  const ac = ctx
  if (!ac || !master) return
  // Suspended/interrupted (ad on screen, phone call, backgrounded): `currentTime`
  // is frozen, so anything queued now would pile up and fire at once on resume.
  // Drop the cursor and re-sync when it starts running again.
  if (ac.state !== 'running') {
    nextTime = 0
    return
  }
  if (nextTime === 0) {
    nextTime = ac.currentTime + 0.1
    // Restore the level after a duck-and-suspend left it turned down.
    master.gain.cancelScheduledValues(ac.currentTime)
    master.gain.setValueAtTime(LEVEL, ac.currentTime)
  }
  const out = master
  while (nextTime < ac.currentTime + LOOKAHEAD_S) {
    playStep(ac, out, step, nextTime)
    nextTime += EIGHTH
    step++
  }
}

function playStep(ac: AudioContext, out: GainNode, n: number, at: number): void {
  const chord = CHORDS[Math.floor(n / STEPS_PER_CHORD) % CHORDS.length]
  const beat = n % STEPS_PER_CHORD

  if (beat === 0) {
    bass(ac, out, hz(chord.bass), at)
    for (const note of chord.pad) pad(ac, out, hz(note), at)
  }

  // Sparse, and never two eighths in a row — the gaps are what stop it turning
  // into a ringtone. The downbeat is left to the pad.
  if (beat !== 0 && n - lastMelodyStep > 1 && Math.random() < MELODY_DENSITY) {
    lastMelodyStep = n
    bell(ac, out, hz(MELODY[Math.floor(Math.random() * MELODY.length)]), at)
  }
}

/** Shared envelope: exponential attack/decay, no clicks. */
function voice(
  ac: AudioContext,
  out: GainNode,
  type: OscillatorType,
  freq: number,
  at: number,
  attack: number,
  dur: number,
  gain: number,
  detune = 0,
): void {
  const osc = ac.createOscillator()
  const amp = ac.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(freq, at)
  if (detune) osc.detune.setValueAtTime(detune, at)
  amp.gain.setValueAtTime(0.0001, at)
  amp.gain.exponentialRampToValueAtTime(gain, at + attack)
  amp.gain.exponentialRampToValueAtTime(0.0001, at + dur)
  osc.connect(amp).connect(out)
  osc.start(at)
  osc.stop(at + dur + 0.05)
}

/** Low root, felt more than heard on a phone speaker. */
function bass(ac: AudioContext, out: GainNode, freq: number, at: number): void {
  voice(ac, out, 'triangle', freq, at, 0.04, BEAT * 3.2, 0.5)
}

/** Slow-blooming chord tone; two detuned sines so it breathes. */
function pad(ac: AudioContext, out: GainNode, freq: number, at: number): void {
  voice(ac, out, 'sine', freq, at, 0.7, BEAT * 3.6, 0.1)
  voice(ac, out, 'sine', freq, at, 0.8, BEAT * 3.4, 0.06, 7)
}

/** The melody voice: a soft bell with an octave shimmer on top. */
function bell(ac: AudioContext, out: GainNode, freq: number, at: number): void {
  voice(ac, out, 'sine', freq, at, 0.01, BEAT * 1.7, 0.26)
  voice(ac, out, 'triangle', freq * 2, at, 0.01, BEAT * 0.9, 0.05)
}

// Backgrounding throttles timers to about once a second, which would starve the
// scheduler and punch holes in the bed. Park it instead, and pick up on return.
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      if (timer !== null) {
        window.clearInterval(timer)
        timer = null
      }
      nextTime = 0
    } else {
      startMusic()
    }
  })
  // WKWebView does not always deliver visibilitychange on an iOS foreground;
  // back it up. startMusic() is idempotent, so extra calls cost nothing.
  window.addEventListener('focus', () => startMusic())
  window.addEventListener('pageshow', () => startMusic())
}
