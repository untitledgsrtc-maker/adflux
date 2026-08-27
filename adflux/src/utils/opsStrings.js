// src/utils/opsStrings.js
//
// Operations module i18n — Gujarati-first for the roving field team
// (operation_executive), English for the desk (operation_head / admin).
// Owner directive (Phase 0, §230): "opration excutive dont know englis
// much" → the field UI defaults to Gujarati; a per-user toggle lets any
// exec flip to English.
//
// This is a small, SCOPED label table — NOT an app-wide i18n framework
// (none exists). Pattern mirrors GovtProposalRenderer.jsx's STR block +
// reuses gujaratiNumber.js for digits/dates. Add a key here → use it via
// t(key, lang). A missing key falls back to English then to the key name,
// so a half-translated string can never crash the render.

import {
  toGujaratiDigits,
  formatDateGujarati,
} from './gujaratiNumber'

// { gu, en } for every field-app label. Keep both filled.
export const STR = {
  // — chrome / greeting —
  greeting:        { gu: 'નમસ્તે',                      en: 'Hello' },
  today_work:      { gu: 'આજનું કામ',                   en: "Today's work" },
  operations:      { gu: 'ઓપરેશન',                      en: 'Operations' },
  refresh:         { gu: 'ફરી લોડ કરો',                 en: 'Refresh' },
  loading:         { gu: 'લોડ થાય છે…',                 en: 'Loading…' },
  error_generic:   { gu: 'કંઈક ખોટું થયું',             en: 'Something went wrong' },
  save_failed:     { gu: 'સેવ નિષ્ફળ',                  en: 'Save failed' },
  retry:           { gu: 'ફરી પ્રયત્ન કરો',             en: 'Try again' },
  save:            { gu: 'સાચવો',                       en: 'Save' },
  saving:          { gu: 'સાચવે છે…',                    en: 'Saving…' },
  cancel:          { gu: 'રદ કરો',                      en: 'Cancel' },
  close:           { gu: 'બંધ કરો',                     en: 'Close' },

  // — check-in —
  check_in:        { gu: 'હાજરી પુરો (ચેક-ઇન)',         en: 'Check in' },
  checking_in:     { gu: 'ચેક-ઇન થાય છે…',              en: 'Checking in…' },
  checked_in_at:   { gu: 'ચેક-ઇન થયું',                 en: 'Checked in' },
  check_in_hint:   { gu: 'દિવસ શરૂ કરવા ચેક-ઇન કરો',    en: 'Check in to start your day' },

  // — stats —
  open_tickets:    { gu: 'ખુલ્લા કામ',                  en: 'Open tickets' },
  resolved_today:  { gu: 'આજે પૂરા કરેલા',              en: 'Resolved today' },

  // — fault report —
  report_fault:    { gu: 'ખરાબી નોંધાવો',               en: 'Report a fault' },
  report_title:    { gu: 'નવી ખરાબી',                   en: 'New fault' },
  pick_depot:      { gu: 'બસ સ્ટેશન પસંદ કરો',          en: 'Pick a bus station' },
  pick_screen:     { gu: 'સ્ક્રીન પસંદ કરો',            en: 'Pick a screen' },
  pick_issue:      { gu: 'સમસ્યા પસંદ કરો',             en: 'Pick the problem' },
  priority:        { gu: 'મહત્ત્વ',                     en: 'Priority' },
  prio_low:        { gu: 'ઓછું',                        en: 'Low' },
  prio_normal:     { gu: 'સામાન્ય',                     en: 'Normal' },
  prio_high:       { gu: 'વધારે',                       en: 'High' },
  report_saved:    { gu: 'ખરાબી નોંધાઈ ગઈ',             en: 'Fault reported' },

  // — ticket queue / detail —
  my_tickets:      { gu: 'મારા કામ',                    en: 'My tickets' },
  no_tickets:      { gu: 'અત્યારે કોઈ કામ બાકી નથી',    en: 'Nothing pending right now' },
  photo_request:   { gu: 'ફોટો જોઈએ છે',               en: 'Photo request' },
  fault:           { gu: 'ખરાબી',                       en: 'Fault' },
  screen:          { gu: 'સ્ક્રીન',                     en: 'Screen' },
  depot:           { gu: 'બસ સ્ટેશન',                   en: 'Bus station' },
  problem:         { gu: 'સમસ્યા',                      en: 'Problem' },
  solution:        { gu: 'ઉકેલ',                        en: 'Suggested fix' },
  contacts:        { gu: 'સંપર્ક',                      en: 'Who to call' },
  call:            { gu: 'ફોન કરો',                     en: 'Call' },
  no_contacts:     { gu: 'આ સ્ટેશન માટે સંપર્ક નથી',    en: 'No contacts for this station' },

  // — status transitions —
  status:          { gu: 'સ્થિતિ',                      en: 'Status' },
  st_open:         { gu: 'ખુલ્લું',                     en: 'Open' },
  st_in_progress:  { gu: 'ચાલુ છે',                     en: 'In progress' },
  st_resolved:     { gu: 'પૂરું થયું',                  en: 'Resolved' },
  start_work:      { gu: 'કામ શરૂ કરો',                 en: 'Start work' },
  mark_resolved:   { gu: 'પૂરું થયું તરીકે નોંધો',      en: 'Mark resolved' },
  auto:            { gu: 'ઓટો',                         en: 'Auto' },

  // — fix log —
  cause:           { gu: 'શું ખરાબ હતું?',              en: 'What was wrong?' },
  cause_ph:        { gu: 'દા.ત. પાવર કેબલ ઢીલો હતો',    en: 'e.g. power cable was loose' },
  notes:           { gu: 'નોંધ',                        en: 'Notes' },
  notes_ph:        { gu: 'વધારાની માહિતી (વૈકલ્પિક)',   en: 'Extra detail (optional)' },

  // — log a screen issue (primary ops screen) —
  log_title:       { gu: 'સ્ક્રીન ખરાબી નોંધાવો',        en: 'Log a screen issue' },
  city:            { gu: 'શહેર',                        en: 'City' },
  pick_city:       { gu: 'શહેર પસંદ કરો',               en: 'Pick a city' },
  who_to_call:     { gu: 'કોને ફોન કરવો',              en: 'Who to call' },
  no_contacts:     { gu: 'કોઈ સંપર્ક ઉમેર્યો નથી',      en: 'No contacts added yet' },
  screen:          { gu: 'સ્ક્રીન',                     en: 'Screen' },
  pick_screen:     { gu: 'સ્ક્રીન પસંદ કરો',            en: 'Pick a screen' },
  other_issue:     { gu: 'બીજું (લખો)',                en: 'Other (type it)' },
  upload_photo:    { gu: 'ફોટો અપલોડ કરો',             en: 'Upload photo' },
  save_issue:      { gu: 'ખરાબી સાચવો',                en: 'Save issue' },
  issue_saved:     { gu: 'ખરાબી સાચવાઈ',               en: 'Issue saved' },
  recent_issues:   { gu: 'આ સ્ક્રીન પર નોંધાયેલ',       en: 'Logged on this screen' },
  no_recent:       { gu: 'હજુ કંઈ નોંધ્યું નથી',        en: 'Nothing logged yet' },
  need_screen:     { gu: 'પહેલા સ્ક્રીન પસંદ કરો',      en: 'Pick a screen first' },

  // — down now (live board) —
  down_now:        { gu: 'હાલ બંધ છે',                  en: 'Down now' },
  network_uptime:  { gu: 'નેટવર્ક ચાલુ',               en: 'Network uptime' },
  screens_down:    { gu: 'સ્ક્રીન બંધ',                 en: 'Screens down' },
  across_stations: { gu: 'સ્ટેશન પર',                  en: 'stations' },
  down_word:       { gu: 'બંધ',                         en: 'down' },
  not_logged:      { gu: 'નોંધ્યું નથી',                en: 'not logged yet' },
  nobody_assigned: { gu: 'કોઈ સોંપ્યું નથી',            en: 'nobody assigned' },
  on_it:           { gu: 'સંભાળે છે',                   en: 'on it' },
  log_whats_wrong: { gu: 'ખરાબી નોંધાવો',              en: "Log what's wrong" },
  all_up:          { gu: 'બધી સ્ક્રીન ચાલુ છે',         en: 'Every screen is up' },
  live_10min:      { gu: 'લાઇવ · દર ૧૦ મિનિટ',          en: 'live · every 10 min' },
  add_photo:       { gu: 'ફોટો ઉમેરો',                  en: 'Add a photo' },
  photo_added:     { gu: 'ફોટો ઉમેરાયો',                en: 'Photo added' },
  uploading:       { gu: 'ફોટો ચઢે છે…',                en: 'Uploading…' },
  fix_saved:       { gu: 'સાચવાઈ ગયું',                 en: 'Saved' },

  // — your pay (exec) —
  your_pay:        { gu: 'તમારો પગાર (અંદાજ)',           en: 'Your pay so far' },
  uptime_month:    { gu: 'આ મહિને સ્ક્રીન ચાલુ',          en: 'Screen uptime this month' },
  est_variable:    { gu: 'અંદાજિત ચલ પગાર',              en: 'Estimated variable pay' },
  pay_hint:        { gu: 'સ્ક્રીન વધુ ચાલુ → વધુ પગાર. અંદાજ માત્ર.',
                     en: 'More uptime → more pay. Indicative only.' },
  pay_nodata:      { gu: 'હજી પૂરતી માહિતી નથી',          en: 'Not enough data yet' },
  navigate:        { gu: 'રસ્તો બતાવો',                  en: 'Navigate' },

  // — head overview —
  network:         { gu: 'સ્ક્રીન નેટવર્ક',             en: 'Screen network' },
  total_screens:   { gu: 'કુલ સ્ક્રીન',                 en: 'Total screens' },
  online:          { gu: 'ચાલુ',                        en: 'Online' },
  offline:         { gu: 'બંધ',                         en: 'Offline' },
  unknown:         { gu: 'અજાણ',                        en: 'Unknown' },
  field_team:      { gu: 'ફિલ્ડ ટીમ',                   en: 'Field team' },
  head_phase2:     { gu: 'પૂરું ડેશબોર્ડ ટૂંક સમયમાં',
                     en: 'Full dashboard coming next phase — for now, live counts + open tickets.' },

  // — exec ticket dashboard —
  tickets_title:   { gu: 'ટિકિટ',                     en: 'Tickets' },
  tab_open:        { gu: 'ખુલ્લા',                     en: 'Open' },
  tab_proc:        { gu: 'ચાલુ',                       en: 'In process' },
  tab_fixed:       { gu: 'સુધારેલા',                   en: 'Fixed' },
  grouped:         { gu: 'સ્ટેશન પ્રમાણે',              en: 'Grouped' },
  individual:      { gu: 'એક એક',                      en: 'Individual' },
  down_word2:      { gu: 'બંધ',                        en: 'down' },
  log_whole:       { gu: 'આખું સ્ટેશન નોંધો',           en: 'Log the whole station' },
  submit_proc:     { gu: 'સાચવો → ચાલુમાં',            en: 'Submit → In process' },
  in_process:      { gu: 'ચાલુ છે',                    en: 'In process' },
  mark_fixed:      { gu: 'સુધારાયું',                  en: 'Mark fixed' },
  fixed_word:      { gu: 'સુધારેલું',                  en: 'Fixed' },
  no_open:         { gu: 'બધી સ્ક્રીન ચાલુ છે',         en: 'All screens up' },
  no_proc:         { gu: 'કંઈ ચાલુ નથી',               en: 'Nothing in process' },
  no_fixed:        { gu: 'હજુ કંઈ સુધાર્યું નથી',       en: 'Nothing fixed yet' },
  calling:         { gu: 'ફોન થાય છે',                 en: 'Calling' },
  recorded_auto:   { gu: 'આપોઆપ નોંધાય છે',            en: 'recorded automatically' },
  call_ended_q:    { gu: 'ફોન પૂરો — શું થયું?',        en: 'Call ended — what happened?' },
  out_reached:     { gu: 'વાત થઈ',                     en: 'Reached' },
  out_no_answer:   { gu: 'ઉપાડ્યો નહીં',               en: 'No answer' },
  out_will_come:   { gu: 'આવશે',                       en: 'Will come' },
  out_fixed_call:  { gu: 'ફોન પર જ સુધાર્યું',          en: 'Fixed on call' },
  save_call:       { gu: 'ફોન સાચવો',                  en: 'Save call' },
  call_note_ph:    { gu: 'નોંધ (વૈકલ્પિક)',            en: 'Note (optional)' },
  n_calls:         { gu: 'ફોન',                        en: 'call(s)' },
  still_offline_q: { gu: 'CMS હજુ બંધ બતાવે છે — તોય સુધારેલું નોંધવું?', en: 'The CMS still shows this offline — mark fixed anyway?' },
  fixed_by:        { gu: 'સુધાર્યું',                   en: 'Fixed by' },
}

// Resolve a label. Falls back gu → en → key so a missing translation is
// visible-but-safe, never a crash.
export function t(key, lang = 'gu') {
  const row = STR[key]
  if (!row) return key
  return row[lang] || row.en || key
}

// Localise a number: Gujarati digits for gu, plain for en.
export function numL(n, lang = 'gu') {
  const s = String(n ?? 0)
  return lang === 'gu' ? toGujaratiDigits(s) : s
}

// Localise a date (from an ISO/date string).
export function dateL(iso, lang = 'gu') {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return lang === 'gu'
    ? formatDateGujarati(d)
    : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

// Localise a time (HH:MM, 24h — same digits style per language).
export function timeL(iso, lang = 'gu') {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const hhmm = d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false })
  return lang === 'gu' ? toGujaratiDigits(hhmm) : hhmm
}

// Per-user language preference, persisted. Field team defaults to Gujarati.
const LS_KEY = 'ops_lang'

export function getOpsLang() {
  try {
    const v = localStorage.getItem(LS_KEY)
    return v === 'en' || v === 'gu' ? v : 'gu'
  } catch {
    return 'gu'
  }
}

export function setOpsLang(lang) {
  try { localStorage.setItem(LS_KEY, lang === 'en' ? 'en' : 'gu') } catch { /* ignore */ }
}
