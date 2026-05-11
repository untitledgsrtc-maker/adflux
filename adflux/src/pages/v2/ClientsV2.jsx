// src/pages/v2/ClientsV2.jsx
//
// Clients CRM view. Rendered inside V2AppShell.
//
// Data model reminder (see supabase_clients_module.sql):
//   • Each sales rep has their own client rows — unique on (phone,
//     created_by). Admin sees everyone's; sales sees only their own.
//     RLS enforces this at the DB level, so we don't need to re-filter
//     in JS — we just select * and trust the policy.
//   • Editing a client here does NOT rewrite past quotes. Each quote
//     has its own denormalized client_* snapshot captured at creation
//     time. This file updates the CRM snapshot only; the clients
//     module is a layer on top of the quote ledger, not a replacement.
//   • quote_count / last_quote_at / total_won_amount are maintained by
//     useQuotes.js on every quote save — no need to recompute here.
//
// Admins also see an Owner column so they can tell which rep owns a
// given client. Clicking "New quote" for a client prefills Step1Client
// via the React-Router navigation state payload.

import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Users, Search, Edit3, Plus, Phone, Mail, Building2, MapPin,
  FileText, X, Save, GitMerge, Trash2,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/authStore'

function formatCurrency(n) {
  return `₹${new Intl.NumberFormat('en-IN').format(Math.round(Number(n) || 0))}`
}

function formatDateShort(iso) {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleDateString('en-IN', {
      day: 'numeric', month: 'short', year: 'numeric',
    })
  } catch { return '—' }
}

export default function ClientsV2() {
  const navigate = useNavigate()
  const profile = useAuthStore(s => s.profile)
  const isAdmin = profile?.role === 'admin'

  const [clients, setClients] = useState([])
  const [userMap, setUserMap] = useState({}) // id → name (admin only)
  const [salesUsers, setSalesUsers] = useState([]) // [{ id, name }] (admin filter)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [repFilter, setRepFilter] = useState('all') // admin-only: 'all' or user_id
  const [editing, setEditing] = useState(null) // client row currently in edit modal
  const [saveErr, setSaveErr] = useState('')
  const [saving, setSaving] = useState(false)
  // Phase 33L — duplicate-merge tool. Admin-only. Toggled open via
  // the "Find duplicates" button below the header. Groups clients
  // by normalized phone (or company when phone empty) and surfaces
  // groups with 2+ rows. Admin picks a primary; the rest get deleted.
  const [dupOpen, setDupOpen] = useState(false)

  useEffect(() => {
    load()
    const ch = supabase
      .channel('v2-clients')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'clients' }, () => load())
      .subscribe()
    return () => { supabase.removeChannel(ch) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function load() {
    setLoading(true)
    // RLS handles the admin-vs-sales visibility. We just order by
    // most-recently-active so the clients a rep has worked lately sit
    // at the top.
    const { data: clientRows, error } = await supabase
      .from('clients')
      .select('*')
      .order('last_quote_at', { ascending: false, nullsFirst: false })

    if (!error) setClients(clientRows || [])

    // Admin needs to see the owner name. One extra query is fine vs
    // embedding a users(name) join, because the join would require an
    // FK index and we want this list to stay fast. We also keep the
    // sales-only subset around for the rep filter dropdown.
    if (isAdmin) {
      const { data: users } = await supabase.from('users').select('id, name, role')
      const map = {}
      ;(users || []).forEach(u => { map[u.id] = u.name })
      setUserMap(map)
      // Phase 11h — include agency users in the rep filter; both
      // sales and agency own quote books that admin should be able
      // to scope by. Without this, admin filtering by rep could only
      // pick sales users, hiding any agency-created quotes.
      setSalesUsers(
        (users || [])
          .filter(u => u.role === 'sales' || u.role === 'agency')
          .map(u => ({ id: u.id, name: u.name, role: u.role }))
      )
    }
    setLoading(false)
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    let list = clients
    // Admin-only rep filter — clients are owned per (phone, created_by)
    // so filtering by created_by gives admin a single rep's book.
    if (isAdmin && repFilter !== 'all') {
      list = list.filter(c => c.created_by === repFilter)
    }
    if (!q) return list
    return list.filter(c =>
      (c.name    || '').toLowerCase().includes(q) ||
      (c.company || '').toLowerCase().includes(q) ||
      (c.phone   || '').toLowerCase().includes(q) ||
      (c.email   || '').toLowerCase().includes(q)
    )
  }, [clients, search, isAdmin, repFilter])

  function startNewQuoteForClient(c) {
    // Prefill Step1Client via router state. CreateQuoteV2 must read
    // location.state.prefill and pass it into WizardShell's initial
    // quoteData.
    navigate('/quotes/new', {
      state: {
        prefill: {
          client_name:    c.name    || '',
          client_company: c.company || '',
          client_phone:   c.phone   || '',
          client_email:   c.email   || '',
          client_gst:     c.gstin   || '',
          client_address: c.address || '',
          client_notes:   c.notes   || '',
        },
      },
    })
  }

  async function handleSave() {
    if (!editing) return
    setSaveErr('')
    setSaving(true)
    const patch = {
      name:    (editing.name    || '').trim() || 'Unknown',
      company: (editing.company || '').trim() || null,
      phone:   (editing.phone   || '').trim(),
      email:   (editing.email   || '').trim() || null,
      gstin:   (editing.gstin   || '').trim() || null,
      address: (editing.address || '').trim() || null,
      notes:   (editing.notes   || '').trim() || null,
    }
    if (!patch.phone) {
      setSaveErr('Phone is required.')
      setSaving(false)
      return
    }
    const { error } = await supabase
      .from('clients')
      .update(patch)
      .eq('id', editing.id)
    setSaving(false)
    if (error) {
      // Most likely cause: unique (phone, created_by) conflict if they
      // tried to switch this client's phone to one another client
      // (same owner) already uses.
      setSaveErr(error.code === '23505'
        ? 'Another client already uses that phone number.'
        : (error.message || 'Save failed.'))
      return
    }
    setEditing(null)
    load()
  }

  return (
    <div className="v2d-clients" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* ─── Header ────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ fontFamily: 'var(--v2-display)', fontSize: 22, fontWeight: 700, color: 'var(--v2-ink-0)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Users size={20} /> Clients
          </div>
          <div style={{ fontSize: 13, color: 'var(--v2-ink-2)' }}>
            {isAdmin
              ? 'All client records across the team.'
              : "Clients you've quoted. Edits here don't rewrite past quotes."}
          </div>
        </div>

        <div className="v2d-search" style={{ flex: '1 1 260px', maxWidth: 420 }}>
          <Search size={14} />
          <input
            placeholder="Search name, phone, company, email…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        {/* Admin-only sales-rep filter — scope the list to one rep's
            book. Hidden for sales role (RLS already limits them to
            their own clients, so the dropdown would be a single option). */}
        {isAdmin && salesUsers.length > 0 && (
          <select
            value={repFilter}
            onChange={e => setRepFilter(e.target.value)}
            style={{
              background: 'var(--v2-bg-1, rgba(255,255,255,.04))',
              border: '1px solid var(--v2-line, rgba(255,255,255,.08))',
              color: 'var(--v2-ink-0)',
              fontFamily: 'var(--v2-sans)',
              fontSize: 13,
              fontWeight: 500,
              padding: '8px 14px',
              borderRadius: 999,
              cursor: 'pointer',
            }}
          >
            <option value="all">All sales reps</option>
            {salesUsers.map(u => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </select>
        )}

        <button className="v2d-cta" onClick={() => navigate('/quotes/new')}>
          <Plus size={15} /> New quote
        </button>
      </div>

      {/* Phase 33L — duplicate finder. Admin-only. Surfaces clients
          with the same normalized phone (or company when phone is
          blank) so admin can merge by picking a primary and deleting
          the others. Clients table is decoupled from quote history,
          so deleting a dup doesn't affect past quote snapshots. */}
      {isAdmin && (
        <DuplicatesPanel
          clients={clients}
          userMap={userMap}
          isOpen={dupOpen}
          onToggle={() => setDupOpen(v => !v)}
          onChanged={load}
        />
      )}

      {/* ─── Stats strip ──────────────────────────────── */}
      {/* Stats reflect the rep filter when active so admin can see
          a single rep's book at a glance. Falls back to all clients
          when the filter is "All sales reps" or for non-admin views. */}
      {(() => {
        const scoped = (isAdmin && repFilter !== 'all')
          ? clients.filter(c => c.created_by === repFilter)
          : clients
        return (
          <section className="v2d-kpi-row" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
            <StatCard label="Total clients" value={scoped.length} />
            <StatCard label="Quotes on record" value={scoped.reduce((s, c) => s + (c.quote_count || 0), 0)} />
            <StatCard
              label="Total won"
              money={scoped.reduce((s, c) => s + (Number(c.total_won_amount) || 0), 0)}
            />
          </section>
        )
      })()}

      {/* ─── Table ────────────────────────────────────── */}
      <div className="v2d-panel" style={{ overflow: 'hidden', padding: 0 }}>
        {loading ? (
          <div className="v2d-q-empty" style={{ padding: 40 }}>Loading clients…</div>
        ) : filtered.length === 0 ? (
          // Phase 33G — proper empty state with icon + CTA, matching
          // the QuotesV2 pattern. Reps need a visible path forward;
          // a one-line hint isn't enough.
          <div className="v2d-empty-card" style={{ padding: 40, textAlign: 'center' }}>
            <div className="v2d-empty-ic" style={{ marginBottom: 12 }}>
              <Users size={28} strokeWidth={1.6} />
            </div>
            <div className="v2d-empty-t">
              {search ? 'No matching clients' : 'No clients yet'}
            </div>
            <div className="v2d-empty-s" style={{ marginBottom: 16 }}>
              {search
                ? `Nothing matched "${search}". Try a different name, phone, or company.`
                : 'Clients are saved automatically the first time you create a quote for them.'}
            </div>
            {!search && (
              <button className="v2d-cta" onClick={() => navigate('/quotes/new')}>
                <Plus size={15} />
                <span>Create your first quote</span>
              </button>
            )}
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="v2d-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--v2-line)', color: 'var(--v2-ink-2)' }}>
                  <th style={thStyle}>Client</th>
                  <th style={thStyle}>Phone</th>
                  <th style={thStyle}>Email</th>
                  <th style={thStyleR}>Quotes</th>
                  <th style={thStyleR}>Total won</th>
                  <th style={thStyle}>Last quote</th>
                  {isAdmin && <th style={thStyle}>Owner</th>}
                  <th style={{ ...thStyleR, width: 140 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(c => (
                  <tr key={c.id} style={{ borderBottom: '1px solid var(--v2-line)' }}>
                    <td style={tdStyle}>
                      {/* Company is the primary identifier (B2B —
                          contact name is just the person at the company).
                          Falls back to contact name when company is
                          missing so the row never reads "Unknown". */}
                      <div style={{ fontWeight: 600, color: 'var(--v2-ink-0)' }}>
                        {c.company || c.name || 'Unknown'}
                      </div>
                      {c.company && c.name && (
                        <div style={{ fontSize: 12, color: 'var(--v2-ink-2)' }}>{c.name}</div>
                      )}
                    </td>
                    <td style={tdStyle}>{c.phone || '—'}</td>
                    <td style={tdStyle}>{c.email || '—'}</td>
                    <td style={tdStyleR}>{c.quote_count || 0}</td>
                    <td style={tdStyleR}>{formatCurrency(c.total_won_amount)}</td>
                    <td style={tdStyle}>{formatDateShort(c.last_quote_at)}</td>
                    {isAdmin && (
                      <td style={tdStyle}>
                        <span style={{ fontSize: 12, color: 'var(--v2-ink-2)' }}>
                          {userMap[c.created_by] || (c.created_by ? '—' : 'Unassigned')}
                        </span>
                      </td>
                    )}
                    <td style={tdStyleR}>
                      <div style={{ display: 'inline-flex', gap: 6 }}>
                        <button
                          className="v2d-btn-ghost"
                          title="Edit client"
                          onClick={() => { setEditing({ ...c }); setSaveErr('') }}
                          style={iconBtnStyle}
                        >
                          <Edit3 size={14} />
                        </button>
                        <button
                          className="v2d-btn-ghost"
                          title="New quote for this client"
                          onClick={() => startNewQuoteForClient(c)}
                          style={iconBtnStyle}
                        >
                          <Plus size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ─── Edit modal ─────────────────────────────── */}
      {editing && (
        <div
          onClick={() => !saving && setEditing(null)}
          style={{
            position: 'fixed', inset: 0, zIndex: 50,
            background: 'rgba(0,0,0,.55)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 16,
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              width: '100%', maxWidth: 560,
              background: 'var(--v2-bg-1)',
              border: '1px solid var(--v2-line)',
              borderRadius: 16,
              padding: 20,
              display: 'flex', flexDirection: 'column', gap: 14,
              maxHeight: '90vh', overflowY: 'auto',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontFamily: 'var(--v2-display)', fontSize: 18, fontWeight: 700, color: 'var(--v2-ink-0)' }}>
                  Edit client
                </div>
                <div style={{ fontSize: 12, color: 'var(--v2-ink-2)' }}>
                  Past quotes keep their original snapshot.
                </div>
              </div>
              <button
                onClick={() => !saving && setEditing(null)}
                style={{ background: 'transparent', border: 0, color: 'var(--v2-ink-2)', cursor: 'pointer' }}
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>

            <ModalField icon={Users}     label="Name"     value={editing.name}    onChange={v => setEditing({ ...editing, name: v })}    required />
            <ModalField icon={Building2} label="Company"  value={editing.company} onChange={v => setEditing({ ...editing, company: v })} />
            <ModalField icon={Phone}     label="Phone"    value={editing.phone}   onChange={v => setEditing({ ...editing, phone: v })}   required />
            <ModalField icon={Mail}      label="Email"    value={editing.email}   onChange={v => setEditing({ ...editing, email: v })}   type="email" />
            <ModalField icon={FileText}  label="GSTIN"    value={editing.gstin}   onChange={v => setEditing({ ...editing, gstin: v })} />
            <ModalField icon={MapPin}    label="Address"  value={editing.address} onChange={v => setEditing({ ...editing, address: v })} />

            <div>
              <label style={labelStyle}>Notes</label>
              <textarea
                value={editing.notes || ''}
                onChange={e => setEditing({ ...editing, notes: e.target.value })}
                rows={3}
                style={{ ...inputStyle, resize: 'vertical' }}
              />
            </div>

            {saveErr && (
              <div style={{ color: 'var(--v2-rose)', fontSize: 13 }}>{saveErr}</div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button
                onClick={() => setEditing(null)}
                disabled={saving}
                className="v2d-btn-ghost"
                style={{ padding: '8px 14px', borderRadius: 10 }}
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="v2d-cta"
              >
                <Save size={14} /> {saving ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/* Phase 33L — DuplicatesPanel
   Admin tool that groups clients by normalized phone (or company when
   phone is blank). Surfaces groups with 2+ rows; admin picks a
   primary and the rest get deleted. Clients table is decoupled from
   quote history (every quote carries its own client_* snapshot), so
   deletes don't affect past quotes. */
function DuplicatesPanel({ clients, userMap, isOpen, onToggle, onChanged }) {
  const groups = useMemo(() => {
    const buckets = new Map()
    clients.forEach(c => {
      // Normalize phone to digits-only. Empty? Fall back to company name.
      const phoneKey = (c.phone || '').replace(/\D/g, '')
      const companyKey = (c.company || '').trim().toLowerCase()
      const key = phoneKey || (companyKey ? 'co:' + companyKey : null)
      if (!key) return
      if (!buckets.has(key)) buckets.set(key, [])
      buckets.get(key).push(c)
    })
    return Array.from(buckets.entries())
      .filter(([, arr]) => arr.length >= 2)
      .map(([key, arr]) => ({ key, rows: arr }))
      .sort((a, b) => b.rows.length - a.rows.length)
  }, [clients])

  async function mergeGroup(group, primaryId) {
    const others = group.rows.filter(r => r.id !== primaryId)
    if (others.length === 0) return
    const primaryName = group.rows.find(r => r.id === primaryId)?.company
      || group.rows.find(r => r.id === primaryId)?.name || 'this client'
    if (!confirm(
      `Delete ${others.length} duplicate row${others.length > 1 ? 's' : ''} ` +
      `and keep "${primaryName}" as the primary? ` +
      `Past quotes are unaffected.`
    )) return
    const ids = others.map(r => r.id)
    const { error } = await supabase.from('clients').delete().in('id', ids)
    if (error) { alert('Merge failed: ' + error.message); return }
    onChanged()
  }

  return (
    <div className="v2d-panel" style={{ padding: 0, overflow: 'hidden' }}>
      <button
        type="button"
        onClick={onToggle}
        style={{
          width: '100%', padding: '10px 14px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          background: 'transparent', border: 0, cursor: 'pointer',
          color: 'var(--v2-ink-0)',
        }}
      >
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600 }}>
          <GitMerge size={14} /> Find duplicate clients
          {groups.length > 0 && (
            <span style={{
              padding: '1px 8px', borderRadius: 999, fontSize: 10, fontWeight: 700,
              background: 'rgba(245,158,11,.15)', color: 'var(--v2-amber, #F59E0B)',
              textTransform: 'uppercase', letterSpacing: '.06em',
            }}>
              {groups.length} group{groups.length !== 1 ? 's' : ''}
            </span>
          )}
        </span>
        <span style={{ fontSize: 11, color: 'var(--v2-ink-2)' }}>
          {isOpen ? 'Hide' : 'Show'}
        </span>
      </button>
      {isOpen && (
        <div style={{ borderTop: '1px solid var(--v2-line)' }}>
          {groups.length === 0 ? (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--v2-ink-2)', fontSize: 13 }}>
              No duplicates found. Clients are unique by phone (or by company name where phone is blank).
            </div>
          ) : (
            groups.map(g => (
              <div key={g.key} style={{
                padding: '12px 14px', borderBottom: '1px solid var(--v2-line)',
              }}>
                <div style={{ fontSize: 11, color: 'var(--v2-ink-2)', marginBottom: 8 }}>
                  {g.rows.length} clients share {g.key.startsWith('co:') ? `company "${g.key.slice(3)}"` : `phone ${g.key}`}
                  — pick the one to KEEP. Others will be deleted.
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {g.rows.map(c => (
                    <div
                      key={c.id}
                      style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        padding: '8px 10px', borderRadius: 8,
                        background: 'var(--v2-bg-2)', border: '1px solid var(--v2-line)',
                        gap: 10, flexWrap: 'wrap',
                      }}
                    >
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--v2-ink-0)' }}>
                          {c.company || c.name || 'Unknown'}
                          {c.company && c.name && (
                            <span style={{ fontWeight: 400, color: 'var(--v2-ink-2)', fontSize: 12 }}> · {c.name}</span>
                          )}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--v2-ink-2)', marginTop: 2 }}>
                          {c.phone || '—'} · {c.quote_count || 0} quotes · owner: {userMap[c.created_by] || '—'}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => mergeGroup(g, c.id)}
                        className="v2d-cta"
                        style={{ padding: '6px 12px', fontSize: 12 }}
                        title="Keep this row, delete the others"
                      >
                        Keep this · merge {g.rows.length - 1}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}

function StatCard({ label, value, money }) {
  return (
    <div className="v2d-kpi">
      <div className="v2d-kpi-head">
        <div className="v2d-kpi-l">{label}</div>
      </div>
      <div className="v2d-kpi-v">
        {money !== undefined ? formatCurrency(money) : (value ?? 0)}
      </div>
    </div>
  )
}

function ModalField({ icon: Icon, label, value, onChange, required, type = 'text' }) {
  return (
    <div>
      <label style={labelStyle}>
        {Icon && <Icon size={12} style={{ marginRight: 6, verticalAlign: 'middle' }} />}
        {label}{required && ' *'}
      </label>
      <input
        type={type}
        value={value || ''}
        onChange={e => onChange(e.target.value)}
        style={inputStyle}
      />
    </div>
  )
}

const thStyle  = { padding: '12px 14px', fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap' }
const thStyleR = { ...thStyle, textAlign: 'right' }
const tdStyle  = { padding: '12px 14px', fontSize: 13, color: 'var(--v2-ink-1)', verticalAlign: 'top' }
const tdStyleR = { ...tdStyle, textAlign: 'right', whiteSpace: 'nowrap' }
const labelStyle = {
  display: 'block',
  fontSize: 12,
  fontWeight: 600,
  color: 'var(--v2-ink-2)',
  marginBottom: 6,
}
const inputStyle = {
  width: '100%',
  padding: '10px 12px',
  background: 'var(--v2-bg-2)',
  border: '1px solid var(--v2-line)',
  borderRadius: 10,
  color: 'var(--v2-ink-0)',
  fontSize: 14,
  outline: 'none',
  fontFamily: 'inherit',
}
const iconBtnStyle = {
  padding: '6px 8px',
  borderRadius: 8,
  background: 'var(--v2-bg-2)',
  border: '1px solid var(--v2-line)',
  color: 'var(--v2-ink-1)',
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
}
