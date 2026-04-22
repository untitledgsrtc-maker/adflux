import { formatCurrency } from './formatters'

/**
 * Shorten a URL for WhatsApp.
 *
 * Our Supabase PDF URLs look like
 *   https://xxxxx.supabase.co/storage/v1/object/public/quote-pdfs/UA-2026-0012/1745300000000.pdf
 * Pasting that raw into WhatsApp looks spammy and some clients wrap
 * the tail onto a second line. A short link previews as a clean
 * clickable card.
 *
 * CORS NOTE — the ordering below is deliberate.
 *
 *   TinyURL (api-create.php) and is.gd (create.php) are legacy
 *   endpoints that do NOT send Access-Control-Allow-Origin. Called
 *   from a browser they fail with a CORS error, the try/catch
 *   swallows it, and the user ends up with the long URL.
 *
 *   cleanuri.com IS designed for browser use — it advertises
 *   `Access-Control-Allow-Origin: *` and accepts POST
 *   application/x-www-form-urlencoded with a `url` field, returning
 *   `{"result_url": "https://cleanuri.com/xxx"}`. That's why it's
 *   the primary now.
 *
 *   TinyURL and is.gd remain as fallbacks — they still work in
 *   server contexts and some browsers (older CORS policies, or a
 *   user-installed extension that strips CORS), so keeping them
 *   costs nothing and covers the long tail.
 *
 * If all three fail we fall back to the original long URL so the
 * message ALWAYS carries a working link — a shortener outage must
 * never block the WhatsApp send.
 *
 * Each call is capped at 3.5s so a slow DNS lookup doesn't stall
 * the whole "Send via WhatsApp" button.
 *
 * @param {string} longUrl
 * @returns {Promise<string>} short URL or the original URL on failure
 */
export async function shortenUrl(longUrl) {
  if (!longUrl || typeof longUrl !== 'string') return longUrl
  // Already short enough — skip the round-trip.
  if (longUrl.length < 40) return longUrl

  // Each shortener is an async fn that returns the short URL or null.
  // Structured as an array so the request shapes (POST+JSON vs
  // GET+text) can coexist cleanly.
  const shorteners = [
    // cleanuri — CORS-friendly, browser-safe. Primary path.
    async (url, signal) => {
      const res = await fetch('https://cleanuri.com/api/v1/shorten', {
        method:  'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body:    `url=${encodeURIComponent(url)}`,
        signal,
      })
      if (!res.ok) return null
      const data = await res.json().catch(() => null)
      return data?.result_url || null
    },
    // TinyURL — no CORS headers; included for non-browser callers
    // and browsers where an extension permits it.
    async (url, signal) => {
      const res = await fetch(
        `https://tinyurl.com/api-create.php?url=${encodeURIComponent(url)}`,
        { signal }
      )
      if (!res.ok) return null
      return (await res.text()).trim() || null
    },
    // is.gd — same story as TinyURL; last-resort fallback.
    async (url, signal) => {
      const res = await fetch(
        `https://is.gd/create.php?format=simple&url=${encodeURIComponent(url)}`,
        { signal }
      )
      if (!res.ok) return null
      return (await res.text()).trim() || null
    },
  ]

  for (const shortener of shorteners) {
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 3500)
      const short = await shortener(longUrl, controller.signal)
      clearTimeout(timer)
      // Reject anything that doesn't parse as a reasonable URL or
      // isn't actually shorter than what we started with.
      if (short && /^https?:\/\/\S+$/i.test(short) && short.length < longUrl.length) {
        return short
      }
    } catch {
      // Network error, CORS block, timeout — try the next shortener.
    }
  }
  return longUrl
}

/**
 * Build WhatsApp message text for a quote.
 *
 * Called from two paths with slightly different city shapes:
 *   - QuoteDetail page → flat DB rows (`c.city_name`)
 *   - Step4Send wizard → nested wizard state (`c.city.name`)
 * `cityLabel` normalizes both so the template doesn't have to care.
 *
 * WhatsApp supports *bold* via single asterisks and preserves newlines
 * in URL-encoded text — so we format as a readable multi-line block
 * rather than a single run-on sentence (which is what used to ship,
 * and was the source of the "not accurate" bug: it didn't interpolate
 * quote number, total, or cities at all).
 *
 * @param {Object} quote  - full quote row (must include quote_number,
 *                          total_amount, sales_person_name, and
 *                          optionally campaign_start_date/end_date)
 * @param {Array}  cities - quote_cities rows OR wizard-state entries
 * @param {Object} [opts]
 * @param {string} [opts.pdfUrl] - public URL of the uploaded PDF.
 *   When present, the message says "PDF is available here: <url>"
 *   instead of "attached" — because wa.me click-to-chat cannot
 *   actually attach files. Falls back to "please find attached"
 *   phrasing when the upload is skipped or fails.
 * @returns {string} message text ready for encodeURIComponent
 */
export function buildWhatsAppMessage(quote, cities = [], opts = {}) {
  const { pdfUrl } = opts
  const lines = []

  lines.push(`Dear ${quote.client_name || 'Sir/Madam'},`)
  lines.push('')
  lines.push(`Thank you for your interest in Untitled Adflux's outdoor LED advertising network.`)
  lines.push('')

  if (quote.quote_number) {
    lines.push(`*Quote: ${quote.quote_number}*`)
    lines.push('')
  }

  // City list — cap at 8 so the message doesn't overflow for
  // region-wide quotes (30+ cities). Remaining count is summarized.
  if (cities.length) {
    const names = cities.map(cityLabel).filter(Boolean)
    if (names.length) {
      lines.push(`Locations (${names.length}):`)
      const shown = names.slice(0, 8)
      for (const n of shown) lines.push(`• ${n}`)
      if (names.length > shown.length) {
        lines.push(`• +${names.length - shown.length} more`)
      }
      lines.push('')
    }
  }

  // Duration is uniform across cities in our model, so reading it off
  // the first row is safe. Fall back to quote.duration_months for
  // older rows that don't have per-city duration stored.
  const duration = cities[0]?.duration_months || quote.duration_months
  if (duration) {
    lines.push(`Duration: ${duration} month${duration !== 1 ? 's' : ''}`)
  }

  // Only show campaign dates once they're locked in (won quotes).
  if (quote.campaign_start_date && quote.campaign_end_date) {
    lines.push(
      `Campaign Period: ${formatDate(quote.campaign_start_date)} to ${formatDate(quote.campaign_end_date)}`
    )
  }

  if (duration || (quote.campaign_start_date && quote.campaign_end_date)) {
    lines.push('')
  }

  if (quote.total_amount != null) {
    // GST label tracks the stored rate — a "No GST" quote mustn't ship
    // a WhatsApp line claiming 18% was included.
    const rate = quote.gst_rate !== null && quote.gst_rate !== undefined
      ? Number(quote.gst_rate)
      : 0.18
    const gstSuffix = rate > 0
      ? `incl. ${Math.round(rate * 100)}% GST`
      : 'No GST'
    lines.push(`*Total (${gstSuffix}): ${formatCurrency(quote.total_amount)}*`)
    lines.push('')
  }

  if (pdfUrl) {
    lines.push(`View the detailed PDF quotation here:`)
    lines.push(pdfUrl)
  } else {
    lines.push(`The detailed PDF quotation is attached for your review.`)
  }
  lines.push('')
  lines.push(`Best regards,`)
  lines.push(`${quote.sales_person_name || 'Sales Team'}`)
  lines.push(`Untitled Adflux`)

  return lines.join('\n')
}

/**
 * Open WhatsApp with pre-filled message
 * @param {string} phone   - client phone number
 * @param {string} message - message text
 */
export function openWhatsApp(phone, message) {
  // Clean phone number — strip non-digits, prepend 91 for bare
  // 10-digit Indian numbers (our default case).
  let clean = phone?.replace(/\D/g, '') || ''
  if (clean.length === 10) clean = '91' + clean

  const encoded = encodeURIComponent(message)
  const url = clean
    ? `https://wa.me/${clean}?text=${encoded}`
    : `https://wa.me/?text=${encoded}`

  window.open(url, '_blank')
}

// --- internal helpers ------------------------------------------------

function cityLabel(c) {
  // Flat DB row OR nested wizard-state entry — try both.
  return c.city_name || c?.city?.name || ''
}

function formatDate(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}
