// Minimal App Store Connect API client (ES256 JWT). Usage: node asc.mjs GET /v1/apps/6787536995/inAppPurchasesV2
import { readFileSync } from 'node:fs'
import { createSign } from 'node:crypto'
const KEY = JSON.parse(readFileSync(new URL('../../ios/App/fastlane/keys/asc_api_key.json', import.meta.url), 'utf8'))
const b64u = (b) => Buffer.from(b).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
function jwt() {
  const header = b64u(JSON.stringify({ alg: 'ES256', kid: KEY.key_id, typ: 'JWT' }))
  const now = Math.floor(Date.now() / 1000)
  const payload = b64u(JSON.stringify({ iss: KEY.issuer_id, iat: now, exp: now + 1100, aud: 'appstoreconnect-v1' }))
  const sig = createSign('SHA256').update(`${header}.${payload}`).sign({ key: KEY.key, dsaEncoding: 'ieee-p1363' })
  return `${header}.${payload}.${b64u(sig)}`
}
export async function asc(method, path, body) {
  const res = await fetch(`https://api.appstoreconnect.apple.com${path}`, {
    method,
    headers: { Authorization: `Bearer ${jwt()}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let json = null
  try { json = text ? JSON.parse(text) : null } catch { json = text }
  return { status: res.status, json }
}
if (import.meta.url === `file://${process.argv[1]}`) {
  const [method, path, body] = process.argv.slice(2)
  const r = await asc(method, path, body ? JSON.parse(body) : undefined)
  console.log(r.status, JSON.stringify(r.json, null, 1).slice(0, Number(process.env.MAX ?? 6000)))
}
