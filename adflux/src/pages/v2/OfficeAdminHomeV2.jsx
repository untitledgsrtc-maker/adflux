// Phase 391 - Office admin home (/office). Daily check-in + what needs approving + her working links.
// Office admin = office people-ops + government won-quote report / invoice submission. No finance, P&L, Master,
// salary amounts. Read-only on quotes. Pending counts are best effort (RLS gives her leaves + TA claims).
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { CheckSquare, Wallet, Users, MapPin, Briefcase, FileText, UserCircle2, ChevronRight } from 'lucide-react'
import '../../styles/work.css'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/authStore'
import DailyCheckinCard from '../../components/work/DailyCheckinCard'

export default function OfficeAdminHomeV2() {
  const profile = useAuthStore((s) => s.profile)
  const [c, setC] = useState({ leaves: null, ta: null, won: null })
  useEffect(() => {
    let live = true
    ;(async () => {
      try {
        const [l, t, w] = await Promise.all([
          supabase.from('leaves').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
          supabase.from('ta_da_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
          supabase.from('quotes').select('id', { count: 'exact', head: true }).eq('segment', 'GOVERNMENT').eq('status', 'won'),
        ])
        if (live) setC({ leaves: l.count ?? 0, ta: t.count ?? 0, won: w.count ?? 0 })
      } catch { /* counts stay blank */ }
    })()
    return () => { live = false }
  }, [])
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', hour12: false }).format(new Date()))
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
  const links = [
    ['/admin/leaves', CheckSquare, 'Leaves', 'Approve or decline', c.leaves, 'pending'],
    ['/admin/ta-payouts', Wallet, 'TA claims', 'Review travel and DA claims', c.ta, 'pending'],
    ['/team', Users, 'Team', 'Roster', null],
    ['/team-dashboard', MapPin, 'Attendance', 'Who is in the field', null],
    ['/team-work', Briefcase, 'Team Work', 'Tasks, hours, activity', null],
    ['/quotes', FileText, 'Quotes', 'Won government quotes: reports and invoices', c.won, 'won govt'],
    ['/clients', UserCircle2, 'Clients', 'Client details', null],
  ]
  return (
    <div className="wk">
      <div className="wk-head">
        <div>
          <div className="wk-eyebrow">Office</div>
          <h1 className="wk-title">{greet}, {String(profile?.name || '').split(' ')[0] || 'there'}</h1>
        </div>
      </div>
      <div style={{ display: 'grid', gap: 20 }}>
        <DailyCheckinCard />
        <div className="wk-card flush">
          <div className="wk-list">
            {links.map(([to, Ic, label, sub, n, tag]) => (
              <Link key={to} to={to} className="wk-row wk-hov" style={{ padding: '16px 20px', color: 'inherit', textDecoration: 'none' }}>
                <span className="wk-grp" style={{ gap: 12 }}>
                  <span className="wk-tile"><Ic size={16} aria-hidden="true" /></span>
                  <span><b>{label}</b><div className="wk-sm">{sub}</div></span>
                </span>
                <span className="wk-grp">
                  {n != null && n > 0 && <span className={`wk-pill ${tag === 'pending' ? 'warn' : ''}`}>{n} {tag}</span>}
                  <ChevronRight size={16} aria-hidden="true" />
                </span>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
