// src/pages/v2/CampaignsV2.jsx
//
// Campaign Module — Campaigns list + create (token-free, additive).
//
// A campaign names a source + offer and sets the DEFAULT routing (which
// telecaller its leads go to) — the spine that QR boards + (later) WhatsApp
// intake hang off. Creating one writes ONE row to the new campaigns table
// (Phase C2). Reads campaigns + campaign_locations (board counts) + users
// (telecaller picker). Touches NO existing flow, NO frozen table.
//
// Routing default is owner-locked TC-first (P0-2): a campaign carries a
// default_telecaller_id; segment defaults PRIVATE. No live data flows until
// the WhatsApp token lands — this just sets up the structure safely.

import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Megaphone, Plus, Loader2, AlertTriangle, QrCode, Inbox } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/authStore'
import { pushToast, toastError, toastSuccess } from '../../components/v2/Toast'

const SOURCES = [
  { v: 'whatsapp', t: 'WhatsApp' },
  { v: 'meta', t: 'Meta (Facebook / Instagram)' },
  { v: 'justdial', t: 'Justdial' },
  { v: 'manual', t: 'Manual / Excel' },
]

export default function CampaignsV2() {
  const navigate = useNavigate()
  const profile = useAuthStore((s) => s.profile)
  const [loading, setLoading] = useState(true)
  const [tablesMissing, setTablesMissing] = useState(false)
  const [rows, setRows] = useState([])
  const [boardCounts, setBoardCounts] = useState({})
  const [tcs, setTcs] = useState([])
  const [saving, setSaving] = useState(false)

  const [name, setName] = useState('')
  const [source, setSource] = useState('whatsapp')
  const [segment, setSegment] = useState('PRIVATE')
  const [tcId, setTcId] = useState('')

  async function load() {
    setLoading(true)
    try {
      const { data: camps, error: e1 } = await supabase
        .from('campaigns')
        .select('id, name, source_type, segment, default_telecaller_id, is_active, created_at')
        .order('created_at', { ascending: false })
      if (e1) {
        if (e1.code === '42P01' || /does not exist|schema cache/i.test(e1.message || '')) {
          setTablesMissing(true); setLoading(false); return
        }
        throw e1
      }
      setRows(camps || [])

      const { data: locs } = await supabase.from('campaign_locations').select('campaign_id')
      const counts = {}
      ;(locs || []).forEach((l) => { if (l.campaign_id) counts[l.campaign_id] = (counts[l.campaign_id] || 0) + 1 })
      setBoardCounts(counts)

      const { data: us } = await supabase
        .from('users')
        .select('id, name, role, team_role, is_active')
        .or('role.eq.telecaller,team_role.eq.telecaller')
        .order('name')
      const tcList = (us || []).filter((u) => u.is_active !== false)
      setTcs(tcList)
    } catch (err) {
      toastError(err, 'Could not load campaigns.')
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() /* eslint-disable-next-line */ }, [])

  const tcName = useMemo(() => {
    const m = {}
    tcs.forEach((t) => { m[t.id] = t.name })
    return m
  }, [tcs])

  async function createCampaign() {
    if (!name.trim()) { pushToast('Enter a campaign name.', 'danger'); return }
    setSaving(true)
    try {
      const { error } = await supabase.from('campaigns').insert({
        name: name.trim(),
        source_type: source,
        segment,
        default_telecaller_id: tcId || null,
        created_by: profile?.id || null,
        is_active: true,
      })
      if (error) throw error
      toastSuccess('Campaign created.')
      setName(''); setTcId('')
      load()
    } catch (err) {
      toastError(err, 'Could not create campaign.')
    } finally {
      setSaving(false)
    }
  }

  const panel = { background: 'var(--v2-bg-1,#0f1525)', border: '1px solid var(--v2-line,#1f2a44)', borderRadius: 14, padding: 20 }
  const lbl = { fontSize: 11, color: 'var(--v2-ink-2,#6a7590)', textTransform: 'uppercase', letterSpacing: '.08em', fontWeight: 600, marginBottom: 6, display: 'block' }
  const inp = { width: '100%', height: 38, padding: '0 12px', background: 'var(--v2-bg-2,#141b2d)', border: '1px solid var(--v2-line,#1f2a44)', borderRadius: 10, color: 'var(--v2-ink-0,#f1f5f9)', fontSize: 13, outline: 'none', fontFamily: 'inherit' }
  const btnY = { background: 'var(--v2-yellow,#FFE600)', color: '#0b1220', border: 'none', borderRadius: 10, height: 38, padding: '0 16px', fontWeight: 700, fontSize: 13, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }
  const btnG = { background: 'transparent', color: 'var(--v2-ink-1,#a9b3c7)', border: '1px solid var(--v2-line,#1f2a44)', borderRadius: 10, height: 38, padding: '0 14px', fontWeight: 600, fontSize: 13, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }
  const th = { padding: '12px 16px', textAlign: 'left', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--v2-ink-2,#6a7590)', borderBottom: '1px solid var(--v2-line,#1f2a44)', whiteSpace: 'nowrap' }
  const td = { padding: '14px 16px', borderBottom: '1px solid var(--v2-line,#1f2a44)', fontSize: 13, color: 'var(--v2-ink-1,#cdd5e2)' }
  const chip = (c) => ({ display: 'inline-flex', padding: '2px 8px', borderRadius: 999, fontSize: 10, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', background: c === 'GOVERNMENT' ? 'rgba(59,130,246,0.14)' : 'rgba(255,230,0,0.14)', color: c === 'GOVERNMENT' ? 'var(--v2-blue,#60a5fa)' : 'var(--v2-yellow,#FFE600)' })
  const spin = { animation: 'spin 1s linear infinite' }

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '24px 20px 80px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 4, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Megaphone size={22} />
          <h1 style={{ fontFamily: 'var(--v2-display)', fontSize: 24, fontWeight: 700, color: 'var(--v2-ink-0,#f1f5f9)', margin: 0 }}>Campaigns</h1>
        </div>
        <button style={btnG} onClick={() => navigate('/campaigns/qr')}><QrCode size={16} /> QR &amp; Locations</button>
      </div>
      <p style={{ fontSize: 13, color: 'var(--v2-ink-2,#6a7590)', margin: '0 0 20px', maxWidth: 720 }}>
        A campaign names a source + offer and sets which telecaller its leads go to. Group your QR boards under it. Once the WhatsApp connection is live, every lead from this campaign is stamped here and routed automatically.
      </p>

      {tablesMissing && (
        <div style={{ ...panel, borderColor: 'var(--v2-amber,#F59E0B)', background: 'rgba(245,158,11,0.12)', marginBottom: 18, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          <AlertTriangle size={18} style={{ color: 'var(--v2-amber,#F59E0B)', flexShrink: 0, marginTop: 1 }} />
          <div style={{ fontSize: 13, color: 'var(--v2-ink-1,#a9b3c7)' }}>
            The campaign tables aren&rsquo;t in the database yet. Run <b style={{ color: 'var(--v2-ink-0)' }}>supabase_campaign_c2_foundation.sql</b> in Supabase Studio, then reload.
          </div>
        </div>
      )}

      {loading ? (
        <div style={{ ...panel, textAlign: 'center', color: 'var(--v2-ink-2)' }}><Loader2 size={20} style={spin} /> Loading…</div>
      ) : tablesMissing ? null : (
        <>
          <div style={{ ...panel, marginBottom: 18 }}>
            <div style={{ fontFamily: 'var(--v2-display)', fontSize: 15, fontWeight: 600, color: 'var(--v2-ink-0)', marginBottom: 14 }}>New campaign</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr 1fr', gap: 12 }}>
              <div>
                <label style={lbl}>Campaign name</label>
                <input style={inp} value={name} onChange={(e) => setName(e.target.value)} placeholder="Auto Hood · Ahmedabad" />
              </div>
              <div>
                <label style={lbl}>Source</label>
                <select style={inp} value={source} onChange={(e) => setSource(e.target.value)}>
                  {SOURCES.map((s) => <option key={s.v} value={s.v}>{s.t}</option>)}
                </select>
              </div>
              <div>
                <label style={lbl}>Segment</label>
                <select style={inp} value={segment} onChange={(e) => setSegment(e.target.value)}>
                  <option value="PRIVATE">Private</option>
                  <option value="GOVERNMENT">Government</option>
                </select>
              </div>
              <div>
                <label style={lbl}>Routes to (telecaller)</label>
                <select style={inp} value={tcId} onChange={(e) => setTcId(e.target.value)}>
                  <option value="">— pick later —</option>
                  {tcs.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
            </div>
            <div style={{ marginTop: 16 }}>
              <button style={{ ...btnY, opacity: saving ? 0.6 : 1 }} onClick={createCampaign} disabled={saving}>
                {saving ? <Loader2 size={14} style={spin} /> : <Plus size={14} />} Create campaign
              </button>
            </div>
          </div>

          <div style={{ ...panel, padding: 0 }}>
            <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--v2-line,#1f2a44)', fontFamily: 'var(--v2-display)', fontWeight: 600, color: 'var(--v2-ink-0)' }}>
              All campaigns · {rows.length}
            </div>
            {rows.length === 0 ? (
              <div style={{ padding: 40, textAlign: 'center', color: 'var(--v2-ink-2)', fontSize: 13 }}>
                <Inbox size={22} style={{ opacity: 0.5 }} /><div style={{ marginTop: 8 }}>No campaigns yet. Create your first above.</div>
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={th}>Campaign</th><th style={th}>Source</th><th style={th}>Segment</th>
                      <th style={th}>Telecaller</th><th style={{ ...th, textAlign: 'right' }}>Boards</th><th style={th}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((c) => (
                      <tr key={c.id}>
                        <td style={{ ...td, fontWeight: 600, color: 'var(--v2-ink-0,#f1f5f9)' }}>{c.name}</td>
                        <td style={td}>{(SOURCES.find((s) => s.v === c.source_type) || {}).t || c.source_type}</td>
                        <td style={td}><span style={chip(c.segment)}>{c.segment === 'GOVERNMENT' ? 'Govt' : 'Private'}</span></td>
                        <td style={td}>{c.default_telecaller_id ? (tcName[c.default_telecaller_id] || '—') : <span style={{ color: 'var(--v2-ink-2)' }}>not set</span>}</td>
                        <td style={{ ...td, textAlign: 'right' }}>{boardCounts[c.id] || 0}</td>
                        <td style={td}>
                          <span style={{ display: 'inline-flex', padding: '2px 8px', borderRadius: 999, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', background: c.is_active ? 'rgba(34,197,94,0.14)' : 'rgba(106,117,144,0.18)', color: c.is_active ? 'var(--v2-green,#22c55e)' : 'var(--v2-ink-2,#6a7590)' }}>
                            {c.is_active ? 'Active' : 'Paused'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  )
}
