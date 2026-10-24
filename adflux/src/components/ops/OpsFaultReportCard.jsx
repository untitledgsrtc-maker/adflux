// src/components/ops/OpsFaultReportCard.jsx (Phase 502)
// Daily FAULT report + technician score. kind="exec": the technician's own day (ops_my_fault_report).
// kind="head": every technician (ops_head_fault_report) for the head / admin / co_owner.
// READ-ONLY, no pay. Both numbers are shown: downtime (from the first offline reading) and
// response (from In process). Only 07:00-21:00 IST minutes count (done in the database).
// Share on WhatsApp reuses openWhatsAppShare. Gujarati-first, tokens only, Lucide 1.6.
import { AlertTriangle, CheckCircle2, Clock, Timer, Camera } from 'lucide-react'
import useOpsDayReport from '../../hooks/useOpsDayReport'
import { getOpsLang, numL } from '../../utils/opsStrings'
import { openWhatsAppShare } from '../../utils/whatsappSummary'
import { EveningFrame, MetricTile, SkeletonBody, ErrorBody, DeniedBody, ShareButton, SpinnerMark, numStyle, sectionLabel, TONE_FG } from './OpsEveningShared'

const L = {
  gu: { title: 'આજની ખરાબી', off: 'બંધ થઈ', fixed: 'ઠીક થઈ', pend: 'બાકી', timer: 'ટાઈમર ખરાબ', dt: 'સરેરાશ બંધ સમય', rs: 'સરેરાશ પ્રતિભાવ', ph: 'ફોટો', score: 'સ્કોર', none: 'આજે કોઈ ખરાબી નથી', scr: 'સ્ક્રીન', min: 'મિનિટ', h: 'કલાક', open: 'ચાલુ', team: 'ટીમ', scoreNote: 'છેલ્લા ૭ દિવસ · પગારને અસર નથી' },
  en: { title: "Today's faults", off: 'Went off', fixed: 'Fixed', pend: 'Pending', timer: 'Timer faults', dt: 'Avg downtime', rs: 'Avg response', ph: 'Photos', score: 'Score', none: 'No faults today', scr: 'Screen', min: 'min', h: 'h', open: 'open', team: 'Team', scoreNote: 'Last 7 days · does not affect pay' },
}
const dur = (m, lang) => {
  if (m == null) return '—'
  const x = Number(m)
  if (!Number.isFinite(x)) return '—'
  const l = L[lang] || L.gu
  return x >= 60 ? `${numL(Math.floor(x / 60), lang)}${l.h} ${numL(x % 60, lang)}${l.min}` : `${numL(x, lang)}${l.min}`
}
const tone = (sc) => (sc >= 75 ? 'success' : sc >= 50 ? 'warning' : 'danger')

function shareText(d, kind, lang) {
  const l = L[lang] || L.gu
  const day = d.day
  const lines = [`${l.title} - ${day}`]
  const one = (b, name) => {
    const sc = b.score && b.score.score
    lines.push(`${name ? name + ': ' : ''}${l.off} ${b.went_off} - ${l.fixed} ${b.fixed} - ${l.pend} ${b.pending}${b.timer ? ' - ' + l.timer + ' ' + b.timer : ''} - ${l.dt} ${dur(b.avg_downtime_min, lang)} - ${l.rs} ${dur(b.avg_response_min, lang)} - ${l.ph} ${b.photos_delivered}/${b.photos_asked}${sc != null ? ' - ' + l.score + ' ' + sc : ''}`)
  }
  if (kind === 'head') (d.techs || []).forEach((b) => one(b, b.tech && b.tech.name))
  else one(d, '')
  return lines.join('\n')
}

function ScoreChip({ score, lang }) {
  const l = L[lang] || L.gu
  const sc = score && score.score
  if (sc == null) return null
  return (
    <div title={l.scoreNote} style={{ textAlign: 'right', flexShrink: 0 }}>
      <div style={{ ...numStyle, fontSize: 24, fontWeight: 700, lineHeight: 1, color: TONE_FG[tone(sc)] }}>{numL(sc, lang)}</div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{l.score}</div>
    </div>
  )
}

function ExecBody({ d, lang }) {
  const l = L[lang] || L.gu
  const items = Array.isArray(d.items) ? d.items : []
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, marginBottom: 10 }}>
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{l.scoreNote}</div>
        <ScoreChip score={d.score} lang={lang} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <MetricTile icon={AlertTriangle} value={numL(d.went_off, lang)} label={l.off} tone={d.went_off > 0 ? 'warning' : 'neutral'} />
        <MetricTile icon={CheckCircle2} value={numL(d.fixed, lang)} label={l.fixed} tone={d.fixed > 0 ? 'success' : 'neutral'} />
        <MetricTile icon={Clock} value={numL(d.pending, lang)} label={l.pend} tone={d.pending > 0 ? 'danger' : 'success'} />
        <MetricTile icon={Timer} value={numL(d.timer, lang)} label={l.timer} tone={d.timer > 0 ? 'warning' : 'neutral'} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 10 }}>
        <MetricTile icon={Clock} value={dur(d.avg_downtime_min, lang)} label={l.dt} tone="neutral" small />
        <MetricTile icon={Clock} value={dur(d.avg_response_min, lang)} label={l.rs} tone="neutral" small />
      </div>
      <div style={{ marginTop: 10 }}>
        <MetricTile icon={Camera} value={`${numL(d.photos_delivered, lang)}/${numL(d.photos_asked, lang)}`} label={l.ph} tone="neutral" small />
      </div>
      {items.length ? (
        <div style={{ marginTop: 12 }}>
          <div style={sectionLabel}>{l.scr}</div>
          {items.slice(0, 12).map((it, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '8px 0', borderTop: i ? '1px solid var(--border)' : 'none', fontSize: 13 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600 }}>{it.screen}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{it.station} · {it.started}{it.fixed ? ` → ${it.fixed}` : ` · ${l.open}`}</div>
              </div>
              <div style={{ ...numStyle, flexShrink: 0, color: it.status === 'open' ? 'var(--danger)' : 'var(--success)' }}>{it.status === 'open' ? l.open : dur(it.downtime_min, lang)}</div>
            </div>
          ))}
        </div>
      ) : <div style={{ marginTop: 12, fontSize: 13, color: 'var(--text-muted)' }}>{l.none}</div>}
    </>
  )
}

function HeadBody({ d, lang }) {
  const l = L[lang] || L.gu
  const tt = d.totals || {}
  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0,1fr))', gap: 8 }}>
        <MetricTile icon={AlertTriangle} value={numL(tt.went_off, lang)} label={l.off} tone={tt.went_off > 0 ? 'warning' : 'neutral'} small />
        <MetricTile icon={CheckCircle2} value={numL(tt.fixed, lang)} label={l.fixed} tone={tt.fixed > 0 ? 'success' : 'neutral'} small />
        <MetricTile icon={Clock} value={numL(tt.pending, lang)} label={l.pend} tone={tt.pending > 0 ? 'danger' : 'success'} small />
        <MetricTile icon={Timer} value={numL(tt.timer, lang)} label={l.timer} tone="neutral" small />
      </div>
      <div style={{ marginTop: 12 }}>
        {(d.techs || []).map((b, i) => (
          <div key={(b.tech && b.tech.id) || i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: '10px 0', borderTop: i ? '1px solid var(--border)' : 'none' }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 14 }}>{b.tech && b.tech.name}</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                {l.off} {numL(b.went_off, lang)} · {l.fixed} {numL(b.fixed, lang)} · {l.pend} {numL(b.pending, lang)} · {l.dt} {dur(b.avg_downtime_min, lang)} · {l.rs} {dur(b.avg_response_min, lang)}
              </div>
            </div>
            <ScoreChip score={b.score} lang={lang} />
          </div>
        ))}
      </div>
      <div style={{ marginTop: 6, fontSize: 11.5, color: 'var(--text-muted)' }}>{l.scoreNote}</div>
    </>
  )
}

export default function OpsFaultReportCard({ kind = 'exec', lang: langProp }) {
  const lang = langProp || getOpsLang()
  const l = L[lang] || L.gu
  const r = useOpsDayReport(kind === 'head' ? 'head_faults' : 'exec_faults')
  const d = r.data
  let body
  if (d) body = (
    <>
      {kind === 'head' ? <HeadBody d={d} lang={lang} /> : <ExecBody d={d} lang={lang} />}
      <ShareButton lang={lang} onShare={() => openWhatsAppShare(shareText(d, kind, lang))} />
    </>
  )
  else if (r.loading) body = <SkeletonBody />
  else if (r.denied) body = <DeniedBody lang={lang} />
  else if (r.error) body = <ErrorBody lang={lang} message={r.error} onRetry={r.refetch} />
  else body = <SkeletonBody />
  return <EveningFrame lang={lang} sub={d ? d.day : l.title} right={r.loading && !d ? <SpinnerMark /> : null}>{body}</EveningFrame>
}
