// src/pages/v2/CampaignsV2.jsx
//
// Campaign Module — Campaigns list + create (token-free, additive), styled to
// the owner-approved mockup (_design_reference/campaign_module_mockup.html →
// Campaigns tab): the shared chrome + KPI summary cards + a "New campaign"
// toggle + the mockup table (source dots, telecaller pills, chips).
//
// A campaign names a source + offer and sets the DEFAULT routing (which
// telecaller its leads go to). Reads campaigns + campaign_locations (board
// counts) + users (telecaller picker) + a leads count (campaign_id NOT NULL).
// Touches NO existing flow, NO frozen table — admin/co_owner only.

import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Loader2, AlertTriangle, Inbox, X } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/authStore'
import CampaignChrome from '../../components/v2/CampaignChrome'
import { pushToast, toastError, toastSuccess } from '../../components/v2/Toast'

const SOURCES = [
  { v: 'whatsapp', t: 'WhatsApp', dot: 'var(--v2-green, #22c55e)' },
  { v: 'meta',     t: 'Meta (Facebook / Instagram)', dot: 'var(--v2-blue, #60a5fa)' },
  { v: 'justdial', t: 'Justdial', dot: 'var(--v2-amber, #F59E0B)' },
  { v: 'manual',   t: 'Manual / Excel', dot: 'var(--v2-ink-2, #6a7590)' },
]
const srcOf = (v) => SOURCES.find((s) => s.v === v) || { t: v, dot: 'var(--v2-ink-2, #6a7590)' }

export default function CampaignsV2() {
  const navigate = useNavigate()
  const profile = useAuthStore((s) => s.profile)
  const [loading, setLoading] = useState(true)
  const [tablesMissing, setTablesMissing] = useState(false)
  const [rows, setRows] = useState([])
  const [boardCounts, setBoardCounts] = useState({})
  const [leadsCount, setLeadsCount] = useState(null)
  const [tcs, setTcs] = useState([])
  const [saving, setSaving] = useState(false)
  const [showForm, setShowForm] = useState(false)

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

      // Leads captured by ANY campaign (read-only count — head:true, no rows).
      const { count } = await supabase
        .from('leads').select('id', { count: 'exact', head: true })
        .not('campaign_id', 'is', null)
      setLeadsCount(count ?? 0)

      const { data: us } = await supabase
        .from('users')
        .select('id, name, role, team_role, is_active')
        .or('role.eq.telecaller,team_role.eq.telecaller')
        .order('name')
      setTcs((us || []).filter((u) => u.is_active !== false))
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

  const totalBoards = useMemo(() => Object.values(boardCounts).reduce((a, b) => a + b, 0), [boardCounts])
  const activeCount = useMemo(() => rows.filter((r) => r.is_active).length, [rows])

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
      setName(''); setTcId(''); setShowForm(false)
      load()
    } catch (err) {
      toastError(err, 'Could not create campaign.')
    } finally {
      setSaving(false)
    }
  }

  const newBtn = (
    <button type="button" style={btnY} onClick={() => setShowForm((v) => !v)}>
      {showForm ? <X size={14} /> : <Plus size={14} />} {showForm ? 'Close' : 'New campaign'}
    </button>
  )

  if (tablesMissing) {
    return (
      <CampaignChrome active="campaigns">
        <div style={{ ...banner }}>
          <AlertTriangle size={18} strokeWidth={1.6} style={{ color: 'var(--v2-amber, #F59E0B)', flexShrink: 0, marginTop: 1 }} />
          <div style={{ fontSize: 13, color: 'var(--v2-ink-1, #a9b3c7)' }}>
            The campaign tables aren&rsquo;t in the database yet. Run <b style={{ color: 'var(--v2-ink-0, #f5f7fb)' }}>supabase_campaign_c2_foundation.sql</b> in Supabase Studio, then reload.
          </div>
        </div>
      </CampaignChrome>
    )
  }

  return (
    <CampaignChrome active="campaigns" right={newBtn}>
      {/* KPI summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 14, marginBottom: 20 }}>
        <Kpi label="Campaigns" value={loading ? '·' : rows.length} hint={`${activeCount} active`} />
        <Kpi label="Boards (QR)" value={loading ? '·' : totalBoards} hint="locations stamped" />
        <Kpi label="Leads captured" value={loading ? '·' : (leadsCount ?? 0)} hint="from all campaigns" accent />
        <Kpi label="Telecallers" value={loading ? '·' : tcs.length} hint="available to route" />
      </div>

      {/* New campaign form (toggled) */}
      {showForm && (
        <div style={{ ...panel, marginBottom: 18 }}>
          <div style={{ fontFamily: 'var(--v2-display)', fontSize: 15, fontWeight: 600, color: 'var(--v2-ink-0, #f5f7fb)', marginBottom: 14 }}>New campaign</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
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
              {saving ? <Loader2 size={14} className="spin" /> : <Plus size={14} />} Create campaign
            </button>
          </div>
        </div>
      )}

      {/* Campaigns table */}
      <div style={{ ...panel, padding: 0 }}>
        <div style={{ padding: '13px 18px', borderBottom: '1px solid var(--v2-line)', fontFamily: 'var(--v2-display)', fontWeight: 600, color: 'var(--v2-ink-0, #f5f7fb)', fontSize: 14 }}>
          All campaigns{!loading && ` · ${rows.length}`}
        </div>
        {loading ? (
          <div style={{ padding: 40, textAlign: 'center' }}>
            <Loader2 size={20} strokeWidth={1.6} className="spin" style={{ color: 'var(--v2-yellow, #FFE600)' }} />
          </div>
        ) : rows.length === 0 ? (
          <div style={{ padding: 44, textAlign: 'center', color: 'var(--v2-ink-2)', fontSize: 13 }}>
            <Inbox size={22} strokeWidth={1.6} style={{ opacity: 0.5 }} />
            <div style={{ marginTop: 8 }}>No campaigns yet. Tap <b style={{ color: 'var(--v2-ink-1)' }}>New campaign</b> to make your first.</div>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr>
                  <th style={th}>Campaign</th>
                  <th style={th}>Source</th>
                  <th style={th}>Segment</th>
                  <th style={th}>Telecaller</th>
                  <th style={{ ...th, textAlign: 'right' }}>Boards</th>
                  <th style={th}>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => {
                  const s = srcOf(c.source_type)
                  const tn = c.default_telecaller_id ? (tcName[c.default_telecaller_id] || null) : null
                  return (
                    <tr key={c.id} className="camp-row">
                      <td style={{ ...td }}>
                        <div style={{ fontWeight: 600, color: 'var(--v2-ink-0, #f5f7fb)' }}>{c.name}</div>
                        <div style={{ fontSize: 10.5, color: 'var(--v2-ink-2)', textTransform: 'uppercase', letterSpacing: '.06em', marginTop: 2 }}>
                          created {fmtDate(c.created_at)}
                        </div>
                      </td>
                      <td style={td}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 600, color: 'var(--v2-ink-1)' }}>
                          <span style={{ width: 7, height: 7, borderRadius: 999, background: s.dot }} />
                          {s.t.split(' (')[0]}
                        </span>
                      </td>
                      <td style={td}><span style={chip(c.segment)}>{c.segment === 'GOVERNMENT' ? 'Govt' : 'Private'}</span></td>
                      <td style={td}>
                        {tn ? (
                          <span style={tcPill}>
                            <span style={tcAv}>{tn.charAt(0).toUpperCase()}</span>{tn}
                          </span>
                        ) : (
                          <span style={{ ...tcPill, color: 'var(--v2-ink-2)' }}>round-robin</span>
                        )}
                      </td>
                      <td style={{ ...td, textAlign: 'right', fontFamily: 'var(--v2-display)', fontWeight: 600, color: 'var(--v2-ink-0, #f5f7fb)' }}>
                        {boardCounts[c.id] || 0}
                      </td>
                      <td style={td}>
                        <span style={{
                          display: 'inline-flex', padding: '2px 8px', borderRadius: 999, fontSize: 10, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase',
                          background: c.is_active ? 'var(--v2-green-soft, rgba(34,197,94,0.14))' : 'rgba(106,117,144,0.18)',
                          color: c.is_active ? 'var(--v2-green, #22c55e)' : 'var(--v2-ink-2, #6a7590)',
                        }}>
                          {c.is_active ? 'Active' : 'Paused'}
                        </span>
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
        Manual / Excel upload keeps working exactly as today. No existing lead / telecaller / sales / quote / payroll flow changes — campaigns sit beside the live system.
      </p>

      <style>{`@keyframes spin{to{transform:rotate(360deg)}} .spin{animation:spin 1s linear infinite} .camp-row:hover td{background:rgba(255,255,255,.015)}`}</style>
    </CampaignChrome>
  )
}

function Kpi({ label, value, hint, accent }) {
  return (
    <div style={panel}>
      <div style={{ fontSize: 11, color: 'var(--v2-ink-2, #6a7590)', textTransform: 'uppercase', letterSpacing: '.10em', fontWeight: 600 }}>{label}</div>
      <div style={{
        fontFamily: 'var(--v2-display, "Space Grotesk")', fontSize: 26, fontWeight: 700, marginTop: 6,
        color: accent ? 'var(--v2-yellow, #FFE600)' : 'var(--v2-ink-0, #f5f7fb)',
      }}>{value}</div>
      {hint && <div style={{ fontSize: 11, color: 'var(--v2-ink-2, #6a7590)', marginTop: 4 }}>{hint}</div>}
    </div>
  )
}

function fmtDate(iso) {
  try { return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) } catch { return '—' }
}

// ─── inline styles ───────────────────────────────────────────────────────
const panel = { background: 'var(--v2-bg-1, #0f1525)', border: '1px solid var(--v2-line, #1f2b47)', borderRadius: 14, padding: 18 }
const banner = { ...panel, borderColor: 'var(--v2-amber, #F59E0B)', background: 'var(--v2-amber-soft, rgba(245,158,11,0.12))', display: 'flex', gap: 10, alignItems: 'flex-start' }
const lbl = { fontSize: 11, color: 'var(--v2-ink-2, #6a7590)', textTransform: 'uppercase', letterSpacing: '.08em', fontWeight: 600, marginBottom: 6, display: 'block' }
const inp = { width: '100%', height: 38, padding: '0 12px', background: 'var(--v2-bg-2, #1a2742)', border: '1px solid var(--v2-line, #1f2b47)', borderRadius: 10, color: 'var(--v2-ink-0, #f5f7fb)', fontSize: 13, outline: 'none', fontFamily: 'inherit' }
const btnY = { background: 'var(--v2-yellow, #FFE600)', color: 'var(--accent-fg, #0b1220)', border: 'none', borderRadius: 10, height: 38, padding: '0 16px', fontWeight: 700, fontSize: 13, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }
const th = { padding: '11px 16px', textAlign: 'left', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--v2-ink-2, #6a7590)', borderBottom: '1px solid var(--v2-line, #1f2b47)', whiteSpace: 'nowrap', background: 'rgba(255,255,255,.02)' }
const td = { padding: '13px 16px', borderBottom: '1px solid var(--v2-line, #1f2b47)', fontSize: 13, color: 'var(--v2-ink-1, #a9b3c7)', verticalAlign: 'middle' }
const tcPill = { display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5, color: 'var(--v2-ink-1, #a9b3c7)', background: 'var(--v2-bg-2, #1a2742)', border: '1px solid var(--v2-line, #1f2b47)', padding: '3px 9px', borderRadius: 999 }
const tcAv = { width: 18, height: 18, borderRadius: 999, background: 'var(--v2-blue-soft, rgba(96,165,250,0.16))', color: 'var(--v2-blue, #60a5fa)', fontSize: 9, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }
const chip = (c) => ({ display: 'inline-flex', padding: '2px 8px', borderRadius: 999, fontSize: 10, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', background: c === 'GOVERNMENT' ? 'var(--v2-blue-soft, rgba(96,165,250,0.16))' : 'var(--v2-tint-yellow, rgba(255,230,0,0.14))', color: c === 'GOVERNMENT' ? 'var(--v2-blue, #60a5fa)' : 'var(--v2-yellow, #FFE600)' })
