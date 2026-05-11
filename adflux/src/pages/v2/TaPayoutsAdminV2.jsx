// src/pages/v2/TaPayoutsAdminV2.jsx
//
// Phase 33H (item D) — admin TA Payouts page.
//
// What it does:
//   • Pick a rep + month.
//   • Show per-day breakdown: date, primary city, km, DA, bike, hotel,
//     total, status. Admin can approve/reject/edit hotel inline.
//   • "Recompute month" button → calls backfill_ta() Edge RPC. Useful
//     after GPS issues are fixed or new pings come in late.
//   • CSV export — what finance opens in Excel for the month-end payout.
//   • Aggregate totals at the bottom.
//
// Sales / agency / telecaller can't reach this page (route is gated
// by <RequirePrivileged>). RLS on daily_ta also enforces this.
//
// v1 keeps the UI tight:
//   • One rep, one month at a time. Multi-rep dashboard can come later.
//   • Hotel is an inline editable number — admin manually adds hotel
//     claims after reviewing GPS trail (auto-hotel-detect is v2).
//   • CSV export is client-side (papaparse-free; we just build the
//     string and use a Blob download).

import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Wallet, RefreshCw, Download, Check, X, AlertTriangle, MapPin,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/authStore'

function fmtINR(n) {
  return '₹' + new Intl.NumberFormat('en-IN').format(Math.round(Number(n) || 0))
}

function fmtDateShort(iso) {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleDateString('en-IN', {
      day: '2-digit', month: 'short',
    })
  } catch { return iso }
}

function fmtDow(iso) {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleDateString('en-IN', { weekday: 'short' })
  } catch { return '' }
}

function monthISO(d = new Date()) {
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10)
}

// Month label like "May 2026".
function monthLabel(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })
}

// Build the list of last 6 months (newest first) for the picker.
function lastSixMonths() {
  const out = []
  const now = new Date()
  for (let i = 0; i < 6; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    out.push(d.toISOString().slice(0, 10))
  }
  return out
}

export default function TaPayoutsAdminV2() {
  const navigate = useNavigate()
  const profile = useAuthStore(s => s.profile)
  const isAdmin = ['admin', 'co_owner'].includes(profile?.role)

  useEffect(() => {
    if (profile && !isAdmin) navigate('/work')
  }, [profile, isAdmin, navigate])

  const [users, setUsers]       = useState([])
  const [rows, setRows]         = useState([])
  const [fUser, setFUser]       = useState('')
  const [fMonth, setFMonth]     = useState(monthISO())
  const [loading, setLoading]   = useState(false)
  const [recomputing, setRecomputing] = useState(false)
  const [err, setErr]           = useState('')

  // Load rep list once.
  useEffect(() => {
    if (!isAdmin) return
    ;(async () => {
      const { data } = await supabase.from('users')
        .select('id, name, role')
        .in('role', ['sales', 'agency', 'telecaller'])
        .order('name', { ascending: true })
      setUsers(data || [])
      // Auto-select first rep so the page isn't empty on first visit.
      if (data && data.length && !fUser) setFUser(data[0].id)
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin])

  // Load TA rows whenever rep or month changes.
  async function loadRows() {
    if (!fUser || !fMonth) { setRows([]); return }
    setLoading(true); setErr('')
    const monthEnd = (() => {
      const d = new Date(fMonth)
      d.setMonth(d.getMonth() + 1)
      d.setDate(0)
      return d.toISOString().slice(0, 10)
    })()
    const { data, error } = await supabase.from('daily_ta')
      .select('*')
      .eq('user_id', fUser)
      .gte('ta_date', fMonth)
      .lte('ta_date', monthEnd)
      .order('ta_date', { ascending: true })
    setLoading(false)
    if (error) { setErr(error.message); return }
    setRows(data || [])
  }
  useEffect(() => { loadRows() }, [fUser, fMonth]) // eslint-disable-line

  // Aggregate footer.
  const totals = useMemo(() => {
    return rows.reduce((acc, r) => {
      acc.km     += Number(r.km_traveled)  || 0
      acc.da     += Number(r.da_amount)    || 0
      acc.bike   += Number(r.bike_amount)  || 0
      acc.hotel  += Number(r.hotel_amount) || 0
      acc.total  += Number(r.total_amount) || 0
      if (r.status === 'approved') acc.approvedTotal += Number(r.total_amount) || 0
      if (r.status === 'paid')     acc.paidTotal     += Number(r.total_amount) || 0
      return acc
    }, { km: 0, da: 0, bike: 0, hotel: 0, total: 0, approvedTotal: 0, paidTotal: 0 })
  }, [rows])

  async function handleRecompute() {
    if (!fUser || !fMonth) return
    if (!confirm(`Recompute TA for the whole month for this rep? Approved/paid days are preserved.`)) return
    setRecomputing(true); setErr('')
    const { error } = await supabase.rpc('backfill_ta', {
      p_user_id: fUser, p_month_start: fMonth,
    })
    setRecomputing(false)
    if (error) { setErr(error.message); return }
    loadRows()
  }

  // Inline status flip — admin tags a row approved / rejected / paid.
  async function setStatus(row, nextStatus) {
    const patch = { status: nextStatus }
    if (nextStatus === 'approved') {
      patch.approved_by = profile?.id
      patch.approved_at = new Date().toISOString()
    }
    const { error } = await supabase.from('daily_ta')
      .update(patch).eq('id', row.id)
    if (error) { alert('Status update failed: ' + error.message); return }
    loadRows()
  }

  // Inline hotel edit. Saves on blur.
  async function setHotel(row, hotelValueRaw) {
    const hotelValue = Math.max(0, Math.round(Number(hotelValueRaw) || 0))
    if (hotelValue === Number(row.hotel_amount || 0)) return  // no change
    const newTotal = Number(row.da_amount || 0)
                   + Number(row.bike_amount || 0)
                   + hotelValue
    const { error } = await supabase.from('daily_ta')
      .update({ hotel_amount: hotelValue, total_amount: newTotal })
      .eq('id', row.id)
    if (error) { alert('Hotel save failed: ' + error.message); return }
    loadRows()
  }

  // CSV export — what finance opens in Excel.
  function exportCsv() {
    if (rows.length === 0) return
    const repName = users.find(u => u.id === fUser)?.name || 'rep'
    const lines = [
      ['Date','Day','City','Category','KM','DA','Bike','Hotel','Total','Status','GPS pings','Notes'].join(','),
    ]
    rows.forEach(r => {
      lines.push([
        r.ta_date,
        fmtDow(r.ta_date),
        `"${(r.primary_city || '—').replace(/"/g, '""')}"`,
        r.city_category || '',
        Number(r.km_traveled || 0).toFixed(2),
        Math.round(r.da_amount || 0),
        Math.round(r.bike_amount || 0),
        Math.round(r.hotel_amount || 0),
        Math.round(r.total_amount || 0),
        r.status,
        r.gps_pings_count || 0,
        `"${(r.notes || '').replace(/"/g, '""')}"`,
      ].join(','))
    })
    lines.push([
      'TOTAL','','','',
      totals.km.toFixed(2),
      Math.round(totals.da),
      Math.round(totals.bike),
      Math.round(totals.hotel),
      Math.round(totals.total),
      '','','',
    ].join(','))
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `TA_${repName.replace(/\s+/g, '_')}_${fMonth}.csv`
    document.body.appendChild(a); a.click(); a.remove()
    URL.revokeObjectURL(url)
  }

  if (!isAdmin) return null

  return (
    <div className="v2d-ta" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="v2d-page-head">
        <div>
          <div className="v2d-page-kicker">HR · Finance</div>
          <h1 className="v2d-page-title">TA Payouts</h1>
          <div className="v2d-page-sub">
            Travel allowance computed from each rep's GPS pings. Daily DA + bike
            (₹3/km) auto-calculated by city ceiling. Hotel is added by you per
            day when the rep stayed overnight. Approve before finance pays out.
          </div>
        </div>
      </div>

      {/* ─── Filters ──────────────────────────────────── */}
      <div className="v2d-panel" style={{ padding: 14 }}>
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
          gap: 10, alignItems: 'end',
        }}>
          <div>
            <label style={labelStyle}>Team member</label>
            <select value={fUser} onChange={e => setFUser(e.target.value)} style={inputStyle}>
              {users.map(u => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Month</label>
            <select value={fMonth} onChange={e => setFMonth(e.target.value)} style={inputStyle}>
              {lastSixMonths().map(m => (
                <option key={m} value={m}>{monthLabel(m)}</option>
              ))}
            </select>
          </div>
          <button
            type="button"
            onClick={handleRecompute}
            disabled={recomputing || !fUser}
            className="v2d-ghost"
            style={{ alignSelf: 'end', height: 38 }}
            title="Re-run compute_daily_ta for every day in this month. Approved/paid days are preserved."
          >
            <RefreshCw size={14} /> {recomputing ? 'Recomputing…' : 'Recompute month'}
          </button>
          <button
            type="button"
            onClick={exportCsv}
            disabled={rows.length === 0}
            className="v2d-cta"
            style={{ alignSelf: 'end', height: 38 }}
          >
            <Download size={14} /> Export CSV
          </button>
        </div>
        {err && (
          <div style={{
            marginTop: 10, padding: '8px 12px', borderRadius: 8,
            background: 'rgba(239,68,68,.08)', color: 'var(--v2-rose, #EF4444)',
            fontSize: 13, display: 'flex', alignItems: 'center', gap: 6,
          }}>
            <AlertTriangle size={14} /> {err}
          </div>
        )}
      </div>

      {/* ─── Totals strip ─────────────────────────────── */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12,
      }}>
        <TotalCard label="Days with TA" value={rows.filter(r => Number(r.total_amount) > 0).length} kind="count" />
        <TotalCard label="Total km"     value={totals.km.toFixed(1)} kind="raw" suffix=" km" />
        <TotalCard label="Total DA"     value={totals.da} />
        <TotalCard label="Total bike"   value={totals.bike} />
        <TotalCard label="Total hotel"  value={totals.hotel} />
        <TotalCard label="Grand total"  value={totals.total} accent />
      </div>

      {/* ─── Body ─────────────────────────────────────── */}
      <div className="v2d-panel" style={{ overflow: 'hidden', padding: 0 }}>
        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--v2-ink-2)' }}>
            Loading TA rows…
          </div>
        ) : rows.length === 0 ? (
          <div className="v2d-empty-card" style={{ padding: 40, textAlign: 'center' }}>
            <div className="v2d-empty-ic" style={{ marginBottom: 12 }}>
              <Wallet size={28} strokeWidth={1.6} />
            </div>
            <div className="v2d-empty-t">No TA computed yet</div>
            <div className="v2d-empty-s" style={{ marginBottom: 14 }}>
              Click <strong>Recompute month</strong> above to run the GPS aggregator
              for every day this month. Rows appear here for every day the rep had
              GPS pings inside one of the ceiling cities.
            </div>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="v2d-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--v2-line)', color: 'var(--v2-ink-2)' }}>
                  <th style={thStyle}>Date</th>
                  <th style={thStyle}>City</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>KM</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>DA</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Bike</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Hotel</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Total</th>
                  <th style={thStyle}>Status</th>
                  <th style={{ ...thStyle, width: 140, textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.id} style={{ borderBottom: '1px solid var(--v2-line)' }}>
                    <td style={tdStyle}>
                      <div style={{ fontWeight: 600, color: 'var(--v2-ink-0)' }}>{fmtDateShort(r.ta_date)}</div>
                      <div style={{ fontSize: 11, color: 'var(--v2-ink-2)' }}>{fmtDow(r.ta_date)}</div>
                    </td>
                    <td style={tdStyle}>
                      {r.primary_city ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <MapPin size={12} style={{ color: 'var(--v2-ink-2)' }} />
                          <span>{r.primary_city}</span>
                          {r.city_category && (
                            <span style={catChipStyle(r.city_category)}>{r.city_category}</span>
                          )}
                        </div>
                      ) : (
                        <span style={{ color: 'var(--v2-ink-2)' }}>—</span>
                      )}
                      <div style={{ fontSize: 11, color: 'var(--v2-ink-2)', marginTop: 2 }}>
                        {r.gps_pings_count || 0} GPS pings
                      </div>
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'right', fontFamily: 'monospace' }}>
                      {Number(r.km_traveled || 0).toFixed(1)}
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'right', fontFamily: 'monospace' }}>
                      {fmtINR(r.da_amount)}
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'right', fontFamily: 'monospace' }}>
                      {fmtINR(r.bike_amount)}
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>
                      {r.status === 'pending' ? (
                        <input
                          type="number"
                          defaultValue={r.hotel_amount || 0}
                          onBlur={e => setHotel(r, e.target.value)}
                          style={{
                            width: 80, textAlign: 'right',
                            padding: '4px 8px', borderRadius: 6,
                            background: 'var(--v2-bg-2)',
                            border: '1px solid var(--v2-line)',
                            color: 'var(--v2-ink-0)', fontSize: 12,
                            fontFamily: 'monospace',
                          }}
                        />
                      ) : (
                        <span style={{ fontFamily: 'monospace' }}>{fmtINR(r.hotel_amount)}</span>
                      )}
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'right', fontFamily: 'monospace', fontWeight: 600, color: 'var(--v2-ink-0)' }}>
                      {fmtINR(r.total_amount)}
                    </td>
                    <td style={tdStyle}>
                      <span style={statusChipStyle(r.status)}>{r.status}</span>
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>
                      <div style={{ display: 'inline-flex', gap: 4 }}>
                        {r.status === 'pending' && (
                          <>
                            <button
                              onClick={() => setStatus(r, 'approved')}
                              className="v2d-ghost"
                              title="Approve"
                            ><Check size={13} /></button>
                            <button
                              onClick={() => setStatus(r, 'rejected')}
                              className="v2d-ghost"
                              title="Reject"
                              style={{ color: 'var(--v2-rose)' }}
                            ><X size={13} /></button>
                          </>
                        )}
                        {r.status === 'approved' && (
                          <button
                            onClick={() => setStatus(r, 'paid')}
                            className="v2d-cta"
                            style={{ padding: '4px 10px', fontSize: 11 }}
                          >Mark paid</button>
                        )}
                        {(r.status === 'rejected' || r.status === 'paid') && (
                          <button
                            onClick={() => setStatus(r, 'pending')}
                            className="v2d-ghost"
                            title="Re-open"
                            style={{ fontSize: 11 }}
                          >Re-open</button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

function TotalCard({ label, value, kind, suffix, accent }) {
  const display = kind === 'count'
    ? (Number(value) || 0).toLocaleString('en-IN')
    : kind === 'raw'
      ? `${value}${suffix || ''}`
      : `₹${new Intl.NumberFormat('en-IN').format(Math.round(Number(value) || 0))}`
  return (
    <div className="v2d-panel" style={{ padding: '12px 16px' }}>
      <div style={{
        fontSize: 10, letterSpacing: '.14em', textTransform: 'uppercase',
        fontWeight: 700, color: 'var(--v2-ink-2)',
      }}>{label}</div>
      <div style={{
        fontFamily: 'var(--v2-display)', fontSize: 20, fontWeight: 700,
        color: accent ? 'var(--v2-yellow, #FFE600)' : 'var(--v2-ink-0)',
        marginTop: 4, lineHeight: 1.1,
      }}>{display}</div>
    </div>
  )
}

function statusChipStyle(status) {
  const map = {
    pending:  { bg: 'rgba(245,158,11,.12)',  fg: '#F59E0B' },
    approved: { bg: 'rgba(59,130,246,.12)',  fg: '#3B82F6' },
    paid:     { bg: 'rgba(16,185,129,.12)',  fg: '#10B981' },
    rejected: { bg: 'rgba(239,68,68,.12)',   fg: '#EF4444' },
  }
  const c = map[status] || map.pending
  return {
    display: 'inline-block', padding: '2px 10px', borderRadius: 999,
    background: c.bg, color: c.fg,
    fontSize: 10, fontWeight: 700, letterSpacing: '.08em',
    textTransform: 'uppercase',
  }
}

function catChipStyle(cat) {
  const map = { A: '#10B981', B: '#3B82F6', C: '#94A3B8' }
  const fg = map[cat] || '#94A3B8'
  return {
    display: 'inline-block', padding: '1px 7px', borderRadius: 999,
    fontSize: 9, fontWeight: 700, letterSpacing: '.06em',
    background: 'rgba(255,255,255,.06)', color: fg,
  }
}

const labelStyle = {
  display: 'block',
  fontSize: 11, fontWeight: 600,
  color: 'var(--v2-ink-2)',
  marginBottom: 4,
  textTransform: 'uppercase',
  letterSpacing: '.08em',
}
const inputStyle = {
  width: '100%',
  padding: '9px 12px',
  background: 'var(--v2-bg-2)',
  border: '1px solid var(--v2-line)',
  borderRadius: 8,
  color: 'var(--v2-ink-0)',
  fontSize: 13, outline: 'none',
  fontFamily: 'inherit', height: 38,
}
const thStyle = { padding: '10px 14px', fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap', textTransform: 'uppercase', letterSpacing: '.08em' }
const tdStyle = { padding: '12px 14px', fontSize: 13, color: 'var(--v2-ink-1)', verticalAlign: 'top' }
