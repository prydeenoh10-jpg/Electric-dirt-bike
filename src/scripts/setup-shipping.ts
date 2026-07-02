/**
 * EBMX Shipping Setup — Medusa v2
 * Run via: npm run setup:shipping  (uses `medusa exec`)
 *
 * Creates fulfillment set → Australia service zone → "Standard Shipping" option,
 * then links a price set via the pricing module so the store API returns it.
 * Idempotent — deletes any option created without pricing and recreates it.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default async function setupShipping({ container }: { container: any }) {
  const fulfillment = container.resolve('fulfillment')
  const pricing     = container.resolve('pricing')

  // ── Shipping profile ──────────────────────────────────────────────────────
  const profiles = await fulfillment.listShippingProfiles({})
  const profile = profiles[0]
  if (!profile) throw new Error('No shipping profiles found — is the Medusa server fully started?')
  console.log(`✓ Profile: "${profile.name}" (${profile.id})`)

  // ── Fulfillment set ───────────────────────────────────────────────────────
  const existingSets = await fulfillment.listFulfillmentSets({})
  let fsetId: string
  if (existingSets.length > 0) {
    fsetId = existingSets[0].id
    console.log(`✓ Fulfillment set (existing): ${fsetId}`)
  } else {
    const [created] = await fulfillment.createFulfillmentSets([{
      name: 'EBMX Shipping',
      type: 'shipping',
    }])
    fsetId = created.id
    console.log(`✓ Fulfillment set (created): ${fsetId}`)
  }

  // ── Service zone ──────────────────────────────────────────────────────────
  const existingZones = await fulfillment.listServiceZones({})
  let zoneId: string
  const ausZone = existingZones.find((z: { name: string }) => z.name === 'Australia') ?? existingZones[0]
  if (ausZone) {
    zoneId = ausZone.id
    console.log(`✓ Service zone (existing): ${zoneId}`)
  } else {
    const [created] = await fulfillment.createServiceZones([{
      name: 'Australia',
      fulfillment_set_id: fsetId,
      geo_zones: [{ type: 'country', country_code: 'au' }],
    }])
    zoneId = created.id
    console.log(`✓ Service zone (created): ${zoneId}`)
  }

  // ── Shipping option — delete any broken ones (created without price set) ──
  const existingOptions = await fulfillment.listShippingOptions({})
  for (const opt of existingOptions) {
    await fulfillment.deleteShippingOptions([opt.id])
    console.log(`↻ Removed old option: "${opt.name}" (${opt.id})`)
  }

  const [option] = await fulfillment.createShippingOptions([{
    name: 'Standard Shipping',
    price_type: 'flat',
    service_zone_id: zoneId,
    shipping_profile_id: profile.id,
    provider_id: 'manual_manual',
    type: {
      label: 'Standard',
      description: 'Delivered to your door',
      code: 'standard',
    },
    rules: [],
    prices: [{ amount: 0, currency_code: 'aud' }],
  }])
  console.log(`✓ Shipping option: "${option.name}" (${option.id})`)

  // ── Price set — link via pricing module so store API returns pricing ───────
  // The module-service createShippingOptions stores flat prices internally, but
  // the store API joins against the pricing module's price sets.  We must create
  // a price set there and link it via remoteLink.
  try {
    const [priceSet] = await pricing.createPriceSets([{
      prices: [{ currency_code: 'aud', amount: 0, rules: {} }],
    }])
    console.log(`✓ Price set: ${priceSet.id}`)

    const remoteLink = container.resolve('remoteLink')
    await remoteLink.create([{
      fulfillment: { shipping_option_id: option.id },
      pricing:     { price_set_id:       priceSet.id },
    }])
    console.log('✓ Price set linked to shipping option')
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.warn(`⚠ Price-set linking failed: ${msg}`)
    console.warn('  If checkout shows no shipping methods, add pricing manually:')
    console.warn('  Admin UI → Settings → Locations → EBMX Warehouse → Shipping')
  }

  console.log('\n✓ Done. Restart the storefront and test checkout.')
}
