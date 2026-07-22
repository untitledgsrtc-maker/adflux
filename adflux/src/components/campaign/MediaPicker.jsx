// src/components/campaign/MediaPicker.jsx
//
// Reusable "attach media" control for the campaign pages. Instead of uploading
// the same file every time, it opens a LIBRARY: pick an already-uploaded media,
// OR upload a new one (which is added to the library for next time). Files live
// in the existing `campaign-media` storage bucket; the `campaign_media` table is
// the index the grid lists. Self-contained — the caller just passes onSelect.

import { useState, useEffect, useCallback } from 'react'
import { X, Upload, ImagePlus, FileText, Film } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { toastError } from '../v2/Toast'
import { useAuthStore } from '../../store/authStore'

function typeOf(file) {
  const t = (file?.type || '').toLowerCase()
  if (t.startsWith('image/')) return 'image'
  if (t.startsWith('video/')) return 'video'
  return 'document'
}

export default function MediaPicker({
  accept = 'image/*,video/*,application/pdf',
  onSelect,
  triggerLabel = 'Attach media',
  // Phase 254.1 — optional grid filter ('image' | 'video' | 'document') so a
  // dedicated Video button lists only videos. Default = all (existing callers
  // unchanged).
  filterType = null,
}) {
  const profile = useAuthStore((s) => s.profile)
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState([])
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    let q = supabase
      .from('campaign_media')
      .select('id, url, media_type, name, created_at')
      .order('created_at', { ascending: false })
      .limit(200)
    if (filterType) q = q.eq('media_type', filterType)
    const { data, error } = await q
    if (!error) setItems(data || [])
  }, [filterType])
  useEffect(() => { if (open) load() }, [open, load])

  function pick(url, type, name) {
    onSelect?.(url, type || null, name || null)
    setOpen(false)
  }

  async function handleUpload(file) {
    if (!file) return
    setBusy(true)
    try {
      const ext = ((file.name.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '')) || 'bin'
      const path = `lib-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
      const { error: upErr } = await supabase.storage.from('campaign-media')
        .upload(path, file, { upsert: false, contentType: file.type || undefined })
      if (upErr) throw upErr
      const url = supabase.storage.from('campaign-media').getPublicUrl(path).data.publicUrl
      const type = typeOf(file)
      // Add to the library (ignore a dup-url conflict — same file re-picked).
      await supabase.from('campaign_media')
        .insert({ url, media_type: type, name: file.name || null, uploaded_by: profile?.id || null })
      pick(url, type, file.name || null)
    } catch (e) {
      toastError(e, 'Upload failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} style={triggerBtn}>
        <ImagePlus size={14} strokeWidth={1.7} /> {triggerLabel}
      </button>

      {open && (
        <div style={overlay} onClick={() => !busy && setOpen(false)}>
          <div style={modalBox} onClick={(e) => e.stopPropagation()}>
            <div style={head}>
              <span style={{ fontFamily: 'var(--v2-display)', fontWeight: 600, color: 'var(--v2-ink-0, #f5f7fb)', fontSize: 15 }}>
                Media library
              </span>
              <button type="button" onClick={() => !busy && setOpen(false)} style={xBtn}><X size={18} strokeWidth={1.6} /></button>
            </div>

            <div style={{ padding: 16 }}>
              <label style={{ ...uploadBtn, opacity: busy ? 0.6 : 1 }}>
                {busy ? 'Uploading…' : <><Upload size={15} strokeWidth={1.7} /> Upload new</>}
                <input type="file" accept={accept} disabled={busy} style={{ display: 'none' }}
                  onChange={(e) => handleUpload(e.target.files?.[0])} />
              </label>

              {items.length === 0 ? (
                <div style={{ color: 'var(--v2-ink-2, #6a7590)', fontSize: 13, padding: '18px 0' }}>
                  No media yet — upload one above and it&rsquo;ll be reusable next time.
                </div>
              ) : (
                <div style={grid}>
                  {items.map((it) => (
                    <button key={it.id} type="button" onClick={() => pick(it.url, it.media_type, it.name)} style={tile} title={it.name || it.url}>
                      {it.media_type === 'image' ? (
                        <img src={it.url} alt="" style={{ width: '100%', height: 78, objectFit: 'cover', borderRadius: 8, display: 'block' }} />
                      ) : (
                        <div style={tilePh}>
                          {it.media_type === 'video' ? <Film size={20} strokeWidth={1.6} /> : <FileText size={20} strokeWidth={1.6} />}
                        </div>
                      )}
                      <div style={tileName}>{it.name || it.media_type || 'file'}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}

const triggerBtn = { display: 'inline-flex', alignItems: 'center', gap: 6, background: 'var(--v2-bg-2, #1a2742)', color: 'var(--v2-ink-1, #a9b3c7)', border: '1px solid var(--v2-line, #1f2b47)', borderRadius: 10, height: 34, padding: '0 12px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }
const overlay = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)', zIndex: 9000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '60px 16px', overflowY: 'auto' }
const modalBox = { width: '100%', maxWidth: 560, background: 'var(--v2-bg-1, #0f1525)', border: '1px solid var(--v2-line, #1f2b47)', borderRadius: 14, boxShadow: '0 24px 60px rgba(0,0,0,.5)' }
const head = { padding: '14px 18px', borderBottom: '1px solid var(--v2-line, #1f2b47)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }
const xBtn = { background: 'none', border: 'none', cursor: 'pointer', color: 'var(--v2-ink-2)', display: 'flex' }
const uploadBtn = { display: 'inline-flex', alignItems: 'center', gap: 7, background: 'var(--v2-yellow, #FFE600)', color: 'var(--accent-fg, #0b1220)', border: 'none', borderRadius: 10, height: 38, padding: '0 16px', fontWeight: 700, fontSize: 14, cursor: 'pointer', marginBottom: 14 }
const grid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: 10 }
const tile = { background: 'var(--v2-bg-2, #1a2742)', border: '1px solid var(--v2-line, #1f2b47)', borderRadius: 10, padding: 6, cursor: 'pointer', textAlign: 'left' }
const tilePh = { width: '100%', height: 78, borderRadius: 8, background: 'var(--v2-bg-0, #0a0f1c)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--v2-ink-2, #6a7590)' }
const tileName = { fontSize: 11, color: 'var(--v2-ink-2, #6a7590)', marginTop: 5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }
