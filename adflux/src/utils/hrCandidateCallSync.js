// hrCandidateCallSync.js — Phase 284
// Auto-fetch HR recruitment calls from the device call log into hr_candidate_calls.
// Native-only (Capacitor). Reads the phone's recent calls via the CallLogReader
// plugin (same plugin the sales/TC flow uses, READ-ONLY reuse), matches each call
// to a candidate BY NUMBER (last-10), and upserts a 'device' call row. HR's calls
// to non-candidate numbers are ignored (never stored). §92-compliant: match by
// number + capture duration; the OEM call-TYPE is stored only as informational
// direction — nothing is gated on it. Best-effort: never throws to the caller.
import { Capacitor, registerPlugin } from '@capacitor/core'
import { supabase } from '../lib/supabase'

const CallLogReader = registerPlugin('CallLogReader')
const last10 = (s) => (s || '').replace(/\D/g, '').slice(-10)

// candidates: [{ id, phone }] (the loaded list). userId: the HR user (called_by).
// Returns the number of rows upserted (0 on web / no match / error).
export async function syncCandidateCalls(candidates, userId) {
  if (!Capacitor.isNativePlatform() || !userId || !Array.isArray(candidates) || !candidates.length) return 0

  const byPhone = new Map()
  for (const c of candidates) {
    const p = last10(c.phone)
    if (p.length === 10) byPhone.set(p, c.id)
  }
  if (!byPhone.size) return 0

  let calls = []
  try {
    const sinceMs = Date.now() - 7 * 24 * 60 * 60 * 1000  // last 7 days
    const res = await CallLogReader.scanRecentCalls({ sinceTimestamp: sinceMs, limit: 300 })
    calls = Array.isArray(res?.calls) ? res.calls : []
  } catch {
    return 0  // no permission / plugin missing / web — silent
  }

  const rows = []
  for (const k of calls) {
    const cid = byPhone.get(last10(k.number))
    if (!cid) continue
    const ms = Number(k.date) || 0
    if (!ms) continue
    const dur = Number(k.durationSeconds) || 0
    const type = (k.type || '').toLowerCase()
    const direction = type === 'missed' ? 'missed'
      : type === 'incoming' ? 'incoming'
      : type === 'outgoing' ? 'outgoing'
      : null
    // outcome is derived from DURATION ALONE, never the OEM type (§92): real talk
    // time = connected, else no-answer. (direction is stored informational only.)
    // HR sets a meaningful judgment (shortlisted / rejected) via the candidate stage.
    const outcome = dur >= 1 ? 'connected' : 'no_answer'
    rows.push({
      candidate_id: cid,
      called_by: userId,
      call_at: new Date(ms).toISOString(),
      duration_seconds: dur,
      direction,
      outcome,
      source: 'device',
      notes: 'Auto · device call log',
    })
  }
  if (!rows.length) return 0

  const { error } = await supabase
    .from('hr_candidate_calls')
    .upsert(rows, { onConflict: 'candidate_id,call_at', ignoreDuplicates: true })
  return error ? 0 : rows.length
}
