/**
 * Dev-only **offline audio renderer** — the soundtrack half of `capture.ts`.
 *
 * The SFX are synthesised through Web Audio at play time (`services/audio.ts`),
 * so there is nothing on disk to mux into a rendered clip and no way to record
 * the real output while the page is running on Chrome's virtual clock (a
 * `MediaRecorder` records in wall-clock real time, which virtual time makes
 * meaningless).
 *
 * So instead of recording the audio, we **re-render** it. `services/audio.ts`
 * only ever touches `new AudioContext()`, `ac.currentTime`, `createOscillator`,
 * `createGain` and `ac.destination` — every note is scheduled at an absolute
 * `currentTime + offset`. That is exactly the surface an `OfflineAudioContext`
 * provides, so we swap `window.AudioContext` for a proxy over one.
 *
 * The proxy's `currentTime` reports a **logical clock** that `capture.ts`
 * advances by exactly the amount it intends to wait, rather than any real or
 * virtual wall clock. That matters because the audio is rendered in a separate,
 * real-time pass from the video (`tools/render-clip.mjs` — an offline render
 * cannot complete under Chrome's virtual clock). Tying note times to the
 * director's own schedule instead of to elapsed time is what keeps the two
 * passes in sync: `setTimeout` jitter in the audio pass cannot smear the notes,
 * because nothing reads a real clock. Every sound in a capture is emitted
 * synchronously from a `place()` call, so the logical clock is exact for all of
 * them — including the win jingle, which fires inside the same call stack.
 *
 * Nothing in `services/audio.ts` changes. The proxy has to be installed before
 * the first sound plays, because that module caches its context on first use.
 *
 * Two properties must be faked:
 * - `state` → `'running'`, so `audio.ts` never calls `resume()` (on an
 *   `OfflineAudioContext` that would *start rendering* early).
 * - `resume()` → a no-op promise, for the same reason.
 */

const SAMPLE_RATE = 48000

/**
 * Deliberately split into kick-off / poll / collect rather than one awaited
 * call. The renderer drives this page on Chrome's virtual clock, and awaiting
 * `startRendering()` there deadlocks: the promise's resolution is a task, and
 * tasks only run while virtual time is being advanced — which the renderer
 * cannot do while it is blocked on the await. So it starts the render, keeps
 * stepping virtual time, and collects the result once `ready` flips.
 */
interface AudioRenderBridge {
  /** Kick off rendering. Returns immediately; watch `ready`. */
  begin: () => void
  /** True once the buffer is rendered and encoded. */
  ready: boolean
  /** Error message if rendering failed, else null. */
  error: string | null
  /** The base64 mono 16-bit WAV, once `ready`. */
  take: () => string
}

let offline: OfflineAudioContext | null = null
/** Director-driven schedule position, in ms. See the header. */
let logicalMs = 0

/** Advance the schedule position notes are scheduled against. */
export function setAudioClock(ms: number): void {
  logicalMs = ms
}

/**
 * Swap in the offline context. `seconds` sizes the render buffer — make it an
 * upper bound on the clip; the surplus is silence and gets trimmed at mux time.
 */
export function installOfflineAudio(seconds: number): void {
  const oac = new OfflineAudioContext(1, Math.ceil(SAMPLE_RATE * seconds), SAMPLE_RATE)
  offline = oac
  logicalMs = 0

  const proxy = new Proxy(oac, {
    get(target, prop) {
      // The director's schedule position, NOT a wall clock — this is what
      // places every note correctly and keeps the two passes in sync.
      if (prop === 'currentTime') return logicalMs / 1000
      if (prop === 'state') return 'running'
      if (prop === 'resume' || prop === 'suspend') return () => Promise.resolve()
      if (prop === 'close') return () => Promise.resolve()
      // Read straight off the target, NOT via Reflect.get(…, receiver): native
      // accessors like `destination` and methods like `createOscillator` reject
      // a proxy as their `this` with "Illegal invocation".
      const value = (target as unknown as Record<string | symbol, unknown>)[prop]
      return typeof value === 'function' ? value.bind(target) : value
    },
  })

  // `new AudioContext()` returns the proxy: a constructor returning an object
  // yields that object. services/audio.ts is none the wiser.
  ;(window as unknown as { AudioContext: unknown }).AudioContext = function () {
    return proxy
  }

  let encoded = ''
  const bridge: AudioRenderBridge = {
    begin: () => {
      oac
        .startRendering()
        .then((buffer) => {
          encoded = wavBase64(buffer)
          bridge.ready = true
        })
        .catch((e: unknown) => {
          bridge.error = e instanceof Error ? e.message : String(e)
        })
    },
    ready: false,
    error: null,
    take: () => encoded,
  }
  ;(window as unknown as { __e67audio: AudioRenderBridge }).__e67audio = bridge
}

/** Mono 16-bit PCM WAV, base64-encoded for transport over CDP. */
function wavBase64(buffer: AudioBuffer): string {
  const samples = buffer.getChannelData(0)
  const bytes = new ArrayBuffer(44 + samples.length * 2)
  const view = new DataView(bytes)

  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i))
  }

  const dataSize = samples.length * 2
  ascii(0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  ascii(8, 'WAVE')
  ascii(12, 'fmt ')
  view.setUint32(16, 16, true) // PCM header size
  view.setUint16(20, 1, true) // format: PCM
  view.setUint16(22, 1, true) // channels
  view.setUint32(24, buffer.sampleRate, true)
  view.setUint32(28, buffer.sampleRate * 2, true) // byte rate
  view.setUint16(32, 2, true) // block align
  view.setUint16(34, 16, true) // bits per sample
  ascii(36, 'data')
  view.setUint32(40, dataSize, true)

  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(44 + i * 2, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true)
  }

  // Chunked so a long clip doesn't blow the argument limit of String.fromCharCode.
  const raw = new Uint8Array(bytes)
  let binary = ''
  for (let i = 0; i < raw.length; i += 0x8000) {
    binary += String.fromCharCode(...raw.subarray(i, i + 0x8000))
  }
  return btoa(binary)
}

export function offlineAudioInstalled(): boolean {
  return offline !== null
}
