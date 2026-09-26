// Push the App Store listing from ios/App/fastlane/metadata + screenshots to the
// editable App Store version through the App Store Connect API.
//
// Why not `fastlane metadata` / `screenshots`: deliver only edits a version whose
// appVersionState is PREPARE_FOR_SUBMISSION (or a rejected/waiting state). A
// version with a build and complete metadata reads READY_FOR_REVIEW, which
// deliver does not look for — it then tries to CREATE the version and App Store
// Connect refuses ("The version number has been previously used").
//
//   node tools/asc/push-listing.mjs text   <version>   # text + review notes
//   node tools/asc/push-listing.mjs shots  <version>   # replace the screenshot sets
//
// en-US only. Screenshots: every PNG in ios/App/fastlane/screenshots/en-US, sorted
// by file name, grouped by pixel size (1320x2868 → iPhone 6.9", 2064x2752 → iPad 13").
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { asc } from './asc.mjs'

const APP = '6787536995'
const ROOT = new URL('../../ios/App/fastlane/', import.meta.url)
const META = new URL('metadata/', ROOT)
const SHOTS = new URL('screenshots/en-US/', ROOT)
const LOCALE = 'en-US'
const DISPLAY = { '1320x2868': 'APP_IPHONE_67', '2064x2752': 'APP_IPAD_PRO_3GEN_129' }

const [mode, versionString] = process.argv.slice(2)
if (!['text', 'shots'].includes(mode) || !versionString) {
  console.error('usage: node tools/asc/push-listing.mjs text|shots <version>')
  process.exit(2)
}

async function ok(method, path, body) {
  const r = await asc(method, path, body)
  if (r.status >= 300) throw new Error(`${method} ${path} → ${r.status} ${JSON.stringify(r.json).slice(0, 600)}`)
  return r.json
}
const read = (rel) => readFileSync(new URL(rel, META), 'utf8').replace(/\s+$/, '')

const versions = await ok('GET', `/v1/apps/${APP}/appStoreVersions?filter%5BversionString%5D=${versionString}&filter%5Bplatform%5D=IOS`)
const version = versions.data?.[0]
if (!version) throw new Error(`no App Store version ${versionString}`)
const state = version.attributes.appVersionState
if (!['PREPARE_FOR_SUBMISSION', 'READY_FOR_REVIEW', 'DEVELOPER_REJECTED', 'REJECTED', 'METADATA_REJECTED'].includes(state)) {
  throw new Error(`version ${versionString} is ${state}: not editable`)
}
const locs = await ok('GET', `/v1/appStoreVersions/${version.id}/appStoreVersionLocalizations`)
const loc = locs.data.find((l) => l.attributes.locale === LOCALE)
if (!loc) throw new Error(`no ${LOCALE} localization on ${versionString}`)

if (mode === 'text') {
  const attrs = {
    description: read(`${LOCALE}/description.txt`),
    keywords: read(`${LOCALE}/keywords.txt`),
    promotionalText: read(`${LOCALE}/promotional_text.txt`),
    whatsNew: read(`${LOCALE}/release_notes.txt`),
    marketingUrl: read(`${LOCALE}/marketing_url.txt`),
    supportUrl: read(`${LOCALE}/support_url.txt`),
  }
  await ok('PATCH', `/v1/appStoreVersionLocalizations/${loc.id}`, { data: { type: 'appStoreVersionLocalizations', id: loc.id, attributes: attrs } })
  console.log(`version localization ${LOCALE}: ${Object.keys(attrs).join(', ')}`)

  await ok('PATCH', `/v1/appStoreVersions/${version.id}`, {
    data: { type: 'appStoreVersions', id: version.id, attributes: { copyright: read('copyright.txt'), releaseType: 'MANUAL' } },
  })
  console.log('version: copyright, releaseType MANUAL')

  // Name, subtitle and privacy URL live on the app info that is being edited
  // alongside the version (not the one on sale).
  const infos = await ok('GET', `/v1/apps/${APP}/appInfos`)
  const info = infos.data.find((i) => !['READY_FOR_SALE', 'READY_FOR_DISTRIBUTION'].includes(i.attributes.appStoreState ?? i.attributes.state))
  if (!info) throw new Error('no editable app info')
  const infoLocs = await ok('GET', `/v1/appInfos/${info.id}/appInfoLocalizations`)
  const infoLoc = infoLocs.data.find((l) => l.attributes.locale === LOCALE)
  const infoAttrs = { name: read(`${LOCALE}/name.txt`), subtitle: read(`${LOCALE}/subtitle.txt`), privacyPolicyUrl: read(`${LOCALE}/privacy_url.txt`) }
  await ok('PATCH', `/v1/appInfoLocalizations/${infoLoc.id}`, { data: { type: 'appInfoLocalizations', id: infoLoc.id, attributes: infoAttrs } })
  console.log(`app info ${LOCALE}: name "${infoAttrs.name}", subtitle "${infoAttrs.subtitle}"`)

  const detail = await ok('GET', `/v1/appStoreVersions/${version.id}/appStoreReviewDetail`)
  const notes = read('review_information/notes.txt')
  await ok('PATCH', `/v1/appStoreReviewDetails/${detail.data.id}`, {
    data: { type: 'appStoreReviewDetails', id: detail.data.id, attributes: { notes, demoAccountRequired: false } },
  })
  console.log(`review notes: ${notes.length} chars`)
}

if (mode === 'shots') {
  const files = readdirSync(SHOTS).filter((f) => f.endsWith('.png')).sort()
  const groups = {}
  for (const f of files) {
    const buf = readFileSync(new URL(f, SHOTS))
    const size = `${buf.readUInt32BE(16)}x${buf.readUInt32BE(20)}`
    const type = DISPLAY[size]
    if (!type) throw new Error(`${f}: ${size} is not a size this script uploads`)
    ;(groups[type] ??= []).push({ f, buf })
  }
  const sets = await ok('GET', `/v1/appStoreVersionLocalizations/${loc.id}/appScreenshotSets?limit=50`)
  for (const [type, shots] of Object.entries(groups)) {
    let set = sets.data.find((s) => s.attributes.screenshotDisplayType === type)
    if (!set) {
      set = (await ok('POST', '/v1/appScreenshotSets', {
        data: { type: 'appScreenshotSets', attributes: { screenshotDisplayType: type }, relationships: { appStoreVersionLocalization: { data: { type: 'appStoreVersionLocalizations', id: loc.id } } } },
      })).data
    }
    const old = await ok('GET', `/v1/appScreenshotSets/${set.id}/appScreenshots?limit=50`)
    for (const s of old.data) await ok('DELETE', `/v1/appScreenshots/${s.id}`)
    console.log(`${type}: removed ${old.data.length} old`)
    const ids = []
    for (const { f, buf } of shots) {
      const res = (await ok('POST', '/v1/appScreenshots', {
        data: { type: 'appScreenshots', attributes: { fileName: f, fileSize: buf.length }, relationships: { appScreenshotSet: { data: { type: 'appScreenshotSets', id: set.id } } } },
      })).data
      for (const op of res.attributes.uploadOperations) {
        const headers = Object.fromEntries((op.requestHeaders ?? []).map((h) => [h.name, h.value]))
        const put = await fetch(op.url, { method: op.method, headers, body: buf.subarray(op.offset, op.offset + op.length) })
        if (!put.ok) throw new Error(`${f}: upload part → ${put.status}`)
      }
      const md5 = createHash('md5').update(buf).digest('hex')
      await ok('PATCH', `/v1/appScreenshots/${res.id}`, { data: { type: 'appScreenshots', id: res.id, attributes: { uploaded: true, sourceFileChecksum: md5 } } })
      ids.push(res.id)
      console.log(`${type}: uploaded ${f}`)
    }
    await ok('PATCH', `/v1/appScreenshotSets/${set.id}/relationships/appScreenshots`, { data: ids.map((id) => ({ type: 'appScreenshots', id })) })
    // Wait for Apple to process them; a failed asset shows up here, not at upload.
    for (let i = 0; i < 40; i++) {
      const now = await ok('GET', `/v1/appScreenshotSets/${set.id}/appScreenshots?limit=50`)
      const states = now.data.map((s) => s.attributes.assetDeliveryState?.state)
      if (states.every((s) => s === 'COMPLETE')) { console.log(`${type}: ${states.length} processed, in order`); break }
      if (states.some((s) => s === 'FAILED')) throw new Error(`${type}: processing FAILED ${JSON.stringify(now.data.map((s) => s.attributes.assetDeliveryState))}`)
      await new Promise((r) => setTimeout(r, 5000))
    }
  }
}
