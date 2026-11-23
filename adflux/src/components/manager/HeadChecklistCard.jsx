// Phase 656 - sales head's daily routine on his Today page (owner 23 Nov 2026).
// Hand-ticked items are saved in head_checklist (owner can see them); the rest
// are read live: team checked in, approvals cleared, evening reports shared.
// Renders only for team_role = 'sales_manager'. Hidden on Sunday.
import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CheckCircle2, Circle, AlertTriangle, ListChecks, ChevronRight } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/authStore'
import { istTodayISO } from '../../utils/istDate'
import { toastError } from '../v2/Toast'
import useAutoRefresh from '../../hooks/useAutoRefresh'

const istParts = () => {
  const f = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short' })
  const p = Object.fromEntries(f.formatToParts(new Date()).map((x) => [x.type, x.value]))
  return { mins: Number(p.hour) * 60 + Number(p.minute), sunday: p.weekday === 'Sun' }
}

// time = when it should be done; lateAt = minutes after midnight IST when an undone item turns red
const ITEMS = [
  { key: 'checkin',      time: '9:45',  label: 'Team checked in',                         auto: true, to: '/team-dashboard', lateAt: 630 },
  { key: 'meeting',      time: '9:50',  label: 'Morning team meeting',                                                       lateAt: 615 },
  { key: 'approvals',    time: '10:00', label: 'Quote prices cleared',                    auto: true, to: '/quote-approvals', lateAt: 660 },   // Phase 657 - owner: leaves + TA out
  { key: 'callbacks',    time: '10:15', label: 'Old callbacks reviewed',                              to: '/manager',         lateAt: 720 },
  { key: 'check_1pm',    time: '1:00',  label: 'Team Live check: anyone idle or GPS off',             to: '/team-dashboard',  lateAt: 840 },
  { key: 'check_4pm',    time: '4:00',  label: 'Team Live check: anyone idle or GPS off',             to: '/team-dashboard',  lateAt: 1020 },
  { key: 'evening_tips', time: '6:30',  label: 'Team Evening tips sent on WhatsApp',                  to: '/coach',           lateAt: 1230 },
  { key: 'reports',      time: '8:00',  label: 'Evening reports shared by the team',      auto: true, to: '/manager',         lateAt: 1230 },
]

export default function HeadChecklistCard() {
  const profile = useAuthStore((s) => s.profile)
  const navigate = useNavigate()
  const isHead = profile?.team_role === 'sales_manager'
  const [ticks, setTicks] = useState({})        // item -> done_at
  const [auto, setAuto] = useState(null)        // { checkin, approvals, reports } -> { done, note }
  const [now, setNow] = useState(istParts())

  const load = useCallback(async () => {
    if (!isHead || !profile?.id) return
    const today = istTodayISO()
    const { data: reps } = await supabase.from('users').select('id').eq('manager_id', profile.id).eq('is_active', true)
    const ids = (reps || []).map((r) => r.id)
    const none = ['00000000-0000-0000-0000-000000000000']
    const [tk, ses, lv, pq] = await Promise.all([
      supabase.from('head_checklist').select('item, done_at').eq('user_id', profile.id).eq('day', today),
      supabase.from('work_sessions').select('user_id, check_in_at, evening_summary_sent_at').eq('work_date', today).in('user_id', ids.length ? ids : none),
      supabase.from('leaves').select('user_id').eq('leave_date', today).eq('status', 'approved').eq('is_half_day', false).in('user_id', ids.length ? ids : none),
      supabase.from('quote_price_approvals').select('id', { count: 'exact', head: true }).eq('status', 'pending').neq('requested_by', profile.id),
    ])
    if (tk.error) { toastError(tk.error, 'Could not load your checklist'); return }
    setTicks(Object.fromEntries((tk.data || []).map((r) => [r.item, r.done_at])))
    const onLeave = new Set((lv.data || []).map((r) => r.user_id))
    const expected = ids.filter((id) => !onLeave.has(id)).length
    const sessions = ses.data || []
    const inCount = sessions.filter((s) => s.check_in_at && !onLeave.has(s.user_id)).length
    const shared = sessions.filter((s) => s.evening_summary_sent_at).length
    const working = sessions.filter((s) => s.check_in_at).length
    const pending = pq.count || 0
    setAuto({
      checkin:   { done: expected > 0 && inCount >= expected, note: `${inCount} of ${expected}` },
      approvals: { done: pending === 0, note: pending ? `${pending} waiting` : 'none waiting' },
      reports:   { done: working > 0 && shared >= working, note: `${shared} of ${working}` },
    })
    setNow(istParts())
  }, [isHead, profile?.id])

  useEffect(() => { load() }, [load])
  // every 2 min while visible + on tab resume; realtime limited to his own rows (no reload on every rep's punch)
  useAutoRefresh(load, { enabled: isHead, pollSeconds: 120, userId: profile?.id })

  async function toggle(key) {
    const today = istTodayISO()
    const was = ticks[key]
    setTicks((t) => { const n = { ...t }; if (was) delete n[key]; else n[key] = new Date().toISOString(); return n })
    const { error } = was
      ? await supabase.from('head_checklist').delete().eq('user_id', profile.id).eq('day', today).eq('item', key)
      : await supabase.from('head_checklist').insert({ user_id: profile.id, day: today, item: key })
    if (error && error.code !== '23505') {
      setTicks((t) => { const n = { ...t }; if (was) n[key] = was; else delete n[key]; return n })
      toastError(error, 'Could not save the tick')
    }
  }

  if (!isHead || now.sunday) return null

  const rows = ITEMS.map((it) => {
    const done = it.auto ? !!auto?.[it.key]?.done : !!ticks[it.key]
    return { ...it, done, late: !done && now.mins >= it.lateAt, note: it.auto ? auto?.[it.key]?.note : null }
  })
  const doneCount = rows.filter((r) => r.done).length

  return (
    <div className="v2d-panel" style={{ padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <span style={{ display: 'inline-flex', width: 36, height: 36, alignItems: 'center', justifyContent: 'center',
          borderRadius: 10, background: 'var(--accent-soft)', color: 'var(--v2-yellow, #FFE600)' }}>
          <ListChecks size={18} strokeWidth={1.6} />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, color: 'var(--v2-ink-0)' }}>Head checklist</div>
          <div style={{ fontSize: 12, color: 'var(--v2-ink-2)' }}>{doneCount} of {rows.length} done today</div>
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {rows.map((r) => (
          <div key={r.key} style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 44, padding: '6px 10px',
            borderRadius: 10, background: 'var(--v2-bg-2)',
            border: `1px solid ${r.late ? 'var(--v2-rose, #f43f5e)' : 'transparent'}` }}>
            <button type="button" onClick={() => (r.auto ? navigate(r.to) : toggle(r.key))}
              aria-label={r.auto ? `${r.label}, ${r.note || ''}` : `${r.done ? 'Untick' : 'Tick'} ${r.label}`}
              style={{ display: 'inline-flex', minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', background: 'none', border: 0, padding: 0, cursor: 'pointer',
                color: r.done ? 'var(--v2-green, #10B981)' : r.late ? 'var(--v2-rose, #f43f5e)' : 'var(--v2-ink-2)' }}>
              {r.done ? <CheckCircle2 size={22} strokeWidth={1.6} /> : r.late ? <AlertTriangle size={22} strokeWidth={1.6} /> : <Circle size={22} strokeWidth={1.6} />}
            </button>
            <span className="tabular-nums" style={{ width: 44, fontSize: 12, color: 'var(--v2-ink-2)', fontFamily: 'var(--v2-display, inherit)' }}>{r.time}</span>
            <span style={{ flex: 1, minWidth: 0, fontSize: 13, color: r.done ? 'var(--v2-ink-2)' : 'var(--v2-ink-0)',
              textDecoration: r.done && !r.auto ? 'line-through' : 'none' }}>
              {r.label}
              {r.note && <span style={{ marginLeft: 6, fontSize: 12, color: r.late ? 'var(--v2-rose, #f43f5e)' : 'var(--v2-ink-2)' }}>· {r.note}</span>}
            </span>
            {r.to && (
              <button type="button" onClick={() => navigate(r.to)} aria-label={`Open ${r.label}`}
                style={{ display: 'inline-flex', minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center',
                  background: 'none', border: 0, cursor: 'pointer', color: 'var(--v2-ink-2)' }}>
                <ChevronRight size={16} strokeWidth={1.6} />
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
