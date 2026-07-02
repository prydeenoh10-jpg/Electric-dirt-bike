/**
 * EBMX Fix Prices — one-off + idempotent
 *
 * Two-part fix:
 *   1. Australia region → automatic_taxes: false  (prices are GST-inclusive;
 *      Medusa must not stack 10% on top at checkout)
 *   2. Re-price every variant: stored price was priceNum (ex-GST from WooCommerce
 *      export).  Correct price = Math.round(priceNum * 1.1) — the full AUD retail
 *      amount including GST.
 *
 * Idempotent: skips variants whose AUD price already equals the target.
 * Run while dev server is up: npm run fix:prices
 */

import fs from 'fs'
import path from 'path'
import { loadEnv } from '@medusajs/utils'
loadEnv(process.env.NODE_ENV || 'development', process.cwd())

const BACKEND        = process.env.MEDUSA_BACKEND_URL    ?? 'http://localhost:9000'
const ADMIN_EMAIL    = process.env.MEDUSA_ADMIN_EMAIL    ?? 'admin@ebmx.com.au'
const ADMIN_PASSWORD = process.env.MEDUSA_ADMIN_PASSWORD ?? ''
const CATALOG_PATH   = path.join(__dirname, '../../catalog-export.json')

if (!ADMIN_PASSWORD) { console.error('Set MEDUSA_ADMIN_PASSWORD in .env'); process.exit(1) }

interface RawProduct { id: number; name: string; priceNum: number }
interface AdminVariant {
  id: string
  prices?: { currency_code: string; amount: number; id: string }[]
}
interface AdminProduct {
  id: string
  handle: string
  title: string
  variants?: AdminVariant[]
}

// ── helpers ───────────────────────────────────────────────────────────────────

function slugify(s: string): string {
  return s
    .replace(/[^\x20-\x7E]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 100)
    .replace(/^-+|-+$/g, '')
    || 'product'
}

function fixMojibake(s: string): string {
  try {
    const fixed = Buffer.from(s, 'latin1').toString('utf8')
    if (!fixed.includes('�')) return fixed
  } catch { /* fall through */ }
  return s
}

async function api<T>(method: string, urlPath: string, token?: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BACKEND}${urlPath}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '(no body)')
    throw new Error(`${method} ${urlPath} → ${res.status}: ${text.slice(0, 400)}`)
  }
  return res.json() as Promise<T>
}

async function fetchAllProducts(token: string): Promise<AdminProduct[]> {
  const all: AdminProduct[] = []
  const limit = 100
  let offset = 0
  while (true) {
    const { products, count } = await api<{ products: AdminProduct[]; count: number }>(
      'GET',
      `/admin/products?limit=${limit}&offset=${offset}&fields=id,handle,title,*variants,*variants.prices`,
      token,
    )
    all.push(...products)
    offset += products.length
    if (offset >= count || products.length === 0) break
  }
  return all
}

// ── main ──────────────────────────────────────────────────────────────────────

async function main() {
  // ── Load catalog ──────────────────────────────────────────────────────────
  if (!fs.existsSync(CATALOG_PATH)) {
    console.error(`Catalog not found: ${CATALOG_PATH}`)
    process.exit(1)
  }
  const catalog: RawProduct[] = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'))
  console.log(`✓ Loaded ${catalog.length} catalog entries`)

  // Build lookup maps  handle → priceNum  AND  normalised-title → priceNum
  const byHandle = new Map<string, number>()
  const byTitle  = new Map<string, number>()
  for (const item of catalog) {
    const handle = `${item.id}-${slugify(item.name)}`
    byHandle.set(handle, item.priceNum)
    byTitle.set(fixMojibake(item.name).toLowerCase().trim(), item.priceNum)
    byTitle.set(item.name.toLowerCase().trim(), item.priceNum)  // raw fallback
  }

  // ── Auth ──────────────────────────────────────────────────────────────────
  const { token } = await api<{ token: string }>(
    'POST', '/auth/user/emailpass', undefined,
    { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  )
  console.log('✓ Authenticated')

  // ── Part 1: Australia region → automatic_taxes: false ─────────────────────
  const { regions = [] } = await api<{ regions: { id: string; name: string; currency_code: string; automatic_taxes?: boolean }[] }>(
    'GET', '/admin/regions?limit=50', token,
  )
  const ausRegion = regions.find(r => r.currency_code === 'aud' || r.name.toLowerCase().includes('australia'))
  if (!ausRegion) {
    console.warn('⚠ Australia region not found — skipping tax config')
  } else if (ausRegion.automatic_taxes === false) {
    console.log(`✓ Region "${ausRegion.name}" already has automatic_taxes=false`)
  } else {
    try {
      await api('POST', `/admin/regions/${ausRegion.id}`, token, { automatic_taxes: false })
      console.log(`✓ Region "${ausRegion.name}" → automatic_taxes=false (GST-inclusive mode)`)
    } catch (err) {
      // Some Medusa v2 builds use different update mechanics — warn but continue
      console.warn(`⚠ Could not update region taxes: ${err instanceof Error ? err.message.slice(0, 100) : err}`)
    }
  }

  // ── Part 2: re-price all variants ──────────────────────────────────────────
  const products = await fetchAllProducts(token)
  console.log(`✓ Fetched ${products.length} products from Medusa\n`)

  let updated = 0
  let skipped = 0
  let noMatch = 0

  for (const product of products) {
    // Find the catalog priceNum by handle first, then title fallback
    let rawPrice = byHandle.get(product.handle)
    if (rawPrice === undefined) {
      rawPrice = byTitle.get(product.title.toLowerCase().trim())
    }
    if (rawPrice === undefined) {
      console.warn(`  NO MATCH: "${product.title.slice(0, 60)}" (handle: ${product.handle})`)
      noMatch++
      continue
    }

    // Correct GST-inclusive price: WooCommerce exported ex-GST, so multiply × 1.1
    const targetPrice = Math.round(rawPrice * 1.1)

    const variant = product.variants?.[0]
    if (!variant) {
      console.warn(`  NO VARIANT: "${product.title.slice(0, 60)}"`)
      noMatch++
      continue
    }

    // Check current AUD price (idempotent)
    const currentAud = variant.prices?.find(p => p.currency_code === 'aud')
    if (currentAud && currentAud.amount === targetPrice) {
      skipped++
      continue
    }

    const prevAmount = currentAud?.amount ?? '(none)'
    try {
      await api(
        'POST',
        `/admin/products/${product.id}/variants/${variant.id}`,
        token,
        { prices: [{ currency_code: 'aud', amount: targetPrice }] },
      )
      console.log(`  $${String(prevAmount).padStart(8)} → $${targetPrice}  "${product.title.slice(0, 55)}"`)
      updated++
    } catch (err) {
      console.warn(`  ERROR "${product.title.slice(0, 50)}": ${err instanceof Error ? err.message.slice(0, 100) : err}`)
      noMatch++
    }
  }

  console.log(`
──────────────────────────────────────
  Updated : ${updated}
  Skipped : ${skipped}  (already correct)
  No match: ${noMatch}
──────────────────────────────────────`)
}

main().catch(err => {
  console.error('\n✗ Fatal:', err instanceof Error ? err.message : err)
  process.exit(1)
})
