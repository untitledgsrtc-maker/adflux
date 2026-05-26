// src/pages/v2/CreateQuoteV2.jsx
//
// v2 shell around the existing WizardShell. The wizard itself is a
// complex multi-step state machine (store, draft persistence, rate-
// table calculator, GST toggle, cross-step validation). Rebuilding
// it would be a separate Phase-3 project — for now we just give it a
// v2 page wrapper so it sits cleanly inside V2AppShell.
//
// Phase 94 (26 May 2026) — PERMANENT FIX for the APK Edit / Renew
// blank-form bug.
//
// Background: phases 93.28 / 93.29 / 93.30 / 93.30.1 / 93.30.2 each
// tried a different fallback layer (router state, query string, in-
// memory module variable) to deliver the editingId from the producer
// (Edit button) to this consumer. Capacitor WebView is hostile to
// all three:
//   • Router state — dropped across history.pushState.
//   • Query string — useSearchParams races on first render.
//   • In-memory variable — sensitive to double-render consume order.
//
// Permanent solution: move the id into the URL PATH itself
// (`/quotes/edit/:id`). React Router's useParams() reads path
// segments deterministically — no race, no hostile WebView quirk.
//
// The state / query / in-memory layers are RETAINED as a deep-link
// fallback so any external bookmark or URL-share with `?editOf=` /
// `?renewalOf=` still works, but they are no longer load-bearing.

import { useState } from 'react'
import { useSearchParams, useLocation, useParams } from 'react-router-dom'
import { WizardShell } from '../../components/quotes/QuoteWizard/WizardShell'
import { consumePendingEditOf, consumePendingRenewalOf } from '../../lib/quoteIntent'

export default function CreateQuoteV2() {
  const [searchParams] = useSearchParams()
  const location = useLocation()
  const params = useParams()

  // Phase 94 — primary path: detect mode from URL pathname.
  //   /quotes/edit/<id>   → editOf  = <id>
  //   /quotes/renew/<id>  → renewalOf = <id>
  //   /quotes/new/private → new quote (both null)
  const path = location.pathname || ''
  const isEditPath   = path.startsWith('/quotes/edit/')
  const isRenewPath  = path.startsWith('/quotes/renew/')
  const routeId      = params.id || null

  // Legacy fallback snapshots — only used when the path doesn't carry
  // the id (e.g. URL bookmark to /quotes/new/private?editOf=…). Kept
  // for backwards compatibility with deep links shared before Phase 94.
  const [intentEditOf]    = useState(() => consumePendingEditOf())
  const [intentRenewalOf] = useState(() => consumePendingRenewalOf())

  const editOf =
    (isEditPath && routeId)                 // Phase 94 path param (primary)
    || location.state?.editingId            // Phase 93.28 router state
    || searchParams.get('editOf')           // Phase 32C query string
    || intentEditOf                         // Phase 93.30 in-memory

  const renewalOf =
    (isRenewPath && routeId)                // Phase 94 path param (primary)
    || location.state?.renewalOf
    || searchParams.get('renewalOf')
    || intentRenewalOf

  // ClientsV2's "New quote" button hands us a prefill payload via
  // router state. We pass it through to the wizard so Step1Client
  // starts with the client fields already populated.
  const prefill = location.state?.prefill || null

  return (
    <div className="v2d-wiz">
      <WizardShell renewalOf={renewalOf} editOf={editOf} prefill={prefill} />
    </div>
  )
}
