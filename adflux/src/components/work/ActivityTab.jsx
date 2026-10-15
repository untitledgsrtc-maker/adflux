// Phase 382 - Team Work -> Activity tab (Windows agent, step 2). Heads/admin only (RLS enforces it).
// One person + one day: tracked / active / idle, day timeline by program, program table with client,
// idle decisions, screenshot strip (blur toggle, click to enlarge). Settings card for admin / co-owner.
// Reads only; writes go through work_set_tracking_person / work_set_tracking_settings.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Monitor, Camera, Moon, Loader2, X } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { toastError, toastSuccess } from '../v2/Toast'
import { istTodayISO } from '../../utils/istDate'
import { fmtDur, fmtTimeIST, dayStartISO, addDaysISO, clientColor } from '../../utils/workUtils'
import UserAvatar from '../common/UserAvatar'

const PALETTE = ['#60A5FA', '#A78BFA', '#34D399', '#F59E0B', '#F472B6', '#22D3EE', '#FB923C', '#84CC16']
const progColor = (name) => { let h = 0; for (const c of String(name || '')) h = (h * 31 + c.charCodeAt(0)) >>> 0; return PALETTE[h % PALETTE.length] }
const DECISION = { still_working: 'Still working', break: 'Break', stop: 'Stopped', auto_stopped: 'Auto-stopped' }

export default function ActivityTab({ users, memberIds, nameOf, projName, canSettings }) {
  const today = istTodayISO()
  const [person, setPerson] = useState('')
  const [day, setDay] = useState(today)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [data, setData] = useState(null)       // { slices, idle, shots, entries, urls }
  const [blur, setBlur] = useState(true)
  const [big, setBig] = useState(null)
  const [settings, setSettings] = useState(null)
  const [tracked, setTracked] = useState([])   // work_tracking_people
  const [devices, setDevices] = useState([])
  const [busy, setBusy] = useState(false)

  const people = useMemo(() => memberIds.map((id) => ({ id, name: nameOf(id) })).sort((a, b) => a.name.localeCompare(b.name)), [memberIds, nameOf])
  useEffect(() => { if (!person && people.length) setPerson((tracked.find((t) => t.enabled)?.user_id) || people[0].id) }, [people, tracked, person])

  const loadSettings = useCallback(async () => {
    const [s, p, d] = await Promise.all([
      supabase.from('work_tracking_settings').select('*').eq('id', 1).maybeSingle(),
      supabase.from('work_tracking_people').select('user_id,enabled'),
      supabase.from('work_agent_devices').select('user_id,device_name,agent_version,consent_at,last_seen_at'),
    ])
    if (!s.error) setSettings(s.data)
    if (!p.error) setTracked(p.data || [])
    if (!d.error) setDevices(d.data || [])
  }, [])
  useEffect(() => { loadSettings() }, [loadSettings])

  const loadDay = useCallback(async () => {
    if (!person) return
    setLoading(true); setErr('')
    const t0 = dayStartISO(day), t1 = dayStartISO(addDaysISO(day, 1))
    const [sl, id, sh, en] = await Promise.all([
      supabase.from('work_activity_slices').select('entry_id,slice_start,program,window_title,active_seconds,idle_seconds')
        .eq('user_id', person).gte('slice_start', t0).lt('slice_start', t1).order('slice_start').limit(3000),
      supabase.from('work_idle_events').select('id,idle_began,decision,idle_seconds').eq('user_id', person)
        .gte('idle_began', t0).lt('idle_began', t1).order('idle_began').limit(200),
      supabase.from('work_screenshots').select('id,taken_at,storage_path,entry_id').eq('user_id', person)
        .gte('taken_at', t0).lt('taken_at', t1).order('taken_at').limit(400),
      supabase.from('work_time_entries').select('id,project_id,task_label,started_at,ended_at,break_seconds').eq('user_id', person)
        .gte('started_at', t0).lt('started_at', t1).limit(300),
    ])
    const e = [sl, id, sh, en].find((r) => r.error)
    if (e) { setErr(e.error.message || 'Could not load.'); setLoading(false); return }
    let urls = {}
    const paths = (sh.data || []).map((s) => s.storage_path)
    if (paths.length) {
      const r = await supabase.storage.from('work-screenshots').createSignedUrls(paths, 600)
      ;(r.data || []).forEach((x) => { if (x.signedUrl) urls[x.path] = x.signedUrl })
    }
    setData({ slices: sl.data || [], idle: id.data || [], shots: sh.data || [], entries: en.data || [], urls })
    setLoading(false)
  }, [person, day])
  useEffect(() => { loadDay() }, [loadDay])

  const view = useMemo(() => {
    if (!data) return null
    const entProj = new Map(data.entries.map((x) => [x.id, x.project_id]))
    const active = data.slices.reduce((n, s) => n + s.active_seconds, 0)
    const idle = data.slices.reduce((n, s) => n + s.idle_seconds, 0)
    const byProg = {}
    data.slices.forEach((s) => {
      const k = `${s.program}||${s.window_title || ''}||${entProj.get(s.entry_id) || ''}`
      const r = byProg[k] || (byProg[k] = { program: s.program, title: s.window_title, project: entProj.get(s.entry_id), secs: 0 })
      r.secs += s.active_seconds
    })
    const rows = Object.values(byProg).sort((a, b) => b.secs - a.secs).slice(0, 12)
    const progTot = {}
    data.slices.forEach((s) => { progTot[s.program] = (progTot[s.program] || 0) + s.active_seconds })
    const progs = Object.entries(progTot).sort((a, b) => b[1] - a[1])
    const breakSecs = data.entries.reduce((n, x) => n + (x.break_seconds || 0), 0)
    const first = data.slices[0] ? new Date(data.slices[0].slice_start).getTime() : null
    const last = data.slices.length ? new Date(data.slices[data.slices.length - 1].slice_start).getTime() + 60000 : null
    return { active, idle, rows, progs, breakSecs, first, last }
  }, [data])

  const setTrack = async (userId, on) => {
    setBusy(true)
    const { error } = await supabase.rpc('work_set_tracking_person', { p_user: userId, p_enabled: on })
    setBusy(false)
    if (error) return toastError(error, 'Could not change tracking.')
    toastSuccess(on ? 'Tracking switched on.' : 'Tracking switched off.')
    loadSettings()
  }
  const saveSettings = async (patch) => {
    const next = { ...settings, ...patch }
    setBusy(true)
    const { error } = await supabase.rpc('work_set_tracking_settings',
      { p_interval: next.screenshot_interval_min, p_idle: next.idle_minutes, p_retention: next.retention_days })
    setBusy(false)
    if (error) return toastError(error, 'Could not save settings.')
    setSettings(next); toastSuccess('Saved.')
  }

  const trackedSet = new Set(tracked.filter((t) => t.enabled).map((t) => t.user_id))
  const consentOf = (id) => devices.filter((d) => d.user_id === id && d.consent_at).sort((a, b) => (b.last_seen_at || '').localeCompare(a.last_seen_at || ''))[0]
  const chip = (cur, val, label, onPick) => (
    <button key={val} className={`wk-chip${cur === val ? ' on' : ''}`} style={cur === val ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : undefined}
      disabled={busy} onClick={() => onPick(val)}>{label}</button>
  )

  return (
    <div className="wk-grid">
      <div className="wk-c12">
        <div className="wk-row" style={{ flexWrap: 'wrap', gap: 10, justifyContent: 'flex-start' }}>
          <select className="wk-input" style={{ width: 260 }} value={person} onChange={(e) => setPerson(e.target.value)} aria-label="Person">
            {people.map((p) => <option key={p.id} value={p.id}>{p.name}{trackedSet.has(p.id) ? '' : ' (not tracked)'}</option>)}
          </select>
          <div className="wk-tabs" style={{ margin: 0 }}>
            <button className={`wk-tab${day === today ? ' on' : ''}`} onClick={() => setDay(today)}>Today</button>
            <button className={`wk-tab${day === addDaysISO(today, -1) ? ' on' : ''}`} onClick={() => setDay(addDaysISO(today, -1))}>Yesterday</button>
          </div>
          <input type="date" className="wk-input" style={{ width: 170 }} value={day} max={today} onChange={(e) => setDay(e.target.value || today)} aria-label="Pick a date" />
        </div>
      </div>

      {loading && <div className="wk-c12"><div className="wk-skel" style={{ height: 160, borderRadius: 16 }} /></div>}
      {err && <div className="wk-c12"><div className="wk-err" role="alert"><span>{err}</span><button className="wk-btn g sm" onClick={loadDay}>Retry</button></div></div>}

      {!loading && !err && view && (
        <>
          <div className="wk-c12">
            <div className="wk-hero">
              <span className="wk-eyb">{nameOf(person)} · activity</span>
              <div className="wk-num" style={{ fontSize: 40, fontWeight: 600, marginTop: 4 }}>{fmtDur(view.active)}</div>
              <div className="wk-hs">
                {fmtDur(view.idle)} idle · {data.shots.length} screenshot{data.shots.length === 1 ? '' : 's'}
                {view.breakSecs > 0 && ` · ${fmtDur(view.breakSecs)} taken off as breaks`}
              </div>
            </div>
          </div>

          {data.slices.length === 0 && data.shots.length === 0 ? (
            <div className="wk-c12">
              <div className="wk-card"><div className="wk-empty"><b>Nothing recorded for this day</b>
                {trackedSet.has(person)
                  ? (consentOf(person) ? 'No timer ran with the Windows app open, or the app was offline.' : 'The Windows app is not installed or consent is not accepted on this PC yet.')
                  : 'Tracking is off for this person. Switch it on below.'}
              </div></div>
            </div>
          ) : (
            <>
              <div className="wk-c8">
                <div className="wk-card flush" style={{ marginBottom: 24 }}>
                  <div className="wk-ch"><h3><span className="wk-tile"><Monitor size={16} aria-hidden="true" /></span>Programs</h3></div>
                  <div style={{ padding: 18 }}>
                    <div style={{ display: 'flex', height: 14, borderRadius: 7, overflow: 'hidden', background: 'var(--w-hov)' }}>
                      {view.progs.map(([n, s]) => <i key={n} title={`${n} - ${fmtDur(s)}`} style={{ width: `${s / Math.max(1, view.active) * 100}%`, background: progColor(n) }} />)}
                    </div>
                    <div className="wk-chips" style={{ marginTop: 10 }}>
                      {view.progs.slice(0, 8).map(([n, s]) => (
                        <span key={n} className="wk-chip"><span className="wk-dot" style={{ background: progColor(n), width: 8, height: 8 }} />{n} · {fmtDur(s)}</span>
                      ))}
                    </div>
                  </div>
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                      <thead><tr>{['Program', 'Window', 'Client', 'Time'].map((h) => <th key={h} style={{ textAlign: 'left', padding: '8px 18px', color: 'var(--text-muted)', fontWeight: 500, fontSize: 12 }}>{h}</th>)}</tr></thead>
                      <tbody>
                        {view.rows.map((r, i) => (
                          <tr key={i} style={{ borderTop: '1px solid var(--border)' }}>
                            <td style={{ padding: '10px 18px' }}>{r.program}</td>
                            <td style={{ padding: '10px 18px', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.title || '-'}</td>
                            <td style={{ padding: '10px 18px' }}>{r.project ? <span className="wk-grp"><span className="wk-dot" style={{ background: clientColor(projName(r.project)) }} />{projName(r.project)}</span> : '-'}</td>
                            <td className="wk-num" style={{ padding: '10px 18px' }}>{fmtDur(r.secs)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="wk-card flush">
                  <div className="wk-ch">
                    <h3><span className="wk-tile"><Camera size={16} aria-hidden="true" /></span>Screenshots</h3>
                    <button className="wk-btn o sm" onClick={() => setBlur((b) => !b)}>{blur ? 'Blur on' : 'Blur off'}</button>
                  </div>
                  {data.shots.length === 0 ? (
                    <div className="wk-empty"><b>No screenshots</b>Screenshots are taken while a timer runs, at the interval set below.</div>
                  ) : (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 10, padding: 16 }}>
                      {data.shots.map((s) => (
                        <button key={s.id} onClick={() => setBig(s)} style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 0, overflow: 'hidden', background: 'var(--surface-2)', cursor: 'pointer', textAlign: 'left' }}>
                          {data.urls[s.storage_path]
                            ? <img src={data.urls[s.storage_path]} alt="" loading="lazy" style={{ width: '100%', aspectRatio: '16/10', objectFit: 'cover', display: 'block', filter: blur ? 'blur(6px)' : 'none' }} />
                            : <div style={{ aspectRatio: '16/10', display: 'grid', placeItems: 'center' }} className="wk-sm">Expired</div>}
                          <div className="wk-sm wk-num" style={{ padding: '6px 8px' }}>{fmtTimeIST(s.taken_at)}</div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="wk-c4">
                <div className="wk-card flush">
                  <div className="wk-ch"><h3><span className="wk-tile"><Moon size={16} aria-hidden="true" /></span>Idle questions</h3></div>
                  {data.idle.length === 0 ? <div className="wk-empty"><b>None</b>No idle popups this day.</div> : (
                    <div className="wk-list">
                      {data.idle.map((x) => (
                        <div key={x.id} className="wk-row" style={{ padding: '12px 20px' }}>
                          <div><div className="wk-num">{fmtTimeIST(x.idle_began)}</div><div className="wk-sm">{fmtDur(x.idle_seconds)} idle</div></div>
                          <span className={`wk-pill ${x.decision === 'still_working' ? 'ok' : x.decision === 'break' ? 'warn' : 'bad'}`}>{DECISION[x.decision]}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </>
      )}

      {canSettings && settings && (
        <div className="wk-c12">
          <div className="wk-card flush">
            <div className="wk-ch"><h3>Settings</h3><span className="wk-sm">Records only while a timer runs</span></div>
            <div style={{ padding: 18, display: 'grid', gap: 18 }}>
              <div><div className="wk-sm" style={{ marginBottom: 6 }}>Screenshot every</div>
                <div className="wk-chips">{[[5, '5 min'], [10, '10 min'], [15, '15 min'], [0, 'Off']].map(([v, l]) => chip(settings.screenshot_interval_min, v, l, (x) => saveSettings({ screenshot_interval_min: x })))}</div></div>
              <div><div className="wk-sm" style={{ marginBottom: 6 }}>Ask "still working?" after</div>
                <div className="wk-chips">{[[5, '5 min'], [10, '10 min'], [0, 'Off']].map(([v, l]) => chip(settings.idle_minutes, v, l, (x) => saveSettings({ idle_minutes: x })))}</div></div>
              <div><div className="wk-sm" style={{ marginBottom: 6 }}>Keep screenshots for</div>
                <div className="wk-chips">{[[7, '7 days'], [30, '30 days'], [60, '60 days']].map(([v, l]) => chip(settings.retention_days, v, l, (x) => saveSettings({ retention_days: x })))}</div></div>
              <div>
                <div className="wk-sm" style={{ marginBottom: 6 }}>Who is tracked</div>
                <div className="wk-list">
                  {people.map((p) => {
                    const on = trackedSet.has(p.id), c = consentOf(p.id)
                    return (
                      <div key={p.id} className="wk-row" style={{ padding: '10px 4px' }}>
                        <span className="wk-grp"><UserAvatar className="wk-av" name={p.name} userId={p.id} size={28} />{p.name}</span>
                        <span className="wk-grp">
                          <span className={`wk-pill ${c ? 'ok' : on ? 'warn' : ''}`}>{c ? `Accepted ${fmtTimeIST(c.consent_at)}` : on ? 'Waiting for consent' : 'Off'}</span>
                          <button role="switch" aria-checked={on} aria-label={`Track ${p.name}`} disabled={busy}
                            className={`wk-sw${on ? ' on' : ''}`} onClick={() => setTrack(p.id, !on)}><i /></button>
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {big && (
        <div className="wk-modal-back" onClick={() => setBig(null)} style={{ justifyContent: 'center', alignItems: 'center', padding: 16 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ maxWidth: 1100, width: '100%' }}>
            <div className="wk-row" style={{ marginBottom: 8 }}>
              <b>{nameOf(person)} · {fmtTimeIST(big.taken_at)}</b>
              <button className="wk-btn o sm" onClick={() => setBig(null)} aria-label="Close"><X size={16} aria-hidden="true" /> Close</button>
            </div>
            {data.urls[big.storage_path] && <img src={data.urls[big.storage_path]} alt="" style={{ width: '100%', borderRadius: 12 }} />}
          </div>
        </div>
      )}
      {busy && <Loader2 size={16} className="wk-spin" aria-hidden="true" style={{ position: 'fixed', right: 16, bottom: 16 }} />}
    </div>
  )
}
