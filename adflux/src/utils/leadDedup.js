// src/utils/leadDedup.js
//
// Phase 33D.6 — phone-based duplicate detection.
// Calls the find_lead_by_phone RPC. Returns null if no match or
// phone is too short. Returns { id, name, company, stage, assigned_to }
// on hit.

import { supabase } from '../lib/supabase'

export async function findLeadByPhone(phone) {
  if (!phone) return null
  const digits = String(phone).replace(/\D/g, '')
  if (digits.length < 10) return null
  const { data, error } = await supabase
    .rpc('find_lead_by_phone', { p_phone: phone })
  if (error) {
    console.warn('findLeadByPhone error:', error.message)
    return null
  }
  return Array.isArray(data) && data.length > 0 ? data[0] : null
}

// Resize/compress an image File to max width with JPEG quality.
// Returns a Blob (or original File on failure). ~200KB target from
// a 4MB phone photo. Used by PhotoCapture before storage upload.
export async function resizeImage(file, maxWidth = 1280, quality = 0.85) {
  try {
    if (!file.type?.startsWith('image/')) return file
    const dataUrl = await new Promise((res, rej) => {
      const r = new FileReader()
      r.onload = () => res(r.result)
      r.onerror = rej
      r.readAsDataURL(file)
    })
    const img = await new Promise((res, rej) => {
      const i = new Image()
      i.onload = () => res(i)
      i.onerror = rej
      i.src = dataUrl
    })
    if (img.width <= maxWidth) return file
    const scale = maxWidth / img.width
    const w = Math.round(img.width * scale)
    const h = Math.round(img.height * scale)
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    ctx.drawImage(img, 0, 0, w, h)
    return await new Promise((resolve) =>
      canvas.toBlob((blob) => resolve(blob || file), 'image/jpeg', quality)
    )
  } catch (e) {
    console.warn('resizeImage failed, using original:', e?.message)
    return file
  }
}
