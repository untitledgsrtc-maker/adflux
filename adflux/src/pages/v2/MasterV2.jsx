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
  Save, ArrowLeft, FileBox, Building2, Newspaper, MessageCircle, TrendingUp,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/authStore'
import { uploadAttachment, getSignedUrl, slugifyLabel } from '../../utils/proposalPdf'

const TABS = [
  { key: 'attachments', label: 'Attachments', icon: Paperclip },
  { key: 'companies',   label: 'Companies',   icon: Building2 },
  { key: 'signers',     label: 'Signers',     icon: UserCheck },
  { key: 'media',       label: 'Media',       icon: Tv },
  // Phase 15 — admin-managed list of "Other Media" types (newspaper,
  // hoarding, cinema, etc.). Feeds the dropdown on the Other Media
  // wizard and supplies HSN/SAC + CGST/SGST defaults to the PDF.
  { key: 'media_types', label: 'Media Types', icon: Newspaper },
  // Phase 33D.5 — WhatsApp message templates per stage + post-action
  // triggers. Edited inline so admin can tweak wording without code.
  { key: 'templates',   label: 'Messages',    icon: MessageCircle },
  // Phase 33E — performance score + variable salary (70/30 split).
  { key: 'performance', label: 'Performance', icon: TrendingUp },
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
                background: activeTab === t.key ? 'var(--accent, #FFE600)' : 'transparent',
                color:      activeTab === t.key ? 'var(--accent-fg, #0f172a)' : 'var(--text-muted)',
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
      {activeTab === 'media_types' && <MediaTypesTab />}
      {activeTab === 'templates'   && <MessageTemplatesTab />}
      {activeTab === 'performance' && <PerformanceTab />}
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
    // Phase 11l — diagnostic logging. Owner reported "Attachments
    // already attached but not showing". Most often this is a
    // segment/media_type tab confusion (uploaded for AUTO_HOOD but
    // looking at GSRTC_LED, or vice versa). Log how many rows have
    // default_file_url so the gap is obvious in DevTools.
    const withDefault = (data || []).filter(r => r.default_file_url)
    console.log('[master-attachments] load', {
      filter,
      total_rows: (data || []).length,
      with_default_file: withDefault.length,
      labels: (data || []).map(r => ({
        label:    r.label,
        has_file: !!r.default_file_url,
        path:     r.default_file_url,
      })),
    })
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
                background: active ? 'var(--accent, #FFE600)' : 'transparent',
                color:      active ? 'var(--accent-fg, #0f172a)' : 'var(--text-muted)',
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
                {/* Phase 21b — show the visible row position (1, 2, 3 …)
                    not the raw display_order. Rows can have gaps in
                    display_order after a delete (e.g. 1, 2, 3, 5, 6, 7,
                    9), and rendering the raw value made it look like
                    rows were missing. Index-based numbering is what
                    reps expect. */}
                <span style={{ color: 'var(--text-subtle)', fontSize: 12 }}>
                  {idx + 1}
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
  // Phase 11l — read the logged-in admin profile so we can hide the
  // self-row's Remove button (admin can't accidentally remove
  // themselves and lose signing access).
  const profile = useAuthStore(s => s.profile)
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

  // Phase 11l — owner request: be able to remove a signer entry
  // (e.g. agency partner who shouldn't be a signing authority). We
  // clear the signature fields and demote the role to 'sales' so the
  // signers query (filtered by role IN admin/co_owner/agency) drops
  // them. Original quotes that referenced this user as signer keep
  // working — their signer_user_id snapshot is unchanged.
  async function handleRemoveSigner(id) {
    const u = users.find(x => x.id === id)
    if (!u) return
    if (!confirm(
      `Remove ${u.name} as a signer?\n\n` +
      `Their signature title and mobile will be cleared, and their role ` +
      `will be set to 'sales' so they no longer appear in the signer ` +
      `dropdown. Existing proposals already signed by them are NOT affected.`
    )) return
    setSavingId(id)
    setStatusError('')
    const { error } = await supabase
      .from('users')
      .update({
        signature_title:  null,
        signature_mobile: null,
        role:             'sales',
      })
      .eq('id', id)
    setSavingId(null)
    if (error) {
      setStatusError(`Could not remove signer: ${error.message}`)
      return
    }
    setStatusMsg(`${u.name} removed as signer.`)
    setTimeout(() => setStatusMsg(''), 2500)
    load()
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
                background: 'var(--accent, #FFE600)', color: 'var(--accent-fg, #0f172a)', fontSize: 12, fontWeight: 700,
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
              <span style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, alignItems: 'center' }}>
                {savingId === u.id && (
                  <Loader2 size={14} style={{ color: 'var(--text-muted)', animation: 'spin 1s linear infinite' }} />
                )}
                {/* Phase 11l — Remove signer button. Hidden for the
                    self-row (admin can't unsign themselves from Master)
                    and disabled while a save is in flight. */}
                {profile?.id !== u.id && (
                  <button
                    type="button"
                    onClick={() => handleRemoveSigner(u.id)}
                    disabled={savingId === u.id}
                    title="Remove this user as a signer"
                    style={{
                      padding: '4px 6px',
                      borderRadius: 4,
                      border: '1px solid rgba(229,57,53,.3)',
                      background: 'transparent',
                      color: '#ef9a9a',
                      cursor: savingId === u.id ? 'wait' : 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      opacity: savingId === u.id ? 0.5 : 1,
                    }}
                  >
                    <Trash2 size={12} />
                  </button>
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
                  background: 'var(--accent, #FFE600)', color: 'var(--accent-fg, #0f172a)',
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
          border: '1px solid var(--accent, #FFE600)',
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
                background: 'var(--accent, #FFE600)', color: 'var(--accent-fg, #0f172a)',
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
                          background: '#4ade80', color: 'var(--accent-fg, #0f172a)', fontSize: 11, fontWeight: 700,
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
                  background: 'var(--accent, #FFE600)', color: 'var(--accent-fg, #0f172a)', fontSize: 13, fontWeight: 700,
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

/* ════════════════════════════════════════════════════════════════════
   MEDIA TYPES TAB — Phase 15 rev2. Admin-managed list of "Other Media"
   labels (Newspaper, Hoarding, Cinema, …). Just a name + display order
   + active flag — no per-row HSN/SAC or CGST/SGST. Tax on Other Media
   quotes is a single GST 18% applied at quote level (matches the
   existing Private LED quote PDF format). The HSN/CGST/SGST columns
   on the table are kept (idempotent) but no longer surfaced or used.
   ════════════════════════════════════════════════════════════════════ */

/* ─────────────────────────────────────────────────────────────────
   MESSAGE TEMPLATES TAB (Phase 33D.5)

   8 active templates — 6 stage-based (New / Working / QuoteSent /
   Nurture / Won / Lost) and 2 action-based (post_meeting /
   post_call). Admin can edit the body inline. Placeholders:
     {name}, {company}, {rep}, {city}, {media}
   ───────────────────────────────────────────────────────────────── */

const TEMPLATE_STAGES = [
  { key: 'post_meeting', label: 'After meeting',   desc: 'Sent when a meeting is saved' },
  { key: 'post_call',    label: 'After call',      desc: 'Sent when a call is logged' },
  { key: 'New',          label: 'New lead',        desc: 'First contact intro' },
  { key: 'Working',      label: 'Follow-up',       desc: 'After first meeting, before quote' },
  { key: 'QuoteSent',    label: 'Quote chase',     desc: 'Pushing the proposal' },
  { key: 'Nurture',      label: 'Nurture revisit', desc: 'Reactivate parked lead' },
  { key: 'Won',          label: 'Thank-you (Won)', desc: 'Post-deal close' },
  { key: 'Lost',         label: 'Door open (Lost)', desc: 'Polite re-engagement' },
]

/* ─────────────────────────────────────────────────────────────────
   PERFORMANCE TAB (Phase 33E)
   Per-rep monthly score + variable salary calculator. Admin can also
   trigger a backfill of the last 30 days for any rep (useful first
   time after running the SQL — daily_performance starts empty).
   ───────────────────────────────────────────────────────────────── */
function PerformanceTab() {
  const [reps, setReps] = useState([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState(null)

  async function load() {
    setLoading(true)
    const { data: users } = await supabase
      .from('users')
      .select('id, name, team_role, is_active, segment_access')
      .in('team_role', ['sales', 'agency'])
      .eq('is_active', true)
      .order('name')
    // For each user, call monthly_score for this month.
    const monthStart = new Date()
    monthStart.setDate(1)
    const ms = monthStart.toISOString().slice(0, 10)
    const rows = []
    for (const u of (users || [])) {
      const { data: s } = await supabase
        .rpc('monthly_score', { p_user_id: u.id, p_month_start: ms })
      rows.push({ user: u, score: Array.isArray(s) && s.length > 0 ? s[0] : null })
    }
    setReps(rows)
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  async function backfill(uid) {
    setBusyId(uid)
    await supabase.rpc('backfill_performance', { p_user_id: uid })
    setBusyId(null)
    load()
  }

  if (loading) {
    return (
      <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)' }}>
        <Loader2 size={20} style={{ animation: 'spin 1s linear infinite' }} /> Loading scores…
      </div>
    )
  }

  const fmt = (n) => '₹' + new Intl.NumberFormat('en-IN').format(Math.round(Number(n) || 0))

  return (
    <div style={{ padding: '0 4px' }}>
      <div style={{
        padding: '12px 14px', marginBottom: 14,
        background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 10, fontSize: 12, color: 'var(--text-muted)',
      }}>
        Monthly score = average % of daily meeting target hit. Sundays / holidays / leaves
        excluded. Below <b>50%</b> → variable = ₹0. At/above 50% → variable scales linearly.
        Base = 70% of total comp · Variable cap = 30%.
      </div>
      <div style={{ overflow: 'auto' }}>
        <table className="lead-table" style={{ width: '100%' }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left' }}>Rep</th>
              <th style={{ textAlign: 'right' }}>Score</th>
              <th style={{ textAlign: 'right' }}>Days</th>
              <th style={{ textAlign: 'right' }}>Base</th>
              <th style={{ textAlign: 'right' }}>Variable</th>
              <th style={{ textAlign: 'right' }}>Total</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {reps.map(r => {
              const s = r.score
              const pct = Number(s?.avg_score_pct || 0)
              const isLow = pct < 50
              return (
                <tr key={r.user.id}>
                  <td>{r.user.name}</td>
                  <td style={{ textAlign: 'right', color: isLow ? 'var(--danger)' : 'var(--text)' }}>
                    <b>{s ? `${pct.toFixed(0)}%` : '—'}</b>
                  </td>
                  <td style={{ textAlign: 'right', color: 'var(--text-muted)' }} className="mono">
                    {s?.working_days || 0}
                  </td>
                  <td style={{ textAlign: 'right' }} className="mono">{fmt(s?.base_amount)}</td>
                  <td style={{ textAlign: 'right', color: isLow ? 'var(--danger)' : 'var(--text)' }} className="mono">
                    {fmt(s?.variable_earned)} / {fmt(s?.variable_cap)}
                  </td>
                  <td style={{ textAlign: 'right', fontWeight: 700 }} className="mono">{fmt(s?.total_payable)}</td>
                  <td>
                    <button
                      className="lead-btn lead-btn-sm"
                      onClick={() => backfill(r.user.id)}
                      disabled={busyId === r.user.id}
                    >
                      {busyId === r.user.id
                        ? <Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} />
                        : 'Backfill 30d'}
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function MessageTemplatesTab() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState(null)
  const [status, setStatus] = useState({})  // { [id]: 'saved' | 'err msg' }

  async function load() {
    setLoading(true)
    const { data, error } = await supabase
      .from('message_templates')
      .select('*')
      .order('stage')
      .order('display_order')
    if (!error) setRows(data || [])
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  async function saveBody(row, newBody) {
    setSavingId(row.id)
    setStatus(s => ({ ...s, [row.id]: '' }))
    const { error } = await supabase
      .from('message_templates')
      .update({ body: newBody })
      .eq('id', row.id)
    setSavingId(null)
    if (error) setStatus(s => ({ ...s, [row.id]: error.message }))
    else {
      setStatus(s => ({ ...s, [row.id]: 'saved' }))
      setTimeout(() => setStatus(s => ({ ...s, [row.id]: '' })), 1800)
    }
  }

  async function toggleActive(row) {
    await supabase.from('message_templates').update({ is_active: !row.is_active }).eq('id', row.id)
    load()
  }

  if (loading) {
    return (
      <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)' }}>
        <Loader2 size={20} style={{ animation: 'spin 1s linear infinite' }} /> Loading templates…
      </div>
    )
  }

  return (
    <div style={{ padding: '0 4px' }}>
      <div style={{
        padding: '12px 14px', marginBottom: 14,
        background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 10, fontSize: 12, color: 'var(--text-muted)',
      }}>
        WhatsApp messages sent to clients. Edit the body and click <b>Save</b>. Placeholders
        — <code>{'{name}'}</code>, <code>{'{company}'}</code>, <code>{'{rep}'}</code>,
        <code>{'{city}'}</code>, <code>{'{media}'}</code> — fill in at send time.
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {TEMPLATE_STAGES.map(s => {
          const row = rows.find(r => r.stage === s.key)
          if (!row) {
            return (
              <div key={s.key} className="lead-card lead-card-pad" style={{ fontSize: 13, color: 'var(--danger)' }}>
                Missing template for <b>{s.label}</b>. Run supabase_phase33d5_action_templates.sql.
              </div>
            )
          }
          return (
            <TemplateEditor
              key={row.id}
              row={row}
              stageMeta={s}
              busy={savingId === row.id}
              status={status[row.id]}
              onSave={(body) => saveBody(row, body)}
              onToggleActive={() => toggleActive(row)}
            />
          )
        })}
      </div>
    </div>
  )
}

function TemplateEditor({ row, stageMeta, busy, status, onSave, onToggleActive }) {
  const [body, setBody] = useState(row.body || '')
  const dirty = body !== (row.body || '')
  return (
    <div className="lead-card" style={{ padding: 14 }}>
      <div style={{
        display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
        gap: 10, marginBottom: 6,
      }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>
            {stageMeta.label}
            {!row.is_active && (
              <span style={{
                marginLeft: 8, fontSize: 10, fontWeight: 600,
                color: 'var(--text-muted)', border: '1px solid var(--border-strong)',
                padding: '2px 6px', borderRadius: 4,
              }}>OFF</span>
            )}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
            {stageMeta.desc} · <span className="mono">stage = {row.stage}</span>
          </div>
        </div>
        <button className="lead-btn lead-btn-sm" onClick={onToggleActive}>
          {row.is_active ? 'Disable' : 'Enable'}
        </button>
      </div>
      <textarea
        className="lead-inp"
        rows={8}
        value={body}
        onChange={e => setBody(e.target.value)}
        style={{ fontFamily: 'inherit', fontSize: 13, lineHeight: 1.5 }}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
        <button
          className="lead-btn lead-btn-primary lead-btn-sm"
          onClick={() => onSave(body)}
          disabled={busy || !dirty}
        >
          {busy
            ? <><Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} /> Saving…</>
            : <><Save size={11} /> Save</>}
        </button>
        {dirty && !busy && (
          <button
            className="lead-btn lead-btn-sm"
            onClick={() => setBody(row.body || '')}
            style={{ color: 'var(--text-muted)' }}
          >
            Revert
          </button>
        )}
        {status === 'saved' && (
          <span style={{ fontSize: 11, color: 'var(--success)' }}>✓ Saved</span>
        )}
        {status && status !== 'saved' && (
          <span style={{ fontSize: 11, color: 'var(--danger)' }}>{status}</span>
        )}
      </div>
    </div>
  )
}

function MediaTypesTab() {
  const [rows, setRows]     = useState([])
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState(null)
  const [statusMsg, setStatusMsg] = useState('')
  const [statusError, setStatusError] = useState('')
  // New-row buffer — name only.
  const [newName, setNewName] = useState('')
  const [adding, setAdding]   = useState(false)

  const load = async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('media_types')
      .select('*')
      .order('display_order', { ascending: true })
      .order('name',          { ascending: true })
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
    const payload = {
      name:          (r.name || '').trim() || 'Untitled',
      notes:         (r.notes || '').trim() || null,
      is_active:     !!r.is_active,
      display_order: Number(r.display_order) || 0,
    }
    const { error } = await supabase
      .from('media_types')
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

  async function handleAdd() {
    const name = newName.trim()
    if (!name) {
      setStatusError('Name is required.')
      return
    }
    setAdding(true)
    setStatusError('')
    const nextOrder = (rows.reduce((m, r) => Math.max(m, r.display_order || 0), 0)) + 10
    const { data, error } = await supabase
      .from('media_types')
      .insert([{
        name,
        is_active:     true,
        display_order: nextOrder,
      }])
      .select()
      .single()
    setAdding(false)
    if (error) {
      setStatusError(`Could not add: ${error.message}`)
      return
    }
    setRows(prev => [...prev, data])
    setNewName('')
    setStatusMsg(`Added "${name}".`)
    setTimeout(() => setStatusMsg(''), 2000)
  }

  async function handleDelete(r) {
    if (!window.confirm(`Delete media type "${r.name}"? Existing quote lines that reference it by name are not affected.`)) return
    setSavingId(r.id)
    const { error } = await supabase
      .from('media_types')
      .delete()
      .eq('id', r.id)
    setSavingId(null)
    if (error) {
      setStatusError(`Delete failed: ${error.message}`)
      return
    }
    setRows(prev => prev.filter(x => x.id !== r.id))
    setStatusMsg('Deleted.')
    setTimeout(() => setStatusMsg(''), 2000)
  }

  if (loading) return (
    <div style={{ padding: 30, textAlign: 'center', color: 'var(--text-muted)' }}>
      <Loader2 size={20} style={{ animation: 'spin 1s linear infinite' }} /> Loading media types…
    </div>
  )

  return (
    <>
      {statusMsg && (
        <div style={{ background: 'var(--success-soft)', border: '1px solid var(--success)', borderRadius: 8, padding: '8px 12px', marginBottom: 12, fontSize: '.82rem', color: 'var(--success)' }}>✓ {statusMsg}</div>
      )}
      {statusError && (
        <div style={{ background: 'var(--danger-soft)', border: '1px solid var(--danger)', borderRadius: 8, padding: '8px 12px', marginBottom: 12, fontSize: '.82rem', color: 'var(--danger)' }}>{statusError}</div>
      )}

      {/* Add row — name only. */}
      <div style={{
        padding: 14, borderRadius: 12,
        border: '1px solid var(--border)',
        background: 'var(--surface)',
        marginBottom: 16,
        display: 'grid',
        gridTemplateColumns: '1fr auto',
        gap: 10, alignItems: 'end',
      }}>
        <FieldBlock label="Media name *">
          <input
            type="text"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleAdd() }}
            placeholder="e.g. Pamphlet Distribution"
            className="govt-input-cell govt-input-cell--wide"
          />
        </FieldBlock>
        <button
          type="button"
          onClick={handleAdd}
          disabled={adding}
          style={{
            padding: '8px 14px', borderRadius: 8, border: 'none',
            background: 'var(--accent)', color: 'var(--accent-fg)',
            fontSize: 13, fontWeight: 700, cursor: 'pointer',
            display: 'inline-flex', alignItems: 'center', gap: 6,
            opacity: adding ? 0.6 : 1,
          }}
        >
          {adding ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Plus size={14} />}
          Add
        </button>
      </div>

      {/* Existing rows */}
      {rows.length === 0 ? (
        <div style={{
          padding: 30, textAlign: 'center', color: 'var(--text-muted)',
          border: '1px dashed var(--surface-3)', borderRadius: 12,
        }}>
          <Newspaper size={28} style={{ marginBottom: 8, color: 'var(--text-subtle)' }} />
          <div style={{ fontWeight: 600, color: 'var(--text)' }}>No media types yet</div>
          <div style={{ fontSize: 13, marginTop: 6 }}>
            Add the first one above. Reps will see it in the Other Media wizard dropdown.
          </div>
        </div>
      ) : (
        <div style={{
          border: '1px solid var(--surface-3)', borderRadius: 12,
          overflow: 'hidden',
        }}>
          <div style={{
            display: 'grid',
            gridTemplateColumns: '1fr 0.5fr 0.5fr 60px',
            gap: 0,
            background: 'var(--surface-2)',
            fontSize: 10, fontWeight: 700,
            color: 'var(--text-subtle)',
            textTransform: 'uppercase', letterSpacing: '.06em',
            borderBottom: '1px solid var(--surface-3)',
          }}>
            <div style={{ padding: '10px 12px' }}>Name</div>
            <div style={{ padding: '10px 12px', textAlign: 'right' }}>Order</div>
            <div style={{ padding: '10px 12px', textAlign: 'center' }}>Active</div>
            <div style={{ padding: '10px 12px' }}></div>
          </div>
          {rows.map(r => (
            <div
              key={r.id}
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 0.5fr 0.5fr 60px',
                gap: 0,
                borderBottom: '1px solid var(--surface-3)',
                background: 'var(--surface-1)',
                alignItems: 'center',
              }}
            >
              <div style={{ padding: '6px 8px' }}>
                <input
                  type="text"
                  value={r.name ?? ''}
                  onChange={e => setField(r.id, 'name', e.target.value)}
                  onBlur={() => persist(r.id)}
                  className="govt-input-cell govt-input-cell--wide"
                />
              </div>
              <div style={{ padding: '6px 8px' }}>
                <input
                  type="number"
                  min="0"
                  value={r.display_order ?? 0}
                  onChange={e => setField(r.id, 'display_order', e.target.value)}
                  onBlur={() => persist(r.id)}
                  className="govt-input-cell govt-input-cell--wide"
                  style={{ textAlign: 'right' }}
                />
              </div>
              <div style={{ padding: '6px 8px', textAlign: 'center' }}>
                <input
                  type="checkbox"
                  checked={!!r.is_active}
                  onChange={e => {
                    setField(r.id, 'is_active', e.target.checked)
                    setTimeout(() => persist(r.id), 0)
                  }}
                />
              </div>
              <div style={{ padding: '6px 8px', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 6 }}>
                {savingId === r.id ? (
                  <Loader2 size={14} style={{ color: 'var(--text-muted)', animation: 'spin 1s linear infinite' }} />
                ) : (
                  <button
                    type="button"
                    onClick={() => handleDelete(r)}
                    style={{
                      background: 'transparent', border: 'none',
                      color: 'var(--danger)', cursor: 'pointer',
                      padding: 4, display: 'inline-flex', alignItems: 'center',
                    }}
                    title={`Delete "${r.name}"`}
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <p style={{ marginTop: 14, fontSize: 12, color: 'var(--text-subtle)', maxWidth: 720 }}>
        <strong>How it works:</strong> these rows feed the media dropdown on
        the Other Media quote wizard. Reps can still type a one-off name
        when creating a quote (free-text fallback), but the rows here are
        the canonical list. GST is fixed at 18% across all Other Media
        quotes — there are no per-media tax overrides.
      </p>
    </>
  )
}

/* Small helper used only by MediaTypesTab's add-row form. */
function FieldBlock({ label, children }) {
  return (
    <div>
      <label style={{
        display: 'block', fontSize: 10, fontWeight: 700,
        color: 'var(--text-subtle)', textTransform: 'uppercase',
        letterSpacing: '.06em', marginBottom: 4,
      }}>{label}</label>
      {children}
    </div>
  )
}
