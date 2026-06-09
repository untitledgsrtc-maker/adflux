// src/pages/v2/CampaignSegmentsV2.jsx
//
// Campaign Module — Segments (saved, reusable lead audiences). Build a filter
// over the EXISTING leads table (stage / heat / source / city / exclude
// opted-out), see the live match count, save it, re-use it. Broadcast (#3)
// sends to a saved segment.
//
// §45-safe: a NEW campaign admin page (RequirePrivileged). The only live-table
// touch is a READ-ONLY count on leads through normal RLS — nothing writes
// leads. Saves go to the new campaign_segments table.

import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Loader2, AlertTriangle, Users, Save, Trash2, RefreshCw, Filter,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/authStore'
import CampaignChrome from '../../components/v2/CampaignChrome'
import { toastError, toastSuccess } from '../../components/v2/Toast'
import { confirmDialog } from '../../components/v2/ConfirmDialog'

const STAGES = ['New', 'Working', 'QuoteSent', 'Nurture', 'Won', 'Lost']
const HEATS  = ['hot', 'warm', 'cold']
// Sensible default = "active" leads (everything except Won/Lost).
const DEFAULT_STAGES = ['New', 'Working', 'QuoteSent', 'Nurture']

export default function CampaignSegmentsV2() {
  const profile = useAuthStore((s) => s.profile)

  const [tablesMissing, setTablesMissing] = useState(false)
  const [loading, setLoading] = useState(true)
  const [segments, setSegments] = useState([])
  const [sources, setSources] = useState([])

  // rule state
  const [name, setName] = useState('')
  const [stages, setStages] = useState(DEFAULT_STAGES)
  const [heat, setHeat] = useState('')
  const [source, setSource] = useState('')
  const [city, setCity] = useState('')
  const [excludeOptOut, setExcludeOptOut] = useState(true)

  const [count, setCount] = useState(null)
  const [counting, setCounting] = useState(false)
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)

  const rules = { stages, heat: heat || null, source: source || null, city: city.trim() || null, excludeOptOut }

  // Apply the current rules to a leads query (count-only / head).
  const applyRules = useCallback((q) => {
    if (stages.length && stages.length < STAGES.length) q = q.in('stage', stages)
    if (heat) q = q.eq('heat', heat)
    if (source) q = q.eq('source', source)
    if (city.trim()) q = q.ilike('city', `%${city.trim()}%`)
    if (excludeOptOut) q = q.not('do_not_call', 'is', true).not('wa_opt_out', 'is', true)
    return q
  }, [stages, heat, source, city, excludeOptOut])

  const load = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('campaign_segments')
      .select('id, name, rules_json, contact_count, created_at')
      .order('created_at', { ascending: false })
    if (error) {
      if (/relation .* does not exist|could not find the table/i.test(error.message || '')) {
        setTablesMissing(true)
      } else {
        toastError(error, 'Could not load segments.')
      }
      setLoading(false)
      return
    }
    setSegments(data || [])
    setLoading(false)

    // Distinct lead sources for the dropdown (bounded read).
    const { data: srcRows } = await supabase.from('leads').select('source').limit(4000)
    const uniq = [...new Set((srcRows || []).map((r) => r.source).filter(Boolean))].sort()
    setSources(uniq)
  }, [])

  useEffect(() => { load() }, [load])

  // Live match count — debounced on every rule change.
  useEffect(() => {
    let alive = true
    setCounting(true)
    const t = setTimeout(async () => {
      const { count: c, error } = await applyRules(
        supabase.from('leads').select('id', { count: 'exact', head: true })
      )
      if (!alive) return
      if (error) { setCount(null) } else { setCount(c ?? 0) }
      setCounting(false)
    }, 400)
    return () => { alive = false; clearTimeout(t) }
  }, [applyRules])

  function toggleStage(s) {
    setStages((prev) => prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s])
  }

  async function saveSegment() {
    if (!name.trim()) { toastError(new Error('name'), 'Name the segment first.'); return }
    if (savingRef.current || saving) return
    savingRef.current = true
    setSaving(true)
    try {
      const { error } = await supabase.from('campaign_segments').insert({
        name: name.trim(), rules_json: rules, contact_count: count ?? null,
        created_by: profile?.id || null,
      })
      if (error) { toastError(error, 'Could not save the segment.'); return }
      toastSuccess(`Saved "${name.trim()}" · ${count ?? 0} leads.`)
      setName('')
      load()
    } catch (e) {
      toastError(e, 'Could not save the segment.')
    } finally {
      setSaving(false)
      savingRef.current = false
    }
  }

  async function deleteSegment(seg) {
    const ok = await confirmDialog({
      title: 'Delete segment?',
      message: `Delete "${seg.name}"? The rule is removed; your leads are untouched.`,
      confirmLabel: 'Delete', danger: true,
    })
    if (!ok) return
    const { error } = await supabase.from('campaign_segments').delete().eq('id', seg.id)
    if (error) { toastError(error, 'Could not delete.'); return }
    toastSuccess('Segment deleted.')
    load()
  }

  function loadRule(seg) {
    const r = seg.rules_json || {}
    setStages(Array.isArray(r.stages) && r.stages.length ? r.stages : DEFAULT_STAGES)
    setHeat(r.heat || '')
    setSource(r.source || '')
    setCity(r.city || '')
    setExcludeOptOut(r.excludeOptOut !== false)
    setName(seg.name)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const refreshBtn = (
    <button type="button" onClick={load} style={btnG}><RefreshCw size={14} strokeWidth={1.6} /> Refresh</button>
  )

  if (tablesMissing) {
    return (
      <CampaignChrome active="segments" title="Segments" right={refreshBtn}>
        <div style={banner}>
          <AlertTriangle size={18} strokeWidth={1.6} style={{ color: 'var(--v2-amber, #F59E0B)', flexShrink: 0, marginTop: 1 }} />
          <div style={{ fontSize: 13, color: 'var(--v2-ink-1, #a9b3c7)' }}>
            Run <b style={{ color: 'var(--v2-ink-0, #f5f7fb)' }}>supabase_campaign_segments.sql</b> in Supabase Studio, then reload.
          </div>
        </div>
      </CampaignChrome>
    )
  }

  return (
    <CampaignChrome
      active="segments"
      title="Segments"
      sub="Build a reusable audience from your leads — filter by stage, heat, source, city. See the live count, save it, and broadcast to it later."
      right={refreshBtn}
    >
      {/* rule builder */}
      <div style={{ ...panel, marginBottom: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
          <Filter size={16} strokeWidth={1.6} style={{ color: 'var(--v2-yellow, #FFE600)' }} />
          <span style={{ fontFamily: 'var(--v2-display)', fontWeight: 700, color: 'var(--v2-ink-0)', fontSize: 15 }}>Audience rules</span>
        </div>

        {/* stage chips */}
        <label style={lbl}>Stage</label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginBottom: 14 }}>
          {STAGES.map((s) => {
            const on = stages.includes(s)
            return (
              <button key={s} type="button" onClick={() => toggleStage(s)} style={{
                fontSize: 12.5, fontWeight: 600, cursor: 'pointer', padding: '6px 12px', borderRadius: 999,
                border: on ? '1px solid var(--v2-yellow, #FFE600)' : '1px solid var(--v2-line)',
                background: on ? 'var(--v2-tint-yellow, rgba(255,230,0,0.14))' : 'var(--v2-bg-2)',
                color: on ? 'var(--v2-yellow, #FFE600)' : 'var(--v2-ink-2)',
              }}>{s}</button>
            )
          })}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12 }}>
          <div>
            <label style={lbl}>Heat</label>
            <select style={inp} value={heat} onChange={(e) => setHeat(e.target.value)}>
              <option value="">Any</option>
              {HEATS.map((h) => <option key={h} value={h}>{h}</option>)}
            </select>
          </div>
          <div>
            <label style={lbl}>Source</label>
            <select style={inp} value={source} onChange={(e) => setSource(e.target.value)}>
              <option value="">Any</option>
              {sources.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label style={lbl}>City contains</label>
            <input style={inp} value={city} onChange={(e) => setCity(e.target.value)} placeholder="e.g. Ahmedabad" />
          </div>
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: 9, marginTop: 14, cursor: 'pointer', fontSize: 13, color: 'var(--v2-ink-1)' }}>
          <input type="checkbox" checked={excludeOptOut} onChange={(e) => setExcludeOptOut(e.target.checked)} />
          Exclude opted-out (Do-Not-Call / WhatsApp opt-out)
        </label>
      </div>

      {/* live count + save */}
      <div style={{ ...panel, marginBottom: 18, display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ width: 46, height: 46, borderRadius: 12, background: 'var(--v2-tint-yellow, rgba(255,230,0,0.14))', color: 'var(--v2-yellow, #FFE600)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <Users size={22} strokeWidth={1.6} />
          </span>
          <div>
            <div style={{ fontSize: 11.5, color: 'var(--v2-ink-2)', textTransform: 'uppercase', letterSpacing: '.07em', fontWeight: 600 }}>Matches</div>
            <div style={{ fontFamily: 'var(--v2-display)', fontWeight: 700, fontSize: 26, color: 'var(--v2-ink-0)', lineHeight: 1.1 }}>
              {counting ? <Loader2 size={20} strokeWidth={1.6} className="spin" style={{ color: 'var(--v2-yellow, #FFE600)' }} /> : `${count ?? '—'} leads`}
            </div>
          </div>
        </div>
        <div style={{ flex: 1, minWidth: 200, display: 'flex', gap: 8, alignItems: 'flex-end', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          <input style={{ ...inp, maxWidth: 240 }} value={name} onChange={(e) => setName(e.target.value)} placeholder="Name this segment…" />
          <button type="button" style={{ ...btnY, opacity: (saving || !name.trim()) ? 0.6 : 1 }} onClick={saveSegment} disabled={saving || !name.trim()}>
            {saving ? <Loader2 size={14} strokeWidth={1.6} className="spin" /> : <Save size={14} strokeWidth={1.6} />} Save segment
          </button>
        </div>
      </div>

      {/* saved segments */}
      <div style={{ ...panel, padding: 0 }}>
        <div style={{ padding: '13px 18px', borderBottom: '1px solid var(--v2-line)' }}>
          <span style={{ fontFamily: 'var(--v2-display)', fontWeight: 600, color: 'var(--v2-ink-0)', fontSize: 14 }}>
            Saved segments{!loading && ` · ${segments.length}`}
          </span>
        </div>
        {loading ? (
          <div style={{ padding: 40, textAlign: 'center' }}><Loader2 size={20} strokeWidth={1.6} className="spin" style={{ color: 'var(--v2-yellow, #FFE600)' }} /></div>
        ) : segments.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--v2-ink-2)', fontSize: 13 }}>
            <Users size={22} strokeWidth={1.6} style={{ opacity: 0.5 }} />
            <div style={{ marginTop: 8 }}>No segments yet. Build a rule above and save it.</div>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead><tr>
                <th style={th}>Segment</th>
                <th style={{ ...th, textAlign: 'right' }}>Leads</th>
                <th style={th}>Rule</th>
                <th style={{ ...th, textAlign: 'right' }}></th>
              </tr></thead>
              <tbody>
                {segments.map((seg) => {
                  const r = seg.rules_json || {}
                  const bits = [
                    Array.isArray(r.stages) && r.stages.length && r.stages.length < STAGES.length ? r.stages.join('/') : null,
                    r.heat, r.source, r.city ? `city~${r.city}` : null,
                    r.excludeOptOut === false ? null : 'no opt-out',
                  ].filter(Boolean)
                  return (
                    <tr key={seg.id} className="seg-row">
                      <td style={td}><span style={{ fontWeight: 600, color: 'var(--v2-ink-0)' }}>{seg.name}</span></td>
                      <td style={{ ...td, textAlign: 'right', fontFamily: 'var(--v2-display)', fontWeight: 700, color: 'var(--v2-ink-0)' }}>{seg.contact_count ?? '—'}</td>
                      <td style={{ ...td, color: 'var(--v2-ink-2)', fontSize: 12 }}>{bits.length ? bits.join(' · ') : 'all leads'}</td>
                      <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                        <button type="button" style={{ ...btnG, height: 30, fontSize: 12, padding: '0 10px' }} onClick={() => loadRule(seg)}>Load</button>
                        <button type="button" title="Delete" onClick={() => deleteSegment(seg)} style={{ ...btnG, height: 30, fontSize: 12, padding: '0 8px', marginLeft: 6, color: 'var(--v2-rose, #f87171)' }}>
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
        Bulk-sending to a saved segment unlocks in <b style={{ color: 'var(--v2-ink-1)' }}>Broadcast</b> (needs a payment method + a Meta-approved template).
      </p>

      <style>{`@keyframes spin{to{transform:rotate(360deg)}} .spin{animation:spin 1s linear infinite} .seg-row:hover td{background:rgba(255,255,255,.015)}`}</style>
    </CampaignChrome>
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
const td = { padding: '12px 16px', borderBottom: '1px solid var(--v2-line, #1f2b47)', fontSize: 13, color: 'var(--v2-ink-1, #a9b3c7)', verticalAlign: 'middle' }
