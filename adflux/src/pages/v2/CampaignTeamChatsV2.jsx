// src/pages/v2/CampaignTeamChatsV2.jsx
//
// Phase 476 - Campaigns -> Team. READ-ONLY view of the team's WhatsApp chat with the assistant:
// what each person wrote, what the assistant replied / nudged, and whether Meta delivered it
// (or the reason it failed). Data = team_wa_messages (admin + co_owner read only, RLS).
// Separate from the customer Inbox on purpose: staff messages never create a lead or a conversation.

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { RefreshCw, Check, CheckCheck, AlertTriangle } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import CampaignChrome from '../../components/v2/CampaignChrome'
import UserAvatar from '../../components/common/UserAvatar'

const fmtTime = (iso) => {
  const d = new Date(iso); if (isNaN(d)) return ''
  const t = new Date(); const same = d.toDateString() === t.toDateString()
  const hm = d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })
  return same ? hm : `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')} ${hm}`
}
const KIND = { reply: 'Reply', nudge: 'Reminder', evening: 'Evening reminder', reminder: 'Reminder from head', chat: '' }

function Ticks({ status }) {
  if (status === 'failed') return <AlertTriangle size={13} style={{ color: 'var(--danger, #EF4444)' }} />
  if (status === 'read') return <CheckCheck size={14} style={{ color: 'var(--blue, #3B82F6)' }} />
  if (status === 'delivered') return <CheckCheck size={14} style={{ color: 'var(--text-muted, #94a3b8)' }} />
  return <Check size={14} style={{ color: 'var(--text-muted, #94a3b8)' }} />
}

export default function CampaignTeamChatsV2() {
  const [rows, setRows] = useState(null)
  const [users, setUsers] = useState({})
  const [selId, setSelId] = useState(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const bottomRef = useRef(null)

  const load = useCallback(async () => {
    setBusy(true)
    const since = new Date(Date.now() - 30 * 86400000).toISOString()
    const { data, error } = await supabase.from('team_wa_messages')
      .select('id,user_id,direction,body,status,error,kind,at')
      .gte('at', since).order('at', { ascending: false }).limit(1500)   // cap-ok: 30 days, newest first
    if (error) { setErr(error.message); setBusy(false); return }
    setErr(''); setRows(data || [])
    const ids = [...new Set((data || []).map((r) => r.user_id).filter(Boolean))]
    if (ids.length) {
      const { data: us } = await supabase.from('users').select('id,name,role,profile_image_url').in('id', ids)
      setUsers(Object.fromEntries((us || []).map((u) => [u.id, u])))
    }
    setBusy(false)
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => {   // quiet refresh every 20 s while the tab is visible
    const t = setInterval(() => { if (document.visibilityState === 'visible') load() }, 20000)
    return () => clearInterval(t)
  }, [load])

  const people = useMemo(() => {
    const map = new Map()
    for (const r of rows || []) {   // rows are newest-first: first seen = last message
      if (!r.user_id) continue
      if (!map.has(r.user_id)) map.set(r.user_id, { id: r.user_id, last: r, failed: 0 })
      if (r.direction === 'out' && r.status === 'failed') map.get(r.user_id).failed += 1
    }
    return [...map.values()]
  }, [rows])

  const thread = useMemo(() => (rows || []).filter((r) => r.user_id === selId).slice().reverse(), [rows, selId])
  useEffect(() => { if (!selId && people.length) setSelId(people[0].id) }, [people, selId])
  useEffect(() => { bottomRef.current?.scrollIntoView({ block: 'end' }) }, [selId, thread.length])

  const sel = users[selId]
  const refreshBtn = (
    <button type="button" onClick={load} disabled={busy} className="lead-btn" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <RefreshCw size={14} className={busy ? 'spin' : ''} /> Refresh
    </button>
  )

  return (
    <CampaignChrome active="team" title="Team chats" sub="What your team writes to the assistant and what it sends back, with delivery status. Read only." right={refreshBtn}>
      {err && <div style={{ color: 'var(--danger, #EF4444)', fontSize: 13, marginBottom: 12 }}>Could not load: {err}</div>}
      {rows && !people.length && !err && <div style={{ color: 'var(--text-muted, #94a3b8)', fontSize: 14, padding: '40px 0', textAlign: 'center' }}>No team messages in the last 30 days.</div>}
      {!rows && !err && <div style={{ color: 'var(--text-muted, #94a3b8)', fontSize: 14, padding: '40px 0', textAlign: 'center' }}>Loading...</div>}
      {people.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 300px) 1fr', gap: 14, alignItems: 'start' }} className="tc-grid">
          <div className="lead-card" style={{ padding: 0, maxHeight: '68vh', overflowY: 'auto' }}>
            {people.map((p) => {
              const u = users[p.id] || {}
              const active = p.id === selId
              return (
                <button key={p.id} type="button" onClick={() => setSelId(p.id)}
                  style={{ display: 'flex', gap: 10, alignItems: 'center', width: '100%', textAlign: 'left', padding: '12px 14px', border: 0, borderBottom: '1px solid var(--border, #334155)', cursor: 'pointer',
                    background: active ? 'var(--surface-3, #475569)' : 'transparent', color: 'var(--text, #f1f5f9)' }}>
                  <UserAvatar name={u.name} userId={p.id} size={36} className="" style={{ background: 'var(--accent-soft, rgba(255,230,0,.14))', color: 'var(--accent, #FFE600)', fontWeight: 700 }} />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'flex', justifyContent: 'space-between', gap: 6 }}>
                      <b style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.name || 'Unknown'}</b>
                      <span style={{ fontSize: 12, color: 'var(--text-muted, #94a3b8)', flexShrink: 0 }}>{fmtTime(p.last.at)}</span>
                    </span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-muted, #94a3b8)' }}>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{p.last.direction === 'out' ? 'You: ' : ''}{p.last.body}</span>
                      {p.failed > 0 && <span style={{ background: 'var(--danger-soft, rgba(239,68,68,.12))', color: 'var(--danger, #EF4444)', borderRadius: 999, padding: '1px 7px', fontSize: 12, fontWeight: 700, flexShrink: 0 }}>{p.failed} failed</span>}
                    </span>
                  </span>
                </button>
              )
            })}
          </div>

          <div className="lead-card" style={{ padding: 0, display: 'flex', flexDirection: 'column', maxHeight: '68vh' }}>
            <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border, #334155)', fontSize: 14, fontWeight: 600, color: 'var(--text, #f1f5f9)' }}>
              {sel?.name || 'Select a person'} <span style={{ fontWeight: 400, color: 'var(--text-muted, #94a3b8)', fontSize: 12 }}>{sel?.role ? ` · ${sel.role.replace('_', ' ')}` : ''}</span>
            </div>
            <div style={{ padding: 16, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
              {thread.map((m) => {
                const out = m.direction === 'out'
                return (
                  <div key={m.id} style={{ alignSelf: out ? 'flex-end' : 'flex-start', maxWidth: '78%' }}>
                    {out && KIND[m.kind] && <div style={{ fontSize: 12, color: 'var(--text-subtle, #64748b)', textAlign: 'right', marginBottom: 2 }}>{KIND[m.kind]}</div>}
                    <div style={{ background: out ? 'var(--accent-soft, rgba(255,230,0,.14))' : 'var(--surface-2, #334155)', color: 'var(--text, #f1f5f9)',
                      border: m.status === 'failed' ? '1px solid var(--danger, #EF4444)' : '1px solid transparent', borderRadius: 14, padding: '8px 12px', fontSize: 13, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                      {m.body}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: out ? 'flex-end' : 'flex-start', gap: 5, fontSize: 12, color: 'var(--text-subtle, #64748b)', marginTop: 2 }}>
                      {fmtTime(m.at)} {out && <Ticks status={m.status} />}
                      {out && m.status === 'failed' && m.error && <span style={{ color: 'var(--danger, #EF4444)' }}>{m.error}</span>}
                    </div>
                  </div>
                )
              })}
              <div ref={bottomRef} />
            </div>
          </div>
        </div>
      )}
      <style>{`@media (max-width: 720px) { .tc-grid { grid-template-columns: 1fr !important; } }`}</style>
    </CampaignChrome>
  )
}
