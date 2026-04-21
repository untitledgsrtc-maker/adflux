import { formatCurrency } from './formatters'

/**
 * Build WhatsApp message text for a quote
 * @param {Object} quote  - full quote object
 * @param {Array} cities  - quote_cities rows
 * @returns {string} message text
 */
export function buildWhatsAppMessage(quote, cities = []) {
  const message = `Dear ${quote.client_name}, Thank you for showing interest in our outdoor advertising solutions. Please find the detailed quotation attached for your review. Looking forward to working with you! Best regards, ${quote.sales_person_name || 'Sales Team'} | Untitled Adflux`

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
