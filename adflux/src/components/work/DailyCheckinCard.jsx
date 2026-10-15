// Phase 386 - ONE simple "Daily check-in" card: who said the morning hi and who shared the evening report.
// Replaces the separate Morning hi + Evening report cards. For admin, co-owner, HR and accounts
// (work_daily_checkin is role-gated in the database). Read only.
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ClipboardCheck, Check, Minus } from 'lucide-react'
import '../../styles/work.css'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/authStore'
import { istHour } from '../../utils/workUtils'
import UserAvatar from '../common/UserAvatar'

const ROLE_LABEL = { sales: 'Sales', telecaller: 'Telecaller', staff: 'Work team', operation_executive: 'Ops', operation_head: 'Ops head', hr: 'HR', accounts: 'Accounts' }

export default function DailyCheckinCard() {
  const role = useAuthStore((s) => s.profile?.role)
  const [rows, setRows] = useState(null)   // null = loading
  const [err, setErr] = useState('')
  const load = async () => {
    const { data, error } = await supabase.rpc('work_daily_checkin')
    if (error) { setErr(error.message || 'Could not load.'); return }
    setErr(''); setRows(Array.isArray(data) ? data : [])
  }
  useEffect(() => {
    load()
    const t = setInterval(load, 60000)
    return () => clearInterval(t)
  }, [])

  if (rows === null && !err) return <div className="wk" style={{ padding: 0 }}><div className="wk-skel" style={{ height: 120, borderRadius: 16 }} /></div>
  if (err) return <div className="wk" style={{ padding: 0 }}><div className="wk-err" role="alert"><span>{err}</span><button className="wk-btn g sm" onClick={load}>Retry</button></div></div>
  if (!rows.length) return null

  const eveningOpen = istHour() >= 19
  const hi = rows.filter((r) => r.said_hi).length
  const ev = rows.filter((r) => r.shared).length
  // people with something still missing first, then the done ones
  const missing = (r) => (r.said_hi ? 0 : 1) + (eveningOpen && !r.shared ? 1 : 0)
  const sorted = [...rows].sort((a, b) => missing(b) - missing(a) || String(a.name).localeCompare(String(b.name)))
  const mark = (ok, off) => (off
    ? <span className="wk-pill"><Minus size={13} aria-hidden="true" /> Opens 7 PM</span>
    : ok ? <span className="wk-pill ok"><Check size={13} aria-hidden="true" /> Done</span>
         : <span className="wk-pill warn">Not yet</span>)

  return (
    <div className="wk" style={{ padding: 0 }}>
      <div className="wk-card flush">
        <div className="wk-ch">
          <div>
            <h3><span className="wk-tile"><ClipboardCheck size={16} aria-hidden="true" /></span>Daily check-in</h3>
            <div className="wk-csub">Morning hi {hi} of {rows.length} · Evening report {eveningOpen ? `${ev} of ${rows.length}` : 'opens at 7 PM'}</div>
          </div>
          {['admin', 'co_owner'].includes(role) && <Link to="/team-work" className="wk-btn o sm">Team work</Link>}
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr>
                {['Person', 'Morning hi', 'Evening report'].map((h) => (
                  <th key={h} style={{ textAlign: 'left', padding: '10px 18px', color: 'var(--text-muted)', fontWeight: 500, fontSize: 12 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => (
                <tr key={r.id} style={{ borderTop: '1px solid var(--border)' }}>
                  <td style={{ padding: '10px 18px' }}>
                    <span className="wk-grp" style={{ flexWrap: 'nowrap' }}>
                      <UserAvatar className="wk-av" name={r.name} url={r.photo} size={28} />
                      <span>{r.name}<span className="wk-sm" style={{ marginLeft: 8 }}>{ROLE_LABEL[r.role] || r.role}</span></span>
                    </span>
                  </td>
                  <td style={{ padding: '10px 18px' }}>{mark(r.said_hi, false)}</td>
                  <td style={{ padding: '10px 18px' }}>{mark(r.shared, !eveningOpen)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
