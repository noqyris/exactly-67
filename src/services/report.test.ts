import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { AD_REPORT, adReportUrl, REPORT_ADDRESS } from './report'

/**
 * "Report an ad" (Apple 2.5.18) — a pre-written mail to the support address the
 * game already publishes, naming the build that served the ad.
 */

const ctx = { platform: 'ios', version: '1.3.0 (38)' }

describe('an ad report', () => {
  it('goes to the support address the support page and the privacy policy already give — none invented', () => {
    for (const page of ['../../docs/index.html', '../../docs/privacy.html']) {
      expect(readFileSync(new URL(page, import.meta.url), 'utf8'), page).toContain(`mailto:${REPORT_ADDRESS}`)
    }
  })

  it('is a mailto that says what it is and which build in the subject, with prompts to fill in and the build at the bottom', () => {
    const url = adReportUrl(ctx)
    expect(url.startsWith(`mailto:${REPORT_ADDRESS}?subject=`)).toBe(true)
    const params = new URLSearchParams(url.slice(url.indexOf('?') + 1))
    expect(params.get('subject')).toBe('Exactly 67 — ad report · 1.3.0 (38)')
    const body = params.get('body') ?? ''
    expect(body).toContain(`${AD_REPORT.whatLabel}: \n`)
    expect(body).toContain(`${AD_REPORT.whereLabel}: \n`)
    expect(body).toContain(`${AD_REPORT.whenLabel}: \n`)
    expect(body.endsWith('Exactly 67 1.3.0 (38) · ios')).toBe(true)
  })

  it('encodes the text, so a mail client receives every character', () => {
    const url = adReportUrl(ctx)
    expect(url).not.toMatch(/[\s—·]/)
    expect(url).toContain('%E2%80%94') // the em dash in the subject
  })

  it('the build is baked in at build time from project.pbxproj (vite.config.ts)', () => {
    const version = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : ''
    const pbx = readFileSync(new URL('../../ios/App/App.xcodeproj/project.pbxproj', import.meta.url), 'utf8')
    const marketing = /MARKETING_VERSION = ([0-9.]+);/.exec(pbx)?.[1]
    const build = /CURRENT_PROJECT_VERSION = ([0-9]+);/.exec(pbx)?.[1]
    expect(version).toBe(`${marketing} (${build})`)
  })
})
