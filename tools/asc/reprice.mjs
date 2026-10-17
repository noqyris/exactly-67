// New US base prices for some in-app purchases, every other storefront equalized by Apple
// (owner's yes, 2026-10-17: Unlimited $9.99, 100 hints $4.99, No Ads $1.99).
//
//   node tools/asc/reprice.mjs snapshot <file.json>   # every storefront's price of every IAP (GET)
//   node tools/asc/reprice.mjs plan                   # base territory, manual prices, what would change (GET)
//   node tools/asc/reprice.mjs apply --yes            # write the new schedules
//   node tools/asc/reprice.mjs diff <file.json>       # what changed since the snapshot
//
// A schedule is replaced whole: POST /v1/inAppPurchasePriceSchedules with the USA as the base
// territory and one manual price (the new US one); Apple derives the other storefronts from it.
// `plan` refuses when a product has manual prices outside the USA, which a new schedule would drop
// (move them into PLAN first). After `apply`, `diff` must show only the products in PLAN changed.
import { readFileSync, writeFileSync } from 'node:fs'
import { asc } from './asc.mjs'

const APP = '6787536995'
const PLAN = {
  'com.noqyris.exactly67.removeads': '9.99', // Unlimited Hints + No Ads (was 4.99)
  'com.noqyris.exactly67.hints100': '4.99', // 100 hints (was 2.99)
  'com.noqyris.exactly67.noads': '1.99', // No Ads (was 0.99)
}

async function ok(method, path, body) {
  const r = await asc(method, path.replace('https://api.appstoreconnect.apple.com', ''), body)
  if (r.status >= 300) throw new Error(`${method} ${path} → ${r.status} ${JSON.stringify(r.json).slice(0, 400)}`)
  return r.json
}
async function all(path) {
  let data = []
  let included = []
  let next = path
  while (next) {
    const j = await ok('GET', next)
    data = data.concat(j.data ?? [])
    included = included.concat(j.included ?? [])
    next = j.links?.next ?? null
  }
  return { data, included }
}

async function products() {
  const { data } = await all(`/v1/apps/${APP}/inAppPurchasesV2?fields[inAppPurchases]=productId,name,state&limit=50`)
  return data.map((p) => ({ id: p.id, productId: p.attributes.productId, name: p.attributes.name, state: p.attributes.state }))
}

/** territory → customer price, plus which territories are manual, and the base. */
async function prices(iapId) {
  const base = (await ok('GET', `/v1/inAppPurchasePriceSchedules/${iapId}/baseTerritory`)).data?.id ?? null
  const out = {}
  const manual = []
  for (const kind of ['manualPrices', 'automaticPrices']) {
    const { data, included } = await all(
      `/v1/inAppPurchasePriceSchedules/${iapId}/${kind}?include=inAppPurchasePricePoint,territory&fields[inAppPurchasePricePoints]=customerPrice&limit=200`,
    )
    const pp = new Map(included.filter((x) => x.type === 'inAppPurchasePricePoints').map((x) => [x.id, x.attributes.customerPrice]))
    for (const p of data) {
      if (p.attributes?.endDate) continue // a scheduled-out price
      const t = p.relationships?.territory?.data?.id
      const point = p.relationships?.inAppPurchasePricePoint?.data?.id
      if (!t) continue
      out[t] = pp.get(point) ?? null
      if (kind === 'manualPrices') manual.push(t)
    }
  }
  return { base, manual, prices: out }
}

async function snapshot() {
  const snap = {}
  for (const p of await products()) snap[p.productId] = { name: p.name, ...(await prices(p.id)) }
  return snap
}

async function usPricePoint(iapId, price) {
  let next = `/v2/inAppPurchases/${iapId}/pricePoints?filter[territory]=USA&fields[inAppPurchasePricePoints]=customerPrice&limit=200`
  while (next) {
    const j = await ok('GET', next)
    const hit = (j.data ?? []).find((x) => x.attributes.customerPrice === price)
    if (hit) return hit.id
    next = j.links?.next ?? null
  }
  throw new Error(`no USA price point ${price} for ${iapId}`)
}

const [mode, arg, flag] = process.argv.slice(2)
if (mode === 'snapshot') {
  writeFileSync(arg, JSON.stringify(await snapshot(), null, 1))
  console.log(`snapshot → ${arg}`)
} else if (mode === 'plan' || mode === 'apply') {
  const list = await products()
  for (const [productId, price] of Object.entries(PLAN)) {
    const p = list.find((x) => x.productId === productId)
    if (!p) throw new Error(`${productId} not found`)
    const now = await prices(p.id)
    const otherManual = now.manual.filter((t) => t !== 'USA')
    console.log(`${productId} (${p.name}, ${p.state}): base ${now.base}, USA ${now.prices.USA} → ${price}; manual: ${now.manual.join(',') || '-'}`)
    if (otherManual.length) throw new Error(`${productId} has manual prices outside the USA (${otherManual.join(',')}); a new schedule would drop them`)
    if (mode === 'apply') {
      if (arg !== '--yes' && flag !== '--yes') throw new Error('apply writes prices: pass --yes')
      const pp = await usPricePoint(p.id, price)
      const r = await ok('POST', '/v1/inAppPurchasePriceSchedules', {
        data: {
          type: 'inAppPurchasePriceSchedules',
          relationships: {
            inAppPurchase: { data: { type: 'inAppPurchases', id: p.id } },
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
      console.log(`  written: schedule ${r.data?.id}`)
    }
  }
} else if (mode === 'diff') {
  const before = JSON.parse(readFileSync(arg, 'utf8'))
  const after = await snapshot()
  for (const [productId, b] of Object.entries(before)) {
    const a = after[productId]
    const changed = Object.keys({ ...b.prices, ...a.prices }).filter((t) => b.prices[t] !== a.prices[t])
    const sample = ['USA', 'GBR', 'DEU', 'FRA', 'THA', 'SRB'].map((t) => `${t} ${b.prices[t]}→${a.prices[t]}`).join(', ')
    console.log(`${productId}: ${changed.length} of ${Object.keys(a.prices).length} storefronts changed; base ${b.base}→${a.base}${changed.length ? `; ${sample}` : ''}`)
  }
} else {
  console.error('usage: node tools/asc/reprice.mjs snapshot <file> | plan | apply --yes | diff <file>')
  process.exit(2)
}
