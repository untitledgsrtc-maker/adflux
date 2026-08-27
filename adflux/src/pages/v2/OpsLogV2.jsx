// src/pages/v2/OpsLogV2.jsx — the PRIMARY ops screen (owner redesign, 2026-08-27).
// The flow the owner drew: City → contacts auto-appear → Screen → what was wrong
// (dropdown from ops_issue_types) + notes + photo → Save. One issue logged per
// screen. No lifecycle, no approval. Reads ops_depots / ops_depot_contacts /
// ops_screens / ops_issue_types; writes ops_tickets (source='manual'). Gujarati-
// first (§231) via opsStrings. Ops roles + admin. Additive; app v2 tokens.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { MapPin, Phone, Monitor, Camera, Loader2, Check, AlertTriangle } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { t, getOpsLang, setOpsLang } from '../../utils/opsStrings'
import { toastError, toastSuccess } from '../../components/v2/Toast'

const card = { background: 'var(--v2-bg-1, #1e293b)', border: '1px solid var(--v2-line, #334155)', borderRadius: 14, padding: 16 }
const lbl = { fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', color: 'var(--v2-ink-2, #94a3b8)', display: 'block', marginBottom: 6 }
const field = { width: '100%', boxSizing: 'border-box', background: 'var(--v2-bg-2, #0f172a)', color: 'var(--v2-ink-0, #f1f5f9)', border: '1px solid var(--v2-line, #334155)', borderRadius: 10, padding: '11px 12px', fontSize: 15 }

export default function OpsLogV2() {
  const [params] = useSearchParams()
  const [lang, setLang] = useState(getOpsLang())
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')

  const [depots, setDepots] = useState([])
  const [issueTypes, setIssueTypes] = useState([])
  const [depotId, setDepotId] = useState('')
  const [contacts, setContacts] = useState([])
  const [screens, setScreens] = useState([])
  const [screenId, setScreenId] = useState('')
  const [recent, setRecent] = useState([])

  const [issueId, setIssueId] = useState('')      // '' | <ops_issue_types.id> | 'other'
  const [otherText, setOtherText] = useState('')
  const [notes, setNotes] = useState('')
  const [photoFile, setPhotoFile] = useState(null)
  const [busy, setBusy] = useState(false)
  const savingRef = useRef(false)
  const fileRef = useRef(null)

  const flip = () => { const n = lang === 'gu' ? 'en' : 'gu'; setLang(n); setOpsLang(n) }
  const nm = (row, base) => (lang === 'gu' ? row[`${base}_gu`] : row[`${base}_en`]) || row[`${base}_en`] || ''

  // 1 · cities + issue types
  const loadShell = useCallback(async () => {
    try {
      const [dRes, itRes] = await Promise.all([
        supabase.from('ops_depots').select('id, name').eq('is_active', true).order('name'),
        supabase.from('ops_issue_types').select('id, issue_en, issue_gu, display_order').eq('is_active', true).order('display_order'),
      ])
      if (dRes.error) throw dRes.error
      setDepots(dRes.data || [])
      setIssueTypes(itRes.data || [])
    } catch (e) { setErr(e?.message || 'load failed') }
  }, [])

  // 2 · a city's contacts + screens
  const loadCity = useCallback(async (id) => {
    setContacts([]); setScreens([]); setScreenId(''); setRecent([])
    if (!id) return
    try {
      const [cRes, sRes] = await Promise.all([
        supabase.from('ops_depot_contacts').select('id, role_en, role_gu, name, phone, display_order').eq('depot_id', id).order('display_order'),
        supabase.from('ops_screens').select('id, name, status').eq('depot_id', id).eq('is_active', true).order('name'),
      ])
      setContacts(cRes.data || [])
      setScreens(sRes.data || [])
    } catch (e) { toastError(e, t('error_generic', lang)) }
  }, [lang])

  // 3 · issues already logged on the chosen screen
  const loadRecent = useCallback(async (sid) => {
    if (!sid) { setRecent([]); return }
    const { data } = await supabase.from('ops_tickets')
      .select('id, cause, notes, photo_path, created_at, issue:ops_issue_types!ops_tickets_issue_type_id_fkey(issue_en, issue_gu)')
      .eq('screen_id', sid).order('created_at', { ascending: false }).limit(5)
    setRecent(data || [])
  }, [])

  useEffect(() => { (async () => { setLoading(true); await loadShell(); setLoading(false) })() }, [loadShell])
  // Preselect a city from ?depot= (the Down-now "Log what's wrong" deep-link).
  useEffect(() => {
    const pre = params.get('depot')
    if (pre && depots.some(d => d.id === pre)) setDepotId(pre)
  }, [depots, params])
  useEffect(() => { loadCity(depotId) }, [depotId, loadCity])
  useEffect(() => { loadRecent(screenId) }, [screenId, loadRecent])

  const depot = depots.find(d => d.id === depotId)
  const contactRole = (c) => (lang === 'gu' ? c.role_gu : c.role_en) || c.role_en || c.name || '—'
  const screenLabel = useMemo(() => {
    const m = {}; screens.forEach((s, i) => { m[s.id] = `${t('screen', lang)} ${i + 1}` }); return m
  }, [screens, lang])
  const canSave = depotId && screenId && issueId && (issueId !== 'other' || otherText.trim())

  async function save() {
    if (savingRef.current || busy) return
    if (!canSave) { toastError(new Error(''), t('need_screen', lang)); return }
    savingRef.current = true; setBusy(true)
    try {
      let photo_path = null
      if (photoFile) {
        const ext = (photoFile.name.split('.').pop() || 'jpg').toLowerCase()
        const key = `${depotId}/${screenId}/${Date.now()}.${ext}`
        const up = await supabase.storage.from('ops-photos').upload(key, photoFile, { upsert: false })
        if (up.error) { toastError(up.error, t('save_failed', lang)); return }
        photo_path = key
      }
      const preset = issueId !== 'other' ? issueTypes.find(x => x.id === issueId) : null
      const cause = preset ? preset.issue_en : otherText.trim()
      const { error } = await supabase.from('ops_tickets').insert([{
        type: 'fault', source: 'manual', status: 'open',
        depot_id: depotId, screen_id: screenId,
        issue_type_id: preset ? preset.id : null,
        cause, notes: notes.trim() || null, photo_path,
      }])
      if (error) { toastError(error, t('save_failed', lang)); return }
      toastSuccess(t('issue_saved', lang))
      setIssueId(''); setOtherText(''); setNotes(''); setPhotoFile(null)
      if (fileRef.current) fileRef.current.value = ''
      loadRecent(screenId)
    } finally { setBusy(false); savingRef.current = false }
  }

  if (loading) return <div style={{ minHeight: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--v2-ink-2, #94a3b8)' }}><Loader2 size={22} style={{ animation: 'spin 1s linear infinite' }} /></div>
  if (err) return <div style={{ padding: 20 }}><div style={{ background: 'var(--danger-soft, rgba(239,68,68,.12))', color: 'var(--danger)', border: '1px solid var(--danger)', borderRadius: 10, padding: '12px 16px' }}>{err} <button className="btn btn-sec btn-sm" onClick={() => { setErr(''); loadShell() }} style={{ marginLeft: 10 }}>{t('retry', lang)}</button></div></div>

  return (
    <div style={{ padding: '16px 16px 40px', maxWidth: 480, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Monitor size={20} style={{ color: 'var(--v2-yellow, #FFE600)' }} />
          <span style={{ fontSize: 17, fontWeight: 700 }}>{t('log_title', lang)}</span>
        </div>
        <button onClick={flip} className="btn btn-ghost btn-sm" style={{ fontWeight: 700 }}>{lang === 'gu' ? 'EN' : 'ગુ'}</button>
      </div>

      <div style={{ ...card, marginBottom: 14 }}>
        {/* city */}
        <label style={lbl}><MapPin size={13} style={{ verticalAlign: -2, marginRight: 4 }} />{t('city', lang)}</label>
        <select value={depotId} onChange={e => setDepotId(e.target.value)} style={{ ...field, borderColor: 'var(--v2-yellow, #FFE600)' }}>
          <option value="">{t('pick_city', lang)}</option>
          {depots.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>

        {/* contacts auto-appear */}
        {depotId && (
          <div style={{ marginTop: 12, background: 'var(--v2-tint-blue, rgba(59,130,246,.12))', borderRadius: 10, padding: '10px 12px' }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--v2-blue, #3B82F6)', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
              <Phone size={14} />{depot?.name} — {t('who_to_call', lang)}
            </div>
            {contacts.length === 0
              ? <div style={{ fontSize: 13, color: 'var(--v2-ink-2, #94a3b8)' }}>{t('no_contacts', lang)}</div>
              : contacts.map(c => (
                <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', fontSize: 14 }}>
                  <span style={{ color: 'var(--v2-ink-2, #94a3b8)' }}>{contactRole(c)}</span>
                  <a href={`tel:${(c.phone || '').replace(/\s/g, '')}`} style={{ color: 'var(--v2-yellow, #FFE600)', fontFamily: 'var(--v2-mono, monospace)', textDecoration: 'none' }}>{c.phone || '—'}</a>
                </div>
              ))}
          </div>
        )}

        {/* screen */}
        {depotId && (
          <>
            <label style={{ ...lbl, marginTop: 14 }}><Monitor size={13} style={{ verticalAlign: -2, marginRight: 4 }} />{t('screen', lang)}</label>
            <select value={screenId} onChange={e => setScreenId(e.target.value)} style={field}>
              <option value="">{t('pick_screen', lang)}</option>
              {screens.map((s, i) => <option key={s.id} value={s.id}>{`${t('screen', lang)} ${i + 1}`}</option>)}
            </select>
            {screenId && <div style={{ fontSize: 12, color: 'var(--v2-ink-2, #94a3b8)', marginTop: 4 }}>{screens.find(s => s.id === screenId)?.name}</div>}
          </>
        )}
      </div>

      {/* issue details — after a screen is picked */}
      {screenId && (
        <div style={card}>
          <label style={lbl}>{t('cause', lang)}</label>
          <select value={issueId} onChange={e => setIssueId(e.target.value)} style={field}>
            <option value="">{t('pick_screen', lang) && '—'}</option>
            {issueTypes.map(it => <option key={it.id} value={it.id}>{nm(it, 'issue')}</option>)}
            <option value="other">{t('other_issue', lang)}</option>
          </select>
          {issueId === 'other' && (
            <input value={otherText} onChange={e => setOtherText(e.target.value)} placeholder={t('cause_ph', lang)} style={{ ...field, marginTop: 8 }} />
          )}

          <label style={{ ...lbl, marginTop: 14 }}>{t('notes', lang)}</label>
          <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} placeholder={t('notes_ph', lang)} style={{ ...field, resize: 'none' }} />

          <input ref={fileRef} type="file" accept="image/*" capture="environment" onChange={e => setPhotoFile(e.target.files?.[0] || null)} style={{ display: 'none' }} />
          <button onClick={() => fileRef.current?.click()} style={{ ...field, marginTop: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, color: photoFile ? 'var(--v2-green, #10B981)' : 'var(--v2-ink-1, #cbd5e1)' }}>
            {photoFile ? <Check size={18} /> : <Camera size={18} />}{photoFile ? t('photo_added', lang) : t('upload_photo', lang)}
          </button>

          <button onClick={save} disabled={busy || !canSave}
            style={{ width: '100%', marginTop: 14, padding: '13px', borderRadius: 10, border: 'none', fontSize: 15, fontWeight: 700, cursor: busy || !canSave ? 'default' : 'pointer', opacity: busy || !canSave ? 0.55 : 1, background: 'var(--v2-yellow, #FFE600)', color: 'var(--v2-ink-on-yellow, #0f172a)' }}>
            {busy ? t('saving', lang) : t('save_issue', lang)}
          </button>

          {/* logged on this screen */}
          <div style={{ marginTop: 16, borderTop: '1px solid var(--v2-line, #334155)', paddingTop: 12 }}>
            <div style={lbl}>{t('recent_issues', lang)}</div>
            {recent.length === 0
              ? <div style={{ fontSize: 13, color: 'var(--v2-ink-2, #94a3b8)' }}>{t('no_recent', lang)}</div>
              : recent.map(r => (
                <div key={r.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '7px 0', borderBottom: '1px solid var(--v2-line, #334155)' }}>
                  <AlertTriangle size={15} style={{ color: 'var(--v2-amber, #F59E0B)', flexShrink: 0, marginTop: 2 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600 }}>{r.issue ? nm(r.issue, 'issue') : (r.cause || t('fault', lang))}</div>
                    {r.notes && <div style={{ fontSize: 12, color: 'var(--v2-ink-2, #94a3b8)' }}>{r.notes}</div>}
                    <div style={{ fontSize: 11, color: 'var(--v2-ink-2, #94a3b8)', marginTop: 2 }}>{new Date(r.created_at).toLocaleString('en-GB')}{r.photo_path ? ' · photo' : ''}</div>
                  </div>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  )
}
