// src/components/profile/ProfilePicUploader.jsx
//
// Phase 87.5 — rep profile picture uploader.
//
// Owner directive 24 May 2026:
//   "i need that they upload their profile pic"
//   Used in Phase 87.6 as the marker icon on the live field map.
//
// Behaviour:
//   • Loads current users.profile_image_url for the signed-in user.
//   • File picker → client-side resize to 512×512 max + JPEG 0.85.
//   • Uploads to user-avatars/<user_id>/<timestamp>.jpg
//   • Persists URL on users.profile_image_url for the signed-in row.
//   • Refreshes auth-store profile so the avatar shows immediately
//     in topbar + nav + map.
//
// Privacy: 512px is sharp on a 96px map marker but doesn't leak
// excessive resolution. EXIF auto-stripped by canvas re-encode.

import { useEffect, useRef, useState } from 'react'
import { Upload, Loader2, Trash2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/authStore'
import { toastError, toastSuccess } from '../v2/Toast'

const MAX_EDGE = 512

async function compressTo512(file) {
  if (!file?.type?.startsWith('image/')) return { file, compressed: false }
  try {
    const bitmap = await createImageBitmap(file)
    const ratio = Math.min(MAX_EDGE / bitmap.width, MAX_EDGE / bitmap.height, 1)
    const w = Math.round(bitmap.width * ratio)
    const h = Math.round(bitmap.height * ratio)
    const canvas = document.createElement('canvas')
    canvas.width  = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    ctx.drawImage(bitmap, 0, 0, w, h)
    bitmap.close && bitmap.close()
    const blob = await new Promise((resolve) => {
      canvas.toBlob(b => resolve(b), 'image/jpeg', 0.85)
    })
    if (!blob) return { file, compressed: false }
    return {
      file: new File([blob], 'avatar.jpg', { type: 'image/jpeg', lastModified: Date.now() }),
      compressed: true,
    }
  } catch {
    return { file, compressed: false }
  }
}

export default function ProfilePicUploader() {
  const profile      = useAuthStore(s => s.profile)
  const setProfile   = useAuthStore(s => s.setProfile)
  const fileRef      = useRef(null)
  const [url, setUrl]         = useState(profile?.profile_image_url || '')
  const [busy, setBusy]       = useState(false)
  const [err, setErr]         = useState('')

  useEffect(() => {
    setUrl(profile?.profile_image_url || '')
  }, [profile?.profile_image_url])

  async function handlePick(e) {
    const original = e.target.files?.[0]
    if (!original) return
    if (original.size > 15 * 1024 * 1024) {
      setErr('Image too large (max 15 MB).')
      return
    }
    if (!profile?.id) return
    setBusy(true)
    setErr('')
    try {
      const { file, compressed } = await compressTo512(original)
      if (!compressed && file.size > 5 * 1024 * 1024) {
        throw new Error('Could not compress (HEIC or unsupported). Convert to JPEG and retry.')
      }
      const ts   = Date.now()
      const path = `${profile.id}/${ts}.jpg`
      const { error: upErr } = await supabase.storage
        .from('user-avatars')
        .upload(path, file, {
          contentType: 'image/jpeg',
          upsert:      false,
          cacheControl: '300',
        })
      if (upErr) throw upErr
      const { data: pub } = supabase.storage.from('user-avatars').getPublicUrl(path)
      const newUrl = pub?.publicUrl
      if (!newUrl) throw new Error('Upload OK but no public URL')

      // Persist on users row + update auth store.
      const { error: updErr } = await supabase
        .from('users')
        .update({ profile_image_url: newUrl })
        .eq('id', profile.id)
      if (updErr) throw updErr

      setUrl(newUrl)
      setProfile({ ...profile, profile_image_url: newUrl })
      toastSuccess('Profile picture updated.')
    } catch (e2) {
      const msg = e2?.message || String(e2)
      setErr(msg)
      toastError(e2, msg)
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function handleRemove() {
    if (!profile?.id) return
    setBusy(true)
    setErr('')
    try {
      const { error: updErr } = await supabase
        .from('users')
        .update({ profile_image_url: null })
        .eq('id', profile.id)
      if (updErr) throw updErr
      setUrl('')
      setProfile({ ...profile, profile_image_url: null })
      toastSuccess('Profile picture removed.')
    } catch (e2) {
      toastError(e2, e2?.message || 'Could not remove')
    } finally {
      setBusy(false)
    }
  }

  const initials = (profile?.name || 'U')
    .split(/\s+/)
    .map(w => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase()

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 14,
      padding: 14,
      background:   'var(--v2-bg-1, var(--surface))',
      border:       '1px solid var(--v2-line, var(--border))',
      borderRadius: 14,
    }}>
      <div style={{
        width: 72, height: 72, flexShrink: 0,
        borderRadius: '50%',
        overflow: 'hidden',
        background: url ? 'transparent' : 'var(--v2-yellow, #FFE600)',
        color: 'var(--accent-fg, #0f172a)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontWeight: 700, fontSize: 22, letterSpacing: '0.04em',
        border: '2px solid var(--v2-yellow, #FFE600)',
      }}>
        {url
          ? <img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          : initials}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 14, fontWeight: 700, color: 'var(--v2-ink-0, var(--text))',
          marginBottom: 2,
        }}>
          {profile?.name || '—'}
        </div>
        <div style={{ fontSize: 12, color: 'var(--v2-ink-2, var(--text-muted))', marginBottom: 8 }}>
          {profile?.role}{profile?.team_role && profile.team_role !== profile.role ? ` · ${profile.team_role}` : ''}
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg"
          onChange={handlePick}
          style={{ display: 'none' }}
        />
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={busy}
            style={{
              padding: '6px 12px', fontSize: 12, fontWeight: 600,
              background: 'var(--v2-yellow, #FFE600)',
              color: 'var(--accent-fg, #0f172a)',
              border: 'none', borderRadius: 10,
              cursor: busy ? 'wait' : 'pointer',
              fontFamily: 'inherit',
              display: 'inline-flex', alignItems: 'center', gap: 6,
            }}
          >
            {busy
              ? <><Loader2 size={12} strokeWidth={1.8} /> Uploading…</>
              : <><Upload size={12} strokeWidth={1.8} /> {url ? 'Replace photo' : 'Upload photo'}</>}
          </button>
          {url && !busy && (
            <button
              type="button"
              onClick={handleRemove}
              style={{
                padding: '6px 12px', fontSize: 12, fontWeight: 600,
                background: 'transparent',
                color: 'var(--v2-ink-2, var(--text-muted))',
                border: '1px solid var(--v2-line, var(--border))',
                borderRadius: 10,
                cursor: 'pointer',
                fontFamily: 'inherit',
                display: 'inline-flex', alignItems: 'center', gap: 6,
              }}
            >
              <Trash2 size={12} strokeWidth={1.8} /> Remove
            </button>
          )}
        </div>
        {err && (
          <div style={{ fontSize: 11, color: 'var(--danger, #EF4444)', marginTop: 6 }}>
            {err}
          </div>
        )}
      </div>
    </div>
  )
}
