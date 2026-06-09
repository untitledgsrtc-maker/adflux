// src/pages/v2/CampaignIntegrationsV2.jsx
//
// Campaign Module — Integrations tab (mockup parity). Shows the live WhatsApp
// connection + a REAL go-live checklist (each item is a computed check, not a
// fake tick) + the lead-source cards (WhatsApp connected · Meta Lead Ads needs
// Meta App Review · Justdial email-parser later).
//
// §45-safe: new admin page. Reads campaign tables + a head-count on
// whatsapp_messages + the admin-gated /api/wa/templates. No live-app table
// written, no hot path touched.

import { useState, useEffect, useCallback } from 'react'
import {
  Loader2, CheckCircle2, XCircle, AlertTriangle, RefreshCw, MessageSquare,
  Megaphone, Phone, Wifi, CreditCard, UserCheck, FileCheck2, Zap,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import CampaignChrome from '../../components/v2/CampaignChrome'

async function authedFetch(url) {
  const { data: { session } } = await supabase.auth.getSession()
  return fetch(url, { headers: { Authorization: `Bearer ${session?.access_token || ''}` } })
}

export default function CampaignIntegrationsV2() {
  const [loading, setLoading] = useState(true)
  const [acct, setAcct] = useState(null)
  const [tcName, setTcName] = useState(null)
  const [recvCount, setRecvCount] = useState(0)
  const [approvedTpl, setApprovedTpl] = useState(0)
  const [tplError, setTplError] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    // active campaign account
    const { data: a } = await supabase.from('whatsapp_accounts')
      .select('*').eq('is_active', true).order('created_at', { ascending: true }).limit(1).maybeSingle()
    setAcct(a || null)
    if (a?.default_telecaller_id) {
      const { data: u } = await supabase.from('users').select('name').eq('id', a.default_telecaller_id).maybeSingle()
      setTcName(u?.name || null)
    } else { setTcName(null) }

    // receiving? any stored inbound message
    const { count } = await supabase.from('whatsapp_messages').select('id', { count: 'exact', head: true })
    setRecvCount(count ?? 0)

    // approved templates (admin-gated endpoint)
    try {
      const r = await authedFetch('/api/wa/templates')
      const j = await r.json().catch(() => ({}))
      if (r.ok) setApprovedTpl((j.templates || []).filter((t) => String(t.status).toUpperCase() === 'APPROVED').length)
      else setTplError(true)
    } catch { setTplError(true) }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const checks = [
    { key: 'number', label: 'WhatsApp number connected', ok: !!acct?.phone_number_id, Icon: Phone,
      hint: acct?.display_number ? `+${acct.display_number}` : 'No active number' },
    { key: 'recv', label: 'Receiving messages', ok: recvCount > 0, Icon: Wifi,
      hint: recvCount > 0 ? `${recvCount} stored` : 'No inbound yet — check the "messages" webhook field' },
    { key: 'route', label: 'Lead routing set', ok: !!acct?.default_telecaller_id, Icon: UserCheck,
      hint: tcName ? `Routes to ${tcName}` : 'No telecaller set — leads will queue for review' },
    { key: 'autoreply', label: 'Auto-reply on', ok: !!acct?.auto_reply_enabled, Icon: Zap,
      hint: acct?.auto_reply_enabled ? 'Instant ack on first message' : 'Off (optional)' },
    { key: 'template', label: 'Approved template (for broadcast)', ok: approvedTpl > 0, Icon: FileCheck2,
      hint: tplError ? 'Could not check' : approvedTpl > 0 ? `${approvedTpl} approved` : 'Create one in Broadcast' },
    { key: 'pay', label: 'Payment method', ok: null, Icon: CreditCard,
      hint: 'Verify in WhatsApp Manager → Billing (needed for broadcast volume)' },
  ]
  const done = checks.filter((c) => c.ok === true).length
  const gateable = checks.filter((c) => c.ok !== null).length

  return (
    <CampaignChrome
      active="integrations"
      title="Integrations"
      sub="Your WhatsApp connection health + where leads come from. Each check below is live — not a fixed tick."
      right={<button type="button" onClick={load} style={btnG}><RefreshCw size={14} strokeWidth={1.6} /> Refresh</button>}
    >
      {loading ? (
        <div style={{ padding: 40, textAlign: 'center' }}><Loader2 size={20} strokeWidth={1.6} className="spin" style={{ color: 'var(--v2-yellow, #FFE600)' }} /></div>
      ) : (
        <>
          {/* connection card */}
          <div style={{ ...panel, marginBottom: 18 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
              <span style={{ width: 42, height: 42, borderRadius: 12, background: 'var(--v2-green-soft, rgba(34,197,94,0.14))', color: 'var(--v2-green, #22c55e)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <MessageSquare size={22} strokeWidth={1.6} />
              </span>
              <div>
                <div style={{ fontFamily: 'var(--v2-display)', fontWeight: 700, fontSize: 16, color: 'var(--v2-ink-0)' }}>
                  WhatsApp Business {acct?.phone_number_id ? <span style={pillGreen}>Connected</span> : <span style={pillRose}>Not connected</span>}
                </div>
                <div style={{ fontSize: 12.5, color: 'var(--v2-ink-2)', marginTop: 2 }}>
                  {acct?.display_number ? `+${acct.display_number}` : '—'} {acct?.waba_id ? `· WABA ${acct.waba_id}` : ''}
                </div>
              </div>
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--v2-ink-1)' }}>
              Routing: {tcName ? <b style={{ color: 'var(--v2-ink-0)' }}>{tcName}</b> : <span style={{ color: 'var(--v2-amber, #F59E0B)' }}>not set</span>}
            </div>
          </div>

          {/* go-live checklist */}
          <div style={{ ...panel, marginBottom: 18, padding: 0 }}>
            <div style={{ padding: '13px 18px', borderBottom: '1px solid var(--v2-line)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontFamily: 'var(--v2-display)', fontWeight: 600, color: 'var(--v2-ink-0)', fontSize: 14 }}>Go-live checklist</span>
              <span style={{ fontFamily: 'var(--v2-display)', fontWeight: 700, color: done >= gateable ? 'var(--v2-green, #22c55e)' : 'var(--v2-amber, #F59E0B)' }}>{done}/{gateable}</span>
            </div>
            {checks.map((c) => (
              <div key={c.key} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 18px', borderBottom: '1px solid var(--v2-line)' }}>
                <span style={{ color: c.ok === true ? 'var(--v2-green, #22c55e)' : c.ok === false ? 'var(--v2-rose, #f87171)' : 'var(--v2-ink-2)', flexShrink: 0 }}>
                  {c.ok === true ? <CheckCircle2 size={20} strokeWidth={1.7} /> : c.ok === false ? <XCircle size={20} strokeWidth={1.7} /> : <AlertTriangle size={18} strokeWidth={1.7} />}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--v2-ink-0)' }}>{c.label}</div>
                  <div style={{ fontSize: 11.5, color: 'var(--v2-ink-2)', marginTop: 1 }}>{c.hint}</div>
                </div>
                <c.Icon size={16} strokeWidth={1.6} style={{ color: 'var(--v2-ink-2)', flexShrink: 0 }} />
              </div>
            ))}
          </div>

          {/* lead sources */}
          <div style={{ fontFamily: 'var(--v2-display)', fontWeight: 600, color: 'var(--v2-ink-0)', fontSize: 14, margin: '0 0 12px' }}>Lead sources</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 14 }}>
            <SourceCard Icon={MessageSquare} title="WhatsApp" status={acct?.phone_number_id ? 'live' : 'off'}
              line={acct?.phone_number_id ? 'Inbound chats become leads in the telecaller queue.' : 'Connect a number to start.'} />
            <SourceCard Icon={Megaphone} title="Meta Lead Ads" status="blocked"
              line="Auto-pull Facebook / Instagram form leads. Needs Meta App Review (leads_retrieval) — a separate approval (~weeks)." />
            <SourceCard Icon={Phone} title="Justdial" status="soon"
              line="Auto-capture Justdial enquiries via an email parser. Forwarding setup comes in a later sprint." />
          </div>
        </>
      )}

      <style>{`@keyframes spin{to{transform:rotate(360deg)}} .spin{animation:spin 1s linear infinite}`}</style>
    </CampaignChrome>
  )
}

function SourceCard({ Icon, title, status, line }) {
  const map = {
    live:    { label: 'Live',           color: 'var(--v2-green, #22c55e)', bg: 'var(--v2-green-soft, rgba(34,197,94,0.14))' },
    off:     { label: 'Not connected',  color: 'var(--v2-ink-2, #6a7590)', bg: 'var(--v2-bg-2, #1a2742)' },
    blocked: { label: 'Needs approval', color: 'var(--v2-amber, #F59E0B)', bg: 'var(--v2-amber-soft, rgba(245,158,11,0.14))' },
    soon:    { label: 'Soon',           color: 'var(--v2-ink-2, #6a7590)', bg: 'var(--v2-bg-2, #1a2742)' },
  }[status] || {}
  return (
    <div style={panel}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 8 }}>
        <Icon size={18} strokeWidth={1.6} style={{ color: 'var(--v2-ink-1)' }} />
        <span style={{ fontWeight: 700, color: 'var(--v2-ink-0)', fontFamily: 'var(--v2-display)' }}>{title}</span>
        <span style={{ marginLeft: 'auto', fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', padding: '2px 8px', borderRadius: 999, color: map.color, background: map.bg }}>{map.label}</span>
      </div>
      <div style={{ fontSize: 12, color: 'var(--v2-ink-2)', lineHeight: 1.55 }}>{line}</div>
    </div>
  )
}

const panel = { background: 'var(--v2-bg-1, #0f1525)', border: '1px solid var(--v2-line, #1f2b47)', borderRadius: 14, padding: 18 }
const btnG = { background: 'transparent', color: 'var(--v2-ink-1, #a9b3c7)', border: '1px solid var(--v2-line, #1f2b47)', borderRadius: 10, height: 38, padding: '0 14px', fontWeight: 600, fontSize: 13, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }
const pillGreen = { fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', padding: '2px 8px', borderRadius: 999, color: 'var(--v2-green, #22c55e)', background: 'var(--v2-green-soft, rgba(34,197,94,0.14))', marginLeft: 8, verticalAlign: 'middle' }
const pillRose = { fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', padding: '2px 8px', borderRadius: 999, color: 'var(--v2-rose, #f87171)', background: 'var(--v2-rose-soft, rgba(248,113,113,0.14))', marginLeft: 8, verticalAlign: 'middle' }
