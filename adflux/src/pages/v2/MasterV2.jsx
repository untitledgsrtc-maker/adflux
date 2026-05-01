// src/pages/v2/MasterV2.jsx
//
// Unified Master page (Phase 8C). Four tabs:
//   • Attachments  — full edit. Owner uploads each reusable file once
//                    (DAVP letter, Advisory, 198-page list, etc.) and
//                    every new proposal auto-links them via the
//                    default_file_url column on attachment_templates.
//   • Signers      — edit signature_title + signature_mobile per user.
//                    These flow into the Gujarati letter via signer.
//   • Media        — read-only list of segment+media_type combos.
//   • Documents    — read-only list of proposal_templates.
//
// Why one page with tabs (not four pages): owner spec, 1 May 2026 —
// "one master for media, document, signing authority, attachment,
// which will be reused." Tabs keep them mentally co-located.
//
// Auth: admin / owner / co_owner only. The route guard in App.jsx
// filters at navigation time; we double-check here for direct URL
// hits.

import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Paperclip, UserCheck, Tv, FileText, Upload, Loader2, Plus, Trash2,
  Save, ArrowLeft, FileBox,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/authStore'
import { uploadAttachment, getSignedUrl, slugifyLabel } from '../../utils/proposalPdf'

const TABS = [
  { key: 'attachments', label: 'Attachments', icon: Paperclip },
  { key: 'signers',     label: 'Signers',     icon: UserCheck },
  { key: 'media',       label: 'Media',       icon: Tv },
  { key: 'documents',   label: 'Documents',   icon: FileText },
]

const MEDIA_FILTERS = [
  { segment: 'GOVERNMENT', media_type: 'AUTO_HOOD', label: 'Govt — Auto Hood' },
  { segment: 'GOVERNMENT', media_type: 'GSRTC_LED', label: 'Govt — GSRTC LED' },
]

export default function MasterV2() {
  const navigate = useNavigate()
  const profile = useAuthStore(s => s.profile)
  const isAuthorized = ['admin', 'owner', 'co_owner'].includes(profile?.role)

  const [activeTab, setActiveTab] = useState('attachments')

  // Bounce non-privileged users back to dashboard. Belt and suspenders;
  // the sidebar entry should already be hidden for them.
  useEffect(() => {
    if (!profile) return
    if (!isAuthorized) navigate('/dashboard', { replace: true })
  }, [profile, isAuthorized, navigate])

  if (!isAuthorized) return null

  return (
    <div className="govt-master">
      <div className="govt-master__head">
        <div>
          <div className="govt-master__kicker">Master configuration</div>
          <h1 className="govt-master__title">Master</h1>
          <div className="govt-master__sub">
            One place for reusable proposal pieces — attachments, signers, media, document templates.
          </div>
        </div>
        <button
          type="button"
          className="govt-wiz__btn"
          onClick={() => navigate('/dashboard')}
        >
          <ArrowLeft size={14} /> Dashboard
        </button>
      </div>

      {/* Tab strip */}
      <div style={{
        display: 'flex', gap: 4, marginBottom: 18, marginTop: 4,
        background: 'var(--surface-2)',
        border: '1px solid var(--surface-3)',
        borderRadius: 10, padding: 5, maxWidth: 'fit-content',
      }}>
        {TABS.map(t => {
          const Icon = t.icon
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setActiveTab(t.key)}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '7px 14px', borderRadius: 7, border: 'none',
                background: activeTab === t.key ? 'var(--text)' : 'transparent',
                color:      activeTab === t.key ? 'var(--surface-0)' : 'var(--text-muted)',
                fontSize: 13, fontWeight: 600, cursor: 'pointer',
              }}
            >
              <Icon size={14} /> {t.label}
            </button>
          )
        })}
      </div>

      {activeTab === 'attachments' && <AttachmentsTab />}
      {activeTab === 'signers'     && <SignersTab />}
      {activeTab === 'media'       && <MediaTab />}
      {activeTab === 'documents'   && <DocumentsTab />}

      <style>{`@keyframes spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }`}</style>
    </div>
  )
}

/* ════════════════════════════════════════════════════════════════════
   ATTACHMENTS TAB — the main feature of this page
   ════════════════════════════════════════════════════════════════════ */

function AttachmentsTab() {
  const [filter, setFilter] = useState(MEDIA_FILTERS[0])
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [savingIdx, setSavingIdx] = useState(null)   // rowIdx of a save in flight
  const [uploadingIdx, setUploadingIdx] = useState(null)
  const [statusMsg, setStatusMsg] = useState('')
  const [statusError, setStatusError] = useState('')
  const [newLabel, setNewLabel] = useState('')

  const load = async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('attachment_templates')
      .select('*')
      .eq('segment',    filter.segment)
      .eq('media_type', filter.media_type)
      .eq('is_active',  true)
      .order('display_order')
    if (error) {
      setStatusError(error.message)
      setRows([])
    } else {
      setRows(data || [])
      setStatusError('')
    }
    setLoading(false)
  }
  useEffect(() => { load() /* eslint-disable-next-line */ }, [filter.segment, filter.media_type])

  // Inline edit — buffers the change in local state, persists on blur.
  function setRowField(idx, field, value) {
    setRows(prev => prev.map((r, i) => i === idx ? { ...r, [field]: value } : r))
  }

  async function persistRow(idx) {
    const r = rows[idx]
    if (!r?.id) return
    setSavingIdx(idx)
    const { error } = await supabase
      .from('attachment_templates')
      .update({
        label:       (r.label || '').trim() || 'Untitled attachment',
        is_required: !!r.is_required,
        notes:       r.notes ?? null,
      })
      .eq('id', r.id)
    setSavingIdx(null)
    if (error) {
      setStatusError(`Save failed: ${error.message}`)
    } else {
      setStatusMsg('Saved.')
      setTimeout(() => setStatusMsg(''), 1500)
    }
  }

  // Default file upload for a master row. Storage path uses the
  // _master/ prefix per the convention in supabase_phase8c migration.
  async function handleDefaultFileUpload(idx, file) {
    const r = rows[idx]
    if (!r?.id || !file) return
    setUploadingIdx(idx)
    setStatusError('')
    try {
      const slug = slugifyLabel(r.label)
      const ext = (file.name.split('.').pop() || 'pdf').toLowerCase()
      const path = `_master/${filter.segment}/${filter.media_type}/${String(r.display_order).padStart(2, '0')}-${slug}.${ext}`

      const { error: upErr } = await supabase.storage
        .from('quote-attachments')
        .upload(path, file, {
          upsert: true,
          contentType: file.type || undefined,
          cacheControl: '3600',
        })
      if (upErr) throw upErr

      // Persist the path on the template row.
      const now = new Date().toISOString()
      const { data, error } = await supabase
        .from('attachment_templates')
        .update({
          default_file_url:         path,
          default_file_uploaded_at: now,
        })
        .eq('id', r.id)
        .select()
        .single()
      if (error) throw error
      setRows(prev => prev.map((row, i) => i === idx ? data : row))
      setStatusMsg('Default file uploaded — every new proposal will auto-link it.')
      setTimeout(() => setStatusMsg(''), 3000)
    } catch (e) {
      setStatusError(`Upload failed: ${e?.message || e}`)
    } finally {
      setUploadingIdx(null)
    }
  }

  async function handleClearDefaultFile(idx) {
    const r = rows[idx]
    if (!r?.id) return
    if (!window.confirm(`Remove the default file for "${r.label}"? New proposals will no longer auto-link this attachment.`)) return
    setSavingIdx(idx)
    const { data, error } = await supabase
      .from('attachment_templates')
      .update({
        default_file_url:         null,
        default_file_uploaded_at: null,
      })
      .eq('id', r.id)
      .select()
      .single()
    setSavingIdx(null)
    if (error) {
      setStatusError(error.message)
    } else {
      setRows(prev => prev.map((row, i) => i === idx ? data : row))
      setStatusMsg('Default file cleared.')
      setTimeout(() => setStatusMsg(''), 2000)
    }
  }

  async function handleViewDefault(path) {
    if (!path) return
    try {
      const url = await getSignedUrl(path, 600)
      window.open(url, '_blank', 'noopener')
    } catch (e) {
      setStatusError(`Could not open file: ${e?.message || e}`)
    }
  }

  async function handleAddRow() {
    const label = newLabel.trim()
    if (!label) return
    setStatusError('')
    const nextOrder = (rows.reduce((m, r) => Math.max(m, r.display_order || 0), 0)) + 1
    const { data, error } = await supabase
      .from('attachment_templates')
      .insert([{
        segment:        filter.segment,
        media_type:     filter.media_type,
        display_order:  nextOrder,
        label,
        is_required:    false,
      }])
      .select()
      .single()
    if (error) {
      setStatusError(`Could not add row: ${error.message}`)
    } else {
      setRows(prev => [...prev, data])
      setNewLabel('')
      setStatusMsg(`Added "${label}".`)
      setTimeout(() => setStatusMsg(''), 2000)
    }
  }

  async function handleDeactivateRow(idx) {
    const r = rows[idx]
    if (!r?.id) return
    if (!window.confirm(`Hide "${r.label}" from new proposals? Existing proposals keep whatever was saved on them.`)) return
    const { error } = await supabase
      .from('attachment_templates')
      .update({ is_active: false })
      .eq('id', r.id)
    if (error) {
      setStatusError(error.message)
    } else {
      setRows(prev => prev.filter((_, i) => i !== idx))
      setStatusMsg('Removed from new proposals.')
      setTimeout(() => setStatusMsg(''), 2000)
    }
  }

  return (
    <>
      {/* Filter pills — pick which (segment, media_type) the rows
          below belong to. Govt has two media types right now; private
          intentionally not exposed (private LED uses the older
          attachment-less wizard). */}
      <div style={{
        display: 'flex', gap: 6, marginBottom: 14,
        padding: 4, background: 'var(--surface-2)',
        border: '1px solid var(--surface-3)', borderRadius: 999,
        maxWidth: 'fit-content',
      }}>
        {MEDIA_FILTERS.map(f => {
          const active = filter.segment === f.segment && filter.media_type === f.media_type
          return (
            <button
              key={`${f.segment}-${f.media_type}`}
              type="button"
              onClick={() => setFilter(f)}
              style={{
                padding: '6px 14px', borderRadius: 999, border: 'none',
                cursor: 'pointer', fontSize: 12, fontWeight: 600,
                background: active ? 'var(--text)' : 'transparent',
                color:      active ? 'var(--surface-0)' : 'var(--text-muted)',
              }}
            >
              {f.label}
            </button>
          )
        })}
      </div>

      {statusMsg && (
        <div style={{
          background: 'rgba(76,175,80,.1)', border: '1px solid rgba(76,175,80,.3)',
          borderRadius: 8, padding: '8px 12px', marginBottom: 12,
          fontSize: '.82rem', color: '#81c784',
        }}>✓ {statusMsg}</div>
      )}
      {statusError && (
        <div style={{
          background: 'rgba(229,57,53,.1)', border: '1px solid rgba(229,57,53,.3)',
          borderRadius: 8, padding: '8px 12px', marginBottom: 12,
          fontSize: '.82rem', color: '#ef9a9a',
        }}>{statusError}</div>
      )}

      {loading ? (
        <div style={{ padding: 30, textAlign: 'center', color: 'var(--text-muted)' }}>
          <Loader2 size={20} style={{ animation: 'spin 1s linear infinite' }} /> Loading attachments…
        </div>
      ) : (
        <div className="govt-list">
          {/* Header row — labels for each column so the inline-edit
              grid feels like a table and not just stacked inputs. */}
          <div
            className="govt-list__row"
            style={{
              gridTemplateColumns: '50px 1.4fr 90px 1.6fr 90px 28px',
              fontSize: 11, color: 'var(--text-subtle)',
              textTransform: 'uppercase', letterSpacing: '.06em',
              fontWeight: 600,
            }}
          >
            <span>#</span>
            <span>Label</span>
            <span>Required</span>
            <span>Default file (auto-attaches)</span>
            <span style={{ textAlign: 'right' }}>Actions</span>
            <span></span>
          </div>

          {rows.map((r, idx) => {
            const hasFile = !!r.default_file_url
            return (
              <div
                key={r.id}
                className="govt-list__row"
                style={{
                  gridTemplateColumns: '50px 1.4fr 90px 1.6fr 90px 28px',
                  alignItems: 'center',
                }}
              >
                <span style={{ color: 'var(--text-subtle)', fontSize: 12 }}>
                  {r.display_order}
                </span>
                <input
                  type="text"
                  value={r.label || ''}
                  onChange={e => setRowField(idx, 'label', e.target.value)}
                  onBlur={() => persistRow(idx)}
                  className="govt-input-cell"
                  style={{ maxWidth: 'unset', width: '100%' }}
                />
                <button
                  type="button"
                  onClick={() => {
                    setRowField(idx, 'is_required', !r.is_required)
                    setTimeout(() => persistRow(idx), 0)
                  }}
                  style={{
                    padding: '4px 10px', borderRadius: 999, border: 'none',
                    cursor: 'pointer', fontSize: 11, fontWeight: 700,
                    background: r.is_required ? 'rgba(229,57,53,.15)' : 'var(--surface-2)',
                    color:      r.is_required ? '#ef9a9a' : 'var(--text-muted)',
                    textTransform: 'uppercase', letterSpacing: '.06em',
                  }}
                  title="Toggle required"
                >
                  {r.is_required ? 'Required' : 'Optional'}
                </button>

                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <label
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 6,
                      padding: '5px 10px', borderRadius: 6,
                      border: '1px solid var(--surface-3)',
                      background: hasFile ? 'rgba(100,181,246,.08)' : 'var(--surface-2)',
                      color: hasFile ? '#64b5f6' : 'var(--text)',
                      fontSize: 12, fontWeight: 600,
                      cursor: uploadingIdx === idx ? 'wait' : 'pointer',
                      whiteSpace: 'nowrap',
                    }}
                    title={hasFile ? 'Replace the default file' : 'Upload a default file (auto-attaches to new proposals)'}
                  >
                    {uploadingIdx === idx ? (
                      <><Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> Uploading…</>
                    ) : (
                      <><Upload size={12} /> {hasFile ? 'Replace default' : 'Upload default'}</>
                    )}
                    <input
                      type="file"
                      accept=".pdf,.jpg,.jpeg,.png,.webp"
                      style={{ display: 'none' }}
                      disabled={uploadingIdx === idx}
                      onChange={e => {
                        const f = e.target.files?.[0]
                        if (f) handleDefaultFileUpload(idx, f)
                        e.target.value = ''
                      }}
                    />
                  </label>
                  {hasFile && (
                    <>
                      <button
                        type="button"
                        onClick={() => handleViewDefault(r.default_file_url)}
                        style={{
                          background: 'transparent', border: 'none',
                          color: '#64b5f6', cursor: 'pointer',
                          fontSize: 11, fontWeight: 600,
                        }}
                        title="View current default file"
                      >View</button>
                      <button
                        type="button"
                        onClick={() => handleClearDefaultFile(idx)}
                        style={{
                          background: 'transparent', border: 'none',
                          color: 'var(--danger)', cursor: 'pointer',
                          fontSize: 11, fontWeight: 600,
                        }}
                        title="Remove default file"
                      >Clear</button>
                    </>
                  )}
                </div>

                <span style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  {savingIdx === idx && (
                    <Loader2 size={14} style={{ color: 'var(--text-muted)', animation: 'spin 1s linear infinite' }} />
                  )}
                </span>

                <button
                  type="button"
                  onClick={() => handleDeactivateRow(idx)}
                  title="Hide from new proposals"
                  style={{
                    background: 'transparent', border: 'none',
                    color: 'var(--danger)', cursor: 'pointer',
                  }}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            )
          })}

          {/* Add-row */}
          <div
            className="govt-list__row"
            style={{ gridTemplateColumns: '50px 1.4fr 90px 1.6fr 90px 28px', alignItems: 'center' }}
          >
            <span style={{ color: 'var(--text-subtle)', fontSize: 12 }}>+</span>
            <input
              type="text"
              value={newLabel}
              onChange={e => setNewLabel(e.target.value)}
              placeholder="New attachment label…"
              onKeyDown={e => { if (e.key === 'Enter') handleAddRow() }}
              className="govt-input-cell"
              style={{ maxWidth: 'unset', width: '100%' }}
            />
            <span></span>
            <span style={{ color: 'var(--text-subtle)', fontSize: 12 }}>
              Press Enter or click +
            </span>
            <span></span>
            <span>
              <button
                type="button"
                onClick={handleAddRow}
                disabled={!newLabel.trim()}
                style={{
                  background: 'transparent', border: 'none',
                  color: newLabel.trim() ? 'var(--accent)' : 'var(--text-subtle)',
                  cursor: newLabel.trim() ? 'pointer' : 'not-allowed',
                }}
              >
                <Plus size={14} />
              </button>
            </span>
          </div>
        </div>
      )}

      <p style={{ marginTop: 14, fontSize: 12, color: 'var(--text-subtle)', maxWidth: 720 }}>
        <strong>How it works:</strong> upload a default file here once and every new proposal
        of this segment+media combination auto-links it in the attachments checklist. The team
        only needs to upload the per-quote items (OC copy, PO copy / Work Order) on each
        individual proposal. Replacing a default file does NOT change proposals that have already
        been sent — those are locked snapshots.
      </p>
    </>
  )
}

/* ════════════════════════════════════════════════════════════════════
   SIGNERS TAB — basic
   ════════════════════════════════════════════════════════════════════ */

function SignersTab() {
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState(null)
  const [statusMsg, setStatusMsg] = useState('')
  const [statusError, setStatusError] = useState('')

  const load = async () => {
    setLoading(true)
    // Pull users with privileged roles — they're the candidates to sign
    // proposals. Includes admin / owner / co_owner.
    const { data, error } = await supabase
      .from('users')
      .select('id, name, email, role, signature_title, signature_mobile')
      .in('role', ['admin', 'owner', 'co_owner'])
      .order('role').order('name')
    if (error) setStatusError(error.message)
    else setUsers(data || [])
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  function setUserField(id, field, value) {
    setUsers(prev => prev.map(u => u.id === id ? { ...u, [field]: value } : u))
  }

  async function persistUser(id) {
    const u = users.find(x => x.id === id)
    if (!u) return
    setSavingId(id)
    const { error } = await supabase
      .from('users')
      .update({
        signature_title:  (u.signature_title || '').trim() || null,
        signature_mobile: (u.signature_mobile || '').trim() || null,
      })
      .eq('id', id)
    setSavingId(null)
    if (error) setStatusError(`Save failed: ${error.message}`)
    else { setStatusMsg('Saved.'); setTimeout(() => setStatusMsg(''), 1500) }
  }

  return (
    <>
      {statusMsg && (
        <div style={{ background: 'rgba(76,175,80,.1)', border: '1px solid rgba(76,175,80,.3)', borderRadius: 8, padding: '8px 12px', marginBottom: 12, fontSize: '.82rem', color: '#81c784' }}>✓ {statusMsg}</div>
      )}
      {statusError && (
        <div style={{ background: 'rgba(229,57,53,.1)', border: '1px solid rgba(229,57,53,.3)', borderRadius: 8, padding: '8px 12px', marginBottom: 12, fontSize: '.82rem', color: '#ef9a9a' }}>{statusError}</div>
      )}
      {loading ? (
        <div style={{ padding: 30, textAlign: 'center', color: 'var(--text-muted)' }}>
          <Loader2 size={20} style={{ animation: 'spin 1s linear infinite' }} /> Loading signers…
        </div>
      ) : (
        <div className="govt-list">
          <div
            className="govt-list__row"
            style={{
              gridTemplateColumns: '1.2fr 100px 1.2fr 1fr 60px',
              fontSize: 11, color: 'var(--text-subtle)',
              textTransform: 'uppercase', letterSpacing: '.06em', fontWeight: 600,
            }}
          >
            <span>Name</span>
            <span>Role</span>
            <span>Signature title</span>
            <span>Mobile (default)</span>
            <span></span>
          </div>
          {users.map(u => (
            <div
              key={u.id}
              className="govt-list__row"
              style={{ gridTemplateColumns: '1.2fr 100px 1.2fr 1fr 60px', alignItems: 'center' }}
            >
              <span style={{ color: 'var(--text)', fontWeight: 600 }}>
                {u.name}
                {u.email && (
                  <div style={{ fontSize: 11, color: 'var(--text-subtle)', fontWeight: 400 }}>{u.email}</div>
                )}
              </span>
              <span style={{
                fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
                letterSpacing: '.06em', color: 'var(--text-muted)',
              }}>{u.role}</span>
              <input
                type="text"
                value={u.signature_title || ''}
                onChange={e => setUserField(u.id, 'signature_title', e.target.value)}
                onBlur={() => persistUser(u.id)}
                placeholder="e.g. CEO, Director, Manager"
                className="govt-input-cell"
                style={{ maxWidth: 'unset', width: '100%' }}
              />
              <input
                type="text"
                value={u.signature_mobile || ''}
                onChange={e => setUserField(u.id, 'signature_mobile', e.target.value)}
                onBlur={() => persistUser(u.id)}
                placeholder="10-digit number"
                className="govt-input-cell"
                style={{ maxWidth: 'unset', width: '100%' }}
              />
              <span style={{ display: 'flex', justifyContent: 'flex-end' }}>
                {savingId === u.id && (
                  <Loader2 size={14} style={{ color: 'var(--text-muted)', animation: 'spin 1s linear infinite' }} />
                )}
              </span>
            </div>
          ))}
        </div>
      )}

      <p style={{ marginTop: 14, fontSize: 12, color: 'var(--text-subtle)', maxWidth: 720 }}>
        <strong>How it works:</strong> these are the users who can sign proposals (roles:
        admin / owner / co_owner). The signature_title (e.g. "CEO") and default mobile show
        up on the Gujarati letter when this user is the assigned signer. Per-proposal mobile
        override still wins over the default — see the proposal detail page.
      </p>
    </>
  )
}

/* ════════════════════════════════════════════════════════════════════
   MEDIA TAB — read-only
   ════════════════════════════════════════════════════════════════════ */

function MediaTab() {
  return (
    <div style={{
      padding: 30, textAlign: 'center', color: 'var(--text-muted)',
      border: '1px dashed var(--surface-3)', borderRadius: 12,
    }}>
      <Tv size={28} style={{ marginBottom: 8, color: 'var(--text-subtle)' }} />
      <div style={{ fontWeight: 600, color: 'var(--text)' }}>Media types</div>
      <div style={{ fontSize: 13, marginTop: 6 }}>
        Government — Auto Hood &amp; Government — GSRTC LED.<br />
        Adding new media types is rare and ships via a database migration today.
      </div>
    </div>
  )
}

/* ════════════════════════════════════════════════════════════════════
   DOCUMENTS TAB — read-only list of proposal_templates
   ════════════════════════════════════════════════════════════════════ */

function DocumentsTab() {
  const [tpls, setTpls] = useState([])
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    (async () => {
      setLoading(true)
      const { data } = await supabase
        .from('proposal_templates')
        .select('id, segment, media_type, language, version, is_active, created_at')
        .eq('is_active', true)
        .is('effective_to', null)
        .order('segment').order('media_type').order('version', { ascending: false })
      setTpls(data || [])
      setLoading(false)
    })()
  }, [])

  if (loading) return (
    <div style={{ padding: 30, textAlign: 'center', color: 'var(--text-muted)' }}>
      <Loader2 size={20} style={{ animation: 'spin 1s linear infinite' }} /> Loading templates…
    </div>
  )

  return (
    <>
      <div className="govt-list">
        <div
          className="govt-list__row"
          style={{
            gridTemplateColumns: '1fr 1fr 80px 60px',
            fontSize: 11, color: 'var(--text-subtle)',
            textTransform: 'uppercase', letterSpacing: '.06em', fontWeight: 600,
          }}
        >
          <span>Segment + media</span>
          <span>Language</span>
          <span>Version</span>
          <span></span>
        </div>
        {tpls.map(t => (
          <div
            key={t.id}
            className="govt-list__row"
            style={{ gridTemplateColumns: '1fr 1fr 80px 60px', alignItems: 'center' }}
          >
            <span style={{ color: 'var(--text)', fontWeight: 600 }}>
              {t.segment} — {t.media_type}
            </span>
            <span style={{ color: 'var(--text-muted)' }}>{t.language}</span>
            <span style={{ color: 'var(--text-muted)' }}>v{t.version}</span>
            <span style={{
              fontSize: 11, color: t.is_active ? '#81c784' : 'var(--text-subtle)',
            }}>{t.is_active ? 'active' : 'inactive'}</span>
          </div>
        ))}
      </div>

      <p style={{ marginTop: 14, fontSize: 12, color: 'var(--text-subtle)', maxWidth: 720 }}>
        <strong>How it works:</strong> proposal templates ship as database migrations
        (the Gujarati letter body is checked into version control). Editing them in-app
        is risky — a typo in the rendered output is hard to undo once proposals have
        been sent. View-only here for now.
      </p>
    </>
  )
}
