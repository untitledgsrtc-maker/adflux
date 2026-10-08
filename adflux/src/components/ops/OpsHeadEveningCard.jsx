// src/components/ops/OpsHeadEveningCard.jsx
//
// HEAD / ADMIN EVENING REPORT card, mounted on the operations command center
// (OpsCommandV2). Reads ops_head_day_report through useOpsDayReport('head').
// admin / co_owner can open that page too and the RPC allows them, so it works
// for them as well.
//
// Shows: the network line (online/total, uptime %, down, cameras off), the day
// totals (fixed, depot calls, km), a per-tech table (check-in, uptime now and
// month, down, open, fixed, calls, km) that scrolls sideways INSIDE the card
// (the page never scrolls sideways at 390px), a "needs you today" list (not
// checked in, faults but no depot call, notifications / WhatsApp number missing,
// pending approvals, faults open over 48 hours), the worst 5 stations and a
// Share on WhatsApp button.
//
// VIEW + SHARE only. No pay / salary / rupees anywhere. Visible from 19:00 IST;
// before that a small text button expands it for a daytime preview. After 21:00
// the screens are off by timer, so the live network numbers are replaced by
// "Day closed" (the RPC also nulls the per-tech live counts then).

import { useNavigate } from 'react-router-dom'
import {
  Wifi, WifiOff, VideoOff, Activity, Clock, ChevronRight, AlertCircle, CheckCircle2,
  UserX, PhoneOff, BellOff, MessageCircleOff, ClipboardCheck,
} from 'lucide-react'
import useOpsDayReport from '../../hooks/useOpsDayReport'
import { t, getOpsLang } from '../../utils/opsStrings'
import { uptimeTone } from '../../utils/opsPay'
import {
  fmtInt, fmtPct, fmtKm, fmtTime, fmtReportDay, fmtAsOf, shareOpsEvening, inlineLabel,
} from '../../utils/opsEveningText'
import {
  useEveningGate, PreviewButton, HideButton, EveningFrame, SpinnerMark, SkeletonBody,
  ErrorBody, DeniedBody, StaleNote, MetricTile, StationList, ShareButton,
  TONE_FG, TONE_BG, sectionLabel, numStyle,
} from './OpsEveningShared'

const SW = 1.6
const arr = (v) => (Array.isArray(v) ? v : [])

// Explicit backgrounds: the global `thead th` / `tbody tr:hover td` rules tint cells,
// and the pinned name column must stay opaque so scrolled cells never show through it.
const th = { textAlign: 'left', fontSize: 11.5, color: 'var(--text-muted)', fontWeight: 700, padding: '9px 10px', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap', textTransform: 'uppercase', letterSpacing: '.04em', background: 'var(--surface-2)' }
const td = { fontSize: 13.5, color: 'var(--text)', padding: '10px 10px', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap', background: 'var(--surface)' }
const stickyCell = { position: 'sticky', left: 0, zIndex: 1, boxShadow: '1px 0 0 var(--border)' }

function TechTable({ techs, lang }) {
  if (!techs.length) {
    return <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 13.5, padding: '14px 6px' }}>{t('no_techs_yet', lang)}</div>
  }
  const head = [
    ['ev_col_in', 'left', 'checked_in_at'], ['up_word', 'right'], ['month_word', 'right'], ['down_word', 'right'],
    ['tab_open', 'right'], ['fixed_word', 'right'], ['calls_word', 'right', 'calls_legend'], ['km_word', 'right'],
  ]
  return (
    <>
      <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch', maxWidth: '100%', border: '1px solid var(--border)', borderRadius: 10 }}>
        <table style={{ width: '100%', minWidth: 640, borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={{ ...th, ...stickyCell, minWidth: 120 }}>{t('tech_word', lang)}</th>
              {head.map(([k, al, tip]) => <th key={k} style={{ ...th, textAlign: al }} title={tip ? t(tip, lang) : undefined}>{t(k, lang)}</th>)}
            </tr>
          </thead>
          <tbody>
            {techs.map((tk, i) => {
              const upTone = uptimeTone(tk.uptime_pct == null ? null : Number(tk.uptime_pct))
              const monTone = uptimeTone(tk.month_pct == null ? null : Number(tk.month_pct))
              const down = tk.offline == null ? null : Number(tk.offline)
              const open = Number(tk.open) || 0
              const over = Number(tk.over_48h) || 0
              const num = { ...td, ...numStyle, textAlign: 'right' }
              return (
                <tr key={tk.id || i}>
                  <td style={{ ...td, ...stickyCell, fontWeight: 600, maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis' }}>{tk.name || '—'}</td>
                  <td style={{ ...td, ...numStyle, color: tk.checkin_at ? 'var(--text)' : 'var(--warning)' }}>{tk.checkin_at ? fmtTime(tk.checkin_at, lang) : '—'}</td>
                  <td style={{ ...num, fontWeight: 700, color: TONE_FG[upTone] }}>{fmtPct(tk.uptime_pct, lang)}</td>
                  <td style={{ ...num, color: TONE_FG[monTone] }}>{fmtPct(tk.month_pct, lang)}</td>
                  <td style={{ ...num, color: down > 0 ? 'var(--danger)' : 'var(--text)' }}>{fmtInt(tk.offline, lang)}</td>
                  <td style={{ ...num, color: open > 0 ? 'var(--warning)' : 'var(--text)' }}>
                    {over > 0 ? <AlertCircle size={12} strokeWidth={SW} style={{ color: 'var(--danger)', marginRight: 4, verticalAlign: '-1px' }} aria-label={t('open_over_48h', lang)} /> : null}
                    {fmtInt(tk.open, lang)}
                  </td>
                  <td style={{ ...num, color: Number(tk.fixed) > 0 ? 'var(--success)' : 'var(--text)' }}>{fmtInt(tk.fixed, lang)}</td>
                  <td style={num}>{fmtInt(tk.depot_answered, lang)}/{fmtInt(tk.depot_calls, lang)}</td>
                  <td style={num}>{fmtKm(tk.km, lang)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 6 }}>{t('calls_legend', lang)}</div>
    </>
  )
}

function NeedRow({ icon: Icon, label, detail, onClick }) {
  const El = onClick ? 'button' : 'div'
  return (
    <El type={onClick ? 'button' : undefined} onClick={onClick}
      style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', minHeight: 48, padding: '9px 12px', borderRadius: 10, border: 'none', background: TONE_BG.warning, color: 'inherit', textAlign: 'left', cursor: onClick ? 'pointer' : 'default', boxSizing: 'border-box' }}>
      <Icon size={18} strokeWidth={SW} style={{ color: 'var(--warning)', flexShrink: 0 }} />
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 13.5, fontWeight: 700, color: 'var(--warning)' }}>{label}</span>
        {detail ? <span style={{ display: 'block', fontSize: 12.5, color: 'var(--text)', marginTop: 1, wordBreak: 'break-word' }}>{detail}</span> : null}
      </span>
      {onClick ? <ChevronRight size={16} strokeWidth={SW} style={{ color: 'var(--warning)', flexShrink: 0 }} /> : null}
    </El>
  )
}

function NeedsList({ needs, lang }) {
  const nav = useNavigate()
  const n = needs || {}
  const names = (a) => arr(a).filter(Boolean).join(', ')
  const rows = []
  if (arr(n.not_checked_in).length) rows.push({ k: 'nci', icon: UserX, label: t('not_checked_in', lang), detail: names(n.not_checked_in) })
  if (arr(n.faults_no_calls).length) rows.push({ k: 'fnc', icon: PhoneOff, label: t('faults_no_calls', lang), detail: names(n.faults_no_calls) })
  if (arr(n.push_missing).length) rows.push({ k: 'pm', icon: BellOff, label: t('push_missing', lang), detail: names(n.push_missing) })
  if (arr(n.no_whatsapp).length) rows.push({ k: 'nw', icon: MessageCircleOff, label: t('no_whatsapp', lang), detail: names(n.no_whatsapp) })
  const lv = Number(n.pending_leave) || 0
  const ta = Number(n.pending_ta) || 0
  if (lv > 0 || ta > 0) {
    rows.push({ k: 'ap', icon: ClipboardCheck, label: t('approvals', lang),
      detail: `${fmtInt(lv, lang)} ${inlineLabel('leave_requests', lang)} · ${fmtInt(ta, lang)} ${inlineLabel('ta_claims', lang)}`,
      go: () => nav('/ops-approvals') })
  }
  const o48 = Number(n.over_48h_total) || 0
  if (o48 > 0) rows.push({ k: 'o48', icon: Clock, label: `${t('open_over_48h', lang)}: ${fmtInt(o48, lang)}`, go: () => nav('/ops-tickets?tab=proc') })

  return (
    <div style={{ marginTop: 14 }}>
      <div style={sectionLabel}>{t('ev_needs_you', lang)}</div>
      {rows.length === 0 ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 12px', borderRadius: 10, background: TONE_BG.success, color: 'var(--success)', fontSize: 13.5, fontWeight: 600 }}>
          <CheckCircle2 size={17} strokeWidth={SW} />{t('all_handled', lang)}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {rows.map(r => <NeedRow key={r.k} icon={r.icon} label={r.label} detail={r.detail} onClick={r.go} />)}
        </div>
      )}
    </div>
  )
}

function NetworkStrip({ net, closed, lang }) {
  if (closed) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '12px 12px', borderRadius: 10, background: TONE_BG.muted, border: '1px solid var(--border)', color: 'var(--text-muted)', fontSize: 13.5 }}>
        <Clock size={18} strokeWidth={SW} style={{ flexShrink: 0 }} />
        <span><strong style={{ color: 'var(--text)' }}>{t('day_closed', lang)}</strong> · {t('all_quiet', lang)}</span>
      </div>
    )
  }
  const pct = net && net.pct != null ? Number(net.pct) : null
  const down = Number(net && net.down) || 0
  const cam = Number(net && net.camera_off) || 0
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
      <MetricTile icon={Wifi} small value={`${fmtInt(net && net.up, lang)}/${fmtInt(net && net.total, lang)}`} label={t('online', lang)} tone="neutral" />
      <MetricTile icon={Activity} small value={fmtPct(pct, lang)} label={t('network_uptime', lang)} tone={uptimeTone(pct)} />
      <MetricTile icon={WifiOff} small value={fmtInt(down, lang)} label={t('screens_down', lang)} tone={down > 0 ? 'danger' : 'success'} />
      <MetricTile icon={VideoOff} small value={fmtInt(cam, lang)} label={t('cameras_off', lang)} tone={cam > 0 ? 'warning' : 'success'} />
    </div>
  )
}

function TotalsRow({ totals, lang }) {
  const item = (label, value, i) => (
    <div key={i} style={{ flex: 1, textAlign: 'center', borderLeft: i ? '1px solid var(--border)' : 'none', padding: '0 6px' }}>
      <div style={{ ...numStyle, fontSize: 19, fontWeight: 700 }}>{value}</div>
      <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 2 }}>{label}</div>
    </div>
  )
  const tt = totals || {}
  return (
    <div style={{ display: 'flex', marginTop: 12, padding: '11px 4px', border: '1px solid var(--border)', borderRadius: 10, background: 'var(--surface-2)' }}>
      {[
        [t('fixed_today_w', lang), fmtInt(tt.fixed, lang)],
        [t('depot_calls', lang), fmtInt(tt.depot_calls, lang)],
        [t('km_travelled', lang), fmtKm(tt.km, lang)],
      ].map(([l, v], i) => item(l, v, i))}
    </div>
  )
}

// Presentational: everything the card draws, from plain props.
export function OpsHeadEveningView({ data, loading, error, denied, refetch, lang, shareLang, canHide, onHide }) {
  const d = data || null
  let sub = ''
  let right = null
  if (d) {
    const asOf = fmtAsOf(d.as_of, lang)
    sub = `${fmtReportDay(d.day, lang)}${asOf ? ` · ${asOf}` : ''}`
  } else if (loading) {
    right = <SpinnerMark />
  }

  let body
  if (d) {
    const closed = d.closed === true
    body = (
      <>
        <NetworkStrip net={d.network} closed={closed} lang={lang} />
        <TotalsRow totals={d.totals} lang={lang} />
        <div style={{ marginTop: 14 }}>
          <div style={sectionLabel}>{t('my_techs', lang)} · {fmtInt(arr(d.techs).length, lang)}</div>
          <TechTable techs={arr(d.techs)} lang={lang} />
        </div>
        <NeedsList needs={d.needs} lang={lang} />
        {!closed ? <StationList list={arr(d.worst_stations)} lang={lang} /> : null}
        {/* head text is English unless a caller passes shareLang */}
        <ShareButton lang={lang} onShare={() => shareOpsEvening(d, 'head', shareLang)} />
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

function EveningBody({ lang, shareLang, canHide, onHide }) {
  const r = useOpsDayReport('head')
  return <OpsHeadEveningView {...r} lang={lang} shareLang={shareLang} canHide={canHide} onHide={onHide} />
}

export default function OpsHeadEveningCard({ lang: langProp, shareLang }) {
  const lang = langProp || getOpsLang()
  const { evening, show, setOpen } = useEveningGate()
  if (!show) return <PreviewButton lang={lang} onClick={() => setOpen(true)} />
  // The hook (and its network calls) only exist while the card is visible.
  return <EveningBody lang={lang} shareLang={shareLang} canHide={!evening} onHide={() => setOpen(false)} />
}
