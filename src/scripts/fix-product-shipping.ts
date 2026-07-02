/**
 * EBMX Fix Product Shipping Profiles — Medusa v2
 * Run via: npm run fix:product-shipping  (uses `medusa exec`)
 *
 * Products created via the admin API without an explicit shipping_profile_id
 * end up with shipping_profile_id = null. Cart completion then fails:
 * "cart items require shipping profiles not satisfied by current methods"
 * because items carry profile=null but the shipping option has a specific profile.
 *
 * This script sets every product's shipping_profile_id to the default profile
 * so future carts get the correct profile stamped onto each line item.
 * After running this, create a FRESH checkout (new cart).
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default async function fixProductShipping({ container }: { container: any }) {
  const fulfillment   = container.resolve('fulfillment')
  const productModule = container.resolve('product')

  // ── Shipping profile ──────────────────────────────────────────────────────
  const profiles = await fulfillment.listShippingProfiles({})
  const profile = profiles[0]
  if (!profile) throw new Error('No shipping profiles found — is Medusa fully migrated?')
  console.log(`✓ Profile: "${profile.name}" (${profile.id})`)

  // ── Products ──────────────────────────────────────────────────────────────
  const products: { id: string; title: string; shipping_profile_id?: string | null }[] =
    await productModule.listProducts({}, { take: 500, skip: 0 })
  console.log(`Found ${products.length} products`)

  // Log a sample to diagnose current state
  if (products[0]) {
    console.log(`Sample: "${products[0].title}" — shipping_profile_id=${products[0].shipping_profile_id ?? 'null'}`)
  }

  const toUpdate = products.filter(p => p.shipping_profile_id !== profile.id)
  console.log(`${toUpdate.length} products need profile assignment`)

  if (toUpdate.length === 0) {
    console.log('✓ All products already have the correct shipping profile — done.')
    return
  }

  // ── Approach 1: direct field update via product module service ────────────
  let approach1Success = false
  try {
    const updates = toUpdate.map(p => ({ id: p.id, shipping_profile_id: profile.id }))
    await productModule.updateProducts(updates)
    approach1Success = true
    console.log(`✓ Updated ${toUpdate.length} products via productModule.updateProducts`)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.log(`Approach 1 (updateProducts) failed: ${msg.slice(0, 120)}`)
  }

  // ── Approach 2: remote link ───────────────────────────────────────────────
  if (!approach1Success) {
    console.log('Trying remote link approach...')
    const remoteLink = container.resolve('remoteLink')

    let linked = 0
    let skipped = 0

    // Try batch first
    try {
      const links = toUpdate.map(p => ({
        product:     { product_id: p.id },
        fulfillment: { shipping_profile_id: profile.id },
      }))
      await remoteLink.create(links)
      linked = toUpdate.length
      console.log(`✓ Batch-linked ${linked} products via remoteLink`)
    } catch (batchErr) {
      const msg = String(batchErr instanceof Error ? batchErr.message : batchErr)
      console.log(`Batch link failed: ${msg.slice(0, 80)}, trying per-product...`)

      for (const product of toUpdate) {
        try {
          await remoteLink.create([{
            product:     { product_id: product.id },
            fulfillment: { shipping_profile_id: profile.id },
          }])
          linked++
        } catch (err) {
          const e = String(err instanceof Error ? err.message : err)
          if (e.includes('duplicate') || e.includes('unique') || e.includes('already')) {
            skipped++
          } else {
            console.warn(`  ⚠ ${product.title}: ${e.slice(0, 100)}`)
            skipped++
          }
        }
      }
      console.log(`✓ Linked ${linked} / skipped ${skipped} products via remoteLink`)
    }
  }

  console.log('\n✓ Done. Create a FRESH checkout (new cart) — existing cart line items')
  console.log('  cache the profile at add-to-cart time and must be recreated.')
}
