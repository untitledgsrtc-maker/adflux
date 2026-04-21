import { formatCurrency } from './formatters'

/**
 * Build WhatsApp message text for a quote
 * @param {Object} quote  - full quote object
 * @param {Array} cities  - quote_cities rows
 * @returns {string} message text
 */
export function buildWhatsAppMessage(quote, cities = []) {
  const cityLines = cities
    .map(c => `  • ${c.city_name} (${c.screens} screen${c.screens > 1 ? 's' : ''}) — ${formatCurrency(c.offered_rate)}/month`)
    .join('\n')

  const message = `
Hello ${quote.client_name},

Thank you for your interest in *Untitled Advertising*.

Here is your campaign quotation:

*Quote No:* ${quote.quote_number}
*Duration:* ${quote.duration_months} month${quote.duration_months > 1 ? 's' : ''}

*Locations:*
${cityLines}

*Subtotal:* ${formatCurrency(quote.subtotal)}
*GST (18%):* ${formatCurrency(quote.gst_amount)}
*Total:* ${formatCurrency(quote.total_amount)}

This is a customised offer. Prices are subject to availability.

Looking forward to working with you!

*Untitled Advertising*
`.trim()

  return message
}

/**
 * Open WhatsApp with pre-filled message
 * @param {string} phone   - client phone number
 * @param {string} message - message text
 */
export function openWhatsApp(phone, message) {
  // Clean phone number
  let clean = phone?.replace(/\D/g, '') || ''
  if (clean.length === 10) clean = '91' + clean

  const encoded = encodeURIComponent(message)
  const url = clean
    ? `https://wa.me/${clean}?text=${encoded}`
    : `https://wa.me/?text=${encoded}`

  window.open(url, '_blank')
}
