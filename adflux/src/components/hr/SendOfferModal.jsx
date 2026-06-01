// src/components/hr/SendOfferModal.jsx
//
// Admin-only modal. Collects the minimum set of fields to issue an
// offer invite, creates the hr_offers row, and then hands the admin
// an action panel with:
//   - Copy Link        (raw + shortened)
//   - Share via WhatsApp (wa.me click-to-chat, pre-filled message)
//
// Phase 1 constraint: no email delivery. Admin shares the link
// themselves. `shortenUrl` lives in src/utils/whatsapp.js and is
// already wired to the Vercel /api/shorten endpoint so the link
// previews clean in WhatsApp.

import { useState, useEffect, useMemo } from 'react'
import { X, Copy, Check, MessageSquare } from 'lucide-react'
import { useOffers, buildOfferUrl } from '../../hooks/useOffers'
import { supabase } from '../../lib/supabase'
import { shortenUrl, openWhatsApp } from '../../utils/whatsapp'
import { formatCurrency } from '../../utils/formatters'

function Field({ label, required, error, hint, children }) {
  return (
    <div className="fg">
      <label>
        {label}
        {required && <span style={{ color: 'var(--red)' }}> *</span>}
      </label>
      {children}
      {error && (
        <p style={{ fontSize: '.75rem', color: 'var(--red)', marginTop: 3 }}>{error}</p>
      )}
      {hint && !error && (
        <p style={{ fontSize: '.75rem', color: 'var(--gray)', marginTop: 3 }}>{hint}</p>
      )}
    </div>
  )
}

export function SendOfferModal({ onClose, onCreated }) {
  const { createOffer, markSent } = useOffers()

  // Structured incentive defaults mirror the existing Team profile
  // defaults so a "just send it" admin gets sensible values without
  // touching them.
  const [form, setForm] = useState({
    designation_id:              '',
    candidate_name:              '',
    candidate_email:             '',
    position:                    'Sales Person',
    territory:                   '',
    joining_date:                '',
    fixed_salary_monthly:        '',
    incentive_sales_multiplier:  '5',
    incentive_new_client_rate:   '0.05',
    incentive_renewal_rate:      '0.02',
    incentive_flat_bonus:        '10000',
    place:                       'Vadodara',
  })
  const [errors, setErrors]       = useState({})
  const [saving, setSaving]       = useState(false)
  const [serverError, setServerError] = useState('')

  // Once created, the modal flips to the "share" panel
  const [offer, setOffer]         = useState(null)
  const [fullUrl, setFullUrl]     = useState('')
  const [shortUrlValue, setShort] = useState('')
  const [shortenLoading, setShortenLoading] = useState(false)
  const [copiedKey, setCopiedKey] = useState(null)

  // Phase 109.1 — active designations so HR can send an offer for ANY
  // role, not only sales. Mirrors the HRNewUserV2 designation picker.
  const [designations, setDesignations] = useState([])
  useEffect(() => {
    let alive = true
    supabase.from('designations')
      .select('id, name, default_monthly_salary, has_incentive')
      .eq('is_active', true)
      .order('display_order')
      .then(({ data }) => { if (alive && data) setDesignations(data) })
    return () => { alive = false }
  }, [])

  const picked = useMemo(
    () => designations.find(d => d.id === form.designation_id) || null,
    [designations, form.designation_id],
  )
  // Until a role is picked, keep the sales-shaped layout (incentive
  // shown) so the modal never looks half-empty on first open.
  const hasIncentive = picked ? !!picked.has_incentive : true

  function set(field, value) {
    setForm(f => ({ ...f, [field]: value }))
    setErrors(e => ({ ...e, [field]: '' }))
  }

  // On designation pick → snap position + salary from the master row.
  function pickDesignation(id) {
    const d = designations.find(x => x.id === id)
    setForm(f => ({
      ...f,
      designation_id: id,
      position: d ? d.name : f.position,
      fixed_salary_monthly: d && d.default_monthly_salary
        ? String(d.default_monthly_salary)
        : f.fixed_salary_monthly,
    }))
    setErrors(e => ({ ...e, designation_id: '', position: '' }))
  }

  function validate() {
    const errs = {}
    if (!form.designation_id)         errs.designation_id  = 'Pick a designation'
    if (!form.candidate_name.trim())  errs.candidate_name  = 'Name is required'
    if (!form.candidate_email.trim()) errs.candidate_email = 'Email is required'
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.candidate_email))
      errs.candidate_email = 'Invalid email'
    if (!form.fixed_salary_monthly || Number(form.fixed_salary_monthly) <= 0)
      errs.fixed_salary_monthly = 'Enter a monthly salary'
    if (!form.joining_date) errs.joining_date = 'Pick a joining date'
    // Incentive fields only apply to roles that earn incentive.
    if (hasIncentive) {
      if (!form.incentive_sales_multiplier || Number(form.incentive_sales_multiplier) <= 0)
        errs.incentive_sales_multiplier = 'Required'
      if (form.incentive_new_client_rate === '' || Number(form.incentive_new_client_rate) < 0)
        errs.incentive_new_client_rate = 'Required'
      if (form.incentive_renewal_rate === '' || Number(form.incentive_renewal_rate) < 0)
        errs.incentive_renewal_rate = 'Required'
    }
    return errs
  }

  async function handleCreate() {
    const errs = validate()
    if (Object.keys(errs).length) { setErrors(errs); return }

    setSaving(true)
    setServerError('')
    const { data, error } = await createOffer({
      candidate_name:              form.candidate_name.trim(),
      candidate_email:             form.candidate_email.trim().toLowerCase(),
      position:                    form.position.trim() || picked?.name || 'Sales Person',
      territory:                   form.territory.trim() || null,
      joining_date:                form.joining_date,
      fixed_salary_monthly:        Number(form.fixed_salary_monthly),
      // Flat-salary roles carry zero incentive so the record never
      // implies a commission the role doesn't earn.
      incentive_sales_multiplier:  hasIncentive ? Number(form.incentive_sales_multiplier) : 0,
      incentive_new_client_rate:   hasIncentive ? Number(form.incentive_new_client_rate) : 0,
      incentive_renewal_rate:      hasIncentive ? Number(form.incentive_renewal_rate) : 0,
      incentive_flat_bonus:        hasIncentive ? Number(form.incentive_flat_bonus || 0) : 0,
      // Legacy free-text is no longer collected — left null so the
      // PDF generator falls through to the structured block.
      incentive_text:              null,
      place:                       form.place.trim() || 'Vadodara',
    })
    setSaving(false)

    if (error) {
      setServerError(error.message || 'Failed to create offer')
      return
    }

    setOffer(data)
    const url = buildOfferUrl(data.invite_token)
    setFullUrl(url)

    // Fire-and-forget shortener — don't block the admin from
    // copying/sharing. If it resolves, the short URL appears; if it
    // fails, the admin still has the long URL.
    setShortenLoading(true)
    shortenUrl(url)
      .then(s => { if (s && s !== url) setShort(s) })
      .finally(() => setShortenLoading(false))

    // Flip the offer to 'sent' immediately — the admin has the link
    // now and can share it any moment. Leaving it at 'draft' would
    // mis-classify outstanding invites in the list view.
    markSent(data.id)
    onCreated?.()
  }

  async function copyToClipboard(text, key) {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedKey(key)
      setTimeout(() => setCopiedKey(null), 1600)
    } catch {
      // Clipboard API blocked (rare) — fall back to a prompt the user
      // can copy from manually.
      window.prompt('Copy this link:', text)
    }
  }

  function shareOnWhatsApp() {
    const link = shortUrlValue || fullUrl
    const msg  = [
      `Dear ${offer.candidate_name},`,
      '',
      `Congratulations! Untitled Advertising would like to offer you the position of *${offer.position}*.`,
      '',
      `Please open the link below to review the terms, complete your personal details, and digitally accept the offer:`,
      link,
      '',
      `Looking forward to having you on the team.`,
      '',
      `Untitled Advertising`,
    ].join('\n')
    // openWhatsApp strips non-digits and adds the 91 prefix for bare
    // 10-digit numbers — since we don't collect the candidate phone
    // in this modal, pass an empty string so the app opens the
    // "choose contact" picker.
    openWhatsApp('', msg)
  }

  // ── SHARE PANEL ─────────────────────────────────────
  if (offer) {
    return (
      <div className="mo" onClick={e => e.target === e.currentTarget && onClose()}>
        <div className="md">
          <div className="md-h">
            <div className="md-t">Offer created — share with candidate</div>
            <button className="md-x" onClick={onClose}><X size={18} /></button>
          </div>

          <div className="md-b">
            <p style={{ fontSize: '.85rem', color: 'var(--gray)', marginBottom: 14 }}>
              An invite link has been generated for <strong>{offer.candidate_name}</strong>.
              Share it with them via WhatsApp. They'll open it, fill in
              personal details, accept the terms, and their signed
              offer letter PDF will be generated automatically.
            </p>

            <Field label="Short link (preferred for WhatsApp)">
              <div style={{ display: 'flex', gap: 6 }}>
                <input
                  readOnly
                  value={shortenLoading ? 'Shortening…' : (shortUrlValue || '— (using long link)')}
                  onClick={e => e.target.select()}
                  style={{ flex: 1 }}
                />
                <button
                  className="btn btn-ghost"
                  type="button"
                  disabled={!shortUrlValue}
                  onClick={() => copyToClipboard(shortUrlValue, 'short')}
                >
                  {copiedKey === 'short' ? <><Check size={14} /> Copied</> : <><Copy size={14} /> Copy</>}
                </button>
              </div>
            </Field>

            <Field label="Full link">
              <div style={{ display: 'flex', gap: 6 }}>
                <input
                  readOnly
                  value={fullUrl}
                  onClick={e => e.target.select()}
                  style={{ flex: 1 }}
                />
                <button
                  className="btn btn-ghost"
                  type="button"
                  onClick={() => copyToClipboard(fullUrl, 'full')}
                >
                  {copiedKey === 'full' ? <><Check size={14} /> Copied</> : <><Copy size={14} /> Copy</>}
                </button>
              </div>
            </Field>
          </div>

          <div className="md-f">
            <button className="btn btn-ghost" onClick={onClose}>Done</button>
            <button className="btn btn-y" onClick={shareOnWhatsApp}>
              <MessageSquare size={15} style={{ marginRight: 6 }} />
              Share via WhatsApp
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ── CREATE PANEL ────────────────────────────────────
  return (
    <div className="mo" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="md">
        <div className="md-h">
          <div className="md-t">Send Offer</div>
          <button className="md-x" onClick={onClose}><X size={18} /></button>
        </div>

        <div className="md-b">
          {serverError && (
            <div style={{
              background: 'rgba(229,57,53,.08)',
              border: '1px solid rgba(229,57,53,.25)',
              borderRadius: 8, padding: '11px 14px', fontSize: '.82rem',
              color: '#ef9a9a', marginBottom: 14,
            }}>
              {serverError}
            </div>
          )}

          <Field label="Candidate Name" required error={errors.candidate_name}>
            <input
              placeholder="e.g. Rahul Sharma"
              value={form.candidate_name}
              onChange={e => set('candidate_name', e.target.value)}
            />
          </Field>

          <Field label="Candidate Email" required error={errors.candidate_email}
            hint="Used for records only — the invite link is shared via WhatsApp.">
            <input
              type="email"
              placeholder="rahul@example.com"
              value={form.candidate_email}
              onChange={e => set('candidate_email', e.target.value)}
            />
          </Field>

          <Field label="Designation" required error={errors.designation_id}
            hint="Salary auto-fills from the role. Commission shows only for roles that earn it.">
            <select
              value={form.designation_id}
              onChange={e => pickDesignation(e.target.value)}
            >
              <option value="">— Pick a designation —</option>
              {designations.map(d => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </Field>

          <Field label="Territory" hint="e.g. Vadodara + Anand + Kheda">
            <input
              value={form.territory}
              onChange={e => set('territory', e.target.value)}
            />
          </Field>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="Joining Date" required error={errors.joining_date}>
              <input
                type="date"
                value={form.joining_date}
                onChange={e => set('joining_date', e.target.value)}
              />
            </Field>
            <Field label="Fixed Salary / month (₹)" required error={errors.fixed_salary_monthly}>
              <input
                type="number" min="0"
                placeholder="e.g. 30000"
                value={form.fixed_salary_monthly}
                onChange={e => set('fixed_salary_monthly', e.target.value)}
              />
            </Field>
          </div>

          {/* ── Structured incentive block ─────────────────
              Phase 109.1 — shown ONLY for roles that earn incentive
              (designations.has_incentive). Flat-salary roles (HR,
              Accounts, Office Boy, creative/ops) skip it entirely. */}
          {hasIncentive && (
          <div style={{
            padding: 14, borderRadius: 10,
            border: '1px dashed var(--brd)',
            marginBottom: 14,
          }}>
            <div style={{
              fontSize: '.72rem', color: 'var(--gray)',
              textTransform: 'uppercase', letterSpacing: '.08em',
              fontWeight: 700, marginBottom: 10,
            }}>
              Performance Incentive
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Field label="Sales Multiplier" required
                error={errors.incentive_sales_multiplier}
                hint="Target = salary × multiplier">
                <input
                  type="number" step="0.1" min="0"
                  value={form.incentive_sales_multiplier}
                  onChange={e => set('incentive_sales_multiplier', e.target.value)}
                />
              </Field>
              <Field label="Flat Bonus Above Target (₹)">
                <input
                  type="number" min="0"
                  value={form.incentive_flat_bonus}
                  onChange={e => set('incentive_flat_bonus', e.target.value)}
                />
              </Field>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Field label="New Client Rate" required
                error={errors.incentive_new_client_rate}
                hint="e.g. 0.05 = 5%">
                <input
                  type="number" step="0.01" min="0" max="1"
                  value={form.incentive_new_client_rate}
                  onChange={e => set('incentive_new_client_rate', e.target.value)}
                />
              </Field>
              <Field label="Renewal Rate" required
                error={errors.incentive_renewal_rate}
                hint="e.g. 0.02 = 2%">
                <input
                  type="number" step="0.01" min="0" max="1"
                  value={form.incentive_renewal_rate}
                  onChange={e => set('incentive_renewal_rate', e.target.value)}
                />
              </Field>
            </div>

            {/* Derived preview — shown only once salary is entered
                so the admin can sanity-check the numbers before
                hitting Create. Matches the threshold/target math
                in utils/incentiveCalc.js exactly. */}
            {Number(form.fixed_salary_monthly) > 0
              && Number(form.incentive_sales_multiplier) > 0 && (
              <div style={{
                marginTop: 8, padding: '8px 12px', borderRadius: 6,
                background: 'var(--subtle)', fontSize: '.82rem',
              }}>
                Threshold:{' '}
                <strong>
                  {formatCurrency(Number(form.fixed_salary_monthly) * 2)}
                </strong>
                {'  ·  '}
                Target:{' '}
                <strong>
                  {formatCurrency(
                    Number(form.fixed_salary_monthly)
                    * Number(form.incentive_sales_multiplier)
                  )}
                </strong>
              </div>
            )}
          </div>
          )}

          <Field label="Place (for acceptance)">
            <input
              value={form.place}
              onChange={e => set('place', e.target.value)}
            />
          </Field>
        </div>

        <div className="md-f">
          <button className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn btn-y" onClick={handleCreate} disabled={saving}>
            {saving ? 'Creating…' : 'Create & get invite link'}
          </button>
        </div>
      </div>
    </div>
  )
}
