// src/components/ops/OpsEveningShared.jsx
//
// Building blocks shared by the two operations EVENING REPORT cards
// (OpsEveningCard for the technician, OpsHeadEveningCard for the head). One
// definition of the gate, the frame, the states and the small pieces so the two
// cards cannot drift apart. Tokens only (no hex), Lucide stroke 1.6, lead-*
// classes (same idiom as OpsHomeV2 / OpsAdminV2), numbers in the display font
// with tabular-nums, 44px+ touch targets.

import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader2, ClipboardList, ChevronRight, CheckCircle2, Clock, AlertCircle, Lock, MessageCircle } from 'lucide-react'
import { t } from '../../utils/opsStrings'
import { istHour, severityOf } from '../../utils/opsHours'
import { fmtTime, fmtInt, fmtAge } from '../../utils/opsEveningText'

const SW = 1.6   // Lucide stroke width (CLAUDE.md section 7)

export const TONE_FG = {
  success: 'var(--success)', warning: 'var(--warning)', danger: 'var(--danger)',
  muted: 'var(--text-muted)', neutral: 'var(--text)',
}
export const TONE_BG = {
  success: 'var(--success-soft)', warning: 'var(--warning-soft)', danger: 'var(--danger-soft)',
  muted: 'var(--surface-2)', neutral: 'var(--surface-2)',
}
const SEV_FG = { 2: 'var(--danger)', 1: 'var(--warning)', 0: 'var(--text-muted)' }

export const sectionLabel = {
  fontSize: 11.5, fontWeight: 700, color: 'var(--text-muted)',
  textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 6,
}
export const numStyle = { fontFamily: 'var(--font-display)', fontVariantNumeric: 'tabular-nums' }

// ── 19:00 IST gate + the daytime "preview" expander ──────────────────────────
// Before 19:00 IST the card is just a small text button; tapping it expands the
// full card so it can be previewed in the daytime. From 19:00 it is always shown.
export function useEveningGate() {
  const [hour, setHour] = useState(() => istHour())
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const tick = () => setHour(istHour())
    const id = setInterval(tick, 60 * 1000)
    document.addEventListener('visibilitychange', tick)
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', tick) }
  }, [])
  const evening = hour >= 19
  return { evening, show: evening || open, setOpen }
}

export function PreviewButton({ lang, onClick }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <button type="button" onClick={onClick} className="lead-card-link"
        style={{ minHeight: 44, background: 'none', border: 'none', padding: '0 4px' }}>
        <ClipboardList size={16} strokeWidth={SW} />{t('todays_report_view', lang)}<ChevronRight size={14} strokeWidth={SW} />
      </button>
    </div>
  )
}

export function HideButton({ lang, onClick }) {
  return (
    <div style={{ textAlign: 'center', marginTop: 4 }}>
      <button type="button" onClick={onClick} className="lead-card-link"
        style={{ minHeight: 44, background: 'none', border: 'none', padding: '0 10px', justifyContent: 'center' }}>
        {t('hide_report', lang)}
      </button>
    </div>
  )
}

// ── card frame ───────────────────────────────────────────────────────────────
export function EveningFrame({ lang, sub, right, children }) {
  return (
    <div className="lead-card" style={{ marginBottom: 14 }}>
      <div className="lead-card-head" style={{ gap: 10 }}>
        <div style={{ minWidth: 0 }}>
          <div className="lead-card-title">{t('evening_report', lang)}</div>
          {sub ? <div className="lead-card-sub">{sub}</div> : null}
        </div>
        {right || null}
      </div>
      <div style={{ padding: '14px 15px 15px' }}>{children}</div>
    </div>
  )
}

export function SpinnerMark() {
  return <Loader2 size={18} strokeWidth={SW} style={{ color: 'var(--text-muted)', animation: 'spin 1s linear infinite', flexShrink: 0 }} />
}

// ── states ───────────────────────────────────────────────────────────────────
export function SkeletonBody() {
  const block = { background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 10 }
  return (
    <div aria-busy="true">
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        {[0, 1, 2, 3].map(i => <div key={i} style={{ ...block, height: 88 }} />)}
      </div>
      <div style={{ ...block, height: 66, marginTop: 10 }} />
      <div style={{ ...block, height: 46, marginTop: 12, borderRadius: 999 }} />
    </div>
  )
}

export function ErrorBody({ lang, message, onRetry }) {
  return (
    <div style={{ background: 'var(--danger-soft)', border: '1px solid var(--danger)', borderRadius: 10, padding: '14px 14px', textAlign: 'center' }}>
      <AlertCircle size={22} strokeWidth={SW} style={{ color: 'var(--danger)' }} />
      <div style={{ fontWeight: 700, fontSize: 14, marginTop: 6 }}>{t('report_load_failed', lang)}</div>
      {message ? <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 3, wordBreak: 'break-word' }}>{message}</div> : null}
      <button type="button" className="lead-btn" onClick={onRetry} style={{ marginTop: 10, minHeight: 44, padding: '0 18px', fontSize: 13, fontWeight: 700, justifyContent: 'center' }}>
        {t('retry', lang)}
      </button>
    </div>
  )
}

export function DeniedBody({ lang }) {
  return (
    <div style={{ textAlign: 'center', padding: '10px 6px', color: 'var(--text-muted)' }}>
      <Lock size={22} strokeWidth={SW} />
      <div style={{ fontSize: 13.5, marginTop: 6 }}>{t('report_unavailable', lang)}</div>
    </div>
  )
}

// Shown ABOVE the data when a background refresh failed (the old report stays).
export function StaleNote({ lang, onRetry }) {
  return (
    <button type="button" onClick={onRetry} className="lead-btn"
      style={{ width: '100%', justifyContent: 'center', minHeight: 44, marginTop: 10, fontSize: 12.5, color: 'var(--warning)', background: 'var(--warning-soft)', borderColor: 'transparent' }}>
      <AlertCircle size={14} strokeWidth={SW} />{t('report_stale', lang)} · {t('retry', lang)}
    </button>
  )
}

// ── small pieces ─────────────────────────────────────────────────────────────
export function CheckinChip({ at, lang }) {
  const base = { display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 999, fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap', flexShrink: 0 }
  if (at) {
    return (
      <span style={{ ...base, background: 'var(--success-soft)', color: 'var(--success)' }}>
        <CheckCircle2 size={13} strokeWidth={SW} />{t('checked_in_at', lang)} {fmtTime(at, lang)}
      </span>
    )
  }
  return (
    <span style={{ ...base, background: 'var(--warning-soft)', color: 'var(--warning)' }}>
      <Clock size={13} strokeWidth={SW} />{t('not_checked_in', lang)}
    </span>
  )
}

export function MetricTile({ icon: Icon, value, label, sub, tone = 'neutral', small = false }) {
  return (
    <div style={{ background: TONE_BG[tone] || TONE_BG.neutral, border: '1px solid var(--border)', borderRadius: 10, padding: '12px 12px 11px', minHeight: 88, boxSizing: 'border-box' }}>
      <div style={{ width: 28, height: 28, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--surface-3)', color: TONE_FG[tone] || TONE_FG.neutral }}>
        <Icon size={16} strokeWidth={SW} />
      </div>
      <div style={{ ...numStyle, fontSize: small ? 18 : 26, fontWeight: 700, lineHeight: 1.1, marginTop: 8, color: TONE_FG[tone] || TONE_FG.neutral }}>{value}</div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4, fontWeight: 600 }}>{label}</div>
      {sub ? <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 2 }}>{sub}</div> : null}
    </div>
  )
}

// One worst-station row: name, N down, how long. Tap opens the Station Board.
export function StationRow({ s, lang }) {
  const nav = useNavigate()
  const offline = Number(s && s.offline) || 0
  const sev = severityOf(s && s.oldest_hours, offline)
  const go = s && s.depot_id ? () => nav(`/ops-station?depot=${s.depot_id}`) : undefined
  return (
    <button type="button" onClick={go} className="lead-btn"
      style={{ width: '100%', justifyContent: 'flex-start', gap: 8, minHeight: 48, padding: '8px 10px', borderRadius: 10, borderLeft: `4px solid ${SEV_FG[sev] || SEV_FG[0]}`, textAlign: 'left', cursor: go ? 'pointer' : 'default' }}>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontWeight: 700, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{(s && s.name) || '—'}</span>
        <span style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', fontWeight: 500 }}>
          {fmtInt(offline, lang)} {t('down_word', lang)} · {fmtAge(s && s.oldest_hours, lang)}
        </span>
      </span>
      {go ? <ChevronRight size={16} strokeWidth={SW} style={{ color: 'var(--text-muted)', flexShrink: 0 }} /> : null}
    </button>
  )
}

export function StationList({ list, lang }) {
  const rows = Array.isArray(list) ? list : []
  if (!rows.length) return null
  return (
    <div style={{ marginTop: 12 }}>
      <div style={sectionLabel}>{t('worst_now', lang)}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {rows.map((s, i) => <StationRow key={(s && s.depot_id) || i} s={s} lang={lang} />)}
      </div>
    </div>
  )
}

// Full-width Share on WhatsApp. Locked for a moment after a tap so a double tap
// cannot open WhatsApp twice. View/share only - this never writes anything.
export function ShareButton({ lang, onShare }) {
  const [busy, setBusy] = useState(false)
  const lock = useRef(false)         // blocks a same-tick double fire (state is async)
  const timer = useRef(null)
  useEffect(() => () => clearTimeout(timer.current), [])
  const click = () => {
    if (lock.current) return
    lock.current = true
    setBusy(true)
    onShare()
    timer.current = setTimeout(() => { lock.current = false; setBusy(false) }, 1200)
  }
  return (
    <button type="button" className="lead-btn lead-btn-primary" onClick={click} disabled={busy}
      style={{ width: '100%', justifyContent: 'center', minHeight: 46, marginTop: 14, fontSize: 14, fontWeight: 700 }}>
      <MessageCircle size={17} strokeWidth={SW} />{t('share_whatsapp', lang)}
    </button>
  )
}
