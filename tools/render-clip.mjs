#!/usr/bin/env node
/**
 * Deterministic offline renderer for marketing clips.
 *
 *   npm run capture                       # dev server on :5199, in another shell
 *   node tools/render-clip.mjs --level 71 --mode fail --out marketing/clips/a1.mp4
 *
 * ## Why not just screen-record
 *
 * A screen recording is at the mercy of the compositor: dropped frames, a
 * variable frame interval, and whatever else the machine was doing. This
 * renders instead — it drives Chrome's **virtual time clock**, so the page's
 * `setTimeout`/RAF/`performance.now` all advance in exact 1/60s steps that have
 * nothing to do with wall-clock time. Every frame is captured before the clock
 * is allowed to move again, so the output is bit-for-bit reproducible and
 * cannot drop a frame no matter how slow the machine is.
 *
 * Because virtual time drives the page's own timers, `src/dev/capture.ts` runs
 * unmodified — the same schedule, just on a clock we control.
 *
 * ## Resolution
 *
 * `Emulation.setDeviceMetricsOverride` pins the viewport to 540×960 CSS px at
 * `deviceScaleFactor: 2` — Chrome's own `--window-size` is not honoured
 * reliably in headless. The override is applied **before navigation** because
 * `src/render/layout.ts` reads `window.devicePixelRatio` once at module load;
 * set it late and the game lays out for the wrong DPR. Result: the canvas is
 * 1080×1920 physical pixels and screenshots are native TikTok resolution with
 * no upscaling. The script asserts those exact dimensions before encoding.
 *
 * ## Audio
 *
 * The SFX are synthesised at play time, so they are **re-rendered** rather than
 * recorded: `src/dev/audioRender.ts` swaps in an `OfflineAudioContext` whose
 * clock tracks virtual time, the game schedules its notes into that, and the
 * result is muxed in as AAC. Sample-exact and reproducible, same as the video.
 * Pass `--silent` to skip it.
 *
 * The raw synth output is quiet — around **-32 LUFS**, because the SFX are short
 * transients separated by digital silence. Social platforms normalise toward
 * roughly -14 LUFS, so unprocessed it is ~18 dB below everything else in the
 * feed and reads as "no audio at all". So the mux runs `loudnorm`, landing near
 * -20 LUFS with true peaks at -1 dBFS: clearly audible, nothing clipped, and the
 * transients keep their snap. It cannot reach -14 without pumping the silence
 * between the clicks, which is not worth it. `--raw-audio` skips the processing.
 *
 * ## What it cannot do
 *
 * Text overlays, captions and any on-camera footage are edit-time work and are
 * not attempted here — see `marketing/BATCH-01.md` for what goes over the top.
 */
import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const FPS = 60

// The CDP client uses the global WebSocket, which only exists from Node 22.
// The repo's default `node` is often older (Capacitor already wants 22), and
// the raw failure is an unhelpful "WebSocket is not defined".
if (typeof WebSocket === 'undefined') {
  console.error(`This renderer needs Node >= 22 for the built-in WebSocket (running ${process.version}).\nRun \`nvm use 22\` and try again.`)
  process.exit(1)
}
/** Hard stop so a hung page can't render forever. */
const MAX_FRAMES = 60 * 90

function parseArgs(argv) {
  const a = {
    level: 71, mode: 'solve', pace: 620, lead: 1400, hold: 2600,
    chain: 3, fps: FPS, server: 'http://localhost:5199', out: null,
    keepFrames: false, silent: false, rawAudio: false,
  }
  for (let i = 2; i < argv.length; i += 2) {
    const key = argv[i].replace(/^--/, '')
    const val = argv[i + 1]
    if (key === 'keep-frames') { a.keepFrames = true; i -= 1; continue }
    if (key === 'silent') { a.silent = true; i -= 1; continue }
    if (key === 'raw-audio') { a.rawAudio = true; i -= 1; continue }
    if (!(key in a)) throw new Error(`Unknown flag --${key}`)
    a[key] = /^\d+$/.test(val) ? Number(val) : val
  }
  if (!a.out) a.out = `marketing/clips/l${a.level}-${a.mode}.mp4`
  return a
}

/**
 * Upper bound on clip length, used to size the offline audio buffer up front.
 * 12 is the shipping cap on weights per level, so no level can place more.
 * Surplus is silence and gets trimmed by ffmpeg's -shortest.
 */
function audioSeconds(a) {
  const levels = a.mode === 'asmr' ? a.chain : 1
  return Math.ceil((levels * (a.lead + 12 * a.pace + a.hold)) / 1000) + 5
}

/**
 * The capture-director URL both passes load.
 * `seed=0` avoids the reload the progress seeder would trigger (the level map
 * is never on screen in a gameplay clip); `auto=1` skips the arming click,
 * which exists only to unlock audio for a human screen-recording; `armed=1`
 * holds the pristine board until the driver says go.
 */
function captureUrl(a) {
  const q = new URLSearchParams({
    rec: String(a.level), mode: a.mode,
    pace: String(a.pace), lead: String(a.lead), hold: String(a.hold),
    chain: String(a.chain), seed: '0', auto: '1', armed: '1',
    // NEVER mute, in either pass. `mute=1` calls setSoundEnabled(false), which
    // makes the HUD draw the crossed-out speaker — so every frame of the clip
    // would advertise "sound off" no matter what is on the audio track.
    // Silence is achieved instead by the offline-audio proxy, which absorbs
    // every note into a buffer and keeps a real AudioContext from ever
    // existing; the video pass simply discards what it renders.
    mute: '0',
    wav: String(audioSeconds(a)),
  })
  return `${a.server}/?${q}`
}

/**
 * Pass 1 — run the whole capture in real time purely to collect the SFX, and
 * return the rendered WAV as a Buffer. No frames are taken here; this is the
 * only pass in which an OfflineAudioContext can actually finish.
 */
async function audioPass(cdp, args, throwIfPageFailed) {
  process.stdout.write('audio pass… ')
  await cdp.send('Page.navigate', { url: captureUrl(args) })

  const deadline = Date.now() + 120000
  const waitFor = async (expr, what) => {
    while (Date.now() < deadline) {
      if (await evaluate(cdp, expr)) return
      throwIfPageFailed()
      await new Promise((r) => setTimeout(r, 100))
    }
    throw new Error(`Audio pass timed out waiting for ${what}`)
  }

  await waitFor('window.__e67capture?.armed === true', 'the director to arm')
  await evaluate(cdp, 'window.__e67go()')
  await waitFor('window.__e67capture?.done === true', 'the run to finish')

  await evaluate(cdp, 'window.__e67audio.begin(), true')
  await waitFor('window.__e67audio.ready === true || !!window.__e67audio.error', 'the render')

  const err = await evaluate(cdp, 'window.__e67audio.error')
  if (err) throw new Error(`Offline audio render failed: ${err}`)
  const b64 = await evaluate(cdp, 'window.__e67audio.take()')
  if (!b64) throw new Error('Offline audio render returned nothing')

  const buf = Buffer.from(b64, 'base64')
  process.stdout.write(`${(buf.length / 1024 / 1024).toFixed(1)} MB WAV\n`)
  return buf
}

/** Minimal CDP client over the DevTools WebSocket (Node 22 has global WebSocket). */
class CDP {
  #ws; #next = 1; #pending = new Map(); #listeners = new Map(); #dead = null

  static async attach(port) {
    // Retry: Chrome needs a moment before the debugging port answers.
    let targets
    for (let i = 0; i < 40; i++) {
      try {
        const res = await fetch(`http://localhost:${port}/json`)
        targets = await res.json()
        if (targets.some((t) => t.type === 'page')) break
      } catch { /* not up yet */ }
      await new Promise((r) => setTimeout(r, 250))
    }
    const page = targets?.find((t) => t.type === 'page')
    if (!page) throw new Error('No CDP page target — is Chrome running?')
    const c = new CDP()
    await c.#connect(page.webSocketDebuggerUrl)
    return c
  }

  #connect(url) {
    return new Promise((ok, fail) => {
      this.#ws = new WebSocket(url)
      this.#ws.onopen = () => ok()
      this.#ws.onerror = (e) => fail(new Error(`CDP socket failed: ${e.message ?? e}`))
      // A closed socket must fail every in-flight command. Without this a
      // dropped connection leaves them pending forever and the run hangs with
      // no error — which looks exactly like a slow render.
      this.#ws.onclose = (ev) => {
        this.#dead = `CDP socket closed (code ${ev?.code}, reason ${JSON.stringify(ev?.reason ?? '')})`
        for (const { fail: rej } of this.#pending.values()) rej(new Error(this.#dead))
        this.#pending.clear()
      }
      this.#ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data)
        if (msg.id && this.#pending.has(msg.id)) {
          const { ok: res, fail: rej } = this.#pending.get(msg.id)
          this.#pending.delete(msg.id)
          msg.error ? rej(new Error(msg.error.message)) : res(msg.result)
        } else if (msg.method) {
          for (const fn of this.#listeners.get(msg.method) ?? []) fn(msg.params)
        }
      }
    })
  }

  /** Every command is bounded — nothing in this tool may hang indefinitely. */
  send(method, params = {}, timeoutMs = 30000) {
    if (this.#dead) return Promise.reject(new Error(this.#dead))
    const id = this.#next++
    return new Promise((ok, fail) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id)
        fail(new Error(`CDP ${method} timed out after ${timeoutMs}ms`))
      }, timeoutMs)
      const done = (fn) => (v) => { clearTimeout(timer); fn(v) }
      this.#pending.set(id, { ok: done(ok), fail: done(fail) })
      this.#ws.send(JSON.stringify({ id, method, params }))
    })
  }

  on(method, fn) {
    if (!this.#listeners.has(method)) this.#listeners.set(method, [])
    this.#listeners.get(method).push(fn)
  }

  /** Resolve on the next occurrence of a CDP event. */
  once(method) {
    return new Promise((ok) => {
      const fn = (p) => {
        const list = this.#listeners.get(method)
        list.splice(list.indexOf(fn), 1)
        ok(p)
      }
      this.on(method, fn)
    })
  }

  close() { this.#ws.close() }
}

const evaluate = async (cdp, expression, timeoutMs = 0) => {
  const call = cdp.send('Runtime.evaluate', {
    expression, returnByValue: true, awaitPromise: true,
  })
  const { result } = timeoutMs
    ? await Promise.race([
        call,
        new Promise((_, fail) =>
          setTimeout(() => fail(new Error(`Timed out after ${timeoutMs}ms: ${expression}`)), timeoutMs),
        ),
      ])
    : await call
  return result.value
}

async function main() {
  const args = parseArgs(process.argv)
  const outPath = resolve(ROOT, args.out)
  const frameDir = resolve(tmpdir(), `e67-frames-${args.level}-${args.mode}`)
  const profileDir = resolve(tmpdir(), `e67-render-profile-${process.pid}`)
  rmSync(frameDir, { recursive: true, force: true })
  mkdirSync(frameDir, { recursive: true })
  mkdirSync(dirname(outPath), { recursive: true })

  // The dev server must already be up — the capture director only exists in DEV.
  try {
    await fetch(args.server)
  } catch {
    throw new Error(`Dev server not reachable at ${args.server}. Run \`npm run capture\` first.`)
  }

  // Port 0 = let Chrome pick a free one and report it in DevToolsActivePort.
  // A fixed port silently attaches to somebody else's leftover browser, which
  // is a genuinely confusing failure — the run hangs with zero frames.
  rmSync(profileDir, { recursive: true, force: true })
  const chrome = spawn(CHROME, [
    '--headless=new',
    '--remote-debugging-port=0',
    '--hide-scrollbars',
    '--mute-audio',
    `--user-data-dir=${profileDir}`,
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] })

  // Chrome's own stderr is the only place a crash explains itself; swallowing
  // it turns "the browser died" into an unexplained socket close.
  let chromeErr = ''
  chrome.stderr.on('data', (d) => { chromeErr += d })
  chrome.on('exit', (code, signal) => {
    // Report signal kills too — `code` is null for those, and suppressing them
    // is what made an abrupt browser death look like a bare socket close.
    if (code || signal) {
      process.stderr.write(`\nChrome exited (code ${code}, signal ${signal}):\n${chromeErr.slice(-2000)}\n`)
    }
  })

  let cdp
  try {
    cdp = await CDP.attach(await activePort(profileDir))
    await cdp.send('Page.enable')
    await cdp.send('Runtime.enable')
    // A renderer-process crash closes the page's socket while the browser
    // process lives on, so "Chrome exited" never fires and the failure looks
    // like an unexplained disconnect. Name it.
    await cdp.send('Inspector.enable')
    cdp.on('Inspector.targetCrashed', () => {
      process.stderr.write('\nRenderer process crashed (Inspector.targetCrashed)\n')
    })

    // An uncaught error in the page aborts the capture director silently — the
    // `done` flag never flips and the run grinds on to MAX_FRAMES. Surface it.
    const pageErrors = []
    cdp.on('Runtime.exceptionThrown', (p) => {
      const d = p.exceptionDetails
      pageErrors.push(d.exception?.description ?? d.text)
    })
    const throwIfPageFailed = () => {
      if (pageErrors.length) throw new Error(`Page threw:\n  ${pageErrors[0]}`)
    }

    // --- Pass 1: audio, in real time, before virtual time is ever enabled.
    //
    // Deliberately runs at the default viewport, with NO device-metrics
    // override. This pass captures no frames, so it has no use for the 1080x1920
    // canvas — and forcing one makes headless Chrome software-rasterise a
    // full-size WebGL surface at an uncapped 60fps, which kills the renderer
    // process mid-run (socket closes 1006, no crash report). The video pass is
    // safe from that only because it steps the clock one frame at a time.
    //
    // An OfflineAudioContext cannot finish under Chrome's virtual clock: its
    // completion is delivered as a task, tasks only run while virtual time is
    // advancing, and every way of advancing it while waiting deadlocks. In real
    // time the same render takes ~115ms. So the audio gets its own pass, and
    // note timing survives the switch because capture.ts schedules against its
    // own logical clock rather than any wall clock (see src/dev/audioRender.ts).
    let audio = null
    if (!args.silent) audio = await audioPass(cdp, args, throwIfPageFailed)

    // --- Pass 2: video, on the virtual clock.
    //
    // Both of these must land BEFORE navigation: the metrics override because
    // layout.ts reads devicePixelRatio once at module load, the clock freeze so
    // no wall-clock time leaks in and the first frame is the true frame 0.
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 540, height: 960, deviceScaleFactor: 2, mobile: false,
    })
    await cdp.send('Emulation.setVirtualTimePolicy', { policy: 'pause' })

    await cdp.send('Page.navigate', { url: captureUrl(args) })

    // Warm up on virtual time until the director reports the board is up and
    // untouched. Advancing a fixed guess instead would silently eat the lead-in
    // and the first placements — frame 0 would already be half-solved.
    let armed = false
    for (let i = 0; i < 200 && !armed; i++) {
      await advance(cdp, 50)
      armed = await evaluate(cdp, 'window.__e67capture?.armed === true')
    }
    if (!armed) throw new Error('Capture director never armed — is the dev server serving DEV?')

    const stepMs = 1000 / args.fps
    let frames = 0
    process.stdout.write(`Rendering level ${args.level} (${args.mode}) `)

    // Frame 0 is the pristine board; release the director immediately after so
    // the lead-in hold is inside the clip rather than in front of it.
    const shoot = async () => {
      const shot = await cdp.send('Page.captureScreenshot', { format: 'png' })
      writeFileSync(
        resolve(frameDir, `f${String(frames).padStart(6, '0')}.png`),
        Buffer.from(shot.data, 'base64'),
      )
      frames++
      if (frames % 60 === 0) process.stdout.write('.')
    }

    await shoot()
    await evaluate(cdp, 'window.__e67go()')

    while (frames < MAX_FRAMES) {
      await advance(cdp, stepMs)
      await shoot()
      throwIfPageFailed()
      if (await evaluate(cdp, 'window.__e67capture?.done === true')) break
    }
    if (frames >= MAX_FRAMES) {
      throw new Error(`Hit the ${MAX_FRAMES}-frame cap without the run finishing.`)
    }
    process.stdout.write(`\n${frames} frames captured\n`)

    if (frames < 2) throw new Error('Nothing rendered — the capture director never ran.')

    const size = await evaluate(cdp, 'JSON.stringify([innerWidth*devicePixelRatio, innerHeight*devicePixelRatio])')
    const [w, h] = JSON.parse(size)
    if (w !== 1080 || h !== 1920) {
      throw new Error(`Expected a 1080x1920 canvas, got ${w}x${h} — the metrics override did not apply.`)
    }

    let wavPath = null
    if (audio) {
      wavPath = resolve(frameDir, 'audio.wav')
      writeFileSync(wavPath, audio)
    }
    process.stdout.write('encoding… ')

    // Peak-normalise to a fixed -1 dBFS rather than trusting loudnorm's adaptive
    // single pass. Levels differ wildly in what they sound like — a board solved
    // entirely with balloons has only the quiet squeak and no block "thock", and
    // loudnorm left one such clip 14 dB below its neighbours, i.e. inaudible.
    // A measured, explicit gain treats every clip the same.
    let gainDb = 0
    if (wavPath && !args.rawAudio) {
      const peak = await peakDb(wavPath)
      gainDb = -1 - peak
      process.stdout.write(`peak ${peak.toFixed(1)} dB → +${gainDb.toFixed(1)} dB · `)
    }
    await encode(frameDir, outPath, args.fps, wavPath, args.rawAudio, gainDb)
    console.log(`→ ${outPath}`)
  } finally {
    cdp?.close()
    chrome.kill()
    // Cleanup must never throw: this runs in `finally`, so an error here would
    // replace whatever actually went wrong and hide the real failure. Chrome is
    // still flushing its profile as it exits, so rmSync can legitimately race.
    try {
      rmSync(profileDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
    } catch { /* stale profile in tmp is harmless */ }
    if (!args.keepFrames) {
      try {
        rmSync(frameDir, { recursive: true, force: true, maxRetries: 3 })
      } catch { /* ditto */ }
    }
  }
}

/** Read the port Chrome actually bound from the profile's DevToolsActivePort. */
async function activePort(profileDir) {
  const file = resolve(profileDir, 'DevToolsActivePort')
  for (let i = 0; i < 60; i++) {
    try {
      const port = Number(readFileSync(file, 'utf8').split('\n')[0])
      if (Number.isFinite(port) && port > 0) return port
    } catch { /* not written yet */ }
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error('Chrome never reported a debugging port')
}

/** Advance the page's virtual clock by `ms` and wait for it to actually elapse. */
async function advance(cdp, ms) {
  const expired = cdp.once('Emulation.virtualTimeBudgetExpired')
  await cdp.send('Emulation.setVirtualTimePolicy', {
    policy: 'pauseIfNetworkFetchesPending',
    budget: ms,
    maxVirtualTimeTaskStarvationCount: 10000,
  })
  // Bounded: if the budget never expires the clock is wedged, and waiting on it
  // forever is indistinguishable from a slow render.
  await Promise.race([
    expired,
    new Promise((_, fail) =>
      setTimeout(() => fail(new Error(`Virtual time never advanced past ${ms}ms`)), 30000),
    ),
  ])
}

/** Peak level of a WAV in dBFS, via ffmpeg's volumedetect. */
function peakDb(wavPath) {
  return new Promise((ok, fail) => {
    const ff = spawn('ffmpeg', ['-i', wavPath, '-af', 'volumedetect', '-f', 'null', '-'],
      { stdio: ['ignore', 'ignore', 'pipe'] })
    let err = ''
    ff.stderr.on('data', (d) => { err += d })
    ff.on('close', () => {
      const m = err.match(/max_volume:\s*(-?[\d.]+) dB/)
      m ? ok(parseFloat(m[1])) : fail(new Error('Could not measure peak level'))
    })
  })
}

function encode(frameDir, outPath, fps, wavPath, rawAudio, gainDb) {
  return new Promise((ok, fail) => {
    const ff = spawn('ffmpeg', [
      '-y', '-framerate', String(fps),
      '-i', resolve(frameDir, 'f%06d.png'),
      ...(wavPath ? ['-i', wavPath] : []),
      '-c:v', 'libx264', '-preset', 'slow', '-crf', '18',
      // yuv420p + even dimensions: what every social platform will accept.
      '-pix_fmt', 'yuv420p',
      // The WAV is deliberately over-long; -shortest trims it to the video.
      // Stereo because that is what the platforms expect; loudnorm because the
      // raw synth sits ~18 dB under everything else in a feed (see the header).
      // -ar 48000 is not optional: loudnorm runs at 192 kHz internally and
      // otherwise leaves a 96 kHz AAC track, which is out of spec for delivery.
      ...(wavPath
        ? [
            // `pan`, not `-ac 2`: the automatic mono-to-stereo upmix inserts a
            // rematrix that drops ~3.7 dB, quietly undoing part of the gain we
            // just measured. This duplicates the channel at unity instead.
            ...(rawAudio
              ? ['-ac', '2']
              : ['-af', `volume=${gainDb.toFixed(1)}dB,pan=stereo|c0=c0|c1=c0`]),
            '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-shortest',
          ]
        : []),
      '-movflags', '+faststart',
      outPath,
    ], { stdio: ['ignore', 'ignore', 'pipe'] })
    let err = ''
    ff.stderr.on('data', (d) => { err += d })
    ff.on('close', (code) => (code === 0 ? ok() : fail(new Error(`ffmpeg failed:\n${err.slice(-1500)}`))))
  })
}

main().catch((e) => {
  console.error(e.message)
  process.exit(1)
})
