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

/** A weight lands on the pan. */
export function placeTap() {
  if (!enabled) return
  Haptics.impact({ style: ImpactStyle.Light }).catch(() => {})
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
