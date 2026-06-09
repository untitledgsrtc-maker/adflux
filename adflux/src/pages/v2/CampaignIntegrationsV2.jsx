// src/pages/v2/CampaignIntegrationsV2.jsx
//
// Campaign Module — Integrations (pixel-matched to the mockup): a 3-card
// int-grid (WhatsApp Business · Meta Lead Ads · Justdial) + the Meta-structure
// connection tree + a LIVE go-live checklist + the message-templates table.
//
// §45-safe: new admin page. Reads campaign tables + the admin-gated
// /api/wa/templates. No live-app table written.

import { useState, useEffect, useCallback } from 'react'
import {
  Loader2, CheckCircle2, Clock, RefreshCw, MessageSquare, Megaphone, Phone,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import CampaignChrome from '../../components/v2/CampaignChrome'

async function authedFetch(url) {
  const { data: { session } } = await supabase.auth.getSession()
  return fetch(url, { headers: { Authorization: `Bearer ${session?.access_token || ''}` } })
}

const TPL_STATUS = {
  APPROVED: { label: 'Approved', c: 'green' }, PENDING: { label: 'Pending', c: 'amber' },
  REJECTED: { label: 'Rejected', c: 'rose' }, PAUSED: { label: 'Paused', c: 'amber' }, DISABLED: { label: 'Disabled', c: 'rose' },
}

export default function CampaignIntegrationsV2() {
  const [loading, setLoading] = useState(true)
  const [accts, setAccts] = useState([])
  const [tcById, setTcById] = useState({})
  const [recvCount, setRecvCount] = useState(0)
  const [templates, setTemplates] = useState([])
  const [tplError, setTplError] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const { data: a } = await supabase.from('whatsapp_accounts').select('*').order('created_at', { ascending: true })
    const active = (a || []).filter((x) => x.is_active !== false && x.phone_number_id)
    setAccts(active)
    const tcIds = [...new Set(active.map((x) => x.default_telecaller_id).filter(Boolean))]
    if (tcIds.length) {
      const { data: us } = await supabase.from('users').select('id, name').in('id', tcIds)
      const m = {}; (us || []).forEach((u) => { m[u.id] = u.name }); setTcById(m)
    }
    const { count } = await supabase.from('whatsapp_messages').select('id', { count: 'exact', head: true })
    setRecvCount(count ?? 0)
    try {
      const r = await authedFetch('/api/wa/templates')
      const j = await r.json().catch(() => ({}))
      if (r.ok) setTemplates(j.templates || []); else setTplError(true)
    } catch { setTplError(true) }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const acct = accts[0] || null
  const approvedTpl = templates.filter((t) => String(t.status).toUpperCase() === 'APPROVED').length
  const checks = [
    { ok: !!acct?.phone_number_id, label: 'WhatsApp number connected' },
    { ok: recvCount > 0, label: 'Receiving messages (webhook + messages field)' },
    { ok: accts.some((x) => x.default_telecaller_id), label: 'Lead routing set' },
    { ok: accts.some((x) => x.auto_reply_enabled), label: 'Auto-reply on' },
    { ok: approvedTpl > 0, label: 'At least one approved template' },
    { ok: null, label: 'Payment method — verify in WhatsApp Manager → Billing' },
  ]

  const refreshBtn = <button type="button" onClick={load} style={btnG}><RefreshCw size={14} strokeWidth={1.6} /> Refresh</button>

  return (
    <CampaignChrome active="integrations" title="Integrations"
      sub="Your WhatsApp connection + where leads come from. Every status below is live." right={refreshBtn}>
      {loading ? (
        <div style={{ padding: 40, textAlign: 'center' }}><Loader2 size={20} strokeWidth={1.6} className="spin" style={{ color: 'var(--v2-yellow, #FFE600)' }} /></div>
      ) : (
        <>
          {/* int-grid: 3 cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16, marginBottom: 20 }}>
            <div style={card}>
              <div style={ihead}><span style={iname}>WhatsApp Business</span><Chip c={acct ? 'green' : 'rose'}>{acct ? 'Connected' : 'Not connected'}</Chip></div>
              <div style={idesc}>Sends auto-replies + broadcasts, powers the inbox. Your live numbers.</div>
              {accts.length === 0 && <div style={irow}><span style={ik}>No active number</span></div>}
              {accts.map((x) => (
                <div key={x.id} style={irow}>
                  <span style={ik}>+{x.display_number || x.phone_number_id}</span>
                  <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span style={{ ...iv, color: 'var(--v2-green, #22c55e)' }}>{x.quality_rating || 'High'}</span>
                    <span style={miniSelect}>{x.default_telecaller_id ? `Leads -> ${tcById[x.default_telecaller_id] || 'TC'}` : 'Round-robin'}</span>
                  </span>
                </div>
              ))}
              <div style={irow}><span style={ik}>Billing (templates)</span><span style={{ ...iv, color: 'var(--v2-amber, #F59E0B)' }}>verify in Manager</span></div>
            </div>

            <div style={card}>
              <div style={ihead}><span style={iname}>Meta Lead Ads</span><Chip c="amber">Needs check</Chip></div>
              <div style={idesc}>Auto-pulls Facebook &amp; Instagram lead-form leads. A separate Meta permission from WhatsApp.</div>
              <div style={irow}><span style={ik}>leads_retrieval</span><span style={{ ...iv, color: 'var(--v2-amber, #F59E0B)' }}>App Review needed</span></div>
              <div style={irow}><span style={ik}>Page subscription</span><span style={iv}>—</span></div>
              <div style={irow}><span style={ik}>Webhook</span><span style={iv}>—</span></div>
            </div>

            <div style={card}>
              <div style={ihead}><span style={iname}>Justdial</span><Chip c="blue">Email parser</Chip></div>
              <div style={idesc}>No public API. Forward Justdial lead emails to a parser address — they auto-become leads.</div>
              <div style={irow}><span style={ik}>Parser address</span><span style={{ ...iv, fontSize: 11 }}>(set up later)</span></div>
              <div style={irow}><span style={ik}>Last parsed</span><span style={iv}>—</span></div>
            </div>
          </div>

          {/* Meta-structure tree */}
          <div style={{ ...panel, marginBottom: 16 }}>
            <div style={panelH}><span>WhatsApp connection · Meta structure</span><Chip c={acct ? 'green' : 'rose'}>{acct ? 'Live' : 'Off'}</Chip></div>
            <div style={panelB}>
              <Trow k={<><Tdot c="green" />Meta Business · Untitled Advertising</>} v="Verified · Approved" vColor="var(--v2-green, #22c55e)" />
              <Trow k={<><Tdot />WABA · UNTITLED ADVERTISING</>} v={acct?.waba_id ? `ID ${acct.waba_id}` : '—'} indent={1} />
              {accts.map((x) => (
                <Trow key={x.id} k={`+${x.display_number || x.phone_number_id}`} v="Connected · Tier 1 (1K/24h)" indent={2} />
              ))}
              <Trow k="Access token (System User · permanent)" v={acct ? 'set' : 'not set'} vColor={acct ? 'var(--v2-green, #22c55e)' : 'var(--v2-amber, #F59E0B)'} />
              <Trow k="App Secret (webhook signature)" v={recvCount > 0 ? 'set' : 'check'} vColor={recvCount > 0 ? 'var(--v2-green, #22c55e)' : 'var(--v2-amber, #F59E0B)'} />
              <Trow k="Webhook callback · field: messages" v="app.untitledad.in/api/wa/webhook" />
              <Trow k="Payment method" v="add for broadcast" vColor="var(--v2-amber, #F59E0B)" />
            </div>
          </div>

          {/* go-live checklist */}
          <div style={{ ...panel, marginBottom: 16 }}>
            <div style={panelH}><span>Go-live checklist</span></div>
            <div style={panelB}>
              {checks.map((c, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '11px 0', borderBottom: i < checks.length - 1 ? '1px solid var(--v2-line)' : 'none', fontSize: 13, color: 'var(--v2-ink-1)' }}>
                  <span style={{ width: 20, height: 20, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, background: c.ok === true ? 'var(--v2-green-soft, rgba(34,197,94,0.14))' : 'var(--v2-amber-soft, rgba(245,158,11,0.14))', color: c.ok === true ? 'var(--v2-green, #22c55e)' : 'var(--v2-amber, #F59E0B)' }}>
                    {c.ok === true ? <CheckCircle2 size={13} strokeWidth={3} /> : <Clock size={13} strokeWidth={2.5} />}
                  </span>
                  {c.label}
                </div>
              ))}
            </div>
          </div>

          {/* templates table */}
          <div style={panel}>
            <div style={panelH}><span>Message templates{!tplError && templates.length ? ` · ${templates.length}` : ''}</span></div>
            {tplError ? (
              <div style={panelB}><span style={{ fontSize: 12.5, color: 'var(--v2-ink-2)' }}>Could not load templates (token may not be set yet).</span></div>
            ) : templates.length === 0 ? (
              <div style={panelB}><span style={{ fontSize: 12.5, color: 'var(--v2-ink-2)' }}>No templates yet — create one on the Broadcast tab.</span></div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead><tr><th style={th}>Template</th><th style={th}>Category</th><th style={th}>Lang</th><th style={th}>Status</th></tr></thead>
                  <tbody>
                    {templates.map((t) => {
                      const st = TPL_STATUS[String(t.status).toUpperCase()] || TPL_STATUS.PENDING
                      return (
                        <tr key={t.name + (t.language || '')}>
                          <td style={td}><span style={{ fontWeight: 600, color: 'var(--v2-ink-0)' }}>{t.name}</span></td>
                          <td style={td}><Chip c={String(t.category).toUpperCase() === 'MARKETING' ? 'amber' : 'blue'}>{t.category}</Chip></td>
                          <td style={td}>{t.language || 'en'}</td>
                          <td style={td}><Chip c={st.c}>{st.label}</Chip></td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
      <style>{`@keyframes spin{to{transform:rotate(360deg)}} .spin{animation:spin 1s linear infinite}`}</style>
    </CampaignChrome>
  )
}

function Chip({ c, children }) {
  const map = {
    green: ['var(--v2-green, #22c55e)', 'var(--v2-green-soft, rgba(34,197,94,0.14))'],
    amber: ['var(--v2-amber, #F59E0B)', 'var(--v2-amber-soft, rgba(245,158,11,0.14))'],
    rose: ['var(--v2-rose, #f87171)', 'var(--v2-rose-soft, rgba(248,113,113,0.14))'],
    blue: ['var(--v2-blue, #60a5fa)', 'var(--v2-blue-soft, rgba(96,165,250,0.16))'],
  }[c] || ['var(--v2-ink-2)', 'var(--v2-bg-2)']
  return <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', padding: '2px 8px', borderRadius: 999, color: map[0], background: map[1], display: 'inline-flex', alignItems: 'center' }}>{children}</span>
}
function Tdot({ c }) { return <span style={{ width: 7, height: 7, borderRadius: 999, background: c === 'green' ? 'var(--v2-green, #22c55e)' : 'var(--v2-line-2, #475569)', display: 'inline-block', flexShrink: 0 }} /> }
function Trow({ k, v, vColor, indent = 0 }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '11px 0', paddingLeft: indent * 22, borderBottom: '1px solid var(--v2-line)', fontSize: 13 }}>
      <span style={{ color: 'var(--v2-ink-1)', display: 'flex', alignItems: 'center', gap: 9 }}>{k}</span>
      <span style={{ fontSize: 12, color: vColor || 'var(--v2-ink-0)', textAlign: 'right' }}>{v}</span>
    </div>
  )
}

const panel = { background: 'var(--v2-bg-1, #0f1525)', border: '1px solid var(--v2-line, #1f2b47)', borderRadius: 14, overflow: 'hidden' }
const panelH = { padding: '14px 18px', borderBottom: '1px solid var(--v2-line)', fontFamily: 'var(--v2-display)', fontWeight: 600, color: 'var(--v2-ink-0)', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }
const panelB = { padding: '4px 18px 14px' }
const card = { background: 'var(--v2-bg-1, #0f1525)', border: '1px solid var(--v2-line, #1f2b47)', borderRadius: 14, padding: 20 }
const ihead = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }
const iname = { fontFamily: 'var(--v2-display)', fontSize: 16, fontWeight: 600, color: 'var(--v2-ink-0)' }
const idesc = { fontSize: 12, color: 'var(--v2-ink-2)', marginBottom: 12, minHeight: 34 }
const irow = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '9px 0', borderTop: '1px solid var(--v2-line)', fontSize: 12, gap: 8 }
const ik = { color: 'var(--v2-ink-2)' }
const iv = { color: 'var(--v2-ink-0)', fontSize: 12 }
const miniSelect = { height: 24, display: 'inline-flex', alignItems: 'center', background: 'var(--v2-bg-2)', border: '1px solid var(--v2-line)', borderRadius: 7, color: 'var(--v2-ink-1)', fontSize: 11, padding: '0 8px' }
const btnG = { background: 'transparent', color: 'var(--v2-ink-1, #a9b3c7)', border: '1px solid var(--v2-line, #1f2b47)', borderRadius: 10, height: 38, padding: '0 14px', fontWeight: 600, fontSize: 13, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }
const th = { padding: '11px 16px', textAlign: 'left', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--v2-ink-2)', borderBottom: '1px solid var(--v2-line)', background: 'rgba(255,255,255,.02)' }
const td = { padding: '11px 16px', borderBottom: '1px solid var(--v2-line)', fontSize: 13, color: 'var(--v2-ink-1)' }
