import { Preferences } from '@capacitor/preferences'
import type { Progress } from '../game/progress'
import { emptyProgress, parseProgress } from '../game/progress'

// Capacitor Preferences: native storage on iOS/Android, localStorage on web.
const PROGRESS_KEY = 'exactly67.progress'
const SOUND_KEY = 'exactly67.sound'
const HAPTICS_KEY = 'exactly67.haptics'
// Level clears counted since the last interstitial (drives the ad cadence).
const AD_CLEARS_KEY = 'exactly67.adClears'
// Whether the player bought "Remove Ads" (Phase 2 IAP).
const ADS_REMOVED_KEY = 'exactly67.adsRemoved'
// UTC date (YYYY-MM-DD) of the last daily free-hint top-up.
const HINT_DATE_KEY = 'exactly67.hintFreeDate'
// Stored hint inventory (earned via the daily free + rewarded videos).
const HINT_COUNT_KEY = 'exactly67.hintCount'
// Whether the native "Rate this app" prompt has already been requested (one-shot).
const REVIEW_REQUESTED_KEY = 'exactly67.reviewRequested'

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
