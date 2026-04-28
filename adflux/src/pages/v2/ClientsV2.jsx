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
  FileText, X, Save,
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
      setSalesUsers((users || []).filter(u => u.role === 'sales').map(u => ({ id: u.id, name: u.name })))
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
          <div className="v2d-q-empty" style={{ padding: 40 }}>
            {search ? `No clients match "${search}".` : 'No clients yet. Create a quote and the client will auto-save here.'}
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
