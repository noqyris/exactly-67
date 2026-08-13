/**
 * Noqyris studio sting, played once per cold start over the booting game.
 *
 * The markup lives inline in index.html (with inline styles) so it paints on
 * the very first frame, before this module — or any CSS chunk — has loaded.
 * This file only drives it.
 *
 * Three things are non-negotiable on iOS:
 *   - `muted` + `playsinline`, or the WebView refuses to autoplay without a
 *     user gesture. The shipped file also has its audio track stripped.
 *   - The splash must NEVER be able to strand the player on a black screen.
 *     Every failure path (autoplay rejected, decode error, a codec the WebView
 *     dislikes, a file that never loads) dismisses, and a hard timeout backs
 *     all of them up.
 *   - It must not block boot. `boot()` runs underneath the whole time, so the
 *     menu is already built by the time the sting ends.
 */

/** Belt and braces: dismiss no matter what, even if no video event ever fires. */
const HARD_TIMEOUT_MS = 8000
/** The sting is ~5s; offer the way out early enough to matter. */
const SKIP_HINT_MS = 1400
const FADE_MS = 260

export function initSplash(): void {
  const splash = document.getElementById('splash')
  if (!splash) return
  const video = document.getElementById('splash-video') as HTMLVideoElement | null
  const hint = document.getElementById('splash-skip')

  let done = false
  const timers: number[] = []
  const dismiss = () => {
    if (done) return
    done = true
    timers.forEach((t) => window.clearTimeout(t))
    splash.style.opacity = '0'
    window.setTimeout(() => splash.remove(), FADE_MS)
  }

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
    return
  }

  // Fade in rather than cut: the native launch screen is the cream 67 block and
  // this sting opens on black, so a hard swap reads as a glitch.
  requestAnimationFrame(() => {
    splash.style.opacity = '1'
  })

  video.addEventListener('ended', dismiss)
  video.addEventListener('error', dismiss)
  // A tap anywhere skips — the sting is brand, not content.
  splash.addEventListener('pointerdown', dismiss)

  timers.push(
    window.setTimeout(() => {
      if (!done && hint) hint.style.opacity = '1'
    }, SKIP_HINT_MS),
    window.setTimeout(dismiss, HARD_TIMEOUT_MS),
  )

  // Autoplay can still be refused (low power mode, WebView policy). Don't sit
  // on a frozen first frame if it is.
  const started = video.play()
  if (started && typeof started.catch === 'function') started.catch(dismiss)
}
