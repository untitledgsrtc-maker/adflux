// offerTemplate.js — pick which offer-letter body a hire's designation gets.
// ONE source of truth for the sales / ops / telecaller / generic split.
// Driven only by the designation's own fields (auth_role + has_incentive),
// snapshotted onto hr_offers at send time (see supabase_phaseN_hr_offer_role_signal.sql).
//
// Owner decisions (2026-09-11):
//   - ONLY operation_executive / operation_head → the Operations letter.
//     Every other flat-salary 'staff' designation (designer, office boy, …) → generic.
//   - sales (has_incentive) → the existing sales letter, UNCHANGED.
//   - telecaller (has_incentive) → telecaller letter (same 5×/5%/2% incentive as sales, §30).
//   - everything else salaried → generic (pure fixed salary).
//
// Returns one of: 'sales' | 'ops' | 'telecaller' | 'generic'
// Unknown / null → 'generic' (safe: generic drops every sales-only annexure).
export function resolveOfferTemplate({ auth_role, has_incentive } = {}) {
  const r = String(auth_role || '').toLowerCase()
  if (r === 'operation_executive' || r === 'operation_head') return 'ops'
  if (has_incentive === true) {
    if (r === 'telecaller') return 'telecaller'
    if (r === 'sales') return 'sales'
  }
  return 'generic'
}

export const OFFER_TEMPLATES = ['sales', 'ops', 'telecaller', 'generic']
