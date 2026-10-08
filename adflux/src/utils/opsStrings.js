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
  open_tickets:    { gu: 'ખુલ્લી ખરાબી',                en: 'Open faults' },
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
  my_tickets:      { gu: 'મારી ખરાબી',                  en: 'My faults' },
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
  all_screens:     { gu: 'બધી સ્ક્રીન (આખું સ્ટેશન)',    en: 'All screens (whole station)' },
  show_all_screens:{ gu: 'બધી સ્ક્રીન બતાવો',          en: 'Show all screens' },
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
  ops_field:       { gu: 'ઓપરેશન · ફિલ્ડ',             en: 'Operations · field' },
  command_center:  { gu: 'કમાન્ડ સેન્ટર',              en: 'Command center' },
  live_console:    { gu: 'લાઇવ કન્સોલ',                en: 'Live console' },
  station_board:   { gu: 'સ્ટેશન બોર્ડ',               en: 'Station board' },
  needs_you:       { gu: 'તમારે જોવાનું',              en: 'Needs you' },
  unassigned_faults:{ gu: 'ટૅક વગરની ખરાબી',           en: 'Faults with no tech' },
  overdue_48h:     { gu: '૪૮ કલાકથી બંધ',              en: 'Down over 48 hours' },
  my_techs:        { gu: 'મારી ટીમ',                   en: 'My techs' },
  all_handled:     { gu: 'બધું સંભાળાયું છે',           en: 'Nothing needs you right now' },
  no_techs_yet:    { gu: 'હજી કોઈ ટૅક સોંપાયો નથી',    en: 'No techs assigned yet' },
  uptime_word:     { gu: 'અપટાઇમ',                     en: 'uptime' },
  fixes_word:      { gu: 'સુધાર્યા',                    en: 'fixed' },
  off_duty:        { gu: 'ડ્યુટી બહાર',                 en: 'off duty' },
  cameras_off:     { gu: 'કૅમેરા બંધ',                  en: 'Cameras off' },
  cam_working:     { gu: 'કૅમેરા ચાલુ',                 en: 'Cameras working' },
  all_cam_ok:      { gu: 'બધા કૅમેરા ચાલુ છે',          en: 'Every camera is on' },
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
  tickets_title:   { gu: 'ખરાબી',                     en: 'Faults' },
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
  reopen:          { gu: 'પાછું ઓપનમાં',               en: 'Back to open' },
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

  // — F4 triage (time-aware fault list) —
  hours_window:    { gu: 'સ્ક્રીન ૭ સવાર–૯ રાત',        en: 'Screens 7 AM–9 PM' },
  now_word:        { gu: 'હમણાં',                       en: 'now' },
  on_hours_now:    { gu: 'ચાલુ કલાક',                   en: 'on-hours' },
  off_hours_now:   { gu: 'બંધ કલાક',                    en: 'off-hours' },
  signal_lost:     { gu: 'સિગ્નલ ગયું · કારણ નક્કી કરો', en: 'signal lost · confirm reason' },
  timer_fault:     { gu: 'ટાઈમર · હજુ ચાલુ છે',          en: 'timer · still on' },
  still_on:        { gu: 'હજુ ચાલુ',                    en: 'still on' },
  all_quiet:       { gu: 'બધું શાંત · સ્ક્રીન રાત્રે બંધ છે', en: 'All quiet · screens off for the night' },
  screens_word:    { gu: 'સ્ક્રીન',                     en: 'screens' },
  stations_word:   { gu: 'સ્ટેશન',                      en: 'stations' },
  timer_faults_w:  { gu: 'ટાઈમર ખરાબી',                 en: 'timer faults' },
  worst_first:     { gu: 'સૌથી ખરાબ પહેલા',             en: 'worst first' },

  // — ops home (one dashboard) —
  home_kicker:     { gu: 'ઓપરેશન · ફિલ્ડ',              en: 'Operations · field' },
  pay_month:       { gu: 'તમારો પગાર · આ મહિને',         en: 'Your pay · this month' },
  needs_you:       { gu: 'તમારે જોવાનું · સૌથી ખરાબ પહેલા', en: 'Needs you · worst first' },
  see_all:         { gu: 'બધું જુઓ',                   en: 'See all' },
  live_board:      { gu: 'લાઇવ બોર્ડ',                  en: 'Live board' },
  fixed_today_w:   { gu: 'આજે સુધાર્યા',                en: 'Fixed today' },
  my_month:        { gu: 'આ મહિનો',                    en: 'My month' },
  my_perf:         { gu: 'મારું પરફોર્મન્સ',            en: 'My performance' },
  start_day_ban:   { gu: 'ચેક-ઇન બાકી — દિવસ શરૂ કરો',   en: 'Not checked in — start your day' },
  all_up_short:    { gu: 'બધી સ્ક્રીન ચાલુ',            en: 'All your screens are up' },

  // — Me tab (self-scoped) —
  tab_mystats:     { gu: 'મારું',                      en: 'Me' },
  my_salary_mo:    { gu: 'મારો પગાર · આ મહિને',         en: 'My salary · this month' },
  sal_base:        { gu: 'બેઝ',                        en: 'Base' },
  sal_variable:    { gu: 'ચલ',                         en: 'Variable' },
  var_fills:       { gu: 'અપટાઇમ સાથે ભરાશે',           en: 'fills in with uptime' },
  uptime_short:    { gu: 'ચાલુ',                       en: 'uptime' },
  my_calls:        { gu: 'મારા ફોન',                   en: 'My calls' },
  calls_month:     { gu: 'આ મહિને',                    en: 'this month' },
  calls_today:     { gu: 'આજે',                        en: 'today' },
  my_stations:     { gu: 'મારા સ્ટેશન',                en: 'My stations' },
  up_word:         { gu: 'ચાલુ',                       en: 'up' },
  fixed_this_mo:   { gu: 'આ મહિને સુધાર્યા',            en: 'Fixed this month' },
  avg_fix:         { gu: 'સરેરાશ સમય',                 en: 'avg to fix' },
  worst_now:       { gu: 'અત્યારે સૌથી ખરાબ',           en: 'Worst stations right now' },
  scoped_note:     { gu: 'ફક્ત તમારા સ્ટેશન · નેટવર્ક રિપોર્ટ પ્રમાણે', en: 'Your stations only · updates as the network reports' },
  no_stats:        { gu: 'હજી પૂરતી માહિતી નથી',        en: 'Not enough data yet' },
  hrs:             { gu: 'ક',                          en: 'h' },

  // — field-tech quick wins (2026-08-28) —
  travel_earned:   { gu: 'ટ્રાવેલ કમાણી',               en: 'Travel earned' },
  fix_steps:       { gu: 'કેવી રીતે ઠીક કરવું',          en: 'How to fix' },

  // — station fix screen (tap a station → contacts + call + fix) —
  which_screens:   { gu: 'કઈ સ્ક્રીન બંધ · નોંધ કરવા ટૅપ કરો', en: 'Which screens are off · tap to log' },
  fix_it:          { gu: 'ઠીક થઈ ગયું · ફોટો',           en: 'Fixed · add photo' },
  go_home:         { gu: 'ઘર',                          en: 'Home' },
  log_short:       { gu: 'નોંધો',                       en: 'Log' },

  // — network snapshot (home) —
  my_network:      { gu: 'તમારું નેટવર્ક',              en: 'Your network' },
  camera_off:      { gu: 'કૅમેરા બંધ',                  en: 'Camera off' },
  no_depot:        { gu: 'તમને હજી કોઈ સ્ટેશન સોંપાયું નથી', en: 'No stations assigned to you yet' },
  no_depot_hint:   { gu: 'હેડને તમારા સ્ટેશન સોંપવા કહો', en: 'Ask your head to assign your stations' },
  fixed_this_wk:   { gu: 'આ અઠવાડિયે',                  en: 'This week' },
  avg_uptime:      { gu: 'સરેરાશ ચાલુ',                 en: 'Avg uptime' },
  station_map:     { gu: 'મારા સ્ટેશન · નકશો',           en: 'My stations · map' },

  // — per-tech drill-down (command center) —
  on_duty:         { gu: 'ડ્યુટી પર',                   en: 'on duty' },
  not_checked_in:  { gu: 'ચેક-ઇન બાકી',                 en: 'Not checked in yet' },
  back:            { gu: 'પાછળ',                        en: 'Back' },
  tech_none:       { gu: 'આ ટૅકની માહિતી મળી નથી',       en: 'No data for this tech' },

  // — approvals (head approves the field team's leave + TA/DA) —
  approvals:       { gu: 'મંજૂરી બાકી',                 en: 'Approvals' },
  leave_requests:  { gu: 'રજા અરજી',                    en: 'Leave requests' },
  ta_claims:       { gu: 'TA/DA ક્લેમ',                 en: 'TA/DA claims' },
  approve:         { gu: 'મંજૂર',                       en: 'Approve' },
  reject:          { gu: 'નકારો',                       en: 'Reject' },
  no_pending_appr: { gu: 'મંજૂરી માટે કંઈ બાકી નથી',     en: 'Nothing waiting for approval' },
  half_day:        { gu: 'અડધો દિવસ',                   en: 'Half day' },
  paid_leave:      { gu: 'પગાર સાથે',                   en: 'Paid' },
  unpaid_leave:    { gu: 'પગાર વગર',                    en: 'Unpaid' },
  reject_note_ph:  { gu: 'નકારવાનું કારણ (વૈકલ્પિક)',    en: 'Reason for rejecting (optional)' },
  approved_ok:     { gu: 'મંજૂર થયું',                  en: 'Approved' },
  rejected_ok:     { gu: 'નકારાયું',                    en: 'Rejected' },
  receipt:         { gu: 'રસીદ',                        en: 'Receipt' },
  kind_ta:         { gu: 'TA (કિમી)',                   en: 'TA (km)' },
  kind_da:         { gu: 'DA (રાત)',                    en: 'DA (night)' },
  kind_hotel:      { gu: 'હોટેલ',                       en: 'Hotel' },
  kind_other:      { gu: 'બીજું',                       en: 'Other' },

  // — add / manage contacts (Phase 337) —
  add_contact:     { gu: 'સંપર્ક ઉમેરો',                 en: 'Add contact' },
  add_number_cta:  { gu: '+ નંબર ઉમેરો',                 en: '+ Add a number' },
  add_contact_hint:{ gu: 'આ સ્ટેશન પર ફોન કરવા માટે જેનો નંબર તમારી પાસે હોય તે ઉમેરો — ઇલેક્ટ્રિશિયન, ડેપો ઓફિસ, મેનેજર.', en: 'Add anyone at this station you can call — electrician, depot office, manager.' },
  no_contacts_add: { gu: 'કોઈ સંપર્ક નથી — પહેલો નંબર ઉમેરો', en: 'No contacts yet — add the first number' },
  contact_role:    { gu: 'કોણ છે?',                     en: 'Who is it?' },
  role_depot_office:{ gu: 'ડેપો ઓફિસ',                  en: 'Depot office' },
  role_electrician:{ gu: 'ઇલેક્ટ્રિશિયન',               en: 'Electrician' },
  role_manager:    { gu: 'ડેપો મેનેજર',                  en: 'Depot manager' },
  role_cleaning:   { gu: 'સફાઈ',                        en: 'Cleaning (safai)' },
  role_canteen:    { gu: 'કેન્ટીન',                      en: 'Canteen' },
  role_other:      { gu: 'બીજું',                       en: 'Other' },
  role_other_ph:   { gu: 'કોણ છે તે લખો (દા.ત. સુપરવાઇઝર)', en: 'Type who it is (e.g. Supervisor)' },
  contact_phone_ph:{ gu: 'ફોન નંબર',                    en: 'Phone number' },
  contact_name_ph: { gu: 'નામ (વૈકલ્પિક)',               en: 'Name (optional)' },
  role_pick_first: { gu: 'પહેલા પસંદ કરો કે કોણ છે',       en: 'Pick who this is first' },
  phone_invalid:   { gu: '૧૦ આંકડાનો સાચો ફોન નંબર લખો',  en: 'Enter a valid 10-digit phone number' },
  contact_dup:     { gu: 'આ નંબર અહીં પહેલેથી છે',         en: 'This number is already listed here' },
  contact_added:   { gu: 'નંબર ઉમેર્યો',                 en: 'Number added' },
  contact_add_failed:{ gu: 'ઉમેરાયું નહીં — ફરી પ્રયત્ન કરો', en: 'Could not add — try again' },
  contact_no_perm: { gu: 'આ સ્ટેશન પર નંબર ઉમેરવાની પરવાનગી નથી — હેડને કહો', en: 'Not allowed to add here — ask your head' },
  contact_remove:  { gu: 'કાઢી નાખો',                   en: 'Remove' },
  contact_remove_q:{ gu: 'આ નંબર કાઢી નાખવો?',            en: 'Remove this number?' },
  contact_removed: { gu: 'નંબર કાઢ્યો',                  en: 'Number removed' },
  contact_remove_failed:{ gu: 'કાઢી શકાયું નહીં',        en: 'Could not remove' },
  more_numbers:    { gu: 'બીજા નંબર',                   en: 'More numbers' },
  added_by_you:    { gu: 'તમે ઉમેર્યો',                  en: 'added by you' },
  added_by:        { gu: 'ઉમેર્યો',                     en: 'added by' },

  // — evening report (tech + head). APPEND-ONLY: every key below is NEW. The
  //   file has a few legacy duplicate keys (last one wins), so never re-declare
  //   an existing key here — reuse it (fixed_today_w, checked_in_at,
  //   not_checked_in, worst_now, cameras_off, approvals, all_handled …). —
  evening_report:  { gu: 'આજનો રિપોર્ટ',                en: "Today's report" },
  todays_report_view: { gu: 'આજનો રિપોર્ટ જુઓ',         en: "View today's report" },
  hide_report:     { gu: 'રિપોર્ટ છુપાવો',               en: 'Hide report' },
  share_whatsapp:  { gu: 'WhatsApp પર મોકલો',            en: 'Share on WhatsApp' },
  still_open:      { gu: 'હજુ બાકી',                    en: 'Still open' },
  km_travelled:    { gu: 'કિમી મુસાફરી',                 en: 'Km travelled' },
  depot_calls:     { gu: 'ડેપોને ફોન',                  en: 'Depot calls' },
  answered_word:   { gu: 'ઉપાડ્યા',                     en: 'answered' },
  uptime_now:      { gu: 'આજે સ્ક્રીન ચાલુ',             en: 'Screen uptime today' },
  as_of:           { gu: 'સુધીનું',                     en: 'as of' },
  day_closed:      { gu: 'દિવસ પૂરો',                   en: 'Day closed' },
  ev_needs_you:    { gu: 'આજે જોવાનું',                 en: 'Needs you today' },
  push_missing:    { gu: 'નોટિફિકેશન ચાલુ નથી',          en: 'Notifications not set up' },
  no_whatsapp:     { gu: 'WhatsApp નંબર નથી',            en: 'No WhatsApp number' },
  faults_no_calls: { gu: 'ખરાબી છે, ડેપોને ફોન નથી કર્યો', en: 'Faults open, no depot call' },
  open_over_48h:   { gu: '૪૮ કલાકથી વધુ ખુલ્લી ખરાબી',    en: 'Faults open over 48 hours' },
  report_load_failed: { gu: 'રિપોર્ટ લોડ થયો નથી',       en: "Couldn't load the report" },
  report_unavailable: { gu: 'આ રિપોર્ટ તમારા ખાતા માટે નથી', en: 'This report is not available for your account' },
  report_stale:    { gu: 'તાજું ન થયું — છેલ્લો રિપોર્ટ દેખાય છે', en: 'Could not refresh — showing the last report' },
  tech_word:       { gu: 'ટૅક',                         en: 'Tech' },
  ev_col_in:       { gu: 'ચેક-ઇન',                      en: 'In' },
  month_word:      { gu: 'મહિનો',                       en: 'Month' },
  calls_word:      { gu: 'ફોન',                         en: 'Calls' },
  calls_legend:    { gu: 'ફોન = ઉપાડ્યા / કર્યા',          en: 'Calls = answered / dialled' },
  km_word:         { gu: 'કિમી',                        en: 'km' },
  logged_word:     { gu: 'નોંધેલી ખરાબી',                en: 'Faults logged' },
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
