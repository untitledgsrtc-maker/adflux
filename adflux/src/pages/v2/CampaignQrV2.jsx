// src/pages/v2/CampaignQrV2.jsx
//
// Campaign Module — QR & Locations (token-free, additive), matched to the
// owner-approved mockup (_design_reference/campaign_module_mockup.html → QR
// tab): a boards TABLE (QR thumb · board · city · LEADS · telecaller),
// a "Leads by city" bar chart, and "+ New QR" opens a MODAL with the board
// form + live preview.
//
// Honest data note: the mockup's Scans / Quotes / Won / Conv% per board are
// MOCK — raw scans aren't tracked (spec §7 "messaged only") and the funnel
// needs the live number. This page shows the REAL numbers we have: leads per
// board (via leads.location_id, stamped by C8) + leads by city + the board's
// routing telecaller (board → campaign → default_telecaller_id).
//
// NEEDS NO WhatsApp API / token. Saving a board writes ONE row to the new
// campaign_locations table. The only live-table read is leads.location_id
// (count, admin page, on load). Touches NO existing flow (§45).
//
// §45 no-slowdown: qrcode.react is lazy-loaded (its own chunk) — rep bundles
// (/work, /telecaller, lead detail) are byte-unchanged.

import { useState, useEffect, useMemo, useRef, lazy, Suspense } from 'react'
import { Plus, Download, Loader2, AlertTriangle, MapPin, RefreshCw, X, Trash2, Pencil } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import CampaignChrome from '../../components/v2/CampaignChrome'
import { pushToast, toastError, toastSuccess } from '../../components/v2/Toast'
import { confirmDialog } from '../../components/v2/ConfirmDialog'

const QRCodeCanvas = lazy(() => import('qrcode.react').then((m) => ({ default: m.QRCodeCanvas })))

function digitsToWa(raw) {
  const d = String(raw || '').replace(/\D/g, '')
  return d.length === 10 ? '91' + d : d
}
function slugCode(city, label, n) {
  const c = String(city || '').replace(/[^a-zA-Z]/g, '').slice(0, 3).toUpperCase() || 'CITY'
  const l = String(label || '').replace(/[^a-zA-Z]/g, '').slice(0, 2).toUpperCase() || 'BD'
  return `${l}-${c}-${String(n).padStart(2, '0')}`
}

export default function CampaignQrV2() {
  const [loading, setLoading] = useState(true)
  const [tablesMissing, setTablesMissing] = useState(false)
  const [boards, setBoards] = useState([])
  const [accounts, setAccounts] = useState([])
  const [campaigns, setCampaigns] = useState([])
  const [tcs, setTcs] = useState([])         // telecallers for the routing dropdown
  const [tcById, setTcById] = useState({})   // telecaller id → name
  const [leadsByBoard, setLeadsByBoard] = useState({})
  const [quotesByBoard, setQuotesByBoard] = useState({})
  const [messagedByBoard, setMessagedByBoard] = useState({})
  const [scansByBoard, setScansByBoard] = useState({})
  const [tcByCampaign, setTcByCampaign] = useState({})
  const [saving, setSaving] = useState(false)
  const [showModal, setShowModal] = useState(false)

  const [number, setNumber] = useState('')
  const [label, setLabel] = useState('')
  const [city, setCity] = useState('')
  const [code, setCode] = useState('')
  const [message, setMessage] = useState('')
  const [campaignId, setCampaignId] = useState('')
  const [tcId, setTcId] = useState('')   // board → telecaller (mockup routing)
  const [codeEdited, setCodeEdited] = useState(false)
  const [msgEdited, setMsgEdited] = useState(false)
  const [editingId, setEditingId] = useState(null)   // null = create; row id = editing (Phase 232). Code stays FIXED on edit.
  const previewRef = useRef(null)

  async function load() {
    setLoading(true)
    try {
      // '*' so new columns (default_telecaller_id) flow through, and a board
      // load never breaks when the C8.1 SQL hasn't run yet. Own boards only —
      // client QRs live in the Client QRs tab.
      let locsRes = await supabase.from('campaign_locations').select('*')
        .is('client_name', null).order('created_at', { ascending: false })
      // client_name column not added yet (client-QR SQL unrun) → keep this
      // page working by retrying without the filter (§45 — never break boards).
      if (locsRes.error && /client_name/i.test(locsRes.error.message || '')) {
        locsRes = await supabase.from('campaign_locations').select('*')
          .order('created_at', { ascending: false })
      }
      const locs = locsRes.data
      const e1 = locsRes.error
      if (e1) {
        if (e1.code === '42P01' || /does not exist|schema cache/i.test(e1.message || '')) {
          setTablesMissing(true); setLoading(false); return
        }
        throw e1
      }
      setBoards(locs || [])

      const { data: accs } = await supabase
        .from('whatsapp_accounts').select('display_number, phone_number_id, is_active')
      const list = (accs || []).filter((a) => a.is_active !== false)
      setAccounts(list)
      if (!number && list[0]?.display_number) setNumber(list[0].display_number)

      const { data: camps } = await supabase
        .from('campaigns').select('id, name, default_telecaller_id').eq('is_active', true).order('name')
      setCampaigns(camps || [])

      // Telecallers — a board routes its leads straight to one (mockup model).
      const { data: tcRows } = await supabase
        .from('users').select('id, name').eq('role', 'telecaller').order('name')
      setTcs(tcRows || [])
      setTcById(Object.fromEntries((tcRows || []).map((u) => [u.id, u.name])))

      // Real per-board analytics — all SCOPED to the boards in view (bounded;
      // read-only on live tables). leads (by location_id) + the quotes off
      // those leads + the WhatsApp conversations carrying the board code + the
      // QR scans.
      const boardIds = (locs || []).map((b) => b.id)
      const lb = {}, qb = {}, mb = {}, sb = {}
      if (boardIds.length) {
        // Phase 274 — count per board SERVER-side (GROUP BY) so the totals are
        // accurate at ANY volume. The old client-side loads capped at
        // PostgREST's ~1000-row limit → "Total scans" froze at 1000 once
        // qr_scans crossed it (§66/§85). One uncapped RPC replaces 4 loads.
        const { data: stats, error: statsErr } = await supabase
          .rpc('qr_board_stats', { p_board_ids: boardIds })
        if (!statsErr && Array.isArray(stats)) {
          stats.forEach((r) => {
            if (!r.location_id) return
            sb[r.location_id] = Number(r.scans)    || 0
            mb[r.location_id] = Number(r.messaged) || 0
            lb[r.location_id] = Number(r.leads)    || 0
            qb[r.location_id] = Number(r.quotes)   || 0
          })
        } else {
          // Deploy-order fallback: RPC not created yet → legacy client counts
          // (capped at ~1000, but keeps the page working before the SQL runs).
          const leadToBoard = {}
          const { data: ld } = await supabase
            .from('leads').select('id, location_id').in('location_id', boardIds)
          ;(ld || []).forEach((r) => {
            if (!r.location_id) return
            lb[r.location_id] = (lb[r.location_id] || 0) + 1
            leadToBoard[r.id] = r.location_id
          })
          const leadIds = Object.keys(leadToBoard)
          if (leadIds.length) {
            const { data: qs } = await supabase.from('quotes').select('lead_id').in('lead_id', leadIds)
            ;(qs || []).forEach((q) => { const b = leadToBoard[q.lead_id]; if (b) qb[b] = (qb[b] || 0) + 1 })
          }
          const { data: convs } = await supabase
            .from('whatsapp_conversations').select('location_id').in('location_id', boardIds)
          ;(convs || []).forEach((c) => { if (c.location_id) mb[c.location_id] = (mb[c.location_id] || 0) + 1 })
          const { data: scans } = await supabase.from('qr_scans').select('location_id').in('location_id', boardIds)
          ;(scans || []).forEach((s) => { if (s.location_id) sb[s.location_id] = (sb[s.location_id] || 0) + 1 })
        }
      }
      setLeadsByBoard(lb)
      setQuotesByBoard(qb)
      setMessagedByBoard(mb)
      setScansByBoard(sb)

      // board → campaign → telecaller name.
      const tcIds = [...new Set((camps || []).map((c) => c.default_telecaller_id).filter(Boolean))]
      let tcName = {}
      if (tcIds.length) {
        const { data: us } = await supabase.from('users').select('id, name').in('id', tcIds)
        ;(us || []).forEach((u) => { tcName[u.id] = u.name })
      }
      const map = {}
      ;(camps || []).forEach((c) => { if (c.default_telecaller_id) map[c.id] = tcName[c.default_telecaller_id] || null })
      setTcByCampaign(map)
    } catch (err) {
      toastError(err, 'Could not load boards.')
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() /* eslint-disable-next-line */ }, [])

  useEffect(() => {
    if (!codeEdited) setCode(slugCode(city, label, boards.length + 1))
    // eslint-disable-next-line
  }, [city, label, boards.length, codeEdited])
  useEffect(() => {
    if (!msgEdited) {
      const place = [label, city].filter(Boolean).join(' ')
      setMessage(`Hi, saw your screen at ${place || 'your location'} [${code}]`)
    }
    // eslint-disable-next-line
  }, [label, city, code, msgEdited])

  const waNumber = digitsToWa(number)
  const waUrl = useMemo(
    () => (waNumber ? `https://wa.me/${waNumber}?text=${encodeURIComponent(message)}` : ''),
    [waNumber, message]
  )
  // The QR encodes a TRACKABLE redirect (/api/q/<CODE>): a scan hits it, we log
  // a qr_scans row, then it 302s to the board's wa.me link (stored as qr_text).
  // So the QR VALUE is the redirect URL; the saved qr_text stays the wa.me link
  // (the bounce target the endpoint reads).
  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://app.untitledad.in'
  const qrValue = (c) => (c ? `${origin}/api/q/${encodeURIComponent(c)}` : '')

  const leadsByCity = useMemo(() => {
    const m = {}
    boards.forEach((b) => {
      const c = (b.city || '—').trim() || '—'
      m[c] = (m[c] || 0) + (leadsByBoard[b.id] || 0)
    })
    return Object.entries(m).sort((a, b) => b[1] - a[1])
  }, [boards, leadsByBoard])
  const maxCity = useMemo(() => Math.max(1, ...leadsByCity.map(([, n]) => n)), [leadsByCity])
  const deadBoards = useMemo(() => boards.filter((b) => !(leadsByBoard[b.id] > 0)).length, [boards, leadsByBoard])

  // Summary totals (mockup's 4 KPI cards) — real numbers only.
  const totals = useMemo(() => {
    const sum = (m) => Object.values(m).reduce((a, b) => a + (b || 0), 0)
    let top = null, topN = -1
    boards.forEach((b) => { const n = leadsByBoard[b.id] || 0; if (n > topN) { topN = n; top = b } })
    const topLabel = top && topN > 0 ? `${top.label || top.code}${top.city ? ` · ${top.city}` : ''}` : '—'
    return { scans: sum(scansByBoard), messaged: sum(messagedByBoard), leads: sum(leadsByBoard), topLabel }
  }, [boards, scansByBoard, messagedByBoard, leadsByBoard])

  function downloadFromRef(ref, fileCode) {
    const canvas = ref?.current?.querySelector('canvas')
    if (!canvas) { pushToast('QR not ready yet — try again.', 'info'); return }
    const a = document.createElement('a')
    a.href = canvas.toDataURL('image/png'); a.download = `qr-${fileCode || 'board'}.png`; a.click()
  }

  async function saveBoard() {
    if (!waNumber) { pushToast('Enter the WhatsApp number first.', 'danger'); return }
    if (!label.trim()) { pushToast('Enter a board / location name.', 'danger'); return }
    if (!editingId && !code.trim()) { pushToast('Code is required.', 'danger'); return }
    setSaving(true)
    try {
      // On edit the code is FIXED (an already-printed QR encodes /api/q/<code>)
      // → re-pointing the number/label/city/routing needs NO reprint.
      const fields = {
        label: label.trim(), city: city.trim() || null,
        qr_text: waUrl, campaign_id: campaignId || null,
      }
      let error
      if (editingId) {
        ;({ error } = await supabase.from('campaign_locations')
          .update({ ...fields, default_telecaller_id: tcId || null }).eq('id', editingId))
        // default_telecaller_id column not added yet → update without it.
        if (error && /default_telecaller_id|column/i.test(error.message || '')) {
          ;({ error } = await supabase.from('campaign_locations').update(fields).eq('id', editingId))
        }
      } else {
        const row = { ...fields, code: code.trim(), is_active: true }
        ;({ error } = await supabase.from('campaign_locations')
          .insert({ ...row, default_telecaller_id: tcId || null }))
        // default_telecaller_id column not added yet → save without it + warn, so
        // the board still works (it just won't route by board until the SQL runs).
        if (error && /default_telecaller_id|column/i.test(error.message || '')) {
          ;({ error } = await supabase.from('campaign_locations').insert(row))
          if (!error) pushToast('Board saved. Run supabase_campaign_c8_1_board_telecaller.sql to enable telecaller routing.', 'info')
        }
      }
      if (error) {
        if (error.code === '23505') { toastError(error, 'That code already exists — pick a different one.'); return }
        throw error
      }
      toastSuccess(editingId ? 'Board updated.' : 'Board QR saved.')
      setLabel(''); setCity(''); setCodeEdited(false); setMsgEdited(false); setEditingId(null); setShowModal(false)
      load()
    } catch (err) {
      toastError(err, 'Could not save board.')
    } finally {
      setSaving(false)
    }
  }

  // Phase 232 — open the modal fresh for a NEW board (reset edit state + form).
  function openNew() {
    setEditingId(null)
    setLabel(''); setCity(''); setMessage(''); setCampaignId(''); setTcId('')
    setCodeEdited(false); setMsgEdited(false)
    setNumber(accounts[0]?.display_number || number)
    setShowModal(true)
  }

  // Phase 232 — EDIT a board. Parse qr_text back into the form; the code stays
  // FIXED (already-printed QR keeps working, no reprint). Match the board's wa
  // number back to its account so the number dropdown shows it.
  function openEdit(b) {
    setEditingId(b.id)
    const t = String(b.qr_text || '')
    const waM = t.match(/wa\.me\/(\d+)/)
    const waNum = waM ? waM[1] : ''
    const acct = accounts.find((a) => digitsToWa(a.display_number) === waNum)
    setNumber(acct ? acct.display_number : (waNum || accounts[0]?.display_number || ''))
    const tx = t.match(/[?&]text=([^&]+)/)
    setMessage(tx ? (() => { try { return decodeURIComponent(tx[1]) } catch { return '' } })() : '')
    setCity(b.city || '')
    setLabel(b.label || '')
    setCode(b.code || '')
    setCampaignId(b.campaign_id || '')
    setTcId(b.default_telecaller_id || '')
    setCodeEdited(true)  // block the auto-code effect
    setMsgEdited(true)   // block the auto-message effect
    setShowModal(true)
  }

  async function deleteBoard(board) {
    const ok = await confirmDialog({
      title: 'Delete this QR board?',
      message: `Delete "${board.label || board.code}" (${board.code})? Its QR + scan history are removed. This can't be undone.`,
      confirmLabel: 'Delete', danger: true,
    })
    if (!ok) return
    const { error } = await supabase.from('campaign_locations').delete().eq('id', board.id)
    if (error) { toastError(error, 'Could not delete the board.'); return }
    toastSuccess('Board deleted.')
    load()
  }

  // Change which telecaller a board's leads route to (inline edit from the table).
  async function reassignBoard(board, newTcId) {
    const { error } = await supabase.from('campaign_locations')
      .update({ default_telecaller_id: newTcId || null }).eq('id', board.id)
    if (error) {
      toastError(error, /default_telecaller_id|column/i.test(error.message || '')
        ? 'Run supabase_campaign_c8_1_board_telecaller.sql first.'
        : 'Could not change the telecaller.')
      return
    }
    toastSuccess(newTcId ? `Board routed to ${tcById[newTcId] || 'telecaller'}.` : 'Board unassigned.')
    load()
  }

  const newBtn = (
    <button type="button" style={btnY} onClick={openNew}><Plus size={14} strokeWidth={1.6} /> New QR</button>
  )

  if (tablesMissing) {
    return (
      <CampaignChrome active="qr" title="QR & Locations" right={newBtn}>
        <div style={banner}>
          <AlertTriangle size={18} strokeWidth={1.6} style={{ color: 'var(--v2-amber, #F59E0B)', flexShrink: 0, marginTop: 1 }} />
          <div style={{ fontSize: 13, color: 'var(--v2-ink-1, #a9b3c7)' }}>
            The campaign tables aren&rsquo;t in the database yet. Run <b style={{ color: 'var(--v2-ink-0, #f5f7fb)' }}>supabase_campaign_c2_foundation.sql</b> in Supabase Studio, then reload.
          </div>
        </div>
      </CampaignChrome>
    )
  }

  return (
    <CampaignChrome
      active="qr"
      title="QR & Locations"
      sub="A QR on each hoarding opens WhatsApp on your number with a hidden board tag — so when the lead chats, you know which board pulled it. Print it and go; no setup needed."
      right={newBtn}
    >
      {/* hero callout — how a board QR works + a sample link (mockup loc-callout) */}
      <div style={{ ...panel, display: 'flex', gap: 18, alignItems: 'center', flexWrap: 'wrap', marginBottom: 18 }}>
        <div style={{ background: 'white', borderRadius: 12, padding: 10, flexShrink: 0 }}>
          <Suspense fallback={<div style={{ width: 92, height: 92 }} />}>
            <QRCodeCanvas value={`${origin}/api/q/RR-AHM-01`} size={92} />
          </Suspense>
        </div>
        <div style={{ flex: 1, minWidth: 240 }}>
          <div style={{ fontFamily: 'var(--v2-display)', fontWeight: 700, color: 'var(--v2-ink-0)', fontSize: 16 }}>Each board gets its own QR</div>
          <div style={{ fontSize: 13, color: 'var(--v2-ink-1)', margin: '6px 0 10px', lineHeight: 1.55 }}>
            Print a board&rsquo;s QR on the hoarding. A scan opens WhatsApp on your number with a hidden tag &mdash; so when the lead chats you know exactly which board pulled them in, and it routes to the right telecaller.
          </div>
          <div style={{ display: 'inline-block', fontFamily: 'var(--v2-display)', fontSize: 12, background: 'var(--v2-bg-2)', border: '1px solid var(--v2-line)', borderRadius: 8, padding: '7px 11px', color: 'var(--v2-ink-1)', wordBreak: 'break-all' }}>
            wa.me/919581578261?text=Hi, saw your screen at Ring Road{' '}
            <span style={{ color: 'var(--v2-yellow, #FFE600)', fontWeight: 700 }}>[RR-AHM-01]</span>
          </div>
        </div>
      </div>

      {/* summary cards (mockup) — real numbers only */}
      {!loading && boards.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 18 }}>
          {[
            { label: 'Total scans',        value: totals.scans,    accent: false },
            { label: 'Scanned & messaged', value: totals.messaged, accent: false },
            { label: 'Leads created',      value: totals.leads,    accent: true },
            { label: 'Top board',          value: totals.topLabel, accent: false, text: true },
          ].map((c) => (
            <div key={c.label} style={{ ...panel, padding: '14px 16px' }}>
              <div style={{ fontSize: 11, color: 'var(--v2-ink-2)', textTransform: 'uppercase', letterSpacing: '.07em', fontWeight: 600 }}>{c.label}</div>
              <div style={{
                fontFamily: 'var(--v2-display)', fontWeight: 700, marginTop: 6, lineHeight: 1.2, wordBreak: 'break-word',
                color: c.accent ? 'var(--v2-yellow, #FFE600)' : 'var(--v2-ink-0)', fontSize: c.text ? 15 : 24,
              }}>
                {c.value}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* boards table */}
      <div style={{ ...panel, padding: 0, marginBottom: 18 }}>
        <div style={{ padding: '13px 18px', borderBottom: '1px solid var(--v2-line)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontFamily: 'var(--v2-display)', fontWeight: 600, color: 'var(--v2-ink-0)', fontSize: 14 }}>
            Boards{!loading && ` · ${boards.length}`}
          </span>
          <button type="button" style={btnG} onClick={load}><RefreshCw size={14} strokeWidth={1.6} /> Refresh</button>
        </div>

        {loading ? (
          <div style={{ padding: 44, textAlign: 'center' }}><Loader2 size={20} strokeWidth={1.6} className="spin" style={{ color: 'var(--v2-yellow, #FFE600)' }} /></div>
        ) : boards.length === 0 ? (
          <div style={{ padding: 44, textAlign: 'center', color: 'var(--v2-ink-2)', fontSize: 13 }}>
            <MapPin size={22} strokeWidth={1.6} style={{ opacity: 0.5 }} />
            <div style={{ marginTop: 8 }}>No boards yet. Tap <b style={{ color: 'var(--v2-ink-1)' }}>New QR</b> to make your first.</div>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr>
                  <th style={{ ...th, width: 48 }}></th>
                  <th style={th}>Board</th>
                  <th style={th}>City</th>
                  <th style={{ ...th, textAlign: 'right' }}>Scans</th>
                  <th style={{ ...th, textAlign: 'right' }}>Messaged</th>
                  <th style={{ ...th, textAlign: 'right' }}>Leads</th>
                  <th style={{ ...th, textAlign: 'right' }}>Quotes</th>
                  <th style={{ ...th, textAlign: 'right' }}>Conv%</th>
                  <th style={th}>Telecaller</th>
                  <th style={{ ...th, textAlign: 'right' }}></th>
                </tr>
              </thead>
              <tbody>
                {boards.map((b) => {
                  const scans = scansByBoard[b.id] || 0
                  const messaged = messagedByBoard[b.id] || 0
                  const leads = leadsByBoard[b.id] || 0
                  const quotes = quotesByBoard[b.id] || 0
                  const conv = leads ? Math.round((quotes / leads) * 100) : null
                  const tc = (b.default_telecaller_id && tcById[b.default_telecaller_id])
                    || (b.campaign_id ? tcByCampaign[b.campaign_id] : null)
                  return (
                    <tr key={b.id} className="qr-row">
                      <td style={{ ...td, padding: '8px 16px' }}><BoardThumb qr={qrValue(b.code)} /></td>
                      <td style={td}>
                        <div style={{ fontWeight: 600, color: 'var(--v2-ink-0, #f5f7fb)' }}>{b.label || b.code}</div>
                        <div style={{ fontSize: 10.5, color: 'var(--v2-ink-2)', letterSpacing: '.04em', marginTop: 2 }}>{b.code}</div>
                      </td>
                      <td style={td}>{b.city || <span style={{ color: 'var(--v2-ink-2)' }}>—</span>}</td>
                      <td style={numTd(scans)}>{scans}</td>
                      <td style={numTd(messaged)}>{messaged}</td>
                      <td style={numTd(leads)}>{leads}</td>
                      <td style={numTd(quotes)}>{quotes}</td>
                      <td style={{ ...td, textAlign: 'right', fontFamily: 'var(--v2-display)', fontWeight: 700, color: conv == null ? 'var(--v2-ink-2, #6a7590)' : conv >= 5 ? 'var(--v2-green, #22c55e)' : 'var(--v2-amber, #F59E0B)' }}>
                        {conv == null ? '—' : `${conv}%`}
                      </td>
                      <td style={td}>
                        {/* inline edit — route this board's leads to a telecaller */}
                        <select
                          value={b.default_telecaller_id || ''}
                          onChange={(e) => reassignBoard(b, e.target.value)}
                          title="Route this board's leads to a telecaller"
                          style={{ ...inp, height: 32, maxWidth: 158, fontSize: 12.5, padding: '0 8px' }}
                        >
                          <option value="">{tc ? `${tc} (via campaign)` : '— unassigned —'}</option>
                          {tcs.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                        </select>
                      </td>
                      <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                        <BoardDownload board={b} qr={qrValue(b.code)} />
                        <button type="button" title="Edit board" onClick={() => openEdit(b)} style={{ ...btnG, height: 30, fontSize: 12, padding: '0 8px', marginLeft: 6 }}>
                          <Pencil size={13} strokeWidth={1.6} />
                        </button>
                        <button type="button" title="Delete board" onClick={() => deleteBoard(b)} style={{ ...btnG, height: 30, fontSize: 12, padding: '0 8px', marginLeft: 6, color: 'var(--v2-rose, #f87171)' }}>
                          <Trash2 size={13} strokeWidth={1.6} />
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        {!loading && boards.length > 0 && deadBoards > 0 && (
          <div style={{ padding: '11px 18px', borderTop: '1px solid var(--v2-line)', fontSize: 11.5, color: 'var(--v2-ink-2)' }}>
            <b style={{ color: 'var(--v2-amber, #F59E0B)' }}>{deadBoards} board{deadBoards === 1 ? '' : 's'} with 0 leads</b> — check placement or drop once the number is live.
          </div>
        )}
      </div>

      {/* leads by city */}
      {!loading && leadsByCity.some(([, n]) => n > 0) && (
        <div style={{ ...panel, marginBottom: 18 }}>
          <div style={{ fontFamily: 'var(--v2-display)', fontWeight: 600, color: 'var(--v2-ink-0)', fontSize: 14, marginBottom: 14 }}>Leads by city</div>
          {leadsByCity.filter(([, n]) => n > 0).map(([c, n]) => (
            <div key={c} style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 9 }}>
              <span style={{ width: 96, fontSize: 12.5, color: 'var(--v2-ink-1)', flexShrink: 0 }}>{c}</span>
              <span style={{ flex: 1, height: 9, borderRadius: 999, background: 'var(--v2-bg-2)', overflow: 'hidden' }}>
                <span style={{ display: 'block', height: '100%', width: `${Math.max(4, (n / maxCity) * 100)}%`, background: 'var(--v2-blue, #60a5fa)', borderRadius: 999 }} />
              </span>
              <span style={{ width: 40, textAlign: 'right', fontSize: 12.5, fontFamily: 'var(--v2-display)', fontWeight: 600, color: 'var(--v2-ink-0)' }}>{n}</span>
            </div>
          ))}
        </div>
      )}

      <p style={{ fontSize: 11.5, color: 'var(--v2-ink-2)', margin: '0', lineHeight: 1.6 }}>
        Scan-count + the quotes/won funnel per board light up once the WhatsApp number is live. Today the QR works and every chat carrying a board tag becomes a routed lead.
      </p>

      {/* New board QR modal */}
      {showModal && (
        <div style={overlay} onClick={() => setShowModal(false)}>
          <div style={modalBox} onClick={(e) => e.stopPropagation()}>
            <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--v2-line)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontFamily: 'var(--v2-display)', fontWeight: 600, color: 'var(--v2-ink-0)', fontSize: 15 }}>{editingId ? 'Edit board QR' : 'New board QR'}</span>
              <button type="button" onClick={() => setShowModal(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--v2-ink-2)', display: 'flex' }}><X size={18} strokeWidth={1.6} /></button>
            </div>
            <div style={{ padding: 18, display: 'flex', gap: 18, flexWrap: 'wrap' }}>
              <div style={{ flex: '1 1 300px', minWidth: 260 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div>
                    <label style={lbl}>WhatsApp number</label>
                    {accounts.length > 0 ? (
                      <select style={inp} value={number} onChange={(e) => setNumber(e.target.value)}>
                        {accounts.map((a) => <option key={a.phone_number_id || a.display_number} value={a.display_number}>{a.display_number}</option>)}
                      </select>
                    ) : (
                      <input style={inp} value={number} onChange={(e) => setNumber(e.target.value)} placeholder="e.g. 9898273686" />
                    )}
                  </div>
                  <div>
                    <label style={lbl}>City</label>
                    <input style={inp} value={city} onChange={(e) => setCity(e.target.value)} placeholder="Ahmedabad" />
                  </div>
                </div>
                <div style={{ marginTop: 12 }}>
                  <label style={lbl}>Board / location name</label>
                  <input style={inp} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Ring Road" />
                </div>
                <div style={{ marginTop: 12 }}>
                  <label style={lbl}>Leads from this board route to</label>
                  <select style={inp} value={tcId} onChange={(e) => setTcId(e.target.value)}>
                    <option value="">— pick a telecaller —</option>
                    {tcs.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                  </select>
                  {tcs.length === 0 && (
                    <div style={{ fontSize: 11, color: 'var(--v2-ink-2)', marginTop: 5 }}>
                      No telecallers found.
                    </div>
                  )}
                </div>
                <div style={{ marginTop: 12 }}>
                  <label style={lbl}>{editingId ? 'Code (fixed)' : 'Code (auto, editable)'}</label>
                  <input
                    style={{ ...inp, ...(editingId ? { opacity: 0.6, cursor: 'not-allowed' } : {}) }}
                    value={code}
                    readOnly={!!editingId}
                    onChange={(e) => { if (!editingId) { setCode(e.target.value); setCodeEdited(true) } }}
                  />
                  {editingId && <div style={{ marginTop: 5, fontSize: 11, color: 'var(--v2-ink-2)' }}>Fixed — the printed QR keeps working, no reprint.</div>}
                </div>
                <div style={{ marginTop: 12 }}>
                  <label style={lbl}>Pre-filled WhatsApp message</label>
                  <textarea style={{ ...inp, height: 64, padding: '9px 12px', resize: 'none' }} value={message} onChange={(e) => { setMessage(e.target.value); setMsgEdited(true) }} />
                </div>
                <div style={{ marginTop: 16, display: 'flex', gap: 10 }}>
                  <button type="button" style={{ ...btnY, opacity: saving ? 0.6 : 1 }} onClick={saveBoard} disabled={saving}>
                    {saving ? <Loader2 size={14} className="spin" /> : editingId ? <Pencil size={14} strokeWidth={1.6} /> : <Plus size={14} strokeWidth={1.6} />} {editingId ? 'Save changes' : 'Save board'}
                  </button>
                  <button style={btnG} onClick={() => downloadFromRef(previewRef, code)}><Download size={14} strokeWidth={1.6} /> PNG</button>
                </div>
              </div>
              <div style={{ flex: '0 0 220px', textAlign: 'center' }}>
                <div style={{ fontSize: 11, color: 'var(--v2-ink-2)', textTransform: 'uppercase', letterSpacing: '.08em', fontWeight: 600, marginBottom: 10 }}>Live preview</div>
                <div ref={previewRef} style={{ background: 'white', borderRadius: 10, padding: 14, display: 'inline-block' }}>
                  {waUrl ? (
                    <Suspense fallback={<div style={{ width: 180, height: 180 }} />}><QRCodeCanvas value={qrValue(code)} size={180} /></Suspense>
                  ) : (
                    <div style={{ width: 180, height: 180, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--v2-ink-2, #6a7590)', fontSize: 12 }}>Enter a number</div>
                  )}
                </div>
                <div style={{ fontSize: 10.5, color: 'var(--v2-ink-2)', marginTop: 8, wordBreak: 'break-all' }}>{waUrl ? qrValue(code) : '—'}</div>
              </div>
            </div>
          </div>
        </div>
      )}

      <style>{`@keyframes spin{to{transform:rotate(360deg)}} .spin{animation:spin 1s linear infinite} .qr-row:hover td{background:rgba(255,255,255,.015)}`}</style>
    </CampaignChrome>
  )
}

function BoardThumb({ qr }) {
  if (!qr) return <div style={{ width: 40, height: 40, borderRadius: 10, background: 'var(--v2-bg-2)' }} />
  return (
    <div style={{ background: 'white', borderRadius: 10, padding: 4, width: 40, height: 40, display: 'inline-flex' }}>
      <Suspense fallback={<div style={{ width: 32, height: 32 }} />}><QRCodeCanvas value={qr} size={32} /></Suspense>
    </div>
  )
}

function BoardDownload({ board, qr }) {
  const ref = useRef(null)
  function dl() {
    const c = ref.current?.querySelector('canvas')
    if (!c) return
    const a = document.createElement('a'); a.href = c.toDataURL('image/png'); a.download = `qr-${board.code}.png`; a.click()
  }
  return (
    <>
      <span ref={ref} style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden' }}>
        {qr && <Suspense fallback={null}><QRCodeCanvas value={qr} size={256} /></Suspense>}
      </span>
      <button type="button" style={{ ...btnG, height: 30, fontSize: 12, padding: '0 10px' }} onClick={dl}><Download size={13} strokeWidth={1.6} /> PNG</button>
    </>
  )
}

// ─── inline styles ───────────────────────────────────────────────────────
const panel = { background: 'var(--v2-bg-1, #0f1525)', border: '1px solid var(--v2-line, #1f2b47)', borderRadius: 14, padding: 18 }
const banner = { ...panel, borderColor: 'var(--v2-amber, #F59E0B)', background: 'var(--v2-amber-soft, rgba(245,158,11,0.12))', display: 'flex', gap: 10, alignItems: 'flex-start' }
const lbl = { fontSize: 11, color: 'var(--v2-ink-2, #6a7590)', textTransform: 'uppercase', letterSpacing: '.08em', fontWeight: 600, marginBottom: 6, display: 'block' }
const inp = { width: '100%', height: 38, padding: '0 12px', background: 'var(--v2-bg-2, #1a2742)', border: '1px solid var(--v2-line, #1f2b47)', borderRadius: 10, color: 'var(--v2-ink-0, #f5f7fb)', fontSize: 13, outline: 'none', fontFamily: 'inherit' }
const btnY = { background: 'var(--v2-yellow, #FFE600)', color: 'var(--accent-fg, #0b1220)', border: 'none', borderRadius: 10, height: 38, padding: '0 16px', fontWeight: 700, fontSize: 13, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }
const btnG = { background: 'transparent', color: 'var(--v2-ink-1, #a9b3c7)', border: '1px solid var(--v2-line, #1f2b47)', borderRadius: 10, height: 38, padding: '0 14px', fontWeight: 600, fontSize: 13, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }
const th = { padding: '11px 16px', textAlign: 'left', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--v2-ink-2, #6a7590)', borderBottom: '1px solid var(--v2-line, #1f2b47)', whiteSpace: 'nowrap', background: 'rgba(255,255,255,.02)' }
const td = { padding: '12px 16px', borderBottom: '1px solid var(--v2-line, #1f2b47)', fontSize: 13, color: 'var(--v2-ink-1, #a9b3c7)', verticalAlign: 'middle', position: 'relative' }
const numTd = (n) => ({ ...td, textAlign: 'right', fontFamily: 'var(--v2-display)', fontWeight: 700, color: n ? 'var(--v2-ink-0, #f5f7fb)' : 'var(--v2-ink-2, #6a7590)' })
const tcPill = { display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5, color: 'var(--v2-ink-1, #a9b3c7)', background: 'var(--v2-bg-2, #1a2742)', border: '1px solid var(--v2-line, #1f2b47)', padding: '3px 9px', borderRadius: 999 }
const tcAv = { width: 18, height: 18, borderRadius: 999, background: 'var(--v2-blue-soft, rgba(96,165,250,0.16))', color: 'var(--v2-blue, #60a5fa)', fontSize: 9, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }
const overlay = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)', zIndex: 9000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '60px 16px', overflowY: 'auto' }
const modalBox = { width: '100%', maxWidth: 620, background: 'var(--v2-bg-1, #0f1525)', border: '1px solid var(--v2-line, #1f2b47)', borderRadius: 14, boxShadow: '0 24px 60px rgba(0,0,0,.5)' }
