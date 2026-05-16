// src/components/incentives/TaDaRequestPanel.jsx
//
// Phase 34Z.37 — rep-side TA / DA claim panel.
//
// Owner directive (15 May 2026):
//   "Both — one form, two tabs (Manual TA km override / Manual DA
//    night claim). It show him daily."
//
// Layout:
//   • Today strip — shows the auto-computed TA for today (read from
//     daily_ta if present; falls back to ₹0 with a hint). Always
//     visible so the rep knows what the system thinks they earned.
//   • Tabs — Override TA / Claim DA.
//   • Form — date + claim_km / claim_amount + city + reason +
//     optional receipt upload (lead-photos bucket).
//   • History — past requests (status chip pending/approved/rejected).
//
// Reads / writes:
//   • SELECT daily_ta where user_id=me AND work_date=today
//   • INSERT ta_da_requests with status='pending'
//   • SELECT ta_da_requests where user_id=me  ORDER BY created_at DESC

import { useEffect, useState } from 'react'
import { Loader2, MapPin, FileText, Upload, CheckCircle2, X } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/authStore'
import { toastError, toastSuccess } from '../v2/Toast'
import { formatCurrency, formatDate } from '../../utils/formatters'
import { summariseTrack } from '../../utils/gpsDistance'
import CityAutocomplete from '../leads/CityAutocomplete'

const TODAY = () => new Date().toISOString().slice(0, 10)

export default function TaDaRequestPanel() {
  const profile = useAuthStore(s => s.profile)
  const [todayRow, setTodayRow] = useState(null)
  // Phase 34Z.39 — live GPS summary of today's track (works even
  // before nightly daily_ta rollup; owner: "fetched by GPS box should
  // be there"). Driven by the same summariseTrack util the /work map
  // panel uses so numbers match.
  const [liveTrack, setLiveTrack] = useState(null)
  const [requests, setRequests] = useState([])
  const [loading, setLoading]   = useState(true)
  // Phase 36.7 — owner directive: rep needs to claim hotel stays and
  // generic "other" expenses too. Tabs extended to 4 kinds.
  //   'ta'    → ta_override (km)
  //   'da'    → da_night    (₹)
  //   'hotel' → hotel       (₹ + city)
  //   'other' → other       (₹ + description)
  const [tab, setTab]           = useState('ta')   // 'ta' | 'da' | 'hotel' | 'other'

  // Form state
  const [claimDate,   setClaimDate]   = useState(TODAY())
  const [claimKm,     setClaimKm]     = useState('')
  const [claimAmount, setClaimAmount] = useState('')
  const [city,        setCity]        = useState(profile?.city || '')
  const [reason,      setReason]      = useState('')
  const [saving,      setSaving]      = useState(false)
  // Phase 36.9 — hard cap on DA night + Hotel based on city ceilings.
  // Owner: "we have already TA / DA / Hotel fixed pricing in master,
  // how can he claim more than that?" Fetch the ceiling for the
  // currently-selected city; if amount > ceiling, block submit and
  // surface the cap inline. TA km + Other carry no cap (km is what
  // GPS says; Other is intentionally free-form).
  const [cityCeiling, setCityCeiling] = useState(null) // { daily_da, hotel_rate } | null

  useEffect(() => {
    if (!city || city.trim().length < 2) { setCityCeiling(null); return }
    let cancelled = false
    // Phase 36.9.1 — case-insensitive lookup. Owner typed "BHAVNAGAR"
    // (uppercase autocomplete output); master row stored as
    // "Bhavnagar". `.eq` failed → ceiling null → "Pick a city first"
    // false-alarm toast. Use ilike for an exact-but-case-insensitive
    // match, and order by best-match length=1 row.
    supabase.from('city_da_ceilings')
      .select('city_name, daily_da, hotel_rate')
      .ilike('city_name', city.trim())
      .limit(1)
      .then(({ data }) => {
        if (cancelled) return
        setCityCeiling(data && data.length > 0 ? data[0] : null)
      })
    return () => { cancelled = true }
  }, [city])

  async function reload() {
    if (!profile?.id) return
    setLoading(true)
    // Phase 34Z.39 — also fetch today's gps_pings so we can compute
    // the LIVE km right now (daily_ta only rolls up nightly, so
    // mid-day reps would otherwise see "no GPS yet" even though the
    // app pinged them all morning).
    const today = new Date()
    today.setHours(0,0,0,0)
    const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1)
    const [{ data: dt }, { data: reqs }, { data: pings }] = await Promise.all([
      supabase.from('daily_ta')
        .select('km_traveled, bike_amount, da_amount, hotel_amount, total_amount')
        .eq('user_id', profile.id)
        .eq('ta_date', TODAY())
        .maybeSingle(),
      supabase.from('ta_da_requests')
        .select('id, claim_date, kind, claim_km, claim_amount, city, reason, status, admin_note, created_at, decided_at')
        .eq('user_id', profile.id)
        .order('created_at', { ascending: false })
        .limit(20),
      supabase.from('gps_pings')
        .select('lat, lng, captured_at, accuracy_m')
        .eq('user_id', profile.id)
        .gte('captured_at', today.toISOString())
        .lt('captured_at', tomorrow.toISOString())
        .order('captured_at', { ascending: true }),
    ])
    const summary = summariseTrack(pings || [])
    setTodayRow(dt || null)
    setLiveTrack(summary)
    setRequests(reqs || [])
    // Pre-fill the override field with the live km so the rep doesn't
    // have to retype. Override is opt-in: leave as-is = confirm GPS.
    // Owner: "If person not override it should be counted as GPS tracked."
    if (Number(summary?.km || 0) > 0) {
      setClaimKm(String(summary.km))
    }
    setLoading(false)
  }
  useEffect(() => { reload() /* eslint-disable-next-line */ }, [profile?.id])

  async function handleSubmit() {
    if (saving) return
    if (!reason.trim()) {
      toastError(new Error('Reason is required.'), 'Add a short reason so admin understands the claim.')
      return
    }
    if (tab === 'ta' && (!claimKm || Number(claimKm) <= 0)) {
      toastError(new Error('Enter km claimed.'), 'Add the kilometres for this TA override.')
      return
    }
    if ((tab === 'da' || tab === 'hotel' || tab === 'other')
        && (!claimAmount || Number(claimAmount) <= 0)) {
      toastError(new Error('Enter the amount claimed (₹).'),
        `Add the rupee amount for the ${tab} claim.`)
      return
    }
    // Phase 36.9 — hard cap. DA night capped at city.daily_da; Hotel
    // capped at city.hotel_rate. Both need a city selected. ta + other
    // pass through unchecked.
    if (tab === 'da' || tab === 'hotel') {
      if (!city || city.trim().length < 2) {
        toastError(new Error('Pick a city first.'),
          'DA / hotel cap depends on the city — type the city to look up the ceiling.')
        return
      }
      if (!cityCeiling) {
        // Phase 36.9.1 — city typed but no ceiling row matched. Tell
        // rep to verify the city spelling rather than the misleading
        // "Pick a city first." message.
        toastError(new Error('City not in master.'),
          `"${city}" is not in the city ceilings master. Pick the city from the suggestions or ask admin to add it.`)
        return
      }
      const cap = tab === 'da'
        ? Number(cityCeiling.daily_da)
        : Number(cityCeiling.hotel_rate)
      if (Number(claimAmount) > cap) {
        toastError(new Error('Above ceiling.'),
          `${tab === 'da' ? 'DA night' : 'Hotel'} cap in ${cityCeiling.city_name || city} is ₹${cap}. ` +
          `You can claim up to ₹${cap} only. Contact admin offline for higher amounts.`)
        return
      }
    }
    setSaving(true)
    // Phase 36.7 — map tab → kind. ta_override carries km; the other
    // three carry claim_amount.
    const kindByTab = {
      ta:    'ta_override',
      da:    'da_night',
      hotel: 'hotel',
      other: 'other',
    }
    const payload = {
      user_id:      profile.id,
      claim_date:   claimDate,
      kind:         kindByTab[tab],
      claim_km:     tab === 'ta' ? Number(claimKm) : null,
      claim_amount: tab === 'ta' ? null : Number(claimAmount),
      city:         city.trim() || null,
      reason:       reason.trim(),
    }
    const { error } = await supabase.from('ta_da_requests').insert([payload])
    setSaving(false)
    if (error) {
      toastError(error, 'Could not submit claim: ' + error.message)
      return
    }
    toastSuccess('Claim submitted. Admin will review.')
    setClaimKm(''); setClaimAmount(''); setReason('')
    reload()
  }

  const styles = {
    card: {
      background: 'var(--v2-bg-1, var(--surface))',
      border: '1px solid var(--v2-line, var(--border))',
      borderRadius: 12,
      padding: 16,
      marginBottom: 14,
    },
    tabRow: { display: 'flex', gap: 6, marginBottom: 12 },
    tab: (on) => ({
      flex: 1,
      padding: '8px 12px',
      borderRadius: 999,
      border: '1px solid var(--border)',
      background: on ? 'var(--accent, #FFE600)' : 'var(--surface-2)',
      color:      on ? 'var(--accent-fg, #0f172a)' : 'var(--text)',
      cursor: 'pointer', fontSize: 13, fontWeight: 600,
      fontFamily: 'inherit',
    }),
    grid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 },
    label: { fontSize: 11, color: 'var(--text-muted)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '.08em', fontWeight: 700 },
    historyRow: {
      display: 'grid',
      gridTemplateColumns: '90px 80px 1fr 90px',
      gap: 8,
      padding: '8px 0',
      borderBottom: '1px solid var(--border)',
      fontSize: 12,
      alignItems: 'center',
    },
    chip: (status) => ({
      display: 'inline-block', padding: '2px 8px', borderRadius: 999,
      fontSize: 10, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase',
      background:
        status === 'approved' ? 'rgba(16,185,129,.18)'
        : status === 'rejected' ? 'rgba(239,68,68,.18)'
        :                          'rgba(245,158,11,.18)',
      color:
        status === 'approved' ? 'var(--success, #10B981)'
        : status === 'rejected' ? 'var(--danger, #EF4444)'
        :                          'var(--warning, #F59E0B)',
    }),
  }

  return (
    <div>
      {/* ── Today GPS / auto-TA strip ──
          Phase 34Z.39 — always render the box. Prefer the nightly
          daily_ta row when it's available (most accurate, factors in
          city bike_per_km). Fall back to live gps_pings summarised
          via summariseTrack so the rep sees today's km mid-day too.
          Owner: "FETCHED BY GPS BOX SHOULD BE THERE." */}
      <div style={styles.card}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <MapPin size={14} style={{ color: 'var(--accent)' }} />
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.12em' }}>
            Today · fetched by GPS
          </div>
        </div>
        {loading ? (
          <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>
            <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> Loading…
          </div>
        ) : (() => {
          // Prefer nightly daily_ta total when available; else live ping math.
          const usingNightly = !!todayRow
          const km = usingNightly
            ? Number(todayRow.km_traveled || 0)
            : Number(liveTrack?.km || 0)
          const bikeTa = usingNightly
            ? Number(todayRow.bike_amount || 0)
            : Math.round(km * 3)          // ₹3/km fallback rate
          const dayTotal = usingNightly
            ? Number(todayRow.total_amount || 0)
            : bikeTa
          return (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
                <Stat label="Distance" value={`${km.toFixed(1)} km`} />
                <Stat label="Bike TA"  value={formatCurrency(bikeTa)} />
                <Stat label="Day Total" value={formatCurrency(dayTotal)} highlight />
              </div>
              <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text-muted)' }}>
                {usingNightly
                  ? 'Approved last night — admin can adjust in TA Payouts.'
                  : km > 0
                    ? 'Live track from today\'s GPS pings — finalised tonight.'
                    : 'No GPS yet today. Keep the app open while driving, or submit an override below.'}
              </div>
            </>
          )
        })()}
      </div>

      {/* ── Tabs + form ── */}
      <div style={styles.card}>
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', marginBottom: 10 }}>
          Submit a claim
        </div>
        {/* Phase 36.7 — 4-way tab row. Wrap on narrow screens so
            phones don't get a horizontal-scroll bar. */}
        <div style={{ ...styles.tabRow, flexWrap: 'wrap' }}>
          <button type="button" style={styles.tab(tab === 'ta')} onClick={() => setTab('ta')}>
            Override TA (km)
          </button>
          <button type="button" style={styles.tab(tab === 'da')} onClick={() => setTab('da')}>
            Claim DA (night)
          </button>
          <button type="button" style={styles.tab(tab === 'hotel')} onClick={() => setTab('hotel')}>
            Hotel stay
          </button>
          <button type="button" style={styles.tab(tab === 'other')} onClick={() => setTab('other')}>
            Other
          </button>
        </div>

        {/* Phase 34Z.39 — Date + km/₹ + City share one 3-column row on
            wide screens; on phones they wrap. City is now a typeahead
            bound to the cities master (same as /leads/new) so reps
            don't free-type Anand / Anad / Adam. Reason still full-width
            below. */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
          gap: 10,
        }}>
          <div>
            <div style={styles.label}>Date</div>
            <input type="date" className="lead-inp"
              value={claimDate} onChange={(e) => setClaimDate(e.target.value)} />
          </div>
          {tab === 'ta' ? (
            <div>
              <div style={styles.label}>Claimed km</div>
              <input className="lead-inp" inputMode="decimal"
                value={claimKm} onChange={(e) => setClaimKm(e.target.value)}
                placeholder={liveTrack?.km > 0 ? `GPS: ${liveTrack.km} km` : 'e.g. 42.5'} />
            </div>
          ) : (
            <div>
              <div style={styles.label}>Amount (₹)</div>
              {(() => {
                // Phase 36.9 — show cap reference + red border when over.
                const showCap = (tab === 'da' || tab === 'hotel') && cityCeiling
                const cap = !showCap ? null
                  : tab === 'da' ? Number(cityCeiling.daily_da)
                                 : Number(cityCeiling.hotel_rate)
                const overCap = cap != null && Number(claimAmount || 0) > cap
                return (
                  <>
                    <input
                      className="lead-inp"
                      inputMode="decimal"
                      value={claimAmount}
                      onChange={(e) => setClaimAmount(e.target.value)}
                      style={overCap ? {
                        borderColor: 'var(--danger, #EF4444)',
                        boxShadow: '0 0 0 2px rgba(239,68,68,.18)',
                      } : undefined}
                      placeholder={
                        tab === 'da'    ? `e.g. ${cap || 200}` :
                        tab === 'hotel' ? `e.g. ${cap || 700} — room rate` :
                                          'e.g. 350 — parking / toll / misc'
                      } />
                    {showCap && (
                      <div style={{
                        marginTop: 4, fontSize: 11,
                        color: overCap ? 'var(--danger, #EF4444)' : 'var(--text-muted)',
                      }}>
                        {overCap
                          ? `Above ceiling. ${tab === 'da' ? 'DA' : 'Hotel'} cap in ${city} = ₹${cap}.`
                          : `Cap in ${city}: ₹${cap}. Submit blocked if higher.`}
                      </div>
                    )}
                  </>
                )
              })()}
            </div>
          )}
          <div>
            <div style={styles.label}>City</div>
            <CityAutocomplete
              value={city}
              onChange={setCity}
              placeholder="Type to search"
            />
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <div style={styles.label}>
              {tab === 'other' ? 'Description *' : 'Reason *'}
            </div>
            <textarea className="lead-inp" rows={2}
              value={reason} onChange={(e) => setReason(e.target.value)}
              placeholder={
                tab === 'ta'
                  ? 'Why override? e.g. "phone died near Anand depot — drove back manually". Leave blank to confirm GPS km.'
                : tab === 'da'
                  ? 'Why was the overnight needed? e.g. "client meeting next morning, hotel near depot"'
                : tab === 'hotel'
                  ? 'Hotel name + reason. e.g. "Hotel Surya Surat — Reliance pitch next morning"'
                  : 'Describe the expense in detail. e.g. "Parking ₹150 + toll ₹200 — Vadodara→Surat trip"'
              } />
          </div>
        </div>
        {tab === 'ta' && Number(liveTrack?.km || 0) > 0 && (
          <div style={{
            marginTop: 8,
            padding: '6px 10px',
            background: 'var(--accent-soft, rgba(255,230,0,0.14))',
            border: '1px dashed var(--v2-yellow, var(--accent, #FFE600))',
            borderRadius: 10,
            fontSize: 11, color: 'var(--text-muted)',
          }}>
            <b style={{ color: 'var(--accent)' }}>Pre-filled from GPS:</b> {liveTrack.km} km today.
            Edit only if the GPS missed a trip — otherwise submit to confirm.
          </div>
        )}
        <button
          type="button"
          className="lead-btn lead-btn-primary"
          style={{ marginTop: 12, width: '100%' }}
          onClick={handleSubmit}
          disabled={saving}
        >
          {saving
            ? <><Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> Submitting…</>
            : <><CheckCircle2 size={12} /> Submit for admin approval</>}
        </button>
      </div>

      {/* ── History ── */}
      <div style={styles.card}>
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', marginBottom: 10 }}>
          Your past claims
        </div>
        {requests.length === 0 ? (
          <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>
            No claims yet.
          </div>
        ) : (
          <>
            <div style={{ ...styles.historyRow, fontWeight: 700, color: 'var(--text-muted)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '.08em' }}>
              <span>Date</span>
              <span>Kind</span>
              <span>Detail</span>
              <span style={{ textAlign: 'right' }}>Status</span>
            </div>
            {requests.map((r) => (
              <div key={r.id} style={styles.historyRow}>
                <span>{r.claim_date}</span>
                <span>
                  {r.kind === 'ta_override' ? 'TA km' :
                   r.kind === 'da_night'    ? 'DA night' :
                   r.kind === 'hotel'       ? 'Hotel' :
                   r.kind === 'other'       ? 'Other' :
                   r.kind}
                </span>
                <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {r.kind === 'ta_override'
                    ? `${r.claim_km} km${r.city ? ` · ${r.city}` : ''}`
                    : `${formatCurrency(r.claim_amount)}${r.city ? ` · ${r.city}` : ''}`}
                  {r.admin_note && (
                    <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}> — {r.admin_note}</span>
                  )}
                </span>
                <span style={{ textAlign: 'right' }}>
                  <span style={styles.chip(r.status)}>{r.status}</span>
                </span>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  )
}

function Stat({ label, value, highlight }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: 'var(--text-muted)', letterSpacing: '.08em', textTransform: 'uppercase', fontWeight: 700 }}>
        {label}
      </div>
      <div style={{
        fontSize: 16, fontWeight: 700,
        color: highlight ? 'var(--accent, #FFE600)' : 'var(--text)',
        fontFamily: 'var(--v2-display, "Space Grotesk", system-ui, sans-serif)',
        marginTop: 2,
      }}>
        {value}
      </div>
    </div>
  )
}
