// src/utils/leadEmailDraft.js
//
// Phase 177 — pre-meeting intro draft for PRIVATE leads. The lead-detail Email
// action opens a draft to the lead with this body + the company brochure
// attached (mobile) or linked (web). GOVERNMENT leads do NOT use this — they go
// through GovtProposalDetailV2's proposal email (Phase 176).
//
// §4 — company name + sign-off read from the PRIVATE `companies` row passed in
// (never hardcoded). If the company row is missing, falls back to the legal
// name so the draft still composes (the brochure attach is what makes it useful).
//
// Inputs:
//   lead    { name, company, email }
//   company { name }            — the segment='PRIVATE' companies row
//   rep     { name, mobile }    — the sender (logged-in user)
// Returns { subject, body }.

export function buildLeadEmailDraft({ lead, company, rep } = {}) {
  const contact = (lead?.name || '').trim() || 'Sir/Madam'
  const coName  = (company?.name || '').trim() || 'Untitled Adflux Pvt Ltd'
  const repName = (rep?.name || '').trim()
  const repMob  = (rep?.mobile || rep?.phone || '').toString().trim()

  const subject = `${coName} — Introduction & Brochure`

  const body =
    `Dear ${contact},\n\n` +
    `Thank you for your time. I'm sharing a brief introduction to ${coName} ` +
    `along with our brochure for your reference.\n\n` +
    `${coName} plans and executes outdoor (OOH) advertising across Gujarat — ` +
    `LED screens, hoardings, auto-rickshaw hoods, and mall & cinema media — ` +
    `for private brands. We handle planning, site selection, printing and ` +
    `execution end to end.\n\n` +
    `The attached brochure covers the media we offer, typical reach, and how a ` +
    `campaign comes together. I'd be glad to prepare a plan suited to your ` +
    `requirement.\n\n` +
    `Please feel free to reach me on the number below for anything further.\n\n` +
    `Thank you,\n` +
    (repName ? `${repName}\n` : '') +
    (repMob ? `${repMob}\n` : '') +
    `${coName}`

  return { subject, body }
}
