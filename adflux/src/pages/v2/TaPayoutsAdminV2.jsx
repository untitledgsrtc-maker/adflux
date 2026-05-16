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
  Settings2, ChevronDown,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/authStore'
import useAutoRefresh from '../../hooks/useAutoRefresh'
import V2Hero from '../../components/v2/V2Hero'
import { toastError, toastSuccess } from '../../components/v2/Toast'
import { RingMilestoneRow } from '../../components/v2/RingMilestone'

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
  // Phase 34Z.70 — IST month-start so a 1:00 AM UTC visit (which is
  // 6:30 AM IST same day) still resolves to the current Indian month
  // instead of the previous UTC day.
  // Phase 36.2 — owner reported (16 May 2026) that the month picker
  // showed April 2026 as the latest option on 16 May 2026. Root
  // cause: `new Date(y, m, 1)` constructs a LOCAL-TZ midnight, and
  // `.toISOString()` then shifts BACK by the UTC offset (IST = +5:30),
  // landing on the 30th of the previous month. Build the ISO date
  // string directly from UTC components — no round-trip through a
  // local-tz Date constructor.
  const ist = new Date(d.getTime() + (5.5 * 60 * 60 * 1000))
  const y = ist.getUTCFullYear()
  const m = String(ist.getUTCMonth() + 1).padStart(2, '0')
  return `${y}-${m}-01`
}

// Month label like "May 2026".
function monthLabel(iso) {
  if (!iso) return ''
  // Phase 36.2 — parse YYYY-MM-DD without going through Date's
  // TZ-aware parser. `new Date('2026-05-01')` is interpreted as
  // UTC midnight; on the client side (IST) that renders as
  // April 30 22:30 IST → toLocaleDateString → 'April 2026' (wrong
  // month). Read year + month from the string itself.
  const [yStr, mStr] = iso.split('-')
  const y = parseInt(yStr, 10)
  const m = parseInt(mStr, 10) - 1
  if (!Number.isFinite(y) || !Number.isFinite(m)) return iso
  // Use UTC midnight + explicit timeZone:'UTC' so locale formatter
  // doesn't shift the date back into the previous month.
  const d = new Date(Date.UTC(y, m, 1))
  return d.toLocaleDateString('en-IN', {
    month: 'long', year: 'numeric', timeZone: 'UTC',
  })
}

// Phase 34Z.70 — owner reported (15 May 2026) the month picker showed
// April first instead of the current month. Root cause: lastSixMonths
// used the browser's `new Date()` which on Vercel edge / mistuned
// devices can drift one month. Force the current IST month to be the
// first option, then walk back 5 months from there.
function lastSixMonths() {
  // Phase 36.2 — same fix as monthISO above. Build ISO strings
  // directly from year + month numbers; never round-trip through
  // `new Date(y, m, 1).toISOString()` because the local-TZ midnight
  // shifts to the previous month under any positive UTC offset
  // (IST = +5:30 → result lands on day 30/31 of prior month).
  const out = []
  const now = new Date()
  const ist = new Date(now.getTime() + (5.5 * 60 * 60 * 1000))
  let y = ist.getUTCFullYear()
  let m = ist.getUTCMonth() // 0..11
  for (let i = 0; i < 6; i++) {
    const mm = String(m + 1).padStart(2, '0')
    out.push(`${y}-${mm}-01`)
    m -= 1
    if (m < 0) { m = 11; y -= 1 }
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
  // Phase 33I (B9 fix) — city ceilings inline editor. Collapsed by
  // default; expands to show all 21 cities with editable daily_da,
  // bike_per_km, hotel_rate, radius_km. Admin can widen a radius
  // when reps report falling outside a city.
  const [ceilingsOpen, setCeilingsOpen] = useState(false)
  const [ceilings, setCeilings] = useState([])
  // Phase 33M — desktop-only polish: status filter + bulk approve.
  // 'all' shows everything, others scope the table down. Bulk approve
  // hits every visible pending row in one supabase update.
  const [statusFilter, setStatusFilter] = useState('all')
  const [bulkBusy, setBulkBusy] = useState(false)

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
  // Phase 34Z.70 — refetch on tab-resume so admin sees newly-pinged
  // rows the moment they switch back from another tab.
  // Phase 34Z.88 — dropped enabled gate. loadRows itself returns early
  // when fUser / fMonth missing (line 134), so unconditional mount
  // covers the case where admin clears filters then returns to tab.
  useAutoRefresh(loadRows)

  // Load city ceilings the first time the admin expands the editor.
  async function loadCeilings() {
    const { data, error } = await supabase.from('city_da_ceilings')
      .select('*')
      .order('display_order', { ascending: true })
    if (!error) setCeilings(data || [])
  }
  useEffect(() => { if (ceilingsOpen && ceilings.length === 0) loadCeilings() }, [ceilingsOpen]) // eslint-disable-line

  // Inline-save a single ceiling field. Saves on blur. Recomputes
  // nothing — admin can hit "Recompute month" after if they want the
  // change to flow into existing daily_ta rows.
  async function saveCeilingField(row, field, valueRaw) {
    const num = Math.max(0, Number(valueRaw))
    if (Number.isNaN(num) || num === Number(row[field])) return
    const { error } = await supabase.from('city_da_ceilings')
      .update({ [field]: num }).eq('id', row.id)
    if (error) { toastError(error, `Save failed: ${error.message}`); return }
    loadCeilings()
  }

  // Phase 33M — scope rows to status filter. Totals + bulk operations
  // act on the FILTERED set so admin can "approve all visible
  // pending" without affecting other statuses.
  const visibleRows = useMemo(() => {
    if (statusFilter === 'all') return rows
    return rows.filter(r => r.status === statusFilter)
  }, [rows, statusFilter])

  // Status counts for the filter chips — show counts so admin sees
  // at-a-glance how many rows are pending vs approved etc.
  const statusCounts = useMemo(() => {
    const out = { all: rows.length, pending: 0, approved: 0, paid: 0, rejected: 0 }
    rows.forEach(r => { out[r.status] = (out[r.status] || 0) + 1 })
    return out
  }, [rows])

  // Bulk approve every visible pending row. Confirmation required.
  async function bulkApprovePending() {
    const targets = visibleRows.filter(r => r.status === 'pending')
    if (targets.length === 0) {
      toastError(new Error('No pending rows'), 'No pending rows in the current filter.')
      return
    }
    if (!confirm(`Approve all ${targets.length} pending TA rows for this rep + month?`)) return
    setBulkBusy(true)
    const ids = targets.map(r => r.id)
    const { error } = await supabase.from('daily_ta').update({
      status: 'approved',
      approved_by: profile?.id,
      approved_at: new Date().toISOString(),
    }).in('id', ids)
    setBulkBusy(false)
    if (error) { toastError(error, 'Bulk approve failed: ' + error.message); return }
    toastSuccess('Pending rows approved.')
    loadRows()
  }

  // Aggregate footer.
  const totals = useMemo(() => {
    return visibleRows.reduce((acc, r) => {
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
    if (error) { toastError(error, 'Status update failed: ' + error.message); return }
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
    if (error) { toastError(error, 'Hotel save failed: ' + error.message); return }
    loadRows()
  }

  // CSV export — what finance opens in Excel.
  function exportCsv() {
    if (visibleRows.length === 0) return
    const repName = users.find(u => u.id === fUser)?.name || 'rep'
    const lines = [
      ['Date','Day','City','Category','KM','DA','Bike','Hotel','Total','Status','GPS pings','Notes'].join(','),
    ]
    visibleRows.forEach(r => {
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

  // Phase 34R+ — rep name + month label for the hero.
  const selectedRepName = useMemo(
    () => users.find(u => u.id === fUser)?.name || 'Select a rep',
    [users, fUser],
  )

  // Phase 34R+ — split totals by status so the ring milestones can
  // show approved / paid / pending share of the month at a glance.
  const statusSplit = useMemo(() => {
    const out = { approved: 0, paid: 0, pending: 0 }
    for (const r of rows) {
      const amt = Number(r.total || 0)
      if (r.status === 'paid')     out.paid     += amt
      else if (r.status === 'approved') out.approved += amt
      else                          out.pending  += amt
    }
    return out
  }, [rows])

  return (
    <div className="v2d-ta" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Phase 34R+ — V2Hero header. Replaces the bare page-head
          block. Eyebrow + selected rep + the month's grand total. */}
      <V2Hero
        eyebrow={`HR · Finance · ${monthLabel(fMonth)}`}
        value={selectedRepName}
        label={fUser ? `${rows.length} day${rows.length === 1 ? '' : 's'} · grand total ${fmtINR(totals.total)}` : 'pick a rep below'}
        chip={fUser && rows.length ? `${Math.round(totals.km)} km this month` : null}
        accent={false}
      />

      {/* Phase 34R+ — Approved / Paid / Pending split as ring
          milestones. Targets = grand total so each ring shows the
          share of this month that's in each status bucket. Skipped
          when no rep selected or no rows yet. */}
      {fUser && rows.length > 0 && (
        <RingMilestoneRow
          items={[
            { value: Math.round(statusSplit.approved), target: Math.max(1, Math.round(totals.total)), label: 'Approved', sub: fmtINR(statusSplit.approved) },
            { value: Math.round(statusSplit.paid),     target: Math.max(1, Math.round(totals.total)), label: 'Paid',     sub: fmtINR(statusSplit.paid) },
            { value: Math.round(statusSplit.pending),  target: Math.max(1, Math.round(totals.total)), label: 'Pending',  sub: fmtINR(statusSplit.pending) },
          ]}
        />
      )}

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

      {/* ─── City ceilings editor (collapsible) ───────── */}
      {/* Phase 33I (B9 fix) — admin can adjust DA, bike rate, hotel
          and radius per city without going to Supabase Studio. Useful
          when reps report falling outside a city's detection radius. */}
      <div className="v2d-panel" style={{ padding: 0, overflow: 'hidden' }}>
        <button
          type="button"
          onClick={() => setCeilingsOpen(v => !v)}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            width: '100%', padding: '12px 16px', background: 'transparent',
            border: 0, cursor: 'pointer', color: 'var(--v2-ink-0)',
          }}
        >
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600 }}>
            <Settings2 size={14} /> City ceilings · {ceilings.length || '21'} cities
          </span>
          <ChevronDown
            size={14}
            style={{
              transform: ceilingsOpen ? 'rotate(180deg)' : 'rotate(0)',
              transition: 'transform .15s',
              color: 'var(--v2-ink-2)',
            }}
          />
        </button>
        {ceilingsOpen && (
          <div style={{ borderTop: '1px solid var(--v2-line)', overflowX: 'auto' }}>
            <table className="v2d-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--v2-line)', color: 'var(--v2-ink-2)' }}>
                  <th style={thStyle}>City</th>
                  <th style={thStyle}>Cat</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Daily DA (₹)</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Bike (₹/km)</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Hotel (₹)</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Radius (km)</th>
                </tr>
              </thead>
              <tbody>
                {ceilings.map(c => (
                  <tr key={c.id} style={{ borderBottom: '1px solid var(--v2-line)' }}>
                    <td style={tdStyle}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <MapPin size={12} style={{ color: 'var(--v2-ink-2)' }} />
                        <span style={{ fontWeight: 600, color: 'var(--v2-ink-0)' }}>{c.city_name}</span>
                        {c.is_home && (
                          <span style={{
                            padding: '1px 7px', borderRadius: 999, fontSize: 9, fontWeight: 700,
                            background: 'var(--v2-tint-yellow, rgba(255,230,0,0.14))', color: 'var(--accent, #FFE600)',
                            textTransform: 'uppercase', letterSpacing: '.06em',
                          }}>HQ</span>
                        )}
                      </div>
                    </td>
                    <td style={tdStyle}>
                      <span style={catChipStyle(c.category)}>{c.category}</span>
                    </td>
                    {['daily_da','bike_per_km','hotel_rate','radius_km'].map(field => (
                      <td key={field} style={{ ...tdStyle, textAlign: 'right' }}>
                        <input
                          type="number"
                          step={field === 'radius_km' || field === 'bike_per_km' ? '0.1' : '1'}
                          defaultValue={c[field] || 0}
                          onBlur={e => saveCeilingField(c, field, e.target.value)}
                          style={{
                            width: 90, textAlign: 'right',
                            padding: '4px 8px', borderRadius: 6,
                            background: 'var(--v2-bg-2)',
                            border: '1px solid var(--v2-line)',
                            color: 'var(--v2-ink-0)', fontSize: 12,
                            fontFamily: 'monospace',
                          }}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ padding: '8px 14px', fontSize: 11, color: 'var(--v2-ink-2)', borderTop: '1px solid var(--v2-line)' }}>
              Changes save on blur. Hit <strong>Recompute month</strong> above for ceiling changes to flow into existing TA rows (only pending rows update — approved/paid are preserved).
            </div>
          </div>
        )}
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
            disabled={visibleRows.length === 0}
            className="v2d-cta"
            style={{ alignSelf: 'end', height: 38 }}
          >
            <Download size={14} /> Export CSV
          </button>
        </div>
        {err && (
          <div style={{
            marginTop: 10, padding: '8px 12px', borderRadius: 8,
            background: 'var(--v2-tint-danger, rgba(239,68,68,0.14))', color: 'var(--danger, #EF4444)',
            fontSize: 13, display: 'flex', alignItems: 'center', gap: 6,
          }}>
            <AlertTriangle size={14} /> {err}
          </div>
        )}
      </div>

      {/* ─── Status filter + bulk approve (Phase 33M) ──── */}
      <div style={{
        display: 'flex', flexWrap: 'wrap', alignItems: 'center',
        gap: 10, justifyContent: 'space-between',
      }}>
        <div style={{
          display: 'inline-flex', gap: 4, padding: 3,
          background: 'var(--v2-bg-2)', borderRadius: 999,
          border: '1px solid var(--v2-line)',
        }}>
          {[
            { key: 'all',      label: 'All' },
            { key: 'pending',  label: 'Pending' },
            { key: 'approved', label: 'Approved' },
            { key: 'paid',     label: 'Paid' },
            { key: 'rejected', label: 'Rejected' },
          ].map(o => (
            <button
              key={o.key}
              type="button"
              onClick={() => setStatusFilter(o.key)}
              style={{
                padding: '5px 12px', borderRadius: 999, border: 'none',
                cursor: 'pointer', fontSize: 12, fontWeight: 600,
                background: statusFilter === o.key ? 'var(--v2-ink-0)' : 'transparent',
                color:      statusFilter === o.key ? 'var(--v2-bg-0)' : 'var(--v2-ink-2)',
                display: 'inline-flex', alignItems: 'center', gap: 6,
              }}
            >
              {o.label}
              <span style={{
                padding: '1px 7px', borderRadius: 999, fontSize: 10, fontWeight: 700,
                background: statusFilter === o.key ? 'rgba(0,0,0,.18)' : 'rgba(255,255,255,.06)',
                color: 'inherit',
              }}>
                {statusCounts[o.key] || 0}
              </span>
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={bulkApprovePending}
          disabled={bulkBusy || statusCounts.pending === 0}
          className="v2d-cta"
          title="Approve every pending row in the current rep + month view"
        >
          <Check size={14} /> {bulkBusy ? 'Approving…' : `Approve all pending (${visibleRows.filter(r => r.status === 'pending').length})`}
        </button>
      </div>

      {/* ─── Totals strip ─────────────────────────────── */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12,
      }}>
        <TotalCard label="Days with TA" value={visibleRows.filter(r => Number(r.total_amount) > 0).length} kind="count" />
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
        ) : visibleRows.length === 0 ? (
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
                {visibleRows.map(r => (
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
    pending:  { bg: 'var(--v2-tint-warning, rgba(245,158,11,0.14))', fg: 'var(--warning, #F59E0B)' },
    approved: { bg: 'var(--v2-tint-blue,    rgba(59,130,246,0.14))', fg: 'var(--blue,    #3B82F6)' },
    paid:     { bg: 'var(--v2-tint-success, rgba(16,185,129,0.14))', fg: 'var(--success, #10B981)' },
    rejected: { bg: 'var(--v2-tint-danger,  rgba(239,68,68,0.14))',  fg: 'var(--danger,  #EF4444)' },
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
