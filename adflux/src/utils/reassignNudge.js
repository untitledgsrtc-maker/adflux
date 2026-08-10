// src/utils/reassignNudge.js
//
// Phase 285 — "you've called this lead too many times, hand it off" nudge.
//
// Owner ask (2026-08-10): "when a telecaller calls more than 5 times per lead,
// a popup should let them reassign the lead to another person." Built as a
// post-call suggestion (mirrors the WhatsApp-prompt insertion in the frozen
// call chain) — it does NOT touch the tel:→1.5s→PostCallOutcomeModal chain.
//
// A "call" = a call_logs row for (lead_id, user_id) — the tel-tap audit
// (callAudit.js) writes one on every physical tap, deduped (§170), so the
// count reflects real attempts by THIS rep. After a reassign the new owner
// starts at 0 for that lead → they get their own nudge later. No score/pay
// impact: this only READS call_logs + leads.
//
// Dismiss memory: if the rep taps "Keep working it", we remember (lead, rep)
// in localStorage for 24h so we don't nag on every subsequent call. Reassign
// itself needs no memory — the lead leaves this rep's queue.

// Owner's threshold: strictly MORE than 5 → suggest at the 6th call.
const CALL_THRESHOLD = 5
const DISMISS_TTL_MS = 24 * 60 * 60 * 1000 // re-offer the next day
const DISMISS_KEY = 'reassignNudgeDismissed'

function loadDismissed() {
  try {
    const raw = localStorage.getItem(DISMISS_KEY)
    if (!raw) return {}
    const obj = JSON.parse(raw)
    return obj && typeof obj === 'object' ? obj : {}
  } catch {
    return {}
  }
}

function keyFor(userId, leadId) {
  return `${userId}:${leadId}`
}

function isDismissed(userId, leadId) {
  if (!userId || !leadId) return false
  const map = loadDismissed()
  const exp = map[keyFor(userId, leadId)]
  return typeof exp === 'number' && exp > Date.now()
}

// Remember "keep working it" for this (rep, lead) for 24h. Prunes expired
// entries so the store can't grow forever.
export function dismissReassignNudge(userId, leadId) {
  if (!userId || !leadId) return
  try {
    const map = loadDismissed()
    const now = Date.now()
    const next = {}
    for (const [k, v] of Object.entries(map)) {
      if (typeof v === 'number' && v > now) next[k] = v
    }
    next[keyFor(userId, leadId)] = now + DISMISS_TTL_MS
    localStorage.setItem(DISMISS_KEY, JSON.stringify(next))
  } catch {
    // best-effort — a full/blocked storage just means we may re-offer sooner
  }
}

// Returns the call count (>5) when a reassign should be suggested, else null.
// Best-effort: any query error or a closed/missing lead → null (no nudge).
export async function checkReassignNudge(supabase, { leadId, userId }) {
  if (!supabase || !leadId || !userId) return null
  if (isDismissed(userId, leadId)) return null
  try {
    // Skip already-closed leads — reassigning Won/Lost is blocked by the RPC
    // and nudging on a just-closed lead is pointless.
    const { data: lead, error: leadErr } = await supabase
      .from('leads')
      .select('stage')
      .eq('id', leadId)
      .maybeSingle()
    if (leadErr || !lead) return null
    if (lead.stage === 'Won' || lead.stage === 'Lost') return null

    const { count, error } = await supabase
      .from('call_logs')
      .select('id', { count: 'exact', head: true })
      .eq('lead_id', leadId)
      .eq('user_id', userId)
    if (error) return null

    const n = count || 0
    return n > CALL_THRESHOLD ? n : null
  } catch {
    return null
  }
}
