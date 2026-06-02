// src/pages/v2/CampaignQrV2.jsx
//
// Campaign Module — QR & Locations (token-free, additive).
//
// Admin makes a "board" (a physical OOH location). The page builds a WhatsApp
// click-to-chat link carrying a hidden location tag, renders a QR, and lets the
// admin download a printable PNG to put on the hoarding. A scan opens WhatsApp on
// the customer's phone pointed at your number with the tag pre-filled — so when
// the lead chats, you know which board pulled it.
//
// NEEDS NO WhatsApp API / token. Saving a board writes ONE row to the new
// campaign_locations table (Phase C2). Touches NO existing flow.
//
// §45 no-slowdown: qrcode.react is lazy-loaded (its own chunk), so rep-facing
// bundles (/work, /telecaller, lead detail) are byte-unchanged — the lib only
// downloads when an admin opens this page.

import { useState, useEffect, useMemo, useRef, lazy, Suspense } from 'react'
import { QrCode, Plus, Download, Loader2, AlertTriangle, MapPin, RefreshCw } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { pushToast, toastError, toastSuccess } from '../../components/v2/Toast'

// lazy chunk — keeps the QR lib OFF every rep bundle
const QRCodeCanvas = lazy(() =>
  import('qrcode.react').then((m) => ({ default: m.QRCodeCanvas }))
)

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
  const [saving, setSaving] = useState(false)

  const [number, setNumber] = useState('')
  const [label, setLabel] = useState('')
  const [city, setCity] = useState('')
  const [code, setCode] = useState('')
  const [message, setMessage] = useState('')
  const [campaignId, setCampaignId] = useState('')
  const [codeEdited, setCodeEdited] = useState(false)
  const [msgEdited, setMsgEdited] = useState(false)
  const previewRef = useRef(null)

  async function load() {
    setLoading(true)
    try {
      const { data: locs, error: e1 } = await supabase
        .from('campaign_locations')
        .select('id, code, label, city, qr_text, is_active, created_at')
        .order('created_at', { ascending: false })
      if (e1) {
        if (e1.code === '42P01' || /does not exist|schema cache/i.test(e1.message || '')) {
          setTablesMissing(true); setLoading(false); return
        }
        throw e1
      }
      setBoards(locs || [])
      const { data: accs } = await supabase
        .from('whatsapp_accounts')
        .select('display_number, phone_number_id, is_active')
      const list = (accs || []).filter((a) => a.is_active !== false)
      setAccounts(list)
      if (!number && list[0]?.display_number) setNumber(list[0].display_number)
      const { data: camps } = await supabase
        .from('campaigns').select('id, name').eq('is_active', true).order('name')
      setCampaigns(camps || [])
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

  function downloadFromRef(ref, fileCode) {
    const canvas = ref?.current?.querySelector('canvas')
    if (!canvas) { pushToast('QR not ready yet — try again.', 'info'); return }
    const a = document.createElement('a')
    a.href = canvas.toDataURL('image/png')
    a.download = `qr-${fileCode || 'board'}.png`
    a.click()
  }

  async function saveBoard() {
    if (!waNumber) { pushToast('Enter the WhatsApp number first.', 'danger'); return }
    if (!label.trim()) { pushToast('Enter a board / location name.', 'danger'); return }
    if (!code.trim()) { pushToast('Code is required.', 'danger'); return }
    setSaving(true)
    try {
      const { error } = await supabase.from('campaign_locations').insert({
        code: code.trim(), label: label.trim(), city: city.trim() || null,
        qr_text: waUrl, campaign_id: campaignId || null, is_active: true,
      })
      if (error) {
        if (error.code === '23505') { toastError(error, 'That code already exists — pick a different one.'); return }
        throw error
      }
      toastSuccess('Board QR saved.')
      setLabel(''); setCity(''); setCodeEdited(false); setMsgEdited(false)
      load()
    } catch (err) {
      toastError(err, 'Could not save board.')
    } finally {
      setSaving(false)
    }
  }

  const panel = { background: 'var(--v2-bg-1,#0f1525)', border: '1px solid var(--v2-line,#1f2a44)', borderRadius: 14, padding: 20 }
  const lbl = { fontSize: 11, color: 'var(--v2-ink-2,#6a7590)', textTransform: 'uppercase', letterSpacing: '.08em', fontWeight: 600, marginBottom: 6, display: 'block' }
  const inp = { width: '100%', height: 38, padding: '0 12px', background: 'var(--v2-bg-2,#141b2d)', border: '1px solid var(--v2-line,#1f2a44)', borderRadius: 10, color: 'var(--v2-ink-0,#f1f5f9)', fontSize: 13, outline: 'none', fontFamily: 'inherit' }
  const btnY = { background: 'var(--v2-yellow,#FFE600)', color: '#0b1220', border: 'none', borderRadius: 10, height: 38, padding: '0 16px', fontWeight: 700, fontSize: 13, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }
  const btnG = { background: 'transparent', color: 'var(--v2-ink-1,#a9b3c7)', border: '1px solid var(--v2-line,#1f2a44)', borderRadius: 10, height: 38, padding: '0 14px', fontWeight: 600, fontSize: 13, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }
  const spin = { animation: 'spin 1s linear infinite' }

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '24px 20px 80px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
        <QrCode size={22} />
        <h1 style={{ fontFamily: 'var(--v2-display)', fontSize: 24, fontWeight: 700, color: 'var(--v2-ink-0,#f1f5f9)', margin: 0 }}>Campaign QR &amp; Locations</h1>
      </div>
      <p style={{ fontSize: 13, color: 'var(--v2-ink-2,#6a7590)', margin: '0 0 20px', maxWidth: 700 }}>
        Make a QR for each board. Print it on the hoarding — a scan opens WhatsApp on your number with a hidden location tag, so when the lead chats you know which board pulled it. Works today, no setup needed.
      </p>

      {tablesMissing && (
        <div style={{ ...panel, borderColor: 'var(--v2-amber,#F59E0B)', background: 'rgba(245,158,11,0.12)', marginBottom: 18, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          <AlertTriangle size={18} style={{ color: 'var(--v2-amber,#F59E0B)', flexShrink: 0, marginTop: 1 }} />
          <div style={{ fontSize: 13, color: 'var(--v2-ink-1,#a9b3c7)' }}>
            The campaign tables aren&rsquo;t in the database yet. Run <b style={{ color: 'var(--v2-ink-0)' }}>supabase_campaign_c2_foundation.sql</b> in Supabase Studio, then reload this page.
          </div>
        </div>
      )}

      {loading ? (
        <div style={{ ...panel, textAlign: 'center', color: 'var(--v2-ink-2)' }}>
          <Loader2 size={20} style={spin} /> Loading…
        </div>
      ) : tablesMissing ? null : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 18, alignItems: 'start' }}>
          <div style={panel}>
            <div style={{ fontFamily: 'var(--v2-display)', fontSize: 15, fontWeight: 600, color: 'var(--v2-ink-0)', marginBottom: 14 }}>New board QR</div>
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
            {campaigns.length > 0 && (
              <div style={{ marginTop: 12 }}>
                <label style={lbl}>Campaign (optional)</label>
                <select style={inp} value={campaignId} onChange={(e) => setCampaignId(e.target.value)}>
                  <option value="">— none —</option>
                  {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 }}>
              <div>
                <label style={lbl}>Code (auto, editable)</label>
                <input style={inp} value={code} onChange={(e) => { setCode(e.target.value); setCodeEdited(true) }} />
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-end' }}>
                <span style={{ fontSize: 11, color: 'var(--v2-ink-2)' }}>City tags the lead so it routes to that city&rsquo;s telecaller later.</span>
              </div>
            </div>
            <div style={{ marginTop: 12 }}>
              <label style={lbl}>Pre-filled WhatsApp message</label>
              <textarea style={{ ...inp, height: 64, padding: '9px 12px', resize: 'none' }} value={message} onChange={(e) => { setMessage(e.target.value); setMsgEdited(true) }} />
            </div>
            <div style={{ marginTop: 16, display: 'flex', gap: 10 }}>
              <button style={{ ...btnY, opacity: saving ? 0.6 : 1 }} onClick={saveBoard} disabled={saving}>
                {saving ? <Loader2 size={14} style={spin} /> : <Plus size={14} />} Save board
              </button>
              <button style={btnG} onClick={() => downloadFromRef(previewRef, code)}><Download size={14} /> Download PNG</button>
            </div>
          </div>

          <div style={{ ...panel, textAlign: 'center' }}>
            <div style={{ fontSize: 11, color: 'var(--v2-ink-2)', textTransform: 'uppercase', letterSpacing: '.08em', fontWeight: 600, marginBottom: 12 }}>Live preview</div>
            <div ref={previewRef} style={{ background: 'white', borderRadius: 10, padding: 14, display: 'inline-block' }}>
              {waUrl ? (
                <Suspense fallback={<div style={{ width: 200, height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Loader2 size={20} style={{ ...spin, color: '#0b1220' }} /></div>}>
                  <QRCodeCanvas value={waUrl} size={200} />
                </Suspense>
              ) : (
                <div style={{ width: 200, height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#999', fontSize: 12 }}>Enter a number</div>
              )}
            </div>
            <div style={{ fontSize: 11, color: 'var(--v2-ink-2)', marginTop: 10, wordBreak: 'break-all', fontFamily: 'inherit' }}>{waUrl || '—'}</div>
          </div>
        </div>
      )}

      {!loading && !tablesMissing && (
        <div style={{ ...panel, marginTop: 18, padding: 0 }}>
          <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--v2-line,#1f2a44)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontFamily: 'var(--v2-display)', fontWeight: 600, color: 'var(--v2-ink-0)' }}>Saved boards · {boards.length}</span>
            <button style={btnG} onClick={load}><RefreshCw size={14} /> Refresh</button>
          </div>
          {boards.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--v2-ink-2)', fontSize: 13 }}>
              <MapPin size={22} style={{ opacity: 0.5 }} /><div style={{ marginTop: 8 }}>No boards yet. Make your first QR above.</div>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(220px,1fr))', gap: 14, padding: 18 }}>
              {boards.map((b) => <BoardCard key={b.id} board={b} btnG={btnG} />)}
            </div>
          )}
        </div>
      )}

      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  )
}

function BoardCard({ board, btnG }) {
  const ref = useRef(null)
  function dl() {
    const c = ref.current?.querySelector('canvas')
    if (!c) return
    const a = document.createElement('a'); a.href = c.toDataURL('image/png'); a.download = `qr-${board.code}.png`; a.click()
  }
  return (
    <div style={{ border: '1px solid var(--v2-line,#1f2a44)', borderRadius: 14, padding: 14, textAlign: 'center', background: 'var(--v2-bg-2,#141b2d)' }}>
      <div ref={ref} style={{ background: 'white', borderRadius: 10, padding: 10, display: 'inline-block' }}>
        {board.qr_text ? (
          <Suspense fallback={<div style={{ width: 120, height: 120 }} />}>
            <QRCodeCanvas value={board.qr_text} size={120} />
          </Suspense>
        ) : <div style={{ width: 120, height: 120 }} />}
      </div>
      <div style={{ fontWeight: 600, color: 'var(--v2-ink-0,#f1f5f9)', fontSize: 13, marginTop: 10 }}>{board.label || board.code}</div>
      <div style={{ fontSize: 11, color: 'var(--v2-ink-2,#6a7590)', fontFamily: 'inherit' }}>{board.code}{board.city ? ` · ${board.city}` : ''}</div>
      <button style={{ ...btnG, marginTop: 10, height: 30, fontSize: 12, width: '100%', justifyContent: 'center' }} onClick={dl}><Download size={14} /> PNG</button>
    </div>
  )
}
