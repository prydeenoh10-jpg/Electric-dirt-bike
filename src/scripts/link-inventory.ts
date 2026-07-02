/**
 * EBMX Inventory Link — Medusa v2
 *
 * Links the EBMX Warehouse stock location to the default sales channel.
 * Without this, GET /store/shipping-options returns nothing because Medusa
 * can't traverse Cart → Sales Channel → Stock Location → Fulfillment Set.
 *
 * Run while the dev server is up: npm run link:inventory
 */

import { loadEnv } from '@medusajs/utils'
loadEnv(process.env.NODE_ENV || 'development', process.cwd())

const BACKEND        = process.env.MEDUSA_BACKEND_URL    ?? 'http://localhost:9000'
const ADMIN_EMAIL    = process.env.MEDUSA_ADMIN_EMAIL    ?? 'admin@ebmx.com.au'
const ADMIN_PASSWORD = process.env.MEDUSA_ADMIN_PASSWORD ?? ''

if (!ADMIN_PASSWORD) {
  console.error('Set MEDUSA_ADMIN_PASSWORD in .env')
  process.exit(1)
}

async function api<T>(method: string, path: string, token?: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BACKEND}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '(no body)')
    throw new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 400)}`)
  }
  return res.json() as Promise<T>
}

async function main() {
  // 1. Auth
  const { token } = await api<{ token: string }>(
    'POST', '/auth/user/emailpass', undefined,
    { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  )
  console.log('✓ Authenticated')

  // 2. Default sales channel
  const { sales_channels = [] } = await api<{ sales_channels: { id: string; name: string }[] }>(
    'GET', '/admin/sales-channels?limit=5', token,
  )
  if (!sales_channels.length) { console.error('✗ No sales channels found'); process.exit(1) }
  const sc = sales_channels[0]
  console.log(`✓ Sales channel: "${sc.name}" (${sc.id})`)

  // 3. Stock location
  const { stock_locations = [] } = await api<{ stock_locations: { id: string; name: string }[] }>(
    'GET', '/admin/stock-locations?limit=5', token,
  )
  if (!stock_locations.length) { console.error('✗ No stock locations found'); process.exit(1) }
  const sl = stock_locations[0]
  console.log(`✓ Stock location: "${sl.name}" (${sl.id})`)

  // 4. Link stock location → sales channel (idempotent — 400 means already linked)
  try {
    await api('POST', `/admin/sales-channels/${sc.id}/stock-locations`, token, {
      add: [sl.id],
    })
    console.log('✓ Stock location linked to sales channel')
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('400') || msg.toLowerCase().includes('already')) {
      console.log('✓ Already linked — nothing to do')
    } else {
      // Try alternate endpoint format
      try {
        await api('POST', `/admin/stock-locations/${sl.id}/sales-channels`, token, {
          add: [sc.id],
        })
        console.log('✓ Stock location linked to sales channel (alt endpoint)')
      } catch (err2) {
        throw new Error(`Could not link: ${msg} | ${err2 instanceof Error ? err2.message : err2}`)
      }
    }
  }

  console.log('\n✓ Done. Checkout should now find shipping options.')
}

main().catch(err => {
  console.error('\n✗ Fatal:', err instanceof Error ? err.message : err)
  process.exit(1)
})
