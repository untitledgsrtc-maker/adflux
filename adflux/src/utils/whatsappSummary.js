// src/utils/whatsappSummary.js
//
// Phase 76 — Evening Day Summary formatter + WhatsApp deep-link opener.
//
// Owner directive (22 May 2026):
//   "let do at evening clik on summry, we detect all activity and
//    share via whats app. ex, total meeting 4/5, total follow up
//    9/20, gps turn off manuall 10 times, internet off 3 times.
//    reprsentative shre in our group all Different per role yes"
//
// Format: role-aware emoji plain-text. Uses Option X (with emoji)
// per owner pick. Rep taps Send → whatsapp://send opens WhatsApp
// with text pre-filled → rep picks group manually (one extra tap,
// zero config drift). No paid API needed.
//
// Per CLAUDE.md §7 + §20, emoji is banned in UI code/labels — but
// this content is plain text routed to WhatsApp, not in-app UI,
// so the ban does not apply. Owner explicitly chose Option X.

/**
 * Pluralize seconds → "Xh Ym" or "Ym Ns" form.
 */
function fmtDuration(seconds) {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return '0m'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m`
  return `${s}s`
}

/**
 * Sum of durations from an array of {duration_seconds} rows.
 * Skips null/undefined.
 */
function sumDuration(rows) {
  return (rows || []).reduce((acc, r) => acc + (Number(r?.duration_seconds) || 0), 0)
}

/**
 * IST date for the summary header — e.g. "22 May 2026".
 */
function istDateLabel(dateISO) {
  if (!dateISO) return ''
  const [y, m, d] = dateISO.split('-')
  const months = [
    'Jan','Feb','Mar','Apr','May','Jun',
    'Jul','Aug','Sep','Oct','Nov','Dec',
  ]
  return `${parseInt(d, 10)} ${months[parseInt(m, 10) - 1]} ${y}`
}

/**
 * Build the WhatsApp text body for a rep's day summary.
 *
 * @param {object} d — useDaySummary().data shape
 * @param {string} d.repName
 * @param {'sales'|'telecaller'|'agency'|'sales_manager'|'admin'|'co_owner'} d.role
 * @param {string} d.dateISO — YYYY-MM-DD IST
 * @param {object} d.plan — { meetings, calls, leads, follow_ups }
 * @param {object} d.actual — { meetings, calls, leads, follow_ups_done,
 *                              follow_ups_total, site_visits,
 *                              whatsapp_sent, voice_notes,
 *                              quotes_sent, quotes_won, qualified }
 * @param {object} d.tracking — { gps_uptime_seconds, gps_off_count,
 *                                gps_off_duration_seconds,
 *                                network_off_count,
 *                                network_off_duration_seconds,
 *                                force_stop_count, km_traveled }
 * @returns {string} formatted body
 */
export function formatDaySummaryText(d) {
  if (!d) return ''
  const role = (d.role || '').toLowerCase()
  const isTC = role === 'telecaller'
  const isSales = role === 'sales' || role === 'agency' || role === 'sales_manager'
  const dateLabel = istDateLabel(d.dateISO)

  const lines = []
  lines.push('🟡 UNTITLED · DAY SUMMARY')
  lines.push(`📅 ${dateLabel}`)
  lines.push(`👤 ${d.repName || '—'} · ${roleLabel(role)}`)
  lines.push('')

  // PLAN vs ACTUAL
  lines.push('📋 *PLAN vs ACTUAL*')
  const p = d.plan || {}
  const a = d.actual || {}
  if (!isTC) {
    lines.push(`• Meetings:    ${a.meetings ?? 0}/${p.meetings ?? 0}`)
  }
  // Phase 90.5 — label clarity. "Calls" here = qualified count
  // (duration_seconds >= 10s, per Phase 76.2.2 KPI rule). "Qualified"
  // historically meant outcome='positive' on lead_activities, which
  // overloaded the word. Rename TC row to "Positive talks" so the
  // two numbers don't share a name.
  lines.push(`• Calls (≥10s): ${a.calls ?? 0}/${p.calls ?? 0}`)
  lines.push(`• New leads:    ${a.leads ?? 0}/${p.leads ?? 0}`)
  lines.push(`• Follow-ups:   ${a.follow_ups_done ?? 0}/${a.follow_ups_total ?? 0}`)
  if (isTC) {
    lines.push(`• Positive talks: ${a.qualified ?? 0}`)
  }
  lines.push(`• Quotes sent: ${a.quotes_sent ?? 0}`)
  lines.push('')

  // ACTIVITY
  lines.push('📊 *ACTIVITY*')
  if (!isTC) {
    lines.push(`• Site visits:   ${a.site_visits ?? 0}`)
  }
  lines.push(`• WhatsApp sent: ${a.whatsapp_sent ?? 0}`)
  lines.push(`• Voice notes:   ${a.voice_notes ?? 0}`)
  lines.push(`• Quotes won:    ${a.quotes_won ?? 0}`)
  lines.push('')

  // TRACKING INTEGRITY
  const t = d.tracking || {}
  lines.push('🛰️ *TRACKING*')
  lines.push(`• GPS uptime:    ${fmtDuration(t.gps_uptime_seconds)}`)
  if ((t.gps_off_count ?? 0) > 0) {
    lines.push(`• GPS off:       ${t.gps_off_count} times (${fmtDuration(t.gps_off_duration_seconds)}) ⚠️`)
  } else {
    lines.push(`• GPS off:       0 times ✅`)
  }
  if ((t.network_off_count ?? 0) > 0) {
    lines.push(`• Internet lost: ${t.network_off_count} times (${fmtDuration(t.network_off_duration_seconds)})`)
  } else {
    lines.push(`• Internet lost: 0 times`)
  }
  if ((t.force_stop_count ?? 0) > 0) {
    lines.push(`• App force-stop: ${t.force_stop_count} times ⚠️`)
  }
  if (t.km_traveled != null) {
    lines.push(`• KM traveled:   ${Number(t.km_traveled).toFixed(1)} km`)
  }

  // Phase 91a — Tomorrow preview. Only emit when at least one of
  // (follow-ups due, planned meetings drafted) is non-zero. Lets the
  // group see what's lined up for the next day at a glance.
  const tom = d.tomorrow || {}
  const tomFu = Number(tom.followUps) || 0
  const tomMt = Number(tom.meetings) || 0
  if (tomFu > 0 || tomMt > 0) {
    lines.push('')
    lines.push('📅 *TOMORROW*')
    if (tomFu > 0) lines.push(`• Follow-ups due:  ${tomFu}`)
    if (tomMt > 0) lines.push(`• Planned meetings: ${tomMt}`)
  }

  lines.push('')
  lines.push('— Sent from Untitled OS')
  return lines.join('\n')
}

function roleLabel(role) {
  switch (role) {
    case 'sales':         return 'Sales'
    case 'telecaller':    return 'Telecaller'
    case 'agency':        return 'Agency'
    case 'sales_manager': return 'Sales Manager'
    case 'admin':         return 'Admin'
    case 'co_owner':      return 'Co-owner'
    default:              return role || ''
  }
}

/**
 * Open WhatsApp with the day-summary text pre-filled. Rep picks the
 * destination group from WhatsApp's UI (one extra tap, no group-link
 * configuration drift).
 *
 * Works on:
 *   • Android — whatsapp://send launches the app.
 *   • iOS Safari — same scheme works; Safari prompts to open in app.
 *   • Desktop — wa.me/?text=... fallback opens WhatsApp Web.
 *
 * @param {string} text — output of formatDaySummaryText()
 */
export function openWhatsAppShare(text) {
  if (!text) return
  const encoded = encodeURIComponent(text)
  // Prefer the deep-link on mobile; fall back to wa.me on desktop.
  // navigator.userAgent UA-based; Capacitor isNativePlatform also
  // works but we keep this util platform-agnostic.
  const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || '')
  const url = isMobile
    ? `whatsapp://send?text=${encoded}`
    : `https://wa.me/?text=${encoded}`
  // Open in a new context so the current page state is preserved.
  window.open(url, '_blank')
}

export default { formatDaySummaryText, openWhatsAppShare }
