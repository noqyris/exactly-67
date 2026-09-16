# Audio

Every sound in Exactly 67 is **synthesized at play time**. The game ships zero
audio files: no music track, no sample pack, no sprite sheet of effects. Sound
effects come from `services/audio.ts`, the background music bed from
`services/music.ts`, and both draw oscillators and gain envelopes on the same
`AudioContext`.

That is not asceticism for its own sake. It buys three things that matter for a
600-level puzzle game shipped by one person: the download stays tiny, there is
no asset pipeline to maintain, and the music can be *generative* rather than a
loop — which is the difference between a bed you can sit under for a ten-minute
puzzle and one you mute after ninety seconds.

## The three switches

| Switch | Storage key | Default | Controls |
|---|---|---|---|
| Sound | `exactly67.sound` | on | Every effect: place, remove, refuse, hint, win jingle, celebration |
| Music | `exactly67.music` | see `MUSIC_ON_BY_DEFAULT` in `main.ts` (currently **on**) | The background bed only |
| Haptics | `exactly67.haptics` | on | `@capacitor/haptics` taps |

They are **independent**. Muting effects must not silence the bed and vice
versa — plenty of players want the taps and none of the music, and the reverse
is just as common. `audio.ts` owns the effects flag; `music.ts` owns its own.

Note the asymmetry in how the defaults are read. `loadFlag` in `storage.ts`
treats an absent key as **on**, which is right for effects (a silent tap reads
as a broken button) and wrong for a continuous bed nobody asked for. Music
therefore goes through `loadMusicEnabled(fallback)`, so its default is one
named constant in `main.ts` rather than an accident of which helper got reused.

## The shared context

`audio.ts` exports two accessors and the distinction matters:

- **`audioContext()`** — the one `AudioContext` the whole game shares. Not
  gated on any toggle. `music.ts` uses this.
- **`context()`** (module-private) — the same thing, but `null` when sound
  effects are muted. Every `play*` function uses this.

iOS creates the context suspended until a user gesture, so every play path goes
through an accessor that resumes it. `resumeAudio()` handles the harder case:
returning from an interstitial, a phone call, or the home screen leaves the
context `suspended` or in WebKit's non-standard `interrupted` state, which
silences everything afterwards. It nudges it back, and drops the context
entirely if it is unrecoverable so the next tap rebuilds a fresh one. `music.ts`
notices that swap and rebuilds its gain chain onto the new context.

## The music bed

A slow I–vi–IV–V in C, voiced as sevenths, at 70 BPM — one chord per bar, so
the progression turns about every 13.7 seconds. Over it, a sparse melody is
**re-rolled every bar** from the C major pentatonic scale.

Pentatonic is the trick that makes generative music safe: every note in it
consonates with every chord underneath, so a random pick can be surprising but
never wrong. The melody is deliberately thin (about a third of eighth-notes,
never two in a row) because the gaps are what stop a bed turning into a
ringtone.

Three constraints the bed must respect:

1. **Sit under everything.** Master level is `0.075` against SFX peaking near
   `0.25`, and `duckMusic()` pulls it down further for the win so the jingle and
   fanfare cut through instead of fighting the pad.
2. **Never play into a suspended context.** An ad, a phone call or a
   backgrounded app freezes `currentTime`; scheduling against it would queue a
   pile of notes that all fire at once on resume. The scheduler drops its cursor
   and re-syncs instead.
3. **Never run while hidden.** Browsers throttle timers to roughly once a second
   in the background, which would punch holes in the bed. The scheduler parks on
   `visibilitychange` and picks up on return.

Scheduling uses the standard Web Audio look-ahead pattern — a 60ms timer that
queues notes 300ms into the future — because `setTimeout` is far too jittery to
place notes directly.

## The celebration

A level clear plays out in **two beats**, on purpose:

| At | Beat | What fires |
|---|---|---|
| +500ms | Impact | camera shake · confetti · `duckMusic` · `playWinJingle` · win haptic · "Congratulations!" |
| +1000ms | Reward | `playCelebration` fanfare · the win card with stars and score |

The jingle is the *impact* — the beam locked at 67 — and the fanfare is the
*reward*. One sound doing both jobs has to compromise on each, and a single lump
of feedback reads as a notification rather than an achievement.

"Congratulations!" sits **below the scale**, not across it. The balanced beam is
the achievement; covering it at the moment it locks level trades the payoff for
an announcement of the payoff. It also scales to the content frame, because one
long word at a fixed size runs off a 320pt phone.

## iOS: the audio session — and what it does *not* guarantee

`AppDelegate.swift` sets the politest category available at launch:

```swift
try? AVAudioSession.sharedInstance().setCategory(
    .ambient, mode: .default, options: [.mixWithOthers]
)
```

- **`.ambient`** — secondary audio. Obeys the physical silent switch, which is
  what you want: a game that blares out of a muted phone earns one-star reviews.
- **`.mixWithOthers`** — declares that the player's Spotify or podcast may keep
  playing underneath.

**Do not "upgrade" this to `.playback`.** That category is for apps whose audio
is the point — music players, video — and it interrupts other apps and ignores
the mute switch.

### The caveat, stated honestly

**This setting may not govern our sound at all, and it is not proof that
Spotify survives.** All game audio is Web Audio inside a WKWebView, and
WKWebView runs its own audio session in a separate process.
[WebKit bug 167788](https://bugs.webkit.org/show_bug.cgi?id=167788) — filed 2017,
still open, still being confirmed by reporters in 2025 — reports that the host
app's category is ignored there. The reported case was `<video>` rather than
oscillator-synthesized Web Audio, so applying it to us is an inference, not a
measurement.

So the category is *correct and free*, not *load-bearing*. **Verify on a real
device**: start Spotify, launch Exactly 67, and check that Spotify keeps playing
and is neither stopped nor solo-ducked. If it is not, the fix is native — an
audio-session shim in `ios/App` — not a TypeScript change.

There is a second, sharper version of the same risk: **ad SDKs can set the audio
session themselves** while a video ad plays with sound — which is exactly our
rewarded-hint format. Google documented this for the AdMob SDK (`SoloAmbient`
once a video ad is unmuted), which the game used until the AdMob account was
closed in August 2026. How the Unity LevelPlay SDK and the Unity Ads adapter
handle the session has **not been verified** for this app: check on a device that
the player's own music survives a hint video, and treat a failure as a native
fix, not a TypeScript one.

## Ads and the music bed

Nothing pauses game audio around ads automatically: neither the LevelPlay SDK
nor `capacitor-levelplay-ads` ducks game audio — the plugin only emits lifecycle
events you wire yourself. Our pad playing under an ad's own soundtrack is the
worst audio moment the game can produce.

So every full-screen ad (interstitial or rewarded hint video) runs inside
`underFullScreenAd()` in `ads.ts`, which takes a **hold** on the bed with
`suppressMusic(true)`, calls `stopMusic()` (and sleeps the Phaser loop and hides the
banner) immediately before the show, and gives everything back in a **`finally`** —
`resumeAudio()`, then `suppressMusic(false)`, then `startMusic()` — so it runs on every
way an ad can end:

| Ending | Why it has to be covered |
|---|---|
| dismissed (closed) | the normal one |
| failed to present | no close event ever arrives; a pause with no matching resume strands the music dead for the whole session |
| the show call rejected, or a timeout | the ad never appeared at all, or an event was dropped |

`resumeAudio()` matters as much as the music: a full-screen ad interrupts the iOS
`AudioContext`, and without the nudge every later sound effect is silent.
`startMusic()` and `resumeAudio()` are both idempotent (and `startMusic()` is a
no-op when the player has music off), so covering every path costs nothing.

**Why a `stopMusic()` alone is not enough.** `music.ts` restarts the bed from its own
`visibilitychange` (to visible), `focus` and `pageshow` listeners. A player who taps
through an ad to the App Store and comes back can land on a web view that reports
"visible" while the ad is still on screen — whether that happens depends on how the
network presents, which nobody can check without playing a real ad — and the pad would
start under the ad's soundtrack. `suppressMusic(on)` is a **counted** hold that
`startMusic()` obeys: two holders cannot release each other, and an extra release
cannot bank credit against the next hold. The hold is released **before** the final
`startMusic()`, or the restart would be the one call it eats. The hold lives in
`music.ts` because `ads.ts` imports the music module, never the reverse.
`adsMusicHold.test.ts` runs the real module against a stand-in document and window, and
`adsPolicy.test.ts` checks the hold is released however the ad ended.

## Gotchas

- **Music cannot start at boot.** iOS requires a user gesture. `main.ts` arms it
  on the first `pointerdown` anywhere, registered in the **capture** phase: the
  splash overlay deliberately stops taps from bubbling (see `splash.ts`), and
  capture runs before that. Toggling music on from the menu is itself a gesture,
  so it plays immediately.
- **`music.ts` must not import `context()`.** It would then fall silent whenever
  a player muted sound effects.
- **Ads suspend the context.** `ads.ts` calls `resumeAudio()` in the `finally`
  of every full-screen ad; the music scheduler re-syncs on its own once the
  context is running again.
- **Never call `startMusic()` expecting it to win over an ad.** While a full-screen ad
  holds `suppressMusic`, every start — a foreground event, a direct call — is a
  no-op by design; the ad layer's own restart comes after it lets go.
- **Every voice ends in an exponential ramp to `0.0001`, never to `0`.**
  `exponentialRampToValueAtTime` cannot reach zero, and passing it produces a
  click or an exception depending on the browser.


## On the default, and on "what Block Blast does"

A 106-agent research pass (Aug 2026) went looking for two things and came back
with an honest negative on both. Recording it here so nobody re-runs it:

- **Block Blast's actual audio and celebration design is not established.**
  Every claim about its music loop, its toggle model, its combo SFX escalation
  and its text popups failed adversarial verification — including the one
  sourced to its own App Store listing (refuted 0-3). Store listings and press
  coverage simply do not carry this detail. The only way to get it is direct
  observation: install it, screen-record with device audio, walk the settings
  screen, watch consecutive combo tiers. **Do not write "Block Blast does X"
  anywhere in this repo without having watched it.**

- **There is no surviving evidence either way on music-on-by-default.** The two
  numbers everyone cites both failed: the "only 8% play with sound on"
  TapResearch survey (1-2, predates 2024, rewarded-panel sample that
  self-selects for muted play) and the "+9.5pp D1 from music" koro.games A/B
  (0-3, vendor-reported, single title, wrong genre, no confidence intervals).

So the default is a **judgment call**, and the asymmetry runs one way: a wrong
ON default is a first-session annoyance with a real cost, while a wrong OFF
default only forfeits an unmeasured upside. We ship **ON** anyway — the bed was
asked for, it is quiet, generative and one tap from the main menu — but that is
a product decision, not a finding, and flipping it is a one-line change to
`MUSIC_ON_BY_DEFAULT`.

One result did survive and is worth keeping: a preregistered CHI '24 experiment
(Kao et al., n=1,699) found that **randomised** feedback variety does not
improve competence, effectance or curiosity, and its authors recommend against
it — "players need to be able to learn to attribute screen events to their
actions, which requires reliable (nonrandom) ... feedback". Read carefully, that
is an argument against a shuffled bag of "Great!/Amazing!/Incredible!" lines and
*not* against escalation keyed to something learnable, which the authors
explicitly list as an open question. Our celebration is deterministic — the same
two beats every time, with the stars carrying the variable part — which is the
side of that line to be on.
