// src/components/ops/OpsEveningCard.jsx
//
// Technician EVENING REPORT card ("આજનો રિપોર્ટ"), mounted on the exec home
// (OpsHomeV2). Reads ops_my_day_report through useOpsDayReport('exec').
//
// VIEW + SHARE only: it shows the technician's own day (check-in, fixed today,
// faults still open, km travelled, calls to depots, screen uptime, the worst
// stations) and a Share on WhatsApp button. It never submits, never writes
// work_sessions / evening_report_submitted_at, never checks the tech out, and
// shows NO rupees / pay / salary (km only).
//
// Visible from 19:00 IST. Before that only a small text button is shown; tapping
// it expands the card so it can be previewed in the daytime. After 21:00 the
// RPC marks the day closed: faults read "Day closed" (no live counts, no
// station list) because the timers turn the screens off for the night.
//
// States: loading skeleton, error + Retry (last data kept on a failed refresh),
// denied/empty (the RPC answered without ok:true). Gujarati-first (opsStrings).

import { Activity, AlertTriangle, CheckCircle2, Phone, Route } from 'lucide-react'
import useOpsDayReport from '../../hooks/useOpsDayReport'
import { t, getOpsLang } from '../../utils/opsStrings'
import { uptimeTone } from '../../utils/opsPay'
import {
  fmtInt, fmtPct, fmtKm, fmtReportDay, fmtAsOf, stationsLabel, shareOpsEvening,
} from '../../utils/opsEveningText'
import {
  useEveningGate, PreviewButton, HideButton, EveningFrame, SpinnerMark, SkeletonBody,
  ErrorBody, DeniedBody, StaleNote, CheckinChip, MetricTile, StationList, ShareButton,
  TONE_FG, TONE_BG, numStyle,
} from './OpsEveningShared'

const SW = 1.6

function UptimeRow({ up, lang }) {
  const pct = up && up.pct != null ? Number(up.pct) : null
  const tone = uptimeTone(pct)
  const has = pct != null && Number.isFinite(pct)
  return (
    <div style={{ marginTop: 10, padding: '12px 12px', border: '1px solid var(--border)', borderRadius: 10, background: TONE_BG[tone] || TONE_BG.muted }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, minWidth: 0 }}>
          <Activity size={18} strokeWidth={SW} style={{ color: TONE_FG[tone], flexShrink: 0 }} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13.5, fontWeight: 700 }}>{t('uptime_now', lang)}</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              {up && Number(up.total) > 0
                ? `${fmtInt(up.up, lang)}/${fmtInt(up.total, lang)} ${t('screens_word', lang)}`
                : t('no_stats', lang)}
            </div>
          </div>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div style={{ ...numStyle, fontSize: 24, fontWeight: 700, lineHeight: 1, color: TONE_FG[tone] }}>{has ? fmtPct(pct, lang) : '—'}</div>
          {up && up.month_pct != null ? (
            <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 3 }}>{t('month_word', lang)} {fmtPct(up.month_pct, lang)}</div>
          ) : null}
        </div>
      </div>
      {has ? (
        <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}
          style={{ height: 6, borderRadius: 999, background: 'var(--surface-3)', marginTop: 10, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${Math.max(0, Math.min(100, pct))}%`, background: TONE_FG[tone], borderRadius: 999 }} />
        </div>
      ) : null}
    </div>
  )
}

// Presentational: everything the card draws, from plain props (so it can be
// rendered with mock data without the network).
export function OpsEveningView({ data, loading, error, denied, refetch, lang, canHide, onHide }) {
  const d = data || null
  let sub = ''
  let right = null
  if (d) {
    const asOf = fmtAsOf(d.as_of, lang)
    sub = `${fmtReportDay(d.day, lang)}${asOf ? ` · ${asOf}` : ''}`
    right = <CheckinChip at={d.checkin && d.checkin.at} lang={lang} />
  } else if (loading) {
    right = <SpinnerMark />
  }

  let body
  if (d) {
    const f = d.faults || {}
    const tk = d.tickets || {}
    const c = d.calls || {}
    const closed = d.closed === true
    const liveOffline = !closed && f.offline != null && Number.isFinite(Number(f.offline))
    const offline = liveOffline ? Number(f.offline) : 0
    const noCalls = liveOffline && offline > 0 && Number(c.depot_total) === 0
    const over48 = Number(tk.over_48h) || 0
    const stations = Array.isArray(f.stations) ? f.stations : []
    body = (
      <>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <MetricTile icon={CheckCircle2} value={fmtInt(tk.fixed, lang)} label={t('fixed_today_w', lang)} tone={Number(tk.fixed) > 0 ? 'success' : 'neutral'} />
          <MetricTile icon={AlertTriangle}
            value={liveOffline ? fmtInt(offline, lang) : t('day_closed', lang)}
            small={!liveOffline}
            label={t('still_open', lang)}
            sub={liveOffline ? stationsLabel(f, lang) : null}
            tone={!liveOffline ? 'muted' : offline > 0 ? 'danger' : 'success'} />
          <MetricTile icon={Route} value={fmtKm(d.km, lang)} label={t('km_travelled', lang)} tone="neutral" />
          <MetricTile icon={Phone} value={fmtInt(c.depot_total, lang)} label={t('depot_calls', lang)}
            sub={`${fmtInt(c.depot_answered, lang)} ${t('answered_word', lang)}`} tone={noCalls ? 'warning' : 'neutral'} />
        </div>
        <UptimeRow up={d.uptime} lang={lang} />
        {over48 > 0 ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, padding: '10px 12px', borderRadius: 10, background: 'var(--warning-soft)', color: 'var(--warning)', fontSize: 13, fontWeight: 600 }}>
            <AlertTriangle size={16} strokeWidth={SW} style={{ flexShrink: 0 }} />
            <span>{t('open_over_48h', lang)}: {fmtInt(over48, lang)}</span>
          </div>
        ) : null}
        {!closed ? <StationList list={stations} lang={lang} /> : null}
        <ShareButton lang={lang} onShare={() => shareOpsEvening(d, 'exec', lang)} />
        {error ? <StaleNote lang={lang} onRetry={refetch} /> : null}
        {canHide ? <HideButton lang={lang} onClick={onHide} /> : null}
      </>
    )
  } else if (loading) {
    // first load, or a manual Retry: show the skeleton, not the old error block
    body = <SkeletonBody />
  } else if (denied) {
    body = <><DeniedBody lang={lang} />{canHide ? <HideButton lang={lang} onClick={onHide} /> : null}</>
  } else if (error) {
    body = <><ErrorBody lang={lang} message={error} onRetry={refetch} />{canHide ? <HideButton lang={lang} onClick={onHide} /> : null}</>
  } else {
    body = <SkeletonBody />
  }

  return <EveningFrame lang={lang} sub={sub} right={right}>{body}</EveningFrame>
}

function EveningBody({ lang, canHide, onHide }) {
  const r = useOpsDayReport('exec')
  return <OpsEveningView {...r} lang={lang} canHide={canHide} onHide={onHide} />
}

export default function OpsEveningCard({ lang: langProp }) {
  const lang = langProp || getOpsLang()
  const { evening, show, setOpen } = useEveningGate()
  if (!show) return <PreviewButton lang={lang} onClick={() => setOpen(true)} />
  // The hook (and its network calls) only exist while the card is visible.
  return <EveningBody lang={lang} canHide={!evening} onHide={() => setOpen(false)} />
}
