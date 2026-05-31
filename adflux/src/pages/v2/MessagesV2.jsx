// src/pages/v2/MessagesV2.jsx
//
// Phase 103.F (2026-05-31) — rep's saved admin messages.
//
// The admin composes a push from the Team Dashboard (Phase 103.E). That
// push now also writes an `admin_messages` row (Phase 103.F SQL), so the
// message persists instead of vanishing from the phone tray. The push
// `data.url` points here, so tapping the notification lands on this
// list. The bell (NotificationPanel) also surfaces unread ones.
//
// Behaviour:
//   • Loads this rep's messages, newest first.
//   • Marks everything read on open (clears the bell badge) — but keeps
//     the just-loaded unread dots visible for this view (we don't
//     re-fetch after marking).
//   • Realtime: a new message inserted while the page is open prepends
//     live (admin_messages is in the supabase_realtime publication).
//   • Loading / empty / error states all designed (UI checklist §6).
//
// Any authenticated user can have messages; the page is mounted behind
// RequireAuth in App.jsx.

import { useCallback, useEffect, useRef, useState } from 'react'
import { Inbox, Loader2, AlertCircle, RefreshCw, BellRing } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/authStore'
import { formatRelative } from '../../utils/formatters'

export default function MessagesV2() {
  const profile = useAuthStore(s => s.profile)
  const [rows, setRows]       = useState(null)   // null = loading
  const [error, setError]     = useState(null)
  const markedRef = useRef(false)

  const load = useCallback(async () => {
    if (!profile?.id) return
    setError(null)
    const { data, error: err } = await supabase
      .from('admin_messages')
      .select('id, title, body, created_at, read_at, sender:sender_id(name)')
      .eq('recipient_id', profile.id)
      .order('created_at', { ascending: false })
      .limit(100)
    if (err) {
      setError(err.message || 'Could not load messages.')
      setRows([])
      return
    }
    setRows(data || [])

    // Mark unread as read once (clears the bell badge). Background — we
    // do NOT re-fetch, so the dots stay visible for this view.
    if (!markedRef.current && (data || []).some(m => !m.read_at)) {
      markedRef.current = true
      supabase.from('admin_messages')
        .update({ read_at: new Date().toISOString() })
        .eq('recipient_id', profile.id)
        .is('read_at', null)
        .then(() => {}, () => {})
    }
  }, [profile?.id])

  useEffect(() => { load() }, [load])

  // Realtime — prepend a message that arrives while the page is open.
  useEffect(() => {
    if (!profile?.id) return
    const ch = supabase
      .channel('admin_messages_self')
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'admin_messages',
        filter: `recipient_id=eq.${profile.id}`,
      }, (payload) => {
        setRows(prev => prev ? [payload.new, ...prev] : [payload.new])
      })
      .subscribe()
    return () => { try { supabase.removeChannel(ch) } catch { /* */ } }
  }, [profile?.id])

  return (
    <div className="lead-root">
      <div className="lead-page-head">
        <div>
          <div className="lead-page-eyebrow">Notifications</div>
          <div className="lead-page-title">Messages</div>
        </div>
      </div>

      {/* Loading */}
      {rows === null && (
        <div className="lead-card" style={centerBox}>
          <Loader2 size={22} strokeWidth={1.6} style={{ animation: 'spin 1s linear infinite', color: 'var(--v2-ink-2, #94a3b8)' }} />
          <span style={{ color: 'var(--v2-ink-2, #94a3b8)', fontSize: 14 }}>Loading messages…</span>
        </div>
      )}

      {/* Error */}
      {rows !== null && error && (
        <div className="lead-card" style={{ ...centerBox, border: '1px solid var(--danger, #EF4444)' }}>
          <AlertCircle size={22} strokeWidth={1.6} style={{ color: 'var(--danger, #EF4444)' }} />
          <span style={{ color: 'var(--danger, #EF4444)', fontSize: 14, textAlign: 'center' }}>{error}</span>
          <button onClick={load} style={retryBtn}>
            <RefreshCw size={14} strokeWidth={1.6} /> Retry
          </button>
        </div>
      )}

      {/* Empty */}
      {rows !== null && !error && rows.length === 0 && (
        <div className="lead-card" style={centerBox}>
          <span style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: 48, height: 48, borderRadius: 14,
            background: 'var(--v2-bg-2, #334155)', color: 'var(--v2-ink-2, #94a3b8)',
          }}>
            <Inbox size={22} strokeWidth={1.6} />
          </span>
          <span style={{ color: 'var(--v2-ink-1, #cbd5e1)', fontSize: 15, fontWeight: 600 }}>No messages yet</span>
          <span style={{ color: 'var(--v2-ink-2, #94a3b8)', fontSize: 13, textAlign: 'center' }}>
            Messages from the office will appear here.
          </span>
        </div>
      )}

      {/* List */}
      {rows !== null && !error && rows.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {rows.map(m => {
            const unread = !m.read_at
            return (
              <div key={m.id} className="lead-card" style={{
                padding: 14,
                borderLeft: `3px solid ${unread ? 'var(--v2-yellow, #FFE600)' : 'var(--v2-line, #334155)'}`,
              }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                  <span style={{
                    flexShrink: 0,
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    width: 34, height: 34, borderRadius: 10,
                    background: 'var(--accent-soft, rgba(255,230,0,0.14))',
                    color: 'var(--v2-yellow, #FFE600)',
                  }}>
                    <BellRing size={16} strokeWidth={1.6} />
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--v2-ink-0, #f1f5f9)' }}>
                        {m.title}
                      </span>
                      {unread && (
                        <span style={{
                          width: 7, height: 7, borderRadius: 999,
                          background: 'var(--v2-yellow, #FFE600)', flexShrink: 0,
                        }} />
                      )}
                    </div>
                    {m.body && (
                      <div style={{ marginTop: 4, fontSize: 14, lineHeight: 1.5, color: 'var(--v2-ink-1, #cbd5e1)', whiteSpace: 'pre-wrap' }}>
                        {m.body}
                      </div>
                    )}
                    <div style={{ marginTop: 8, fontSize: 12, color: 'var(--v2-ink-2, #64748b)' }}>
                      {m.sender?.name ? `From ${m.sender.name}` : 'From the office'}
                      {' · '}
                      {formatRelative(m.created_at)}
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

const centerBox = {
  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
  gap: 12, padding: '48px 20px', textAlign: 'center',
}

const retryBtn = {
  display: 'inline-flex', alignItems: 'center', gap: 6,
  padding: '8px 16px', borderRadius: 10,
  border: '1px solid var(--v2-line, #334155)', background: 'transparent',
  color: 'var(--v2-ink-1, #cbd5e1)', fontSize: 13, fontWeight: 600, cursor: 'pointer',
}
