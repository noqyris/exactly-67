import { Preferences } from '@capacitor/preferences'
import type { Progress } from '../game/progress'
import { emptyProgress, parseProgress } from '../game/progress'

// Capacitor Preferences: native storage on iOS/Android, localStorage on web.
const PROGRESS_KEY = 'exactly67.progress'
const SOUND_KEY = 'exactly67.sound'
const HAPTICS_KEY = 'exactly67.haptics'
// Background music. Its own switch, separate from sound effects.
const MUSIC_KEY = 'exactly67.music'
// Level clears counted since the last interstitial (drives the ad cadence).
const AD_CLEARS_KEY = 'exactly67.adClears'
// Whether the player owns any ad-removal entitlement (either store product).
const ADS_REMOVED_KEY = 'exactly67.adsRemoved'
// Whether the player owns unlimited hints (the $4.99 bundle only). Absent on
// pre-split installs — see loadUnlimitedHints().
const UNLIMITED_HINTS_KEY = 'exactly67.unlimitedHints'
// UTC date (YYYY-MM-DD) of the last daily free-hint top-up.
const HINT_DATE_KEY = 'exactly67.hintFreeDate'
// Stored hint inventory (earned via the daily free + rewarded videos).
const HINT_COUNT_KEY = 'exactly67.hintCount'
// Whether the native "Rate this app" prompt has already been requested (one-shot).
const REVIEW_REQUESTED_KEY = 'exactly67.reviewRequested'
// Whether the one-time LevelPlay consent reset has run (see loadConsentMigrated()).
const CONSENT_MIGRATED_KEY = 'exactly67.levelplayConsentMigrated'

export async function loadProgress(): Promise<Progress> {
  try {
    const { value } = await Preferences.get({ key: PROGRESS_KEY })
    return parseProgress(value)
  } catch {
    return emptyProgress()
  }
}

export async function saveProgress(progress: Progress): Promise<void> {
  try {
    await Preferences.set({ key: PROGRESS_KEY, value: JSON.stringify(progress) })
  } catch {
    // non-fatal: the run just won't be remembered
  }
}

async function loadFlag(key: string): Promise<boolean> {
  try {
    const { value } = await Preferences.get({ key })
    return value !== 'off'
  } catch {
    return true
  }
}

async function saveFlag(key: string, on: boolean): Promise<void> {
  try {
    await Preferences.set({ key, value: on ? 'on' : 'off' })
  } catch {
    // non-fatal
  }
}

export const loadSoundEnabled = () => loadFlag(SOUND_KEY)
export const saveSoundEnabled = (on: boolean) => saveFlag(SOUND_KEY, on)
export const loadHapticsEnabled = () => loadFlag(HAPTICS_KEY)
export const saveHapticsEnabled = (on: boolean) => saveFlag(HAPTICS_KEY, on)

/**
 * Music defaults differently from the flags above: `loadFlag` treats an absent
 * key as ON, which is right for effects (a silent tap feels broken) and wrong
 * for a continuous bed the player never asked for. Absent means OFF here, so
 * the default is decided by an explicit constant in main.ts rather than by
 * which helper happened to get reused.
 */
export async function loadMusicEnabled(fallback: boolean): Promise<boolean> {
  try {
    const { value } = await Preferences.get({ key: MUSIC_KEY })
    if (value !== 'on' && value !== 'off') return fallback
    return value === 'on'
  } catch {
    return fallback
  }
}
export const saveMusicEnabled = (on: boolean) => saveFlag(MUSIC_KEY, on)

export async function loadAdClears(): Promise<number> {
  try {
    const { value } = await Preferences.get({ key: AD_CLEARS_KEY })
    const n = value ? parseInt(value, 10) : 0
    return Number.isFinite(n) && n >= 0 ? n : 0
  } catch {
    return 0
  }
}

export async function saveAdClears(n: number): Promise<void> {
  try {
    await Preferences.set({ key: AD_CLEARS_KEY, value: String(Math.max(0, Math.floor(n))) })
  } catch {
    // non-fatal: cadence just resets next launch
  }
}

export async function loadFreeHintDate(): Promise<string> {
  try {
    const { value } = await Preferences.get({ key: HINT_DATE_KEY })
    return value ?? ''
  } catch {
    return ''
  }
}

export async function saveFreeHintDate(date: string): Promise<void> {
  try {
    await Preferences.set({ key: HINT_DATE_KEY, value: date })
  } catch {
    // non-fatal: player just gets an extra free hint
  }
}

export async function loadHintCount(): Promise<number> {
  try {
    const { value } = await Preferences.get({ key: HINT_COUNT_KEY })
    const n = value ? parseInt(value, 10) : 0
    return Number.isFinite(n) && n >= 0 ? n : 0
  } catch {
    return 0
  }
}

export async function saveHintCount(n: number): Promise<void> {
  try {
    await Preferences.set({ key: HINT_COUNT_KEY, value: String(Math.max(0, Math.floor(n))) })
  } catch {
    // non-fatal: inventory just resets next launch
  }
}

export async function loadReviewRequested(): Promise<boolean> {
  try {
    const { value } = await Preferences.get({ key: REVIEW_REQUESTED_KEY })
    return value === 'on'
  } catch {
    return false
  }
}

export async function saveReviewRequested(on: boolean): Promise<void> {
  try {
    await Preferences.set({ key: REVIEW_REQUESTED_KEY, value: on ? 'on' : 'off' })
  } catch {
    // non-fatal: worst case the prompt is requested once more next session
  }
}

/**
 * Whether this install has had its consent record reset for LevelPlay.
 *
 * 1.2.0 asked for ad consent through Google's form, which — wherever a GDPR
 * message was live — writes the IAB TCF keys (IABTCF_*) into the same
 * UserDefaults the LevelPlay plugin reads. The plugin treats any such key as a
 * decision it already has and skips its own "Ads and your data" modal — so a
 * 1.2.0 player could come back GRANTED or DENIED on an answer given to a
 * different network. The reset clears them (services/ads.ts initAds()), and
 * this flag is what makes it happen once.
 *
 * Absent means "not yet": a fresh install runs the reset too, where it clears
 * nothing and costs nothing. Unlike loadFlag() an unreadable store reads as
 * false: a storage hiccup costs at worst one more modal, while skipping the
 * reset could start the SDK on a Google-era answer.
 */
export async function loadConsentMigrated(): Promise<boolean> {
  try {
    const { value } = await Preferences.get({ key: CONSENT_MIGRATED_KEY })
    return value === 'on'
  } catch {
    return false
  }
}

export async function saveConsentMigrated(): Promise<void> {
  try {
    await Preferences.set({ key: CONSENT_MIGRATED_KEY, value: 'on' })
  } catch {
    // non-fatal: the reset runs once more next launch and shows the modal again
  }
}

// Last UTC day the player completed the Daily Challenge (YYYY-MM-DD).
const DAILY_DONE_KEY = 'exactly67.dailyDone'
export async function loadDailyDone(): Promise<string> {
  try {
    const { value } = await Preferences.get({ key: DAILY_DONE_KEY })
    return value ?? ''
  } catch {
    return ''
  }
}
export async function saveDailyDone(date: string): Promise<void> {
  try {
    await Preferences.set({ key: DAILY_DONE_KEY, value: date })
  } catch {
    // non-fatal
  }
}

/**
 * Whether the player owns the *unlimited hints* entitlement, which is now
 * separate from ad removal (the $0.99 product removes ads only; the $4.99 one
 * bundles unlimited hints).
 *
 * Returns `null` when the key was never written — the legacy state. Every
 * pre-split owner bought the old bundled product, so the caller grandfathers
 * them to `true`; see `primeEntitlements` in main.ts. Do not collapse this to a
 * plain boolean or those owners silently lose the perk they paid for.
 */
export async function loadUnlimitedHints(): Promise<boolean | null> {
  try {
    const { value } = await Preferences.get({ key: UNLIMITED_HINTS_KEY })
    if (value !== 'on' && value !== 'off') return null
    return value === 'on'
  } catch {
    return null
  }
}

export async function saveUnlimitedHints(on: boolean): Promise<void> {
  try {
    await Preferences.set({ key: UNLIMITED_HINTS_KEY, value: on ? 'on' : 'off' })
  } catch {
    // non-fatal
  }
}

export async function loadAdsRemoved(): Promise<boolean> {
  try {
    const { value } = await Preferences.get({ key: ADS_REMOVED_KEY })
    return value === 'on'
  } catch {
    return false
  }
}

export async function saveAdsRemoved(on: boolean): Promise<void> {
  try {
    await Preferences.set({ key: ADS_REMOVED_KEY, value: on ? 'on' : 'off' })
  } catch {
    // non-fatal
  }
}
