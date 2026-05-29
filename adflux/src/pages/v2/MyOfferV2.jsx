// src/pages/v2/MyOfferV2.jsx
//
// v2 "My Offer Letter" page for sales users. Rendered inside
// V2AppShell — only paints the body.
//
// Data flow mirrors pages/MyOffer.jsx exactly (useOffers.fetchMyOffer,
// RLS policy hr_offers_sales_own returns at most a single row). The
// structured incentive block is computed the same way as the PDF so
// what the user sees here matches the offer letter they signed.

import { useEffect, useState } from 'react'
// eslint-disable-next-line no-unused-vars
import { Download, FileText, AlertCircle, CalendarOff } from 'lucide-react'
import { useOffers } from '../../hooks/useOffers'
import { useAuthStore } from '../../store/authStore'
import { formatCurrency } from '../../utils/formatters'
import TaDaRequestPanel from '../../components/incentives/TaDaRequestPanel'
import { RequestLeaveModal } from '../../components/leads/RepDayTools'
import RepLeaveHistory from '../../components/leads/RepLeaveHistory'
import ProfilePicUploader from '../../components/profile/ProfilePicUploader'
import { toastSuccess } from '../../components/v2/Toast'

export default function MyOfferV2() {
  const { fetchMyOffer } = useOffers()
  const profile = useAuthStore(s => s.profile)
  const [offer, setOffer] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  // Phase 34Z.71 — Request Leave panel, owner directive 16 May 2026.
  const [leaveOpen, setLeaveOpen] = useState(false)
  // Phase 36.11 — bump to force RepLeaveHistory remount after a
  // new request is submitted, so the rep sees the new row land.
  const [leaveRefresh, setLeaveRefresh] = useState(0)

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      const { data, error } = await fetchMyOffer()
      if (cancelled) return
      if (error) setError(error.message || 'Failed to load')
      setOffer(data || null)
      setLoading(false)
    }
    run()
    return () => { cancelled = true }
  }, [fetchMyOffer])

  // Phase 101.A2 — agency = commission-only partner. No salary slab,
  // no TA/DA, no leave panel. Renders AgencyOfferView (defined below
  // this file) with commission % from users.agency_commission_percent.
  // Branch sits AFTER hooks (rules-of-hooks) but BEFORE the loading /
  // error / empty / offer-loaded chain. Non-agency rendering below is
  // byte-identical to baseline per CLAUDE.md §28 sales-frozen contract.
  if (profile?.role === 'agency') {
    return <AgencyOfferView profile={profile} />
  }

  /* ─── Loading / error / empty states ─── */
  if (loading) {
    return (
      <div className="v2d-loading">
        <div className="v2d-spinner" />
        Loading offer letter…
      </div>
    )
  }

  if (error) {
    return (
      <div className="v2d-panel v2d-empty-card">
        <div className="v2d-empty-ic" style={{ color: 'var(--v2-rose)' }}>⚠</div>
        <div className="v2d-empty-t">Couldn't load your offer</div>
        <div className="v2d-empty-s">{error}</div>
      </div>
    )
  }

  // Phase 54 F5 — TC sees Other expense only (no TA/DA/Hotel per
  // Phase 52c). Page header copy was sales-rep framed ("Travel &
  // Daily Allowance" / "TA / DA claims") which was confusing for
  // office-based TC. Swap kicker + sub for telecaller role.
  const isTelecaller = profile?.role === 'telecaller'
  if (!offer) {
    return (
      <div className="v2d-offer">
        <div className="v2d-page-head">
          <div>
            <div className="v2d-page-kicker">
              {isTelecaller ? 'Expenses & Leave' : 'Travel & Daily Allowance'}
            </div>
            <h1 className="v2d-page-title">My Offer & Claims</h1>
            <div className="v2d-page-sub">
              {isTelecaller
                ? 'No offer letter on file. Submit expense claims below for the admin to approve.'
                : 'No offer letter on file. Submit TA / DA claims below for the admin to approve.'}
            </div>
          </div>
          {/* Phase 34Z.71 — request-leave entry point. */}
          {profile?.id && (
            <button className="v2d-cta" onClick={() => setLeaveOpen(true)}>
              <CalendarOff size={15} />
              <span>Request leave</span>
            </button>
          )}
        </div>
        {/* Phase 87.5 — rep profile picture uploader. Owner directive
            24 May 2026: rep can see own details + upload pic. */}
        {profile?.id && (
          <div style={{ marginBottom: 18 }}>
            <ProfilePicUploader />
          </div>
        )}
        {/* Phase 34Z.37 — no offer letter? The page used to be blank
            for admins / non-HR-onboarded reps. Now mounts the TA / DA
            claim panel so the URL still pays its way. */}
        <TaDaRequestPanel />
        {/* Phase 36.11 — leave-history panel below TA/DA claims so rep
            can see paid/unpaid + pending/approved status on every
            request. */}
        {profile?.id && (
          <RepLeaveHistory userId={profile.id} refreshKey={leaveRefresh} />
        )}
        {leaveOpen && (
          <RequestLeaveModal
            userId={profile.id}
            onClose={() => setLeaveOpen(false)}
            onSaved={() => {
              toastSuccess('Leave request submitted — admin will approve.')
              setLeaveRefresh(k => k + 1)
            }}
          />
        )}
      </div>
    )
  }

  /* ─── Offer loaded ─── */
  const hasStructured = Number(offer.incentive_sales_multiplier) > 0
  const acceptedDate = offer.accepted_terms_at
    ? new Date(offer.accepted_terms_at).toLocaleDateString('en-IN', {
        day: '2-digit', month: 'short', year: 'numeric',
      })
    : '—'
  // Phase 87.5b (2026-05-28) — surface HR sign-off status. Reads
  // profile.hr_accepted_at from authStore (column added in
  // supabase_phase87_5b_hr_acceptance.sql + auto-picked by the
  // existing users.select('*') in authStore.fetchProfile). Does NOT
  // block daily work — chip is informational only.
  const hrAcceptedDate = profile?.hr_accepted_at
    ? new Date(profile.hr_accepted_at).toLocaleDateString('en-IN', {
        day: '2-digit', month: 'short', year: 'numeric',
      })
    : null

  return (
    <div className="v2d-offer">
      {/* ─── Header ──────────────────────────────── */}
      <div className="v2d-page-head">
        <div>
          <div className="v2d-page-kicker">Joining paperwork</div>
          <h1 className="v2d-page-title">My Offer Letter</h1>
          <div className="v2d-page-sub">
            Accepted on {acceptedDate} · on file with HR
          </div>
          {/* Phase 87.5b — HR sign-off status chip. Informational
              only; does NOT gate any rep workflow. */}
          {hrAcceptedDate ? (
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              marginTop: 8,
              padding: '4px 10px',
              borderRadius: 999,
              fontSize: 11.5, fontWeight: 600,
              background: 'var(--success-soft, rgba(16,185,129,0.12))',
              color: 'var(--success, #10B981)',
              border: '1px solid var(--success, #10B981)',
            }}>
              Accepted by HR · {hrAcceptedDate}
            </span>
          ) : (
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              marginTop: 8,
              padding: '4px 10px',
              borderRadius: 999,
              fontSize: 11.5, fontWeight: 600,
              background: 'var(--warning-soft, rgba(245,158,11,0.12))',
              color: 'var(--warning, #F59E0B)',
              border: '1px solid var(--warning, #F59E0B)',
            }}>
              Pending HR acceptance
            </span>
          )}
        </div>
        <div style={{ display: 'inline-flex', gap: 8 }}>
          {/* Phase 34Z.71 — request leave from the offer page so reps
              don't have to dig into /work to file an off day. */}
          {profile?.id && (
            <button className="v2d-cta" onClick={() => setLeaveOpen(true)}>
              <CalendarOff size={15} />
              <span>Request leave</span>
            </button>
          )}
          {offer.offer_pdf_url && (
            <a
              className="v2d-cta"
              href={offer.offer_pdf_url}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Download size={15} />
              <span>Download PDF</span>
            </a>
          )}
        </div>
      </div>

      {/* Phase 87.5 — rep profile picture uploader sits between the
          page header and the offer hero card so the avatar shows
          near the rep's name/role for visual association. */}
      {profile?.id && (
        <div style={{ marginBottom: 18 }}>
          <ProfilePicUploader />
        </div>
      )}

      {/* ─── Hero summary card ──────────────────── */}
      <div className="v2d-panel v2d-offer-hero">
        <div className="v2d-offer-hero-l">
          <div className="v2d-offer-hero-ic">
            <FileText size={22} />
          </div>
          <div>
            <div className="v2d-offer-hero-role">
              {offer.position || 'Sales Person'}
            </div>
            <div className="v2d-offer-hero-sub">
              {offer.full_legal_name || offer.candidate_name || 'Candidate'}
              {offer.territory ? ` · ${offer.territory}` : ''}
            </div>
          </div>
        </div>
        <div className="v2d-offer-hero-r">
          <div className="v2d-offer-hero-k">Fixed Salary</div>
          <div className="v2d-offer-hero-v">
            {offer.fixed_salary_monthly
              ? formatCurrency(offer.fixed_salary_monthly)
              : '—'}
            <sub> / month</sub>
          </div>
        </div>
      </div>

      {/* ─── Detail grid ────────────────────────── */}
      <div className="v2d-grid-2" style={{ marginBottom: 22 }}>
        <div className="v2d-panel">
          <div className="v2d-panel-h">
            <div>
              <div className="v2d-panel-t">Appointment</div>
              <div className="v2d-panel-s">Basic joining details</div>
            </div>
          </div>
          <div className="v2d-kvgrid">
            <KV label="Candidate Name"
                value={offer.full_legal_name || offer.candidate_name} />
            <KV label="Position" value={offer.position} />
            <KV label="Territory" value={offer.territory} />
            <KV label="Joining Date" value={offer.joining_date} />
            <KV label="Place" value={offer.place} />
            <KV label="Fixed Salary"
                value={offer.fixed_salary_monthly
                  ? `${formatCurrency(offer.fixed_salary_monthly)} / month`
                  : null} />
          </div>
        </div>

        {hasStructured ? (
          <div className="v2d-panel v2d-panel--highlight">
            <div className="v2d-panel-h">
              <div>
                <div className="v2d-panel-t">Performance Incentive</div>
                <div className="v2d-panel-s">What the offer signed for</div>
              </div>
            </div>
            <div className="v2d-kvgrid">
              <KV
                label="Threshold"
                value={`${formatCurrency((offer.fixed_salary_monthly || 0) * 2)} / month`}
              />
              <KV
                label="Monthly Target"
                value={`${formatCurrency(
                  (offer.fixed_salary_monthly || 0)
                  * Number(offer.incentive_sales_multiplier)
                )} / month`}
              />
              <KV
                label="New Client Rate"
                value={`${(Number(offer.incentive_new_client_rate) * 100).toFixed(2)}%`}
              />
              <KV
                label="Renewal Rate"
                value={`${(Number(offer.incentive_renewal_rate) * 100).toFixed(2)}%`}
              />
              <KV
                label="Flat Bonus Above Target"
                value={Number(offer.incentive_flat_bonus) > 0
                  ? formatCurrency(Number(offer.incentive_flat_bonus))
                  : '—'}
              />
            </div>
          </div>
        ) : offer.incentive_text ? (
          <div className="v2d-panel">
            <div className="v2d-panel-h">
              <div>
                <div className="v2d-panel-t">Performance Incentive</div>
                <div className="v2d-panel-s">Legacy terms (free-text)</div>
              </div>
            </div>
            <div style={{
              fontSize: 13, color: 'var(--v2-ink-1)', lineHeight: 1.6,
              whiteSpace: 'pre-wrap',
            }}>
              {offer.incentive_text}
            </div>
          </div>
        ) : null}

        {/* Phase 34Z.37 — TA / DA claim panel always available below
            the offer letter. Rep sees today's auto-computed TA strip
            + can submit Override TA (km) or DA night claims for
            admin approval. */}
        <div style={{ marginTop: 18 }}>
          <div className="v2d-panel-t" style={{ marginBottom: 10 }}>Travel &amp; DA Claims</div>
          <TaDaRequestPanel />
        </div>
        {/* Phase 36.11 — leave history below claims (offer-loaded path). */}
        {profile?.id && (
          <div style={{ marginTop: 18 }}>
            <div className="v2d-panel-t" style={{ marginBottom: 10 }}>Leave History</div>
            <RepLeaveHistory userId={profile.id} refreshKey={leaveRefresh} />
          </div>
        )}
      </div>

      {leaveOpen && (
        <RequestLeaveModal
          userId={profile.id}
          onClose={() => setLeaveOpen(false)}
          onSaved={() => {
            toastSuccess('Leave request submitted — admin will approve.')
            setLeaveRefresh(k => k + 1)
          }}
        />
      )}
    </div>
  )
}

function KV({ label, value }) {
  return (
    <div className="v2d-kv">
      <div className="v2d-kv-l">{label}</div>
      <div className="v2d-kv-v">{value || '—'}</div>
    </div>
  )
}

// Phase 101.A2 — agency-only offer view. Reads users.agency_commission_percent
// from authStore.profile (Phase 101.A1 column auto-picked by the existing
// users.select('*') in authStore.fetchProfile). Inline component per
// CLAUDE.md §28 "smallest frozen-file diff" + matches local KV pattern.
// Phase 101.B.1 — ProfilePicUploader (Phase 87.5) added back. Was on
// MyOfferV2 baseline; the Phase 101.A2 agency branch bypassed it.
// Agency reps need to upload their avatar for topbar + map pin same
// as sales / TC reps.
function AgencyOfferView({ profile }) {
  const pct = profile?.agency_commission_percent != null
    ? Number(profile.agency_commission_percent)
    : 5.00
  return (
    <div className="v2d-offer">
      <div className="v2d-page-head">
        <div>
          <div className="v2d-page-kicker">Partner agreement</div>
          <h1 className="v2d-page-title">My Offer</h1>
          <div className="v2d-page-sub">
            Commission-only partner. No salary, no incentive slab,
            no TA / DA, no leave roster.
          </div>
        </div>
      </div>

      {/* Phase 101.B.1 — profile picture upload (Phase 87.5 component).
          Sits between page header and commission hero so the avatar
          shows near the rep's name for visual association — same
          position MyOfferV2 baseline uses. */}
      {profile?.id && (
        <div style={{ marginBottom: 18 }}>
          <ProfilePicUploader />
        </div>
      )}

      {/* Hero — single commission rate panel reuses v2d-offer-hero shell */}
      <div className="v2d-panel v2d-offer-hero">
        <div className="v2d-offer-hero-l">
          <div className="v2d-offer-hero-ic">
            <FileText size={22} />
          </div>
          <div>
            <div className="v2d-offer-hero-role">
              Agency Partner
            </div>
            <div className="v2d-offer-hero-sub">
              {profile?.name || ''}{profile?.city ? ` · ${profile.city}` : ''}
            </div>
          </div>
        </div>
        <div className="v2d-offer-hero-r">
          <div className="v2d-offer-hero-k">Commission rate</div>
          <div className="v2d-offer-hero-v">
            {pct.toFixed(2)}<sub>%</sub>
          </div>
        </div>
      </div>

      {/* How it's paid — single info panel; no incentive slab, no TA/DA */}
      <div className="v2d-panel" style={{ marginTop: 18 }}>
        <div className="v2d-panel-h">
          <div>
            <div className="v2d-panel-t">How commission is paid</div>
            <div className="v2d-panel-s">Per Won quote, settled by accounts</div>
          </div>
        </div>
        <div className="v2d-kvgrid">
          <KV
            label="Commission base"
            value="Quote subtotal (GST-excluded)"
          />
          <KV
            label="Formula"
            value={`base × ${pct.toFixed(2)}%`}
          />
          <KV
            label="Earned"
            value="When quote moves to Won"
          />
          <KV
            label="Payable"
            value="After first approved payment is received"
          />
          <KV
            label="Treatment"
            value="Accounting expense — paid by Untitled Advertising"
          />
        </div>
      </div>

      <div style={{
        marginTop: 18, fontSize: 12, color: 'var(--v2-ink-2)',
        lineHeight: 1.6,
      }}>
        See your commission ledger on <b>My Earnings</b>: Won quotes,
        base amount, status, and last payment date.
      </div>
    </div>
  )
}
