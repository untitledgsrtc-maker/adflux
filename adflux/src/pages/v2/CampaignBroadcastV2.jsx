// src/pages/v2/CampaignBroadcastV2.jsx
//
// Campaign Module — Broadcast. STEP 1 (this build): manage Meta message
// templates from INSIDE the app (create + submit + see approval status) — no
// business.facebook.com needed. STEP 2 (next): pick an approved template + a
// saved segment and send.
//
// §45-safe: new admin page (RequirePrivileged). Talks to api/wa/templates
// (admin-gated; the token stays server-side). No live-app table touched.

import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Loader2, AlertTriangle, RefreshCw, Plus, CheckCircle2, Clock, XCircle, FileText, Send,
  Megaphone, Users, FlaskConical,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import CampaignChrome from '../../components/v2/CampaignChrome'
import { toastError, toastSuccess } from '../../components/v2/Toast'
import { confirmDialog } from '../../components/v2/ConfirmDialog'

async function authedFetch(url, opts = {}) {
  const { data: { session } } = await supabase.auth.getSession()
  const jwt = session?.access_token
  return fetch(url, {
    ...opts,
    headers: { ...(opts.headers || {}), Authorization: `Bearer ${jwt || ''}` },
  })
}

const STATUS = {
  APPROVED: { label: 'Approved', color: 'var(--v2-green, #22c55e)', bg: 'var(--v2-green-soft, rgba(34,197,94,0.14))', Icon: CheckCircle2 },
  PENDING:  { label: 'Pending',  color: 'var(--v2-amber, #F59E0B)', bg: 'var(--v2-amber-soft, rgba(245,158,11,0.14))', Icon: Clock },
  IN_APPEAL:{ label: 'In appeal',color: 'var(--v2-amber, #F59E0B)', bg: 'var(--v2-amber-soft, rgba(245,158,11,0.14))', Icon: Clock },
  REJECTED: { label: 'Rejected', color: 'var(--v2-rose, #f87171)',  bg: 'var(--v2-rose-soft, rgba(248,113,113,0.14))', Icon: XCircle },
  PAUSED:   { label: 'Paused',   color: 'var(--v2-ink-2, #6a7590)', bg: 'var(--v2-bg-2, #1a2742)', Icon: Clock },
  DISABLED: { label: 'Disabled', color: 'var(--v2-rose, #f87171)',  bg: 'var(--v2-rose-soft, rgba(248,113,113,0.14))', Icon: XCircle },
}
function statusOf(s) { return STATUS[String(s || '').toUpperCase()] || STATUS.PENDING }
function bodyOf(t) {
  const b = (t.components || []).find((c) => String(c.type).toUpperCase() === 'BODY')
  return b?.text || ''
}
function fmtWhen(iso) {
  try { return new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) } catch { return '' }
}

const DEFAULT_BODY = 'Hi {{1}}, this is Untitled Advertising. We have new outdoor advertising availability — hoardings, LED, bus media — in your area. If you would like the current rate card, reply here or call us.'

export default function CampaignBroadcastV2() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [templates, setTemplates] = useState([])

  const [showForm, setShowForm] = useState(false)
  const [name, setName] = useState('')
  const [category, setCategory] = useState('MARKETING')
  const [bodyText, setBodyText] = useState(DEFAULT_BODY)
  const [example, setExample] = useState('Rajesh')
  const [submitting, setSubmitting] = useState(false)
  // Phase 199 — media header (image/video/document). headerFormat is for the
  // CREATE form (sample); bcMediaFile is the actual creative sent on a broadcast.
  const [headerFormat, setHeaderFormat] = useState('')      // '' | IMAGE | VIDEO | DOCUMENT
  const [headerFile, setHeaderFile] = useState(null)        // sample file for template create
  const [bcMediaFile, setBcMediaFile] = useState(null)      // creative for the broadcast/test send
  const submitRef = useRef(false)

  // broadcast composer
  const [segments, setSegments] = useState([])
  const [broadcasts, setBroadcasts] = useState([])
  const [segId, setSegId] = useState('')
  const [tplName, setTplName] = useState('')
  const [testTo, setTestTo] = useState('')
  const [testing, setTesting] = useState(false)
  const [sending, setSending] = useState(false)
  const [progress, setProgress] = useState(null)   // { total, remaining }
  const sendRef = useRef(false)

  // selected-broadcast funnel + billing strip
  const [selBcId, setSelBcId] = useState(null)
  const [selData, setSelData] = useState(null)     // { broadcast, funnel }
  const [sentMonth, setSentMonth] = useState(0)

  const loadAux = useCallback(async () => {
    const { data: segs } = await supabase.from('campaign_segments')
      .select('id, name, contact_count').order('created_at', { ascending: false })
    setSegments(segs || [])
    try {
      const r = await authedFetch('/api/wa/broadcast')
      const j = await r.json().catch(() => ({}))
      if (r.ok) {
        const list = j.broadcasts || []
        setBroadcasts(list)
        if (list.length) setSelBcId((prev) => prev || list[0].id)   // default = latest
      }
    } catch { /* list is decorative */ }
    // billing strip — messages actually sent this month
    const ms = new Date(); ms.setDate(1); ms.setHours(0, 0, 0, 0)
    const { count: sm } = await supabase.from('broadcast_recipients')
      .select('id', { count: 'exact', head: true })
      .in('status', ['sent', 'delivered', 'read']).gte('sent_at', ms.toISOString())
    setSentMonth(sm || 0)
  }, [])

  // load the selected broadcast's funnel
  useEffect(() => {
    if (!selBcId) { setSelData(null); return }
    let alive = true
    ;(async () => {
      try {
        const r = await authedFetch(`/api/wa/broadcast?id=${selBcId}`)
        const j = await r.json().catch(() => ({}))
        if (alive && r.ok) setSelData(j)
      } catch { /* */ }
    })()
    return () => { alive = false }
  }, [selBcId])

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const r = await authedFetch('/api/wa/templates')
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { setError(j?.detail || j?.error || `Could not load templates (${r.status})`); setTemplates([]) }
      else setTemplates(j.templates || [])
    } catch (e) {
      setError(String(e?.message || e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load(); loadAux() }, [load, loadAux])

  // Phase 199 — upload a file to the campaign-media bucket, return its public URL.
  async function uploadToCampaignMedia(file) {
    const ext = ((file.name.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '')) || 'bin'
    const path = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
    const { error } = await supabase.storage.from('campaign-media').upload(path, file, { upsert: false, contentType: file.type || undefined })
    if (error) throw error
    return supabase.storage.from('campaign-media').getPublicUrl(path).data.publicUrl
  }
  // Meta template header format (image|video|document) or '' — read from components.
  function headerFmtOf(t) {
    const h = (t?.components || []).find((c) => String(c.type).toUpperCase() === 'HEADER')
    const f = String(h?.format || '').toUpperCase()
    return ['IMAGE', 'VIDEO', 'DOCUMENT'].includes(f) ? f.toLowerCase() : ''
  }

  async function submit() {
    const nm = name.trim()
    if (!nm) { toastError(new Error('name'), 'Name the template (lowercase, no spaces).'); return }
    if (!bodyText.trim()) { toastError(new Error('body'), 'Write the message body.'); return }
    if (headerFormat && !headerFile) { toastError(new Error('sample'), 'Attach a sample file for the header.'); return }
    if (submitRef.current || submitting) return
    submitRef.current = true; setSubmitting(true)
    try {
      // Phase 199 — media header: upload the sample to Meta first → header_handle.
      let header_format = '', header_handle = ''
      if (headerFormat) {
        const url = await uploadToCampaignMedia(headerFile)
        const sr = await authedFetch('/api/wa/media-sample', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ media_url: url, mime_type: headerFile.type }),
        })
        const sj = await sr.json().catch(() => ({}))
        if (!sr.ok || !sj.header_handle) { toastError(new Error(sj?.detail || sj?.error || 'upload'), 'Sample upload to Meta failed.'); return }
        header_format = headerFormat; header_handle = sj.header_handle
      }
      const r = await authedFetch('/api/wa/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: nm, category, body_text: bodyText.trim(), example: example.trim() || 'Rajesh', header_format, header_handle }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { toastError(new Error(j?.detail || j?.error || 'Submit failed'), 'Meta rejected the template.'); return }
      toastSuccess(`Submitted "${j.name || nm}" — Meta is reviewing it.`)
      setShowForm(false); setName(''); setHeaderFormat(''); setHeaderFile(null)
      load()
    } catch (e) {
      toastError(e, 'Could not submit the template.')
    } finally {
      setSubmitting(false); submitRef.current = false
    }
  }

  async function sendTest() {
    // Phase 198 — resolve the APPROVED row (not any same-name pending/rejected
    // row) and send ITS exact Meta language. No blind 'en' fallback: sending a
    // language the template isn't approved in is exactly Meta #132001.
    const selTpl = approvedList.find((t) => t.name === tplName)
    if (!tplName) { toastError(new Error('tpl'), 'Pick an approved template first.'); return }
    if (!selTpl) { toastError(new Error('tpl'), 'That template is not approved yet — pick an approved one.'); return }
    if (!selTpl.language) { toastError(new Error('lang'), 'This template has no language on file — reload templates.'); return }
    if (!testTo.trim()) { toastError(new Error('to'), 'Enter your own number to test.'); return }
    // Phase 199 — if the template has a media header, attach the creative.
    const hType = headerFmtOf(selTpl)
    if (hType && !bcMediaFile) { toastError(new Error('media'), `This template has a ${hType} header — attach the ${hType} below to send.`); return }
    setTesting(true)
    try {
      let header_media_url = ''
      if (hType) header_media_url = await uploadToCampaignMedia(bcMediaFile)
      const r = await authedFetch('/api/wa/broadcast', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'test', template_name: tplName, template_language: selTpl.language, to: testTo.trim(), header_type: hType, header_media_url }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { toastError(new Error(j?.detail || j?.error || 'failed'), 'Test send failed.'); return }
      toastSuccess('Test sent — check that WhatsApp.')
    } catch (e) { toastError(e, 'Test error.') } finally { setTesting(false) }
  }

  async function sendBroadcast() {
    // Phase 198 — approved row + its exact language (see sendTest).
    const selTpl = approvedList.find((t) => t.name === tplName)
    const seg = segments.find((s) => s.id === segId)
    if (!segId || !tplName) { toastError(new Error('pick'), 'Pick a segment + an approved template.'); return }
    if (!selTpl) { toastError(new Error('tpl'), 'That template is not approved yet — pick an approved one.'); return }
    if (!selTpl.language) { toastError(new Error('lang'), 'This template has no language on file — reload templates.'); return }
    // Phase 199 — media header requires the creative.
    const hType = headerFmtOf(selTpl)
    if (hType && !bcMediaFile) { toastError(new Error('media'), `This template has a ${hType} header — attach the ${hType} below to send.`); return }
    if (sendRef.current || sending) return
    const ok = await confirmDialog({
      title: 'Send broadcast?',
      message: `Send template "${tplName}" to ${seg?.contact_count ?? 'the'} leads in "${seg?.name}"? These are real WhatsApp messages and may be billed. Send a test to yourself first if unsure.`,
      confirmLabel: 'Send broadcast', cancelLabel: 'Cancel',
    })
    if (!ok) return
    sendRef.current = true; setSending(true); setProgress(null)
    try {
      let header_media_url = ''
      if (hType) header_media_url = await uploadToCampaignMedia(bcMediaFile)
      const cr = await authedFetch('/api/wa/broadcast', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create', segment_id: segId, template_name: tplName, template_language: selTpl.language, header_type: hType, header_media_url }),
      })
      const cj = await cr.json().catch(() => ({}))
      if (!cr.ok) { toastError(new Error(cj?.detail || cj?.error || 'failed'), 'Could not queue the broadcast.'); return }
      const bid = cj.broadcast_id; const total = cj.total || 0
      setProgress({ total, remaining: total })
      let guard = 0
      while (guard++ < 1000) {
        const sr = await authedFetch('/api/wa/broadcast', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'send_batch', broadcast_id: bid }),
        })
        const sj = await sr.json().catch(() => ({}))
        if (!sr.ok) { toastError(new Error(sj?.detail || sj?.error || 'failed'), 'Send stopped mid-way — re-send to resume.'); break }
        setProgress({ total, remaining: sj.remaining || 0 })
        if (sj.done || (sj.remaining || 0) === 0) break
      }
      toastSuccess('Broadcast complete.')
      loadAux()
    } catch (e) { toastError(e, 'Broadcast error.') } finally { setSending(false); sendRef.current = false }
  }

  const approvedCount = templates.filter((t) => String(t.status).toUpperCase() === 'APPROVED').length
  const approvedList = templates.filter((t) => String(t.status).toUpperCase() === 'APPROVED')
  const selTplBody = bodyOf(templates.find((t) => t.name === tplName) || {})
  // Phase 199 — media-header format of the picked broadcast template ('' = text).
  const bcHeaderType = headerFmtOf(approvedList.find((t) => t.name === tplName))
  const refreshBtn = (
    <button type="button" onClick={load} style={btnG}><RefreshCw size={14} strokeWidth={1.6} /> Refresh</button>
  )

  return (
    <CampaignChrome
      active="broadcast"
      title="Broadcast"
      sub="Create your message templates here (Meta reviews them — no need to leave the app). Once a template is Approved, you'll send it to a saved segment."
      right={refreshBtn}
    >
      {/* step note */}
      <div style={{ ...panel, marginBottom: 18, display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <Send size={18} strokeWidth={1.6} style={{ color: 'var(--v2-yellow, #FFE600)', flexShrink: 0, marginTop: 1 }} />
        <div style={{ fontSize: 13, color: 'var(--v2-ink-1)', lineHeight: 1.55 }}>
          <b style={{ color: 'var(--v2-ink-0)' }}>Step 1 — templates (you are here).</b> Marketing messages to your own
          leads must use a Meta-approved template. Create one below; Meta usually approves within minutes.
          <b style={{ color: 'var(--v2-ink-0)' }}> Step 2 — sending</b> to a saved Segment unlocks once a template is Approved
          {approvedCount > 0 ? <span style={{ color: 'var(--v2-green, #22c55e)' }}> — you have {approvedCount} approved.</span> : <span> (and a payment method is on the WABA).</span>}
        </div>
      </div>

      {/* billing strip */}
      <div style={billStrip}>
        <div><div style={bk}>Sent this month</div><div style={bnum}>{sentMonth.toLocaleString('en-IN')}</div></div>
        <div><div style={bk}>Est. spend (marketing)</div><div style={bnum}>{'₹'} {Math.round(sentMonth * 0.8).toLocaleString('en-IN')}</div></div>
        <div style={{ flex: 1 }} />
        <a href="https://business.facebook.com/billing_hub" target="_blank" rel="noreferrer" style={{ ...btnY, textDecoration: 'none' }}>Top up</a>
      </div>
      <div style={{ fontSize: 11, color: 'var(--v2-ink-2)', margin: '6px 0 18px' }}>Balance + top-up live in WhatsApp Manager / Meta Billing — we never store your card. Est. spend = sent &times; ~{'₹'}0.80 marketing rate.</div>

      {/* selected broadcast — funnel + cards + template preview */}
      {selData && selData.broadcast && (() => {
        const f = selData.funnel || {}
        const total = (f.queued || 0) + (f.sending || 0) + (f.sent || 0) + (f.delivered || 0) + (f.read || 0) + (f.failed || 0)
        const sent = (f.sending || 0) + (f.sent || 0) + (f.delivered || 0) + (f.read || 0)
        const delivered = (f.delivered || 0) + (f.read || 0)
        const read = (f.read || 0)
        const failed = (f.failed || 0)
        const bc = selData.broadcast
        const tplBody = bodyOf(templates.find((t) => t.name === bc.template_name) || {})
        return (
          <>
            <div style={funnelWrap}>
              <FunnelStat pct={pct(total, total)} cnt={total} lbl="Audience" />
              <FunnelStat pct={pct(sent, total)} cnt={sent} lbl="Sent" color="var(--v2-blue, #60a5fa)" />
              <FunnelStat pct={pct(delivered, total)} cnt={delivered} lbl="Delivered" />
              <FunnelStat pct={pct(read, total)} cnt={read} lbl="Read" color="var(--v2-green, #22c55e)" />
              <FunnelStat pct={pct(failed, total)} cnt={failed} lbl="Failed" color="var(--v2-rose, #f87171)" last />
            </div>
            <div style={bcardsWrap}>
              <BCard k="Campaign type" v="BROADCAST" />
              <BCard k="Message type" v="TEMPLATE" />
              <BCard k="Audience" v={total.toLocaleString('en-IN')} />
              <BCard k="Est. credit usage" v={`${'₹'} ${Math.round(sent * 0.8).toLocaleString('en-IN')}`} y />
            </div>
            {tplBody && (
              <div style={{ ...panel, marginBottom: 18 }}>
                <div style={{ fontFamily: 'var(--v2-display)', fontWeight: 600, color: 'var(--v2-ink-0)', fontSize: 14, marginBottom: 14 }}>Template sent</div>
                <div style={waCard}>
                  <div style={waImg}>{bc.template_name}</div>
                  <div style={waBody}>{tplBody}</div>
                </div>
                <div style={{ fontSize: 11, color: 'var(--v2-ink-2)', marginTop: 12 }}>Template: <b style={{ color: 'var(--v2-ink-1)' }}>{bc.template_name}</b>{bc.segment_name ? ` · ${bc.segment_name}` : ''}</div>
              </div>
            )}
          </>
        )
      })()}

      {/* broadcast composer — unlocks once a template is Approved */}
      {approvedCount > 0 && (
        <div style={{ ...panel, marginBottom: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
            <Megaphone size={16} strokeWidth={1.6} style={{ color: 'var(--v2-yellow, #FFE600)' }} />
            <span style={{ fontFamily: 'var(--v2-display)', fontWeight: 700, color: 'var(--v2-ink-0)', fontSize: 15 }}>Send a broadcast</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
            <div>
              <label style={lbl}>Audience (saved segment)</label>
              <select style={inp} value={segId} onChange={(e) => setSegId(e.target.value)}>
                <option value="">Pick a segment…</option>
                {segments.map((s) => <option key={s.id} value={s.id}>{s.name}{s.contact_count != null ? ` · ${s.contact_count}` : ''}</option>)}
              </select>
            </div>
            <div>
              <label style={lbl}>Template (approved)</label>
              <select style={inp} value={tplName} onChange={(e) => setTplName(e.target.value)}>
                <option value="">Pick a template…</option>
                {approvedList.map((t) => <option key={`${t.name}|${t.language}`} value={t.name}>{t.name} · {t.language || 'en'}</option>)}
              </select>
            </div>
          </div>
          {/* Phase 199 — this template has a media header → attach the creative to send */}
          {bcHeaderType && (
            <div style={{ marginTop: 12 }}>
              <label style={lbl}>Attach the {bcHeaderType} to send (this template has a {bcHeaderType} header)</label>
              <input type="file" style={{ ...inp, padding: '7px 10px' }}
                accept={bcHeaderType === 'image' ? 'image/*' : bcHeaderType === 'video' ? 'video/*' : 'application/pdf'}
                onChange={(e) => setBcMediaFile(e.target.files?.[0] || null)} />
            </div>
          )}
          {selTplBody && (
            <div style={{ marginTop: 12, padding: '10px 12px', borderRadius: 10, background: 'var(--v2-green-soft, rgba(34,197,94,0.10))', border: '1px solid var(--v2-line)', fontSize: 12.5, color: 'var(--v2-ink-1)', whiteSpace: 'pre-wrap' }}>
              <Users size={12} strokeWidth={1.6} style={{ marginRight: 5, verticalAlign: 'middle', color: 'var(--v2-ink-2)' }} />{selTplBody}
            </div>
          )}
          {segments.length === 0 && (
            <div style={{ marginTop: 10, fontSize: 12, color: 'var(--v2-amber, #F59E0B)' }}>No saved segments yet — build one on the Segments tab first.</div>
          )}
          <div style={{ marginTop: 14, display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div>
              <label style={lbl}>Test to your number</label>
              <input style={{ ...inp, width: 170 }} value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="9876543210" />
            </div>
            <button type="button" style={{ ...btnG, opacity: testing ? 0.6 : 1 }} onClick={sendTest} disabled={testing}>
              {testing ? <Loader2 size={14} strokeWidth={1.6} className="spin" /> : <FlaskConical size={14} strokeWidth={1.6} />} Send test to me
            </button>
            <div style={{ flex: 1 }} />
            <button type="button" style={{ ...btnY, opacity: (sending || !segId || !tplName) ? 0.6 : 1 }} onClick={sendBroadcast} disabled={sending || !segId || !tplName}>
              {sending ? <Loader2 size={14} strokeWidth={1.6} className="spin" /> : <Send size={14} strokeWidth={1.6} />} Send broadcast
            </button>
          </div>
          {progress && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 12, color: 'var(--v2-ink-1)', marginBottom: 5 }}>Sent {progress.total - progress.remaining} of {progress.total}</div>
              <div style={{ height: 6, borderRadius: 999, background: 'var(--v2-bg-2)', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${progress.total ? Math.round(((progress.total - progress.remaining) / progress.total) * 100) : 0}%`, background: 'var(--v2-green, #22c55e)', transition: 'width .3s' }} />
              </div>
            </div>
          )}
          <p style={{ fontSize: 11, color: 'var(--v2-ink-2)', margin: '12px 0 0', lineHeight: 1.5 }}>
            Marketing messages are billed per send (a payment method must be on the WABA). Send only to your own opted-in leads.
          </p>
        </div>
      )}

      {/* recent broadcasts */}
      {broadcasts.length > 0 && (
        <div style={{ ...panel, padding: 0, marginBottom: 18 }}>
          <div style={{ padding: '13px 18px', borderBottom: '1px solid var(--v2-line)', fontFamily: 'var(--v2-display)', fontWeight: 600, color: 'var(--v2-ink-0)', fontSize: 14 }}>Recent broadcasts</div>
          {broadcasts.map((b) => (
            <div key={b.id} onClick={() => setSelBcId(b.id)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 18px', borderBottom: '1px solid var(--v2-line)', flexWrap: 'wrap', cursor: 'pointer', background: b.id === selBcId ? 'rgba(255,230,0,.05)' : 'transparent' }}>
              <div style={{ flex: 1, minWidth: 150 }}>
                <div style={{ fontWeight: 600, color: 'var(--v2-ink-0)', fontSize: 13 }}>{b.segment_name || 'Segment'} · {b.template_name}</div>
                <div style={{ fontSize: 11, color: 'var(--v2-ink-2)', marginTop: 1 }}>{fmtWhen(b.created_at)}</div>
              </div>
              <span style={{ fontFamily: 'var(--v2-display)', fontWeight: 700, color: 'var(--v2-green, #22c55e)' }}>{b.sent}</span>
              <span style={{ fontSize: 11, color: 'var(--v2-ink-2)' }}>sent</span>
              {b.failed > 0 && <span style={{ fontFamily: 'var(--v2-display)', fontWeight: 700, color: 'var(--v2-rose, #f87171)' }}>{b.failed} failed</span>}
              <span style={{ fontSize: 11, color: 'var(--v2-ink-2)' }}>/ {b.total}</span>
              <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', padding: '2px 8px', borderRadius: 999, color: b.status === 'done' ? 'var(--v2-green, #22c55e)' : 'var(--v2-amber, #F59E0B)', background: b.status === 'done' ? 'var(--v2-green-soft, rgba(34,197,94,0.14))' : 'var(--v2-amber-soft, rgba(245,158,11,0.14))' }}>{b.status}</span>
            </div>
          ))}
        </div>
      )}

      {/* templates */}
      <div style={{ ...panel, padding: 0 }}>
        <div style={{ padding: '13px 18px', borderBottom: '1px solid var(--v2-line)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontFamily: 'var(--v2-display)', fontWeight: 600, color: 'var(--v2-ink-0)', fontSize: 14 }}>
            Message templates{!loading && ` · ${templates.length}`}
          </span>
          <button type="button" style={btnY} onClick={() => setShowForm((s) => !s)}><Plus size={14} strokeWidth={1.6} /> New template</button>
        </div>

        {/* create form */}
        {showForm && (
          <div style={{ padding: 18, borderBottom: '1px solid var(--v2-line)', background: 'var(--v2-bg-2, #1a2742)' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
              <div>
                <label style={lbl}>Name (lowercase, no spaces)</label>
                <input style={inp} value={name} onChange={(e) => setName(e.target.value)} placeholder="reengage_2026" />
              </div>
              <div>
                <label style={lbl}>Type</label>
                <select style={inp} value={category} onChange={(e) => setCategory(e.target.value)}>
                  <option value="MARKETING">Marketing (promotions)</option>
                  <option value="UTILITY">Utility (transactional)</option>
                </select>
              </div>
              <div>
                <label style={lbl}>Sample for {'{{1}}'}</label>
                <input style={inp} value={example} onChange={(e) => setExample(e.target.value)} placeholder="Rajesh" />
              </div>
            </div>
            <div style={{ marginTop: 12 }}>
              <label style={lbl}>Message body — use {'{{1}}'} for the lead&rsquo;s name</label>
              <textarea style={{ ...inp, height: 96, padding: '9px 12px', resize: 'vertical' }} value={bodyText} onChange={(e) => setBodyText(e.target.value)} />
            </div>
            {/* Phase 199 — optional media header (image / video / PDF at the top of the message) */}
            <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, alignItems: 'end' }}>
              <div>
                <label style={lbl}>Header image / video / PDF (optional)</label>
                <select style={inp} value={headerFormat} onChange={(e) => { setHeaderFormat(e.target.value); setHeaderFile(null) }}>
                  <option value="">None — text only</option>
                  <option value="IMAGE">Image</option>
                  <option value="VIDEO">Video</option>
                  <option value="DOCUMENT">Document (PDF)</option>
                </select>
              </div>
              {headerFormat && (
                <div>
                  <label style={lbl}>Sample {headerFormat.toLowerCase()} — Meta needs it to approve</label>
                  <input type="file" style={{ ...inp, padding: '7px 10px' }}
                    accept={headerFormat === 'IMAGE' ? 'image/*' : headerFormat === 'VIDEO' ? 'video/*' : 'application/pdf'}
                    onChange={(e) => setHeaderFile(e.target.files?.[0] || null)} />
                </div>
              )}
            </div>
            <div style={{ marginTop: 14, display: 'flex', gap: 10 }}>
              <button type="button" style={{ ...btnY, opacity: submitting ? 0.6 : 1 }} onClick={submit} disabled={submitting}>
                {submitting ? <Loader2 size={14} strokeWidth={1.6} className="spin" /> : <Send size={14} strokeWidth={1.6} />} Submit to Meta
              </button>
              <button type="button" style={btnG} onClick={() => setShowForm(false)}>Cancel</button>
            </div>
          </div>
        )}

        {loading ? (
          <div style={{ padding: 40, textAlign: 'center' }}><Loader2 size={20} strokeWidth={1.6} className="spin" style={{ color: 'var(--v2-yellow, #FFE600)' }} /></div>
        ) : error ? (
          <div style={{ padding: 18, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <AlertTriangle size={18} strokeWidth={1.6} style={{ color: 'var(--v2-amber, #F59E0B)', flexShrink: 0, marginTop: 1 }} />
            <div style={{ fontSize: 13, color: 'var(--v2-ink-1)' }}>{error}</div>
          </div>
        ) : templates.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--v2-ink-2)', fontSize: 13 }}>
            <FileText size={22} strokeWidth={1.6} style={{ opacity: 0.5 }} />
            <div style={{ marginTop: 8 }}>No templates yet. Tap <b style={{ color: 'var(--v2-ink-1)' }}>New template</b> to create your first.</div>
          </div>
        ) : (
          <div>
            {templates.map((t) => {
              const st = statusOf(t.status)
              return (
                <div key={t.name + (t.language || '')} style={{ padding: '14px 18px', borderBottom: '1px solid var(--v2-line)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 700, color: 'var(--v2-ink-0)', fontFamily: 'var(--v2-display)' }}>{t.name}</span>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', padding: '2px 8px', borderRadius: 999, color: st.color, background: st.bg }}>
                      <st.Icon size={12} strokeWidth={1.8} /> {st.label}
                    </span>
                    <span style={{ fontSize: 11, color: 'var(--v2-ink-2)' }}>{t.category} · {(t.language || 'en')}</span>
                  </div>
                  <div style={{ fontSize: 12.5, color: 'var(--v2-ink-2)', marginTop: 6, whiteSpace: 'pre-wrap' }}>{bodyOf(t)}</div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <style>{`@keyframes spin{to{transform:rotate(360deg)}} .spin{animation:spin 1s linear infinite}`}</style>
    </CampaignChrome>
  )
}

// ─── inline styles ───────────────────────────────────────────────────────
const panel = { background: 'var(--v2-bg-1, #0f1525)', border: '1px solid var(--v2-line, #1f2b47)', borderRadius: 14, padding: 18 }
const lbl = { fontSize: 11, color: 'var(--v2-ink-2, #6a7590)', textTransform: 'uppercase', letterSpacing: '.08em', fontWeight: 600, marginBottom: 6, display: 'block' }
const inp = { width: '100%', height: 38, padding: '0 12px', background: 'var(--v2-bg-1, #0f1525)', border: '1px solid var(--v2-line, #1f2b47)', borderRadius: 10, color: 'var(--v2-ink-0, #f5f7fb)', fontSize: 13, outline: 'none', fontFamily: 'inherit' }
const btnY = { background: 'var(--v2-yellow, #FFE600)', color: 'var(--accent-fg, #0b1220)', border: 'none', borderRadius: 10, height: 38, padding: '0 16px', fontWeight: 700, fontSize: 13, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }
const btnG = { background: 'transparent', color: 'var(--v2-ink-1, #a9b3c7)', border: '1px solid var(--v2-line, #1f2b47)', borderRadius: 10, height: 38, padding: '0 14px', fontWeight: 600, fontSize: 13, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }
const billStrip = { display: 'flex', alignItems: 'center', gap: 22, background: 'var(--v2-bg-1, #0f1525)', border: '1px solid var(--v2-line, #1f2b47)', borderRadius: 12, padding: '14px 18px', flexWrap: 'wrap' }
const bk = { fontSize: 11, color: 'var(--v2-ink-2)', textTransform: 'uppercase', letterSpacing: '.08em' }
const bnum = { fontFamily: 'var(--v2-display)', fontWeight: 700, color: 'var(--v2-ink-0)', fontSize: 18 }
const funnelWrap = { display: 'flex', gap: 0, background: 'var(--v2-bg-1, #0f1525)', border: '1px solid var(--v2-line, #1f2b47)', borderRadius: 14, overflow: 'hidden', marginBottom: 18 }
const bcardsWrap = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 14, marginBottom: 18 }
const waCard = { maxWidth: 300, background: '#0b1f17', border: '1px solid rgba(16,185,129,.25)', borderRadius: 12, overflow: 'hidden' }
const waImg = { height: 110, background: 'linear-gradient(135deg,#f59e0b,#ec4899 60%,#1c2540)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontFamily: 'var(--v2-display)', fontWeight: 700, fontSize: 14, textShadow: '0 1px 4px rgba(0,0,0,.4)', textAlign: 'center', padding: '0 10px' }
const waBody = { padding: '12px 14px', fontSize: 12, color: 'var(--v2-ink-0)', lineHeight: 1.55, whiteSpace: 'pre-wrap' }

function pct(x, total) { return total ? Math.round((x / total) * 100) : 0 }
function FunnelStat({ pct: p, cnt, lbl, color, last }) {
  return (
    <div style={{ flex: 1, padding: '16px 18px', borderRight: last ? 'none' : '1px solid var(--v2-line)', minWidth: 90 }}>
      <div style={{ fontFamily: 'var(--v2-display)', fontSize: 22, fontWeight: 700, color: color || 'var(--v2-ink-0)' }}>{p}%</div>
      <div style={{ fontSize: 11, color: 'var(--v2-ink-2)' }}>{(cnt || 0).toLocaleString('en-IN')}</div>
      <div style={{ fontSize: 11, color: 'var(--v2-ink-1)', marginTop: 6, fontWeight: 600 }}>{lbl}</div>
    </div>
  )
}
function BCard({ k, v, y }) {
  return (
    <div style={{ background: 'var(--v2-bg-1, #0f1525)', border: '1px solid var(--v2-line, #1f2b47)', borderRadius: 14, padding: '16px 18px' }}>
      <div style={{ fontSize: 11, color: 'var(--v2-ink-2)', textTransform: 'uppercase', letterSpacing: '.08em', fontWeight: 600 }}>{k}</div>
      <div style={{ fontFamily: 'var(--v2-display)', fontSize: 18, fontWeight: 700, color: y ? 'var(--v2-yellow, #FFE600)' : 'var(--v2-ink-0)', marginTop: 6 }}>{v}</div>
    </div>
  )
}
