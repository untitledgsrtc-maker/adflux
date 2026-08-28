// src/pages/v2/OpsTechV2.jsx — per-tech drill-down for the ops command center
// (owner "manage 10 techs" brainstorm, 2026-08-28). Tap a tech on the command
// center scorecard → this page: their stations + faults + uptime + calls +
// attendance. Reads ONE gated bundle RPC ops_tech_detail(user_id) (§66,
// head/admin only, fail-closed). AdFlux brand tokens (§5), Gujarati-first (§231).
import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Loader2, RefreshCw, Monitor, WifiOff, VideoOff, Phone, Clock, CheckCircle2, MapPin, ChevronRight, Activity } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { t, getOpsLang, setOpsLang, numL } from '../../utils/opsStrings'

const toneVar = { success: 'var(--success)', warning: 'var(--warning)', danger: 'var(--danger)', muted: 'var(--text-muted)' }
const upTone = (p) => (p == null ? 'muted' : p >= 90 ? 'success' : p >= 75 ? 'warning' : 'danger')

export default function OpsTechV2() {
  const nav = useNavigate()
  const { userId } = useParams()
  const [lang, setLang] = useState(getOpsLang())
  const flip = () => { const n = lang === 'gu' ? 'en' : 'gu'; setLang(n); setOpsLang(n) }
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [d, setD] = useState(null)

  const load = useCallback(async () => {
    try {
      const { data, error } = await supabase.rpc('ops_tech_detail', { p_user_id: userId })
      if (error) throw error
      setD(data && data.name ? data : null)
      setErr('')
    } catch (e) { setErr(e?.message || 'load failed') }
  }, [userId])

  useEffect(() => { (async () => { setLoading(true); await load(); setLoading(false) })() }, [load])
  useEffect(() => {
    const onVis = () => { if (document.visibilityState === 'visible') load() }
    document.addEventListener('visibilitychange', onVis); window.addEventListener('focus', onVis)
    return () => { document.removeEventListener('visibilitychange', onVis); window.removeEventListener('focus', onVis) }
  }, [load])

  const back = (
    <button onClick={() => nav('/ops-command')} aria-label={t('back', lang)} className="lead-btn" style={{ padding: '8px 10px' }}><ArrowLeft size={16} /></button>
  )

  if (loading) return <div className="lead-root" style={{ textAlign: 'center', paddingTop: 60 }}><Loader2 size={30} style={{ color: 'var(--text-muted)', animation: 'spin 1s linear infinite' }} /></div>
  if (err) return (
    <div className="lead-root">
      <div style={{ marginBottom: 12 }}>{back}</div>
      <div style={{ background: 'var(--danger-soft)', border: '1px solid var(--danger)', color: 'var(--danger)', borderRadius: 12, padding: '12px 16px', fontSize: 13 }}>{err} <button className="lead-btn" onClick={() => { setErr(''); load() }} style={{ marginLeft: 10 }}>{t('retry', lang)}</button></div>
    </div>
  )
  if (!d) return (
    <div className="lead-root">
      <div style={{ marginBottom: 12 }}>{back}</div>
      <div className="lead-card" style={{ textAlign: 'center', padding: '22px 16px', color: 'var(--text-muted)' }}>{t('tech_none', lang)}</div>
    </div>
  )

  const upt = upTone(d.uptime_pct)
  const stations = d.stations || []

  return (
    <div className="lead-root">
      <div className="lead-page-head" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          {back}
          <div>
            <div className="lead-page-eyebrow">{t('ops_field', lang)}</div>
            <h1 className="lead-page-title" style={{ margin: 0 }}>{d.name}</h1>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, marginTop: 6, fontSize: 12, fontWeight: 600, padding: '2px 9px', borderRadius: 999, background: d.on_duty ? 'var(--success-soft)' : 'var(--surface-3)', color: d.on_duty ? 'var(--success)' : 'var(--text-muted)' }}>
              <span style={{ width: 7, height: 7, borderRadius: 999, background: d.on_duty ? 'var(--success)' : 'var(--text-muted)' }} />
              {d.on_duty ? t('on_duty', lang) : (d.checked_in_today ? t('off_duty', lang) : t('not_checked_in', lang))}
            </span>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button onClick={load} aria-label={t('refresh', lang)} className="lead-btn" style={{ padding: '8px 10px' }}><RefreshCw size={16} /></button>
          <button onClick={flip} className="lead-btn" style={{ fontWeight: 700, padding: '8px 12px' }}>{lang === 'gu' ? 'EN' : 'ગુ'}</button>
        </div>
      </div>

      {/* uptime hero */}
      <div className="lead-card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 18px', marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, color: 'var(--text-muted)' }}><Activity size={17} style={{ color: toneVar[upt] }} /><span style={{ fontSize: 13 }}>{t('uptime_word', lang)} · {t('calls_month', lang)}</span></div>
        <div style={{ fontFamily: 'var(--font-display)', fontVariantNumeric: 'tabular-nums', fontSize: 34, fontWeight: 700, color: toneVar[upt], lineHeight: 1 }}>{numL(Math.round(d.uptime_pct || 0), lang)}%</div>
      </div>

      {/* KPI grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: 10, marginBottom: 18 }}>
        <Tile icon={WifiOff} n={numL(d.open_tickets || 0, lang)} label={t('open_tickets', lang)} tone={(d.open_tickets || 0) > 0 ? 'danger' : 'muted'} />
        <Tile icon={CheckCircle2} n={numL(d.fixed_month || 0, lang)} label={t('fixed_this_mo', lang)} tone="success" />
        <Tile icon={Clock} n={d.avg_fix_hours ? `${numL(d.avg_fix_hours, lang)}${t('hrs', lang)}` : '—'} label={t('avg_fix', lang)} tone="muted" />
        <Tile icon={MapPin} n={`${numL(d.km_month || 0, lang)} km`} tone="muted" labelOverride={lang === 'gu' ? 'આ મહિને ટ્રાવેલ' : 'Travel this month'} />
        <Tile icon={Phone} n={numL(d.calls_today || 0, lang)} label={`${t('my_calls', lang)} · ${t('calls_today', lang)}`} tone="muted" />
        <Tile icon={Phone} n={numL(d.calls_month || 0, lang)} label={`${t('my_calls', lang)} · ${t('calls_month', lang)}`} tone="muted" />
      </div>

      {/* stations */}
      <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 8 }}>{t('my_stations', lang)} · {numL(stations.length, lang)}</div>
      {stations.length === 0 ? (
        <div className="lead-card" style={{ textAlign: 'center', padding: '18px 14px', color: 'var(--text-muted)' }}>{t('no_depot', lang)}</div>
      ) : (
        <div className="lead-card" style={{ padding: '4px 0' }}>
          {stations.map((s, i) => {
            const down = (s.offline || 0) > 0
            return (
              <button key={s.id || i} onClick={() => nav(`/ops-station?depot=${s.id}`)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', width: '100%', background: 'none', border: 'none', borderTop: i ? '1px solid var(--border)' : 'none', cursor: 'pointer', textAlign: 'left', color: 'inherit' }}>
                <span style={{ width: 8, height: 8, borderRadius: 999, background: down ? 'var(--danger)' : 'var(--success)', flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14.5, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', display: 'flex', gap: 12, marginTop: 2 }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Monitor size={12} /> {numL((s.total || 0) - (s.offline || 0), lang)}/{numL(s.total || 0, lang)} {t('up_word', lang)}</span>
                    {(s.camera_off || 0) > 0 && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--warning)' }}><VideoOff size={12} /> {numL(s.camera_off, lang)}</span>}
                  </div>
                </div>
                {down && <span style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--danger)' }}>{numL(s.offline, lang)} {t('down_word', lang)}</span>}
                <ChevronRight size={16} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

function Tile({ icon: Icon, n, label, tone = 'muted', labelOverride }) {
  const c = toneVar[tone] || 'var(--text)'
  return (
    <div className="lead-card" style={{ padding: '13px 14px', minHeight: 80 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, color: 'var(--text-muted)', marginBottom: 6 }}><Icon size={15} style={{ color: c }} /><span style={{ fontSize: 12 }}>{labelOverride || label}</span></div>
      <div style={{ fontFamily: 'var(--font-display)', fontVariantNumeric: 'tabular-nums', fontSize: 24, fontWeight: 700, color: c, lineHeight: 1 }}>{n}</div>
    </div>
  )
}
