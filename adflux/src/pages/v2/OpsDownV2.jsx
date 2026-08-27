// src/pages/v2/OpsDownV2.jsx — "Down now" (owner redesign, 2026-08-27).
// The live command centre: every screen the CMS shows OFFLINE this minute,
// grouped by station, with its logged reason + who's on it + who to call.
// Uptime on top. Reads ops_screens / ops_depots / ops_tickets /
// ops_depot_contacts — no writes. Head lands here; exec + admin can open it.
// Gujarati-first (§231). App v2 tokens.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Activity, RefreshCw, Phone, Loader2, CheckCircle2, FilePlus, ChevronDown, Navigation } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { t, getOpsLang, setOpsLang, numL } from '../../utils/opsStrings'
import { toastSuccess } from '../../components/v2/Toast'
import { depotMapsUrl } from '../../utils/opsMaps'
import { openExternalUrl } from '../../utils/openExternal'

const card = { background: 'var(--v2-bg-1, #1e293b)', border: '1px solid var(--v2-line, #334155)', borderRadius: 14, padding: 14 }

export default function OpsDownV2() {
  const nav = useNavigate()
  const [lang, setLang] = useState(getOpsLang())
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [screens, setScreens] = useState([])
  const [depots, setDepots] = useState([])
  const [tickets, setTickets] = useState([])
  const [contactsByDepot, setContactsByDepot] = useState({})
  const [open, setOpen] = useState(null)   // expanded depot id

  const flip = () => { const n = lang === 'gu' ? 'en' : 'gu'; setLang(n); setOpsLang(n) }
  const nm = (row, base) => (row ? ((lang === 'gu' ? row[`${base}_gu`] : row[`${base}_en`]) || row[`${base}_en`] || '') : '')

  const load = useCallback(async () => {
    try {
      const [sRes, dRes, tRes, cRes] = await Promise.all([
        supabase.from('ops_screens').select('id, name, status, depot_id').eq('is_active', true),
        supabase.from('ops_depots').select('id, name, lat, lng, assigned_to, tech:users!ops_depots_assigned_to_fkey(id,name)').eq('is_active', true).order('name'),
        supabase.from('ops_tickets').select('id, depot_id, cause, opened_at, assigned_to, tech:users!ops_tickets_assigned_to_fkey(name), issue:ops_issue_types!ops_tickets_issue_type_id_fkey(issue_en,issue_gu)').in('status', ['open', 'in_progress']).order('opened_at', { ascending: true }),
        supabase.from('ops_depot_contacts').select('id, depot_id, role_en, role_gu, name, phone, display_order').order('display_order'),
      ])
      if (sRes.error) throw sRes.error
      setScreens(sRes.data || [])
      setDepots(dRes.data || [])
      setTickets(tRes.data || [])
      const cb = {}; (cRes.data || []).forEach(c => { (cb[c.depot_id] ||= []).push(c) }); setContactsByDepot(cb)
    } catch (e) { setErr(e?.message || 'load failed') }
  }, [])

  useEffect(() => { (async () => { setLoading(true); await load(); setLoading(false) })() }, [load])
  useEffect(() => {
    const onVis = () => { if (document.visibilityState === 'visible') load() }
    document.addEventListener('visibilitychange', onVis); window.addEventListener('focus', onVis)
    return () => { document.removeEventListener('visibilitychange', onVis); window.removeEventListener('focus', onVis) }
  }, [load])

  const { uptime, downCount, rows } = useMemo(() => {
    let online = 0, offline = 0
    const byDepot = {}
    screens.forEach(s => {
      if (s.status === 'online') online++; else if (s.status === 'offline') offline++
      const d = (byDepot[s.depot_id] ||= { total: 0, down: [] })
      d.total++; if (s.status === 'offline') d.down.push(s)
    })
    const depotName = {}, depotTech = {}, depotLL = {}
    depots.forEach(d => { depotName[d.id] = d.name; depotTech[d.id] = d.tech?.name || null; depotLL[d.id] = { lat: d.lat, lng: d.lng } })
    // latest open ticket per depot → reason + who's on it (tickets are asc, so last wins)
    const tkByDepot = {}; tickets.forEach(tk => { tkByDepot[tk.depot_id] = tk })
    const rows = Object.entries(byDepot)
      .filter(([, v]) => v.down.length > 0)
      .map(([depotId, v]) => {
        const tk = tkByDepot[depotId]
        const reason = tk ? (tk.issue ? nm(tk.issue, 'issue') : tk.cause) : null
        const tech = (tk && tk.tech?.name) || depotTech[depotId] || null
        return { depotId, name: depotName[depotId] || '—', lat: depotLL[depotId]?.lat, lng: depotLL[depotId]?.lng, down: v.down.length, total: v.total, screens: v.down, reason, tech, since: tk?.opened_at || null }
      })
      .sort((a, b) => b.down - a.down)
    const uptime = (online + offline) > 0 ? Math.round(online / (online + offline) * 100) : 100
    return { uptime, downCount: offline, rows }
  }, [screens, depots, tickets, lang])

  const ago = (iso) => {
    if (!iso) return ''
    const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
    if (mins < 60) return `${numL(mins, lang)}m`
    if (mins < 1440) return `${numL(Math.round(mins / 60), lang)}h`
    return `${numL(Math.round(mins / 1440), lang)}d`
  }
  const contactRole = (c) => (lang === 'gu' ? c.role_gu : c.role_en) || c.role_en || c.name || '—'

  if (loading) return <div style={{ minHeight: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--v2-ink-2, #94a3b8)' }}><Loader2 size={22} style={{ animation: 'spin 1s linear infinite' }} /></div>
  if (err) return <div style={{ padding: 20 }}><div style={{ background: 'var(--danger-soft, rgba(239,68,68,.12))', color: 'var(--danger)', border: '1px solid var(--danger)', borderRadius: 10, padding: '12px 16px' }}>{err} <button className="btn btn-sec btn-sm" onClick={() => { setErr(''); load() }} style={{ marginLeft: 10 }}>{t('retry', lang)}</button></div></div>

  return (
    <div style={{ padding: '16px 16px 40px', maxWidth: 480, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Activity size={20} style={{ color: 'var(--v2-blue, #3B82F6)' }} />
          <span style={{ fontSize: 17, fontWeight: 700 }}>{t('down_now', lang)}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button onClick={() => { load(); toastSuccess(t('refresh', lang)) }} title={t('refresh', lang)} style={{ background: 'transparent', border: 'none', color: 'var(--v2-ink-2, #94a3b8)', cursor: 'pointer', display: 'inline-flex' }}><RefreshCw size={16} /></button>
          <button onClick={flip} className="btn btn-ghost btn-sm" style={{ fontWeight: 700 }}>{lang === 'gu' ? 'EN' : 'ગુ'}</button>
        </div>
      </div>

      {/* top numbers */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
        <div style={{ flex: 1, background: 'var(--v2-green-soft, rgba(16,185,129,.12))', borderRadius: 12, padding: '12px 14px' }}>
          <div style={{ fontSize: 12, color: 'var(--v2-green, #10B981)', fontWeight: 700 }}>{t('network_uptime', lang)}</div>
          <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--v2-green, #10B981)' }}>{numL(uptime, lang)}<span style={{ fontSize: 16 }}>%</span></div>
        </div>
        <div style={{ flex: 1, background: 'var(--danger-soft, rgba(239,68,68,.12))', borderRadius: 12, padding: '12px 14px' }}>
          <div style={{ fontSize: 12, color: 'var(--danger, #EF4444)', fontWeight: 700 }}>{t('screens_down', lang)}</div>
          <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--danger, #EF4444)' }}>{numL(downCount, lang)}</div>
          <div style={{ fontSize: 11, color: 'var(--v2-ink-2, #94a3b8)' }}>{numL(rows.length, lang)} {t('across_stations', lang)}</div>
        </div>
      </div>

      {rows.length === 0 && (
        <div style={{ ...card, textAlign: 'center', padding: '28px 16px', color: 'var(--v2-green, #10B981)' }}>
          <CheckCircle2 size={28} style={{ marginBottom: 8 }} /><div style={{ fontWeight: 700 }}>{t('all_up', lang)}</div>
        </div>
      )}

      {rows.map(r => {
        const pct = Math.round(r.down / r.total * 100)
        const isOpen = open === r.depotId
        return (
          <div key={r.depotId} style={{ ...card, marginBottom: 10, cursor: 'pointer' }} onClick={() => setOpen(isOpen ? null : r.depotId)}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <div style={{ minWidth: 0 }}>
                <span style={{ fontSize: 15, fontWeight: 700 }}>{r.name}</span>
                {r.reason
                  ? <span style={{ fontSize: 12, color: 'var(--v2-ink-2, #94a3b8)' }}> · {r.reason}</span>
                  : <span style={{ fontSize: 12, color: 'var(--danger, #EF4444)' }}> · {t('not_logged', lang)}</span>}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--danger, #EF4444)' }}>{numL(r.down, lang)} / {numL(r.total, lang)} {t('down_word', lang)}</span>
                <ChevronDown size={16} style={{ color: 'var(--v2-ink-2, #94a3b8)', transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }} />
              </div>
            </div>
            <div style={{ height: 6, background: 'var(--danger-soft, rgba(239,68,68,.12))', borderRadius: 99, marginTop: 8, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${pct}%`, background: 'var(--danger, #EF4444)' }} />
            </div>
            <div style={{ fontSize: 11, color: 'var(--v2-ink-2, #94a3b8)', marginTop: 6 }}>
              {r.since ? `${t('down_word', lang)} ${ago(r.since)}` : ''}{r.tech ? ` · ${r.tech} ${t('on_it', lang)}` : ` · ${t('nobody_assigned', lang)}`}
            </div>

            {isOpen && (
              <div style={{ marginTop: 12, borderTop: '1px solid var(--v2-line, #334155)', paddingTop: 10 }} onClick={e => e.stopPropagation()}>
                <div style={{ fontSize: 12, color: 'var(--v2-ink-2, #94a3b8)', marginBottom: 8 }}>
                  {r.screens.slice(0, 8).map((s, i) => `${t('screen', lang)} ${numL(i + 1, lang)}`).join(', ')}{r.screens.length > 8 ? '…' : ''}
                </div>
                <div style={{ background: 'var(--v2-tint-blue, rgba(59,130,246,.12))', borderRadius: 8, padding: '8px 10px', marginBottom: 10 }}>
                  <div style={{ fontSize: 11, color: 'var(--v2-blue, #3B82F6)', fontWeight: 700, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}><Phone size={13} />{t('who_to_call', lang)}</div>
                  {(contactsByDepot[r.depotId] || []).length === 0
                    ? <div style={{ fontSize: 13, color: 'var(--v2-ink-2, #94a3b8)' }}>{t('no_contacts', lang)}</div>
                    : (contactsByDepot[r.depotId] || []).map(c => (
                      <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', fontSize: 13 }}>
                        <span style={{ color: 'var(--v2-ink-2, #94a3b8)' }}>{contactRole(c)}</span>
                        <a href={`tel:${(c.phone || '').replace(/\s/g, '')}`} style={{ color: 'var(--v2-yellow, #FFE600)', fontFamily: 'var(--v2-mono, monospace)', textDecoration: 'none' }}>{c.phone || '—'}</a>
                      </div>
                    ))}
                </div>
                {depotMapsUrl(r) && (
                  <button onClick={() => openExternalUrl(depotMapsUrl(r))} style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: 13, borderRadius: 10, border: '1px solid var(--v2-blue, #3B82F6)', background: 'transparent', color: 'var(--v2-blue, #3B82F6)', fontSize: 14, fontWeight: 600, cursor: 'pointer', marginBottom: 8 }}>
                    <Navigation size={16} />{t('navigate', lang)}
                  </button>
                )}
                <button onClick={() => nav(`/ops-log?depot=${r.depotId}`)} style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: 13, borderRadius: 10, border: '1px solid var(--v2-line, #334155)', background: 'var(--v2-bg-2, #0f172a)', color: 'var(--v2-ink-0, #f1f5f9)', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
                  <FilePlus size={16} />{t('log_whats_wrong', lang)}
                </button>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
