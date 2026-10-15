// Phase 386 - small "Daily check-in" card: morning hi + evening report in two slim lines.
// Each line: count, a thin progress bar, and the names still missing (first 5, tap "+N" for the rest).
// For admin, co-owner, HR and accounts (work_daily_checkin is role-gated in the database). Read only.
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import '../../styles/work.css'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/authStore'
import { istHour } from '../../utils/workUtils'

const first = (n) => String(n || '').trim().split(/\s+/)[0]

function Line({ label, done, total, missing, closed, note }) {
  const [all, setAll] = useState(false)
  const shown = all ? missing : missing.slice(0, 5)
  const pct = total ? Math.round(done / total * 100) : 0
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '130px 90px 1fr', gap: 12, alignItems: 'center', padding: '10px 16px' }}>
      <b style={{ fontSize: 14 }}>{label}</b>
      <span className="wk-num" style={{ fontSize: 14 }}>{closed ? '-' : `${done} of ${total}`}</span>
      <div style={{ minWidth: 0 }}>
        {closed ? <span className="wk-sm">{note}</span> : (
          <>
            <div className="wk-bar" style={{ margin: '0 0 6px' }}><i style={{ width: `${pct}%`, background: pct === 100 ? 'var(--w-okt)' : undefined }} /></div>
            {missing.length === 0
              ? <span className="wk-sm">Everyone is done</span>
              : (
                <div className="wk-grp" style={{ gap: 6 }}>
                  <span className="wk-sm">Not yet:</span>
                  {shown.map((n) => <span key={n.id} className="wk-pill warn">{first(n.name)}</span>)}
                  {!all && missing.length > 5 && <button className="wk-btn g sm" onClick={() => setAll(true)}>+{missing.length - 5} more</button>}
                  {all && missing.length > 5 && <button className="wk-btn g sm" onClick={() => setAll(false)}>Less</button>}
                </div>
              )}
          </>
        )}
      </div>
    </div>
  )
}

export default function DailyCheckinCard() {
  const role = useAuthStore((s) => s.profile?.role)
  const [rows, setRows] = useState(null)
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

  if (rows === null && !err) return <div className="wk" style={{ padding: 0 }}><div className="wk-skel" style={{ height: 96, borderRadius: 16 }} /></div>
  if (err) return <div className="wk" style={{ padding: 0 }}><div className="wk-err" role="alert"><span>{err}</span><button className="wk-btn g sm" onClick={load}>Retry</button></div></div>
  if (!rows.length) return null

  const eveningOpen = istHour() >= 19
  return (
    <div className="wk" style={{ padding: 0 }}>
      <div className="wk-card flush">
        <div className="wk-ch" style={{ padding: '12px 16px' }}>
          <h3 style={{ fontSize: 16 }}>Daily check-in</h3>
          {['admin', 'co_owner'].includes(role) && <Link to="/team-work" className="wk-btn o sm">Team work</Link>}
        </div>
        <Line label="Morning hi" done={rows.filter((r) => r.said_hi).length} total={rows.length} missing={rows.filter((r) => !r.said_hi)} />
        <Line label="Evening report" done={rows.filter((r) => r.shared).length} total={rows.length} missing={rows.filter((r) => !r.shared)}
          closed={!eveningOpen} note="Opens at 7 PM" />
      </div>
    </div>
  )
}
