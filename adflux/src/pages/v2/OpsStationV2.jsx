// src/pages/v2/OpsStationV2.jsx — Operations "Station board" (§230, wired from the
// owner's led-dashboard mockup). Pick a station → live KPIs, a screen-wall grid
// coloured by REAL status (ops_screens online/offline + open ops_tickets), editable
// depot contacts (ops_depot_contacts), and the issue→solution reference
// (ops_issue_types). Admin / co_owner / operation_head. Additive; app tokens only.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Monitor, MonitorCheck, MonitorX, AlertTriangle, Phone, Plus, X, MapPin,
  Wrench, Loader2, RefreshCw,
} from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/authStore'
import { toastError, toastSuccess } from '../../components/v2/Toast'

const card = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 14 }
const label = { fontSize: 11, textTransform: 'uppercase', letterSpacing: '.04em', color: 'var(--text-muted)', fontWeight: 700 }
const field = { background: 'var(--surface-2, var(--bg))', color: 'var(--text)', border: '1px solid var(--border-strong, var(--border))', borderRadius: 6, padding: '7px 9px', fontSize: 13, width: '100%', boxSizing: 'border-box' }

// each screen's board state from real data: green working / amber in-progress / red down
function screenState(scr, tkByScreen) {
  const tk = tkByScreen[scr.id]
  if (tk && tk.status === 'in_progress') return 'progress'
  if (scr.status === 'offline' || tk) return 'down'
  return 'working'
}
const STATE_COLOR = { working: 'var(--success)', progress: 'var(--warning)', down: 'var(--danger)' }
const STATE_LABEL = { working: 'Working', progress: 'In progress', down: 'Down / Open' }

function KpiCard({ title, value, Icon, color }) {
  return (
    <div style={card}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <span style={label}>{title}</span>
        <span style={{ color: color || 'var(--text-muted)', display: 'inline-flex' }}><Icon size={18} strokeWidth={1.7} /></span>
      </div>
      <div style={{ fontSize: 26, fontWeight: 700, color: color || 'var(--text)' }}>{value}</div>
    </div>
  )
}

export default function OpsStationV2() {
  const profile = useAuthStore(s => s.profile)
  const [params, setParams] = useSearchParams()
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')

  const [depots, setDepots] = useState([])
  const [depotId, setDepotId] = useState(params.get('depot') || '')
  const [screens, setScreens] = useState([])
  const [tickets, setTickets] = useState([])
  const [contacts, setContacts] = useState([])
  const [issueTypes, setIssueTypes] = useState([])
  const [editTypes, setEditTypes] = useState(false)
  const busyRef = useRef(false)

  // 1 · depots (the station picker) + the global issue-type reference
  const loadShell = useCallback(async () => {
    try {
      const [dRes, itRes] = await Promise.all([
        supabase.from('ops_depots').select('id, name').eq('is_active', true).order('name'),
        supabase.from('ops_issue_types').select('id, issue_en, solution_en, display_order').eq('is_active', true).order('display_order'),
      ])
      const ds = dRes.data || []
      setDepots(ds)
      setIssueTypes(itRes.data || [])
      setDepotId(prev => prev || params.get('depot') || (ds[0] && ds[0].id) || '')
    } catch (e) { setErr(e?.message || 'load failed') }
  }, [params])

  // 2 · the selected station's screens + open tickets + contacts
  const loadStation = useCallback(async (id) => {
    if (!id) { setScreens([]); setTickets([]); setContacts([]); return }
    try {
      const [sRes, tRes, cRes] = await Promise.all([
        supabase.from('ops_screens').select('id, name, status').eq('depot_id', id).eq('is_active', true).order('name'),
        supabase.from('ops_tickets').select('id, screen_id, status, type, issue_type_id').eq('depot_id', id).in('status', ['open', 'in_progress']),
        supabase.from('ops_depot_contacts').select('id, role_en, name, phone, display_order').eq('depot_id', id).order('display_order'),
      ])
      setScreens(sRes.data || [])
      setTickets(tRes.data || [])
      setContacts(cRes.data || [])
    } catch (e) { setErr(e?.message || 'load failed') }
  }, [])

  useEffect(() => { (async () => { setLoading(true); await loadShell(); setLoading(false) })() }, [loadShell])
  useEffect(() => { loadStation(depotId) }, [depotId, loadStation])

  const depot = depots.find(d => d.id === depotId)

  // ticket per screen (in_progress wins over open for the tile colour)
  const tkByScreen = useMemo(() => {
    const m = {}
    tickets.forEach(t => { if (t.screen_id) { const cur = m[t.screen_id]; if (!cur || t.status === 'in_progress') m[t.screen_id] = t } })
    return m
  }, [tickets])

  const kpi = useMemo(() => {
    let working = 0, progress = 0
    screens.forEach(s => { const st = screenState(s, tkByScreen); if (st === 'working') working++; else if (st === 'progress') progress++ })
    const total = screens.length
    return { total, working, notWorking: total - working, openIssues: tickets.length, progress }
  }, [screens, tkByScreen, tickets])

  // ── contact CRUD (ops_depot_contacts) ──
  async function addContact() {
    if (!depotId) return
    const { data, error } = await supabase.from('ops_depot_contacts')
      .insert([{ depot_id: depotId, role_en: '', name: '', phone: '', display_order: contacts.length + 1 }])
      .select('id, role_en, name, phone, display_order')
    if (error) return toastError(error, 'Could not add')
    setContacts(c => [...c, ...(data || [])])
  }
  async function saveContact(id, patch) {
    setContacts(c => c.map(x => x.id === id ? { ...x, ...patch } : x))
    const { error } = await supabase.from('ops_depot_contacts').update(patch).eq('id', id)
    if (error) toastError(error, 'Save failed')
  }
  async function removeContact(id) {
    setContacts(c => c.filter(x => x.id !== id))
    const { error } = await supabase.from('ops_depot_contacts').delete().eq('id', id)
    if (error) { toastError(error, 'Remove failed'); loadStation(depotId) }
  }

  // ── issue-type CRUD (ops_issue_types — global reference) ──
  async function addIssueType() {
    const { data, error } = await supabase.from('ops_issue_types')
      .insert([{ issue_en: 'New issue', solution_en: 'New solution', display_order: issueTypes.length + 1, is_active: true }])
      .select('id, issue_en, solution_en, display_order')
    if (error) return toastError(error, 'Could not add (admin/head only)')
    setIssueTypes(t => [...t, ...(data || [])])
  }
  async function saveIssueType(id, patch) {
    setIssueTypes(t => t.map(x => x.id === id ? { ...x, ...patch } : x))
    const { error } = await supabase.from('ops_issue_types').update(patch).eq('id', id)
    if (error) toastError(error, 'Save failed (admin/head only)')
  }
  async function removeIssueType(id) {
    setIssueTypes(t => t.filter(x => x.id !== id))
    const { error } = await supabase.from('ops_issue_types').update({ is_active: false }).eq('id', id)
    if (error) { toastError(error, 'Remove failed'); loadShell() }
  }

  const refresh = async () => { if (busyRef.current) return; busyRef.current = true; await Promise.all([loadShell(), loadStation(depotId)]); busyRef.current = false; toastSuccess('Refreshed') }

  if (loading) return <div style={{ minHeight: 320, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}><Loader2 size={22} style={{ animation: 'spin 1s linear infinite' }} /></div>
  if (err) return <div style={{ padding: 20 }}><div style={{ background: 'var(--danger-soft, rgba(239,68,68,.12))', color: 'var(--danger)', border: '1px solid var(--danger)', borderRadius: 10, padding: '12px 16px' }}>{err} <button className="btn btn-sec btn-sm" onClick={refresh} style={{ marginLeft: 10 }}>Retry</button></div></div>

  return (
    <div style={{ padding: '18px 20px', maxWidth: 1120, margin: '0 auto' }}>
      {/* header · station picker */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
        <div>
          <div style={{ ...label, marginBottom: 4 }}>Operations · Station board</div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{depot?.name || 'Pick a station'}</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
            <MapPin size={15} style={{ position: 'absolute', left: 9, color: 'var(--text-muted)', pointerEvents: 'none' }} />
            <select value={depotId} onChange={e => { setDepotId(e.target.value); setParams(p => { p.set('depot', e.target.value); return p }, { replace: true }) }}
              style={{ ...field, width: 'auto', padding: '9px 30px 9px 30px', fontWeight: 600, borderColor: 'var(--accent)' }}>
              {depots.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </span>
          <button className="btn btn-sec btn-sm" onClick={refresh} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><RefreshCw size={14} /> Refresh</button>
        </div>
      </div>

      {/* KPI cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
        <KpiCard title="Total screens" value={kpi.total} Icon={Monitor} />
        <KpiCard title="Working" value={kpi.working} Icon={MonitorCheck} color="var(--success)" />
        <KpiCard title="Not working" value={kpi.notWorking} Icon={MonitorX} color="var(--danger)" />
        <KpiCard title="Open issues" value={kpi.openIssues} Icon={AlertTriangle} color="var(--warning)" />
      </div>

      {/* screen wall */}
      <div style={{ ...card, marginTop: 18 }}>
        <div style={{ ...label, marginBottom: 12 }}>{depot?.name} — screen wall status</div>
        {screens.length === 0
          ? <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>No screens synced for this station yet.</div>
          : <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {screens.map((s, i) => {
                const st = screenState(s, tkByScreen)
                return <div key={s.id} title={`${s.name} — ${STATE_LABEL[st]}`}
                  style={{ width: 28, height: 28, borderRadius: 4, background: STATE_COLOR[st], color: 'var(--accent-fg, #0f172a)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700 }}>{i + 1}</div>
              })}
            </div>}
        <div style={{ display: 'flex', gap: 16, marginTop: 12, fontSize: 11, color: 'var(--text-muted)' }}>
          {[['working', 'Working'], ['down', 'Down / Open'], ['progress', 'In progress']].map(([k, t]) =>
            <span key={k} style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ width: 10, height: 10, borderRadius: 2, background: STATE_COLOR[k] }} />{t}</span>)}
        </div>
      </div>

      {/* two-col: contacts + issue types */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 18, marginTop: 18 }}>
        {/* contacts */}
        <div style={card}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div style={label}>{depot?.name} — who to call</div>
            <button className="btn btn-sec btn-sm" onClick={addContact} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><Plus size={14} /> Add</button>
          </div>
          {contacts.length === 0 && <div style={{ color: 'var(--text-muted)', fontSize: 13, padding: '6px 0' }}>No contacts yet — add the electrician, depot manager, etc.</div>}
          {contacts.map(c => (
            <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <input defaultValue={c.role_en || ''} placeholder="Role (e.g. Electrician)" onBlur={e => { if (e.target.value !== (c.role_en || '')) saveContact(c.id, { role_en: e.target.value }) }}
                style={{ ...field, width: '42%', color: 'var(--text-muted)' }} />
              <span style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6, background: 'var(--surface-2, var(--bg))', border: '1px solid var(--border-strong, var(--border))', borderRadius: 6, padding: '0 8px' }}>
                <Phone size={14} style={{ color: 'var(--text-muted)' }} />
                <input defaultValue={c.phone || ''} placeholder="Phone" inputMode="tel" onBlur={e => { if (e.target.value !== (c.phone || '')) saveContact(c.id, { phone: e.target.value }) }}
                  style={{ background: 'transparent', border: 'none', color: 'var(--text)', fontSize: 13, padding: '8px 0', flex: 1, outline: 'none' }} />
              </span>
              <button onClick={() => removeContact(c.id)} title="Remove" style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}><X size={18} /></button>
            </div>
          ))}
        </div>

        {/* issue types & solutions */}
        <div style={card}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div style={{ ...label, display: 'flex', alignItems: 'center', gap: 6 }}><Wrench size={14} /> Issue types &amp; solutions</div>
            <button className="btn btn-ghost btn-sm" onClick={() => setEditTypes(v => !v)}>{editTypes ? 'Done' : 'Edit'}</button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 8 }}>
            {issueTypes.map(t => editTypes ? (
              <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--surface-2, var(--bg))', border: '1px solid var(--border-strong, var(--border))', borderRadius: 6, padding: '8px 10px' }}>
                <input defaultValue={t.issue_en || ''} onBlur={e => { if (e.target.value !== (t.issue_en || '')) saveIssueType(t.id, { issue_en: e.target.value }) }} style={{ background: 'transparent', border: 'none', color: 'var(--text)', fontSize: 12, fontWeight: 600, width: '44%', outline: 'none' }} />
                <span style={{ color: 'var(--text-muted)' }}>→</span>
                <input defaultValue={t.solution_en || ''} onBlur={e => { if (e.target.value !== (t.solution_en || '')) saveIssueType(t.id, { solution_en: e.target.value }) }} style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', fontSize: 12, flex: 1, outline: 'none' }} />
                <button onClick={() => removeIssueType(t.id)} title="Remove" style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}><X size={16} /></button>
              </div>
            ) : (
              <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--surface-2, var(--bg))', border: '1px solid var(--border-strong, var(--border))', borderRadius: 6, padding: '8px 10px' }}>
                <span style={{ fontSize: 12, fontWeight: 600, width: '45%' }}>{t.issue_en}</span>
                <span style={{ color: 'var(--text-muted)' }}>→</span>
                <span style={{ fontSize: 12, color: 'var(--text-muted)', flex: 1 }}>{t.solution_en}</span>
              </div>
            ))}
          </div>
          {editTypes && <button onClick={addIssueType} style={{ marginTop: 8, width: '100%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontSize: 12, color: 'var(--text-muted)', border: '1px dashed var(--border-strong, var(--border))', borderRadius: 6, padding: 8, background: 'transparent', cursor: 'pointer' }}><Plus size={14} /> Add issue type</button>}
        </div>
      </div>
    </div>
  )
}
