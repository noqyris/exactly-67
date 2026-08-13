/**
 * Noqyris studio sting, played once per cold start over the booting game.
 *
 * The markup lives inline in index.html (with inline styles) so it paints on
 * the very first frame, before this module — or any CSS chunk — has loaded.
 * This file only drives it.
 *
 * Four things are non-negotiable:
 *   - `muted` + `playsinline`, or iOS refuses to autoplay without a user
 *     gesture. The shipped file also has its audio track stripped.
 *   - The splash must NEVER be able to strand the player on a black screen.
 *     Every failure path (autoplay rejected, decode error, a codec the WebView
 *     dislikes, a file that never loads) dismisses, and a hard timeout backs
 *     all of them up.
 *   - It must not block boot. `boot()` runs underneath the whole time, so the
 *     menu is already built by the time the sting ends.
 *   - **The tap that skips it must not also press a menu button underneath.**
 *     See the shield below — this is the subtle one.
 */

/** Belt and braces: dismiss no matter what, even if no video event ever fires. */
const HARD_TIMEOUT_MS = 8000
/** The sting is ~5s; offer the way out early enough to matter. */
const SKIP_HINT_MS = 1400
const FADE_MS = 260
/**
 * How long the (now invisible) overlay keeps swallowing input after the fade.
 *
 * Skipping is a *tap*: finger down dismisses, finger up lands some 80-150ms
 * later. Phaser fires a button's `onTap` from a bare `pointerup` and re-hit-tests
 * at the release position, so if the overlay were gone by then the release would
 * press whatever menu button sits under the thumb — Play, Levels, Store. Holding
 * the transparent overlay for the whole fade plus a margin keeps that release
 * inert, and the player never sees it.
 */
const SHIELD_GRACE_MS = 220
/**
 * Absolute cap on the shield. It normally lifts as soon as the finger is up, but
 * if an `up` never arrives (app backgrounded mid-touch, a cancel the WebView
 * swallows) this guarantees input is handed back. Blocking taps forever would be
 * a far worse bug than the one the shield exists to prevent.
 */
const SHIELD_MAX_MS = 5000

/**
 * Start the sting. Resolves once it is **visually** gone (end of the fade), so
 * callers can hold back anything that would draw over it — notably the AdMob
 * banner, which is a native view stacked ABOVE the web view, and the UMP consent
 * / ATT prompts, which are full-screen native modals. Always resolves: on the
 * reduced-motion path immediately, otherwise via the hard timeout at the latest.
 */
export function initSplash(): Promise<void> {
  const splash = document.getElementById('splash')
  if (!splash) return Promise.resolve()
  const video = document.getElementById('splash-video') as HTMLVideoElement | null
  const hint = document.getElementById('splash-skip')

  // Reduced motion: a full-screen animation is exactly what the setting is
  // asking us not to play.
  let reduced = false
  try {
    reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    reduced = false
  }
  if (reduced || !video) {
    splash.remove()
    return Promise.resolve()
  }

  let markGone: () => void = () => {}
  const gone = new Promise<void>((resolve) => (markGone = resolve))

  const timers: number[] = []
  const clearTimers = () => {
    timers.forEach((t) => window.clearTimeout(t))
    timers.length = 0
  }

  // --- input shield ------------------------------------------------------
  // Track what is still touching the screen so the overlay is never pulled out
  // from under a finger. Pointer and touch events both fire on iOS, so they are
  // counted separately and only their union matters.
  const activePointers = new Set<number>()
  let activeTouches = 0
  const anyDown = () => activePointers.size > 0 || activeTouches > 0

  let dismissed = false
  let shieldExpired = false
  let removed = false

  const removeSplash = () => {
    if (removed) return
    removed = true
    clearTimers()
    document.removeEventListener('visibilitychange', onHidden)
    video.pause()
    splash.remove()
    markGone()
  }
  /** Hand input back once the grace period is over AND nothing is touching. */
  const liftShield = () => {
    if (!shieldExpired || anyDown()) return
    removeSplash()
  }
  /**
   * A finger that leaves with the app (backgrounded mid-touch) never reports an
   * `up`; drop the counts so the shield can lift on its own.
   */
  function onHidden() {
    if (document.visibilityState !== 'hidden') return
    activePointers.clear()
    activeTouches = 0
    liftShield()
  }

  const dismiss = () => {
    if (dismissed) return
    dismissed = true
    clearTimers()
    if (hint) hint.style.opacity = '0'
    splash.style.opacity = '0'
    timers.push(
      // Faded out: nothing can land on top of the sting any more.
      window.setTimeout(markGone, FADE_MS),
      window.setTimeout(() => {
        shieldExpired = true
        liftShield()
      }, FADE_MS + SHIELD_GRACE_MS),
      window.setTimeout(removeSplash, SHIELD_MAX_MS),
    )
  }

  /**
   * Stop the event dead. `stopPropagation` keeps it from bubbling to the window
   * listeners Phaser installs for "released outside the canvas", and
   * `preventDefault` is the belt to that braces: those handlers explicitly skip
   * events whose default was prevented, and it also suppresses the synthesized
   * mouse/click pair a touch would otherwise produce.
   */
  const swallow = (e: Event) => {
    e.preventDefault()
    e.stopPropagation()
  }
  const active = { passive: false } as const

  splash.addEventListener(
    'pointerdown',
    (e) => {
      activePointers.add((e as PointerEvent).pointerId)
      swallow(e)
      dismiss()
    },
    active,
  )
  const pointerUp = (e: Event) => {
    activePointers.delete((e as PointerEvent).pointerId)
    swallow(e)
    liftShield()
  }
  splash.addEventListener('pointerup', pointerUp, active)
  splash.addEventListener('pointercancel', pointerUp, active)

  splash.addEventListener(
    'touchstart',
    (e) => {
      activeTouches = (e as TouchEvent).touches.length
      swallow(e)
      dismiss()
    },
    active,
  )
  const touchUp = (e: Event) => {
    activeTouches = (e as TouchEvent).touches.length
    swallow(e)
    liftShield()
  }
  splash.addEventListener('touchend', touchUp, active)
  splash.addEventListener('touchcancel', touchUp, active)

  // Desktop dev / any browser that skips the touch family.
  splash.addEventListener('mousedown', (e) => { swallow(e); dismiss() }, active)
  splash.addEventListener('mouseup', (e) => { swallow(e); liftShield() }, active)
  splash.addEventListener('click', swallow, active)

  document.addEventListener('visibilitychange', onHidden)

  // --- playback ----------------------------------------------------------

  // Fade in rather than cut: the native launch screen is the cream 67 block and
  // this sting opens on black, so a hard swap reads as a glitch.
  requestAnimationFrame(() => {
    if (!dismissed) splash.style.opacity = '1'
  })

  video.addEventListener('ended', dismiss)
  video.addEventListener('error', dismiss)

  timers.push(
    window.setTimeout(() => {
      if (!dismissed && hint) hint.style.opacity = '1'
    }, SKIP_HINT_MS),
    window.setTimeout(dismiss, HARD_TIMEOUT_MS),
  )

  // Autoplay can still be refused (low power mode, WebView policy). Don't sit
  // on a frozen first frame if it is.
  const started = video.play()
  if (started && typeof started.catch === 'function') started.catch(dismiss)

  return gone
}
