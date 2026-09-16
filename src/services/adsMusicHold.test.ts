import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The music hold a full-screen ad takes (music.ts suppressMusic), pinned on the
 * REAL music module.
 *
 * adsPolicy.test.ts proves the ad layer takes and releases the hold at the right
 * moments; this proves the hold actually holds. music.ts restarts the bed from
 * its own visibilitychange / focus / pageshow listeners, and those are exactly
 * the events a return from an ad's advertiser page can deliver while the ad is
 * still on screen — the game's pad under the ad's soundtrack. None of it runs in
 * a browser tab you can watch, and none of it can be checked by playing a real
 * ad, so it is pinned here.
 */

/** Every startMusic() that got past its guards asks for the audio context. */
const contextAsks = vi.fn()

vi.mock('./audio', () => ({
  audioContext: () => {
    contextAsks()
    // Suspended, so the scheduler bails before it would need real Web Audio nodes.
    return {
      state: 'suspended',
      currentTime: 0,
      destination: {},
      createGain: () => ({
        gain: {
          value: 0.075,
          setValueAtTime: () => {},
          cancelScheduledValues: () => {},
          exponentialRampToValueAtTime: () => {},
        },
        connect: () => {},
      }),
    }
  },
}))

type Music = typeof import('./music')

let doc: EventTarget & { visibilityState: string }
let win: EventTarget

/** A fresh music module wired to a stand-in document and window (vitest runs in node). */
async function freshMusic(): Promise<Music> {
  doc = Object.assign(new EventTarget(), { visibilityState: 'visible' })
  win = Object.assign(new EventTarget(), {
    setInterval: (fn: () => void, ms: number) => setInterval(fn, ms),
    clearInterval: (id: ReturnType<typeof setInterval>) => clearInterval(id),
  })
  vi.stubGlobal('document', doc)
  vi.stubGlobal('window', win)
  vi.resetModules()
  const music = await import('./music')
  music.primeMusicEnabled(true)
  contextAsks.mockClear()
  return music
}

/** Everything that brings the app back to the foreground, as music.ts hears it. */
function comeBackToTheForeground(): void {
  doc.dispatchEvent(new Event('visibilitychange'))
  win.dispatchEvent(new Event('focus'))
  win.dispatchEvent(new Event('pageshow'))
}

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('music hold under a full-screen ad', () => {
  it('a return to the foreground restarts the bed normally — the listeners the hold exists for', async () => {
    const music = await freshMusic()
    comeBackToTheForeground()
    expect(contextAsks).toHaveBeenCalledTimes(1) // started once; the rest were idempotent
    music.stopMusic()
  })

  it('while held, no foreground event and no direct call can start it', async () => {
    const music = await freshMusic()
    music.suppressMusic(true)
    music.stopMusic()
    comeBackToTheForeground()
    music.startMusic()
    expect(contextAsks).not.toHaveBeenCalled()
  })

  it('released, it starts again at once', async () => {
    const music = await freshMusic()
    music.suppressMusic(true)
    music.suppressMusic(false)
    music.startMusic()
    expect(contextAsks).toHaveBeenCalledTimes(1)
    music.stopMusic()
  })

  it('is counted: one holder letting go does not release another', async () => {
    const music = await freshMusic()
    music.suppressMusic(true)
    music.suppressMusic(true)
    music.suppressMusic(false)
    comeBackToTheForeground()
    expect(contextAsks).not.toHaveBeenCalled()
    music.suppressMusic(false)
    music.startMusic()
    expect(contextAsks).toHaveBeenCalledTimes(1)
    music.stopMusic()
  })

  it('an extra release cannot bank credit against the next hold', async () => {
    const music = await freshMusic()
    music.suppressMusic(false) // unbalanced
    music.suppressMusic(true)
    music.startMusic()
    expect(contextAsks).not.toHaveBeenCalled()
  })

  it('a player who has music off stays off when the hold is released', async () => {
    const music = await freshMusic()
    music.primeMusicEnabled(false)
    music.suppressMusic(true)
    music.suppressMusic(false)
    music.startMusic()
    comeBackToTheForeground()
    expect(contextAsks).not.toHaveBeenCalled()
  })
})
