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

import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Paperclip, UserCheck, Tv, FileText, Upload, Loader2, Plus, Trash2,
  Save, ArrowLeft, FileBox, Building2,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/authStore'
import { uploadAttachment, getSignedUrl, slugifyLabel } from '../../utils/proposalPdf'

const TABS = [
  { key: 'attachments', label: 'Attachments', icon: Paperclip },
  { key: 'companies',   label: 'Companies',   icon: Building2 },
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
  // Phase 11i — owner role removed; admin + co_owner is the privileged set.
  const isAuthorized = ['admin', 'co_owner'].includes(profile?.role)

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
                background: activeTab === t.key ? '#facc15' : 'transparent',
                color:      activeTab === t.key ? '#0a0e1a' : 'var(--text-muted)',
                fontSize: 13, fontWeight: 600, cursor: 'pointer',
              }}
            >
              <Icon size={14} /> {t.label}
            </button>
          )
        })}
      </div>

      {activeTab === 'attachments' && <AttachmentsTab />}
      {activeTab === 'companies'   && <CompaniesTab />}
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
                background: active ? '#facc15' : 'transparent',
                color:      active ? '#0a0e1a' : 'var(--text-muted)',
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
        <div className="govt-list" style={{ maxHeight: 'none', overflow: 'visible' }}>
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

/* Phase 11f — file uploader for letterhead / logo. Uploads into the
   public `company-assets` bucket, returns the public URL via onUpload.
   Renders an inline preview when a value is set, an Upload/Replace
   button + Clear button. Per-row local state for the file input + the
   "uploading" spinner. */
function AssetUploader({ row, field, label, kind, accept, onUpload, onClear }) {
  const fileRef = useRef(null)
  const [uploading, setUploading] = useState(false)
  const [err, setErr] = useState('')
  const url = row[field] || ''

  async function handlePick(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    setErr('')
    try {
      const ext  = (file.name.split('.').pop() || 'png').toLowerCase()
      const ts   = Date.now()
      const path = `${row.segment}/${kind}-${ts}.${ext}`
      const { error: upErr } = await supabase.storage
        .from('company-assets')
        .upload(path, file, { contentType: file.type, upsert: false })
      if (upErr) throw upErr
      const { data } = supabase.storage.from('company-assets').getPublicUrl(path)
      if (!data?.publicUrl) throw new Error('Upload succeeded but no public URL returned.')
      await onUpload(data.publicUrl)
    } catch (e2) {
      setErr(e2?.message || String(e2))
    } finally {
      setUploading(false)
      // Reset the input so picking the same file again still triggers onChange
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  return (
    <div>
      <label style={{
        display: 'block', fontSize: 10, fontWeight: 700,
        color: 'var(--text-subtle)', textTransform: 'uppercase',
        letterSpacing: '.06em', marginBottom: 6,
      }}>{label}</label>

      <input
        ref={fileRef}
        type="file"
        accept={accept}
        onChange={handlePick}
        style={{ display: 'none' }}
      />

      {url ? (
        <div style={{
          padding: 10,
          borderRadius: 8,
          background: 'var(--surface-2)',
          border: '1px solid var(--surface-3)',
          display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <img
            src={url}
            alt={`${kind} preview`}
            style={{
              width: 72, height: 96, flexShrink: 0,
              objectFit: 'contain',
              border: '1px solid var(--surface-3)',
              background: '#fff',
              borderRadius: 4,
            }}
            onError={e => {
              e.currentTarget.style.background = 'var(--surface-3)'
              e.currentTarget.removeAttribute('src')
            }}
          />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontSize: 11.5, color: 'var(--text-muted)',
              wordBreak: 'break-all', lineHeight: 1.4,
            }}>
              {url.length > 60 ? url.slice(0, 30) + '…' + url.slice(-25) : url}
            </div>
            <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                style={{
                  padding: '5px 10px', fontSize: 11.5, fontWeight: 600,
                  background: 'var(--surface-3)', border: 'none',
                  borderRadius: 6, color: 'var(--text)',
                  cursor: uploading ? 'wait' : 'pointer',
                }}
              >
                {uploading ? 'Uploading…' : 'Replace'}
              </button>
              <button
                type="button"
                onClick={onClear}
                disabled={uploading}
                style={{
                  padding: '5px 10px', fontSize: 11.5, fontWeight: 600,
                  background: 'transparent', border: '1px solid var(--surface-3)',
                  borderRadius: 6, color: 'var(--text-muted)',
                  cursor: 'pointer',
                }}
              >
                Clear
              </button>
            </div>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          style={{
            width: '100%',
            padding: '14px 12px',
            background: 'var(--surface-2)',
            border: '1px dashed var(--surface-3)',
            borderRadius: 8,
            color: 'var(--text-muted)',
            cursor: uploading ? 'wait' : 'pointer',
            fontSize: 12.5,
            fontWeight: 600,
          }}
        >
          {uploading ? 'Uploading…' : '📎 Upload ' + kind}
        </button>
      )}

      {err && (
        <div style={{ color: '#ef9a9a', fontSize: 11, marginTop: 6 }}>{err}</div>
      )}
    </div>
  )
}

/* ════════════════════════════════════════════════════════════════════
   COMPANIES TAB — admin edits both legal entities
   ════════════════════════════════════════════════════════════════════
   Renders the two companies (GOVERNMENT + PRIVATE) as side-by-side
   editable cards. Same save-on-blur pattern as the Signers tab so the
   admin can tweak GSTIN, bank details, address, etc. without touching
   Supabase Studio. Both proposal letter (govt) and quote PDF
   (private) read from this table on every render — edits take effect
   immediately on next page load. */
function CompaniesTab() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState(null)
  const [statusMsg, setStatusMsg] = useState('')
  const [statusError, setStatusError] = useState('')

  const load = async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('companies')
      .select('*')
      .order('segment')
    if (error) setStatusError(error.message)
    else setRows(data || [])
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  function setField(id, field, value) {
    setRows(prev => prev.map(r => r.id === id ? { ...r, [field]: value } : r))
  }

  async function persist(id) {
    const r = rows.find(x => x.id === id)
    if (!r) return
    setSavingId(id)
    // Strip null/empty strings to NULL so the DB stays clean (some
    // columns are nullable and we don't want '' to render in the PDF
    // as blank-but-not-null).
    const payload = {
      name:            (r.name || '').trim() || null,
      name_gu:         (r.name_gu || '').trim() || null,
      short_name:      (r.short_name || '').trim() || null,
      address_line:    (r.address_line || '').trim() || null,
      city:            (r.city || '').trim() || null,
      state:           (r.state || '').trim() || null,
      pincode:         (r.pincode || '').trim() || null,
      phone:           (r.phone || '').trim() || null,
      email:           (r.email || '').trim() || null,
      website:         (r.website || '').trim() || null,
      gstin:           (r.gstin || '').trim() || null,
      pan:             (r.pan || '').trim() || null,
      bank_name:       (r.bank_name || '').trim() || null,
      bank_branch:     (r.bank_branch || '').trim() || null,
      bank_acc_name:   (r.bank_acc_name || '').trim() || null,
      bank_acc_number: (r.bank_acc_number || '').trim() || null,
      bank_ifsc:       (r.bank_ifsc || '').trim() || null,
      bank_micr:       (r.bank_micr || '').trim() || null,
      upi_id:          (r.upi_id || '').trim() || null,
      // Phase 10b — admin can swap the seeded /letterheads/*.png path
      // for a Supabase Storage URL after re-uploading a new letterhead.
      // Empty value → NULL → renderer falls back to plain white page.
      letterhead_url:  (r.letterhead_url || '').trim() || null,
      logo_url:        (r.logo_url || '').trim() || null,
    }
    const { error } = await supabase
      .from('companies')
      .update(payload)
      .eq('id', id)
    setSavingId(null)
    if (error) {
      setStatusError(`Save failed: ${error.message}`)
    } else {
      setStatusMsg('Saved.')
      setTimeout(() => setStatusMsg(''), 1500)
    }
  }

  // Phase 11f — file upload handler for letterhead / logo. Persists
  // immediately (no save-on-blur because there's no input to blur).
  async function handleAssetUploaded(rowId, field, url) {
    setField(rowId, field, url)
    setSavingId(rowId)
    const { data, error } = await supabase
      .from('companies')
      .update({ [field]: url })
      .eq('id', rowId)
      .select()
      .single()
    setSavingId(null)
    if (error) {
      setStatusError(`Could not save ${field}: ${error.message}`)
      return
    }
    // Refresh the row from server so we don't drift
    setRows(prev => prev.map(r => r.id === rowId ? { ...r, ...data } : r))
    setStatusMsg('Uploaded.')
    setTimeout(() => setStatusMsg(''), 1500)
  }

  async function handleAssetCleared(rowId, field) {
    setField(rowId, field, null)
    setSavingId(rowId)
    const { error } = await supabase
      .from('companies')
      .update({ [field]: null })
      .eq('id', rowId)
    setSavingId(null)
    if (error) {
      setStatusError(`Could not clear ${field}: ${error.message}`)
      return
    }
    setStatusMsg('Cleared.')
    setTimeout(() => setStatusMsg(''), 1500)
  }

  // Field renderer — shared label+input layout for every company field.
  // Pulls value from rows[i][field], writes via setField, persists on blur.
  // `wide` flag stretches across both columns of the card grid.
  function Field({ row, field, label, placeholder, wide }) {
    return (
      <div style={{ gridColumn: wide ? '1 / span 2' : 'auto' }}>
        <label style={{
          display: 'block', fontSize: 10, fontWeight: 700,
          color: 'var(--text-subtle)', textTransform: 'uppercase',
          letterSpacing: '.06em', marginBottom: 4,
        }}>{label}</label>
        <input
          type="text"
          value={row[field] ?? ''}
          onChange={e => setField(row.id, field, e.target.value)}
          onBlur={() => persist(row.id)}
          placeholder={placeholder || ''}
          className="govt-input-cell govt-input-cell--wide"
        />
      </div>
    )
  }

  if (loading) return (
    <div style={{ padding: 30, textAlign: 'center', color: 'var(--text-muted)' }}>
      <Loader2 size={20} style={{ animation: 'spin 1s linear infinite' }} /> Loading companies…
    </div>
  )

  if (rows.length === 0) {
    return (
      <div style={{
        padding: 30, textAlign: 'center', color: 'var(--text-muted)',
        border: '1px dashed var(--surface-3)', borderRadius: 12,
      }}>
        <Building2 size={28} style={{ marginBottom: 8, color: 'var(--text-subtle)' }} />
        <div style={{ fontWeight: 600, color: 'var(--text)' }}>No companies seeded</div>
        <div style={{ fontSize: 13, marginTop: 6 }}>
          Run the Phase 10 SQL migration to seed the two legal entities.
        </div>
      </div>
    )
  }

  return (
    <>
      {statusMsg && (
        <div style={{ background: 'rgba(76,175,80,.1)', border: '1px solid rgba(76,175,80,.3)', borderRadius: 8, padding: '8px 12px', marginBottom: 12, fontSize: '.82rem', color: '#81c784' }}>✓ {statusMsg}</div>
      )}
      {statusError && (
        <div style={{ background: 'rgba(229,57,53,.1)', border: '1px solid rgba(229,57,53,.3)', borderRadius: 8, padding: '8px 12px', marginBottom: 12, fontSize: '.82rem', color: '#ef9a9a' }}>{statusError}</div>
      )}

      {/* Two cards side-by-side on wide screens, stacked on narrow. */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))',
        gap: 18,
      }}>
        {rows.map(r => (
          <div
            key={r.id}
            style={{
              padding: 18, borderRadius: 12,
              border: '1px solid var(--surface-3)',
              background: 'var(--surface-1)',
            }}
          >
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
              marginBottom: 14,
            }}>
              <div>
                <div style={{
                  fontSize: 10, letterSpacing: '.12em',
                  color: r.segment === 'GOVERNMENT' ? '#fbbf24' : '#64b5f6',
                  fontWeight: 700, textTransform: 'uppercase',
                  marginBottom: 2,
                }}>
                  {r.segment} segment
                </div>
                <div style={{ fontWeight: 700, color: 'var(--text)', fontSize: 16 }}>
                  {r.name || 'Unnamed company'}
                </div>
              </div>
              {savingId === r.id && (
                <Loader2 size={14} style={{ color: 'var(--text-muted)', animation: 'spin 1s linear infinite' }} />
              )}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <Field row={r} field="name"          label="Legal name"      wide />
              <Field row={r} field="name_gu"       label="Gujarati name (govt only)" />
              <Field row={r} field="short_name"    label="Short name (signature line)" />
              <Field row={r} field="address_line"  label="Address line"    wide />
              <Field row={r} field="city"          label="City" />
              <Field row={r} field="state"         label="State" />
              <Field row={r} field="pincode"       label="Pincode" />
              <Field row={r} field="phone"         label="Phone" />
              <Field row={r} field="email"         label="Email"           wide />
              <Field row={r} field="website"       label="Website"         wide />

              {/* Tax fields */}
              <div style={{ gridColumn: '1 / span 2', borderTop: '1px solid var(--surface-3)', paddingTop: 12, marginTop: 6 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 8 }}>Tax</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <Field row={r} field="gstin" label="GSTIN" />
                  <Field row={r} field="pan"   label="PAN" />
                </div>
              </div>

              {/* Bank fields */}
              <div style={{ gridColumn: '1 / span 2', borderTop: '1px solid var(--surface-3)', paddingTop: 12, marginTop: 6 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 8 }}>Bank</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <Field row={r} field="bank_name"       label="Bank name" />
                  <Field row={r} field="bank_branch"     label="Branch" />
                  <Field row={r} field="bank_acc_name"   label="Account holder name" wide />
                  <Field row={r} field="bank_acc_number" label="Account number" />
                  <Field row={r} field="bank_ifsc"       label="IFSC" />
                  <Field row={r} field="bank_micr"       label="MICR (optional)" />
                  <Field row={r} field="upi_id"          label="UPI ID (optional)" />
                </div>
              </div>

              {/* Branding — Phase 11f. Replaced text URL inputs with
                  real file upload. Files land in the public
                  company-assets storage bucket; the resulting public
                  URL is saved into companies.letterhead_url / logo_url
                  and used directly by the proposal renderer. */}
              <div style={{ gridColumn: '1 / span 2', borderTop: '1px solid var(--surface-3)', paddingTop: 12, marginTop: 6 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 8 }}>Branding</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                  <AssetUploader
                    row={r}
                    field="letterhead_url"
                    label="Letterhead (govt PDF background)"
                    kind="letterhead"
                    accept="image/png,image/jpeg"
                    onUpload={url => handleAssetUploaded(r.id, 'letterhead_url', url)}
                    onClear={()  => handleAssetCleared(r.id, 'letterhead_url')}
                  />
                  <AssetUploader
                    row={r}
                    field="logo_url"
                    label="Logo (optional)"
                    kind="logo"
                    accept="image/png,image/jpeg,image/svg+xml"
                    onUpload={url => handleAssetUploaded(r.id, 'logo_url', url)}
                    onClear={()  => handleAssetCleared(r.id, 'logo_url')}
                  />
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      <p style={{ marginTop: 14, fontSize: 12, color: 'var(--text-subtle)', maxWidth: 720 }}>
        <strong>How it works:</strong> these two rows drive the company line on every proposal letter
        (govt) + quote PDF (private). Edit any field, click outside to save. Changes appear on the
        very next render — no rebuild needed. Locked snapshots of already-sent proposals are NOT
        affected (they keep the company info that was current at lock time).
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
  // Add-signer form: lists users currently with role='sales' and lets
  // admin promote them to a signing role. We don't create brand-new
  // users from here — that's the Team page's job (HR creates user with
  // email + auth setup). Master.Signers is for promoting an existing
  // user to a signing role + setting their signature info.
  const [showAdd, setShowAdd] = useState(false)
  const [candidates, setCandidates] = useState([])
  const [pickedUserId, setPickedUserId] = useState('')
  const [pickedRole, setPickedRole] = useState('co_owner')
  const [pickedTitle, setPickedTitle] = useState('')
  const [pickedMobile, setPickedMobile] = useState('')
  const [adding, setAdding] = useState(false)

  const load = async () => {
    setLoading(true)
    // Pull users with privileged roles — they're the candidates to sign
    // proposals. Phase 11i — owner role removed.
    const [signersRes, candidatesRes] = await Promise.all([
      supabase
        .from('users')
        .select('id, name, email, role, signature_title, signature_mobile')
        .in('role', ['admin', 'co_owner', 'agency'])
        .order('role').order('name'),
      supabase
        .from('users')
        .select('id, name, email, role')
        .eq('role', 'sales')
        .order('name'),
    ])
    if (signersRes.error) setStatusError(signersRes.error.message)
    else setUsers(signersRes.data || [])
    setCandidates(candidatesRes.data || [])
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  async function handleAddSigner() {
    if (!pickedUserId) {
      setStatusError('Pick a user to promote.')
      return
    }
    setAdding(true)
    setStatusError('')
    const { error } = await supabase
      .from('users')
      .update({
        role:             pickedRole,
        signature_title:  (pickedTitle || '').trim() || null,
        signature_mobile: (pickedMobile || '').trim() || null,
      })
      .eq('id', pickedUserId)
    setAdding(false)
    if (error) {
      setStatusError(`Could not promote: ${error.message}`)
      return
    }
    setStatusMsg('Signer added.')
    setTimeout(() => setStatusMsg(''), 2000)
    setShowAdd(false)
    setPickedUserId('')
    setPickedTitle('')
    setPickedMobile('')
    setPickedRole('co_owner')
    load()
  }

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

      {/* Add-signer toolbar — promote an existing user to signer.
          We don't create new auth users from here; that's HR/Team's
          job. This is the "make Vishnu a signer" workflow. */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
        {!showAdd ? (
          <button
            type="button"
            onClick={() => setShowAdd(true)}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '6px 12px', borderRadius: 6,
              border: '1px solid var(--surface-3)',
              background: 'var(--surface-2)',
              color: 'var(--text)', fontSize: 12, fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            <Plus size={12} /> Promote user to signer
          </button>
        ) : (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
            padding: 10, background: 'var(--surface-2)',
            border: '1px solid var(--surface-3)', borderRadius: 8,
            width: '100%',
          }}>
            <select
              value={pickedUserId}
              onChange={e => setPickedUserId(e.target.value)}
              className="govt-input-cell"
              style={{ minWidth: 200 }}
            >
              <option value="">Pick a user (sales role) —</option>
              {candidates.map(c => (
                <option key={c.id} value={c.id}>{c.name} · {c.email}</option>
              ))}
            </select>
            <select
              value={pickedRole}
              onChange={e => setPickedRole(e.target.value)}
              className="govt-input-cell"
              style={{ minWidth: 130 }}
            >
              {/* Phase 11i — owner role removed. Existing owner users
                   were migrated to admin via SQL migration. */}
              <option value="co_owner">Co-owner</option>
              <option value="admin">Admin</option>
              <option value="agency">Agency</option>
            </select>
            <input
              type="text"
              value={pickedTitle}
              onChange={e => setPickedTitle(e.target.value)}
              placeholder="Signature title"
              className="govt-input-cell"
              style={{ minWidth: 140 }}
            />
            <input
              type="text"
              value={pickedMobile}
              onChange={e => setPickedMobile(e.target.value)}
              placeholder="Mobile (optional)"
              className="govt-input-cell"
              style={{ minWidth: 130 }}
            />
            <button
              type="button"
              onClick={handleAddSigner}
              disabled={adding || !pickedUserId}
              style={{
                padding: '6px 14px', borderRadius: 6, border: 'none',
                background: '#facc15', color: '#0a0e1a', fontSize: 12, fontWeight: 700,
                cursor: pickedUserId ? 'pointer' : 'not-allowed',
                opacity: adding ? 0.6 : 1,
              }}
            >
              {adding ? 'Promoting…' : 'Promote'}
            </button>
            <button
              type="button"
              onClick={() => { setShowAdd(false); setPickedUserId(''); setPickedTitle(''); setPickedMobile('') }}
              style={{
                padding: '6px 12px', borderRadius: 6,
                border: '1px solid var(--surface-3)',
                background: 'transparent', color: 'var(--text-muted)',
                fontSize: 12, fontWeight: 600, cursor: 'pointer',
              }}
            >
              Cancel
            </button>
          </div>
        )}
      </div>

      {loading ? (
        <div style={{ padding: 30, textAlign: 'center', color: 'var(--text-muted)' }}>
          <Loader2 size={20} style={{ animation: 'spin 1s linear infinite' }} /> Loading signers…
        </div>
      ) : (
        <div className="govt-list" style={{ maxHeight: 'none', overflow: 'visible' }}>
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

// Media tab — shows the media catalog with shortcuts to where each
// media's data is actually managed. NOT a full CRUD because adding a
// new media type is more than a row insert — each media has its own
// wizard (Auto Hood = 5 steps, GSRTC LED = different 5 steps), per-
// row config (districts vs stations vs cities), per-media renderer
// template, etc. Adding a new media type means writing code, not
// just editing a database row. Master.Media surfaces what exists +
// who to talk to.
function MediaTab() {
  const navigate = useNavigate()
  const MEDIA = [
    {
      segment:    'GOVERNMENT',
      media_type: 'AUTO_HOOD',
      label:      'Government — Auto Hood',
      description: 'DAVP-rated auto rickshaw hood advertising. 33 districts. Per-district allocation.',
      manage_at:  '/auto-districts',
      manage_label: 'Manage districts + DAVP rates',
      wizard_at:  '/quotes/new/government/auto-hood',
    },
    {
      segment:    'GOVERNMENT',
      media_type: 'GSRTC_LED',
      label:      'Government — GSRTC LED',
      description: 'DAVP-rated LED screens at 20 GSRTC bus stations across Gujarat. Per-station daily-spots / days override.',
      manage_at:  '/gsrtc-stations',
      manage_label: 'Manage stations + DAVP rates',
      wizard_at:  '/quotes/new/government/gsrtc-led',
    },
    {
      segment:    'PRIVATE',
      media_type: 'LED_OTHER',
      label:      'Private — LED + other media',
      description: 'Private clients across LED screens, hoardings, mall, cinema, auto, digital. Per-city pricing.',
      manage_at:  '/cities',
      manage_label: 'Manage cities + rates',
      wizard_at:  '/quotes/new/private',
    },
  ]
  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {MEDIA.map(m => (
          <div
            key={`${m.segment}-${m.media_type}`}
            style={{
              padding: 16, borderRadius: 10,
              border: '1px solid var(--surface-3)',
              background: 'var(--surface-1)',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              gap: 16, flexWrap: 'wrap',
            }}
          >
            <div style={{ flex: 1, minWidth: 260 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>{m.label}</div>
              <div style={{ fontSize: 11, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '.06em', marginTop: 2 }}>
                {m.segment} · {m.media_type}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6, lineHeight: 1.45 }}>
                {m.description}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => navigate(m.manage_at)}
                style={{
                  padding: '6px 12px', borderRadius: 6,
                  border: '1px solid var(--surface-3)',
                  background: 'var(--surface-2)',
                  color: 'var(--text)', fontSize: 12, fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                {m.manage_label} →
              </button>
              <button
                type="button"
                onClick={() => navigate(m.wizard_at)}
                style={{
                  padding: '6px 12px', borderRadius: 6,
                  border: 'none',
                  background: '#facc15', color: '#0a0e1a',
                  fontSize: 12, fontWeight: 700, cursor: 'pointer',
                }}
              >
                + New proposal
              </button>
            </div>
          </div>
        ))}
      </div>
      <p style={{ marginTop: 14, fontSize: 12, color: 'var(--text-subtle)', maxWidth: 720 }}>
        <strong>Why I can't add new media types here:</strong> each media type has its own
        wizard, its own renderer template, and a per-row config (districts / stations /
        cities). Adding a new one is a code change, not a database row. If you want a new
        media type — e.g. "Auto Body Wrap" or "Mall LED" — open a build request and we'll
        add the wizard + master page + renderer in one sprint.
      </p>
    </>
  )
}

/* ════════════════════════════════════════════════════════════════════
   DOCUMENTS TAB — read-only list of proposal_templates
   ════════════════════════════════════════════════════════════════════ */

// Documents tab — view + edit + save-as-new-draft proposal templates.
// Editing is RISKY (a typo in the Gujarati letter body becomes the
// next proposal sent), so we never overwrite an active template in
// place. Instead:
//   1. Edit fields → "Save as new draft (v+1)" creates a new row
//      with version+1 and is_active=false.
//   2. "Activate this version" sets effective_to=now on all OTHER
//      versions of the same (segment, media_type, language) and
//      makes this the only active row.
// This means editing is a 2-step explicit promotion, never a
// silent in-place change.
function DocumentsTab() {
  const [tpls, setTpls] = useState([])
  const [loading, setLoading] = useState(true)
  const [editingId, setEditingId] = useState(null)
  const [editBuf, setEditBuf] = useState(null) // { id, body_html, ... }
  const [saving, setSaving] = useState(false)
  const [statusMsg, setStatusMsg] = useState('')
  const [statusError, setStatusError] = useState('')
  // "+ New template" form state. When showNew is true we render
  // the new-template editor at the top instead of the per-row Edit
  // modal. Reuses the same editBuf shape so the editor JSX is shared.
  const [showNew, setShowNew] = useState(false)
  const [newSegment, setNewSegment] = useState('GOVERNMENT')
  const [newMedia, setNewMedia] = useState('AUTO_HOOD')
  const [newLanguage, setNewLanguage] = useState('gu')
  const [newSubject, setNewSubject] = useState('')
  const [newBody, setNewBody] = useState('')
  const [newHeader, setNewHeader] = useState('')
  const [newFooter, setNewFooter] = useState('')

  const load = async () => {
    setLoading(true)
    // Schema-tolerant: select only columns that definitely exist on
    // proposal_templates plus the Phase 8D additions (version,
    // header_html, footer_html). subject_line is required NOT NULL,
    // so it always exists.
    const { data, error } = await supabase
      .from('proposal_templates')
      .select('id, segment, media_type, language, subject_line, version, is_active, effective_from, effective_to, header_html, body_html, footer_html, notes, created_at, updated_at')
      .order('segment').order('media_type').order('version', { ascending: false })
    if (error) setStatusError(error.message)
    else setTpls(data || [])
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  function startEdit(t) {
    setShowNew(false)
    setEditingId(t.id)
    setEditBuf({
      id:           t.id,
      segment:      t.segment,
      media_type:   t.media_type,
      language:     t.language,
      version:      t.version,
      subject_line: t.subject_line || '',
      header_html:  t.header_html  || '',
      body_html:    t.body_html    || '',
      footer_html:  t.footer_html  || '',
    })
  }

  function cancelEdit() {
    setEditingId(null)
    setEditBuf(null)
    setShowNew(false)
  }

  function startNew() {
    cancelEdit()
    setShowNew(true)
    setNewSegment('GOVERNMENT')
    setNewMedia('AUTO_HOOD')
    setNewLanguage('gu')
    setNewSubject('')
    setNewBody('')
    setNewHeader('')
    setNewFooter('')
  }

  async function createNewTemplate() {
    if (!newSubject.trim() || !newBody.trim()) {
      setStatusError('Subject + body are required.')
      return
    }
    setSaving(true)
    setStatusError('')
    // New templates start as DRAFT (is_active=false). Admin clicks
    // Activate to make them live. Same safety as edits.
    const { error } = await supabase
      .from('proposal_templates')
      .insert([{
        segment:      newSegment,
        media_type:   newMedia,
        language:     newLanguage,
        subject_line: newSubject.trim(),
        version:      1,
        is_active:    false,
        header_html:  newHeader || null,
        body_html:    newBody,
        footer_html:  newFooter || null,
      }])
    setSaving(false)
    if (error) {
      setStatusError(`Could not create: ${error.message}`)
      return
    }
    setStatusMsg(`New template created as draft. Click Activate to make it live.`)
    setTimeout(() => setStatusMsg(''), 4000)
    setShowNew(false)
    load()
  }

  async function deleteDraft(t) {
    if (t.is_active) {
      setStatusError('Cannot delete an active template. Activate a different version first.')
      return
    }
    if (!window.confirm(`Delete v${t.version} of ${t.segment} — ${t.media_type} (${t.language})? This cannot be undone.`)) return
    setSaving(true)
    setStatusError('')
    const { error } = await supabase
      .from('proposal_templates')
      .delete()
      .eq('id', t.id)
    setSaving(false)
    if (error) {
      setStatusError(`Could not delete: ${error.message}`)
      return
    }
    setStatusMsg('Draft deleted.')
    setTimeout(() => setStatusMsg(''), 2000)
    load()
  }

  async function saveAsDraft() {
    if (!editBuf) return
    setSaving(true)
    setStatusError('')
    // Fetch the highest version for this (segment, media_type, language)
    // so we can bump cleanly even if older drafts already exist.
    const { data: hi } = await supabase
      .from('proposal_templates')
      .select('version')
      .eq('segment',     editBuf.segment)
      .eq('media_type',  editBuf.media_type)
      .eq('language',    editBuf.language)
      .order('version',  { ascending: false })
      .limit(1)
      .maybeSingle()
    const nextVersion = (hi?.version || editBuf.version || 1) + 1
    const { error } = await supabase
      .from('proposal_templates')
      .insert([{
        segment:      editBuf.segment,
        media_type:   editBuf.media_type,
        language:     editBuf.language,
        subject_line: editBuf.subject_line || 'Untitled subject',
        version:      nextVersion,
        is_active:    false,
        header_html:  editBuf.header_html || null,
        body_html:    editBuf.body_html   || '',
        footer_html:  editBuf.footer_html || null,
      }])
    setSaving(false)
    if (error) {
      setStatusError(`Could not save draft: ${error.message}`)
      return
    }
    setStatusMsg(`Saved as draft v${nextVersion}. It won't be used until you Activate it.`)
    setTimeout(() => setStatusMsg(''), 4000)
    cancelEdit()
    load()
  }

  async function activateVersion(t) {
    if (!window.confirm(`Activate v${t.version} for ${t.segment} — ${t.media_type} (${t.language})?\n\nThis will retire all other versions of this template. Existing locked proposal PDFs are NOT changed (they're snapshots).`)) return
    setSaving(true)
    setStatusError('')
    // 1. Retire every active row for the same (segment, media_type, language)
    const nowIso = new Date().toISOString()
    const { error: retireErr } = await supabase
      .from('proposal_templates')
      .update({ is_active: false, effective_to: nowIso })
      .eq('segment',    t.segment)
      .eq('media_type', t.media_type)
      .eq('language',   t.language)
      .eq('is_active',  true)
    if (retireErr) {
      setSaving(false)
      setStatusError(`Could not retire current active: ${retireErr.message}`)
      return
    }
    // 2. Activate the chosen version
    const { error: actErr } = await supabase
      .from('proposal_templates')
      .update({ is_active: true, effective_from: nowIso, effective_to: null })
      .eq('id', t.id)
    setSaving(false)
    if (actErr) {
      setStatusError(`Could not activate: ${actErr.message}`)
      return
    }
    setStatusMsg(`v${t.version} is now active for ${t.segment} — ${t.media_type}.`)
    setTimeout(() => setStatusMsg(''), 4000)
    load()
  }

  if (loading) return (
    <div style={{ padding: 30, textAlign: 'center', color: 'var(--text-muted)' }}>
      <Loader2 size={20} style={{ animation: 'spin 1s linear infinite' }} /> Loading templates…
    </div>
  )

  // Group templates by (segment, media_type, language) so all versions
  // of the same template are clustered together.
  const grouped = {}
  for (const t of tpls) {
    const k = `${t.segment}|${t.media_type}|${t.language}`
    if (!grouped[k]) grouped[k] = []
    grouped[k].push(t)
  }

  return (
    <>
      {statusMsg && (
        <div style={{ background: 'rgba(76,175,80,.1)', border: '1px solid rgba(76,175,80,.3)', borderRadius: 8, padding: '8px 12px', marginBottom: 12, fontSize: '.82rem', color: '#81c784' }}>✓ {statusMsg}</div>
      )}
      {statusError && (
        <div style={{ background: 'rgba(229,57,53,.1)', border: '1px solid rgba(229,57,53,.3)', borderRadius: 8, padding: '8px 12px', marginBottom: 12, fontSize: '.82rem', color: '#ef9a9a' }}>{statusError}</div>
      )}

      {/* Add-new toolbar */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
        <button
          type="button"
          onClick={startNew}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '6px 12px', borderRadius: 6,
            border: '1px solid var(--surface-3)',
            background: 'var(--surface-2)',
            color: 'var(--text)', fontSize: 12, fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          <Plus size={12} /> New template
        </button>
      </div>

      {/* New template form — appears at top when active */}
      {showNew && (
        <div style={{
          marginBottom: 22, padding: 16, borderRadius: 10,
          border: '1px solid #facc15',
          background: 'rgba(250,204,21,.04)',
        }}>
          <div style={{ fontWeight: 700, color: 'var(--text)', fontSize: 14, marginBottom: 12 }}>
            New template
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 10 }}>
            <select value={newSegment} onChange={e => setNewSegment(e.target.value)} className="govt-input-cell govt-input-cell--wide">
              <option value="GOVERNMENT">Government</option>
              <option value="PRIVATE">Private</option>
            </select>
            <input
              type="text"
              value={newMedia}
              onChange={e => setNewMedia(e.target.value.toUpperCase())}
              placeholder="Media type (e.g. AUTO_HOOD)"
              className="govt-input-cell govt-input-cell--wide"
            />
            <select value={newLanguage} onChange={e => setNewLanguage(e.target.value)} className="govt-input-cell govt-input-cell--wide">
              <option value="gu">Gujarati (gu)</option>
              <option value="en">English (en)</option>
            </select>
          </div>
          <input
            type="text"
            value={newSubject}
            onChange={e => setNewSubject(e.target.value)}
            placeholder="Subject line (required)"
            className="govt-input-cell govt-input-cell--wide"
            style={{ marginBottom: 10 }}
          />
          <textarea
            value={newHeader}
            onChange={e => setNewHeader(e.target.value)}
            placeholder="Header HTML (optional)"
            className="govt-input-cell govt-input-cell--wide"
            style={{ minHeight: 50, marginBottom: 10 }}
          />
          <textarea
            value={newBody}
            onChange={e => setNewBody(e.target.value)}
            placeholder="Body HTML (required)"
            className="govt-input-cell govt-input-cell--wide"
            style={{ minHeight: 240, marginBottom: 10 }}
          />
          <textarea
            value={newFooter}
            onChange={e => setNewFooter(e.target.value)}
            placeholder="Footer HTML (optional)"
            className="govt-input-cell govt-input-cell--wide"
            style={{ minHeight: 50, marginBottom: 10 }}
          />
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button
              type="button"
              onClick={cancelEdit}
              style={{
                padding: '8px 14px', borderRadius: 6,
                border: '1px solid var(--surface-3)',
                background: 'transparent', color: 'var(--text-muted)',
                fontSize: 13, fontWeight: 600, cursor: 'pointer',
              }}
            >Cancel</button>
            <button
              type="button"
              onClick={createNewTemplate}
              disabled={saving}
              style={{
                padding: '8px 14px', borderRadius: 6, border: 'none',
                background: '#facc15', color: '#0a0e1a',
                fontSize: 13, fontWeight: 700, cursor: 'pointer',
                opacity: saving ? 0.6 : 1,
              }}
            >{saving ? 'Creating…' : 'Create as draft'}</button>
          </div>
        </div>
      )}

      {Object.entries(grouped).map(([key, versions]) => {
        const [segment, media_type, language] = key.split('|')
        return (
          <div key={key} style={{ marginBottom: 22, border: '1px solid var(--surface-3)', borderRadius: 10, padding: 14 }}>
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
              marginBottom: 10,
            }}>
              <div>
                <div style={{ fontWeight: 700, color: 'var(--text)', fontSize: 14 }}>
                  {segment} — {media_type}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-subtle)' }}>
                  Language: {language} · {versions.length} version{versions.length === 1 ? '' : 's'}
                </div>
              </div>
            </div>
            <div className="govt-list" style={{ maxHeight: 'none', overflow: 'visible' }}>
              {versions.map(t => (
                <div
                  key={t.id}
                  className="govt-list__row"
                  style={{
                    gridTemplateColumns: '60px 80px 1fr 240px',
                    alignItems: 'center',
                  }}
                >
                  <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>v{t.version}</span>
                  <span style={{
                    fontSize: 10, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase',
                    padding: '2px 8px', borderRadius: 999,
                    background: t.is_active ? 'rgba(74,222,128,.15)' : 'var(--surface-2)',
                    color:      t.is_active ? '#4ade80' : 'var(--text-subtle)',
                    display: 'inline-block', textAlign: 'center',
                  }}>
                    {t.is_active ? 'active' : 'draft'}
                  </span>
                  <span style={{ color: 'var(--text-subtle)', fontSize: 11 }}>
                    {t.created_at ? new Date(t.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : ''}
                  </span>
                  <span style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                    {!t.is_active && (
                      <button
                        type="button"
                        onClick={() => activateVersion(t)}
                        disabled={saving}
                        style={{
                          padding: '4px 10px', borderRadius: 6, border: 'none',
                          background: '#4ade80', color: '#0a0e1a', fontSize: 11, fontWeight: 700,
                          cursor: 'pointer',
                        }}
                      >
                        Activate
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => startEdit(t)}
                      style={{
                        padding: '4px 10px', borderRadius: 6,
                        border: '1px solid var(--surface-3)',
                        background: 'transparent', color: 'var(--text)',
                        fontSize: 11, fontWeight: 600, cursor: 'pointer',
                      }}
                    >
                      View / Edit
                    </button>
                    {!t.is_active && (
                      <button
                        type="button"
                        onClick={() => deleteDraft(t)}
                        disabled={saving}
                        title="Delete this draft"
                        style={{
                          padding: '4px 8px', borderRadius: 6,
                          border: '1px solid rgba(248,113,113,.4)',
                          background: 'transparent', color: '#f87171',
                          cursor: 'pointer',
                        }}
                      >
                        <Trash2 size={12} />
                      </button>
                    )}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )
      })}

      {/* Editor modal — appears below the list when a template is open */}
      {editingId && editBuf && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,.7)', zIndex: 100,
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
        }}>
          <div style={{
            background: 'var(--surface-1)', border: '1px solid var(--surface-3)',
            borderRadius: 12, padding: 20, width: '100%', maxWidth: 920, maxHeight: '92vh',
            display: 'flex', flexDirection: 'column', gap: 14, overflow: 'hidden',
          }}>
            <div>
              <div style={{ fontSize: 11, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 4 }}>
                {editBuf.segment} — {editBuf.media_type} · {editBuf.language} · editing v{editBuf.version}
              </div>
              <div style={{ fontWeight: 700, color: 'var(--text)', fontSize: 16 }}>
                Edit template
              </div>
            </div>
            <div style={{
              padding: '10px 12px',
              background: 'rgba(251,191,36,.08)', border: '1px solid rgba(251,191,36,.3)',
              borderRadius: 8, color: '#fbbf24', fontSize: 12,
            }}>
              ⚠ Your changes save as a NEW DRAFT version. They don't affect any proposals
              until you click "Activate" on the new draft. Locked proposal PDFs that
              already exist are NEVER changed (snapshots).
            </div>
            <div style={{ overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12, flex: 1 }}>
              <div>
                <label style={{ display: 'block', fontSize: 11, color: 'var(--text-muted)', marginBottom: 4, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em' }}>Subject line</label>
                <input
                  type="text"
                  value={editBuf.subject_line}
                  onChange={e => setEditBuf({ ...editBuf, subject_line: e.target.value })}
                  className="govt-input-cell govt-input-cell--wide"
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 11, color: 'var(--text-muted)', marginBottom: 4, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em' }}>Header HTML (optional)</label>
                <textarea
                  value={editBuf.header_html}
                  onChange={e => setEditBuf({ ...editBuf, header_html: e.target.value })}
                  className="govt-input-cell govt-input-cell--wide"
                  style={{ minHeight: 80 }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 11, color: 'var(--text-muted)', marginBottom: 4, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em' }}>Body HTML</label>
                <textarea
                  value={editBuf.body_html}
                  onChange={e => setEditBuf({ ...editBuf, body_html: e.target.value })}
                  className="govt-input-cell govt-input-cell--wide"
                  style={{ minHeight: 320 }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 11, color: 'var(--text-muted)', marginBottom: 4, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em' }}>Footer HTML (optional)</label>
                <textarea
                  value={editBuf.footer_html}
                  onChange={e => setEditBuf({ ...editBuf, footer_html: e.target.value })}
                  className="govt-input-cell govt-input-cell--wide"
                  style={{ minHeight: 80 }}
                />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={cancelEdit}
                style={{
                  padding: '8px 14px', borderRadius: 6,
                  border: '1px solid var(--surface-3)',
                  background: 'transparent', color: 'var(--text-muted)',
                  fontSize: 13, fontWeight: 600, cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={saveAsDraft}
                disabled={saving}
                style={{
                  padding: '8px 14px', borderRadius: 6, border: 'none',
                  background: '#facc15', color: '#0a0e1a', fontSize: 13, fontWeight: 700,
                  cursor: 'pointer', opacity: saving ? 0.6 : 1,
                }}
              >
                {saving ? 'Saving…' : 'Save as new draft (v+1)'}
              </button>
            </div>
          </div>
        </div>
      )}

      <p style={{ marginTop: 14, fontSize: 12, color: 'var(--text-subtle)', maxWidth: 720 }}>
        <strong>How it works:</strong> editing a template creates a NEW draft version,
        leaving the active version untouched. Click <em>Activate</em> on a draft to
        retire the old active version and promote the draft. Any proposal PDFs already
        sent are locked snapshots — they don't change when you swap templates.
      </p>
    </>
  )
}
