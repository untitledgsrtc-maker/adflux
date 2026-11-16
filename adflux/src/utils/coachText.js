// src/utils/coachText.js
//
// Phase 574 — evening coach text. The database picks each action (kind +
// detail, supabase_phase574_coach_sales_tc.sql); this file only turns it into
// one English and one Gujarati sentence. No AI, so every name and amount is the
// app's own data.

import { formatCurrency } from './formatters'

const HAS_WORD = /[\p{L}\p{N}]/u

// first value that has a real letter/number in it ('.', '-', '' are skipped)
function pickWho(d) {
  for (const v of [d?.who, d?.name, d?.phone]) {
    if (v && HAS_WORD.test(String(v))) return String(v).trim()
  }
  return null
}

function shortDate(iso) {
  if (!iso) return ''
  const dt = new Date(`${iso}T00:00:00`)
  return dt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}

function hhmm(hourDecimal) {
  const h = Math.floor(hourDecimal)
  const m = Math.round((hourDecimal - h) * 60)
  const mm = String(m === 60 ? 0 : m).padStart(2, '0')
  const hh = m === 60 ? h + 1 : h
  return `${hh > 12 ? hh - 12 : hh}:${mm} ${hh >= 12 ? 'pm' : 'am'}`
}

// '14:30' -> 14.5
function timeToHour(t) {
  const [h, m] = String(t).split(':').map(Number)
  return (h || 0) + (m || 0) / 60
}

// returns { en, gu }
export function coachText(kind, detail = {}) {
  const whoEn = pickWho(detail) || 'this lead'
  const whoGu = pickWho(detail) || 'આ લીડ'
  switch (kind) {
    case 'quote_chase': {
      const amt = formatCurrency(detail.amount)
      return {
        en: `Chase ${whoEn}: quote ${amt}, no contact for ${detail.days} days.`,
        gu: `${whoGu} નો ફોલો-અપ કરો: ${amt} નો ક્વોટ, ${detail.days} દિવસથી કોઈ સંપર્ક નથી.`,
      }
    }
    case 'new_lead': {
      const src = detail.source || 'enquiry'
      return {
        en: `Call ${whoEn} first: new lead from ${src}, not called yet.`,
        gu: `પહેલા ${whoGu} ને કૉલ કરો: ${src} ની નવી લીડ, હજી કૉલ નથી થયો.`,
      }
    }
    case 'meeting_no_quote':
      return {
        en: `Send the quote to ${whoEn}: you met on ${shortDate(detail.met)}.`,
        gu: `${whoGu} ને ક્વોટ મોકલો: ${shortDate(detail.met)} ના રોજ મીટિંગ થઈ હતી.`,
      }
    case 'overdue_callback':
      return {
        en: `Call back ${whoEn}: due since ${shortDate(detail.due)}.`,
        gu: `${whoGu} ને ફરી કૉલ કરો: ${shortDate(detail.due)} થી બાકી છે.`,
      }
    case 'start_time': {
      const t = hhmm(Number(detail.avg_hour) || 10)
      return {
        en: `Start your day by 9:30 am: your last 5 days averaged ${t}.`,
        gu: `સવારે 9:30 સુધીમાં દિવસ શરૂ કરો: છેલ્લા 5 દિવસનો સરેરાશ સમય ${t} છે.`,
      }
    }
    // Phase 575 — office Work staff
    case 'work_overdue': {
      const title = detail.title || 'your task'
      const forEn = detail.client ? ` for ${detail.client}` : ''
      const forGu = detail.client ? ` (${detail.client})` : ''
      return {
        en: `Finish "${title}"${forEn}: due since ${shortDate(detail.due)}.`,
        gu: `"${title}"${forGu} પૂરું કરો: ${shortDate(detail.due)} થી બાકી છે.`,
      }
    }
    case 'work_due_soon': {
      const title = detail.title || 'your task'
      const atEn = detail.due_time ? ` by ${hhmm(timeToHour(detail.due_time))}` : ''
      const atGu = detail.due_time ? ` ${hhmm(timeToHour(detail.due_time))} સુધીમાં` : ''
      return {
        en: `"${title}" is due on ${shortDate(detail.due)}${atEn}: start it first.`,
        gu: `"${title}" ${shortDate(detail.due)} ના રોજ${atGu} આપવાનું છે: પહેલા તે શરૂ કરો.`,
      }
    }
    case 'work_stuck': {
      const title = detail.title || 'your task'
      return {
        en: `"${title}" has been in progress for ${detail.days} days: finish it or tell your head.`,
        gu: `"${title}" ${detail.days} દિવસથી ચાલુ છે: પૂરું કરો અથવા હેડને જણાવો.`,
      }
    }
    case 'report_share':
      return {
        en: `Share your evening report every day: last week ${detail.shared} of ${detail.worked} days.`,
        gu: `દરરોજ સાંજનો રિપોર્ટ શેર કરો: ગયા અઠવાડિયે ${detail.worked} માંથી ${detail.shared} દિવસ.`,
      }
    default:
      return { en: '', gu: '' }
  }
}

// where tapping an action should take the rep
export function coachLink(action) {
  if (action?.kind === 'quote_chase' && action.quote_id) return `/quotes/${action.quote_id}`
  if (action?.lead_id) return `/leads/${action.lead_id}`
  if (action?.kind && action.kind.startsWith('work_')) return '/my-work'
  if (action?.kind === 'report_share') return '/my-work'
  return null
}
