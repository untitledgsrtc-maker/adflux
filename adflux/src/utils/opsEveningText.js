// src/utils/opsEveningText.js
//
// Plain-text WhatsApp message for the operations EVENING REPORT, built from the
// ops_my_day_report (kind 'exec') / ops_head_day_report (kind 'head') payload.
//
//   formatOpsEveningText(report, kind, lang) -> string ('' when the report is
//                                               missing or not ok:true)
//   shareOpsEvening(report, kind, lang)      -> opens WhatsApp via the EXISTING
//                                               openWhatsAppShare (not edited)
//
// RULES (owner, locked): view + share only; km only. NO rupees, NO pay, NO
// salary anywhere in this text. The emoji in the header is allowed ONLY here
// (WhatsApp body text, same waiver as whatsappSummary.js) - never in app UI.
//
// Language: technician text defaults to Gujarati (getOpsLang), head text to
// English. Pass lang 'gu' | 'en' to override. Digits are Gujarati (numL) when
// lang === 'gu'. Wording comes from opsStrings so the card and the message
// always say the same thing.

import { t, numL, getOpsLang } from './opsStrings'
import { ageLabel } from './opsHours'
import { openWhatsAppShare } from './whatsappSummary'

const HEADER = '🟡 UNTITLED - OPS'
const FOOTER = 'Sent from Untitled OS'
// WhatsApp deep links carry the text in the URL. Gujarati is 9 URL chars per
// letter, so keep the message comfortably short (head tech list is trimmed).
const MAX_ENCODED = 6000

export function resolveEveningLang(kind, lang) {
  if (lang === 'gu' || lang === 'en') return lang
  return kind === 'head' ? 'en' : getOpsLang()
}

const isNum = (v) => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v))
// null / missing -> an em dash, never a fake 0 (numL(null) would print 0).
export const fmtInt = (v, lang) => (isNum(v) ? numL(Math.round(Number(v)), lang) : '—')
export const fmtPct = (v, lang) => (isNum(v) ? `${numL(Math.round(Number(v)), lang)}%` : '—')
export const fmtKm = (v, lang) => {
  if (!isNum(v)) return '—'
  return numL(String(Math.round(Number(v) * 10) / 10), lang)
}
export const fmtTime = (v, lang) => {
  const m = String(v == null ? '' : v).match(/\d{1,2}:\d{2}/)
  return m ? numL(m[0], lang) : ''
}
// 'YYYY-MM-DD' -> 'DD/MM/YYYY' (timezone-safe: no Date parsing).
export function fmtReportDay(day, lang) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day || ''))
  return m ? numL(`${m[3]}/${m[2]}/${m[1]}`, lang) : ''
}
// "as of 18:40" (en) / "18:40 સુધીનું" (gu) - word order differs per language.
export function fmtAsOf(time, lang) {
  const tm = fmtTime(time, lang)
  if (!tm) return ''
  return lang === 'gu' ? `${tm} ${t('as_of', 'gu')}` : `${t('as_of', 'en')} ${tm}`
}
export const fmtAge = (hours, lang) => numL(ageLabel(isNum(hours) ? Number(hours) : null, lang), lang)

const arr = (v) => (Array.isArray(v) ? v : [])

// Inline label: lower-case the first letter in English so a reused label reads
// mid-sentence ("53 cameras off", not "53 Cameras off"). Acronyms (TA/DA) and
// Gujarati are left untouched.
export function inlineLabel(key, lang) {
  const s = t(key, lang)
  if (lang !== 'en' || s.length < 2) return s
  return /[A-Z]/.test(s[1]) ? s : s[0].toLowerCase() + s.slice(1)
}

// How many stations have a fault. faults.stations is only the top 3, so when the
// listed offline screens add up to less than the total offline count there are
// more stations than listed -> "N+".
export function stationsLabel(faults, lang) {
  const list = arr(faults && faults.stations)
  const listed = list.reduce((s, x) => s + (Number(x && x.offline) || 0), 0)
  const more = isNum(faults && faults.offline) && Number(faults.offline) > listed
  return `${numL(list.length, lang)}${more ? '+' : ''} ${t('stations_word', lang)}`
}

function stationLine(s, lang) {
  return `- ${(s && s.name) || '—'}: ${fmtInt(s && s.offline, lang)} ${t('down_word', lang)} · ${fmtAge(s && s.oldest_hours, lang)}`
}

// ───────────── technician ─────────────
function execText(r, lang) {
  const tech = r.tech || {}
  const ck = r.checkin || {}
  const up = r.uptime || {}
  const f = r.faults || {}
  const tk = r.tickets || {}
  const c = r.calls || {}
  const closed = r.closed === true
  const L = []
  L.push(HEADER)
  L.push(`${t('evening_report', lang)} · ${fmtReportDay(r.day, lang)}`)
  if (tech.name) L.push(tech.name)
  L.push(ck.at ? `${t('checked_in_at', lang)} ${fmtTime(ck.at, lang)}` : t('not_checked_in', lang))
  L.push('')
  L.push(`• ${t('fixed_today_w', lang)}: ${fmtInt(tk.fixed, lang)}`)
  L.push(`• ${t('logged_word', lang)}: ${fmtInt(tk.logged, lang)}`)
  L.push(`• ${t('in_process', lang)}: ${fmtInt(tk.in_progress, lang)}`)
  // Live screen figures exist only on a still-open day; once the day is closed there is nothing live
  // to say, so the line is left out rather than printed as "Still open: Day closed".
  if (!closed && isNum(f.offline)) {
    L.push(`• ${t('still_open', lang)}: ${fmtInt(f.offline, lang)} (${stationsLabel(f, lang)})`)
  }
  L.push(`• ${t('depot_calls', lang)}: ${fmtInt(c.depot_total, lang)} (${fmtInt(c.depot_answered, lang)} ${t('answered_word', lang)})`)
  L.push(`• ${t('km_travelled', lang)}: ${fmtKm(r.km, lang)}`)
  let upLine = `• ${t('uptime_now', lang)}: ${fmtPct(up.pct, lang)}`
  if (isNum(up.total) && Number(up.total) > 0) upLine += ` (${fmtInt(up.up, lang)}/${fmtInt(up.total, lang)})`
  L.push(upLine)
  if (isNum(up.month_pct)) L.push(`• ${t('uptime_month', lang)}: ${fmtPct(up.month_pct, lang)}`)
  if (isNum(tk.over_48h) && Number(tk.over_48h) > 0) {
    L.push(`• ${t('open_over_48h', lang)}: ${fmtInt(tk.over_48h, lang)}`)
  }
  const st = arr(f.stations)
  if (!closed && st.length) {
    L.push('')
    L.push(`${t('worst_now', lang)}:`)
    st.forEach(s => L.push(stationLine(s, lang)))
  }
  L.push('')
  L.push(FOOTER)
  return L.join('\n')
}

// ───────────── head ─────────────
function techLine(tk, i, lang) {
  const parts = [`${numL(i + 1, lang)}. ${tk.name || '—'}`]
  parts.push(tk.checkin_at ? `${inlineLabel('checked_in_at', lang)} ${fmtTime(tk.checkin_at, lang)}` : inlineLabel('not_checked_in', lang))
  let u = `${t('up_word', lang)} ${fmtPct(tk.uptime_pct, lang)}`
  if (isNum(tk.month_pct)) u += ` (${inlineLabel('month_word', lang)} ${fmtPct(tk.month_pct, lang)})`
  parts.push(u)
  if (isNum(tk.offline)) parts.push(`${t('down_word', lang)} ${fmtInt(tk.offline, lang)}`)
  parts.push(`${inlineLabel('tab_open', lang)} ${fmtInt(tk.open, lang)}`)
  parts.push(`${inlineLabel('fixed_word', lang)} ${fmtInt(tk.fixed, lang)}`)
  parts.push(`${inlineLabel('calls_word', lang)} ${fmtInt(tk.depot_answered, lang)}/${fmtInt(tk.depot_calls, lang)}`)
  parts.push(`${fmtKm(tk.km, lang)} ${t('km_word', lang)}`)
  return parts.join(' · ')
}

function needsLines(n, lang) {
  const L = []
  const names = (a) => arr(a).filter(Boolean).join(', ')
  if (arr(n.not_checked_in).length) L.push(`- ${t('not_checked_in', lang)}: ${names(n.not_checked_in)}`)
  if (arr(n.faults_no_calls).length) L.push(`- ${t('faults_no_calls', lang)}: ${names(n.faults_no_calls)}`)
  if (arr(n.push_missing).length) L.push(`- ${t('push_missing', lang)}: ${names(n.push_missing)}`)
  if (arr(n.no_whatsapp).length) L.push(`- ${t('no_whatsapp', lang)}: ${names(n.no_whatsapp)}`)
  const lv = Number(n.pending_leave) || 0
  const ta = Number(n.pending_ta) || 0
  if (lv > 0 || ta > 0) {
    L.push(`- ${t('approvals', lang)}: ${fmtInt(lv, lang)} ${inlineLabel('leave_requests', lang)} · ${fmtInt(ta, lang)} ${inlineLabel('ta_claims', lang)}`)
  }
  if ((Number(n.over_48h_total) || 0) > 0) L.push(`- ${t('open_over_48h', lang)}: ${fmtInt(n.over_48h_total, lang)}`)
  return L
}

function headText(r, lang, maxTechs) {
  const net = r.network || {}
  const totals = r.totals || {}
  const techs = arr(r.techs)
  const closed = r.closed === true
  const shown = typeof maxTechs === 'number' ? techs.slice(0, maxTechs) : techs
  const L = []
  L.push(HEADER)
  const asOf = fmtAsOf(r.as_of, lang)
  L.push(`${t('evening_report', lang)} · ${fmtReportDay(r.day, lang)}${asOf ? ` (${asOf})` : ''}`)
  if (closed) {
    L.push(`${t('network', lang)}: ${t('day_closed', lang)}`)
  } else {
    L.push(`${t('network', lang)}: ${fmtInt(net.up, lang)}/${fmtInt(net.total, lang)} ${t('up_word', lang)} (${fmtPct(net.pct, lang)}) · ${fmtInt(net.down, lang)} ${t('down_word', lang)} · ${fmtInt(net.camera_off, lang)} ${inlineLabel('cameras_off', lang)}`)
  }
  L.push(`${t('fixed_today_w', lang)}: ${fmtInt(totals.fixed, lang)} · ${t('depot_calls', lang)}: ${fmtInt(totals.depot_calls, lang)} · ${t('km_travelled', lang)}: ${fmtKm(totals.km, lang)}`)
  L.push('')
  L.push(`${t('my_techs', lang)} (${fmtInt(techs.length, lang)}):`)
  if (!techs.length) L.push(`- ${t('no_techs_yet', lang)}`)
  shown.forEach((tk, i) => L.push(techLine(tk, i, lang)))
  if (shown.length < techs.length) L.push(`+${fmtInt(techs.length - shown.length, lang)}`)
  const needs = needsLines(r.needs || {}, lang)
  if (needs.length) {
    L.push('')
    L.push(`${t('ev_needs_you', lang)}:`)
    needs.forEach(x => L.push(x))
  }
  const ws = arr(r.worst_stations)
  if (!closed && ws.length) {
    L.push('')
    L.push(`${t('worst_now', lang)}:`)
    ws.forEach(s => L.push(stationLine(s, lang)))
  }
  L.push('')
  L.push(FOOTER)
  return L.join('\n')
}

export function formatOpsEveningText(report, kind, lang) {
  if (!report || typeof report !== 'object' || report.ok !== true) return ''
  const k = kind === 'head' ? 'head' : 'exec'
  const lg = resolveEveningLang(k, lang)
  if (k === 'exec') return execText(report, lg)
  // Head: trim the tech list (from the bottom, i.e. the best performers) until
  // the encoded message fits a WhatsApp deep link. Never trims below 3 techs.
  const n = arr(report.techs).length
  let text = headText(report, lg)
  for (let keep = n - 1; keep >= 3 && encodeURIComponent(text).length > MAX_ENCODED; keep--) {
    text = headText(report, lg, keep)
  }
  return text
}

export function shareOpsEvening(report, kind, lang) {
  const text = formatOpsEveningText(report, kind, lang)
  if (!text) return false
  openWhatsAppShare(text)
  return true
}

export default { formatOpsEveningText, shareOpsEvening }
