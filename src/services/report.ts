import { Capacitor } from '@capacitor/core'

/**
 * "Report an ad" — Apple 2.5.18: an app with ads lets people report an
 * inappropriate or age-inappropriate one. With no backend, one tap opens the
 * mail app on a pre-written message to the address the support page and the
 * privacy policy already give (docs/index.html, docs/privacy.html), naming the
 * build at the bottom so the report can be matched to what that version
 * served. Ported from KVIZKO's services/report.ts.
 *
 * A `mailto:` is a main-frame navigation to a foreign scheme, which Capacitor's
 * iOS shell hands to the system instead of loading it in the WebView — so no
 * plugin is needed, and the browser dev build opens the desktop client.
 */

/** Where reports go — the support address on the support page and in the privacy policy. */
export const REPORT_ADDRESS = 'subotic.djo@gmail.com'

export const AD_REPORT = {
  /** The Settings row. */
  row: 'Report an ad',
  subject: 'Exactly 67 — ad report',
  whatLabel: 'What the ad showed',
  whereLabel: 'Where (banner, between levels, or a reward video)',
  whenLabel: 'When (roughly)',
} as const

export interface ReportContext {
  /** 'ios', 'android' or 'web'. */
  platform: string
  /** "1.3.0 (38)" — the build, baked in at build time (vite.config.ts). */
  version: string
}

/** The `mailto:` URL: the build in the subject, three prompts to fill in, the build again at the bottom. Pure, for the test. */
export function adReportUrl(ctx: ReportContext): string {
  const subject = `${AD_REPORT.subject} · ${ctx.version}`
  const body = [
    `${AD_REPORT.whatLabel}: `,
    '',
    `${AD_REPORT.whereLabel}: `,
    '',
    `${AD_REPORT.whenLabel}: `,
    '',
    '',
    '—',
    `Exactly 67 ${ctx.version} · ${ctx.platform}`,
  ].join('\n')
  return `mailto:${REPORT_ADDRESS}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
}

/** Open the mail app on an ad report. Never throws; a missing mail app is a no-op. */
export function reportAd(): void {
  const version = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'unknown'
  const url = adReportUrl({ platform: Capacitor.getPlatform(), version })
  try {
    window.location.assign(url)
  } catch {
    // no handler for the scheme — nothing to do
  }
}
