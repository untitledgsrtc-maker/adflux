// src/pages/v2/OpsApprovalsV2.jsx — the operation_head approves the FIELD TEAM's
// leave + TA/DA (owner "manage 10 techs" brainstorm, 2026-08-28). Reads
// ops_pending_approvals(); approve/reject via the gated, ops-scoped RPCs
// (supabase_ops_p8_approvals.sql — an ops head can only ever touch a field
// tech's row). AdFlux brand tokens (§5), Gujarati-first (§231).
import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Loader2, RefreshCw, CheckCircle2, XCircle, CalendarOff, MapPin, FileText } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { t, getOpsLang, setOpsLang, numL, dateL } from '../../utils/opsStrings'
import { toastSuccess, toastError } from '../../components/v2/Toast'

const KIND = { ta_override: 'kind_ta', da_night: 'kind_da', hotel: 'kind_hotel', other: 'kind_other' }

export default function OpsApprovalsV2() {
  const nav = useNavigate()
  const [lang, setLang] = useState(getOpsLang())
  const flip = () => { const n = lang === 'gu' ? 'en' : 'gu'; setLang(n); setOpsLang(n) }
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [d, setD] = useState({ leaves: [], ta: [] })
  const [busy, setBusy] = useState(null)          // id currently being decided
  const [rejectFor, setRejectFor] = useState(null) // id showing the reject-note box
  const [note, setNote] = useState('')

  const load = useCallback(async () => {
    try {
      const { data, error } = await supabase.rpc('ops_pending_approvals')
      if (error) throw error
      setD({ leaves: data?.leaves || [], ta: data?.ta || [] })
      setErr('')
    } catch (e) { setErr(e?.message || 'load failed') }
  }, [])

  useEffect(() => { (async () => { setLoading(true); await load(); setLoading(false) })() }, [load])

  async function decide(kind, id, action) {
    if (busy) return
    setBusy(id)
    try {
      const fn = kind === 'leave'
        ? (action === 'approve' ? 'ops_approve_leave' : 'ops_reject_leave')
        : (action === 'approve' ? 'ops_approve_ta_request' : 'ops_reject_ta_request')
      const args = action === 'reject' ? { p_id: id, p_note: note || null } : { p_id: id }
      const { error } = await supabase.rpc(fn, args)
      if (error) throw error
      toastSuccess(t(action === 'approve' ? 'approved_ok' : 'rejected_ok', lang))
      setRejectFor(null); setNote('')
      await load()
    } catch (e) { toastError(e, t('save_failed', lang)) }
    finally { setBusy(null) }
  }

  const back = (
    <button onClick={() => nav('/ops-command')} aria-label={t('back', lang)} className="lead-btn" style={{ padding: '8px 10px' }}><ArrowLeft size={16} /></button>
  )

  if (loading) return <div className="lead-root" style={{ textAlign: 'center', paddingTop: 60 }}><Loader2 size={30} style={{ color: 'var(--text-muted)', animation: 'spin 1s linear infinite' }} /></div>

  const empty = d.leaves.length === 0 && d.ta.length === 0

  return (
    <div className="lead-root">
      <div className="lead-page-head" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          {back}
          <div>
            <div className="lead-page-eyebrow">{t('ops_field', lang)}</div>
            <h1 className="lead-page-title" style={{ margin: 0 }}>{t('approvals', lang)}</h1>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button onClick={load} aria-label={t('refresh', lang)} className="lead-btn" style={{ padding: '8px 10px' }}><RefreshCw size={16} /></button>
          <button onClick={flip} className="lead-btn" style={{ fontWeight: 700, padding: '8px 12px' }}>{lang === 'gu' ? 'EN' : 'ગુ'}</button>
        </div>
      </div>

      {err && <div style={{ background: 'var(--danger-soft)', border: '1px solid var(--danger)', color: 'var(--danger)', borderRadius: 12, padding: '10px 14px', fontSize: 13, marginBottom: 14 }}>{err}</div>}

      {empty ? (
        <div className="lead-card" style={{ textAlign: 'center', padding: '26px 16px', color: 'var(--success)', fontWeight: 600 }}>{t('no_pending_appr', lang)}</div>
      ) : (
        <>
          {d.leaves.length > 0 && (
            <>
              <SectionLabel icon={CalendarOff} text={`${t('leave_requests', lang)} · ${numL(d.leaves.length, lang)}`} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 18 }}>
                {d.leaves.map(l => (
                  <Item key={l.id} name={l.name} busy={busy === l.id}
                    sub={`${dateL(l.leave_date, lang)}${l.is_half_day ? ' · ' + t('half_day', lang) : ''} · ${t(l.is_paid_request ? 'paid_leave' : 'unpaid_leave', lang)}`}
                    body={[l.leave_type, l.reason].filter(Boolean).join(' · ')}
                    lang={lang} rejectOpen={rejectFor === l.id} note={note} setNote={setNote}
                    onApprove={() => decide('leave', l.id, 'approve')}
                    onRejectStart={() => { setRejectFor(l.id); setNote('') }}
                    onRejectConfirm={() => decide('leave', l.id, 'reject')}
                    onRejectCancel={() => { setRejectFor(null); setNote('') }}
                  />
                ))}
              </div>
            </>
          )}
          {d.ta.length > 0 && (
            <>
              <SectionLabel icon={MapPin} text={`${t('ta_claims', lang)} · ${numL(d.ta.length, lang)}`} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {d.ta.map(c => (
                  <Item key={c.id} name={c.name} busy={busy === c.id}
                    sub={`${dateL(c.claim_date, lang)} · ${t(KIND[c.kind] || 'kind_other', lang)}${c.city ? ' · ' + c.city : ''}`}
                    body={[
                      c.claim_km ? `${numL(c.claim_km, lang)} km` : '',
                      c.claim_amount != null ? `₹${numL(c.claim_amount, lang)}` : '',
                      c.reason,
                    ].filter(Boolean).join(' · ')}
                    receipt={c.receipt_url} lang={lang}
                    rejectOpen={rejectFor === c.id} note={note} setNote={setNote}
                    onApprove={() => decide('ta', c.id, 'approve')}
                    onRejectStart={() => { setRejectFor(c.id); setNote('') }}
                    onRejectConfirm={() => decide('ta', c.id, 'reject')}
                    onRejectCancel={() => { setRejectFor(null); setNote('') }}
                  />
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}

function SectionLabel({ icon: Icon, text }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11.5, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 8 }}>
      <Icon size={14} /> {text}
    </div>
  )
}

function Item({ name, sub, body, receipt, lang, busy, rejectOpen, note, setNote, onApprove, onRejectStart, onRejectConfirm, onRejectCancel }) {
  return (
    <div className="lead-card" style={{ padding: '13px 15px' }}>
      <div style={{ fontSize: 15, fontWeight: 700 }}>{name}</div>
      <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 2 }}>{sub}</div>
      {body && <div style={{ fontSize: 13, color: 'var(--text)', marginTop: 6 }}>{body}</div>}
      {receipt && <a href={receipt} target="_blank" rel="noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12.5, color: 'var(--blue, #3B82F6)', marginTop: 6, textDecoration: 'none' }}><FileText size={13} /> {t('receipt', lang)}</a>}

      {rejectOpen ? (
        <div style={{ marginTop: 10 }}>
          <textarea value={note} onChange={e => setNote(e.target.value)} placeholder={t('reject_note_ph', lang)} rows={2}
            style={{ width: '100%', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 10, color: 'var(--text)', padding: '9px 11px', fontSize: 13, resize: 'vertical', fontFamily: 'inherit' }} />
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button className="lead-btn" onClick={onRejectCancel} disabled={busy} style={{ flex: 1 }}>{t('cancel', lang)}</button>
            <button onClick={onRejectConfirm} disabled={busy} style={{ flex: 1, background: 'var(--danger)', color: '#fff', border: 'none', borderRadius: 10, padding: '10px 14px', fontSize: 14, fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
              {busy ? <Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} /> : <XCircle size={15} />} {t('reject', lang)}
            </button>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 8, marginTop: 11 }}>
          <button onClick={onRejectStart} disabled={busy} style={{ flex: 1, background: 'var(--danger-soft)', color: 'var(--danger)', border: 'none', borderRadius: 10, padding: '10px 14px', fontSize: 14, fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
            <XCircle size={15} /> {t('reject', lang)}
          </button>
          <button onClick={onApprove} disabled={busy} style={{ flex: 1.4, background: 'var(--success)', color: '#fff', border: 'none', borderRadius: 10, padding: '10px 14px', fontSize: 14, fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
            {busy ? <Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} /> : <CheckCircle2 size={15} />} {t('approve', lang)}
          </button>
        </div>
      )}
    </div>
  )
}
