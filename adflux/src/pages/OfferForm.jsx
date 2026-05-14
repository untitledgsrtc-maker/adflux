// src/pages/OfferForm.jsx
//
// Public, no-auth candidate form reached via /offer/:token.
//
// Flow:
//   1. On mount, call RPC fetch_offer_by_token(token). If the offer
//      exists and is not accepted/cancelled, render the summary +
//      personal-details form. If accepted/converted, show a success
//      message + PDF link. If missing/invalid, show a generic
//      "link not valid" message.
//   2. On submit:
//        a. Generate the offer-letter PDF via @react-pdf/renderer
//           using the merged offer + template + the form values the
//           candidate just typed.
//        b. Upload it to the offer-letters storage bucket as
//             offer-letters/{invite_token}/{timestamp}.pdf
//        c. Call RPC submit_offer_acceptance(...) with the public
//           URL and all personal fields. The RPC flips status to
//           'accepted'.
//   3. On success, re-fetch the offer and show the accepted view.
//
// Security — the page never needs `supabase.auth`. Only two public
// RPCs + one public storage bucket are touched.

import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { CheckCircle2, AlertTriangle, Download, Loader2 } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { generateOfferLetterBlob } from '../components/hr/OfferLetterPDF'
import { formatCurrency } from '../utils/formatters'

function Field({ label, required, error, hint, children }) {
  return (
    <div className="fg" style={{ marginBottom: 12 }}>
      <label>
        {label}
        {required && <span style={{ color: 'var(--danger)' }}> *</span>}
      </label>
      {children}
      {error && <p style={{ fontSize: '.75rem', color: 'var(--danger)', marginTop: 3 }}>{error}</p>}
      {hint && !error && <p style={{ fontSize: '.75rem', color: 'var(--text-muted)', marginTop: 3 }}>{hint}</p>}
    </div>
  )
}

function Layout({ children }) {
  // Minimal stand-alone shell — no AppShell, no sidebar. The
  // candidate is not an authenticated staff member.
  return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--bg)',
      padding: '24px 16px',
    }}>
      <div style={{
        maxWidth: 760,
        margin: '0 auto',
        padding: '20px 22px 28px',
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 10,
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          borderBottom: '1px solid var(--border)',
          paddingBottom: 14, marginBottom: 18,
        }}>
          <div style={{
            width: 36, height: 36, borderRadius: 4,
            background: 'var(--accent)', color: 'var(--accent-fg)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontWeight: 700,
          }}>
            UA
          </div>
          <div>
            <div style={{ fontWeight: 700 }}>Untitled Advertising</div>
            <div style={{ fontSize: '.75rem', color: 'var(--text-muted)' }}>
              Offer Letter — Personal Details
            </div>
          </div>
        </div>
        {children}
      </div>
    </div>
  )
}

export default function OfferForm() {
  const { token } = useParams()

  const [loading, setLoading]   = useState(true)
  const [offer,   setOffer]     = useState(null)
  const [loadErr, setLoadErr]   = useState('')
  const [template, setTemplate] = useState(null)

  const [form, setForm] = useState({
    full_legal_name:          '',
    fathers_name:             '',
    dob:                      '',
    mobile:                   '',
    personal_email:           '',
    address_line1:            '',
    address_line2:            '',
    city:                     '',
    district:                 '',
    state:                    '',
    pincode:                  '',
    pan_number:               '',
    aadhaar_number:           '',
    qualification:            '',
    bank_account_number:      '',
    bank_name:                '',
    bank_ifsc:                '',
    emergency_contact_name:   '',
    emergency_contact_phone:  '',
    emergency_contact_rel:    '',
    accepted:                 false,
  })
  const [errors, setErrors]   = useState({})
  const [submitting, setSub]  = useState(false)
  const [submitErr, setSE]    = useState('')

  function set(field, value) {
    setForm(f => ({ ...f, [field]: value }))
    setErrors(e => ({ ...e, [field]: '' }))
  }

  // Load the offer via the public RPC.
  useEffect(() => {
    let cancelled = false
    const run = async () => {
      setLoading(true)
      setLoadErr('')

      const { data, error } = await supabase.rpc('fetch_offer_by_token', { p_token: token })
      if (cancelled) return

      if (error) {
        setLoadErr('Unable to load offer. The link may be invalid or expired.')
        setLoading(false)
        return
      }
      const row = Array.isArray(data) ? data[0] : data
      if (!row) {
        setLoadErr('This offer link is invalid or has been cancelled.')
        setLoading(false)
        return
      }
      setOffer(row)

      // Pre-fill the form if the candidate has partially saved before
      // (the RPC returns their last-saved values for anything !=
      // accepted). Covers the "I started but my phone died" case.
      setForm(f => ({
        ...f,
        full_legal_name:          row.full_legal_name         || '',
        fathers_name:             row.fathers_name            || '',
        dob:                      row.dob                     || '',
        mobile:                   row.mobile                  || '',
        personal_email:           row.personal_email          || '',
        address_line1:            row.address_line1           || '',
        address_line2:            row.address_line2           || '',
        city:                     row.city                    || '',
        district:                 row.district                || '',
        state:                    row.state                   || '',
        pincode:                  row.pincode                 || '',
        pan_number:               row.pan_number              || '',
        aadhaar_number:           row.aadhaar_number          || '',
        qualification:            row.qualification           || '',
        bank_account_number:      row.bank_account_number     || '',
        bank_name:                row.bank_name               || '',
        bank_ifsc:                row.bank_ifsc               || '',
        emergency_contact_name:   row.emergency_contact_name  || '',
        emergency_contact_phone:  row.emergency_contact_phone || '',
        emergency_contact_rel:    row.emergency_contact_rel   || '',
      }))

      // Fetch the default template for PDF generation. RLS allows
      // any authenticated OR anon read of hr_offer_templates? —
      // actually NO: our policy restricts sales reads to
      // auth.uid() IS NOT NULL. For the public form we fall back to
      // DEFAULT_TPL inside OfferLetterPDF if this read returns null.
      if (row.template_id) {
        const { data: tpl } = await supabase
          .from('hr_offer_templates')
          .select('*')
          .eq('id', row.template_id)
          .maybeSingle()
        if (tpl) setTemplate(tpl)
      }

      setLoading(false)
    }
    run()
    return () => { cancelled = true }
  }, [token])

  function validate() {
    const req = {
      full_legal_name:         'Full legal name is required',
      fathers_name:            "Father's name is required",
      dob:                     'Date of birth is required',
      mobile:                  'Mobile number is required',
      personal_email:          'Personal email is required',
      address_line1:           'Address is required',
      city:                    'City is required',
      state:                   'State is required',
      pincode:                 'Pincode is required',
      pan_number:              'PAN is required',
      aadhaar_number:          'Aadhaar is required',
      qualification:           'Qualification is required',
      bank_account_number:     'Bank account number is required',
      bank_name:               'Bank name is required',
      bank_ifsc:               'IFSC code is required',
      emergency_contact_name:  'Emergency contact name is required',
      emergency_contact_phone: 'Emergency contact phone is required',
      emergency_contact_rel:   'Emergency contact relationship is required',
    }
    const errs = {}
    for (const [k, msg] of Object.entries(req)) {
      if (!form[k]?.toString().trim()) errs[k] = msg
    }
    if (form.personal_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.personal_email)) {
      errs.personal_email = 'Invalid email'
    }
    if (form.mobile && !/^\d{10}$/.test(form.mobile.replace(/\D/g, ''))) {
      errs.mobile = 'Mobile must be 10 digits'
    }
    if (form.pincode && !/^\d{6}$/.test(form.pincode)) {
      errs.pincode = 'Pincode must be 6 digits'
    }
    if (form.pan_number && !/^[A-Z]{5}[0-9]{4}[A-Z]$/i.test(form.pan_number.trim())) {
      errs.pan_number = 'PAN format: AAAAA9999A'
    }
    if (form.aadhaar_number && !/^\d{12}$/.test(form.aadhaar_number.replace(/\D/g, ''))) {
      errs.aadhaar_number = 'Aadhaar must be 12 digits'
    }
    if (!form.accepted) {
      errs.accepted = 'You must accept the terms to submit'
    }
    return errs
  }

  async function handleSubmit(e) {
    e?.preventDefault?.()
    const errs = validate()
    if (Object.keys(errs).length) {
      setErrors(errs)
      // Scroll the first error into view
      const firstErr = document.querySelector('.field-error')
      if (firstErr) firstErr.scrollIntoView({ behavior: 'smooth', block: 'center' })
      return
    }

    setSub(true)
    setSE('')

    try {
      // 1. Build the merged offer for PDF generation
      const mergedOffer = {
        ...offer,
        ...form,
        accepted_terms_at: new Date().toISOString(),
      }

      // 2. Generate the PDF
      const blob = await generateOfferLetterBlob(mergedOffer, template)

      // 3. Upload to offer-letters/{invite_token}/{ts}.pdf
      const ts   = Date.now()
      const path = `${token}/${ts}.pdf`
      const { error: upErr } = await supabase
        .storage
        .from('offer-letters')
        .upload(path, blob, { contentType: 'application/pdf', upsert: false })
      if (upErr) throw new Error('PDF upload failed: ' + upErr.message)

      const { data: pub } = supabase.storage.from('offer-letters').getPublicUrl(path)
      const pdfUrl = pub?.publicUrl
      if (!pdfUrl) throw new Error('PDF uploaded but no public URL was returned')

      // 4. Submit via RPC
      const { error: rpcErr } = await supabase.rpc('submit_offer_acceptance', {
        p_token:                    token,
        p_full_legal_name:          form.full_legal_name.trim(),
        p_fathers_name:             form.fathers_name.trim(),
        p_dob:                      form.dob,
        p_mobile:                   form.mobile.replace(/\D/g, ''),
        p_personal_email:           form.personal_email.trim().toLowerCase(),
        p_address_line1:            form.address_line1.trim(),
        p_address_line2:            form.address_line2.trim() || null,
        p_city:                     form.city.trim(),
        p_district:                 form.district.trim() || null,
        p_state:                    form.state.trim(),
        p_pincode:                  form.pincode.trim(),
        p_pan_number:               form.pan_number.trim().toUpperCase(),
        p_aadhaar_number:           form.aadhaar_number.replace(/\D/g, ''),
        p_qualification:            form.qualification.trim(),
        p_bank_account_number:      form.bank_account_number.trim(),
        p_bank_name:                form.bank_name.trim(),
        p_bank_ifsc:                form.bank_ifsc.trim().toUpperCase(),
        p_emergency_contact_name:   form.emergency_contact_name.trim(),
        p_emergency_contact_phone:  form.emergency_contact_phone.replace(/\D/g, ''),
        p_emergency_contact_rel:    form.emergency_contact_rel.trim(),
        p_offer_pdf_url:            pdfUrl,
      })
      if (rpcErr) throw new Error(rpcErr.message || 'Submission failed')

      // Refetch to transition to accepted view
      const { data: fresh } = await supabase.rpc('fetch_offer_by_token', { p_token: token })
      const freshRow = Array.isArray(fresh) ? fresh[0] : fresh
      if (freshRow) setOffer(freshRow)
    } catch (err) {
      setSE(err.message || 'Something went wrong. Please try again.')
    } finally {
      setSub(false)
    }
  }

  // ─── Render paths ────────────────────────────────

  if (loading) {
    return (
      <Layout>
        <div style={{ textAlign: 'center', padding: 30, color: 'var(--text-muted)' }}>
          <Loader2 size={28} className="spin" style={{ marginBottom: 10 }} />
          <div>Loading offer…</div>
        </div>
      </Layout>
    )
  }

  if (loadErr) {
    return (
      <Layout>
        <div style={{ textAlign: 'center', padding: 20 }}>
          <AlertTriangle size={40} color="var(--danger)" style={{ marginBottom: 10 }} />
          <div style={{ fontWeight: 600, marginBottom: 6 }}>Link not valid</div>
          <div style={{ color: 'var(--text-muted)', fontSize: '.9rem' }}>{loadErr}</div>
          <div style={{ color: 'var(--text-muted)', fontSize: '.82rem', marginTop: 10 }}>
            If you believe this is a mistake, contact the person who shared the link with you.
          </div>
        </div>
      </Layout>
    )
  }

  const alreadyAccepted = offer.status === 'accepted' || offer.status === 'converted_to_user'
  if (alreadyAccepted) {
    return (
      <Layout>
        <div style={{ textAlign: 'center', padding: 10 }}>
          <CheckCircle2 size={44} color="var(--green)" style={{ marginBottom: 10 }} />
          <div style={{ fontWeight: 700, fontSize: '1.05rem', marginBottom: 6 }}>
            Offer accepted
          </div>
          <div style={{ color: 'var(--text-muted)', fontSize: '.9rem', marginBottom: 18 }}>
            Thank you, {offer.full_legal_name || offer.candidate_name}. Your
            signed offer letter has been generated. You can download a copy
            below.
          </div>
          {offer.offer_pdf_url && (
            <a
              className="btn btn-y"
              href={offer.offer_pdf_url}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Download size={15} style={{ marginRight: 6 }} />
              Download Offer Letter PDF
            </a>
          )}
          <div style={{ color: 'var(--text-muted)', fontSize: '.82rem', marginTop: 20 }}>
            Our HR team will be in touch with next steps.
          </div>
        </div>
      </Layout>
    )
  }

  // ── FILL-IN PATH ────────────────────────────────
  return (
    <Layout>
      {/* Offer summary */}
      <div style={{
        padding: 14,
        background: 'var(--subtle)',
        borderRadius: 8,
        marginBottom: 20,
      }}>
        <div style={{ fontSize: '.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.08em', fontWeight: 600, marginBottom: 6 }}>
          Offer for {offer.candidate_name}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, fontSize: '.88rem' }}>
          <div><strong>Position:</strong> {offer.position}</div>
          {offer.territory && <div><strong>Territory:</strong> {offer.territory}</div>}
          {offer.joining_date && <div><strong>Joining:</strong> {offer.joining_date}</div>}
          {offer.fixed_salary_monthly && (
            <div><strong>Salary:</strong> {formatCurrency(offer.fixed_salary_monthly)} / month</div>
          )}
        </div>
        {offer.incentive_text && (
          <div style={{ marginTop: 8, fontSize: '.84rem', color: 'var(--fg)' }}>
            <strong>Incentive:</strong> {offer.incentive_text}
          </div>
        )}
      </div>

      <form onSubmit={handleSubmit} noValidate>
        <SectionTitle>Personal Details</SectionTitle>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label="Full Legal Name" required error={errors.full_legal_name}>
            <input value={form.full_legal_name} onChange={e => set('full_legal_name', e.target.value)} className={errors.full_legal_name ? 'field-error' : ''} />
          </Field>
          <Field label="Father's Name" required error={errors.fathers_name}>
            <input value={form.fathers_name} onChange={e => set('fathers_name', e.target.value)} className={errors.fathers_name ? 'field-error' : ''} />
          </Field>
          <Field label="Date of Birth" required error={errors.dob}>
            <input type="date" value={form.dob} onChange={e => set('dob', e.target.value)} className={errors.dob ? 'field-error' : ''} />
          </Field>
          <Field label="Mobile" required error={errors.mobile} hint="10-digit Indian number">
            <input inputMode="numeric" value={form.mobile} onChange={e => set('mobile', e.target.value)} className={errors.mobile ? 'field-error' : ''} />
          </Field>
          <Field label="Personal Email" required error={errors.personal_email}>
            <input type="email" value={form.personal_email} onChange={e => set('personal_email', e.target.value)} className={errors.personal_email ? 'field-error' : ''} />
          </Field>
          <Field label="Qualification" required error={errors.qualification} hint="e.g. B.Com, MBA (Marketing)">
            <input value={form.qualification} onChange={e => set('qualification', e.target.value)} className={errors.qualification ? 'field-error' : ''} />
          </Field>
        </div>

        <SectionTitle>Address</SectionTitle>
        <Field label="Line 1" required error={errors.address_line1}>
          <input value={form.address_line1} onChange={e => set('address_line1', e.target.value)} className={errors.address_line1 ? 'field-error' : ''} />
        </Field>
        <Field label="Line 2">
          <input value={form.address_line2} onChange={e => set('address_line2', e.target.value)} />
        </Field>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 12 }}>
          <Field label="City" required error={errors.city}>
            <input value={form.city} onChange={e => set('city', e.target.value)} className={errors.city ? 'field-error' : ''} />
          </Field>
          <Field label="District">
            <input value={form.district} onChange={e => set('district', e.target.value)} />
          </Field>
          <Field label="State" required error={errors.state}>
            <input value={form.state} onChange={e => set('state', e.target.value)} className={errors.state ? 'field-error' : ''} />
          </Field>
          <Field label="Pincode" required error={errors.pincode}>
            <input inputMode="numeric" value={form.pincode} onChange={e => set('pincode', e.target.value)} className={errors.pincode ? 'field-error' : ''} />
          </Field>
        </div>

        <SectionTitle>Identification</SectionTitle>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label="PAN Number" required error={errors.pan_number} hint="AAAAA9999A">
            <input value={form.pan_number} onChange={e => set('pan_number', e.target.value.toUpperCase())} className={errors.pan_number ? 'field-error' : ''} />
          </Field>
          <Field label="Aadhaar Number" required error={errors.aadhaar_number} hint="12 digits">
            <input inputMode="numeric" value={form.aadhaar_number} onChange={e => set('aadhaar_number', e.target.value)} className={errors.aadhaar_number ? 'field-error' : ''} />
          </Field>
        </div>

        <SectionTitle>Bank Details (for salary credit)</SectionTitle>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
          <Field label="Account Number" required error={errors.bank_account_number}>
            <input value={form.bank_account_number} onChange={e => set('bank_account_number', e.target.value)} className={errors.bank_account_number ? 'field-error' : ''} />
          </Field>
          <Field label="Bank Name" required error={errors.bank_name}>
            <input value={form.bank_name} onChange={e => set('bank_name', e.target.value)} className={errors.bank_name ? 'field-error' : ''} />
          </Field>
          <Field label="IFSC" required error={errors.bank_ifsc}>
            <input value={form.bank_ifsc} onChange={e => set('bank_ifsc', e.target.value.toUpperCase())} className={errors.bank_ifsc ? 'field-error' : ''} />
          </Field>
        </div>

        <SectionTitle>Emergency Contact</SectionTitle>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
          <Field label="Name" required error={errors.emergency_contact_name}>
            <input value={form.emergency_contact_name} onChange={e => set('emergency_contact_name', e.target.value)} className={errors.emergency_contact_name ? 'field-error' : ''} />
          </Field>
          <Field label="Phone" required error={errors.emergency_contact_phone}>
            <input inputMode="numeric" value={form.emergency_contact_phone} onChange={e => set('emergency_contact_phone', e.target.value)} className={errors.emergency_contact_phone ? 'field-error' : ''} />
          </Field>
          <Field label="Relationship" required error={errors.emergency_contact_rel} hint="e.g. Father, Spouse">
            <input value={form.emergency_contact_rel} onChange={e => set('emergency_contact_rel', e.target.value)} className={errors.emergency_contact_rel ? 'field-error' : ''} />
          </Field>
        </div>

        {/* T&C acceptance */}
        <div style={{
          marginTop: 20, padding: 14,
          background: 'var(--subtle)', borderRadius: 8,
          border: errors.accepted ? '1px solid var(--danger)' : '1px solid var(--border)',
        }}>
          <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={form.accepted}
              onChange={e => set('accepted', e.target.checked)}
              style={{ marginTop: 3 }}
            />
            <span style={{ fontSize: '.88rem' }}>
              I confirm that the details provided above are true and
              correct. I have reviewed the offer terms shown at the
              top of this page and the standard employment clauses
              (confidentiality, probation, notice period, non-compete)
              that will be included in my offer letter, and I accept
              them. I understand that submitting this form constitutes
              a digital acceptance of the offer.
            </span>
          </label>
          {errors.accepted && (
            <p style={{ fontSize: '.78rem', color: 'var(--danger)', marginTop: 6 }}>
              {errors.accepted}
            </p>
          )}
        </div>

        {submitErr && (
          <div style={{
            marginTop: 14,
            background: 'rgba(229,57,53,.08)',
            border: '1px solid rgba(229,57,53,.25)',
            borderRadius: 8, padding: '11px 14px', fontSize: '.82rem',
            color: 'var(--danger)',
          }}>
            {submitErr}
          </div>
        )}

        <button
          type="submit"
          className="btn btn-y"
          disabled={submitting}
          style={{ marginTop: 18, width: '100%', padding: '12px 16px' }}
        >
          {submitting ? 'Submitting…' : 'Submit & Accept Offer'}
        </button>

        <div style={{ fontSize: '.76rem', color: 'var(--text-muted)', marginTop: 12, textAlign: 'center' }}>
          Your data is sent securely to Untitled Advertising. A copy of
          your signed offer letter will be available to download as
          soon as you submit.
        </div>
      </form>
    </Layout>
  )
}

function SectionTitle({ children }) {
  return (
    <div style={{
      fontSize: '.72rem', fontWeight: 700, color: 'var(--text-muted)',
      textTransform: 'uppercase', letterSpacing: '.1em',
      paddingBottom: 6, marginTop: 20, marginBottom: 12,
      borderBottom: '1px solid var(--border)',
    }}>
      {children}
    </div>
  )
}
