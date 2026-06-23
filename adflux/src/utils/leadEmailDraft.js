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

  const subject = `GSRTC LED Screen Advertising — ${coName}`

  const body =
    `Dear ${contact},\n\n` +
    `${coName} offers brand advertising on GSRTC LED screens — the digital ` +
    `display network at Gujarat State Road Transport (GSRTC) bus stands across ` +
    `the state.\n\n` +
    `The network spans 264 LED screens across 20 cities. Each bus stand sees ` +
    `thousands of commuters a day who wait 15-30 minutes — a high-dwell, ` +
    `high-recall setting, where a 10-second slot repeats through the day and ` +
    `stays with the viewer.\n\n` +
    `What sets it apart is AI-powered audience analytics: every screen reports ` +
    `real data — unique viewers, daily impressions, and gender & age ` +
    `distribution per location — so you know exactly who is seeing your brand, ` +
    `not an estimate.\n\n` +
    `The attached brochure has the full city-by-city screen list, audience ` +
    `numbers and slot options. We'd be glad to build a plan for your brand and ` +
    `budget.\n\n` +
    `For anything further, please reach me on the number below.\n\n` +
    (repName ? `${repName}\n` : '') +
    (repMob ? `${repMob}\n` : '') +
    `${coName}`

  return { subject, body }
}
