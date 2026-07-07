/**
 * Set inventory levels for every inventory item at the EBMX Warehouse location.
 *
 * Sets stocked_quantity = DEFAULT_STOCK_QTY (default 999) so items show as
 * "in stock" on the storefront. Safe to re-run — existing levels are updated
 * in place, new ones are created.
 *
 * Against the live backend:
 *   MEDUSA_BACKEND_URL=https://your-backend.railway.app \
 *   MEDUSA_ADMIN_PASSWORD=xxx \
 *   ts-node --project tsconfig.json src/scripts/set-inventory-levels.ts
 *
 * Against local dev (server must be running):
 *   npm run set:inventory
 */

import { loadEnv } from '@medusajs/utils'
loadEnv(process.env.NODE_ENV || 'development', process.cwd())

const BACKEND        = process.env.MEDUSA_BACKEND_URL    ?? 'http://localhost:9000'
const ADMIN_EMAIL    = process.env.MEDUSA_ADMIN_EMAIL    ?? 'admin@ebmx.com.au'
const ADMIN_PASSWORD = process.env.MEDUSA_ADMIN_PASSWORD ?? ''
const STOCK_QTY      = Number(process.env.DEFAULT_STOCK_QTY) || 999

if (!ADMIN_PASSWORD) {
  console.error('Set MEDUSA_ADMIN_PASSWORD in .env or environment')
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
  console.log(`Target: ${BACKEND}`)

  // 1. Auth
  const { token } = await api<{ token: string }>(
    'POST', '/auth/user/emailpass', undefined,
    { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  )
  console.log('✓ Authenticated')

  // 2. Stock location
  const { stock_locations = [] } = await api<{ stock_locations: { id: string; name: string }[] }>(
    'GET', '/admin/stock-locations?limit=5', token,
  )
  if (!stock_locations.length) {
    console.error('✗ No stock locations found — run setup:shipping first')
    process.exit(1)
  }
  const location = stock_locations[0]
  console.log(`✓ Location: "${location.name}" (${location.id})`)

  // 3. Fetch all inventory items (paginated)
  const items: { id: string; sku?: string }[] = []
  let offset = 0
  const limit = 50
  while (true) {
    const { inventory_items, count } = await api<{
      inventory_items: { id: string; sku?: string }[]
      count: number
    }>('GET', `/admin/inventory-items?limit=${limit}&offset=${offset}`, token)
    items.push(...inventory_items)
    if (items.length >= count) break
    offset += limit
  }
  console.log(`✓ Found ${items.length} inventory items`)

  // 4. Fetch existing levels at this location so we know which to update vs create
  const { inventory_levels: existingLevels = [] } = await api<{
    inventory_levels: { id: string; inventory_item_id: string; location_id: string }[]
  }>(`GET`, `/admin/stock-locations/${location.id}/inventory-items?limit=500`, token).catch(() => ({ inventory_levels: [] }))

  const existingItemIds = new Set(existingLevels.map((l: any) => l.inventory_item_id))

  let created = 0
  let updated = 0
  let failed = 0

  for (const item of items) {
    try {
      if (existingItemIds.has(item.id)) {
        // Update existing level
        await api('POST', `/admin/inventory-items/${item.id}/location-levels/${location.id}`, token, {
          stocked_quantity: STOCK_QTY,
        })
        updated++
      } else {
        // Create new level
        await api('POST', `/admin/inventory-items/${item.id}/location-levels`, token, {
          location_id: location.id,
          stocked_quantity: STOCK_QTY,
        })
        created++
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      // 409 = level already exists — try update path
      if (msg.includes('409') || msg.toLowerCase().includes('already')) {
        try {
          await api('POST', `/admin/inventory-items/${item.id}/location-levels/${location.id}`, token, {
            stocked_quantity: STOCK_QTY,
          })
          updated++
        } catch {
          console.warn(`  ✗ Could not set level for ${item.id} (${item.sku ?? 'no sku'})`)
          failed++
        }
      } else {
        console.warn(`  ✗ ${item.id} (${item.sku ?? 'no sku'}): ${msg.slice(0, 120)}`)
        failed++
      }
    }
  }

  console.log(`\n✓ Done — created: ${created}, updated: ${updated}, failed: ${failed}`)
  console.log(`  stocked_quantity = ${STOCK_QTY} at "${location.name}"`)
}

main().catch(err => {
  console.error('\n✗ Fatal:', err instanceof Error ? err.message : err)
  process.exit(1)
})
