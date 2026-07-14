// src/pages/v2/CampaignClientQrV2.jsx
//
// Campaign Module — Client QRs (token-free, additive).
//
// A QR-as-a-service the owner makes FOR a client: enter the client's WhatsApp
// number → a TRACKED QR (encodes /api/q/<CODE>, logs a scan, then bounces to
// the client's wa.me). The owner can tell the client "your QR got N scans".
// These are NOT the owner's lead-gen boards — no campaign, no routing, the
// chat lands in the CLIENT's WhatsApp, never the owner's webhook (so no lead
// pollution). Distinguished from own boards by campaign_locations.client_name
// being set.
//
// Admin / co_owner only. Saving writes ONE campaign_locations row; reads
// campaign_locations + qr_scans. Touches NO existing flow (§45). qrcode.react
// is lazy-loaded (rep bundles unchanged).

import { useState, useEffect, useMemo, useRef, lazy, Suspense } from 'react'
import { Plus, Download, Loader2, AlertTriangle, RefreshCw, X, Trash2, QrCode, Pencil } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import CampaignChrome from '../../components/v2/CampaignChrome'
import { pushToast, toastError, toastSuccess } from '../../components/v2/Toast'
import { confirmDialog } from '../../components/v2/ConfirmDialog'

const QRCodeCanvas = lazy(() => import('qrcode.react').then((m) => ({ default: m.QRCodeCanvas })))

function digitsToWa(raw) {
  const d = String(raw || '').replace(/\D/g, '')
  return d.length === 10 ? '91' + d : d
}
// Phase 231 — a client QR can target a plain LINK, not just WhatsApp. Normalise
// the owner's input into a redirect URL: keep an explicit http(s) scheme, or
// prepend https:// to a bare domain ("acme.com/x"). Returns '' if it isn't a URL.
function normalizeUrl(raw) {
  const s = String(raw || '').trim()
  if (!s) return ''
  if (/^https?:\/\//i.test(s)) return s
  if (/^[\w-]+(\.[\w-]+)+([/?#].*)?$/i.test(s)) return 'https://' + s
  return ''
}
function fmtDate(iso) {
  try { return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) } catch { return '—' }
}
function fmtPhone(raw) {
  const d = String(raw || '').replace(/\D/g, '')
  if (d.length === 12 && d.startsWith('91')) return `+91 ${d.slice(2, 7)} ${d.slice(7)}`
  if (d.length === 10) return `+91 ${d.slice(0, 5)} ${d.slice(5)}`
  return d ? `+${d}` : '—'
}

export default function CampaignClientQrV2() {
  const [loading, setLoading] = useState(true)
  const [tablesMissing, setTablesMissing] = useState(false)
  const [rows, setRows] = useState([])
  const [scansByQr, setScansByQr] = useState({})
  const [saving, setSaving] = useState(false)
  const [showModal, setShowModal] = useState(false)

  const [clientName, setClientName] = useState('')
  const [qrType, setQrType] = useState('whatsapp') // 'whatsapp' | 'link' (Phase 231)
  const [number, setNumber] = useState('')
  const [message, setMessage] = useState('')
  const [linkUrl, setLinkUrl] = useState('')
  const [codeSuffix, setCodeSuffix] = useState('01') // stable per modal-open → unique code, survives deletes
  const [editingId, setEditingId] = useState(null)   // null = create; row id = editing (Phase 232)
  const [editingCode, setEditingCode] = useState('') // the existing code — FIXED on edit so the printed QR keeps working
  const previewRef = useRef(null)

  async function load() {
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('campaign_locations')
        .select('id, client_name, code, qr_text, created_at')
        .not('client_name', 'is', null)
        .order('created_at', { ascending: false })
      if (error) {
        if (error.code === '42P01' || /does not exist|schema cache|client_name|column/i.test(error.message || '')) {
          setTablesMissing(true); setLoading(false); return
        }
        throw error
      }
      const list = data || []
      setRows(list)

      if (list.length) {
        const ids = list.map((r) => r.id)
        const { data: scans } = await supabase.from('qr_scans').select('location_id').in('location_id', ids)
        const sb = {}
        ;(scans || []).forEach((s) => { if (s.location_id) sb[s.location_id] = (sb[s.location_id] || 0) + 1 })
        setScansByQr(sb)
      } else {
        setScansByQr({})
      }
    } catch (err) {
      toastError(err, 'Could not load client QRs.')
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() /* eslint-disable-next-line */ }, [])

  const waNumber = digitsToWa(number)
  const waUrl = useMemo(
    () => (waNumber ? `https://wa.me/${waNumber}${message.trim() ? `?text=${encodeURIComponent(message.trim())}` : ''}` : ''),
    [waNumber, message]
  )
  // Phase 231 — the QR's redirect target: a WhatsApp link OR a plain URL.
  // Stored verbatim in campaign_locations.qr_text; /api/q/<code> 302s to it.
  const linkTarget = useMemo(() => normalizeUrl(linkUrl), [linkUrl])
  const target = qrType === 'link' ? linkTarget : waUrl
  const nextCode = useMemo(() => {
    const slug = String(clientName || 'client').replace(/[^a-zA-Z]/g, '').slice(0, 4).toUpperCase() || 'CLNT'
    return `CL-${slug}-${codeSuffix}`
  }, [clientName, codeSuffix])
  // On edit the code is FIXED (an already-printed QR encodes /api/q/<code> — keep
  // it so re-pointing the target needs NO reprint). New rows get nextCode.
  const displayCode = editingId ? editingCode : nextCode

  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://app.untitledad.in'
  const qrValue = (c) => (c ? `${origin}/api/q/${encodeURIComponent(c)}` : '')

  function downloadFromRef(ref, fileCode) {
    const canvas = ref?.current?.querySelector('canvas')
    if (!canvas) { pushToast('QR not ready yet — try again.', 'info'); return }
    const a = document.createElement('a')
    a.href = canvas.toDataURL('image/png'); a.download = `qr-${fileCode || 'client'}.png`; a.click()
  }

  async function saveClient() {
    if (!clientName.trim()) { pushToast('Enter the client name.', 'danger'); return }
    if (qrType === 'whatsapp') {
      if (!waNumber || waNumber.replace(/\D/g, '').length < 10) { pushToast('Enter a valid WhatsApp number.', 'danger'); return }
    } else {
      if (!target) { pushToast('Enter a valid link (e.g. https://…).', 'danger'); return }
    }
    setSaving(true)
    try {
      let error
      if (editingId) {
        // UPDATE — keep the code fixed (the printed QR keeps working; only the
        // name + redirect target change). No reprint needed.
        ;({ error } = await supabase.from('campaign_locations')
          .update({ client_name: clientName.trim(), label: clientName.trim(), qr_text: target })
          .eq('id', editingId))
      } else {
        ;({ error } = await supabase.from('campaign_locations').insert({
          client_name: clientName.trim(),
          code: nextCode,
          label: clientName.trim(),
          qr_text: target,
          campaign_id: null,
          is_active: true,
        }))
      }
      if (error) {
        if (error.code === '23505') { toastError(error, 'That code already exists — change the client name slightly.'); return }
        throw error
      }
      toastSuccess(editingId ? 'Client QR updated.' : 'Client QR created.')
      setClientName(''); setNumber(''); setMessage(''); setLinkUrl(''); setQrType('whatsapp')
      setEditingId(null); setEditingCode(''); setShowModal(false)
      load()
    } catch (err) {
      toastError(err, 'Could not create the client QR.')
    } finally {
      setSaving(false)
    }
  }

  async function deleteClient(row) {
    const ok = await confirmDialog({
      title: 'Delete this client QR?',
      message: `Delete the QR for "${row.client_name}" (${row.code})? Its scan history is removed. This can't be undone.`,
      confirmLabel: 'Delete', danger: true,
    })
    if (!ok) return
    const { error } = await supabase.from('campaign_locations').delete().eq('id', row.id)
    if (error) { toastError(error, 'Could not delete.'); return }
    toastSuccess('Client QR deleted.')
    load()
  }

  function openModal() {
    // Clean-slate NEW. unique code suffix generated ONCE per open (not in render)
    // so the code survives deletes + the preview/download/saved code all match.
    setEditingId(null); setEditingCode('')
    setClientName(''); setQrType('whatsapp'); setNumber(''); setMessage(''); setLinkUrl('')
    setCodeSuffix(Math.random().toString(36).slice(2, 6).toUpperCase())
    setShowModal(true)
  }

  // Phase 232 — EDIT an existing client QR. Parse qr_text back into the form.
  // The code stays fixed (already-printed QR keeps working; only the redirect
  // changes) so re-pointing needs no reprint.
  function openEdit(row) {
    setEditingId(row.id)
    setEditingCode(row.code)
    setClientName(row.client_name || '')
    const t = String(row.qr_text || '')
    const waM = t.match(/wa\.me\/(\d+)/)
    if (waM) {
      const n = waM[1]
      setQrType('whatsapp')
      setNumber(n.length === 12 && n.startsWith('91') ? n.slice(2) : n)
      const tx = t.match(/[?&]text=([^&]+)/)
      setMessage(tx ? (() => { try { return decodeURIComponent(tx[1]) } catch { return '' } })() : '')
      setLinkUrl('')
    } else {
      setQrType('link')
      setLinkUrl(t)
      setNumber(''); setMessage('')
    }
    setShowModal(true)
  }
  const newBtn = (
    <button type="button" style={btnY} onClick={openModal}><Plus size={14} strokeWidth={1.6} /> New client QR</button>
  )

  if (tablesMissing) {
    return (
      <CampaignChrome active="clients" title="Client QRs" right={newBtn}>
        <div style={banner}>
          <AlertTriangle size={18} strokeWidth={1.6} style={{ color: 'var(--v2-amber, #F59E0B)', flexShrink: 0, marginTop: 1 }} />
          <div style={{ fontSize: 13, color: 'var(--v2-ink-1, #a9b3c7)' }}>
            Run <b style={{ color: 'var(--v2-ink-0, #f5f7fb)' }}>supabase_campaign_client_qr.sql</b> + <b style={{ color: 'var(--v2-ink-0, #f5f7fb)' }}>supabase_campaign_qr_scans.sql</b> in Supabase Studio, then reload.
          </div>
        </div>
      </CampaignChrome>
    )
  }

  return (
    <CampaignChrome
      active="clients"
      title="Client QRs"
      sub="Make a tracked QR for a client (e.g. a QR in their video). Point it at their WhatsApp number OR any link (website, video, form) — the QR counts every scan, so you can report the reach, then opens the target. No lead routing; WhatsApp chats land in the client's own WhatsApp."
      right={newBtn}
    >
      <div style={{ ...panel, padding: 0 }}>
        <div style={{ padding: '13px 18px', borderBottom: '1px solid var(--v2-line)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontFamily: 'var(--v2-display)', fontWeight: 600, color: 'var(--v2-ink-0)', fontSize: 14 }}>
            Client QRs{!loading && ` · ${rows.length}`}
          </span>
          <button type="button" style={btnG} onClick={load}><RefreshCw size={14} strokeWidth={1.6} /> Refresh</button>
        </div>

        {loading ? (
          <div style={{ padding: 44, textAlign: 'center' }}><Loader2 size={20} strokeWidth={1.6} className="spin" style={{ color: 'var(--v2-yellow, #FFE600)' }} /></div>
        ) : rows.length === 0 ? (
          <div style={{ padding: 44, textAlign: 'center', color: 'var(--v2-ink-2)', fontSize: 13 }}>
            <QrCode size={22} strokeWidth={1.6} style={{ opacity: 0.5 }} />
            <div style={{ marginTop: 8 }}>No client QRs yet. Tap <b style={{ color: 'var(--v2-ink-1)' }}>New client QR</b> to make one.</div>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr>
                  <th style={{ ...th, width: 48 }}></th>
                  <th style={th}>Client</th>
                  <th style={th}>Opens</th>
                  <th style={{ ...th, textAlign: 'right' }}>Scans</th>
                  <th style={th}>Created</th>
                  <th style={{ ...th, textAlign: 'right' }}></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const scans = scansByQr[r.id] || 0
                  const qt = String(r.qr_text || '')
                  const waM = qt.match(/wa\.me\/(\d+)/)
                  return (
                    <tr key={r.id} className="cl-row">
                      <td style={{ ...td, padding: '8px 16px' }}><Thumb qr={qrValue(r.code)} /></td>
                      <td style={td}>
                        <div style={{ fontWeight: 600, color: 'var(--v2-ink-0, #f5f7fb)' }}>{r.client_name}</div>
                        <div style={{ fontSize: 10.5, color: 'var(--v2-ink-2)', letterSpacing: '.04em', marginTop: 2 }}>{r.code}</div>
                      </td>
                      <td style={td}>
                        {waM
                          ? <span style={{ fontFamily: 'var(--v2-display)' }}>{fmtPhone(waM[1])}</span>
                          : qt
                            ? <a href={qt} target="_blank" rel="noreferrer" style={{ color: 'var(--v2-ink-1)', textDecoration: 'none', wordBreak: 'break-all' }}>{qt.replace(/^https?:\/\//, '')}</a>
                            : '—'}
                      </td>
                      <td style={{ ...td, textAlign: 'right', fontFamily: 'var(--v2-display)', fontWeight: 700, color: scans ? 'var(--v2-ink-0, #f5f7fb)' : 'var(--v2-ink-2, #6a7590)' }}>{scans}</td>
                      <td style={td}>{fmtDate(r.created_at)}</td>
                      <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                        <Dl code={r.code} qr={qrValue(r.code)} />
                        <button type="button" title="Edit" onClick={() => openEdit(r)} style={{ ...btnG, height: 30, fontSize: 12, padding: '0 8px', marginLeft: 6 }}>
                          <Pencil size={13} strokeWidth={1.6} />
                        </button>
                        <button type="button" title="Delete" onClick={() => deleteClient(r)} style={{ ...btnG, height: 30, fontSize: 12, padding: '0 8px', marginLeft: 6, color: 'var(--v2-rose, #f87171)' }}>
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
      </div>

      <p style={{ fontSize: 11.5, color: 'var(--v2-ink-2)', margin: '14px 0 0', lineHeight: 1.6 }}>
        Same tracker as your boards — a scan hits /api/q/&lt;code&gt;, logs one scan, then opens the target (WhatsApp or a link). <b style={{ color: 'var(--v2-ink-1)' }}>Editing re-points the SAME QR</b> — the code is fixed, so an already-printed QR keeps working with no reprint. Only download the PNG for a brand-new QR.
      </p>

      {showModal && (
        <div style={overlay} onClick={() => setShowModal(false)}>
          <div style={modalBox} onClick={(e) => e.stopPropagation()}>
            <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--v2-line)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontFamily: 'var(--v2-display)', fontWeight: 600, color: 'var(--v2-ink-0)', fontSize: 15 }}>{editingId ? 'Edit client QR' : 'New client QR'}</span>
              <button type="button" onClick={() => setShowModal(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--v2-ink-2)', display: 'flex' }}><X size={18} strokeWidth={1.6} /></button>
            </div>
            <div style={{ padding: 18, display: 'flex', gap: 18, flexWrap: 'wrap' }}>
              <div style={{ flex: '1 1 280px', minWidth: 240 }}>
                <div>
                  <label style={lbl}>Client name</label>
                  <input style={inp} value={clientName} onChange={(e) => setClientName(e.target.value)} placeholder="e.g. Sharma Motors" />
                </div>
                <div style={{ marginTop: 12 }}>
                  <label style={lbl}>QR opens</label>
                  <div style={seg}>
                    <button type="button" onClick={() => setQrType('whatsapp')} style={qrType === 'whatsapp' ? segOn : segOff}>WhatsApp number</button>
                    <button type="button" onClick={() => setQrType('link')} style={qrType === 'link' ? segOn : segOff}>Link</button>
                  </div>
                </div>
                {qrType === 'whatsapp' ? (
                  <>
                    <div style={{ marginTop: 12 }}>
                      <label style={lbl}>Client&rsquo;s WhatsApp number</label>
                      <input style={inp} value={number} onChange={(e) => setNumber(e.target.value)} placeholder="e.g. 9898273686" />
                    </div>
                    <div style={{ marginTop: 12 }}>
                      <label style={lbl}>Pre-filled message (optional)</label>
                      <textarea style={{ ...inp, height: 56, padding: '9px 12px', resize: 'none' }} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Hi, saw your video…" />
                    </div>
                  </>
                ) : (
                  <div style={{ marginTop: 12 }}>
                    <label style={lbl}>Link (website, video, form…)</label>
                    <input style={inp} value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} placeholder="e.g. https://youtu.be/… or acme.com/offer" />
                    <div style={{ marginTop: 6, fontSize: 10.5, color: 'var(--v2-ink-2)', wordBreak: 'break-all' }}>
                      {linkUrl.trim() && !target
                        ? <span style={{ color: 'var(--v2-rose, #f87171)' }}>Not a valid link.</span>
                        : target
                          ? <>Opens: <b style={{ color: 'var(--v2-ink-1)' }}>{target}</b></>
                          : 'Any http(s) link. A scan still counts before it opens.'}
                    </div>
                  </div>
                )}
                <div style={{ marginTop: 10, fontSize: 11, color: 'var(--v2-ink-2)' }}>
                  Code: <b style={{ color: 'var(--v2-ink-1)' }}>{displayCode}</b>
                  {editingId && <span style={{ marginLeft: 8, color: 'var(--v2-ink-2)' }}>· fixed — the printed QR keeps working, no reprint</span>}
                </div>
                <div style={{ marginTop: 16, display: 'flex', gap: 10 }}>
                  <button type="button" style={{ ...btnY, opacity: saving ? 0.6 : 1 }} onClick={saveClient} disabled={saving}>
                    {saving ? <Loader2 size={14} strokeWidth={1.6} className="spin" /> : editingId ? <Pencil size={14} strokeWidth={1.6} /> : <Plus size={14} strokeWidth={1.6} />} {editingId ? 'Save changes' : 'Create QR'}
                  </button>
                  <button type="button" style={btnG} onClick={() => downloadFromRef(previewRef, displayCode)}><Download size={14} strokeWidth={1.6} /> PNG</button>
                </div>
              </div>
              <div style={{ flex: '0 0 200px', textAlign: 'center' }}>
                <div style={{ fontSize: 11, color: 'var(--v2-ink-2)', textTransform: 'uppercase', letterSpacing: '.08em', fontWeight: 600, marginBottom: 10 }}>Live preview</div>
                <div ref={previewRef} style={{ background: 'white', borderRadius: 10, padding: 14, display: 'inline-block' }}>
                  {target ? (
                    <Suspense fallback={<div style={{ width: 170, height: 170 }} />}><QRCodeCanvas value={qrValue(displayCode)} size={170} /></Suspense>
                  ) : (
                    <div style={{ width: 170, height: 170, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--v2-ink-2, #6a7590)', fontSize: 12 }}>{qrType === 'link' ? 'Enter a link' : 'Enter a number'}</div>
                  )}
                </div>
                <div style={{ fontSize: 10.5, color: 'var(--v2-ink-2)', marginTop: 8, wordBreak: 'break-all' }}>{target ? qrValue(displayCode) : '—'}</div>
              </div>
            </div>
          </div>
        </div>
      )}

      <style>{`@keyframes spin{to{transform:rotate(360deg)}} .spin{animation:spin 1s linear infinite} .cl-row:hover td{background:rgba(255,255,255,.015)}`}</style>
    </CampaignChrome>
  )
}

function Thumb({ qr }) {
  if (!qr) return <div style={{ width: 40, height: 40, borderRadius: 10, background: 'var(--v2-bg-2)' }} />
  return (
    <div style={{ background: 'white', borderRadius: 10, padding: 4, width: 40, height: 40, display: 'inline-flex' }}>
      <Suspense fallback={<div style={{ width: 32, height: 32 }} />}><QRCodeCanvas value={qr} size={32} /></Suspense>
    </div>
  )
}

function Dl({ code, qr }) {
  const ref = useRef(null)
  function dl() {
    const c = ref.current?.querySelector('canvas')
    if (!c) return
    const a = document.createElement('a'); a.href = c.toDataURL('image/png'); a.download = `qr-${code}.png`; a.click()
  }
  return (
    <>
      <span ref={ref} style={{ position: 'absolute', left: -9999, top: 0, width: 256, height: 256, overflow: 'hidden', pointerEvents: 'none' }}>
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
const seg = { display: 'flex', gap: 4, background: 'var(--v2-bg-2, #1a2742)', border: '1px solid var(--v2-line, #1f2b47)', borderRadius: 10, padding: 3 }
const segBase = { flex: 1, height: 32, borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 12.5, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }
const segOn = { ...segBase, background: 'var(--v2-yellow, #FFE600)', color: 'var(--accent-fg, #0b1220)', fontWeight: 700 }
const segOff = { ...segBase, background: 'transparent', color: 'var(--v2-ink-1, #a9b3c7)', fontWeight: 600 }
const th = { padding: '11px 16px', textAlign: 'left', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--v2-ink-2, #6a7590)', borderBottom: '1px solid var(--v2-line, #1f2b47)', whiteSpace: 'nowrap', background: 'rgba(255,255,255,.02)' }
const td = { padding: '12px 16px', borderBottom: '1px solid var(--v2-line, #1f2b47)', fontSize: 13, color: 'var(--v2-ink-1, #a9b3c7)', verticalAlign: 'middle', position: 'relative' }
const overlay = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)', zIndex: 9000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '60px 16px', overflowY: 'auto' }
const modalBox = { width: '100%', maxWidth: 580, background: 'var(--v2-bg-1, #0f1525)', border: '1px solid var(--v2-line, #1f2b47)', borderRadius: 14, boxShadow: '0 24px 60px rgba(0,0,0,.5)' }
