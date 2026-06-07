// src/pages/v2/CampaignInboxV2.jsx
//
// Campaign Module — C5 Inbox (read-only MVP).
//
// Reads whatsapp_conversations + whatsapp_messages (new Phase-C2 tables the
// webhook's C4-store writes). Two-pane: thread list + the selected chat. The
// reply composer shows the LOCKED state — outbound send needs the edigiexpert
// token (receiving + reading is free). Admin / co_owner only (RLS wa_conv_admin
// / wa_msg_admin). Touches NO existing flow / frozen table / hot path (§45) —
// new page, new route, reads new tables only.

import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Inbox, Loader2, AlertTriangle, RefreshCw, MessageSquare,
  Lock, ArrowLeft, User,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/authStore'
import { toastError } from '../../components/v2/Toast'

// 919812345678 → +91 98123 45678 (best-effort; falls back to a bare +digits).
function fmtPhone(waId) {
  const d = String(waId || '').replace(/\D/g, '')
  if (d.length === 12 && d.startsWith('91')) return `+91 ${d.slice(2, 7)} ${d.slice(7)}`
  if (d.length === 10) return `+91 ${d.slice(0, 5)} ${d.slice(5)}`
  return d ? `+${d}` : '—'
}
function relTime(iso) {
  if (!iso) return ''
  const s = (Date.now() - new Date(iso).getTime()) / 1000
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}
function msgTime(iso) {
  try {
    return new Date(iso).toLocaleTimeString('en-IN', {
      hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata',
    })
  } catch { return '' }
}
function windowOpen(expiresIso) {
  return !!expiresIso && new Date(expiresIso).getTime() > Date.now()
}

export default function CampaignInboxV2() {
  const navigate = useNavigate()
  const profile = useAuthStore((s) => s.profile)

  const [loading, setLoading] = useState(true)
  const [tablesMissing, setTablesMissing] = useState(false)
  const [threads, setThreads] = useState([])
  const [selId, setSelId] = useState(null)
  const [msgs, setMsgs] = useState([])
  const [msgLoading, setMsgLoading] = useState(false)

  const loadThreads = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('whatsapp_conversations')
      .select('id, customer_wa_id, status, last_inbound_at, window_expires_at, lead_id, assigned_to, campaign_id')
      .order('last_inbound_at', { ascending: false, nullsFirst: false })
      .limit(200)
    if (error) {
      if (/relation .* does not exist|could not find the table/i.test(error.message || '')) {
        setTablesMissing(true)
      } else {
        toastError(error, 'Could not load conversations.')
      }
      setLoading(false)
      return
    }
    setThreads(data || [])
    setLoading(false)
  }, [])

  const loadMsgs = useCallback(async (convId) => {
    if (!convId) { setMsgs([]); return }
    setMsgLoading(true)
    const { data, error } = await supabase
      .from('whatsapp_messages')
      .select('id, direction, type, body, status, at')
      .eq('conversation_id', convId)
      .order('at', { ascending: true })
      .limit(500)
    if (error) toastError(error, 'Could not load messages.')
    setMsgs(data || [])
    setMsgLoading(false)
  }, [])

  useEffect(() => { loadThreads() }, [loadThreads])
  useEffect(() => { loadMsgs(selId) }, [selId, loadMsgs])

  const sel = threads.find((t) => t.id === selId) || null

  // ─── tables-missing guard (C2 SQL not run) ──────────────────────────────
  if (tablesMissing) {
    return (
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '24px 20px 80px' }}>
        <Head onRefresh={loadThreads} navigate={navigate} />
        <div style={{
          marginTop: 16, padding: 16, borderRadius: 14,
          background: 'var(--v2-amber-soft, rgba(245,158,11,0.12))',
          border: '1px solid var(--v2-amber, #F59E0B)', color: 'var(--v2-ink-1, #c7d0e6)',
          display: 'flex', gap: 10, alignItems: 'flex-start',
        }}>
          <AlertTriangle size={18} strokeWidth={1.6} style={{ color: 'var(--v2-amber, #F59E0B)', flexShrink: 0, marginTop: 1 }} />
          <span style={{ fontSize: 13 }}>
            Campaign tables not found. Run <code>supabase_campaign_c2_foundation.sql</code> in Supabase Studio, then reload.
          </span>
        </div>
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '24px 20px 80px' }}>
      <Head onRefresh={loadThreads} navigate={navigate} />

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginTop: 16, alignItems: 'flex-start' }}>
        {/* ─── thread list ─── */}
        <div style={{
          flex: '1 1 300px', minWidth: 280, maxWidth: 360,
          background: 'var(--v2-bg-1)', border: '1px solid var(--v2-line)',
          borderRadius: 14, overflow: 'hidden',
        }}>
          <div style={{
            padding: '11px 14px', borderBottom: '1px solid var(--v2-line)',
            fontSize: 12, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase',
            color: 'var(--v2-ink-2, #6a7590)',
          }}>
            Conversations{threads.length ? ` · ${threads.length}` : ''}
          </div>

          {loading ? (
            <div style={{ padding: 28, display: 'flex', justifyContent: 'center' }}>
              <Loader2 size={20} strokeWidth={1.6} className="spin" style={{ color: 'var(--v2-yellow, #FFE600)' }} />
            </div>
          ) : threads.length === 0 ? (
            <div style={{ padding: '28px 18px', textAlign: 'center', color: 'var(--v2-ink-2, #6a7590)' }}>
              <MessageSquare size={22} strokeWidth={1.6} style={{ opacity: 0.5 }} />
              <p style={{ fontSize: 13, margin: '10px 0 0' }}>No conversations yet.</p>
              <p style={{ fontSize: 12, margin: '4px 0 0' }}>A WhatsApp message to your number appears here.</p>
            </div>
          ) : (
            <div style={{ maxHeight: 560, overflowY: 'auto' }}>
              {threads.map((t) => {
                const active = t.id === selId
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setSelId(t.id)}
                    style={{
                      width: '100%', textAlign: 'left', cursor: 'pointer',
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '11px 14px', border: 'none',
                      borderBottom: '1px solid var(--v2-line)',
                      background: active ? 'var(--v2-bg-2)' : 'transparent',
                    }}
                  >
                    <span style={{
                      width: 34, height: 34, borderRadius: 999, flexShrink: 0,
                      background: 'var(--v2-bg-2)', border: '1px solid var(--v2-line)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      <User size={16} strokeWidth={1.6} style={{ color: 'var(--v2-ink-2, #6a7590)' }} />
                    </span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{
                        display: 'block', fontSize: 13.5, fontWeight: 700, color: 'var(--v2-ink-0, #f5f7fb)',
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                      }}>
                        {fmtPhone(t.customer_wa_id)}
                      </span>
                      <span style={{ display: 'block', fontSize: 11.5, color: 'var(--v2-ink-2, #6a7590)', marginTop: 1 }}>
                        {relTime(t.last_inbound_at)}{t.lead_id ? ' · linked lead' : ''}
                      </span>
                    </span>
                    {windowOpen(t.window_expires_at) && (
                      <span title="24h reply window open" style={{
                        width: 8, height: 8, borderRadius: 999, flexShrink: 0,
                        background: 'var(--v2-green, #10B981)',
                      }} />
                    )}
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
          borderRadius: 14, display: 'flex', flexDirection: 'column', minHeight: 420,
        }}>
          {!sel ? (
            <div style={{
              flex: 1, display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center', padding: 30,
              color: 'var(--v2-ink-2, #6a7590)', textAlign: 'center',
            }}>
              <Inbox size={26} strokeWidth={1.6} style={{ opacity: 0.5 }} />
              <p style={{ fontSize: 13, margin: '10px 0 0' }}>Pick a conversation to read it.</p>
            </div>
          ) : (
            <>
              {/* conversation header */}
              <div style={{
                padding: '12px 16px', borderBottom: '1px solid var(--v2-line)',
                display: 'flex', alignItems: 'center', gap: 10,
              }}>
                <button
                  type="button"
                  onClick={() => setSelId(null)}
                  title="Back to list"
                  style={{
                    background: 'transparent', border: 'none', cursor: 'pointer',
                    color: 'var(--v2-ink-2, #6a7590)', display: 'flex', padding: 2,
                  }}
                >
                  <ArrowLeft size={18} strokeWidth={1.6} />
                </button>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 14, fontWeight: 700, color: 'var(--v2-ink-0, #f5f7fb)' }}>
                    {fmtPhone(sel.customer_wa_id)}
                  </span>
                  <span style={{ fontSize: 11.5, color: windowOpen(sel.window_expires_at) ? 'var(--v2-green, #10B981)' : 'var(--v2-ink-2, #6a7590)' }}>
                    {windowOpen(sel.window_expires_at) ? '24h reply window open' : 'window closed — needs a template to re-open'}
                  </span>
                </span>
                {sel.lead_id && (
                  <button
                    type="button"
                    onClick={() => navigate(`/leads/${sel.lead_id}`)}
                    style={{
                      fontSize: 12, fontWeight: 700, cursor: 'pointer',
                      background: 'var(--v2-bg-2)', color: 'var(--v2-ink-1, #c7d0e6)',
                      border: '1px solid var(--v2-line)', borderRadius: 10, padding: '6px 10px',
                    }}
                  >
                    Open lead
                  </button>
                )}
              </div>

              {/* messages */}
              <div style={{ flex: 1, overflowY: 'auto', padding: '14px 16px', maxHeight: 460 }}>
                {msgLoading ? (
                  <div style={{ display: 'flex', justifyContent: 'center', padding: 24 }}>
                    <Loader2 size={18} strokeWidth={1.6} className="spin" style={{ color: 'var(--v2-yellow, #FFE600)' }} />
                  </div>
                ) : msgs.length === 0 ? (
                  <p style={{ fontSize: 13, color: 'var(--v2-ink-2, #6a7590)', textAlign: 'center', margin: '24px 0' }}>
                    No messages in this conversation.
                  </p>
                ) : (
                  msgs.map((m) => {
                    const out = m.direction === 'out'
                    return (
                      <div key={m.id} style={{ display: 'flex', justifyContent: out ? 'flex-end' : 'flex-start', marginBottom: 8 }}>
                        <div style={{
                          maxWidth: '76%', padding: '8px 11px', borderRadius: 10,
                          background: out ? 'var(--v2-yellow, #FFE600)' : 'var(--v2-bg-2)',
                          color: out ? 'var(--accent-fg, #0f172a)' : 'var(--v2-ink-0, #f5f7fb)',
                          border: out ? 'none' : '1px solid var(--v2-line)',
                        }}>
                          <div style={{ fontSize: 13.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                            {m.body || <em style={{ opacity: 0.7 }}>[{m.type || 'media'}]</em>}
                          </div>
                          <div style={{
                            fontSize: 10, marginTop: 3, textAlign: 'right',
                            color: out ? 'var(--accent-fg, #0f172a)' : 'var(--v2-ink-2, #6a7590)',
                            opacity: out ? 0.65 : 1,
                          }}>
                            {msgTime(m.at)}
                          </div>
                        </div>
                      </div>
                    )
                  })
                )}
              </div>

              {/* composer — LOCKED until the token lands */}
              <div style={{
                padding: '12px 16px', borderTop: '1px solid var(--v2-line)',
                display: 'flex', alignItems: 'center', gap: 10,
                background: 'var(--v2-bg-2)',
              }}>
                <Lock size={16} strokeWidth={1.6} style={{ color: 'var(--v2-ink-2, #6a7590)', flexShrink: 0 }} />
                <span style={{ fontSize: 12.5, color: 'var(--v2-ink-2, #6a7590)' }}>
                  Replying needs the live number (edigiexpert token). Receiving + reading works now.
                </span>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function Head({ onRefresh, navigate }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
      <span style={{
        width: 40, height: 40, borderRadius: 14, flexShrink: 0,
        background: 'var(--v2-bg-2)', border: '1px solid var(--v2-line)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <Inbox size={20} strokeWidth={1.6} style={{ color: 'var(--v2-yellow, #FFE600)' }} />
      </span>
      <span style={{ flex: 1, minWidth: 180 }}>
        <h1 style={{ fontSize: 20, fontWeight: 800, margin: 0, color: 'var(--v2-ink-0, #f5f7fb)' }}>
          Campaign Inbox
        </h1>
        <p style={{ fontSize: 12.5, color: 'var(--v2-ink-2, #6a7590)', margin: '2px 0 0' }}>
          Incoming WhatsApp chats from your campaign number.
        </p>
      </span>
      <button
        type="button"
        onClick={() => navigate('/campaigns')}
        style={{
          fontSize: 13, fontWeight: 700, cursor: 'pointer',
          background: 'var(--v2-bg-2)', color: 'var(--v2-ink-1, #c7d0e6)',
          border: '1px solid var(--v2-line)', borderRadius: 10, padding: '8px 12px',
        }}
      >
        Campaigns
      </button>
      <button
        type="button"
        onClick={onRefresh}
        title="Refresh"
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          fontSize: 13, fontWeight: 700, cursor: 'pointer',
          background: 'var(--v2-bg-2)', color: 'var(--v2-ink-1, #c7d0e6)',
          border: '1px solid var(--v2-line)', borderRadius: 10, padding: '8px 12px',
        }}
      >
        <RefreshCw size={15} strokeWidth={1.6} />
        Refresh
      </button>
    </div>
  )
}
