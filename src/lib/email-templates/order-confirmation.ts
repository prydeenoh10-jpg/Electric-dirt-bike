interface OrderItem {
  title: string
  subtitle?: string
  quantity: number
  unit_price: number
  total?: number
}

interface ShippingAddress {
  first_name?: string
  last_name?: string
  address_1?: string
  city?: string
  province?: string
  postal_code?: string
}

export interface OrderEmailData {
  display_id: number
  email: string
  total?: number
  subtotal?: number
  created_at: string
  status?: string
  items?: OrderItem[]
  shipping_address?: ShippingAddress
}

function aud(amount: number): string {
  return `A$${amount.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function escHtml(str: string): string {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function buildOrderConfirmationEmail(
  order: OrderEmailData,
  storefrontUrl = 'https://electricdirtbike.com.au',
): string {
  const items = order.items ?? []
  const total = items.reduce((sum, item) => sum + (item.unit_price ?? 0) * (item.quantity ?? 1), 0)
  const gst = total / 11
  const exGst = total - gst

  const firstName = order.shipping_address?.first_name?.trim() || ''
  const greeting = firstName ? `Hello, ${escHtml(firstName)}!` : 'Hello!'

  const date = new Date(order.created_at).toLocaleDateString('en-AU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })

  const ordersUrl = `${storefrontUrl}/account/orders/${order.display_id}`

  const shippingAddr = order.shipping_address
  const hasAddress = shippingAddr && (shippingAddr.address_1 || shippingAddr.city)
  const addressLine = hasAddress
    ? [
        [shippingAddr.first_name, shippingAddr.last_name].filter(Boolean).join(' '),
        shippingAddr.address_1,
        [shippingAddr.city, shippingAddr.province, shippingAddr.postal_code].filter(Boolean).join(', '),
      ]
        .filter(Boolean)
        .map(escHtml)
        .join('<br>')
    : null

  // ── Item rows ──────────────────────────────────────────────────────────────
  const itemRows = items.map(item => {
    const lineTotal = (item.unit_price ?? 0) * (item.quantity ?? 1)
    return `
      <tr>
        <td style="padding:14px 16px;border-bottom:1px solid #222;font-size:14px;color:#e0e0e0;line-height:1.4;vertical-align:top;">
          <span style="color:#ffffff;font-weight:600;">${escHtml(item.title)}</span>
          ${item.subtitle && item.subtitle !== 'Default Variant' ? `<br><span style="color:#666;font-size:12px;">${escHtml(item.subtitle)}</span>` : ''}
        </td>
        <td style="padding:14px 12px;border-bottom:1px solid #222;font-size:14px;color:#aaa;text-align:center;vertical-align:top;white-space:nowrap;">${item.quantity}</td>
        <td style="padding:14px 12px;border-bottom:1px solid #222;font-size:14px;color:#aaa;text-align:right;vertical-align:top;white-space:nowrap;">${aud(item.unit_price)}</td>
        <td style="padding:14px 16px;border-bottom:1px solid #222;font-size:14px;color:#ffffff;font-weight:600;text-align:right;vertical-align:top;white-space:nowrap;">${aud(lineTotal)}</td>
      </tr>`
  }).join('')

  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="dark light">
  <title>Order Confirmation #${order.display_id} – EBMX</title>
  <style>
    @media only screen and (max-width:620px){
      .email-card{width:100%!important;border-radius:0!important;}
      .info-cards-td{display:block!important;width:100%!important;padding-bottom:10px!important;padding-right:0!important;}
      .contact-td{display:block!important;width:100%!important;padding-bottom:16px!important;}
      .step-td{display:block!important;width:100%!important;}
      .hide-mobile{display:none!important;}
    }
  </style>
</head>
<body style="margin:0;padding:0;background-color:#0a0a0a;-webkit-text-size-adjust:100%;text-size-adjust:100%;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">

<!--[if mso]><center><table width="600"><tr><td><![endif]-->

<!-- Outer wrapper -->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#0a0a0a;min-height:100%;">
  <tr>
    <td align="center" style="padding:32px 12px 48px;">

      <!-- Email card -->
      <table role="presentation" class="email-card" width="600" cellpadding="0" cellspacing="0" border="0"
        style="max-width:600px;width:100%;background-color:#141414;border-radius:6px;overflow:hidden;">

        <!-- ═══ HEADER ════════════════════════════════════════════════════ -->
        <tr>
          <td style="background-color:#0f0f0f;border-bottom:3px solid #ff2d20;padding:24px 28px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="vertical-align:middle;">
                  <p style="margin:0;font-size:26px;font-weight:900;letter-spacing:0.14em;color:#ffffff;text-transform:uppercase;line-height:1;">EBMX</p>
                  <p style="margin:3px 0 0;font-size:10px;letter-spacing:0.15em;color:#666;text-transform:uppercase;">Electric Dirtbikes</p>
                </td>
                <td style="vertical-align:middle;text-align:right;">
                  <span style="display:inline-block;background-color:#1a0505;border:1px solid #ff2d20;border-radius:3px;padding:4px 10px;font-size:10px;font-weight:700;letter-spacing:0.12em;color:#ff2d20;text-transform:uppercase;">Order Confirmed</span>
                  <p style="margin:6px 0 0;font-size:20px;font-weight:700;color:#ffffff;letter-spacing:0.04em;">#${order.display_id}</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- ═══ STATUS BANNER ════════════════════════════════════════════ -->
        <tr>
          <td style="background-color:#0b1f12;border-left:4px solid #22c55e;padding:14px 24px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="vertical-align:middle;width:28px;">
                  <span style="display:inline-block;width:22px;height:22px;background-color:#22c55e;border-radius:50%;text-align:center;line-height:22px;font-size:13px;color:#0a0a0a;font-weight:900;">✓</span>
                </td>
                <td style="vertical-align:middle;padding-left:10px;">
                  <p style="margin:0;font-size:14px;font-weight:600;color:#4ade80;">Order Confirmed</p>
                  <p style="margin:2px 0 0;font-size:12px;color:#86efac;">We've received your order and our team is on it.</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- ═══ BODY PADDING STARTS ══════════════════════════════════════ -->
        <tr>
          <td style="padding:28px 28px 0;">

            <!-- ── Info cards ──────────────────────────────────────────── -->
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:24px;">
              <tr>
                <td class="info-cards-td" width="50%" style="padding-right:8px;vertical-align:top;">
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
                    style="background-color:#1a1a1a;border:1px solid #2a2a2a;border-radius:4px;">
                    <tr>
                      <td style="padding:14px 16px;">
                        <p style="margin:0 0 4px;font-size:10px;font-weight:700;letter-spacing:0.1em;color:#666;text-transform:uppercase;">Order Date</p>
                        <p style="margin:0;font-size:14px;color:#e0e0e0;font-weight:500;">${date}</p>
                      </td>
                    </tr>
                  </table>
                </td>
                <td class="info-cards-td" width="50%" style="padding-left:8px;vertical-align:top;">
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
                    style="background-color:#1a1a1a;border:1px solid #2a2a2a;border-radius:4px;">
                    <tr>
                      <td style="padding:14px 16px;">
                        <p style="margin:0 0 4px;font-size:10px;font-weight:700;letter-spacing:0.1em;color:#666;text-transform:uppercase;">Payment</p>
                        <p style="margin:0;font-size:14px;color:#e0e0e0;font-weight:500;">Card via Stripe &#x2022; Paid</p>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>

            <!-- ── Greeting ────────────────────────────────────────────── -->
            <p style="margin:0 0 6px;font-size:20px;font-weight:700;color:#ffffff;">${greeting}</p>
            <p style="margin:0 0 24px;font-size:14px;color:#999;line-height:1.6;">
              Thanks for your order — here's your confirmation and invoice for reference.
              We'll be in touch within one business day to confirm and arrange delivery or pickup.
            </p>

            <!-- ── Section heading: Your Order ────────────────────────── -->
            <p style="margin:0 0 12px;font-size:11px;font-weight:700;letter-spacing:0.1em;color:#666;text-transform:uppercase;">Your Order</p>

          </td>
        </tr>

        <!-- ═══ ITEMS TABLE ══════════════════════════════════════════════ -->
        <tr>
          <td style="padding:0 28px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
              style="border:1px solid #222;border-radius:4px;overflow:hidden;">
              <!-- Table header -->
              <tr style="background-color:#1a1a1a;">
                <th style="padding:10px 16px;font-size:10px;font-weight:700;letter-spacing:0.08em;color:#555;text-transform:uppercase;text-align:left;border-bottom:1px solid #222;">Item</th>
                <th style="padding:10px 12px;font-size:10px;font-weight:700;letter-spacing:0.08em;color:#555;text-transform:uppercase;text-align:center;border-bottom:1px solid #222;white-space:nowrap;">Qty</th>
                <th class="hide-mobile" style="padding:10px 12px;font-size:10px;font-weight:700;letter-spacing:0.08em;color:#555;text-transform:uppercase;text-align:right;border-bottom:1px solid #222;white-space:nowrap;">Unit Price</th>
                <th style="padding:10px 16px;font-size:10px;font-weight:700;letter-spacing:0.08em;color:#555;text-transform:uppercase;text-align:right;border-bottom:1px solid #222;">Total</th>
              </tr>
              ${itemRows || `<tr><td colspan="4" style="padding:20px;color:#555;font-size:14px;text-align:center;">No items</td></tr>`}
            </table>
          </td>
        </tr>

        <!-- ═══ TOTALS ═══════════════════════════════════════════════════ -->
        <tr>
          <td style="padding:0 28px 28px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
              style="border:1px solid #222;border-top:none;border-radius:0 0 4px 4px;">
              <tr>
                <td style="padding:10px 16px;font-size:13px;color:#777;border-bottom:1px solid #1e1e1e;">Subtotal <span style="color:#555;">(ex. GST)</span></td>
                <td style="padding:10px 16px;font-size:13px;color:#bbb;text-align:right;border-bottom:1px solid #1e1e1e;white-space:nowrap;">${aud(exGst)}</td>
              </tr>
              <tr>
                <td style="padding:10px 16px;font-size:13px;color:#777;border-bottom:1px solid #1e1e1e;">GST <span style="color:#555;">(10%)</span></td>
                <td style="padding:10px 16px;font-size:13px;color:#bbb;text-align:right;border-bottom:1px solid #1e1e1e;white-space:nowrap;">${aud(gst)}</td>
              </tr>
              <tr style="background-color:#1a1a1a;">
                <td style="padding:14px 16px;font-size:15px;font-weight:700;color:#ffffff;">Total <span style="font-size:12px;color:#666;font-weight:400;">(inc. GST)</span></td>
                <td style="padding:14px 16px;font-size:16px;font-weight:700;color:#ff2d20;text-align:right;white-space:nowrap;">${aud(total)}</td>
              </tr>
            </table>
          </td>
        </tr>

        ${addressLine ? `
        <!-- ═══ SHIPPING ADDRESS ═════════════════════════════════════════ -->
        <tr>
          <td style="padding:0 28px 28px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
              style="background-color:#1a1a1a;border:1px solid #222;border-radius:4px;">
              <tr>
                <td style="padding:16px;">
                  <p style="margin:0 0 8px;font-size:10px;font-weight:700;letter-spacing:0.1em;color:#666;text-transform:uppercase;">Shipping To</p>
                  <p style="margin:0;font-size:13px;color:#bbb;line-height:1.7;">${addressLine}</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>` : ''}

        <!-- ═══ DIVIDER ══════════════════════════════════════════════════ -->
        <tr><td style="padding:0 28px;"><hr style="border:none;border-top:1px solid #222;margin:0 0 28px;"></td></tr>

        <!-- ═══ WHAT HAPPENS NEXT ════════════════════════════════════════ -->
        <tr>
          <td style="padding:0 28px 28px;">
            <p style="margin:0 0 18px;font-size:11px;font-weight:700;letter-spacing:0.1em;color:#666;text-transform:uppercase;">What Happens Next</p>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">

              <tr>
                <td class="step-td" style="padding-bottom:16px;vertical-align:top;width:36px;">
                  <span style="display:inline-block;width:28px;height:28px;background-color:#ff2d20;border-radius:50%;text-align:center;line-height:28px;font-size:13px;font-weight:700;color:#ffffff;">1</span>
                </td>
                <td class="step-td" style="padding-bottom:16px;vertical-align:top;padding-left:12px;">
                  <p style="margin:0 0 2px;font-size:14px;font-weight:600;color:#ffffff;">Order Review &amp; Confirmation</p>
                  <p style="margin:0;font-size:13px;color:#777;line-height:1.5;">Our team reviews your order and contacts you to confirm availability and discuss any details — within one business day.</p>
                </td>
              </tr>

              <tr>
                <td class="step-td" style="padding-bottom:16px;vertical-align:top;width:36px;">
                  <span style="display:inline-block;width:28px;height:28px;background-color:#ff2d20;border-radius:50%;text-align:center;line-height:28px;font-size:13px;font-weight:700;color:#ffffff;">2</span>
                </td>
                <td class="step-td" style="padding-bottom:16px;vertical-align:top;padding-left:12px;">
                  <p style="margin:0 0 2px;font-size:14px;font-weight:600;color:#ffffff;">Preparation &amp; Packing</p>
                  <p style="margin:0;font-size:13px;color:#777;line-height:1.5;">We carefully prepare and pack your gear — whether it's a complete bike, parts, or accessories.</p>
                </td>
              </tr>

              <tr>
                <td class="step-td" style="vertical-align:top;width:36px;">
                  <span style="display:inline-block;width:28px;height:28px;background-color:#ff2d20;border-radius:50%;text-align:center;line-height:28px;font-size:13px;font-weight:700;color:#ffffff;">3</span>
                </td>
                <td class="step-td" style="vertical-align:top;padding-left:12px;">
                  <p style="margin:0 0 2px;font-size:14px;font-weight:600;color:#ffffff;">Delivery or Showroom Pickup</p>
                  <p style="margin:0;font-size:13px;color:#777;line-height:1.5;">Your order ships Australia-wide, or you can collect from our Warners Bay NSW showroom. We'll notify you when it's ready.</p>
                </td>
              </tr>

            </table>
          </td>
        </tr>

        <!-- ═══ DIVIDER ══════════════════════════════════════════════════ -->
        <tr><td style="padding:0 28px;"><hr style="border:none;border-top:1px solid #222;margin:0 0 28px;"></td></tr>

        <!-- ═══ BUTTON ═══════════════════════════════════════════════════ -->
        <tr>
          <td style="padding:0 28px 32px;text-align:center;">
            <a href="${escHtml(ordersUrl)}"
              style="display:inline-block;background-color:#ff2d20;color:#ffffff;text-decoration:none;font-size:13px;font-weight:700;letter-spacing:0.08em;padding:14px 40px;border-radius:3px;text-transform:uppercase;">
              View Order
            </a>
          </td>
        </tr>

        <!-- ═══ CONTACT BLOCK ════════════════════════════════════════════ -->
        <tr>
          <td style="background-color:#111111;border-top:1px solid #222;padding:24px 28px;">
            <p style="margin:0 0 14px;font-size:10px;font-weight:700;letter-spacing:0.1em;color:#555;text-transform:uppercase;">Get In Touch</p>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td class="contact-td" style="padding-right:24px;vertical-align:top;width:33%;">
                  <p style="margin:0 0 3px;font-size:11px;font-weight:600;color:#888;text-transform:uppercase;letter-spacing:0.06em;">Phone</p>
                  <a href="tel:1300003269" style="font-size:13px;color:#e0e0e0;text-decoration:none;">1300 003 269</a>
                </td>
                <td class="contact-td" style="padding-right:24px;vertical-align:top;width:33%;">
                  <p style="margin:0 0 3px;font-size:11px;font-weight:600;color:#888;text-transform:uppercase;letter-spacing:0.06em;">Email</p>
                  <a href="mailto:sales@electricdirtbike.com.au" style="font-size:13px;color:#e0e0e0;text-decoration:none;">sales@electricdirtbike.com.au</a>
                </td>
                <td class="contact-td" style="vertical-align:top;">
                  <p style="margin:0 0 3px;font-size:11px;font-weight:600;color:#888;text-transform:uppercase;letter-spacing:0.06em;">Showroom</p>
                  <p style="margin:0;font-size:13px;color:#e0e0e0;line-height:1.5;">9/5 Walker St<br>Warners Bay NSW 2282</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- ═══ FOOTER ═══════════════════════════════════════════════════ -->
        <tr>
          <td style="background-color:#0d0d0d;border-top:1px solid #1a1a1a;padding:16px 28px;">
            <p style="margin:0 0 4px;font-size:11px;color:#444;text-align:center;line-height:1.6;">
              EBMX Electric Dirtbikes &nbsp;·&nbsp; ABN 50 641 568 612
            </p>
            <p style="margin:0;font-size:11px;color:#3a3a3a;text-align:center;line-height:1.6;">
              Delivery Australia-wide or collect from our Warners Bay NSW showroom.
              This is an automated order confirmation — reply with your order number for queries.
            </p>
          </td>
        </tr>

      </table>
      <!-- /Email card -->

    </td>
  </tr>
</table>

<!--[if mso]></td></tr></table></center><![endif]-->

</body>
</html>`
}
