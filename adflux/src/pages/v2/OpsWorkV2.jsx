// src/pages/v2/OpsWorkV2.jsx
//
// /ops — Operations module Phase 1 (§230).
//
// One route, role-branched:
//   • operation_executive → the mobile FIELD app (Gujarati-first): check
//     in, see the ticket queue assigned to me, report a fault, open a
//     ticket → call the depot + log the fix + attach a photo.
//   • operation_head      → redirected to the desk console /ops-dashboard
//     (OpsHeadV2, Phase 2). This page is the field-tech surface only.
//
// Reuses the sales stack: gps_pings (background GPS tracks the exec like a
// rep), work_sessions (attendance / check-in), call_logs (depot calls,
// ticket-keyed — no lead, so no fancy duration capture, §230), the private
// ops-photos bucket. All labels flow through utils/opsStrings.js so the
// field team reads Gujarati.
//
// Additive module — no sales/frozen contract touched.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Wrench, MapPin, Phone, CheckCircle2, Loader2, Plus, X, Camera,
  AlertTriangle, MonitorSmartphone, RefreshCw, ChevronDown, ChevronUp,
  PlayCircle, Building2, Navigation,
} from 'lucide-react'
import { Navigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/authStore'
import { toastError, toastSuccess } from '../../components/v2/Toast'
import { dialPhone, openExternalUrl } from '../../utils/openExternal'
import { istTodayISO } from '../../utils/istDate'
import { resizeImage } from '../../utils/leadDedup'
import {
  STR, t, numL, dateL, timeL, getOpsLang, setOpsLang,
} from '../../utils/opsStrings'

/* ─── small helpers (mirrors WorkV2's inline versions) ─────────────── */

async function captureGps() {
  if (!navigator.geolocation) return null
  try {
    const pos = await new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: false, timeout: 5000, maximumAge: 60000,
      })
    })
    return {
      lat: pos.coords.latitude,
      lng: pos.coords.longitude,
      accuracy: Math.round(pos.coords.accuracy),
    }
  } catch { return null }
}

function logGpsPing(userId, gps, source) {
  if (!gps?.lat || !gps?.lng) return
  supabase.from('gps_pings').insert([{
    user_id: userId, lat: gps.lat, lng: gps.lng,
    accuracy_m: gps.accuracy || null, source,
  }]).then(() => {}, () => {})
}

function cleanPhone(raw) {
  if (!raw) return null
  const d = String(raw).replace(/\D/g, '')
  if (d.length < 10) return null
  return d.length === 10 ? '91' + d : d
}

// Indicative variable pay from uptime — MUST match OpsAdminV2.indicativeVariable
// (SLA band 75→95%, 70/30 split, >75 score = full 30% cap). Owner 2026-08-28:
// full bonus at ≥95% uptime, zero below ~85%, graded 85–90%. Display only; real
// pay = the Salary sheet once uptime pay (Phase 4) is turned on. Keep in lockstep
// with supabase_ops_p4_uptime_pay.sql (v_floor 75 / v_ceiling 95) — §71.
function indicativeVariable(salary, uptimePct) {
  const score = Math.max(0, Math.min(100, ((uptimePct - 75) / 20) * 100))
  const frac = score > 75 ? 1 : score < 50 ? 0 : score / 100
  return Math.round((Number(salary) || 0) * 0.30 * frac)
}

// Directions link to a depot — lat/lng if we have them, else the depot name.
function depotMapsUrl(depot) {
  if (!depot) return null
  if (depot.lat != null && depot.lng != null) {
    return `https://www.google.com/maps/dir/?api=1&destination=${depot.lat},${depot.lng}`
  }
  if (depot.name) {
    return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(depot.name + ', Gujarat')}`
  }
  return null
}

/* ─── shared styling (v2 tokens only — §6) ─────────────────────────── */

const card = {
  background: 'var(--v2-bg-1)', border: '1px solid var(--v2-line)',
  borderRadius: 'var(--v2-r)', padding: 14,
}
const btnPrimary = {
  background: 'var(--v2-yellow)', color: 'var(--v2-yellow-ink)', border: 'none',
  borderRadius: 'var(--v2-r-sm)', padding: '13px 16px', fontWeight: 700,
  fontFamily: 'var(--v2-display)', fontSize: 16, cursor: 'pointer', width: '100%',
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
}
const btnGhost = {
  background: 'var(--v2-bg-2)', color: 'var(--v2-ink-0)', border: '1px solid var(--v2-line)',
  borderRadius: 'var(--v2-r-sm)', padding: '11px 14px', fontWeight: 600,
  fontSize: 15, cursor: 'pointer', display: 'inline-flex', alignItems: 'center',
  justifyContent: 'center', gap: 7,
}
const field = {
  width: '100%', background: 'var(--v2-bg-2)', color: 'var(--v2-ink-0)',
  border: '1px solid var(--v2-surface-3)', borderRadius: 'var(--v2-r-sm)',
  padding: '11px 12px', fontSize: 16, fontFamily: 'var(--v2-sans)',
}
const labelStyle = { fontSize: 13, color: 'var(--v2-ink-1)', fontWeight: 600, marginBottom: 6, display: 'block' }

function statusChip(status, lang) {
  const map = {
    open:        { bg: 'var(--v2-rose-soft)',    fg: 'var(--v2-rose)',   key: 'st_open' },
    in_progress: { bg: 'var(--v2-tint-blue)',    fg: 'var(--v2-blue)',   key: 'st_in_progress' },
    resolved:    { bg: 'var(--v2-green-soft)',   fg: 'var(--v2-green)',  key: 'st_resolved' },
  }
  const c = map[status] || map.open
  return (
    <span style={{
      background: c.bg, color: c.fg, fontSize: 12, fontWeight: 700,
      padding: '3px 9px', borderRadius: 999, whiteSpace: 'nowrap',
    }}>{t(c.key, lang)}</span>
  )
}

/* ═══════════════════════════════════════════════════════════════════
   ROOT — role branch
   ═══════════════════════════════════════════════════════════════════ */

export default function OpsWorkV2() {
  const profile = useAuthStore(s => s.profile)
  const [lang, setLangState] = useState(getOpsLang())
  const setLang = (l) => { setOpsLang(l); setLangState(l) }

  const role = profile?.role
  const langBar = (
    <div style={{ display: 'inline-flex', gap: 2, background: 'var(--v2-bg-2)', borderRadius: 999, padding: 3 }}>
      {['gu', 'en'].map(l => (
        <button key={l} onClick={() => setLang(l)} style={{
          border: 'none', cursor: 'pointer', borderRadius: 999, padding: '5px 12px',
          fontSize: 13, fontWeight: 700,
          background: lang === l ? 'var(--v2-yellow)' : 'transparent',
          color: lang === l ? 'var(--v2-yellow-ink)' : 'var(--v2-ink-1)',
        }}>{l === 'gu' ? 'ગુ' : 'EN'}</button>
      ))}
    </div>
  )

  if (role === 'operation_head') {
    // Phase 2 — the Head lives on the full desk console (/ops-dashboard).
    return <Navigate to="/ops-dashboard" replace />
  }
  return <OpsExecApp profile={profile} lang={lang} langBar={langBar} />
}

/* ═══════════════════════════════════════════════════════════════════
   EXECUTIVE — the mobile field app
   ═══════════════════════════════════════════════════════════════════ */

function OpsExecApp({ profile, lang, langBar }) {
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [session, setSession] = useState(null)     // work_sessions row
  const [tickets, setTickets] = useState([])
  const [resolvedCount, setResolvedCount] = useState(0)
  const [depots, setDepots] = useState([])
  const [issueTypes, setIssueTypes] = useState([])
  const [screensByDepot, setScreensByDepot] = useState({})
  const [contactsByDepot, setContactsByDepot] = useState({})
  const [checkingIn, setCheckingIn] = useState(false)
  const [reportOpen, setReportOpen] = useState(false)
  const [expandedId, setExpandedId] = useState(null)
  const [pay, setPay] = useState(null)               // ops_my_uptime_pay (Phase 6)

  const today = istTodayISO()
  const uid = profile?.id

  const load = useCallback(async () => {
    if (!uid) return
    setErr('')
    try {
      const [sessRes, tkRes, depRes, itRes] = await Promise.all([
        supabase.from('work_sessions')
          .select('id, check_in_at, work_date')
          .eq('user_id', uid).eq('work_date', today).maybeSingle(),
        supabase.from('ops_tickets')
          .select('id, type, status, source, down_count, priority, cause, notes, photo_path, opened_at, ' +
                  'screen:ops_screens!ops_tickets_screen_id_fkey(id,name), ' +
                  'depot:ops_depots!ops_tickets_depot_id_fkey(id,name,lat,lng), ' +
                  'issue:ops_issue_types!ops_tickets_issue_type_id_fkey(id,issue_en,issue_gu,solution_en,solution_gu)')
          .eq('assigned_to', uid)
          .in('status', ['open', 'in_progress'])
          .order('priority', { ascending: false })
          .order('opened_at', { ascending: true }),
        supabase.from('ops_depots')
          .select('id, name, code, city_id')
          .eq('is_active', true).order('name'),
        supabase.from('ops_issue_types')
          .select('id, issue_en, issue_gu, solution_en, solution_gu')
          .eq('is_active', true).order('display_order'),
      ])

      if (sessRes.error) throw sessRes.error
      if (tkRes.error) throw tkRes.error
      setSession(sessRes.data || null)
      setTickets(tkRes.data || [])
      setDepots(depRes.data || [])
      setIssueTypes(itRes.data || [])

      // Resolved-today count (head:true — no rows pulled).
      const { count } = await supabase.from('ops_tickets')
        .select('id', { count: 'exact', head: true })
        .eq('assigned_to', uid).eq('status', 'resolved')
        .gte('resolved_at', `${today}T00:00:00+05:30`)
      setResolvedCount(count || 0)

      // Screens + contacts for the depots (report form + ticket detail).
      const depotIds = (depRes.data || []).map(d => d.id)
      if (depotIds.length) {
        const [scRes, coRes] = await Promise.all([
          supabase.from('ops_screens').select('id, name, depot_id').eq('is_active', true).in('depot_id', depotIds),
          supabase.from('ops_depot_contacts').select('id, role_en, role_gu, name, phone, depot_id').in('depot_id', depotIds).order('display_order'),
        ])
        const sByD = {}; (scRes.data || []).forEach(s => { (sByD[s.depot_id] ||= []).push(s) })
        const cByD = {}; (coRes.data || []).forEach(c => { (cByD[c.depot_id] ||= []).push(c) })
        setScreensByDepot(sByD)
        setContactsByDepot(cByD)
      } else {
        setScreensByDepot({})
        setContactsByDepot({})
      }
    } catch (e) {
      setErr(e?.message || 'load failed')
    } finally {
      setLoading(false)
    }
  }, [uid, today])

  useEffect(() => { load() }, [load])

  // Your pay so far (Phase 6). Best-effort — the RPC ships in
  // supabase_ops_p6_admin_cockpit.sql; a missing RPC just hides the card.
  useEffect(() => {
    if (!uid) return
    let alive = true
    supabase.rpc('ops_my_uptime_pay').then(({ data, error }) => {
      if (alive && !error && data && typeof data === 'object') setPay(data)
    }, () => {})
    return () => { alive = false }
  }, [uid])

  // Refresh when the field tech returns to the app (came back from the
  // dialer / camera). No realtime — ops tables aren't in the publication.
  useEffect(() => {
    const onVis = () => { if (document.visibilityState === 'visible') load() }
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('focus', onVis)
    return () => {
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('focus', onVis)
    }
  }, [load])

  const checkedIn = !!session?.check_in_at

  async function doCheckIn() {
    if (!uid) return
    setCheckingIn(true)
    const gps = await captureGps()
    try {
      // Ops has no plan/startDay flow → the work_sessions row may not
      // exist yet. Insert if missing, else update.
      const { data: existing } = await supabase.from('work_sessions')
        .select('id').eq('user_id', uid).eq('work_date', today).maybeSingle()
      const payload = {
        check_in_at: new Date().toISOString(),
        check_in_gps_lat: gps?.lat || null,
        check_in_gps_lng: gps?.lng || null,
      }
      let error
      if (existing) {
        ;({ error } = await supabase.from('work_sessions').update(payload)
          .eq('user_id', uid).eq('work_date', today))
      } else {
        ;({ error } = await supabase.from('work_sessions')
          .insert([{ user_id: uid, work_date: today, ...payload }]))
      }
      if (error) throw error
      logGpsPing(uid, gps, 'checkin')
      await load()
    } catch (e) {
      toastError(e, t('error_generic', lang))
    } finally {
      setCheckingIn(false)
    }
  }

  const wrap = { maxWidth: 640, margin: '0 auto', padding: '14px 14px 90px', display: 'flex', flexDirection: 'column', gap: 12 }

  if (loading) {
    return (
      <div style={{ ...wrap, alignItems: 'center', paddingTop: 60 }}>
        <Loader2 size={30} strokeWidth={1.6} style={{ color: 'var(--v2-ink-2)', animation: 'spin 1s linear infinite' }} />
        <span style={{ color: 'var(--v2-ink-2)', fontSize: 14 }}>{t('loading', lang)}</span>
      </div>
    )
  }

  if (err) {
    return (
      <div style={{ ...wrap }}>
        <div style={{ ...card, borderColor: 'var(--v2-rose)', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          <AlertTriangle size={18} strokeWidth={1.6} style={{ color: 'var(--v2-rose)', flexShrink: 0, marginTop: 2 }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>{t('error_generic', lang)}</div>
            <div style={{ fontSize: 13, color: 'var(--v2-ink-2)', wordBreak: 'break-word' }}>{err}</div>
            <button onClick={load} style={{ ...btnGhost, marginTop: 10 }}>
              <RefreshCw size={15} strokeWidth={1.6} />{t('retry', lang)}
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div style={wrap}>
      {/* header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ fontSize: 13, color: 'var(--v2-ink-2)' }}>{t('greeting', lang)}</div>
          <div style={{ fontSize: 22, fontWeight: 800, fontFamily: 'var(--v2-display)', lineHeight: 1.1 }}>
            {profile?.name || t('operations', lang)}
          </div>
          <div style={{ fontSize: 12, color: 'var(--v2-ink-2)', marginTop: 2 }}>{dateL(today, lang)}</div>
        </div>
        {langBar}
      </div>

      {/* check-in */}
      {checkedIn ? (
        <div style={{ ...card, display: 'flex', alignItems: 'center', gap: 10 }}>
          <CheckCircle2 size={20} strokeWidth={1.6} style={{ color: 'var(--v2-green)' }} />
          <span style={{ fontWeight: 700 }}>{t('checked_in_at', lang)}</span>
          <span style={{ marginLeft: 'auto', fontFamily: 'var(--v2-display)', color: 'var(--v2-ink-1)' }}>
            {timeL(session.check_in_at, lang)}
          </span>
        </div>
      ) : (
        <div style={card}>
          <div style={{ fontSize: 14, color: 'var(--v2-ink-1)', marginBottom: 10 }}>{t('check_in_hint', lang)}</div>
          <button onClick={doCheckIn} disabled={checkingIn} style={{ ...btnPrimary, opacity: checkingIn ? 0.7 : 1 }}>
            {checkingIn
              ? <><Loader2 size={17} strokeWidth={1.6} style={{ animation: 'spin 1s linear infinite' }} />{t('checking_in', lang)}</>
              : <><MapPin size={17} strokeWidth={1.6} />{t('check_in', lang)}</>}
          </button>
        </div>
      )}

      {/* stats */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Stat n={tickets.length} label={t('open_tickets', lang)} lang={lang} tone="rose" />
        <Stat n={resolvedCount} label={t('resolved_today', lang)} lang={lang} tone="green" />
      </div>

      {/* your pay so far (Phase 6) */}
      {pay?.has_data && (
        <div style={card}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 10 }}>
            <div style={{ fontSize: 15, fontWeight: 700 }}>{t('your_pay', lang)}</div>
            <div style={{ fontSize: 12, color: 'var(--v2-ink-2)' }}>{dateL(today, lang).replace(/\s?\d+,?/, '')}</div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <div style={{
                fontFamily: 'var(--v2-display)', fontSize: 30, fontWeight: 800,
                color: Number(pay.uptime_pct) >= 90 ? 'var(--v2-green)' : 'var(--v2-amber)',
              }}>{numL(Math.round(Number(pay.uptime_pct) || 0), lang)}%</div>
              <div style={{ fontSize: 13, color: 'var(--v2-ink-1)', marginTop: 2 }}>{t('uptime_month', lang)}</div>
            </div>
            <div>
              <div style={{ fontFamily: 'var(--v2-display)', fontSize: 30, fontWeight: 800, color: 'var(--v2-ink-0)' }}>
                ₹{numL(indicativeVariable(pay.salary, pay.uptime_pct), lang)}
              </div>
              <div style={{ fontSize: 13, color: 'var(--v2-ink-1)', marginTop: 2 }}>{t('est_variable', lang)}</div>
            </div>
          </div>
          <div style={{ fontSize: 12, color: 'var(--v2-ink-2)', marginTop: 10 }}>{t('pay_hint', lang)}</div>
        </div>
      )}

      {/* report a fault */}
      <button onClick={() => setReportOpen(true)} style={btnGhost}>
        <Plus size={17} strokeWidth={1.6} />{t('report_fault', lang)}
      </button>

      {/* ticket queue */}
      <div style={{ fontSize: 15, fontWeight: 700, marginTop: 4 }}>{t('my_tickets', lang)}</div>
      {tickets.length === 0 ? (
        <div style={{ ...card, textAlign: 'center', color: 'var(--v2-ink-2)', padding: 24 }}>
          <CheckCircle2 size={26} strokeWidth={1.6} style={{ color: 'var(--v2-ink-2)', marginBottom: 8 }} />
          <div style={{ fontSize: 14 }}>{t('no_tickets', lang)}</div>
        </div>
      ) : tickets.map(tk => (
        <TicketCard
          key={tk.id} tk={tk} lang={lang}
          expanded={expandedId === tk.id}
          onToggle={() => setExpandedId(expandedId === tk.id ? null : tk.id)}
          contacts={contactsByDepot[tk.depot?.id] || []}
          uid={uid} onChanged={load}
        />
      ))}

      {reportOpen && (
        <ReportFaultModal
          lang={lang} uid={uid} depots={depots} issueTypes={issueTypes}
          screensByDepot={screensByDepot}
          onClose={() => setReportOpen(false)}
          onSaved={() => { setReportOpen(false); load() }}
        />
      )}
    </div>
  )
}

function Stat({ n, label, lang, tone }) {
  const c = tone === 'green' ? 'var(--v2-green)' : 'var(--v2-rose)'
  return (
    <div style={card}>
      <div style={{ fontFamily: 'var(--v2-display)', fontSize: 30, fontWeight: 800, color: c }}>{numL(n, lang)}</div>
      <div style={{ fontSize: 13, color: 'var(--v2-ink-1)', marginTop: 2 }}>{label}</div>
    </div>
  )
}

/* ─── one ticket card (expand → detail + actions) ──────────────────── */

function TicketCard({ tk, lang, expanded, onToggle, contacts, uid, onChanged }) {
  const [busy, setBusy] = useState(false)
  const [cause, setCause] = useState(tk.cause || '')
  const [notes, setNotes] = useState(tk.notes || '')
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef(null)

  const isPhoto = tk.type === 'photo_request'
  const issue = tk.issue
  const issueLabel = lang === 'gu' ? (issue?.issue_gu || issue?.issue_en) : (issue?.issue_en || issue?.issue_gu)
  const solLabel = lang === 'gu' ? (issue?.solution_gu || issue?.solution_en) : (issue?.solution_en || issue?.solution_gu)

  async function callContact(c) {
    const digits = cleanPhone(c.phone)
    if (!digits) return
    dialPhone(c.phone)
    // Best-effort ticket-keyed audit (no lead → no duration capture, §230).
    try {
      await supabase.from('call_logs').insert([{
        user_id: uid, client_phone: digits, direction: 'outgoing', outcome: 'no_answer',
        notes: `Ops depot call · ${c.name || c.role_en || ''} · ticket ${tk.id.slice(0, 8)}`,
      }])
    } catch { /* audit is best-effort */ }
  }

  async function setStatus(status) {
    setBusy(true)
    try {
      let error
      if (status === 'in_progress') {
        ;({ error } = await supabase.rpc('ops_ticket_start', { p_ticket: tk.id }))
      } else if (status === 'resolved') {
        ;({ error } = await supabase.rpc('ops_ticket_resolve', {
          p_ticket: tk.id, p_cause: cause.trim() || null, p_notes: notes.trim() || null,
        }))
      }
      if (error) { toastError(error, t('save_failed', lang)); return }
      toastSuccess(t(status === 'resolved' ? 'st_resolved' : 'st_in_progress', lang))
      if (onChanged) await onChanged()
    } catch (e) {
      toastError(e, t('save_failed', lang))
    } finally { setBusy(false) }
  }

  async function saveFix() {
    setBusy(true)
    try {
      const { error } = await supabase.from('ops_tickets')
        .update({ cause: cause.trim() || null, notes: notes.trim() || null }).eq('id', tk.id)
      if (error) throw error
      toastSuccess(t('fix_saved', lang))
      await onChanged()
    } catch (e) { toastError(e, t('error_generic', lang)) } finally { setBusy(false) }
  }

  async function onPhoto(e) {
    const original = e.target.files?.[0]
    if (!original) return
    setUploading(true)
    try {
      const file = await resizeImage(original, 1280, 0.85)
      const key = `${tk.id}/${Date.now()}.jpg`
      const { error: upErr } = await supabase.storage.from('ops-photos')
        .upload(key, file, { upsert: false, contentType: file.type || 'image/jpeg' })
      if (upErr) throw upErr
      const { error } = await supabase.from('ops_tickets').update({ photo_path: key }).eq('id', tk.id)
      if (error) throw error
      toastSuccess(t('photo_added', lang))
      await onChanged()
    } catch (e) { toastError(e, t('error_generic', lang)) } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  return (
    <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
      <button onClick={onToggle} style={{
        width: '100%', background: 'transparent', border: 'none', cursor: 'pointer',
        padding: 14, display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left',
      }}>
        <span style={{
          width: 34, height: 34, borderRadius: 'var(--v2-r-sm)', flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: isPhoto ? 'var(--v2-tint-blue)' : 'var(--v2-rose-soft)',
          color: isPhoto ? 'var(--v2-blue)' : 'var(--v2-rose)',
        }}>
          {isPhoto ? <Camera size={18} strokeWidth={1.6} /> : <Wrench size={18} strokeWidth={1.6} />}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
            <span style={{ fontWeight: 700, fontSize: 15, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>
              {isPhoto ? t('photo_request', lang) : (issueLabel || t('fault', lang))}
            </span>
            {tk.source === 'auto_offline' && (
              <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 999,
                background: 'var(--v2-tint-blue, rgba(59,130,246,.12))', color: 'var(--v2-blue, #3B82F6)', flexShrink: 0 }}>
                {t('auto', lang)}
              </span>
            )}
          </div>
          <div style={{ fontSize: 12.5, color: 'var(--v2-ink-2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {[tk.screen?.name, tk.depot?.name].filter(Boolean).join(' · ')}
          </div>
        </div>
        {statusChip(tk.status, lang)}
        {expanded ? <ChevronUp size={18} strokeWidth={1.6} style={{ color: 'var(--v2-ink-2)' }} />
                  : <ChevronDown size={18} strokeWidth={1.6} style={{ color: 'var(--v2-ink-2)' }} />}
      </button>

      {expanded && (
        <div style={{ borderTop: '1px solid var(--v2-line)', padding: 14, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* screen / depot */}
          <Row icon={MonitorSmartphone} label={t('screen', lang)} value={tk.screen?.name} />
          <Row icon={Building2} label={t('depot', lang)} value={tk.depot?.name} />
          {depotMapsUrl(tk.depot) && (
            <button onClick={() => openExternalUrl(depotMapsUrl(tk.depot))} style={{ ...btnGhost, color: 'var(--v2-blue)', borderColor: 'var(--v2-blue)' }}>
              <Navigation size={16} strokeWidth={1.6} />{t('navigate', lang)}
            </button>
          )}
          {!isPhoto && issueLabel && <Row icon={AlertTriangle} label={t('problem', lang)} value={issueLabel} />}
          {!isPhoto && solLabel && (
            <div style={{ background: 'var(--v2-bg-2)', borderRadius: 'var(--v2-r-sm)', padding: '10px 12px' }}>
              <div style={labelStyle}>{t('solution', lang)}</div>
              <div style={{ fontSize: 14, color: 'var(--v2-ink-0)' }}>{solLabel}</div>
            </div>
          )}

          {/* who to call */}
          <div>
            <div style={labelStyle}>{t('contacts', lang)}</div>
            {contacts.length === 0 ? (
              <div style={{ fontSize: 13, color: 'var(--v2-ink-2)' }}>{t('no_contacts', lang)}</div>
            ) : contacts.map(c => (
              <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderTop: '1px solid var(--v2-line)' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{c.name || (lang === 'gu' ? (c.role_gu || c.role_en) : c.role_en) || '—'}</div>
                  <div style={{ fontSize: 12, color: 'var(--v2-ink-2)' }}>{(lang === 'gu' ? (c.role_gu || c.role_en) : c.role_en) || ''} {c.phone}</div>
                </div>
                <button onClick={() => callContact(c)} disabled={!c.phone} style={{
                  ...btnGhost, padding: '8px 12px', color: 'var(--v2-green)', borderColor: 'var(--v2-green)',
                }}>
                  <Phone size={15} strokeWidth={1.6} />{t('call', lang)}
                </button>
              </div>
            ))}
          </div>

          {/* status transitions */}
          <div style={{ display: 'flex', gap: 8 }}>
            {tk.status === 'open' && (
              <button onClick={() => setStatus('in_progress')} disabled={busy} style={{ ...btnGhost, flex: 1, color: 'var(--v2-blue)', borderColor: 'var(--v2-blue)' }}>
                <PlayCircle size={16} strokeWidth={1.6} />{t('start_work', lang)}
              </button>
            )}
            <button onClick={() => setStatus('resolved')} disabled={busy} style={{ ...btnPrimary, flex: 1, background: 'var(--v2-green)', color: 'var(--v2-ink-0)' }}>
              {busy ? <Loader2 size={16} strokeWidth={1.6} style={{ animation: 'spin 1s linear infinite' }} /> : <CheckCircle2 size={16} strokeWidth={1.6} />}
              {t('mark_resolved', lang)}
            </button>
          </div>

          {/* log the fix (fault tickets) */}
          {!isPhoto && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div>
                <label style={labelStyle}>{t('cause', lang)}</label>
                <input value={cause} onChange={e => setCause(e.target.value)} placeholder={t('cause_ph', lang)} style={field} />
              </div>
              <div>
                <label style={labelStyle}>{t('notes', lang)}</label>
                <textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder={t('notes_ph', lang)} rows={2} style={{ ...field, resize: 'vertical' }} />
              </div>
              <button onClick={saveFix} disabled={busy} style={btnGhost}>{t('save', lang)}</button>
            </div>
          )}

          {/* photo */}
          <div>
            <input ref={fileRef} type="file" accept="image/*" capture="environment" onChange={onPhoto} style={{ display: 'none' }} />
            <button onClick={() => fileRef.current?.click()} disabled={uploading} style={btnGhost}>
              {uploading
                ? <><Loader2 size={16} strokeWidth={1.6} style={{ animation: 'spin 1s linear infinite' }} />{t('uploading', lang)}</>
                : tk.photo_path
                  ? <><CheckCircle2 size={16} strokeWidth={1.6} style={{ color: 'var(--v2-green)' }} />{t('photo_added', lang)}</>
                  : <><Camera size={16} strokeWidth={1.6} />{t('add_photo', lang)}</>}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function Row({ icon: Icon, label, value }) {
  if (!value) return null
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <Icon size={16} strokeWidth={1.6} style={{ color: 'var(--v2-ink-2)', flexShrink: 0 }} />
      <span style={{ fontSize: 13, color: 'var(--v2-ink-2)', width: 92 }}>{label}</span>
      <span style={{ fontSize: 14, color: 'var(--v2-ink-0)', fontWeight: 600, flex: 1 }}>{value}</span>
    </div>
  )
}

/* ─── report-fault bottom-sheet ────────────────────────────────────── */

function ReportFaultModal({ lang, uid, depots, issueTypes, screensByDepot, onClose, onSaved }) {
  const [depotId, setDepotId] = useState('')
  const [screenId, setScreenId] = useState('')
  const [issueId, setIssueId] = useState('')
  const [priority, setPriority] = useState('normal')
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)

  const screens = screensByDepot[depotId] || []

  async function save() {
    if (savingRef.current || saving) return
    if (!depotId || !issueId) { toastError(null, t('pick_issue', lang)); return }
    savingRef.current = true; setSaving(true)
    try {
      const { error } = await supabase.from('ops_tickets').insert([{
        type: 'fault', status: 'open', source: 'manual',
        depot_id: depotId, screen_id: screenId || null, issue_type_id: issueId,
        priority, assigned_to: uid, created_by: uid,
      }])
      if (error) throw error
      toastSuccess(t('report_saved', lang))
      onSaved()
    } catch (e) { toastError(e, t('error_generic', lang)) } finally {
      setSaving(false); savingRef.current = false
    }
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', zIndex: 9000, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      <div onClick={e => e.stopPropagation()} style={{
        width: '100%', maxWidth: 640, background: 'var(--v2-bg-1)', borderTopLeftRadius: 'var(--v2-r-lg)',
        borderTopRightRadius: 'var(--v2-r-lg)', padding: 18, display: 'flex', flexDirection: 'column', gap: 14,
        maxHeight: '90vh', overflowY: 'auto',
      }}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <div style={{ fontSize: 18, fontWeight: 800, fontFamily: 'var(--v2-display)', flex: 1 }}>{t('report_title', lang)}</div>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--v2-ink-2)' }}>
            <X size={22} strokeWidth={1.6} />
          </button>
        </div>

        <div>
          <label style={labelStyle}>{t('pick_depot', lang)}</label>
          <select value={depotId} onChange={e => { setDepotId(e.target.value); setScreenId('') }} style={field}>
            <option value="">—</option>
            {depots.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </div>

        {depotId && (
          <div>
            <label style={labelStyle}>{t('pick_screen', lang)}</label>
            <select value={screenId} onChange={e => setScreenId(e.target.value)} style={field}>
              <option value="">—</option>
              {screens.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
        )}

        <div>
          <label style={labelStyle}>{t('pick_issue', lang)}</label>
          <select value={issueId} onChange={e => setIssueId(e.target.value)} style={field}>
            <option value="">—</option>
            {issueTypes.map(it => (
              <option key={it.id} value={it.id}>{lang === 'gu' ? (it.issue_gu || it.issue_en) : (it.issue_en || it.issue_gu)}</option>
            ))}
          </select>
        </div>

        <div>
          <label style={labelStyle}>{t('priority', lang)}</label>
          <div style={{ display: 'flex', gap: 8 }}>
            {[['low', 'prio_low'], ['normal', 'prio_normal'], ['high', 'prio_high']].map(([v, k]) => (
              <button key={v} onClick={() => setPriority(v)} style={{
                ...btnGhost, flex: 1,
                background: priority === v ? 'var(--v2-yellow)' : 'var(--v2-bg-2)',
                color: priority === v ? 'var(--v2-yellow-ink)' : 'var(--v2-ink-1)',
                borderColor: priority === v ? 'var(--v2-yellow)' : 'var(--v2-line)',
              }}>{t(k, lang)}</button>
            ))}
          </div>
        </div>

        <button onClick={save} disabled={saving} style={{ ...btnPrimary, opacity: saving ? 0.7 : 1 }}>
          {saving
            ? <><Loader2 size={17} strokeWidth={1.6} style={{ animation: 'spin 1s linear infinite' }} />{t('saving', lang)}</>
            : <><Plus size={17} strokeWidth={1.6} />{t('save', lang)}</>}
        </button>
      </div>
    </div>
  )
}
