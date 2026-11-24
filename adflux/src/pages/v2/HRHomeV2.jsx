// =============================================================================
// HRHomeV2 — HR daily cockpit. Landing for role='hr' (+ admin/co_owner).
// Phase 620 (owner 19-11-2026: "HR dashboard UI not good, must be user friendly"):
// the page shows HR's WORK, not a menu. One "To do today" list (oldest first, every
// row opens the page where that job is done), a slim hiring status row, and the
// daily check-in moved to the bottom. The old 13 lifecycle tiles only repeated the
// left menu and were removed. Reads via HR's own RLS; names via a second query
// (no users() embed, CLAUDE.md section 30 foot-gun).
// =============================================================================
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CalendarCheck, Wallet, ClipboardList, FileText, UserPlus, ChevronRight, CheckCircle2, Loader2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/authStore'
import DailyCheckinCard from '../../components/work/DailyCheckinCard'

const SHOW = 12   // rows shown before "Show all"

const dd = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '')
const ago = (ts) => {
  const days = Math.floor((Date.now() - Date.parse(ts)) / 86400000)
  return days <= 0 ? 'today' : days === 1 ? '1 day ago' : `${days} days ago`
}
const money = (n) => '\u20B9' + Math.round(Number(n) || 0).toLocaleString('en-IN')
// same labels the TA Claims page shows (Phase 36.7 kinds)
const TA_KIND = { ta_override: 'TA km', da_night: 'DA night', hotel: 'Hotel', other: 'Other' }

export default function HRHomeV2() {
  const nav = useNavigate()
  const profile = useAuthStore(s => s.profile)
  const isOwner = profile?.role === 'admin'
  const [data, setData] = useState(null)
  const [err, setErr] = useState('')
  const [showAll, setShowAll] = useState(false)

  useEffect(() => {
    let alive = true
    ;(async () => {
      const [lv, ta, cand, of] = await Promise.all([
        supabase.from('leaves').select('id, user_id, leave_date, leave_type, is_half_day, created_at').eq('status', 'pending').order('created_at').limit(50),
        supabase.from('ta_da_requests').select('id, user_id, claim_date, kind, claim_amount, claim_km, city, created_at').eq('status', 'pending').order('created_at').limit(50),
        supabase.from('hr_candidates').select('id, name, role_applied, created_at').eq('stage', 'applied').order('created_at').limit(50),
        supabase.from('hr_offers').select('id, candidate_id, candidate_name, position, status, created_at, updated_at').in('status', ['pending_approval', 'approved', 'draft', 'sent', 'filled', 'accepted']).order('updated_at').limit(50),
      ])
      const bad = [lv, ta, cand, of].find(r => r.error)
      if (!alive) return
      if (bad) { setErr(bad.error.message || 'Could not load'); setData({ lv: [], ta: [], cand: [], of: [], names: {} }); return }
      const ids = [...new Set([...(lv.data || []), ...(ta.data || [])].map(r => r.user_id).filter(Boolean))]
      const { data: us } = ids.length ? await supabase.from('users').select('id, name').in('id', ids) : { data: [] }
      if (!alive) return
      setData({ lv: lv.data || [], ta: ta.data || [], cand: cand.data || [], of: of.data || [], names: Object.fromEntries((us || []).map(u => [u.id, u.name])) })
    })()
    return () => { alive = false }
  }, [])

  // One list of real jobs, oldest first.
  const todo = useMemo(() => {
    if (!data) return []
    const n = (id) => data.names[id] || 'Someone'
    const rows = [
      // Phase 669 - HR's own leave goes to the owner, not onto her own to-do list.
      ...data.lv.filter(r => ['admin', 'co_owner'].includes(profile?.role) || r.user_id !== profile?.id).map(r => ({ key: 'l' + r.id, Icon: CalendarCheck, kind: 'Leave', who: n(r.user_id), what: `${dd(r.leave_date)}${r.is_half_day ? ' (half day)' : ''}${r.leave_type ? ' · ' + r.leave_type : ''}`, at: r.created_at, action: 'Approve / reject', go: '/admin/leaves' })),
      ...data.ta.map(r => ({ key: 't' + r.id, Icon: Wallet, kind: 'TA / DA claim', who: n(r.user_id), what: `${r.kind === 'ta_override' ? `${r.claim_km || 0} km` : money(r.claim_amount)} · ${TA_KIND[r.kind] || r.kind || 'claim'}${r.city ? ' · ' + r.city : ''} · ${dd(r.claim_date)}`, at: r.created_at, action: 'Check claim', go: '/admin/ta-payouts' })),
      // Phase 669 - a candidate who already has an open offer is not a 'new candidate' job.
      ...data.cand.filter(r => !data.of.some(o => o.candidate_id === r.id)).map(r => ({ key: 'c' + r.id, Icon: ClipboardList, kind: 'New candidate', who: r.name, what: r.role_applied || 'applied', at: r.created_at, action: 'Call / shortlist', go: '/hr/candidates' })),
      ...data.of.flatMap(r => {
        const base = { Icon: FileText, who: r.candidate_name, what: r.position || '', at: r.updated_at || r.created_at }
        if (r.status === 'pending_approval') return isOwner ? [{ ...base, key: 'o' + r.id, kind: 'Offer to approve', action: 'Approve salary', go: `/hr/offers?offer=${r.id}` }] : []
        if (r.status === 'approved') return isOwner ? [] : [{ ...base, key: 'o' + r.id, kind: 'Offer approved', action: 'Share link', go: `/hr/offers?offer=${r.id}` }]
        if (r.status === 'draft') return isOwner ? [] : [{ ...base, key: 'o' + r.id, kind: 'Offer sent back', action: 'See note', go: `/hr/offers?offer=${r.id}` }]
        if (r.status === 'accepted') return [{ ...base, key: 'o' + r.id, kind: 'Offer accepted', action: 'Create login', go: `/hr/offers?offer=${r.id}` }]
        return []
      }),
    ]
    return rows.sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
  }, [data, isOwner, profile?.id, profile?.role])

  const hiring = useMemo(() => {
    const st = (...s) => (data?.of || []).filter(o => s.includes(o.status)).length
    return [
      { label: 'Waiting for owner', n: st('pending_approval'), filter: 'waiting' },
      { label: 'Share the link', n: st('approved', 'draft'), filter: 'approved' },
      { label: 'With candidate', n: st('sent', 'filled'), filter: 'open' },
      { label: 'Ready for login', n: st('accepted'), filter: 'accepted' },
    ]
  }, [data])

  const name = (profile?.name || 'there').split(' ')[0]
  const hour = new Date().getHours()
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
  const visible = showAll ? todo : todo.slice(0, SHOW)

  return (
    <div className="v2d-page">
      <div className="v2d-page-head">
        <div>
          <div className="v2d-page-kicker">HR workspace</div>
          <h1 className="v2d-page-title">{greet}, {name}</h1>
          <div className="v2d-page-sub">
            {!data ? 'Loading your day…' : todo.length ? `${todo.length} thing${todo.length > 1 ? 's' : ''} to do today — oldest first.` : 'Nothing waiting — all caught up.'}
          </div>
        </div>
        <button className="v2d-cta" onClick={() => nav('/hr/offers')}><UserPlus size={16} /><span>Send an offer</span></button>
      </div>

      {err && (
        <div style={{ marginBottom: 14, padding: '12px 14px', borderRadius: 10, border: '1px solid var(--danger, #EF4444)', background: 'var(--danger-soft, rgba(239,68,68,.12))', color: 'var(--danger, #EF4444)', fontSize: 13 }}>
          Some items could not load ({err}). <button type="button" className="v2d-ghost" onClick={() => window.location.reload()}>Retry</button>
        </div>
      )}

      {/* To do today */}
      <section style={{ background: 'var(--surface, #1e293b)', border: '1px solid var(--border, #334155)', borderRadius: 14, marginBottom: 16, overflow: 'hidden' }}>
        <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border, #334155)', fontWeight: 700, fontSize: 15 }}>To do today</div>
        {!data ? (
          <div style={{ padding: 24, display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-muted)' }}><Loader2 size={16} className="spin" /> Loading…</div>
        ) : todo.length === 0 ? (
          <div style={{ padding: 28, textAlign: 'center', color: 'var(--text-muted)' }}>
            <CheckCircle2 size={22} style={{ color: 'var(--success, #10B981)' }} />
            <div style={{ marginTop: 8, fontSize: 14 }}>All caught up. New leaves, claims, candidates and offers show up here.</div>
          </div>
        ) : (
          <>
            {visible.map(r => (
              <button key={r.key} type="button" className="hr-todo-row" onClick={() => nav(r.go)}>
                <span className="hr-todo-ic"><r.Icon size={16} /></span>
                <span style={{ minWidth: 0, flex: 1, textAlign: 'left' }}>
                  <span style={{ display: 'block', fontSize: 14, fontWeight: 600, color: 'var(--text, #f1f5f9)' }}>{r.who} <span style={{ fontWeight: 500, color: 'var(--text-muted, #94a3b8)' }}>· {r.kind}</span></span>
                  <span style={{ display: 'block', fontSize: 12, color: 'var(--text-subtle, #64748b)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.what} · {ago(r.at)}</span>
                </span>
                <span className="hr-todo-act">{r.action}<ChevronRight size={14} /></span>
              </button>
            ))}
            {todo.length > SHOW && (
              <button type="button" className="v2d-ghost" style={{ margin: 10 }} onClick={() => setShowAll(v => !v)}>
                {showAll ? 'Show fewer' : `Show all ${todo.length}`}
              </button>
            )}
          </>
        )}
      </section>

      {/* Hiring status, one row */}
      <section style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginBottom: 18 }}>
        <span style={{ fontSize: 13, fontWeight: 700, marginRight: 4 }}>Hiring</span>
        {hiring.map(h => (
          <button key={h.filter} type="button" className="hr-chip" onClick={() => nav(`/hr/offers?filter=${h.filter}`)}>
            {h.label} <b className="tabular-nums" style={{ color: h.n > 0 ? 'var(--accent, #FFE600)' : 'var(--text-subtle, #64748b)' }}>{data ? h.n : '…'}</b>
          </button>
        ))}
      </section>

      {/* who said the morning hi / shared the evening report — kept, but below HR's own work */}
      <DailyCheckinCard />

      <style>{`
        .hr-todo-row { width: 100%; display: flex; align-items: center; gap: 12px; padding: 12px 16px; background: transparent; border: 0; border-top: 1px solid var(--border, #334155); cursor: pointer; font: inherit; color: inherit; }
        .hr-todo-row:first-of-type { border-top: 0; }
        .hr-todo-row:hover { background: var(--surface-2, #334155); }
        .hr-todo-row:focus-visible, .hr-chip:focus-visible { outline: 2px solid var(--accent, #FFE600); outline-offset: -2px; }
        .hr-todo-ic { width: 32px; height: 32px; border-radius: 10px; background: var(--surface-2, #334155); color: var(--accent, #FFE600); display: grid; place-items: center; flex-shrink: 0; }
        .hr-todo-act { display: inline-flex; align-items: center; gap: 4px; font-size: 13px; font-weight: 600; color: var(--accent, #FFE600); white-space: nowrap; flex-shrink: 0; }
        .hr-chip { display: inline-flex; align-items: center; gap: 6px; min-height: 36px; padding: 0 12px; border-radius: 999px; border: 1px solid var(--border, #334155); background: var(--surface, #1e293b); color: var(--text-muted, #94a3b8); font: inherit; font-size: 13px; cursor: pointer; }
        .hr-chip:hover { border-color: var(--accent, #FFE600); color: var(--text, #f1f5f9); }
        @media (max-width: 720px) { .hr-todo-act { font-size: 12px; } .hr-todo-row { padding: 12px; } }
        .spin { animation: spin 1s linear infinite; }
      `}</style>
    </div>
  )
}
