// src/components/incentives/SalarySlipsCard.jsx
//
// Phase 185 — "Salary slips" on My Performance. A rep downloads their OWN slip
// for the current + last 3 months, plus any fully-paid month (owner 2026-08-31
// REVERSED the 2026-07-02 "download only after full payment" gate). An unpaid
// month still downloads — the PDF payment row shows blank/"Pending".
//
// Self-fetching + read-only + RLS-safe: it reads the rep's own salary_payouts
// (Phase 37 rep-SELECT-own) and, on download, calls compute_monthly_salary for
// their OWN id (self-or-admin gated). A rep can never see another rep's slip.
// Additive card — shown for every non-agency rep (agency is commission-only).

import { useState, useEffect, useSyncExternalStore } from 'react'
import { FileText, Download, Loader2, AlertTriangle } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/authStore'
import { buildSalarySlipBlob } from './SalarySlipPDF'
import { savePdfBlob } from '../../utils/savePdf'
import { istTodayISO } from '../../utils/istDate'

const MON = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December']

// The current IST month + (n-1) prior months as 'YYYY-MM', newest first. Lets a
// rep pull a slip BEFORE the accountant records payment (owner 2026-08-31).
function recentMonths(n) {
  const [y, m] = istTodayISO().slice(0, 7).split('-').map(Number)
  const out = []
  for (let i = 0; i < n; i++) {
    const d = new Date(y, m - 1 - i, 1)
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }
  return out
}

// '2026-06' -> { label:'June 2026', year:2026, month:6 }
function parseMonth(ym) {
  const [y, m] = String(ym || '').split('-')
  const yi = Number(y)
  const mi = Number(m)
  return { label: `${MON[mi - 1] || ''} ${yi}`, year: yi, month: mi }
}

function inr(n) {
  return 'Rs. ' + Number(n || 0).toLocaleString('en-IN')
}

// Phase 359 — slip build/share state lives at MODULE level, not in the
// component. MyPerformanceV2 re-keys this card on every auto-refresh, so a
// component-local `ready` / `busyMonth` would be wiped mid-build (focus, poll or
// a team realtime event) and the built slip + its "Tap to open" button lost.
// Keyed by uid so one user's built slip is never offered to the next login.
//   busyMonth : month_year being built/saved
//   ready     : { month_year, blob, fileName, title } — built, waiting for a FRESH
//               tap (iPhone refuses the share sheet once the tap is too old)
//   slipErr   : last save failure text (shown on the card)
let slipSnap = { uid: null, busyMonth: null, ready: null, slipErr: null }
const slipListeners = new Set()
function setSlip(patch) {
  slipSnap = { ...slipSnap, ...patch }
  slipListeners.forEach((l) => l())
}
function subscribeSlip(cb) {
  slipListeners.add(cb)
  return () => slipListeners.delete(cb)
}
function getSlip() { return slipSnap }

const SLIP_SWEEP_PREFIX = 'Salary-Slip-'

export default function SalarySlipsCard() {
  const profile = useAuthStore((s) => s.profile)
  const [rows, setRows] = useState(null)      // null=loading, []=none, [..]=paid months
  const [err, setErr] = useState(null)
  const slip = useSyncExternalStore(subscribeSlip, getSlip)
  const mine = !!profile?.id && slip.uid === profile.id
  const busyMonth = mine ? slip.busyMonth : null
  const ready = mine ? slip.ready : null
  const shownErr = err || (mine ? slip.slipErr : null)

  useEffect(() => {
    let cancelled = false
    if (!profile?.id) return
    // Agency is commission-only — no salary slip.
    if (profile.role === 'agency') { setRows([]); return }
    ;(async () => {
      const { data, error } = await supabase
        .from('salary_payouts')
        .select('month_year, amount_paid, paid_date')
        .eq('user_id', profile.id)
        .eq('is_full_payment', true)
        .order('month_year', { ascending: false })
      if (cancelled) return
      if (error) { setErr('Could not load your salary slips.'); setRows([]); return }
      // Merge recent months (current + prior — downloadable even before payment) with
      // any FULLY-PAID month. One row per month; a payout attaches its amount/date, else null.
      const paidMap = new Map()
      for (const r of data || []) if (!paidMap.has(r.month_year)) paidMap.set(r.month_year, r)
      const months = new Set([...recentMonths(4), ...paidMap.keys()])
      const list = [...months].sort().reverse().map((my) => ({ month_year: my, payout: paidMap.get(my) || null }))
      setRows(list)
    })()
    return () => { cancelled = true }
  }, [profile?.id, profile?.role])

  async function handleDownload(row) {
    const uid = profile?.id
    if (!uid) return
    const cur = getSlip()
    if (cur.uid === uid && cur.busyMonth) return
    // keep a built slip for this user; start fresh for a different user
    const keepReady = cur.uid === uid ? cur.ready : null
    setSlip({ uid, slipErr: null, busyMonth: row.month_year, ready: keepReady })
    try {
      // Second tap on an already-built slip: NO await before the share call, so
      // the browser still sees the user's tap. allowNeedsTap:false = it can
      // never loop — if sharing is refused again it downloads instead.
      if (keepReady && keepReady.month_year === row.month_year) {
        await savePdfBlob(keepReady.blob, keepReady.fileName, {
          title: keepReady.title, allowNeedsTap: false, cacheSweepPrefix: SLIP_SWEEP_PREFIX,
        })
        setSlip({ ready: null })
        return
      }
      const { label, year, month } = parseMonth(row.month_year)
      const { data, error } = await supabase.rpc('compute_monthly_salary', {
        p_user_id: uid, p_year: year, p_month: month,
      })
      if (error) throw error
      const { blob, fileName } = await buildSalarySlipBlob({
        rep: { name: profile.name, designation: profile.designation || profile.role },
        monthLabel: label,
        salary: data,
        payout: row.payout || null,   // null → PDF shows "Payment: Pending" (owner 2026-08-31)
      })
      const title = `Salary slip ${label}`
      const r = await savePdfBlob(blob, fileName, { title, cacheSweepPrefix: SLIP_SWEEP_PREFIX })
      setSlip({
        ready: r.method === 'needs-tap'
          ? { month_year: row.month_year, blob, fileName, title }
          : null,
      })
    } catch (e) {
      // Never a silent/vague failure: say WHY (the §236 rule).
      console.error('[SalarySlipsCard] slip failed:', e)
      const why = String(e?.message || e || '').slice(0, 140)
      setSlip({ slipErr: 'Could not save the slip' + (why ? ': ' + why : '. Try again.') })
    } finally {
      setSlip({ busyMonth: null })
    }
  }

  // Hidden until there's at least one paid month (keeps the page clean).
  if (rows === null || (rows.length === 0 && !shownErr)) return null

  return (
    <div
      style={{
        marginTop: 14,
        padding: '16px 18px',
        borderRadius: 14,
        background: 'var(--surface, #1e293b)',
        border: '1px solid var(--border, #334155)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
        <span
          style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: 42, height: 42, borderRadius: 12, flex: '0 0 auto',
            background: 'var(--accent-soft, rgba(255,230,0,0.14))',
            color: 'var(--accent, #FFE600)',
          }}
        >
          <FileText size={20} />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text, #f1f5f9)' }}>
            Salary slips
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-subtle, #64748b)' }}>
            Download your slip for any month
          </div>
        </div>
      </div>

      {shownErr && (
        <div
          style={{
            display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10,
            padding: '8px 10px', borderRadius: 10, fontSize: 12,
            color: 'var(--danger, #EF4444)',
            background: 'var(--danger-soft, rgba(239,68,68,0.12))',
          }}
        >
          <AlertTriangle size={14} /> {shownErr}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {rows.map((r) => {
          const { label } = parseMonth(r.month_year)
          const busy = busyMonth === r.month_year
          return (
            <div
              key={r.month_year}
              style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '10px 12px', borderRadius: 10,
                background: 'var(--surface-2, #334155)',
                border: '1px solid var(--border, #334155)',
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text, #f1f5f9)' }}>
                  {label}
                </div>
                <div className="tabular-nums" style={{ fontSize: 12, color: r.payout ? 'var(--success, #10B981)' : 'var(--text-subtle, #64748b)', marginTop: 1 }}>
                  {r.payout ? `Paid ${inr(r.payout.amount_paid)}` : 'Payment pending'}
                </div>
              </div>
              <button
                type="button"
                onClick={() => handleDownload(r)}
                disabled={busy || !!busyMonth}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  padding: '8px 14px', borderRadius: 10, border: 'none',
                  fontSize: 13, fontWeight: 700, cursor: busy ? 'default' : 'pointer',
                  color: 'var(--accent-fg, #0f172a)',
                  background: 'var(--accent, #FFE600)',
                  opacity: busyMonth && !busy ? 0.5 : 1,
                }}
              >
                {busy
                  ? <><Loader2 size={14} style={{ animation: 'spin 0.7s linear infinite' }} /> Building…</>
                  : ready && ready.month_year === r.month_year
                    ? <><Download size={14} /> Tap to open</>
                    : <><Download size={14} /> Slip</>}
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
