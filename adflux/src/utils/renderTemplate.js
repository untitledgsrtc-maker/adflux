// src/utils/renderTemplate.js
//
// Tiny template engine for the proposal_templates body_html.
//
// Supports {{placeholder}} substitution. Values may be strings or
// HTML fragments. The output is HTML, intended to be set with
// dangerouslySetInnerHTML on a <div className="govt-letter__body">.
//
// Placeholders we expect from the seeded templates:
//   {{recipient}}        — multi-line address block (HTML <br/> joined)
//   {{date}}             — Gujarati-digit date
//   {{quantity}}         — Gujarati-digit total qty (Auto only)
//   {{districts_count}}  — Gujarati-digit count
//   {{months}}           — Gujarati-digit campaign months (GSRTC only)
//   {{rate_table}}       — pre-rendered HTML table
//   {{selected_stations}}— Gujarati-digit station count
//   {{signer_block}}     — HTML signer block
//   {{enclosures_block}} — already inline in template, no substitution
//
// Unknown placeholders are left intact so a typo is visible in the
// rendered preview rather than silently swallowed.

export function renderTemplate(body, vars = {}) {
  if (!body) return ''
  return body.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (m, key) => {
    if (key in vars) {
      const val = vars[key]
      return val == null ? '' : String(val)
    }
    return m
  })
}
