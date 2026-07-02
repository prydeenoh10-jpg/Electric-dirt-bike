import type { SubscriberArgs, SubscriberConfig } from '@medusajs/framework'
import { Resend } from 'resend'
import { buildOrderConfirmationEmail } from '../lib/email-templates/order-confirmation'

export default async function orderPlacedHandler({
  event: { data },
  container,
}: SubscriberArgs<{ id: string }>) {
  const apiKey = process.env.RESEND_API_KEY
  const from = process.env.RESEND_FROM

  if (!apiKey || !from) {
    console.warn('[order-placed] RESEND_API_KEY or RESEND_FROM not set — skipping confirmation email')
    return
  }

  // Resolve the order module service via its string container key
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const orderService = container.resolve('order') as any

  let order: any
  try {
    order = await orderService.retrieveOrder(data.id, {
      relations: ['items', 'shipping_address'],
    })
  } catch {
    // Some Medusa versions use `retrieve` instead of `retrieveOrder`
    try {
      order = await orderService.retrieve(data.id, {
        relations: ['items', 'shipping_address'],
      })
    } catch (err) {
      console.error('[order-placed] Could not retrieve order:', data.id, err)
      return
    }
  }

  if (!order?.email) {
    console.warn('[order-placed] Order has no email address, skipping:', data.id)
    return
  }

  const storefrontUrl = process.env.STOREFRONT_URL ?? 'https://electricdirtbike.com.au'
  const html = buildOrderConfirmationEmail(order, storefrontUrl)

  const resend = new Resend(apiKey)
  const { error } = await resend.emails.send({
    from,
    to: order.email,
    subject: `Order Confirmation #${order.display_id} – EBMX Electric Dirtbikes`,
    html,
  })

  if (error) {
    console.error('[order-placed] Resend error sending to', order.email, ':', error)
  } else {
    console.log(`[order-placed] Confirmation email sent → ${order.email} (order #${order.display_id})`)
  }
}

export const config: SubscriberConfig = {
  event: 'order.placed',
}
