import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics'

// All haptics are gated by the user's toggle. Calls are fire-and-forget and
// swallow errors — on web without vibration support they silently no-op.
let enabled = true

export function setHapticsEnabled(on: boolean) {
  enabled = on
}

export function hapticsEnabled(): boolean {
  return enabled
}

/**
 * A weight lands on the pan — as heavy as the weight: light under 20, medium
 * up to 49, heavy from 50. A balloon (negative) is always light. No value: light.
 */
export function placeTap(value = 0) {
  if (!enabled) return
  const style = value >= 50 ? ImpactStyle.Heavy : value >= 20 ? ImpactStyle.Medium : ImpactStyle.Light
  Haptics.impact({ style }).catch(() => {})
}

/** A weight is picked up to drag: the lightest tick there is. */
export function pickupTap() {
  if (!enabled) return
  Haptics.selectionStart()
    .then(() => Haptics.selectionChanged())
    .then(() => Haptics.selectionEnd())
    .catch(() => {})
}

/** The beam locks at exactly 67 — the impact, before the celebration's Success. */
export function lockTap() {
  if (!enabled) return
  Haptics.impact({ style: ImpactStyle.Heavy }).catch(() => {})
}

/** A weight comes back off the pan. */
export function removeTap() {
  if (!enabled) return
  Haptics.impact({ style: ImpactStyle.Light }).catch(() => {})
}

/** An action was refused (budget full, locked weight). */
export function refuseTap() {
  if (!enabled) return
  Haptics.notification({ type: NotificationType.Warning }).catch(() => {})
}

/** Exactly 67 — the beam locks level. */
export function winTap() {
  if (!enabled) return
  Haptics.notification({ type: NotificationType.Success }).catch(() => {})
}
