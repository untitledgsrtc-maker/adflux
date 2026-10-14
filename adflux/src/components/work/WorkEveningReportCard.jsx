// src/components/work/WorkEveningReportCard.jsx - dashboard card: who shared today's Work evening report.
// Same data as Team work -> Overview -> Evening report (work_members + work_report_shares), read only.
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Moon } from 'lucide-react'
import '../../styles/work.css'
import { supabase } from '../../lib/supabase'
import { istTodayISO } from '../../utils/istDate'
import { istHour } from '../../utils/workUtils'
import UserAvatar from '../common/UserAvatar'

export default function WorkEveningReportCard() {
  const [state, setState] = useState(null) // { members, shared } | null while loading / no access
  useEffect(() => {
    let live = true
    ;(async () => {
      try {
        const today = istTodayISO()
        const [m, s, st] = await Promise.all([
          supabase.from('work_members').select('user_id'),
          supabase.from('work_report_shares').select('user_id').eq('work_date', today),
          // everyone on the Work team: anyone on the timeclock + every active staff login
          supabase.from('users').select('id').eq('role', 'staff').eq('is_active', true),
        ])
        if (m.error || s.error) return
        const ids = [...new Set([...(m.data || []).map((r) => r.user_id), ...((st.data) || []).map((r) => r.id)])]
        if (!ids.length) { if (live) setState({ members: [], shared: new Set() }); return }
        const u = await supabase.from('users').select('id, name, profile_image_url').in('id', ids).eq('is_active', true)
        if (!live) return
        setState({ members: (u.data || []).filter(Boolean), shared: new Set((s.data || []).map((r) => r.user_id)) })
      } catch { /* card stays hidden */ }
    })()
    return () => { live = false }
  }, [])
  if (!state || state.members.length === 0) return null
  const done = state.members.filter((u) => state.shared.has(u.id))
  const pending = state.members.filter((u) => !state.shared.has(u.id))
  const group = (label, tone, list) => (
    <div>
      <span className={`wk-pill ${tone}`}>{label}</span>
      <div className="wk-grp" style={{ marginTop: 8 }}>
        {list.length === 0 && <span className="wk-sm">No one</span>}
        {list.map((u) => (
          <span key={u.id} className="wk-chip">
            <UserAvatar className="wk-av" name={u.name} url={u.profile_image_url} size={22} />
            {String(u.name || '').split(' ')[0]}
          </span>
        ))}
      </div>
    </div>
  )
  return (
    <div className="wk" style={{ padding: 0 }}>
      <div className="wk-card flush">
        <div className="wk-ch">
          <div>
            <h3><span className="wk-tile"><Moon size={16} aria-hidden="true" /></span>Evening report</h3>
            <div className="wk-csub">{istHour() >= 19 ? 'After 7 PM' : 'Opens at 7 PM'}</div>
          </div>
          <Link to="/team-work" className="wk-btn o sm">Team work</Link>
        </div>
        <div style={{ padding: 18, display: 'grid', gap: 16 }}>
          {group('Shared', 'ok', done)}
          {group('Not yet', 'warn', pending)}
        </div>
      </div>
    </div>
  )
}
