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

import { openExternalUrl } from './openExternal'
import { formatCurrency } from './formatters'

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
/**
 * Phase 118 — 4-tier status emoji for a PLAN-vs-ACTUAL line.
 *   🔥 >=150% of target · ✅ hit (100-149%) · ⚠️ close (50-99%) · ❌ <50%.
 * No target → ✅ if any activity, else ❌.
 */
function tierEmoji(actual, target) {
  const a = Number(actual) || 0
  const t = Number(target) || 0
  if (t <= 0) return a > 0 ? '✅' : '❌'
  const pct = a / t
  if (pct >= 1.5) return '🔥'
  if (pct >= 1)   return '✅'
  if (pct >= 0.5) return '⚠️'
  return '❌'
}

/** Phase 118 — DAY SCORE face: 🔥 >=85 · ✅ 60-84 · ⚠️ 40-59 · ❌ <40. */
function scoreFace(s) {
  const n = Number(s) || 0
  if (n >= 85) return '🔥'
  if (n >= 60) return '✅'
  if (n >= 40) return '⚠️'
  return '❌'
}

/** Phase 118 — revisit tiers { 2: n, 3: m } → "2nd ×n · 3rd ×m". */
function revisitStr(tiers) {
  const ord = { 1: '1st', 2: '2nd', 3: '3rd' }
  const parts = Object.keys(tiers || {})
    .map(Number)
    .filter(k => k >= 2)
    .sort((x, y) => x - y)
    .map(k => `${ord[k] || `${k}th`} ×${tiers[k]}`)
  return parts.length ? parts.join(' · ') : 'none'
}

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
  if (isTC) {
    // TC — unchanged (Phase 90.5). "Calls" = qualified count (>=10s).
    lines.push(`• Calls (≥10s): ${a.calls ?? 0}/${p.calls ?? 0}`)
    lines.push(`• New leads:    ${a.leads ?? 0}/${p.leads ?? 0}`)
    // Phase 128.3 — TC now uses the REAL follow-up count (closed + the lead
    // was called), same as sales. Was follow_ups_done (raw closes), which a
    // telecaller inflates past the due count via call-chain auto-closes
    // (Rima 165/91). follow_ups_real is the honest "did the work" number.
    lines.push(`• Follow-ups:   ${a.follow_ups_real ?? 0}/${a.follow_ups_total ?? 0}`)
    lines.push(`• Positive talks: ${a.qualified ?? 0}`)
  } else {
    // Phase 118 — Sales. No Calls line. 4-tier status emoji. Follow-ups
    // count only real ones (called + qualified). Overdue / outstanding /
    // renewal lines are hidden when 0.
    const fuReal = a.follow_ups_real ?? 0
    const fuTotal = a.follow_ups_total ?? 0
    lines.push(`• Meetings:     ${a.meetings ?? 0}/${p.meetings ?? 0} ${tierEmoji(a.meetings, p.meetings)}`)
    lines.push(`• New leads:    ${a.leads ?? 0}/${p.leads ?? 0} ${tierEmoji(a.leads, p.leads)}`)
    lines.push(`• Follow-ups:   ${fuReal}/${fuTotal} ${tierEmoji(fuReal, fuTotal)}`)
    if ((a.overdue_follow_ups ?? 0) > 0) {
      lines.push(`• Overdue:      ${a.overdue_follow_ups} 🔴`)
    }
    if ((a.quote_outstanding_count ?? 0) > 0) {
      lines.push(`• Quote outstanding: ${a.quote_outstanding_count} · ${formatCurrency(a.quote_outstanding_amount || 0)} 🔴`)
    }
    if ((a.renewal_due ?? 0) > 0) {
      lines.push(`• Renewal:      ${a.renewal_due} 🔴`)
    }
  }
  lines.push(`• Quotes sent: ${a.quotes_sent ?? 0} · ${formatCurrency(a.quotes_sent_amount || 0)} (this month)`)
  lines.push('')

  // ACTIVITY
  lines.push('📊 *ACTIVITY*')
  if (!isTC) {
    // Phase 118 — Revisits (Nth visit to same lead) replaces Site visits.
    lines.push(`• Revisits:      ${revisitStr(a.revisit_tiers)}`)
  }
  lines.push(`• WhatsApp sent: ${a.whatsapp_sent ?? 0}`)
  lines.push(`• Collected:     ${a.quotes_won ?? 0} · ${formatCurrency(a.quotes_won_amount || 0)} (this month)`)
  lines.push(`• Cash in:       ${a.cash_in_count ?? 0} · ${formatCurrency(a.cash_in_amount || 0)} (this month)`)
  lines.push(`• Conversion:    ${a.quote_conversion_pct ?? 0}% (won ÷ sent, ₹)`)
  lines.push('')

  // TRACKING INTEGRITY
  const t = d.tracking || {}
  lines.push('🛰️ *TRACKING*')
  // Phase 217 — GPS lines only for GPS-tracked reps. A telecaller isn't
  // tracked (background GPS skips them), so GPS uptime / GPS off / KM are
  // always 0/blank noise on their report. Internet + force-stop stay — those
  // are connectivity, still meaningful for a desk rep.
  if (!isTC) {
    lines.push(`• GPS uptime:    ${fmtDuration(t.gps_uptime_seconds)}`)
    if ((t.gps_off_count ?? 0) > 0) {
      lines.push(`• GPS off:       ${t.gps_off_count} times (${fmtDuration(t.gps_off_duration_seconds)}) ⚠️`)
    } else {
      lines.push(`• GPS off:       0 times ✅`)
    }
  }
  if ((t.network_off_count ?? 0) > 0) {
    lines.push(`• Internet lost: ${t.network_off_count} times (${fmtDuration(t.network_off_duration_seconds)})`)
  } else {
    lines.push(`• Internet lost: 0 times`)
  }
  if ((t.force_stop_count ?? 0) > 0) {
    lines.push(`• App force-stop: ${t.force_stop_count} times ⚠️`)
  }
  // Phase 217 — KM is GPS-derived; a telecaller isn't tracked → skip it.
  if (!isTC && t.km_traveled != null) {
    let kmLine = `• KM traveled:   ${Number(t.km_traveled).toFixed(1)} km`
    // Phase 118 — justify the travel against the day score.
    if (Number(t.km_traveled) >= 1) {
      kmLine += (a.day_score ?? 0) >= 70 ? ' · ✅ justified' : ' · ❌ not justified'
    }
    lines.push(kmLine)
  }

  // Phase 118 — Day Score. Message-only, NOT the salary score.
  // Phase 164 — now shown for TC too: their 50-point slot is CALLS (>=10s,
  // the same number on the "Calls (>=10s)" line above), not meetings —
  // useDaySummary computes it that way. Surfaces a score, not a new metric.
  {
    const sc = a.day_score ?? 0
    lines.push('')
    lines.push(`⭐ *DAY SCORE: ${sc}/100* ${scoreFace(sc)}`)
    lines.push(isTC
      ? '   Calls 50 · Follow-ups 20 · Leads 15 · Quotes 15'
      : '   Meetings 50 · Follow-ups 20 · Leads 15 · Quotes 15')
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
  // Phase 93.19 — openExternalUrl routes via Capacitor App.openUrl on
  // native APK (otherwise webview tries to navigate to whatsapp://
  // and breaks the JS chain), falls back to window.open on web.
  openExternalUrl(url)
}

export default { formatDaySummaryText, openWhatsAppShare }
