// Phase 639 - "Your cost this month" on My Performance (sales + telecaller).
// Same RPC as the admin Cost per Lead report (lead_cost_report); the server
// returns ONLY the caller's own row for non-admins. Hidden until there is a
// working day this month. Read-only.
import { useEffect, useState } from 'react'
import { Calculator } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/authStore'
import { formatCurrency } from '../../utils/formatters'
import { istCurrentMonthYM } from '../../utils/istDate'

const rs1 = (v) => (v == null ? '-' : `₹${Number(v).toLocaleString('en-IN', { maximumFractionDigits: 1 })}`)

export default function MyLeadCostCard() {
  const profile = useAuthStore((s) => s.profile)
  const show = profile?.role === 'sales' || profile?.role === 'telecaller'
  const [row, setRow] = useState(null)

  useEffect(() => {
    if (!show || !profile?.id) return undefined
    let cancelled = false
    supabase.rpc('lead_cost_report', { p_month: `${istCurrentMonthYM()}-01`, p_user: profile.id })
      .then(({ data, error }) => { if (!cancelled && !error) setRow((data || [])[0] || null) })
    return () => { cancelled = true }
  }, [show, profile?.id])

  if (!show || !row) return null
  const tc = row.role === 'telecaller'
  const tiles = [
    ['Per lead worked', rs1(row.cost_per_lead), `${row.leads_touched} leads`],
    tc ? ['Per real call', rs1(row.cost_per_call), `${row.real_calls} calls`]
       : ['Per meeting', row.cost_per_meeting == null ? '-' : formatCurrency(Number(row.cost_per_meeting)), `${row.meetings} meetings`],
    ['Total this month', formatCurrency(Number(row.total_cost)), tc ? 'Salary for days worked' : 'Salary for days worked + travel'],
  ]

  return (
    <div style={{ marginTop: 14, padding: '14px 18px', borderRadius: 14, background: 'var(--surface)', border: '1px solid var(--border)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 36, height: 36, borderRadius: 10,
          background: 'var(--accent-soft)', color: 'var(--accent)' }}>
          <Calculator size={18} strokeWidth={1.6} />
        </span>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>Your cost this month</div>
          <div style={{ fontSize: 12, color: 'var(--text-subtle)' }}>
            What each lead costs the company in your time{tc ? '' : ' and travel'}. Lower is better.
          </div>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(140px, 100%), 1fr))', gap: 10 }}>
        {tiles.map(([label, value, sub]) => (
          <div key={label} style={{ padding: '10px 12px', borderRadius: 10, background: 'var(--surface-2)' }}>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{label}</div>
            <div className="tabular-nums" style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 700, color: 'var(--text)' }}>{value}</div>
            <div style={{ fontSize: 12, color: 'var(--text-subtle)' }}>{sub}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
