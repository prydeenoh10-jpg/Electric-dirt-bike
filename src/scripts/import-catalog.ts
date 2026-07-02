/**
 * EBMX Catalog Import Script — Medusa v2
 *
 * Reads ../catalog-export.json and imports all products via the Admin REST API.
 * Idempotent: products whose handle already exists are skipped so re-running
 * resumes from where it left off.
 *
 * Usage (from ebmx-backend/):
 *   npm run import:catalog
 */

import fs from 'fs'
import path from 'path'

// ── Config ────────────────────────────────────────────────────────────────────
const BACKEND       = process.env.MEDUSA_BACKEND_URL   ?? 'http://localhost:9000'
const ADMIN_EMAIL   = process.env.MEDUSA_ADMIN_EMAIL   ?? 'admin@ebmx.com.au'
const ADMIN_PASSWORD = process.env.MEDUSA_ADMIN_PASSWORD ?? ''
const CATALOG_PATH  = path.join(__dirname, '../../catalog-export.json')
const TIMEOUT_MS    = 60_000
const MAX_RETRIES   = 2

if (!ADMIN_PASSWORD) {
  console.error('Set MEDUSA_ADMIN_PASSWORD in .env before running.')
  process.exit(1)
}

// ── Types ─────────────────────────────────────────────────────────────────────
interface RawProduct {
  id: number; name: string; cat: string; img: string
  price: string | null; was: string | null; priceNum: number
  inStock: boolean; short: string
}
interface MedusaVariant {
  id: string
  inventory_items?: { inventory_item_id: string }[]
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// Repair UTF-8 bytes stored as Latin-1 codepoints (e.g. â → –, â³ → ″)
function fixMojibake(s: string): string {
  try {
    const fixed = Buffer.from(s, 'latin1').toString('utf8')
    if (!fixed.includes('�')) return fixed
  } catch { /* fall through */ }
  return s
}

function slugify(s: string): string {
  return s
    .replace(/[^\x20-\x7E]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')        // collapse repeated dashes
    .slice(0, 100)              // generous limit on full title, trim after
    .replace(/^-+|-+$/g, '')   // strip any leading/trailing dashes post-slice
    || 'product'
}

function withTimeout(ms: number): { signal: AbortSignal; clear: () => void } {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  return { signal: controller.signal, clear: () => clearTimeout(timer) }
}

// Retries on AbortError (timeout) and 5xx. Throws immediately on 4xx.
async function adminFetch<T>(
  method: 'GET' | 'POST',
  urlPath: string,
  token: string,
  body?: unknown,
): Promise<T> {
  let lastErr: unknown
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const { signal, clear } = withTimeout(TIMEOUT_MS)
    try {
      const res = await fetch(`${BACKEND}${urlPath}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal,
      })

      if (!res.ok) {
        const text = await res.text().catch(() => '(no body)')
        const isRetryable = res.status >= 500
        const msg = `${method} ${urlPath} → ${res.status}: ${text}`
        if (isRetryable && attempt < MAX_RETRIES) {
          console.error(`  ↻ ${res.status} on attempt ${attempt + 1}, retrying… — ${text.slice(0, 200)}`)
          lastErr = new Error(msg)
          continue
        }
        throw new Error(msg)
      }
      return res.json() as Promise<T>
    } catch (err) {
      lastErr = err
      const isAbort = err instanceof Error && err.name === 'AbortError'
      if (isAbort && attempt < MAX_RETRIES) {
        console.error(`  ↻ timeout on attempt ${attempt + 1}, retrying…`)
        continue
      }
      throw err
    } finally {
      clear()
    }
  }
  throw lastErr
}

const adminPost = <T>(path: string, body: unknown, token: string) =>
  adminFetch<T>('POST', path, token, body)

const adminGet = <T>(path: string, token: string) =>
  adminFetch<T>('GET', path, token)

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  // 1. Read catalog
  if (!fs.existsSync(CATALOG_PATH)) {
    console.error(`Catalog not found: ${CATALOG_PATH}`)
    console.error('Run  npm run export:catalog  in the storefront first.')
    process.exit(1)
  }
  const catalog: RawProduct[] = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'))
  console.log(`✓ Loaded ${catalog.length} products`)

  // 2. Auth
  const { token } = await adminPost<{ token: string }>(
    '/auth/user/emailpass', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD }, '',
  )
  console.log('✓ Authenticated')

  // 3. Australia region
  const { regions = [] } = await adminGet<{ regions: { id: string; currency_code: string; name: string }[] }>(
    '/admin/regions?limit=50', token,
  )
  const ausRegion = regions.find(r => r.currency_code === 'aud' || r.name.toLowerCase().includes('australia'))
  if (ausRegion) {
    console.log(`✓ Region: "${ausRegion.name}"`)
  } else {
    await adminPost('/admin/regions', { name: 'Australia', currency_code: 'aud', countries: ['au'] }, token)
    console.log('✓ Created Australia region')
  }

  // 4. Sales channel
  const { sales_channels = [] } = await adminGet<{ sales_channels: { id: string; name: string }[] }>(
    '/admin/sales-channels?limit=5', token,
  )
  if (!sales_channels.length) { console.error('No sales channels found.'); process.exit(1) }
  const scId = sales_channels[0].id
  console.log(`✓ Sales channel: "${sales_channels[0].name}"`)

  // 5. Stock location
  const { stock_locations = [] } = await adminGet<{ stock_locations: { id: string; name: string }[] }>(
    '/admin/stock-locations?limit=5', token,
  )
  let stockLocationId: string
  if (stock_locations.length) {
    stockLocationId = stock_locations[0].id
    console.log(`✓ Stock location: "${stock_locations[0].name}"`)
  } else {
    const { stock_location } = await adminPost<{ stock_location: { id: string } }>(
      '/admin/stock-locations', { name: 'EBMX Warehouse' }, token,
    )
    stockLocationId = stock_location.id
    console.log('✓ Created stock location "EBMX Warehouse"')
  }

  // 6. Categories — ensure all exist
  const { product_categories: existingCats = [] } = await adminGet<{
    product_categories: { id: string; name: string }[]
  }>('/admin/product-categories?limit=200', token)
  const catByName = new Map<string, string>(existingCats.map(c => [c.name, c.id]))

  for (const catName of [...new Set(catalog.map(p => p.cat))]) {
    if (catByName.has(catName)) continue
    try {
      const { product_category } = await adminPost<{ product_category: { id: string } }>(
        '/admin/product-categories',
        { name: catName, handle: slugify(catName), is_active: true, is_internal: false },
        token,
      )
      catByName.set(catName, product_category.id)
    } catch (err) {
      console.warn(`  ⚠ Category "${catName}" failed: ${err}`)
    }
  }
  console.log(`✓ Categories ready (${catByName.size})`)

  // 7. Existing handles for idempotency
  const existingHandles = new Set<string>()
  let offset = 0
  while (true) {
    const { products: batch = [], count = 0 } = await adminGet<{
      products: { handle: string }[]; count: number
    }>(`/admin/products?limit=100&offset=${offset}&fields=handle`, token)
    if (!batch.length) break
    batch.forEach(p => existingHandles.add(p.handle))
    offset += batch.length
    if (offset >= count) break
  }
  console.log(`✓ ${existingHandles.size} products already imported (will skip)`)

  // 8. Import products — strictly sequential
  console.log('\nImporting products…\n')
  const total = catalog.length
  let created = 0, skipped = 0, failed = 0

  for (let i = 0; i < catalog.length; i++) {
    const item = catalog[i]
    const pos = `[${i + 1}/${total}]`

    // Handle uses original ASCII-safe name — stable across re-runs
    const handle = `${item.id}-${slugify(item.name)}`

    if (existingHandles.has(handle)) {
      skipped++
      // Uncomment to see skips: console.log(`${pos} skip  ${handle}`)
      continue
    }

    const title       = fixMojibake(item.name)
    const description = fixMojibake(item.short || '')
    // Medusa v2 stores prices as full currency amounts (not cents)
    const priceAmount = item.priceNum > 0 ? item.priceNum : null

    const payload: Record<string, unknown> = {
      title,
      handle,
      description,
      thumbnail: item.img,          // URL string — never fetched, passed through as reference
      status: 'published',
      sales_channels: [{ id: scId }],
      options: [{ title: 'Default', values: ['Default'] }],
      variants: [{
        title: 'Default',
        options: { Default: 'Default' },
        manage_inventory: true,
        prices: priceAmount ? [{ amount: priceAmount, currency_code: 'aud' }] : [],
      }],
    }
    const catId = catByName.get(item.cat)
    if (catId) payload.categories = [{ id: catId }]

    try {
      // Create product
      const { product } = await adminPost<{ product: { id: string; variants: { id: string }[] } }>(
        '/admin/products', payload, token,
      )

      // Set inventory level separately (GET expanded product → POST location level)
      let inventoryNote = ''
      try {
        const { product: full } = await adminGet<{ product: { variants: MedusaVariant[] } }>(
          `/admin/products/${product.id}?fields=*variants.inventory_items`, token,
        )
        const invItemId = full.variants?.[0]?.inventory_items?.[0]?.inventory_item_id
        if (invItemId) {
          await adminPost(
            `/admin/inventory-items/${invItemId}/location-levels`,
            { location_id: stockLocationId, stocked_quantity: item.inStock ? 999 : 0 },
            token,
          )
          inventoryNote = ` (stock: ${item.inStock ? 999 : 0})`
        }
      } catch (invErr) {
        inventoryNote = ` ⚠ inv failed: ${invErr instanceof Error ? invErr.message.slice(0, 80) : invErr}`
      }

      created++
      console.log(`${pos} created ✓  ${title.slice(0, 70)}${inventoryNote}`)
    } catch (err) {
      failed++
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`${pos} FAILED ✗  ${title.slice(0, 60)}\n         ${msg}`)
    }
  }

  console.log(`
─────────────────────────────
  Created : ${created}
  Skipped : ${skipped}  (already existed)
  Failed  : ${failed}
  Total   : ${created + skipped} / ${total}
─────────────────────────────`)

  if (failed > 0) {
    console.log('Re-run to retry failed products (idempotent — skips existing).')
    process.exit(1)
  }
}

main().catch(err => {
  console.error('\n✗ Fatal:', err instanceof Error ? err.message : err)
  process.exit(1)
})
