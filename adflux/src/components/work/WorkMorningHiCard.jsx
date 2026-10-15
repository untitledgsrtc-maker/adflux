// src/components/work/WorkMorningHiCard.jsx - dashboard card: who said the morning "hi" to the WhatsApp assistant today.
// Mirrors WorkEveningReportCard. Read only. Admin/co_owner read team_assistant_requests directly (tar_admin_read RLS).
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Sun } from 'lucide-react'
import '../../styles/work.css'
import { supabase } from '../../lib/supabase'
import { istTodayISO } from '../../utils/istDate'
import UserAvatar from '../common/UserAvatar'

export default function WorkMorningHiCard() {
  const [state, setState] = useState(null) // { members, greeted } | null while loading / no access
  useEffect(() => {
    let live = true
    ;(async () => {
      try {
        // IST midnight today as a UTC instant
        const since = new Date(`${istTodayISO()}T00:00:00+05:30`).toISOString()
        const [u, r] = await Promise.all([
          // everyone active except the owners (admin, co-owner) and agency partners
          supabase.from('users').select('id, name, profile_image_url').not('role', 'in', '(admin,co_owner,agency)').eq('is_active', true).limit(500),
          supabase.from('team_assistant_requests').select('user_id').gte('created_at', since).limit(2000),
        ])
        if (u.error || r.error || !live) return
        setState({ members: (u.data || []).filter(Boolean), greeted: new Set((r.data || []).map((x) => x.user_id)) })
      } catch { /* card stays hidden */ }
    })()
    return () => { live = false }
  }, [])
  if (!state || state.members.length === 0) return null
  const done = state.members.filter((u) => state.greeted.has(u.id))
  const pending = state.members.filter((u) => !state.greeted.has(u.id))
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
            <h3><span className="wk-tile"><Sun size={16} aria-hidden="true" /></span>Morning hi</h3>
            <div className="wk-csub">{done.length} of {state.members.length} said hi to the assistant today</div>
          </div>
          <Link to="/team-work" className="wk-btn o sm">Team work</Link>
        </div>
        <div style={{ padding: 18, display: 'grid', gap: 16 }}>
          {group('Said hi', 'ok', done)}
          {group('Not yet', 'warn', pending)}
        </div>
      </div>
    </div>
  )
}
