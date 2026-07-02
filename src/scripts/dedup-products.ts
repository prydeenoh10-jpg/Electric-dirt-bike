/**
 * EBMX Dedup Products — one-off cleanup
 *
 * Removes duplicate products created by partial imports.
 * For each title with >1 product: keeps the OLDEST, deletes newer copies
 * that have no order line-item references.
 *
 * Run while dev server is up: npm run dedup:products
 * Idempotent — safe to re-run.
 */

import { loadEnv } from '@medusajs/utils'
loadEnv(process.env.NODE_ENV || 'development', process.cwd())

const BACKEND        = process.env.MEDUSA_BACKEND_URL    ?? 'http://localhost:9000'
const ADMIN_EMAIL    = process.env.MEDUSA_ADMIN_EMAIL    ?? 'admin@ebmx.com.au'
const ADMIN_PASSWORD = process.env.MEDUSA_ADMIN_PASSWORD ?? ''

if (!ADMIN_PASSWORD) { console.error('Set MEDUSA_ADMIN_PASSWORD in .env'); process.exit(1) }

interface Product {
  id: string
  title: string
  created_at: string
  variants?: { id: string }[]
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

async function fetchAllProducts(token: string): Promise<Product[]> {
  const all: Product[] = []
  const limit = 100
  let offset = 0
  while (true) {
    const { products, count } = await api<{ products: Product[]; count: number }>(
      'GET', `/admin/products?limit=${limit}&offset=${offset}&fields=id,title,created_at,*variants`, token,
    )
    all.push(...products)
    offset += products.length
    if (offset >= count || products.length === 0) break
  }
  return all
}

/** Fetch all orders with line items and return the set of variant IDs that appear in any order. */
async function fetchReferencedVariantIds(token: string): Promise<Set<string>> {
  const referenced = new Set<string>()
  const limit = 100
  let offset = 0
  while (true) {
    const { orders, count } = await api<{
      orders: { id: string; items?: { variant_id?: string | null }[] }[]
      count: number
    }>('GET', `/admin/orders?limit=${limit}&offset=${offset}&fields=id,*items`, token)

    for (const order of orders) {
      for (const item of order.items ?? []) {
        if (item.variant_id) referenced.add(item.variant_id)
      }
    }
    offset += orders.length
    if (offset >= count || orders.length === 0) break
  }
  return referenced
}

async function main() {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const { token } = await api<{ token: string }>(
    'POST', '/auth/user/emailpass', undefined,
    { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  )
  console.log('✓ Authenticated')

  // ── Fetch all products ────────────────────────────────────────────────────
  const products = await fetchAllProducts(token)
  console.log(`✓ Fetched ${products.length} products total`)

  // ── Pre-fetch all referenced variant IDs from orders ─────────────────────
  const referencedVariantIds = await fetchReferencedVariantIds(token)
  console.log(`✓ Found ${referencedVariantIds.size} variant(s) referenced in orders`)

  // ── Group by exact title ──────────────────────────────────────────────────
  const byTitle = new Map<string, Product[]>()
  for (const p of products) {
    const bucket = byTitle.get(p.title) ?? []
    bucket.push(p)
    byTitle.set(p.title, bucket)
  }

  const duplicateTitles = [...byTitle.entries()].filter(([, v]) => v.length > 1)
  console.log(`Found ${duplicateTitles.length} titles with duplicates\n`)

  if (duplicateTitles.length === 0) {
    console.log('✓ No duplicates — nothing to do.')
    return
  }

  // ── Process duplicates ────────────────────────────────────────────────────
  let deleted = 0
  let skipped = 0

  for (const [title, copies] of duplicateTitles) {
    // Sort oldest first (keep the earliest-created copy)
    copies.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())

    const label = title.length > 60 ? title.slice(0, 57) + '…' : title

    // For each copy, determine if it has order references
    const isReferenced = (p: Product) =>
      (p.variants ?? []).some(v => referencedVariantIds.has(v.id))

    // Separate into referenced and unreferenced
    const [referenced, unreferenced] = copies.reduce<[Product[], Product[]]>(
      ([ref, unref], p) => isReferenced(p) ? [[...ref, p], unref] : [ref, [...unref, p]],
      [[], []],
    )

    if (unreferenced.length <= 1) {
      // All copies (or all but one) are referenced — can't safely remove anything
      if (referenced.length + unreferenced.length > 1) {
        console.log(`  SKIP  all copies referenced — "${label}"`)
        skipped += copies.length - 1
      }
      continue
    }

    // Keep: prefer unreferenced oldest, otherwise referenced oldest as anchor
    // Sort unreferenced oldest-first; keep[0] is safe to keep, rest are safe to delete
    unreferenced.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())

    // The one to keep is whichever is oldest overall among unreferenced
    // (if the oldest overall is referenced, keep it and delete unreferenced extras)
    const oldestOverall = copies[0]
    let keepId: string
    if (isReferenced(oldestOverall)) {
      // Oldest is referenced — keep it, delete from unreferenced pool
      keepId = oldestOverall.id
    } else {
      // Oldest is unreferenced — keep it
      keepId = oldestOverall.id
    }

    // Candidates to delete: unreferenced copies that are NOT the one we're keeping
    const toDelete = unreferenced.filter(p => p.id !== keepId)

    for (const dup of toDelete) {
      try {
        await api('DELETE', `/admin/products/${dup.id}`, token)
        console.log(`  kept  ${keepId} / deleted ${dup.id} — "${label}"`)
        deleted++
      } catch (err) {
        console.warn(`  ERROR deleting ${dup.id}: ${err instanceof Error ? err.message : err}`)
        skipped++
      }
    }
  }

  console.log(`\n──────────────────────────────────────`)
  console.log(`Deleted: ${deleted}  |  Skipped (referenced/error): ${skipped}`)
  console.log(`──────────────────────────────────────`)
}

main().catch(err => {
  console.error('\n✗ Fatal:', err instanceof Error ? err.message : err)
  process.exit(1)
})
