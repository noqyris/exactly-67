import { Preferences } from '@capacitor/preferences'
import type { Progress } from '../game/progress'
import { emptyProgress, parseProgress } from '../game/progress'

// Capacitor Preferences: native storage on iOS/Android, localStorage on web.
const PROGRESS_KEY = 'exactly67.progress'
const SOUND_KEY = 'exactly67.sound'
const HAPTICS_KEY = 'exactly67.haptics'

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
