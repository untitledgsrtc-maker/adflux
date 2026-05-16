// src/utils/callAudit.js
//
// Phase 35.0 pass 6 — call-tap audit trail.
//
// Owner directive (16 May 2026): we need a way to detect reps who
// log a "call" outcome without actually tapping the Call button
// (i.e. faking the PostCallOutcomeModal). The frontend has been
// writing to `lead_activities` (rep claim) but the `call_logs`
// table — designed exactly for this audit purpose in Phase 12 —
// was never being written to.
//
// This helper writes a single row to `call_logs` at the moment
// the rep physically taps a tel: link / Call button on a lead.
// Combined with the existing `lead_activities` insert, it gives
// admin a two-source cross-check:
//
//   • lead_activities row    = "rep claims they called"
//   • matching call_logs row = "rep physically tapped Call"
//
// Missing call_logs row (with a lead_activities call entry from
// the same rep + lead in a 5-minute window) → suspicious.
//
// Schema constraint: outcome NOT NULL with CHECK enum. At tel-tap
// time we don't know the real outcome — the rep hasn't said the
// call connected, was no-answer, etc. We write `outcome='connected'`
// as a permissive default (it satisfies the CHECK constraint while
// preserving the audit signal). The real outcome lives in the
// paired lead_activities.outcome that the PostCallOutcomeModal
// saves once the rep returns from the dialer.
//
// Fire-and-forget: we deliberately do NOT await this in the calling
// code. The tel: link MUST fire on the user gesture or iOS Safari
// blocks the dialer hand-off — adding a network round-trip before
// the navigation would break that contract. Errors are swallowed
// (the rep's call still happens; the audit row is best-effort).
//
// Usage:
//   import { logCallAudit } from '../../utils/callAudit'
//   ...
//   window.location.href = `tel:+${phone}`   // user gesture
//   logCallAudit(supabase, { userId, leadId, phone })  // no await

export function logCallAudit(supabase, { userId, leadId, phone }) {
  if (!supabase || !userId) return
  try {
    supabase.from('call_logs').insert([{
      user_id:      userId,
      lead_id:      leadId || null,
      client_phone: phone || null,
      outcome:      'connected',
      notes:        'tel-tap audit (Phase 35.0 pass 6)',
    }]).then(({ error }) => {
      if (error) {
        // Don't toast — this is best-effort audit only.
        // Console log so devs can spot RLS / schema drift.
        console.warn('[callAudit] insert failed:', error.message)
      }
    })
  } catch (e) {
    console.warn('[callAudit] exception:', e?.message || e)
  }
}
