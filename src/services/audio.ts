/**
 * All audio is synthesized with the Web Audio API at play time — the game
 * ships zero audio files and nothing here is sampled from anywhere.
 */
let enabled = true
let ctx: AudioContext | null = null

export function setSoundEnabled(on: boolean) {
  enabled = on
}

export function soundEnabled(): boolean {
  return enabled
}

/**
 * The one AudioContext the whole game shares — SFX here, the music bed in
 * `music.ts`. iOS creates it suspended until a user gesture, so every play call
 * goes through here and the first tap unlocks audio.
 *
 * Deliberately NOT gated on `enabled`: that flag is the *sound-effects* toggle,
 * and music has its own. Use `context()` below for anything that should fall
 * silent when the player mutes effects.
 */
export function audioContext(): AudioContext | null {
  try {
    ctx ??= new AudioContext()
    // iOS WebKit can also report the non-standard 'interrupted' (after a
    // phone call or backgrounding) — resume on anything not running.
    if (ctx.state !== 'running') void ctx.resume()
    return ctx
  } catch {
    return null
  }
}

/** The SFX-gated context: null when the player has effects muted. */
function context(): AudioContext | null {
  return enabled ? audioContext() : null
}

/**
 * Returning from the background — an interstitial ad, a phone call, the home
 * button — leaves the iOS AudioContext 'suspended' or the non-standard
 * 'interrupted', which silences every later sound. Nudge it back to running; if
 * it's unrecoverable, drop it so the next play() rebuilds a fresh one on the
 * user's tap. Safe to call anytime (no-op when there's no context yet).
 */
export function resumeAudio(): void {
  const ac = ctx
  if (!ac || ac.state === 'running') return
  try {
    void ac.resume().catch(() => {
      if (ctx === ac) ctx = null
    })
  } catch {
    if (ctx === ac) ctx = null
  }
}

// Foreground again → unlock audio immediately, before the next tap. Covers
// backgrounding paths that don't route through an ad-dismiss callback.
//
// Three events, not one: `visibilitychange` is the documented signal but is
// unreliable inside an iOS WKWebView on some foreground paths (the classic
// symptom is audio dead after backgrounding on iOS while Android is fine), so
// `focus` and `pageshow` back it up. They are cheap and idempotent — resumeAudio
// returns immediately when the context is already running.
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') resumeAudio()
  })
  window.addEventListener('focus', () => resumeAudio())
  window.addEventListener('pageshow', () => resumeAudio())
}

interface ToneOpts {
  freq: number
  /** Glide to this frequency over the note. */
  bendTo?: number
  at?: number
  dur?: number
  type?: OscillatorType
  gain?: number
}

function tone(ac: AudioContext, opts: ToneOpts) {
  const { freq, bendTo, at = 0, dur = 0.12, type = 'triangle', gain = 0.2 } = opts
  const t0 = ac.currentTime + at
  const osc = ac.createOscillator()
  const amp = ac.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(freq, t0)
  if (bendTo !== undefined) osc.frequency.exponentialRampToValueAtTime(bendTo, t0 + dur)
  // Fast attack, exponential decay — chunky and clean, no clicks.
  amp.gain.setValueAtTime(0.0001, t0)
  amp.gain.exponentialRampToValueAtTime(gain, t0 + 0.008)
  amp.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
  osc.connect(amp).connect(ac.destination)
  osc.start(t0)
  osc.stop(t0 + dur + 0.05)
}

/** A down-weight lands: a short low "thock". */
export function playPlace() {
  const ac = context()
  if (!ac) return
  tone(ac, { freq: 200, bendTo: 120, dur: 0.09, type: 'triangle', gain: 0.25 })
  tone(ac, { freq: 400, bendTo: 240, dur: 0.05, type: 'sine', gain: 0.08 })
}

/** A balloon clips on: a rising squeak. */
export function playPlaceBalloon() {
  const ac = context()
  if (!ac) return
  tone(ac, { freq: 420, bendTo: 700, dur: 0.11, type: 'sine', gain: 0.16 })
}

/** A hint ghost lands on the pan: a soft, encouraging two-note bloom — distinct
 *  from the low place "thock" and the win jingle. */
export function playHintChime() {
  const ac = context()
  if (!ac) return
  tone(ac, { freq: 660, bendTo: 880, dur: 0.18, type: 'sine', gain: 0.1 })
  tone(ac, { freq: 990, at: 0.05, dur: 0.16, type: 'sine', gain: 0.05 })
}

/** A weight comes back off the pan. */
export function playRemove() {
  const ac = context()
  if (!ac) return
  tone(ac, { freq: 300, bendTo: 180, dur: 0.08, type: 'sine', gain: 0.14 })
}

/** Refused action (budget full / locked weight): a flat double buzz. */
export function playRefuse() {
  const ac = context()
  if (!ac) return
  tone(ac, { freq: 130, dur: 0.06, type: 'square', gain: 0.07 })
  tone(ac, { freq: 110, at: 0.08, dur: 0.08, type: 'square', gain: 0.07 })
}

/**
 * The celebration fanfare, played as the win card lands — a second, bigger beat
 * than the jingle above. The split is deliberate: the jingle is the *impact*
 * (the beam locked at 67), this is the *reward* (here is what you earned). One
 * sound doing both jobs has to compromise on each.
 */
export function playCelebration() {
  const ac = context()
  if (!ac) return
  // A plain C major arpeggio. Anything cleverer starts to read as a ringtone.
  const arp = [523.25, 659.25, 783.99, 1046.5] // C5 E5 G5 C6
  arp.forEach((f, i) => {
    const at = i * 0.075
    tone(ac, { freq: f, at, dur: 0.32, type: 'triangle', gain: 0.2 })
    tone(ac, { freq: f * 2, at, dur: 0.18, type: 'sine', gain: 0.045 })
  })
  // Sparkle tail — the confetti, in sound. Randomised so repeat wins don't
  // land identically; the arpeggio underneath keeps it anchored.
  for (let i = 0; i < 6; i++) {
    tone(ac, {
      freq: 1200 + Math.random() * 1400,
      at: 0.3 + i * 0.055,
      dur: 0.12,
      type: 'sine',
      gain: 0.035,
    })
  }
  // Low bloom so it has body on a phone speaker instead of sounding thin.
  tone(ac, { freq: 130.81, dur: 0.7, type: 'triangle', gain: 0.12 })
}

/**
 * The original "six-seven" win jingle: two rising notes (C5 → G5) with a
 * little octave sparkle on the second — composed for this game.
 */
export function playWinJingle() {
  const ac = context()
  if (!ac) return
  // "six" —
  tone(ac, { freq: 523.25, dur: 0.16, type: 'triangle', gain: 0.22 })
  tone(ac, { freq: 523.25, dur: 0.16, type: 'square', gain: 0.05 })
  // — "SEVEN!"
  tone(ac, { freq: 783.99, at: 0.17, dur: 0.38, type: 'triangle', gain: 0.24 })
  tone(ac, { freq: 783.99, at: 0.17, dur: 0.38, type: 'square', gain: 0.05 })
  tone(ac, { freq: 1567.98, at: 0.24, dur: 0.3, type: 'sine', gain: 0.07 })
}
