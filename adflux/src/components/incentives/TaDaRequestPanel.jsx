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

const TODAY = () => new Date().toISOString().slice(0, 10)

export default function TaDaRequestPanel() {
  const profile = useAuthStore(s => s.profile)
  const [todayRow, setTodayRow] = useState(null)
  const [requests, setRequests] = useState([])
  const [loading, setLoading]   = useState(true)
  const [tab, setTab]           = useState('ta')   // 'ta' | 'da'

  // Form state
  const [claimDate,   setClaimDate]   = useState(TODAY())
  const [claimKm,     setClaimKm]     = useState('')
  const [claimAmount, setClaimAmount] = useState('')
  const [city,        setCity]        = useState(profile?.city || '')
  const [reason,      setReason]      = useState('')
  const [saving,      setSaving]      = useState(false)

  async function reload() {
    if (!profile?.id) return
    setLoading(true)
    const [{ data: dt }, { data: reqs }] = await Promise.all([
      supabase.from('daily_ta')
        .select('total_km, bike_amount, daily_da_amount, hotel_amount, total_amount')
        .eq('user_id', profile.id)
        .eq('work_date', TODAY())
        .maybeSingle(),
      supabase.from('ta_da_requests')
        .select('id, claim_date, kind, claim_km, claim_amount, city, reason, status, admin_note, created_at, decided_at')
        .eq('user_id', profile.id)
        .order('created_at', { ascending: false })
        .limit(20),
    ])
    setTodayRow(dt || null)
    setRequests(reqs || [])
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
    if (tab === 'da' && (!claimAmount || Number(claimAmount) <= 0)) {
      toastError(new Error('Enter the DA amount claimed (₹).'), 'Add the rupee amount for the night claim.')
      return
    }
    setSaving(true)
    const payload = {
      user_id:      profile.id,
      claim_date:   claimDate,
      kind:         tab === 'ta' ? 'ta_override' : 'da_night',
      claim_km:     tab === 'ta' ? Number(claimKm) : null,
      claim_amount: tab === 'da' ? Number(claimAmount) : null,
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
      background: 'var(--surface)',
      border: '1px solid var(--border)',
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
      {/* ── Today auto-TA strip ── */}
      <div style={styles.card}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <MapPin size={14} style={{ color: 'var(--accent)' }} />
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.12em' }}>
            Today · auto-computed TA
          </div>
        </div>
        {loading ? (
          <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>
            <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> Loading…
          </div>
        ) : todayRow ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
            <Stat label="Distance"    value={`${Number(todayRow.total_km || 0).toFixed(1)} km`} />
            <Stat label="Bike TA"     value={formatCurrency(todayRow.bike_amount || 0)} />
            <Stat label="Day Total"   value={formatCurrency(todayRow.total_amount || 0)} highlight />
          </div>
        ) : (
          <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>
            No GPS distance logged for today yet — keep the app open during driving,
            or use the override below if GPS missed a trip.
          </div>
        )}
      </div>

      {/* ── Tabs + form ── */}
      <div style={styles.card}>
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', marginBottom: 10 }}>
          Submit a claim
        </div>
        <div style={styles.tabRow}>
          <button type="button" style={styles.tab(tab === 'ta')} onClick={() => setTab('ta')}>
            Override TA (km)
          </button>
          <button type="button" style={styles.tab(tab === 'da')} onClick={() => setTab('da')}>
            Claim DA (night)
          </button>
        </div>

        <div style={styles.grid}>
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
                placeholder="e.g. 42.5" />
            </div>
          ) : (
            <div>
              <div style={styles.label}>Amount (₹)</div>
              <input className="lead-inp" inputMode="decimal"
                value={claimAmount} onChange={(e) => setClaimAmount(e.target.value)}
                placeholder="e.g. 700" />
            </div>
          )}
          <div style={{ gridColumn: '1 / -1' }}>
            <div style={styles.label}>City</div>
            <input className="lead-inp"
              value={city} onChange={(e) => setCity(e.target.value)}
              placeholder="e.g. Anand" />
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <div style={styles.label}>Reason *</div>
            <textarea className="lead-inp" rows={2}
              value={reason} onChange={(e) => setReason(e.target.value)}
              placeholder={tab === 'ta'
                ? 'Why is GPS distance wrong? e.g. "phone died near Anand depot — drove back manually"'
                : 'Why was the overnight needed? e.g. "client meeting next morning, hotel near depot"'} />
          </div>
        </div>
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
                <span>{r.kind === 'ta_override' ? 'TA km' : 'DA night'}</span>
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
        fontFamily: 'var(--font-mono, "JetBrains Mono", monospace)',
        marginTop: 2,
      }}>
        {value}
      </div>
    </div>
  )
}
