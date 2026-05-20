// src/utils/callHistoryIngest.js
//
// Phase 56l — periodic scan of Android system CallLog → ingest into
// our call_logs + lead_activities so per-lead and per-rep history
// includes INBOUND + MISSED calls (not just outgoing tel-tap rows).
//
// Owner directive (19 May 2026): "when person call back but we not
// received it should be missed call" + "per lead log and per
// representative log".
//
// Flow:
//   1. Every 5 min on app foreground, scan last 30 min of Android
//      CallLog via the CallLogReader plugin's scanRecentCalls method
//      (Phase 56l Java extension).
//   2. Plugin returns array of { number, type, date, durationSeconds }
//      where type ∈ outgoing | incoming | missed | voicemail |
//      rejected | blocked.
//   3. For each row:
//      a. Skip voicemail / blocked (not actionable).
//      b. Convert rejected → missed.
//      c. Check Supabase for a recent call_logs row matching
//         (user_id, client_phone, call_at within 60 sec) — if present,
//         skip (already captured via tel-tap audit).
//      d. Try to match a lead by phone (cleanPhone normalisation).
//      e. INSERT call_logs row with direction, duration, lead_id.
//      f. For inbound + missed only (outbound rows have a paired
//         lead_activities from PostCallOutcomeModal), INSERT
//         lead_activities so the lead timeline shows the inbound /
//         missed entry.
//
// Persisted state:
//   Use Capacitor Preferences to store `last-call-scan-ms` per user.
//   Next scan picks up from that timestamp.
//
// Web build: no-op (Capacitor.isNativePlatform() short-circuit).

import { Capacitor, registerPlugin } from '@capacitor/core'
import { Preferences } from '@capacitor/preferences'
import { supabase } from '../lib/supabase'

const CallLogReader = registerPlugin('CallLogReader')

const STORE_KEY = (userId) => `last-call-scan-ms-${userId}`
// Phase 68.3 (21 May 2026) — widen first-scan window to 7 days. The
// 30-min default meant a fresh APK install missed every call older
// than half an hour. 7 days = matches typical rep call history visible
// in /calls page (default date range).
const DEFAULT_LOOKBACK_MS = 7 * 24 * 60 * 60_000  // 7 days on first scan
const POLL_INTERVAL_MS    = 5  * 60_000   // re-scan every 5 min while foregrounded
const DEDUPE_WINDOW_SEC   = 60            // call_logs row within 60s = same call

let activeUserId = null
let pollTimer    = null
let visListener  = null

/**
 * Start periodic scanning. Native-only. Idempotent.
 * Run once on app shell mount + repeat every 5 min while foregrounded.
 */
export async function startCallHistoryPoller(userId) {
  if (!Capacitor.isNativePlatform()) return
  if (!userId) return
  if (activeUserId === userId && pollTimer) return

  activeUserId = userId

  // First scan happens immediately on mount.
  runScan(userId).catch((e) =>
    console.warn('[call-history] initial scan failed:', e?.message || e)
  )

  // Repeat every POLL_INTERVAL_MS.
  if (pollTimer) clearInterval(pollTimer)
  pollTimer = setInterval(() => {
    if (activeUserId) {
      runScan(activeUserId).catch(() => { /* swallowed */ })
    }
  }, POLL_INTERVAL_MS)

  // Also run on visibility-change → tab/app return = fresh scan.
  if (!visListener) {
    visListener = () => {
      if (document.visibilityState === 'visible' && activeUserId) {
        runScan(activeUserId).catch(() => {})
      }
    }
    document.addEventListener('visibilitychange', visListener)
  }
}

/**
 * Stop the poller (sign-out cleanup).
 */
export function stopCallHistoryPoller() {
  activeUserId = null
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
  if (visListener) {
    document.removeEventListener('visibilitychange', visListener)
    visListener = null
  }
}

/**
 * Phase 68.3 — force a full ingest pass with explicit lookback.
 * Used by the PushDebug "Scan call log now" button to ingest the
 * last N days in one shot (default 7 days). Bypasses the
 * last-scan-ms checkpoint so historical calls land.
 * Returns { found, inserted, skipped, errors }.
 */
export async function forceIngestRecentCalls(userId, lookbackMs = 7 * 24 * 60 * 60_000) {
  if (!Capacitor.isNativePlatform()) {
    return { found: 0, inserted: 0, skipped: 0, errors: ['web build — no native call log'] }
  }
  if (!userId) return { found: 0, inserted: 0, skipped: 0, errors: ['no user'] }

  const sinceMs = Date.now() - lookbackMs
  let calls = []
  try {
    const res = await CallLogReader.scanRecentCalls({
      sinceTimestamp: sinceMs,
      limit: 500,
    })
    calls = Array.isArray(res?.calls) ? res.calls : []
  } catch (e) {
    return { found: 0, inserted: 0, skipped: 0, errors: [e?.message || String(e)] }
  }

  // Snapshot count of call_logs for this user BEFORE we ingest, so we
  // can report inserted vs skipped accurately.
  const beforeRes = await supabase
    .from('call_logs')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
  const before = beforeRes?.count || 0

  // Process oldest-first so dedupe sees stable order.
  calls.sort((a, b) => Number(a.date) - Number(b.date))
  const errors = []
  for (const c of calls) {
    try {
      await ingestOne(userId, c)
    } catch (e) {
      errors.push(`${c?.number || '?'}: ${e?.message || String(e)}`)
    }
  }

  // Refresh poll checkpoint so the periodic scan doesn't re-process.
  await updateScanTimestamp(userId, Date.now())

  const afterRes = await supabase
    .from('call_logs')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
  const after = afterRes?.count || 0

  return {
    found: calls.length,
    inserted: Math.max(0, after - before),
    skipped: calls.length - Math.max(0, after - before),
    errors,
  }
}

/**
 * One scan pass. Reads last-scan timestamp from Preferences, queries
 * the plugin for everything since then, processes each row.
 */
async function runScan(userId) {
  // Resolve lookback start.
  let sinceMs
  try {
    const { value } = await Preferences.get({ key: STORE_KEY(userId) })
    sinceMs = value ? Number(value) : (Date.now() - DEFAULT_LOOKBACK_MS)
    if (!Number.isFinite(sinceMs)) sinceMs = Date.now() - DEFAULT_LOOKBACK_MS
  } catch {
    sinceMs = Date.now() - DEFAULT_LOOKBACK_MS
  }

  let calls = []
  try {
    const res = await CallLogReader.scanRecentCalls({
      sinceTimestamp: sinceMs,
      limit: 200,
    })
    calls = Array.isArray(res?.calls) ? res.calls : []
  } catch (e) {
    // Permission denied → swallow. NativeOnboarding handled the prompt.
    console.warn('[call-history] scan failed:', e?.message || e)
    return
  }

  if (calls.length === 0) {
    await updateScanTimestamp(userId, Date.now())
    return
  }

  // Process oldest-first so dedupe checks see a stable order.
  calls.sort((a, b) => Number(a.date) - Number(b.date))

  for (const c of calls) {
    try {
      await ingestOne(userId, c)
    } catch (e) {
      console.warn('[call-history] ingest failed for', c?.number, e?.message || e)
    }
  }

  await updateScanTimestamp(userId, Date.now())
}

async function ingestOne(userId, raw) {
  const number          = (raw?.number || '').toString()
  const type            = (raw?.type   || 'unknown').toString()
  const dateMs          = Number(raw?.date)
  const durationSeconds = Number(raw?.durationSeconds) || 0
  if (!number || !Number.isFinite(dateMs)) return

  // Normalise type → call_logs.direction enum.
  let direction
  if (type === 'outgoing')                              direction = 'outgoing'
  else if (type === 'incoming' && durationSeconds > 0)  direction = 'incoming'
  else if (type === 'incoming' && durationSeconds === 0) direction = 'missed'  // incoming with 0s = effectively missed
  else if (type === 'missed' || type === 'rejected')    direction = 'missed'
  else return  // voicemail / blocked / unknown → skip

  const callAtIso = new Date(dateMs).toISOString()
  const cleaned   = cleanPhone(number)

  // Dedupe: existing call_logs row within DEDUPE_WINDOW_SEC of this
  // timestamp + same phone + same user = already captured (the tel-tap
  // audit row for outgoing, or a prior scan pass for inbound).
  const dupeLower = new Date(dateMs - DEDUPE_WINDOW_SEC * 1000).toISOString()
  const dupeUpper = new Date(dateMs + DEDUPE_WINDOW_SEC * 1000).toISOString()
  const { data: existing } = await supabase
    .from('call_logs')
    .select('id, direction, duration_seconds')
    .eq('user_id', userId)
    .eq('client_phone', cleaned)
    .gte('call_at', dupeLower)
    .lte('call_at', dupeUpper)
    .limit(1)
    .maybeSingle()

  if (existing) {
    // Tel-tap audit row exists. Backfill direction + duration if they're
    // missing or generic, but don't double-write.
    const patch = {}
    if (existing.direction === 'outgoing' && direction !== 'outgoing') {
      // Unlikely (audit always outgoing) but defensive.
      patch.direction = direction
    }
    if ((existing.duration_seconds == null || existing.duration_seconds === 0)
        && durationSeconds > 0) {
      patch.duration_seconds = durationSeconds
    }
    if (Object.keys(patch).length > 0) {
      await supabase.from('call_logs').update(patch).eq('id', existing.id)
    }
    return
  }

  // Match the call to a lead by phone. Pick the most recent open lead
  // matching this phone for this user. Try telecaller_id first, fall
  // back to assigned_to. Two separate queries instead of `.or()` with
  // string interpolation (guardian P1, 19 May 2026) so no special
  // chars in userId can break PostgREST filter parsing.
  let leadId = null
  if (cleaned) {
    const tcQ = await supabase
      .from('leads')
      .select('id')
      .eq('telecaller_id', userId)
      .eq('phone', cleaned)
      .order('created_at', { ascending: false })
      .limit(1)
    if (tcQ.data && tcQ.data.length > 0) {
      leadId = tcQ.data[0].id
    } else {
      const asQ = await supabase
        .from('leads')
        .select('id')
        .eq('assigned_to', userId)
        .eq('phone', cleaned)
        .order('created_at', { ascending: false })
        .limit(1)
      if (asQ.data && asQ.data.length > 0) leadId = asQ.data[0].id
    }
  }

  // Outcome label for human readers.
  const outcome   = direction === 'missed' ? 'no_answer'
                  : direction === 'incoming' ? 'connected'
                  : 'connected'
  const noteLabel = direction === 'missed'   ? `Missed inbound call from ${number}`
                  : direction === 'incoming' ? `Incoming call answered (${durationSeconds}s)`
                  : `Outgoing call (${durationSeconds}s)`

  // Insert the call_logs row.
  const { error: clErr } = await supabase.from('call_logs').insert([{
    user_id:          userId,
    lead_id:          leadId,
    client_phone:     cleaned,
    call_at:          callAtIso,
    duration_seconds: durationSeconds,
    outcome,
    direction,
    notes:            noteLabel + ' (Phase 56l scan)',
  }])
  if (clErr) {
    console.warn('[call-history] call_logs insert failed:', clErr.message)
    return
  }

  // Phase 56l guardian P1 (19 May 2026): do NOT write lead_activities
  // for inbound / missed scanned calls. The Phase 34Z.66
  // compute_daily_score trigger fires on every lead_activities INSERT
  // with activity_type='call' — a rep receiving 10 inbound customer
  // calls a day would silently inflate their daily score by 10×
  // without doing anything. Score must reflect REP ACTION, not
  // passive ringing of the phone.
  //
  // The per-lead call history (LeadCallHistory.jsx) already merges
  // call_logs + lead_activities so inbound + missed calls surface
  // from the call_logs side. The Activity Timeline (which only reads
  // lead_activities) stays a rep-action log — also correct.
}

async function updateScanTimestamp(userId, ms) {
  try {
    await Preferences.set({
      key:   STORE_KEY(userId),
      value: String(ms),
    })
  } catch (e) {
    console.warn('[call-history] preference write failed:', e?.message || e)
  }
}

/**
 * Loose phone normalisation — strips +91 / spaces / dashes / parens
 * so a lead.phone like "+91 98765 43210" matches an Android log
 * "9876543210". Keeps the trailing 10 digits.
 */
function cleanPhone(raw) {
  if (!raw) return ''
  const digits = String(raw).replace(/[^0-9]/g, '')
  if (digits.length >= 10) return digits.slice(-10)
  return digits
}
