// Phase 618 - the offer-link WhatsApp message, shared by the offer form and the hiring card.
export function offerWhatsAppText(offer, link) {
  return [
    `Dear ${offer.candidate_name},`,
    '',
    `Congratulations! Untitled Advertising would like to offer you the position of *${offer.position}*.`,
    '',
    `Please open the link below to review the terms, complete your personal details, and digitally accept the offer:`,
    link,
    '',
    `Looking forward to having you on the team.`,
    '',
    `Untitled Advertising`,
  ].join('\n')
}

// Phase 618 - login settings carried by the offer into admin_create_user. A legacy offer
// (made before Phase 618) has none, so it keeps the old rule: sales / telecaller = PRIVATE,
// every other role = ALL, and the RPC's own allowance defaults (TA/DA/Hotel off, Other on).
export function offerLoginArgs(offer) {
  const role = offer.designation_auth_role || 'sales'
  return {
    p_manager_id:     offer.manager_id || null,
    p_segment_access: offer.segment_access || ((role === 'sales' || role === 'telecaller') ? 'PRIVATE' : 'ALL'),
    p_allow_ta:       offer.allow_ta ?? false,
    p_allow_da:       offer.allow_da ?? false,
    p_allow_hotel:    offer.allow_hotel ?? false,
    p_allow_other:    offer.allow_other ?? true,
  }
}

// Phase 665/676 - which daily targets a role is scored on (mirrors compute_daily_score):
// telecaller = calls/day, sales = meetings/day, any head = team average, everyone else = not scored.
// Takes a designation row ({ auth_role, team_role }). One rule for Add Member + Send offer.
export function designationTargetKind(d) {
  if (!d) return 'none'
  if (d.team_role === 'sales_manager') return 'team'
  if (d.auth_role === 'telecaller') return 'telecaller'
  if (d.auth_role === 'sales') return 'sales'
  return 'none'
}

// Daily targets to save with the login, or null when the offer sets none.
export function offerTargets(offer) {
  const t = { min_calls: Number(offer.min_calls) || 0, min_quotes: Number(offer.min_quotes) || 0, min_followups: Number(offer.min_followups) || 0 }
  const meetings = Number(offer.min_meetings) || 0   // Phase 676 - sales meeting target
  if (meetings > 0) t.min_meetings = meetings
  return (t.min_calls || t.min_quotes || t.min_followups || meetings) ? t : null
}
