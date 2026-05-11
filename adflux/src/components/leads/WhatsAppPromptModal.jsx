// src/components/leads/WhatsAppPromptModal.jsx
//
// Phase 33D.5 (11 May 2026) — post-action WhatsApp prompt.
//
// Pops after meeting save / call log / stage change with the right
// templated message. Rep reviews the body, then taps Send to open
// WhatsApp (wa.me) pre-filled, or Skip to dismiss.
//
// Props:
//   open        — visibility toggle
//   stage       — message_templates.stage key:
//                 'post_meeting' | 'post_call' | 'New' | 'Working' |
//                 'QuoteSent' | 'Nurture' | 'Won' | 'Lost'
//   lead        — { name, company, phone, segment, city }
//   profile     — { name } (rep)
//   onClose     — close callback
//
// Phone normalization, OCR placeholder fill, and segment→media
// mapping all happen here so callers stay simple.

import { useEffect, useState } from 'react'
import { X, MessageCircle, Loader2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'

function cleanPhone(raw) {
  if (!raw) return null
  const digits = String(raw).replace(/\D/g, '')
  if (digits.length < 10) return null
  if (digits.length === 10) return '91' + digits
  return digits
}

function mediaFor(segment) {
  // Locked at app level — Govt uses Auto Hood + GSRTC LED; Private
  // uses LED screens + other outdoor media.
  return segment === 'GOVERNMENT' ? 'outdoor hoardings' : 'LED screens'
}

export default function WhatsAppPromptModal({ open, stage, lead, profile, onClose }) {
  const [body, setBody] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open || !stage) return
    let cancelled = false
    setLoading(true); setError('')
    ;(async () => {
      const { data, error: tErr } = await supabase
        .from('message_templates')
        .select('body')
        .eq('stage', stage)
        .eq('is_active', true)
        .order('display_order')
        .limit(1)
        .maybeSingle()
      if (cancelled) return
      setLoading(false)
      if (tErr || !data) {
        setError(`No template found for "${stage}". Admin can add one in Master → Message Templates.`)
        return
      }
      const filled = (data.body || '')
        .replace(/\{name\}/g,    lead?.name    || 'Sir/Madam')
        .replace(/\{company\}/g, lead?.company || lead?.name || 'your business')
        .replace(/\{rep\}/g,     profile?.name || 'Sales Team')
        .replace(/\{city\}/g,    lead?.city    || 'your city')
        .replace(/\{media\}/g,   mediaFor(lead?.segment))
      setBody(filled)
    })()
    return () => { cancelled = true }
  }, [open, stage, lead, profile])

  if (!open) return null

  function send() {
    const phone = cleanPhone(lead?.phone)
    if (!phone) {
      setError('No phone number on file for this lead.')
      return
    }
    const url = `https://wa.me/${phone}?text=${encodeURIComponent(body)}`
    window.open(url, '_blank', 'noopener,noreferrer')
    onClose?.()
  }

  return (
    <div className="lead-modal-back" onClick={(e) => { if (e.target === e.currentTarget) onClose?.() }}>
      <div className="lead-modal" style={{ width: 'min(520px, calc(100% - 32px))' }}>
        <div className="lead-modal-head">
          <div>
            <div className="lead-modal-title">
              <MessageCircle size={14} style={{ verticalAlign: 'middle', marginRight: 6 }} />
              Send follow-up to {lead?.name || 'lead'}?
            </div>
            <div className="lead-card-sub">
              Review the message — you can edit anything in WhatsApp before sending.
            </div>
          </div>
          <button className="lead-btn lead-btn-sm" onClick={onClose} aria-label="Close">
            <X size={14} />
          </button>
        </div>

        <div className="lead-modal-body">
          {loading ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-muted)', fontSize: 13 }}>
              <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Loading template…
            </div>
          ) : error ? (
            <div style={{
              background: 'var(--danger-soft)', border: '1px solid var(--danger)',
              color: 'var(--danger)', borderRadius: 8, padding: '10px 14px', fontSize: 13,
            }}>
              {error}
            </div>
          ) : (
            <textarea
              className="lead-inp"
              rows={10}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              style={{ fontFamily: 'inherit', fontSize: 13, lineHeight: 1.5 }}
            />
          )}
        </div>

        <div className="lead-modal-foot">
          <button className="lead-btn" onClick={onClose}>Skip</button>
          <button
            className="lead-btn lead-btn-primary"
            onClick={send}
            disabled={loading || !body || !!error}
          >
            <MessageCircle size={13} /> Send WhatsApp
          </button>
        </div>
      </div>
    </div>
  )
}
