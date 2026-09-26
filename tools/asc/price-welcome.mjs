import { asc } from './asc.mjs'
const ID = '6815249746'
const REF = '6800693281' // hints10: copy its territory availability
// 1. Price: USA base at $0.99, equalized everywhere else by Apple.
let pp = null
let next = `/v2/inAppPurchases/${ID}/pricePoints?filter[territory]=USA&limit=200`
while (next && !pp) {
  const r = await asc('GET', next.replace('https://api.appstoreconnect.apple.com', ''))
  pp = r.json.data.find((p) => p.attributes.customerPrice === '0.99')?.id ?? null
  next = r.json.links?.next ?? null
}
console.log('price point', pp)
const sched = await asc('POST', '/v1/inAppPurchasePriceSchedules', {
  data: {
    type: 'inAppPurchasePriceSchedules',
    relationships: {
      inAppPurchase: { data: { type: 'inAppPurchases', id: ID } },
      baseTerritory: { data: { type: 'territories', id: 'USA' } },
      manualPrices: { data: [{ type: 'inAppPurchasePrices', id: '${price1}' }] },
    },
  },
  included: [
    {
      type: 'inAppPurchasePrices',
      id: '${price1}',
      attributes: { startDate: null },
      relationships: { inAppPurchasePricePoint: { data: { type: 'inAppPurchasePricePoints', id: pp } } },
    },
  ],
})
console.log('price schedule', sched.status, JSON.stringify(sched.json).slice(0, 200))
// 2. Availability: the same territories as the 10-hint pack.
const terr = []
let t = `/v1/inAppPurchaseAvailabilities/${REF}/availableTerritories?limit=200`
while (t) {
  const r = await asc('GET', t.replace('https://api.appstoreconnect.apple.com', ''))
  terr.push(...r.json.data.map((x) => ({ type: 'territories', id: x.id })))
  t = r.json.links?.next ?? null
}
console.log('territories', terr.length)
const av = await asc('POST', '/v1/inAppPurchaseAvailabilities', {
  data: {
    type: 'inAppPurchaseAvailabilities',
    attributes: { availableInNewTerritories: true },
    relationships: {
      inAppPurchase: { data: { type: 'inAppPurchases', id: ID } },
      availableTerritories: { data: terr },
    },
  },
})
console.log('availability', av.status, JSON.stringify(av.json).slice(0, 200))
