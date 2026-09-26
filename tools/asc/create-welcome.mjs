// Create the one-time Welcome pack IAP (idempotent: product, en-US localization).
// Price ($0.99 USA base, equalized) and availability were set by price-welcome.mjs;
// the App Review screenshot must be 1170×2532 RGB PNG (1.3.0: done 2026-09-23, READY_TO_SUBMIT).
//   node tools/asc/create-welcome.mjs
import { asc } from './asc.mjs'
const APP = '6787536995'
const PID = 'com.noqyris.exactly67.welcome'
// Idempotent: reuse the product if it already exists.
const list = await asc('GET', `/v1/apps/${APP}/inAppPurchasesV2?filter[productId]=${PID}`)
let id = list.json?.data?.[0]?.id
if (!id) {
  const r = await asc('POST', '/v2/inAppPurchases', {
    data: {
      type: 'inAppPurchases',
      attributes: {
        name: 'Welcome Pack - 25 Hints',
        productId: PID,
        inAppPurchaseType: 'CONSUMABLE',
        familySharable: false,
        reviewNote:
          'Consumable welcome offer: grants 25 hints, used to reveal a helpful next piece in a level. Shown in the Store (top card), as "Welcome pack!" on the menu Store button and in the out-of-hints window, only to players who have never bought anything. After purchase it is never offered again. Hints never expire.',
      },
      relationships: { app: { data: { type: 'apps', id: APP } } },
    },
  })
  console.log('create', r.status, JSON.stringify(r.json).slice(0, 400))
  id = r.json?.data?.id
}
console.log('IAP id', id)
const locs = await asc('GET', `/v2/inAppPurchases/${id}/inAppPurchaseLocalizations`)
if (!locs.json?.data?.length) {
  const r = await asc('POST', '/v1/inAppPurchaseLocalizations', {
    data: {
      type: 'inAppPurchaseLocalizations',
      attributes: { locale: 'en-US', name: 'Welcome Pack: 25 Hints', description: 'A welcome offer: 25 hints to help you solve.' },
      relationships: { inAppPurchaseV2: { data: { type: 'inAppPurchases', id } } },
    },
  })
  console.log('localization', r.status, JSON.stringify(r.json).slice(0, 300))
} else console.log('localization exists')
