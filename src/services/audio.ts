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
 * iOS creates AudioContexts suspended until a user gesture; every play call
 * goes through here so the first tap unlocks audio.
 */
function context(): AudioContext | null {
  if (!enabled) return null
  try {
    ctx ??= new AudioContext()
    if (ctx.state === 'suspended') void ctx.resume()
    return ctx
  } catch {
    return null
  }
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
