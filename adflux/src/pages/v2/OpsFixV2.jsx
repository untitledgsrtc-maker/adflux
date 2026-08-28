// src/pages/v2/OpsFixV2.jsx — the simple per-station action screen for the
// field tech. Tap an offline station on /ops-home → land here: WHO TO CALL
// (big call buttons, first thing on screen), which screens are off, and one
// "fixed · photo" button. This is the owner's "when a screen is offline he
// must see all the contact data right there" ask (2026-08-28) — one screen,
// no drilling, no map/route. Gujarati-first (§231). Reads ops_depots /
// ops_screens / ops_depot_contacts (RLS: the exec owns the depot).
import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Loader2, ArrowLeft, Phone, WifiOff, Wrench } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { t, getOpsLang, setOpsLang, numL } from '../../utils/opsStrings'
import { openExternalUrl } from '../../utils/openExternal'

export default function OpsFixV2() {
  const { depotId } = useParams()
  const nav = useNavigate()
  const [lang, setLang] = useState(getOpsLang())
  const flip = () => { const n = lang === 'gu' ? 'en' : 'gu'; setLang(n); setOpsLang(n) }
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [depot, setDepot] = useState(null)
  const [down, setDown] = useState([])
  const [contacts, setContacts] = useState([])

  const load = useCallback(async () => {
    if (!depotId) return
    try {
      const [dRes, sRes, cRes] = await Promise.all([
        supabase.from('ops_depots').select('id, name').eq('id', depotId).eq('is_active', true).maybeSingle(),
        supabase.from('ops_screens').select('id, name').eq('depot_id', depotId).eq('is_active', true).eq('status', 'offline'),
        supabase.from('ops_depot_contacts').select('id, role_en, role_gu, name, phone, display_order').eq('depot_id', depotId).order('display_order'),
      ])
      if (dRes.error) throw dRes.error
      setDepot(dRes.data || null)
      setDown(sRes.data || [])
      setContacts(cRes.data || [])
    } catch (e) { setErr(e?.message || 'load failed') }
  }, [depotId])

  useEffect(() => { (async () => { setLoading(true); await load(); setLoading(false) })() }, [load])

  const roleOf = (c) => (lang === 'gu' ? c.role_gu : c.role_en) || c.role_en || c.role_gu || c.name || '—'
  const initial = (c) => ((roleOf(c) || 'C').trim()[0] || 'C')
  const call = (phone) => { const p = (phone || '').replace(/\s/g, ''); if (p) openExternalUrl(`tel:${p}`) }

  if (loading) return <div className="lead-root" style={{ textAlign: 'center', paddingTop: 60 }}><Loader2 size={30} style={{ color: 'var(--text-muted)', animation: 'spin 1s linear infinite' }} /></div>
  if (err || !depot) return (
    <div className="lead-root">
      <button className="lead-btn" onClick={() => nav('/ops-home')} style={{ marginBottom: 12 }}><ArrowLeft size={16} /> {t('go_home', lang)}</button>
      <div style={{ background: 'var(--danger-soft)', border: '1px solid var(--danger)', color: 'var(--danger)', borderRadius: 12, padding: '12px 16px', fontSize: 13 }}>{err || t('no_depot', lang)}</div>
    </div>
  )

  return (
    <div className="lead-root">
      {/* header — back + station + how many off */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        <button onClick={() => nav('/ops-home')} aria-label={t('go_home', lang)} style={{ border: 'none', background: 'none', cursor: 'pointer', padding: 4, color: 'var(--text)', flexShrink: 0 }}><ArrowLeft size={24} /></button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 20, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{depot.name}</div>
          <div style={{ fontSize: 14.5, color: 'var(--danger)', display: 'flex', alignItems: 'center', gap: 5, marginTop: 2 }}><WifiOff size={15} /> {numL(down.length, lang)} {t('screens_down', lang)}</div>
        </div>
        <button className="lead-btn" onClick={flip} style={{ fontWeight: 700, flexShrink: 0 }}>{lang === 'gu' ? 'EN' : 'ગુ'}</button>
      </div>

      {/* WHO TO CALL — the whole point: big, first, tap = dial */}
      <div style={{ fontSize: 16, fontWeight: 700, margin: '4px 0 10px', display: 'flex', alignItems: 'center', gap: 7 }}>
        <Phone size={19} style={{ color: 'var(--success)' }} /> {t('who_to_call', lang)}
      </div>
      {contacts.length === 0
        ? <div className="lead-card" style={{ padding: '18px 16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 14, marginBottom: 16 }}>{t('no_contacts', lang)}</div>
        : contacts.map(c => (
          <div key={c.id} className="lead-card" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px', marginBottom: 10 }}>
            <div style={{ width: 44, height: 44, borderRadius: '50%', background: 'var(--accent-soft, rgba(255,230,0,.14))', color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 17, flexShrink: 0 }}>{initial(c)}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              {c.name ? <div style={{ fontSize: 15.5, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</div> : null}
              <div style={{ fontSize: c.name ? 13 : 15.5, fontWeight: c.name ? 400 : 600, color: c.name ? 'var(--text-muted)' : 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{roleOf(c)}</div>
              {c.phone ? <div style={{ fontSize: 13, color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums', marginTop: 1 }}>{c.phone}</div> : null}
            </div>
            <button onClick={() => call(c.phone)} disabled={!c.phone} aria-label={t('call', lang)} style={{ flexShrink: 0, minWidth: 120, minHeight: 52, borderRadius: 12, border: 'none', background: c.phone ? 'var(--success)' : 'var(--surface-3)', color: c.phone ? '#fff' : 'var(--text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, fontSize: 16, fontWeight: 700, cursor: c.phone ? 'pointer' : 'default' }}>
              <Phone size={18} /> {t('call', lang)}
            </button>
          </div>
        ))}

      {/* which screens are off — simple list */}
      {down.length > 0 && (
        <>
          <div style={{ fontSize: 13, color: 'var(--text-muted)', margin: '16px 0 6px' }}>{t('which_screens', lang)}</div>
          <div className="lead-card" style={{ padding: '11px 13px', fontSize: 14.5, lineHeight: 1.6, marginBottom: 18 }}>
            {down.some(s => s.name)
              ? down.map(s => s.name || `${t('screen', lang)}`).join(' · ')
              : down.map((s, i) => `${t('screen', lang)} ${numL(i + 1, lang)}`).join(' · ')}
          </div>
        </>
      )}

      {/* one action: fixed + photo → the log screen (prefilled to this station) */}
      <button onClick={() => nav(`/ops-log?depot=${depotId}`)} style={{ width: '100%', minHeight: 54, borderRadius: 14, border: 'none', background: 'var(--success)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, fontSize: 16.5, fontWeight: 700, cursor: 'pointer' }}>
        <Wrench size={19} /> {t('fix_it', lang)}
      </button>
    </div>
  )
}
