// src/components/hr/OfferDetailModal.jsx
//
// Admin-only detail / action view for a single hr_offers row.
//
// - Shows the admin-entered block + candidate-filled personal
//   details (when present).
// - "Download PDF" downloads the accepted offer letter directly
//   from the Supabase public URL.
// - "Convert to User" — reachable only on accepted offers whose
//   candidate has not yet been converted. Creates a Supabase Auth
//   user via the isolated signup client (same flow as TeamMemberModal),
//   inserts a users row, and links it back into
//   hr_offers.converted_user_id + status='converted_to_user'.
//
// The convert flow deliberately mirrors TeamMemberModal so the
// trigger-created staff_incentive_profile behaves the same way
// (admin can tune salary on the Team page afterwards — Phase 1
// does not carry the offer salary over).

import { useState } from 'react'
import { X, Download, UserPlus, Copy, Check, MessageSquare } from 'lucide-react'
import { supabase, supabaseSignup } from '../../lib/supabase'
import { useOffers, buildOfferUrl, STATUS_META } from '../../hooks/useOffers'
import { shortenUrl, openWhatsApp } from '../../utils/whatsapp'
import { formatCurrency } from '../../utils/formatters'

function Row({ label, value }) {
  if (!value) return null
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{
        fontSize: '.7rem', color: 'var(--gray)',
        textTransform: 'uppercase', letterSpacing: '.08em',
        fontWeight: 600, marginBottom: 2,
      }}>
        {label}
      </div>
      <div style={{ fontSize: '.88rem', color: 'var(--fg)' }}>{value}</div>
    </div>
  )
}

function Section({ title, children }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{
        fontSize: '.72rem', fontWeight: 700, color: 'var(--gray)',
        textTransform: 'uppercase', letterSpacing: '.1em',
        paddingBottom: 6, marginBottom: 10,
        borderBottom: '1px solid var(--brd)',
      }}>
        {title}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        {children}
      </div>
    </div>
  )
}

export function OfferDetailModal({ offer, onClose, onChanged }) {
  const { updateOffer, cancelOffer } = useOffers()
  const [converting, setConverting] = useState(false)
  const [convertErr, setConvertErr] = useState('')
  const [password,   setPassword]   = useState('')
  const [showConvertForm, setShowConvertForm] = useState(false)
  const [shortUrlValue, setShort]   = useState('')
  const [copiedKey, setCopiedKey]   = useState(null)

  const meta = STATUS_META[offer.status] || STATUS_META.draft
  const fullUrl = buildOfferUrl(offer.invite_token)
  const isAccepted  = offer.status === 'accepted'
  const isConverted = offer.status === 'converted_to_user'
  const canCancel   = !isAccepted && !isConverted && offer.status !== 'cancelled'

  async function copyToClipboard(text, key) {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedKey(key); setTimeout(() => setCopiedKey(null), 1600)
    } catch { window.prompt('Copy this link:', text) }
  }

  async function handleShortenAndShare() {
    const url = shortUrlValue || await shortenUrl(fullUrl)
    if (url !== fullUrl) setShort(url)
    openWhatsApp('', [
      `Dear ${offer.candidate_name},`,
      '',
      `Your offer letter invite from Untitled Advertising — please open this link to fill your details and accept the offer:`,
      url,
    ].join('\n'))
  }

  async function handleConvert() {
    if (!password || password.length < 6) {
      setConvertErr('Password must be at least 6 characters')
      return
    }
    setConverting(true)
    setConvertErr('')

    // Auth user on the ISOLATED signup client so the admin session
    // is not replaced — matches TeamMemberModal exactly.
    const email = (offer.candidate_email || '').trim().toLowerCase()
    const name  = offer.full_legal_name || offer.candidate_name

    const { data: authData, error: authErr } = await supabaseSignup.auth.signUp({
      email,
      password,
      options: { data: { name } },
    })

    if (authErr) {
      setConvertErr(authErr.message || 'Failed to create auth user')
      setConverting(false)
      return
    }

    const userId = authData.user?.id
    if (!userId) {
      setConvertErr('User creation failed — no user ID returned')
      setConverting(false)
      return
    }

    try { await supabaseSignup.auth.signOut() } catch (_) { /* ignore */ }

    // Insert into users. The trigger auto_create_incentive_profile
    // synchronously inserts a staff_incentive_profiles row with the
    // incentive_settings defaults — we overwrite it immediately
    // below so the promised numbers from the offer letter are what
    // actually go into production.
    const { error: insErr } = await supabase.from('users').insert([{
      id:        userId,
      name,
      email,
      role:      'sales',
      is_active: true,
    }])

    if (insErr) {
      setConvertErr(insErr.message || 'Failed to insert user row')
      setConverting(false)
      return
    }

    // Auto-seed the incentive profile with the exact numbers from the
    // offer letter. Upsert on user_id so this works whether the
    // trigger row already exists (normal case) or hasn't fired yet
    // (defensive). Drift between the signed letter and the live
    // profile is the bug this is preventing.
    const { error: profErr } = await supabase
      .from('staff_incentive_profiles')
      .upsert(
        {
          user_id:          userId,
          monthly_salary:   Number(offer.fixed_salary_monthly) || 0,
          sales_multiplier: Number(offer.incentive_sales_multiplier) || 5,
          new_client_rate:  Number(offer.incentive_new_client_rate)  || 0.05,
          renewal_rate:     Number(offer.incentive_renewal_rate)     || 0.02,
          flat_bonus:       Number(offer.incentive_flat_bonus)       || 0,
          join_date:        offer.joining_date
                              || new Date().toISOString().split('T')[0],
          is_active:        true,
        },
        { onConflict: 'user_id' }
      )

    if (profErr) {
      // User row is in — don't block the convert, but surface the
      // issue so admin knows to open Team page and set rates by hand.
      setConvertErr(
        'User created, but seeding the incentive profile failed: '
        + (profErr.message || 'unknown error')
        + ' — please set rates manually on the Team page.'
      )
      // Continue: still link the offer so status is accurate.
    }

    // Link the offer back to the user.
    const { error: linkErr } = await updateOffer(offer.id, {
      converted_user_id: userId,
      converted_at:      new Date().toISOString(),
      status:            'converted_to_user',
    })
    setConverting(false)

    if (linkErr) {
      setConvertErr('User was created but linking to the offer failed: ' + linkErr.message)
      return
    }

    onChanged?.()
    onClose()
  }

  async function handleCancel() {
    if (!window.confirm('Cancel this offer? The invite link will stop working immediately.')) return
    await cancelOffer(offer.id)
    onChanged?.()
    onClose()
  }

  return (
    <div className="mo" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="md" style={{ maxWidth: 720 }}>
        <div className="md-h">
          <div className="md-t">
            {offer.candidate_name}
            <span style={{
              marginLeft: 10,
              fontSize: '.7rem',
              padding: '2px 8px',
              borderRadius: 10,
              background: meta.color,
              color: '#fff',
              textTransform: 'uppercase',
              letterSpacing: '.08em',
              fontWeight: 700,
            }}>
              {meta.label}
            </span>
          </div>
          <button className="md-x" onClick={onClose}><X size={18} /></button>
        </div>

        <div className="md-b">
          <Section title="Offer (admin-entered)">
            <Row label="Candidate Email" value={offer.candidate_email} />
            <Row label="Position"        value={offer.position} />
            <Row label="Territory"       value={offer.territory} />
            <Row label="Joining Date"    value={offer.joining_date} />
            <Row label="Fixed Salary"    value={offer.fixed_salary_monthly
              ? `${formatCurrency(offer.fixed_salary_monthly)} / month`
              : null} />
            <Row label="Place"           value={offer.place} />
          </Section>

          {/* Structured incentive block — shows the exact numbers that
              get auto-seeded into staff_incentive_profiles at convert
              time. Falls back to legacy free-text for old offers. */}
          {Number(offer.incentive_sales_multiplier) > 0 ? (
            <Section title="Performance Incentive">
              <Row
                label="Threshold (slab start)"
                value={`${formatCurrency((offer.fixed_salary_monthly || 0) * 2)} / month (2× fixed salary)`}
              />
              <Row
                label="Monthly Target"
                value={`${formatCurrency(
                  (offer.fixed_salary_monthly || 0)
                  * Number(offer.incentive_sales_multiplier)
                )} / month (${Number(offer.incentive_sales_multiplier)}× fixed salary)`}
              />
              <Row
                label="New Client Rate"
                value={`${(Number(offer.incentive_new_client_rate) * 100).toFixed(2)}%`}
              />
              <Row
                label="Renewal Rate"
                value={`${(Number(offer.incentive_renewal_rate) * 100).toFixed(2)}%`}
              />
              <Row
                label="Flat Bonus Above Target"
                value={Number(offer.incentive_flat_bonus) > 0
                  ? formatCurrency(Number(offer.incentive_flat_bonus))
                  : '—'}
              />
            </Section>
          ) : offer.incentive_text ? (
            <div style={{ marginBottom: 18 }}>
              <div style={{
                fontSize: '.7rem', color: 'var(--gray)',
                textTransform: 'uppercase', letterSpacing: '.08em',
                fontWeight: 600, marginBottom: 4,
              }}>
                Performance Incentive
              </div>
              <div style={{ fontSize: '.85rem', color: 'var(--fg)', whiteSpace: 'pre-wrap' }}>
                {offer.incentive_text}
              </div>
            </div>
          ) : null}

          {(offer.full_legal_name || offer.pan_number) ? (
            <>
              <Section title="Candidate personal details">
                <Row label="Full Legal Name"  value={offer.full_legal_name} />
                <Row label="Father's Name"    value={offer.fathers_name} />
                <Row label="Date of Birth"    value={offer.dob} />
                <Row label="Mobile"           value={offer.mobile} />
                <Row label="Personal Email"   value={offer.personal_email} />
                <Row label="Qualification"    value={offer.qualification} />
                <Row label="PAN"              value={offer.pan_number} />
                <Row label="Aadhaar"          value={offer.aadhaar_number} />
              </Section>

              <Section title="Address">
                <Row label="Line 1" value={offer.address_line1} />
                <Row label="Line 2" value={offer.address_line2} />
                <Row label="City"     value={offer.city} />
                <Row label="District" value={offer.district} />
                <Row label="State"    value={offer.state} />
                <Row label="Pincode"  value={offer.pincode} />
              </Section>

              <Section title="Bank">
                <Row label="Account Number" value={offer.bank_account_number} />
                <Row label="Bank Name"      value={offer.bank_name} />
                <Row label="IFSC"           value={offer.bank_ifsc} />
              </Section>

              <Section title="Emergency contact">
                <Row label="Name"         value={offer.emergency_contact_name} />
                <Row label="Phone"        value={offer.emergency_contact_phone} />
                <Row label="Relationship" value={offer.emergency_contact_rel} />
              </Section>
            </>
          ) : (
            <div style={{
              padding: 14,
              border: '1px dashed var(--brd)',
              borderRadius: 8,
              textAlign: 'center',
              color: 'var(--gray)',
              fontSize: '.88rem',
              marginBottom: 18,
            }}>
              Candidate has not yet opened the invite link.
            </div>
          )}

          {/* Share-link panel — visible while candidate hasn't accepted */}
          {!isAccepted && !isConverted && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                <input readOnly value={fullUrl} style={{ flex: 1 }} />
                <button className="btn btn-ghost" type="button"
                  onClick={() => copyToClipboard(fullUrl, 'url')}>
                  {copiedKey === 'url' ? <><Check size={14} /> Copied</> : <><Copy size={14} /> Copy</>}
                </button>
                <button className="btn btn-ghost" type="button" onClick={handleShortenAndShare}>
                  <MessageSquare size={14} /> WhatsApp
                </button>
              </div>
            </div>
          )}

          {/* Convert-to-user panel */}
          {isAccepted && (
            <div style={{
              marginTop: 12,
              padding: 14,
              border: '1px solid var(--brd)',
              borderRadius: 8,
              background: 'rgba(34,197,94,.05)',
            }}>
              {!showConvertForm ? (
                <>
                  <div style={{ fontSize: '.88rem', marginBottom: 8 }}>
                    This offer has been accepted. You can now create a
                    Sales user account for <strong>{offer.full_legal_name || offer.candidate_name}</strong>.
                  </div>
                  <button className="btn btn-y" onClick={() => setShowConvertForm(true)}>
                    <UserPlus size={15} style={{ marginRight: 6 }} />
                    Convert to User
                  </button>
                </>
              ) : (
                <>
                  <div style={{ fontSize: '.88rem', marginBottom: 8 }}>
                    Set a temporary password for <strong>{offer.candidate_email}</strong>.
                    Share it with them so they can sign in.
                  </div>
                  {convertErr && (
                    <div style={{
                      background: 'rgba(229,57,53,.08)',
                      border: '1px solid rgba(229,57,53,.25)',
                      borderRadius: 6, padding: 8, fontSize: '.8rem',
                      color: '#ef9a9a', marginBottom: 8,
                    }}>
                      {convertErr}
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input
                      type="text"
                      placeholder="Min 6 characters"
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      style={{ flex: 1 }}
                    />
                    <button className="btn btn-ghost" onClick={() => setShowConvertForm(false)} disabled={converting}>
                      Cancel
                    </button>
                    <button className="btn btn-y" onClick={handleConvert} disabled={converting}>
                      {converting ? 'Creating…' : 'Create User'}
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {isConverted && (
            <div style={{
              marginTop: 12, padding: 14,
              border: '1px solid var(--brd)', borderRadius: 8,
              background: 'rgba(34,197,94,.05)',
              fontSize: '.88rem',
            }}>
              Converted to a sales user{offer.converted_at
                ? ` on ${new Date(offer.converted_at).toLocaleDateString('en-IN')}`
                : ''}.
            </div>
          )}
        </div>

        <div className="md-f">
          {canCancel && (
            <button className="btn btn-ghost" onClick={handleCancel}
              style={{ color: 'var(--red)' }}>
              Cancel Offer
            </button>
          )}
          {offer.offer_pdf_url && (
            <a
              className="btn btn-ghost"
              href={offer.offer_pdf_url}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Download size={14} style={{ marginRight: 6 }} />
              Open PDF
            </a>
          )}
          <button className="btn btn-y" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}
