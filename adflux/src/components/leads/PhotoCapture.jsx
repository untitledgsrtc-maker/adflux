// src/components/leads/PhotoCapture.jsx
//
// Phase 33D (11 May 2026) — photo capture + OCR for leads. Uses native
// camera via <input type="file" capture="environment"> so mobile reps
// get the rear camera. Uploads to lead-photos storage bucket. Optionally
// runs OCR via the ocr-business-card Edge Function and offers to patch
// the lead with extracted name/phone/email/company.

import { useState } from 'react'
import { Camera, Loader2, Sparkles, Check } from 'lucide-react'
import { supabase } from '../../lib/supabase'

export default function PhotoCapture({ leadId, profileId, onSaved, onPatchLead }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [ocrPreview, setOcrPreview] = useState(null)  // { photo_id, fields, is_business_card }

  async function handleFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setError('')
    setBusy(true)
    try {
      // 1. Upload to storage.
      const ext = (file.name.split('.').pop() || 'jpg').toLowerCase()
      const key = `${leadId}/${Date.now()}.${ext}`
      const { error: upErr } = await supabase.storage
        .from('lead-photos').upload(key, file, { upsert: false, contentType: file.type })
      if (upErr) throw new Error('Upload: ' + upErr.message)

      // 2. INSERT lead_photos row.
      const { data: photoRow, error: insErr } = await supabase
        .from('lead_photos')
        .insert([{
          lead_id:      leadId,
          storage_path: key,
          created_by:   profileId,
        }])
        .select()
        .single()
      if (insErr) throw new Error('Save: ' + insErr.message)

      // 3. Kick off OCR (best-effort; failure doesn't block the upload).
      const b64 = await blobToBase64(file)
      const { data: { session } } = await supabase.auth.getSession()
      const url = `${import.meta.env.VITE_SUPABASE_URL || ''}/functions/v1/ocr-business-card`
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token || ''}`,
        },
        body: JSON.stringify({ image_base64: b64, mime_type: file.type, lead_id: leadId }),
      })
      let ocr = null
      if (res.ok) {
        ocr = await res.json()
        await supabase.from('lead_photos').update({
          ocr_text:         ocr.ocr_text || null,
          ocr_fields:       ocr.fields || {},
          is_business_card: !!ocr.is_business_card,
        }).eq('id', photoRow.id)
      }
      // 4. Show preview if business card with usable fields.
      if (ocr?.is_business_card && ocr.fields && Object.values(ocr.fields).some(Boolean)) {
        setOcrPreview({ photo_id: photoRow.id, fields: ocr.fields })
      }
      onSaved?.(photoRow)
    } catch (err) {
      setError(err.message || 'Photo failed')
    } finally {
      setBusy(false)
      // reset input so the same file can be re-picked
      e.target.value = ''
    }
  }

  function applyOcrFields() {
    if (!ocrPreview?.fields) return
    onPatchLead?.(ocrPreview.fields)
    setOcrPreview(null)
  }

  return (
    <div>
      <label
        className="lead-btn lead-btn-sm"
        style={{
          cursor: busy ? 'wait' : 'pointer',
          display: 'inline-flex', alignItems: 'center', gap: 6,
        }}
      >
        {busy
          ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} />
          : <Camera size={13} />}
        <span>{busy ? 'Uploading…' : 'Take photo'}</span>
        <input
          type="file"
          accept="image/*"
          capture="environment"
          onChange={handleFile}
          disabled={busy}
          style={{ display: 'none' }}
        />
      </label>
      {error && (
        <div style={{ marginTop: 6, fontSize: 11, color: 'var(--danger)' }}>{error}</div>
      )}
      {ocrPreview && (
        <div style={{
          marginTop: 10,
          padding: '10px 14px',
          background: 'rgba(255,230,0,0.08)',
          border: '1px solid var(--accent, #FFE600)',
          borderRadius: 10,
          fontSize: 12,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, fontWeight: 600 }}>
            <Sparkles size={13} /> Found contact details
          </div>
          {ocrPreview.fields.name    && <div>Name: <b>{ocrPreview.fields.name}</b></div>}
          {ocrPreview.fields.phone   && <div>Phone: <b>{ocrPreview.fields.phone}</b></div>}
          {ocrPreview.fields.email   && <div>Email: <b>{ocrPreview.fields.email}</b></div>}
          {ocrPreview.fields.company && <div>Company: <b>{ocrPreview.fields.company}</b></div>}
          {ocrPreview.fields.role    && <div>Role: <b>{ocrPreview.fields.role}</b></div>}
          <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
            <button className="lead-btn lead-btn-sm lead-btn-primary" onClick={applyOcrFields}>
              <Check size={12} /> Use these
            </button>
            <button className="lead-btn lead-btn-sm" onClick={() => setOcrPreview(null)}>
              Skip
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function blobToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result || '').split(',')[1])
    r.onerror = reject
    r.readAsDataURL(file)
  })
}
