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

import { useState, useEffect } from 'react'
import { FileText, Download, Loader2, AlertTriangle } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/authStore'
import { downloadSalarySlip } from './SalarySlipPDF'
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

export default function SalarySlipsCard() {
  const profile = useAuthStore((s) => s.profile)
  const [rows, setRows] = useState(null)      // null=loading, []=none, [..]=paid months
  const [err, setErr] = useState(null)
  const [busyMonth, setBusyMonth] = useState(null) // month_year currently generating

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
    if (busyMonth) return
    const { label, year, month } = parseMonth(row.month_year)
    setBusyMonth(row.month_year)
    try {
      const { data, error } = await supabase.rpc('compute_monthly_salary', {
        p_user_id: profile.id, p_year: year, p_month: month,
      })
      if (error) throw error
      await downloadSalarySlip({
        rep: { name: profile.name, designation: profile.designation || profile.role },
        monthLabel: label,
        salary: data,
        payout: row.payout || null,   // null → PDF shows "Payment: Pending" (owner 2026-08-31)
      })
    } catch (e) {
      setErr('Could not generate the slip. Try again.')
    } finally {
      setBusyMonth(null)
    }
  }

  // Hidden until there's at least one paid month (keeps the page clean).
  if (rows === null || (rows.length === 0 && !err)) return null

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

      {err && (
        <div
          style={{
            display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10,
            padding: '8px 10px', borderRadius: 10, fontSize: 12,
            color: 'var(--danger, #EF4444)',
            background: 'var(--danger-soft, rgba(239,68,68,0.12))',
          }}
        >
          <AlertTriangle size={14} /> {err}
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
                  : <><Download size={14} /> Slip</>}
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
