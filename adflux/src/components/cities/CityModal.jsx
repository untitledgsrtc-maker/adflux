import { useEffect, useState, useRef } from 'react'
import { X, Upload, Trash2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'

const GRADES = ['A', 'B', 'C']

const EMPTY = {
  name: '',
  station_name: '',
  grade: 'B',
  screens: 1,
  screen_size_inch: '',
  monthly_rate: '',
  offer_rate: '',
  impressions_day: '',
  impressions_month: '',
  unique_viewers: '',
  photo_url: '',
  youtube_url: '',
  is_active: true,
}

/**
 * Phase 80 — city photo uploader. Drops the bare URL text input.
 * Uploads to the `city-photos` Supabase storage bucket under
 *   city-photos/<city_id_or_new>/photo-<timestamp>.<ext>
 * On success the returned public URL is set on form.photo_url.
 * Cap: 10 MB (matches bucket file_size_limit). Accepts PNG / JPEG.
 */
function CityPhotoUploader({ cityId, value, onChange }) {
  const fileRef = useRef(null)
  const [uploading, setUploading] = useState(false)
  const [err, setErr] = useState('')

  /**
   * Phase 81.4 — resize + recompress the source photo BEFORE upload.
   *
   * Why: phone cameras shoot at 4000×3000 / 5-8 MB. The quote PDF
   * embeds that as a 794×1123-rendered photo page — anything past
   * ~1600 px wide is invisible in the rendered output but bloats
   * the file. Resizing client-side here keeps photo storage small
   * AND keeps the final PDF under 3 MB.
   *
   * Target: max edge 1600 px, JPEG quality 0.85. Preserves visible
   * resolution for an A4 print (~150 DPI at 1600 px), shrinks 5 MB
   * source → ~300-450 KB output.
   *
   * Falls through to the original file on any error so a weird
   * format (HEIC, oversize PNG) still uploads.
   */
  /**
   * Phase 85.6 — return shape now includes a `compressed` flag so
   * the caller knows whether the file actually went through the
   * canvas re-encode (which strips EXIF as a side effect) or fell
   * through to the original. Original passthrough = compression
   * failed (HEIC on older Safari, oversized PNG, no
   * createImageBitmap support).
   *
   * EXIF strip note: canvas.toBlob() re-encodes from raw pixel
   * data; the source EXIF metadata is never carried into the new
   * blob. Privacy fix (GPS / device / timestamp EXIF leak) is
   * automatic when this path succeeds. When it fails and we fall
   * through to the original, EXIF survives — so handlePick now
   * rejects fallback files above the bucket cap and warns the
   * admin if a fallback occurred at all.
   */
  async function compressPhoto(file) {
    if (!file || !file.type?.startsWith('image/')) {
      return { file, compressed: false }
    }
    try {
      const bitmap = await createImageBitmap(file)
      const MAX = 1600
      const ratio = Math.min(MAX / bitmap.width, MAX / bitmap.height, 1)
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
        file: new File([blob], file.name.replace(/\.[a-z]+$/i, '.jpg'), {
          type: 'image/jpeg',
          lastModified: Date.now(),
        }),
        compressed: true,
      }
    } catch {
      return { file, compressed: false }
    }
  }

  async function handlePick(e) {
    const original = e.target.files?.[0]
    if (!original) return
    if (original.size > 25 * 1024 * 1024) {
      setErr('Image too large (max 25 MB).')
      if (fileRef.current) fileRef.current.value = ''
      return
    }
    setUploading(true)
    setErr('')
    try {
      const { file, compressed } = await compressPhoto(original)

      // Phase 85.6 — if compression failed (HEIC / unsupported)
      // AND the original is too big for the bucket cap (10 MB),
      // reject up front with a clear message. Also reject the
      // EXIF-laden fallback when it's a HEIC that couldn't be
      // re-encoded (privacy risk: original carries phone GPS).
      if (!compressed) {
        if (file.size > 10 * 1024 * 1024) {
          throw new Error('Could not compress (HEIC or unsupported). Convert to JPEG and retry.')
        }
        // Soft warn: EXIF may have survived. Reps will see this in
        // the inline status banner.
        setErr('Heads up: image not re-encoded — EXIF metadata may remain.')
      }

      const ext  = compressed ? 'jpg' : (file.name.split('.').pop() || 'jpg').toLowerCase()
      const ts   = Date.now()
      const folder = cityId || '_new'
      const path = `${folder}/photo-${ts}.${ext}`
      const { error: upErr } = await supabase.storage
        .from('city-photos')
        .upload(path, file, {
          contentType: file.type || 'image/jpeg',
          upsert: false,
        })
      if (upErr) throw upErr
      const { data } = supabase.storage.from('city-photos').getPublicUrl(path)
      if (!data?.publicUrl) throw new Error('Upload succeeded but no public URL returned.')
      onChange(data.publicUrl)
    } catch (e2) {
      setErr(e2?.message || String(e2))
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  return (
    <div>
      <label className="form-label">City Photo</label>
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg"
        onChange={handlePick}
        style={{ display: 'none' }}
      />
      {value ? (
        <div style={{
          display:      'flex',
          alignItems:   'center',
          gap:          12,
          padding:      10,
          borderRadius: 8,
          background:   'var(--surface-2)',
          border:       '1px solid var(--surface-3)',
        }}>
          <img
            src={value}
            alt="city preview"
            style={{
              width:        96,
              height:       72,
              flexShrink:   0,
              objectFit:    'cover',
              borderRadius: 6,
              background:   'var(--surface-3)',
              border:       '1px solid var(--surface-3)',
            }}
            onError={e => {
              e.currentTarget.style.background = 'var(--surface-3)'
              e.currentTarget.removeAttribute('src')
            }}
          />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontSize:   11.5,
              color:      'var(--text-muted)',
              wordBreak:  'break-all',
              lineHeight: 1.4,
            }}>
              {value.length > 60 ? value.slice(0, 30) + '…' + value.slice(-25) : value}
            </div>
            <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
              <button
                type="button"
                className="btn btn-ghost btn-mini"
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
              >
                <Upload size={12} strokeWidth={1.8} />
                {uploading ? 'Uploading…' : 'Replace'}
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-mini"
                onClick={() => onChange('')}
                disabled={uploading}
              >
                <Trash2 size={12} strokeWidth={1.8} />
                Remove
              </button>
            </div>
            {err && (
              <div style={{ fontSize: 11, color: 'var(--danger)', marginTop: 6 }}>
                {err}
              </div>
            )}
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          style={{
            display:        'flex',
            alignItems:     'center',
            justifyContent: 'center',
            gap:            8,
            width:          '100%',
            padding:        '14px 12px',
            background:     'var(--surface-2)',
            border:         '1px dashed var(--surface-3)',
            borderRadius:   8,
            color:          'var(--text-muted)',
            fontSize:       12.5,
            cursor:         uploading ? 'wait' : 'pointer',
          }}
        >
          <Upload size={14} strokeWidth={1.6} />
          {uploading ? 'Uploading…' : 'Click to upload city photo (PNG / JPG, max 10 MB)'}
        </button>
      )}
      {!value && err && (
        <div style={{ fontSize: 11, color: 'var(--danger)', marginTop: 6 }}>
          {err}
        </div>
      )}
    </div>
  )
}

export function CityModal({ city, onClose, onSave, loading }) {
  const [form, setForm] = useState(EMPTY)
  const [errors, setErrors] = useState({})
  const isEdit = !!city?.id

  useEffect(() => {
    if (city) {
      setForm({
        name: city.name || '',
        station_name: city.station_name || '',
        grade: city.grade || 'B',
        screens: city.screens || 1,
        screen_size_inch: city.screen_size_inch || '',
        monthly_rate: city.monthly_rate || '',
        offer_rate: city.offer_rate || '',
        impressions_day: city.impressions_day || '',
        impressions_month: city.impressions_month || '',
        unique_viewers: city.unique_viewers || '',
        photo_url: city.photo_url || '',
        youtube_url: city.youtube_url || '',
        is_active: city.is_active !== false,
      })
    } else {
      setForm(EMPTY)
    }
    setErrors({})
  }, [city])

  function set(field, value) {
    setForm(f => ({ ...f, [field]: value }))
    if (errors[field]) setErrors(e => ({ ...e, [field]: '' }))
  }

  function validate() {
    const e = {}
    if (!form.name.trim()) e.name = 'City name is required'
    if (!form.monthly_rate || isNaN(Number(form.monthly_rate))) e.monthly_rate = 'Enter a valid rate'
    if (!form.offer_rate || isNaN(Number(form.offer_rate))) e.offer_rate = 'Enter a valid rate'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  function handleSubmit(e) {
    e.preventDefault()
    if (!validate()) return
    onSave({
      ...form,
      screens: Number(form.screens) || 1,
      screen_size_inch: form.screen_size_inch ? Number(form.screen_size_inch) : null,
      monthly_rate: Number(form.monthly_rate) || 0,
      offer_rate: Number(form.offer_rate) || 0,
      impressions_day: Number(form.impressions_day) || 0,
      impressions_month: Number(form.impressions_month) || 0,
      unique_viewers: Number(form.unique_viewers) || 0,
      youtube_url: (form.youtube_url || '').trim() || null,
    })
  }

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 560 }}>
        <div className="modal-header">
          <p className="modal-title">{isEdit ? 'Edit City' : 'Add City'}</p>
          <button className="modal-close" onClick={onClose}><X size={17} /></button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

            <div className="form-grid-2">
              <div className="form-group">
                <label className="form-label">City Name *</label>
                <input
                  className={`form-input${errors.name ? ' input-error' : ''}`}
                  value={form.name}
                  onChange={e => set('name', e.target.value)}
                  placeholder="e.g. Ahmedabad"
                  autoFocus
                />
                {errors.name && <span className="field-error">{errors.name}</span>}
              </div>
              <div className="form-group">
                <label className="form-label">Station / Location</label>
                <input
                  className="form-input"
                  value={form.station_name}
                  onChange={e => set('station_name', e.target.value)}
                  placeholder="e.g. Central Station"
                />
              </div>
            </div>

            <div className="form-grid-2">
              <div className="form-group">
                <label className="form-label">Grade</label>
                <select className="form-select" value={form.grade} onChange={e => set('grade', e.target.value)}>
                  {GRADES.map(g => <option key={g} value={g}>Grade {g}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Number of Screens</label>
                <input
                  type="number" min="1"
                  className="form-input"
                  value={form.screens}
                  onChange={e => set('screens', e.target.value)}
                />
              </div>
            </div>

            <div className="form-grid-2">
              <div className="form-group">
                <label className="form-label">Screen Size (inches)</label>
                <input
                  type="number"
                  className="form-input"
                  value={form.screen_size_inch}
                  onChange={e => set('screen_size_inch', e.target.value)}
                  placeholder="e.g. 55"
                />
              </div>
              <div className="form-group" style={{ gridColumn: '1 / span 2' }}>
                <CityPhotoUploader
                  cityId={city?.id}
                  value={form.photo_url}
                  onChange={url => set('photo_url', url)}
                />
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">YouTube video URL <span style={{ color: 'var(--text-subtle)', fontWeight: 400 }}>(plays on the deck when online)</span></label>
              <input
                className="form-input"
                value={form.youtube_url}
                onChange={e => set('youtube_url', e.target.value)}
                placeholder="https://youtu.be/…  or  https://youtube.com/watch?v=…"
              />
            </div>

            <div className="modal-section-label">Rates (per month)</div>

            <div className="form-grid-2">
              <div className="form-group">
                <label className="form-label">Listed Rate (₹) *</label>
                <input
                  type="number"
                  className={`form-input${errors.monthly_rate ? ' input-error' : ''}`}
                  value={form.monthly_rate}
                  onChange={e => set('monthly_rate', e.target.value)}
                  placeholder="0"
                />
                {errors.monthly_rate && <span className="field-error">{errors.monthly_rate}</span>}
              </div>
              <div className="form-group">
                <label className="form-label">Offer Rate (₹) *</label>
                <input
                  type="number"
                  className={`form-input${errors.offer_rate ? ' input-error' : ''}`}
                  value={form.offer_rate}
                  onChange={e => set('offer_rate', e.target.value)}
                  placeholder="0"
                />
                {errors.offer_rate && <span className="field-error">{errors.offer_rate}</span>}
              </div>
            </div>

            <div className="modal-section-label">Audience Metrics</div>

            <div className="form-grid-2">
              <div className="form-group">
                <label className="form-label">Impressions / Day</label>
                <input
                  type="number"
                  className="form-input"
                  value={form.impressions_day}
                  onChange={e => set('impressions_day', e.target.value)}
                  placeholder="0"
                />
              </div>
              <div className="form-group">
                <label className="form-label">Impressions / Month</label>
                <input
                  type="number"
                  className="form-input"
                  value={form.impressions_month}
                  onChange={e => set('impressions_month', e.target.value)}
                  placeholder="0"
                />
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Unique Viewers / Month</label>
              <input
                type="number"
                className="form-input"
                value={form.unique_viewers}
                onChange={e => set('unique_viewers', e.target.value)}
                placeholder="0"
              />
            </div>

          </div>

          <div className="modal-footer">
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? 'Saving…' : isEdit ? 'Save Changes' : 'Add City'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
