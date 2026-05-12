// src/components/leads/PhotoCapture.jsx
//
// Phase 33D (11 May 2026) — photo capture + OCR for leads.
// Phase 33D.1 (11 May 2026) — added scan-only mode for new-lead
// creation. Owner asked for business-card → new lead autofill.
//
// Two modes:
//   - ATTACH mode (leadId given): upload to lead-photos bucket,
//     INSERT lead_photos row, run OCR, offer to patch the lead's
//     empty fields with extracted values.
//   - SCAN mode (no leadId): skip upload + insert, just run OCR
//     and call onFieldsExtracted({name, phone, email, company, role}).
//     Used by LeadFormV2 to prefill the New Lead form from a
//     business card photo.
//
// Uses native camera via <input type="file" capture="environment">
// so mobile reps get the rear camera.

import { useState } from 'react'
import { Camera, Loader2, Sparkles, Check } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { resizeImage } from '../../utils/leadDedup'
import { toastError } from '../v2/Toast'

export default function PhotoCapture({
  leadId,
  profileId,
  onSaved,
  onPatchLead,
  onFieldsExtracted,
  buttonLabel,
}) {
  const scanOnly = !leadId
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [ocrPreview, setOcrPreview] = useState(null)  // { photo_id?, fields, is_business_card }

  async function handleFile(e) {
    const original = e.target.files?.[0]
    if (!original) return
    setError('')
    setBusy(true)
    try {
      // Phase 33D.6 — auto-resize to max 1280px + 0.85 JPEG before
      // upload. Cuts a 4MB phone photo to ~200KB. Same image used
      // for OCR — Claude Vision is fine with 1280px.
      const file = await resizeImage(original, 1280, 0.85)
      let photoRow = null
      if (!scanOnly) {
        // 1. Upload to storage.
        const ext = 'jpg'
        const key = `${leadId}/${Date.now()}.${ext}`
        const { error: upErr } = await supabase.storage
          .from('lead-photos').upload(key, file, { upsert: false, contentType: file.type || 'image/jpeg' })
        if (upErr) throw new Error('Upload: ' + upErr.message)

        // 2. INSERT lead_photos row.
        const ins = await supabase
          .from('lead_photos')
          .insert([{
            lead_id:      leadId,
            storage_path: key,
            created_by:   profileId,
          }])
          .select()
          .single()
        if (ins.error) throw new Error('Save: ' + ins.error.message)
        photoRow = ins.data
      }

      // 3. Run OCR (always — both modes need the fields).
      const b64 = await blobToBase64(file)
      const { data: { session } } = await supabase.auth.getSession()
      const url = `${import.meta.env.VITE_SUPABASE_URL || ''}/functions/v1/ocr-business-card`
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token || ''}`,
        },
        body: JSON.stringify({ image_base64: b64, mime_type: file.type, lead_id: leadId || null }),
      })
      let ocr = null
      if (res.ok) {
        ocr = await res.json()
        if (photoRow) {
          // Phase 34b — was unchecked. If RLS or a stale row blocks
          // the OCR update, the photo stays but the OCR text never
          // attaches, so the rep sees no extracted fields and can't
          // tell why. Surface via toast (non-blocking — the photo
          // upload itself already succeeded).
          const { error: ocrUpdErr } = await supabase.from('lead_photos').update({
            ocr_text:         ocr.ocr_text || null,
            ocr_fields:       ocr.fields || {},
            is_business_card: !!ocr.is_business_card,
          }).eq('id', photoRow.id)
          if (ocrUpdErr) {
            toastError(ocrUpdErr, 'Photo saved, but OCR fields could not be attached.')
          }
        }
      } else {
        const txt = await res.text()
        throw new Error('OCR failed: ' + txt.slice(0, 200))
      }

      // 4. Show preview if business card with usable fields.
      if (ocr?.is_business_card && ocr.fields && Object.values(ocr.fields).some(Boolean)) {
        setOcrPreview({ photo_id: photoRow?.id, fields: ocr.fields })
      } else if (scanOnly) {
        setError('No business card detected. Try a clearer photo.')
      }
      if (photoRow) onSaved?.(photoRow)
    } catch (err) {
      setError(err.message || 'Photo failed')
    } finally {
      setBusy(false)
      e.target.value = ''
    }
  }

  function applyOcrFields() {
    if (!ocrPreview?.fields) return
    if (scanOnly) {
      onFieldsExtracted?.(ocrPreview.fields)
    } else {
      onPatchLead?.(ocrPreview.fields)
    }
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
        <span>{busy ? (scanOnly ? 'Reading card…' : 'Uploading…') : (buttonLabel || 'Take photo')}</span>
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
