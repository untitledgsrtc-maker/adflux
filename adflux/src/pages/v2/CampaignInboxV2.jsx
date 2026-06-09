// src/pages/v2/CampaignInboxV2.jsx
//
// Campaign Module — C5 Inbox (read-only MVP), styled to the owner-approved
// mockup (_design_reference/campaign_module_mockup.html → Inbox tab): thread
// list with avatars + last-message preview + status chips, a conversation
// pane with day-separators + chat bubbles + stamps, a 24h-window bar, and a
// LOCKED composer (outbound send needs the edigiexpert token).
//
// Reads whatsapp_conversations + whatsapp_messages (new Phase-C2 tables, the
// C4-store data layer). Admin / co_owner only (RLS wa_conv_admin /
// wa_msg_admin + RequirePrivileged route). Touches NO existing flow / frozen
// table / hot path (§45) — new page, reads new tables only.

import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Loader2, AlertTriangle, RefreshCw, MessageSquare, Lock, ArrowLeft, Send, Check, CheckCheck,
  ChevronDown, FileText,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import CampaignChrome from '../../components/v2/CampaignChrome'
import { toastError, toastSuccess } from '../../components/v2/Toast'

// Quick-reply chips (mockup) — label on the chip, fuller text in the box.
const CANNED = [
  { label: 'Greet',          text: 'Thanks for reaching out to Untitled Advertising! How can we help?' },
  { label: 'Ask city + media', text: 'Could you share your city and which media you are looking for (hoarding / LED / etc.)?' },
  { label: 'Rate card',      text: 'Sure — I will share our rate card shortly.' },
  { label: 'Book a call',    text: 'Can we hop on a quick call to discuss? What time suits you?' },
]

// 919812345678 → +91 98123 45678 (best-effort; falls back to a bare +digits).
function fmtPhone(waId) {
  const d = String(waId || '').replace(/\D/g, '')
  if (d.length === 12 && d.startsWith('91')) return `+91 ${d.slice(2, 7)} ${d.slice(7)}`
  if (d.length === 10) return `+91 ${d.slice(0, 5)} ${d.slice(5)}`
  return d ? `+${d}` : '—'
}
// Avatar = last 2 digits, tinted by a stable hash (mockup's colourful pills).
const AV_TINTS = [
  { bg: 'var(--v2-tint-yellow, rgba(255,230,0,0.14))', fg: 'var(--v2-yellow, #FFE600)' },
  { bg: 'var(--v2-green-soft, rgba(34,197,94,0.14))', fg: 'var(--v2-green, #22c55e)' },
  { bg: 'var(--v2-blue-soft, rgba(59,130,246,0.14))',  fg: 'var(--v2-blue, #60a5fa)' },
]
function avatarFor(waId) {
  const d = String(waId || '').replace(/\D/g, '')
  let h = 0
  for (let i = 0; i < d.length; i++) h = (h * 31 + d.charCodeAt(i)) >>> 0
  return { text: d.slice(-2) || '··', ...AV_TINTS[h % AV_TINTS.length] }
}
function relTime(iso) {
  if (!iso) return ''
  const s = (Date.now() - new Date(iso).getTime()) / 1000
  if (s < 60) return 'now'
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86400)}d`
}
function msgTime(iso) {
  try {
    return new Date(iso).toLocaleTimeString('en-IN', {
      hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata',
    })
  } catch { return '' }
}
function dayLabel(iso) {
  try {
    const d = new Date(iso)
    const today = new Date()
    const isToday = d.toDateString() === today.toDateString()
    if (isToday) return 'Today'
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' })
  } catch { return '' }
}
function windowOpen(expiresIso) {
  return !!expiresIso && new Date(expiresIso).getTime() > Date.now()
}
function windowLeft(expiresIso) {
  if (!windowOpen(expiresIso)) return null
  const s = (new Date(expiresIso).getTime() - Date.now()) / 1000
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return `${h}h ${m}m left`
}
// An inbound photo we can render via the media proxy (api/wa/media).
function isImageMsg(m) {
  return !!m.media_id && (m.type === 'image' || m.type === 'sticker')
}

export default function CampaignInboxV2() {
  const navigate = useNavigate()

  const [loading, setLoading] = useState(true)
  const [tablesMissing, setTablesMissing] = useState(false)
  const [threads, setThreads] = useState([])
  const [previews, setPreviews] = useState({}) // convId → last message body
  const [selId, setSelId] = useState(null)
  const [msgs, setMsgs] = useState([])
  const [msgLoading, setMsgLoading] = useState(false)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const sendingRef = useRef(false)   // §47 synchronous latch — no double-send on a WebView ghost-click
  const msgScrollRef = useRef(null)  // C5.1 — auto-scroll anchor for the message pane
  const prevMsgCount = useRef(0)
  const [tcs, setTcs] = useState([])          // telecallers (reassign dropdown)
  const [selLead, setSelLead] = useState(null) // selected conversation's lead row
  const [reassignOpen, setReassignOpen] = useState(false)
  const [reassigning, setReassigning] = useState(false)

  const loadThreads = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    const { data, error } = await supabase
      .from('whatsapp_conversations')
      .select('id, customer_wa_id, status, last_inbound_at, window_expires_at, lead_id, assigned_to, campaign_id')
      .order('last_inbound_at', { ascending: false, nullsFirst: false })
      .limit(200)
    if (error) {
      // On a silent poll, swallow transient errors (no spinner, no toast spam).
      if (!silent) {
        if (/relation .* does not exist|could not find the table/i.test(error.message || '')) {
          setTablesMissing(true)
        } else {
          toastError(error, 'Could not load conversations.')
        }
        setLoading(false)
      }
      return
    }
    const rows = data || []
    setThreads(rows)
    if (!silent) setLoading(false)

    // Best-effort last-message preview per thread (one query, newest first).
    if (rows.length) {
      const ids = rows.map((r) => r.id)
      const { data: pm } = await supabase
        .from('whatsapp_messages')
        .select('conversation_id, body, type, at')
        .in('conversation_id', ids)
        .order('at', { ascending: false })
        .limit(600)
      const map = {}
      for (const m of pm || []) {
        if (!map[m.conversation_id]) map[m.conversation_id] = m.body || `[${m.type || 'media'}]`
      }
      setPreviews(map)
    }
  }, [])

  const loadMsgs = useCallback(async (convId, silent = false) => {
    if (!convId) { setMsgs([]); return }
    if (!silent) setMsgLoading(true)
    const { data, error } = await supabase
      .from('whatsapp_messages')
      .select('id, direction, type, body, status, at, media_id')
      .eq('conversation_id', convId)
      .order('at', { ascending: true })
      .limit(500)
    // Don't blank the open conversation on a transient (silent) error.
    if (error) { if (!silent) toastError(error, 'Could not load messages.') }
    else setMsgs(data || [])
    if (!silent) setMsgLoading(false)
  }, [])

  useEffect(() => { loadThreads() }, [loadThreads])
  useEffect(() => { loadMsgs(selId) }, [selId, loadMsgs])

  // C5.1 — auto-refresh: poll while the tab is visible so new inbound /
  // outbound messages appear WITHOUT a manual reload (silent = no spinner
  // flash). §45-safe: reads campaign tables only, admin page, off the rep
  // hot path. (A Supabase Realtime upgrade is a later option; polling needs
  // no SQL + no publication change.)
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState !== 'visible') return
      loadThreads(true)
      if (selId) loadMsgs(selId, true)
    }
    const iv = setInterval(tick, 7000)
    const onFocus = () => { if (document.visibilityState === 'visible') tick() }
    document.addEventListener('visibilitychange', onFocus)
    window.addEventListener('focus', onFocus)
    return () => {
      clearInterval(iv)
      document.removeEventListener('visibilitychange', onFocus)
      window.removeEventListener('focus', onFocus)
    }
  }, [loadThreads, loadMsgs, selId])

  // Reset the scroll anchor when switching conversations.
  useEffect(() => { prevMsgCount.current = 0 }, [selId])

  // Auto-scroll to the newest message: on open, and when a new message
  // arrives while already near the bottom (don't yank the view if the user
  // scrolled up to read history).
  useEffect(() => {
    const el = msgScrollRef.current
    if (el && msgs.length > prevMsgCount.current) {
      const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 140
      if (prevMsgCount.current === 0 || nearBottom) el.scrollTop = el.scrollHeight
    }
    prevMsgCount.current = msgs.length
  }, [msgs])

  // Telecallers — for the reassign dropdown (mount once).
  useEffect(() => {
    supabase.from('users').select('id, name').eq('role', 'telecaller').order('name')
      .then(({ data }) => setTcs(data || []))
  }, [])

  const sel = threads.find((t) => t.id === selId) || null
  const openCount = threads.filter((t) => windowOpen(t.window_expires_at)).length

  // Load the selected conversation's lead (powers the assigned/reassign pill +
  // Create quote). One small read per conversation-open; campaign admin page.
  useEffect(() => {
    setReassignOpen(false)
    const leadId = sel?.lead_id
    if (!leadId) { setSelLead(null); return }
    let alive = true
    supabase.from('leads')
      .select('id, name, company, phone, email, notes, segment, telecaller_id, assigned_to')
      .eq('id', leadId).maybeSingle()
      .then(({ data }) => { if (alive) setSelLead(data || null) })
    return () => { alive = false }
  }, [sel?.lead_id])

  // Send a free-form reply (only reachable when the 24h window is open). The
  // server (api/wa/send) re-checks the window + role, so this is just the UX.
  async function sendReply() {
    const text = draft.trim()
    if (!text || !sel) return
    if (sendingRef.current || sending) return   // §47 latch — same-tick ghost-click guard
    sendingRef.current = true
    setSending(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const jwt = session?.access_token
      if (!jwt) { toastError(new Error('Session expired'), 'Please sign in again.'); return }
      const resp = await fetch('/api/wa/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
        body: JSON.stringify({ conversation_id: sel.id, text }),
      })
      const data = await resp.json().catch(() => ({}))
      if (!resp.ok) {
        toastError(new Error(data?.detail || data?.error || `Send failed (${resp.status})`), 'Could not send.')
        return
      }
      setDraft('')
      setPreviews((p) => ({ ...p, [sel.id]: text }))
      loadMsgs(sel.id)            // reload to show the just-sent row from the DB
    } catch (e) {
      toastError(e, 'Could not send.')
    } finally {
      setSending(false)
      sendingRef.current = false
    }
  }

  // Reassign the lead to another telecaller (admin action). Sets BOTH owner
  // columns (telecaller_id + assigned_to) to the chosen TC — the C4.5 contract,
  // so the live round-robin can't hijack it — and syncs the conversation row.
  async function reassignTo(tcId) {
    if (!sel?.lead_id || !tcId || reassigning) return
    setReassigning(true)
    try {
      const { error } = await supabase.from('leads')
        .update({ telecaller_id: tcId, assigned_to: tcId })
        .eq('id', sel.lead_id)
      if (error) { toastError(error, 'Could not reassign.'); return }
      await supabase.from('whatsapp_conversations').update({ assigned_to: tcId }).eq('id', sel.id)
      setSelLead((p) => (p ? { ...p, telecaller_id: tcId, assigned_to: tcId } : p))
      setThreads((ts) => ts.map((t) => (t.id === sel.id ? { ...t, assigned_to: tcId } : t)))
      toastSuccess(`Reassigned to ${tcs.find((u) => u.id === tcId)?.name || 'telecaller'}.`)
      setReassignOpen(false)
    } catch (e) {
      toastError(e, 'Could not reassign.')
    } finally {
      setReassigning(false)
    }
  }

  // Open the new-quote wizard prefilled from this lead (mirrors LeadDetailV2:597).
  function createQuote() {
    if (!selLead) return
    navigate('/quotes/new', {
      state: { prefill: {
        client_name:    selLead.name || '',
        client_company: selLead.company || '',
        client_phone:   selLead.phone || sel?.customer_wa_id || '',
        client_email:   selLead.email || '',
        client_address: '',
        client_notes:   selLead.notes || '',
        lead_id:        selLead.id,
        segment:        selLead.segment || 'PRIVATE',
      } },
    })
  }

  const refreshBtn = (
    <button type="button" onClick={loadThreads} title="Refresh" style={btnGhost}>
      <RefreshCw size={16} strokeWidth={1.6} /> Refresh
    </button>
  )

  if (tablesMissing) {
    return (
      <CampaignChrome active="inbox" title="Inbox" right={refreshBtn}>
        <div style={{
          padding: 16, borderRadius: 14, display: 'flex', gap: 10, alignItems: 'flex-start',
          background: 'var(--v2-amber-soft, rgba(245,158,11,0.12))',
          border: '1px solid var(--v2-amber, #F59E0B)', color: 'var(--v2-ink-1, #a9b3c7)',
        }}>
          <AlertTriangle size={18} strokeWidth={1.6} style={{ color: 'var(--v2-amber, #F59E0B)', flexShrink: 0, marginTop: 1 }} />
          <span style={{ fontSize: 13 }}>
            Campaign tables not found. Run <code>supabase_campaign_c2_foundation.sql</code> in Supabase Studio, then reload.
          </span>
        </div>
      </CampaignChrome>
    )
  }

  return (
    <CampaignChrome active="inbox" title="Inbox" right={refreshBtn}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'stretch' }}>
        {/* ─── thread list ─── */}
        <div style={{
          flex: '1 1 300px', minWidth: 280, maxWidth: 360,
          background: 'var(--v2-bg-1)', border: '1px solid var(--v2-line)',
          borderRadius: 14, overflow: 'hidden', alignSelf: 'flex-start',
        }}>
          <div style={{
            padding: '12px 14px', borderBottom: '1px solid var(--v2-line)',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--v2-ink-0, #f5f7fb)', fontFamily: 'var(--v2-display)' }}>
              Conversations
            </span>
            {threads.length > 0 && <span style={chipY}>{openCount} open</span>}
          </div>

          {loading ? (
            <div style={{ padding: 28, display: 'flex', justifyContent: 'center' }}>
              <Loader2 size={18} strokeWidth={1.6} className="spin" style={{ color: 'var(--v2-yellow, #FFE600)' }} />
            </div>
          ) : threads.length === 0 ? (
            <div style={{ padding: '30px 18px', textAlign: 'center', color: 'var(--v2-ink-2, #6a7590)' }}>
              <MessageSquare size={22} strokeWidth={1.6} style={{ opacity: 0.5 }} />
              <p style={{ fontSize: 13, margin: '10px 0 0' }}>No conversations yet.</p>
              <p style={{ fontSize: 12, margin: '4px 0 0' }}>A WhatsApp message to your number appears here.</p>
            </div>
          ) : (
            <div style={{ maxHeight: 600, overflowY: 'auto' }}>
              {threads.map((t) => {
                const active = t.id === selId
                const av = avatarFor(t.customer_wa_id)
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setSelId(t.id)}
                    style={{
                      width: '100%', textAlign: 'left', cursor: 'pointer',
                      display: 'flex', alignItems: 'flex-start', gap: 11,
                      padding: '12px 14px', border: 'none',
                      borderBottom: '1px solid var(--v2-line)',
                      borderLeft: active ? '2px solid var(--v2-yellow, #FFE600)' : '2px solid transparent',
                      background: active ? 'var(--v2-bg-2)' : 'transparent',
                    }}
                  >
                    <span style={{ ...avBox, background: av.bg, color: av.fg }}>{av.text}</span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                        <span style={{
                          fontSize: 13.5, fontWeight: 700, color: 'var(--v2-ink-0, #f5f7fb)',
                          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                        }}>
                          {fmtPhone(t.customer_wa_id)}
                        </span>
                        <span style={{ fontSize: 11, color: 'var(--v2-ink-2, #6a7590)', flexShrink: 0 }}>{relTime(t.last_inbound_at)}</span>
                      </span>
                      <span style={{
                        display: 'block', fontSize: 12.5, color: 'var(--v2-ink-2, #6a7590)', marginTop: 2,
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 230,
                      }}>
                        {previews[t.id] || '…'}
                      </span>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
                        <span style={windowOpen(t.window_expires_at) ? chipG : chipA}>
                          {windowOpen(t.window_expires_at) ? 'Open' : 'Needs template'}
                        </span>
                        {t.lead_id && <span style={chipB}>Lead</span>}
                      </span>
                    </span>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* ─── conversation pane ─── */}
        <div style={{
          flex: '2 1 380px', minWidth: 300, alignSelf: 'stretch',
          background: 'var(--v2-bg-1)', border: '1px solid var(--v2-line)',
          borderRadius: 14, display: 'flex', flexDirection: 'column', minHeight: 460,
        }}>
          {!sel ? (
            <div style={{
              flex: 1, display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center', padding: 30,
              color: 'var(--v2-ink-2, #6a7590)', textAlign: 'center',
            }}>
              <MessageSquare size={22} strokeWidth={1.6} style={{ opacity: 0.5 }} />
              <p style={{ fontSize: 13, margin: '10px 0 0' }}>Pick a conversation to read it.</p>
            </div>
          ) : (
            <>
              {/* conversation header */}
              <div style={{
                padding: '12px 16px', borderBottom: '1px solid var(--v2-line)',
                display: 'flex', alignItems: 'center', gap: 11, flexWrap: 'wrap',
              }}>
                <button type="button" onClick={() => setSelId(null)} title="Back" style={iconBtn}>
                  <ArrowLeft size={18} strokeWidth={1.6} />
                </button>
                <span style={{ ...avBox, ...(() => { const a = avatarFor(sel.customer_wa_id); return { background: a.bg, color: a.fg } })() }}>
                  {avatarFor(sel.customer_wa_id).text}
                </span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 14, fontWeight: 700, color: 'var(--v2-ink-0, #f5f7fb)' }}>
                    {fmtPhone(sel.customer_wa_id)}
                  </span>
                  <span style={{ fontSize: 11.5, color: windowOpen(sel.window_expires_at) ? 'var(--v2-green, #22c55e)' : 'var(--v2-ink-2, #6a7590)' }}>
                    {windowOpen(sel.window_expires_at) ? `Window open · ${windowLeft(sel.window_expires_at)}` : 'Window closed — needs a template to re-open'}
                  </span>
                </span>
                {sel.lead_id && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    {/* assigned-to + reassign (mockup) */}
                    <div style={{ position: 'relative' }}>
                      <button type="button" onClick={() => setReassignOpen((o) => !o)} style={btnGhost} title="Reassign telecaller">
                        {(() => {
                          const owner = selLead?.telecaller_id || selLead?.assigned_to
                          const nm = tcs.find((u) => u.id === owner)?.name
                          return (<><span style={miniAv}>{(nm || '?').charAt(0).toUpperCase()}</span>{nm || 'Assign'}</>)
                        })()}
                        <ChevronDown size={14} strokeWidth={1.6} />
                      </button>
                      {reassignOpen && (
                        <div style={reassignMenu}>
                          {tcs.length === 0
                            ? <div style={{ padding: '8px 12px', fontSize: 12, color: 'var(--v2-ink-2)' }}>No telecallers</div>
                            : tcs.map((u) => (
                              <button key={u.id} type="button" disabled={reassigning} onClick={() => reassignTo(u.id)} style={reassignItem}>
                                <span style={miniAv}>{(u.name || '?').charAt(0).toUpperCase()}</span>{u.name}
                              </button>
                            ))}
                        </div>
                      )}
                    </div>
                    <button type="button" onClick={() => navigate(`/leads/${sel.lead_id}`)} style={btnGhost}>Open lead</button>
                    <button type="button" onClick={createQuote} style={btnY}><FileText size={14} strokeWidth={1.6} /> Create quote</button>
                  </div>
                )}
              </div>

              {/* messages */}
              <div ref={msgScrollRef} style={{ flex: 1, overflowY: 'auto', padding: '14px 16px', maxHeight: 500 }}>
                {msgLoading ? (
                  <div style={{ display: 'flex', justifyContent: 'center', padding: 24 }}>
                    <Loader2 size={18} strokeWidth={1.6} className="spin" style={{ color: 'var(--v2-yellow, #FFE600)' }} />
                  </div>
                ) : msgs.length === 0 ? (
                  <p style={{ fontSize: 13, color: 'var(--v2-ink-2, #6a7590)', textAlign: 'center', margin: '24px 0' }}>
                    No messages in this conversation.
                  </p>
                ) : (
                  msgs.map((m, i) => {
                    const out = m.direction === 'out'
                    const prevDay = i > 0 ? dayLabel(msgs[i - 1].at) : null
                    const thisDay = dayLabel(m.at)
                    const showSep = thisDay && thisDay !== prevDay
                    return (
                      <div key={m.id}>
                        {showSep && (
                          <div style={{ textAlign: 'center', margin: '6px 0 12px' }}>
                            <span style={{
                              fontSize: 10.5, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase',
                              color: 'var(--v2-ink-2, #6a7590)', background: 'var(--v2-bg-2)',
                              border: '1px solid var(--v2-line)', borderRadius: 999, padding: '3px 10px',
                            }}>
                              {thisDay}
                            </span>
                          </div>
                        )}
                        <div style={{ display: 'flex', justifyContent: out ? 'flex-end' : 'flex-start', marginBottom: 8 }}>
                          <div style={{
                            // Mockup: outbound = WhatsApp-green tint with a chat-tail;
                            // inbound = surface bubble. Both light text on dark.
                            maxWidth: '76%', padding: '8px 11px',
                            borderRadius: 10,
                            borderBottomRightRadius: out ? 6 : 10,
                            borderBottomLeftRadius: out ? 10 : 6,
                            background: out ? 'var(--v2-green-soft, rgba(34,197,94,0.18))' : 'var(--v2-bg-2)',
                            color: 'var(--v2-ink-0, #f5f7fb)',
                            border: out ? '1px solid rgba(34,197,94,0.34)' : '1px solid var(--v2-line)',
                          }}>
                            <div style={{ fontSize: 13.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                              {isImageMsg(m) && (
                                <a href={`/api/wa/media?id=${encodeURIComponent(m.media_id)}`} target="_blank" rel="noreferrer" style={{ display: 'block' }}>
                                  <img
                                    src={`/api/wa/media?id=${encodeURIComponent(m.media_id)}`}
                                    alt={m.body || 'photo'} loading="lazy"
                                    style={{ maxWidth: 220, maxHeight: 260, borderRadius: 8, display: 'block', marginBottom: m.body ? 6 : 0 }}
                                  />
                                </a>
                              )}
                              {m.body
                                ? m.body
                                : (!isImageMsg(m) && <em style={{ opacity: 0.7 }}>[{m.type || 'media'}]</em>)}
                            </div>
                            <div style={{
                              fontSize: 10, marginTop: 3, display: 'flex', alignItems: 'center',
                              justifyContent: 'flex-end', gap: 4, color: 'var(--v2-ink-2, #6a7590)',
                            }}>
                              {msgTime(m.at)}
                              {/* WhatsApp-style delivery ticks (outbound only): sent ✓, delivered ✓✓, read ✓✓ blue */}
                              {out && (m.status === 'read' || m.status === 'delivered') && (
                                <CheckCheck size={13} strokeWidth={1.6}
                                  style={{ color: m.status === 'read' ? 'var(--v2-blue, #60a5fa)' : 'var(--v2-ink-2, #6a7590)' }} />
                              )}
                              {out && m.status === 'sent' && (
                                <Check size={13} strokeWidth={1.6} />
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    )
                  })
                )}
              </div>

              {/* window bar */}
              <div style={{
                padding: '8px 16px', fontSize: 11.5, fontWeight: 600,
                borderTop: '1px solid var(--v2-line)',
                color: windowOpen(sel.window_expires_at) ? 'var(--v2-green, #22c55e)' : 'var(--v2-amber, #F59E0B)',
                background: windowOpen(sel.window_expires_at) ? 'var(--v2-green-soft, rgba(34,197,94,0.12))' : 'var(--v2-amber-soft, rgba(245,158,11,0.12))',
              }}>
                {windowOpen(sel.window_expires_at)
                  ? `24h window OPEN · ${windowLeft(sel.window_expires_at)}`
                  : '24h window CLOSED · needs an approved template'}
              </div>

              {/* composer — free-form text, allowed only inside the 24h window */}
              {windowOpen(sel.window_expires_at) ? (
                <div style={{ padding: '10px 12px', borderTop: '1px solid var(--v2-line)', background: 'var(--v2-bg-2)' }}>
                  {/* quick-reply chips (mockup) — click fills the box for editing */}
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
                    {CANNED.map((c) => (
                      <button key={c.label} type="button" onClick={() => setDraft(c.text)} style={chipReply} title={c.text}>
                        {c.label}
                      </button>
                    ))}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
                    <textarea
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendReply() } }}
                      placeholder="Type a reply…"
                      rows={1}
                      style={{
                        flex: 1, resize: 'none', maxHeight: 120, minHeight: 38, padding: '9px 12px',
                        background: 'var(--v2-bg-1, #0f1525)', border: '1px solid var(--v2-line)', borderRadius: 10,
                        color: 'var(--v2-ink-0, #f5f7fb)', fontSize: 13, fontFamily: 'inherit', outline: 'none',
                      }}
                    />
                    <button
                      type="button" onClick={sendReply} disabled={sending || !draft.trim()}
                      style={{
                        flexShrink: 0, height: 38, padding: '0 14px', borderRadius: 10, border: 'none',
                        background: 'var(--v2-yellow, #FFE600)', color: 'var(--accent-fg, #0f172a)',
                        fontWeight: 700, fontSize: 13, cursor: (sending || !draft.trim()) ? 'default' : 'pointer',
                        opacity: (sending || !draft.trim()) ? 0.55 : 1, display: 'inline-flex', alignItems: 'center', gap: 6,
                      }}
                    >
                      {sending ? <Loader2 size={15} strokeWidth={1.6} className="spin" /> : <Send size={15} strokeWidth={1.6} />}
                      Send
                    </button>
                  </div>
                </div>
              ) : (
                <div style={{ padding: '12px 16px', borderTop: '1px solid var(--v2-line)', display: 'flex', alignItems: 'center', gap: 10, background: 'var(--v2-bg-2)' }}>
                  <Lock size={16} strokeWidth={1.6} style={{ color: 'var(--v2-ink-2, #6a7590)', flexShrink: 0 }} />
                  <span style={{ fontSize: 12.5, color: 'var(--v2-ink-2, #6a7590)' }}>
                    24h window closed — re-opening needs an approved template (coming with broadcast).
                  </span>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </CampaignChrome>
  )
}

// ─── shared inline styles ───────────────────────────────────────────────
const avBox = {
  width: 36, height: 36, borderRadius: 999, flexShrink: 0,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  fontSize: 12, fontWeight: 700, fontFamily: 'var(--v2-display)',
}
const chipBase = {
  display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px',
  borderRadius: 999, fontSize: 10, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase',
}
const chipG = { ...chipBase, background: 'var(--v2-green-soft, rgba(34,197,94,0.14))', color: 'var(--v2-green, #22c55e)' }
const chipA = { ...chipBase, background: 'var(--v2-amber-soft, rgba(245,158,11,0.14))', color: 'var(--v2-amber, #F59E0B)' }
const chipB = { ...chipBase, background: 'var(--v2-blue-soft, rgba(59,130,246,0.14))', color: 'var(--v2-blue, #60a5fa)' }
const chipY = { ...chipBase, background: 'var(--v2-tint-yellow, rgba(255,230,0,0.14))', color: 'var(--v2-yellow, #FFE600)' }
const btnGhost = {
  display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 700, cursor: 'pointer',
  background: 'var(--v2-bg-2)', color: 'var(--v2-ink-1, #a9b3c7)',
  border: '1px solid var(--v2-line)', borderRadius: 10, padding: '8px 12px',
}
const iconBtn = {
  background: 'transparent', border: 'none', cursor: 'pointer',
  color: 'var(--v2-ink-2, #6a7590)', display: 'flex', padding: 2,
}
const btnY = {
  display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 700, cursor: 'pointer',
  background: 'var(--v2-yellow, #FFE600)', color: 'var(--accent-fg, #0b1220)',
  border: 'none', borderRadius: 10, padding: '8px 12px',
}
const miniAv = {
  width: 18, height: 18, borderRadius: 999, flexShrink: 0, marginRight: 2,
  background: 'var(--v2-blue-soft, rgba(96,165,250,0.16))', color: 'var(--v2-blue, #60a5fa)',
  fontSize: 9, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
}
const chipReply = {
  fontSize: 12, fontWeight: 600, cursor: 'pointer',
  background: 'var(--v2-bg-1, #0f1525)', color: 'var(--v2-ink-1, #a9b3c7)',
  border: '1px solid var(--v2-line, #1f2b47)', borderRadius: 999, padding: '5px 11px',
}
const reassignMenu = {
  position: 'absolute', top: '100%', right: 0, marginTop: 4, zIndex: 100,
  background: 'var(--v2-bg-1, #0f1525)', border: '1px solid var(--v2-line, #1f2b47)',
  borderRadius: 10, boxShadow: '0 12px 30px rgba(0,0,0,.4)', minWidth: 180, padding: 4,
  maxHeight: 240, overflowY: 'auto',
}
const reassignItem = {
  width: '100%', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 8,
  padding: '8px 10px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
  background: 'transparent', border: 'none', borderRadius: 10, color: 'var(--v2-ink-0, #f5f7fb)',
}
