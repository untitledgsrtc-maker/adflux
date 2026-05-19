// src/pages/v2/CreateQuoteChooserV2.jsx
//
// Step 0 of the new-quote flow. Three tiles — one click picks both
// segment AND media:
//   1. Government × Auto Hood     (DAVP-rate auto rickshaw hood ad)
//   2. Government × GSRTC LED     (DAVP-rate bus depot LED screens)
//   3. Private × LED Cities       (existing AdFlux wizard)
//
// Sales reps with segment_access='PRIVATE' see Govt tiles greyed.
// Sales reps with segment_access='GOVERNMENT' see Private tile greyed.
// Admin / owner / co_owner see all three enabled.
//
// All UI inherits AdFlux design tokens (yellow accent, dark surfaces,
// Space Grotesk display font) so the chooser looks native — no new
// patterns introduced.

import { useEffect, useState } from 'react'
import { useNavigate, useLocation, useSearchParams } from 'react-router-dom'
import { Landmark, Tv, Building2, Lock, ArrowRight, Newspaper, Loader2 } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { supabase } from '../../lib/supabase'

export default function CreateQuoteChooserV2() {
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const { segmentAccess } = useAuth()

  const govtAllowed    = segmentAccess === 'ALL' || segmentAccess === 'GOVERNMENT'
  const privateAllowed = segmentAccess === 'ALL' || segmentAccess === 'PRIVATE'

  // Phase 11d (rev9) — forward prefill from ClientsV2 "+" button.
  // Owner reported "create quote via client not working": the chooser
  // was dropping location.state.prefill on every navigate, so clicking
  // "+" on a Client and then picking a segment landed in an empty
  // wizard. Now we pass the prefill through to whichever wizard the
  // user picks, so client info auto-fills Step 1.
  const incomingState = location.state || null
  function go(path) {
    navigate(path, incomingState ? { state: incomingState } : undefined)
  }

  // Phase 62.6 (20 May 2026) — auto-route on `?renewalOf=<quoteId>`.
  // Owner reported that clicking Renew on /renewal-tools landed reps
  // on this 4-card chooser instead of pre-filling the wizard. Now:
  //   1. If renewalOf is present, load the source quote.
  //   2. Pick the right wizard based on segment + media_type.
  //   3. Pass the source quote payload as location.state.prefill so
  //      the wizard pre-fills client + cities (existing prefill
  //      contract used by ClientsV2 "+" button).
  // Renders a brief loader while resolving. If the source quote
  // doesn't exist or fails RLS, falls through to the 4-card chooser
  // (rep can still pick manually).
  const renewalOfId = searchParams.get('renewalOf')
  const [renewalResolving, setRenewalResolving] = useState(!!renewalOfId)

  useEffect(() => {
    if (!renewalOfId) return
    ;(async () => {
      try {
        const { data: src, error } = await supabase
          .from('quotes')
          .select('id, segment, media_type, client_name, client_phone, client_email, lead_id')
          .eq('id', renewalOfId)
          .maybeSingle()
        if (error || !src) {
          setRenewalResolving(false)
          return
        }
        let target = '/quotes/new/private'
        const segment = (src.segment || '').toUpperCase()
        const mt = (src.media_type || '').toUpperCase()
        if (segment === 'GOVERNMENT' && mt === 'AUTO_HOOD') {
          target = '/quotes/new/government/auto-hood'
        } else if (segment === 'GOVERNMENT' && mt === 'GSRTC_LED') {
          target = '/quotes/new/government/gsrtc-led'
        } else if (['OTHER_MEDIA','OTHER','HOARDING','MALL','CINEMA','DIGITAL','NEWSPAPER'].includes(mt)) {
          target = '/quotes/new/private/other-media'
        }
        navigate(target, {
          replace: true,
          state: {
            prefill: {
              client_name:         src.client_name,
              client_phone:        src.client_phone,
              client_email:        src.client_email,
              lead_id:             src.lead_id,
              renewal_of_quote_id: src.id,
            },
          },
        })
      } catch (e) {
        console.warn('[chooser] renewalOf resolve failed:', e?.message || e)
        setRenewalResolving(false)
      }
    })()
  }, [renewalOfId, navigate])

  if (renewalResolving) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        gap: 10, padding: 60, color: 'var(--v2-ink-2, #94a3b8)',
      }}>
        <Loader2 size={18} style={{ animation: 'spin 1s linear infinite' }} />
        Preparing renewal…
      </div>
    )
  }

  return (
    <div className="govt-chooser">
      <div className="govt-chooser__head">
        <div className="govt-chooser__kicker">New Quote</div>
        <h1 className="govt-chooser__title">Pick what you're creating</h1>
        <p className="govt-chooser__sub">
          Government proposals run on DAVP rates with bilingual Gujarati letters.
          Private LED uses the existing Agency-rate flow.
        </p>
      </div>

      <div className="govt-chooser__grid">
        {/* GOVERNMENT × AUTO HOOD */}
        <Tile
          allowed={govtAllowed}
          onClick={() => go('/quotes/new/government/auto-hood')}
          variant="govt"
          icon={<Landmark size={28} strokeWidth={1.6} />}
          label="Government — Auto Hood"
          desc="DAVP-approved auto-rickshaw hood proposal across 33 Gujarat districts. Total quantity auto-distributed by % share."
          chips={[
            { text: 'DAVP rate ₹825', accent: true },
            { text: '33 districts' },
            { text: 'Auto-distribute' },
          ]}
        />

        {/* GOVERNMENT × GSRTC LED */}
        <Tile
          allowed={govtAllowed}
          onClick={() => go('/quotes/new/government/gsrtc-led')}
          variant="govt"
          icon={<Tv size={28} strokeWidth={1.6} />}
          label="Government — GSRTC LED"
          desc="AI-LED screens at GSRTC bus depot platforms. Pick stations + campaign months. DAVP rates by station category."
          chips={[
            { text: 'DAVP A/B/C rates', accent: true },
            { text: '20 stations' },
            { text: 'Months × screens' },
          ]}
        />

        {/* PRIVATE × LED CITIES */}
        <Tile
          allowed={privateAllowed}
          onClick={() => go('/quotes/new/private')}
          variant="private"
          icon={<Building2 size={28} strokeWidth={1.6} />}
          label="Private — LED Cities"
          desc="Private LED clients across Gujarat cities. Agency rates, GST options, follow-up automation. Use when client wants LED screen advertising at GSRTC bus stops."
          chips={[
            { text: 'Agency rates', accent: true },
            { text: 'LED Cities' },
          ]}
        />

        {/* PRIVATE × OTHER MEDIA — Phase 12 rev2.
            Owner spec: "private rep create quote he need to see 2 thing
            gsrtc quote or other media, so other media quote will be
            different". This tile covers newspaper / hoarding / cinema /
            mall / digital — anything that isn't LED. Single-page form
            with media-type picker + line items + total. */}
        <Tile
          allowed={privateAllowed}
          onClick={() => go('/quotes/new/private/other-media')}
          variant="private"
          icon={<Newspaper size={28} strokeWidth={1.6} />}
          label="Private — Other Media"
          desc="Newspaper, hoarding, cinema, mall, digital, radio. Free-form line items with rates. For everything that isn't LED screens."
          chips={[
            { text: 'Free-form rates', accent: true },
            { text: 'Newspaper · Hoarding · Cinema · Mall · Digital' },
          ]}
        />
      </div>

      {!govtAllowed && (
        <div className="govt-chooser__note">
          Your account is scoped to <strong>Private</strong>.
          Government proposals are locked. Talk to admin if this is wrong.
        </div>
      )}
      {!privateAllowed && (
        <div className="govt-chooser__note">
          Your account is scoped to <strong>Government</strong>.
          Private LED quotes are locked.
        </div>
      )}
    </div>
  )
}


/* Sub-component — one tile.
   Kept inline rather than in a separate file because it's only used
   here and the markup is short. */
function Tile({ allowed, onClick, variant, icon, label, desc, chips }) {
  return (
    <button
      type="button"
      disabled={!allowed}
      className={
        'govt-tile govt-tile--' + variant +
        (allowed ? '' : ' govt-tile--locked')
      }
      onClick={() => allowed && onClick()}
    >
      <div className="govt-tile__icon">{icon}</div>
      <div className="govt-tile__body">
        <div className="govt-tile__label">{label}</div>
        <div className="govt-tile__desc">{desc}</div>
        <div className="govt-tile__chips">
          {chips.map((c, i) => (
            <span
              key={i}
              className={'govt-chip' + (c.accent ? ' govt-chip--accent' : '')}
            >
              {c.text}
            </span>
          ))}
        </div>
      </div>
      <div className="govt-tile__arrow">
        {allowed ? <ArrowRight size={20} /> : <Lock size={18} />}
      </div>
    </button>
  )
}
