// src/components/ops/OpsScreenHistory.jsx (Phase 504)
// "Faulty N times" per screen for ONE station, from ops_screen_faults (RLS: head/admin all, technician
// their own depots). Read-only. Tap a screen to see its past faults (start, fixed, downtime, reason).
// Only 07:00-21:00 IST minutes count in downtime (done in the database).
import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronUp, History } from 'lucide-react'
import { supabase } from '../../lib/supabase'

const dmy = (iso) => { if (!iso) return '—'; const d = new Date(iso); return d.toLocaleDateString('en-GB', { timeZone: 'Asia/Kolkata', day: '2-digit', month: '2-digit', year: 'numeric' }) }
const hm = (iso) => iso ? new Date(iso).toLocaleTimeString('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' }) : ''
const dur = (m) => m == null ? '—' : (m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`)
const KIND = { offline: 'Went offline', timer: 'Timer - stayed on', manual: 'Logged by technician' }

export default function OpsScreenHistory({ depotId, screens }) {
  const [rows, setRows] = useState([])
  const [state, setState] = useState('loading')
  const [open, setOpen] = useState('')

  useEffect(() => {
    let alive = true
    if (!depotId) { setRows([]); setState('ok'); return undefined }
    setState('loading')
    supabase.from('ops_screen_faults')
      .select('id, screen_id, kind, status, started_at, fixed_at, downtime_minutes, response_minutes, reason, note, closed_by_system')
      .eq('depot_id', depotId).neq('status', 'cancelled').order('started_at', { ascending: false }).limit(400)
      .then(({ data, error }) => { if (!alive) return; if (error) { setState('error') } else { setRows(data || []); setState('ok') } })
    return () => { alive = false }
  }, [depotId])

  const list = useMemo(() => {
    const by = {}
    rows.forEach((f) => { (by[f.screen_id] = by[f.screen_id] || []).push(f) })
    const names = Object.fromEntries((screens || []).map((s) => [s.id, s.name]))
    return Object.entries(by).map(([sid, fs]) => ({ sid, name: names[sid] || 'Screen', fs }))
      .sort((a, b) => b.fs.length - a.fs.length)
  }, [rows, screens])

  const card = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 16, marginTop: 18 }
  return (
    <div style={card}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 10 }}>
        <History size={14} strokeWidth={1.6} /> Screen fault history
      </div>
      {state === 'loading' && <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Loading...</div>}
      {state === 'error' && <div style={{ fontSize: 13, color: 'var(--danger)' }}>Could not load the history.</div>}
      {state === 'ok' && list.length === 0 && <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>No faults recorded for this station yet. History starts from 24 Oct 2026.</div>}
      {state === 'ok' && list.map((x) => {
        const isOpen = open === x.sid
        const openNow = x.fs.some((f) => f.status === 'open')
        return (
          <div key={x.sid} style={{ borderTop: '1px solid var(--border)' }}>
            <button type="button" onClick={() => setOpen(isOpen ? '' : x.sid)}
              style={{ width: '100%', minHeight: 48, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, background: 'none', border: 'none', color: 'var(--text)', cursor: 'pointer', padding: '8px 0', textAlign: 'left' }}>
              <span style={{ fontWeight: 600, fontSize: 14 }}>{x.name}</span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: openNow ? 'var(--danger)' : 'var(--text-muted)' }}>
                <span style={{ fontFamily: 'var(--font-display)', fontVariantNumeric: 'tabular-nums', fontWeight: 700, fontSize: 15, color: x.fs.length >= 3 ? 'var(--warning)' : 'var(--text)' }}>{x.fs.length}</span> times faulty{openNow ? ' · open now' : ''}
                {isOpen ? <ChevronUp size={16} strokeWidth={1.6} /> : <ChevronDown size={16} strokeWidth={1.6} />}
              </span>
            </button>
            {isOpen && x.fs.map((f) => (
              <div key={f.id} style={{ padding: '6px 0 8px 10px', fontSize: 12.5, color: 'var(--text-muted)', borderLeft: '2px solid var(--border)', marginLeft: 4, marginBottom: 6 }}>
                <div style={{ color: 'var(--text)', fontWeight: 600 }}>{KIND[f.kind] || f.kind} · {dmy(f.started_at)} {hm(f.started_at)}</div>
                <div>{f.status === 'open' ? 'Still open' : `Fixed ${dmy(f.fixed_at)} ${hm(f.fixed_at)}${f.closed_by_system ? ' (by the system)' : ''}`}</div>
                {f.kind !== 'timer' && <div>Downtime {dur(f.downtime_minutes)} · Response {dur(f.response_minutes)}</div>}
                {(f.reason || f.note) && <div>{[f.reason, f.note].filter(Boolean).join(' · ')}</div>}
              </div>
            ))}
          </div>
        )
      })}
    </div>
  )
}
