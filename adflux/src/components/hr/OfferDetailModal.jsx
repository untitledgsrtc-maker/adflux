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

import { useState, useRef } from 'react'
import { X, Download, UserPlus, Copy, Check, MessageSquare, Mail, KeyRound } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useOffers, buildOfferUrl, STATUS_META } from '../../hooks/useOffers'
import { shortenUrl, openWhatsApp } from '../../utils/whatsapp'
import { formatCurrency } from '../../utils/formatters'
import { toastError } from '../v2/Toast'
import SendEmailModal from '../v2/SendEmailModal'

// Phase 109.4 — open a private PAN/Aadhaar card via a short-lived signed
// URL (the hr-offer-pii bucket is NOT public; staff-only SELECT RLS gates
// who can mint the URL).
const cardLinkStyle = {
  display: 'inline-flex', alignItems: 'center', gap: 6,
  background: 'none', border: 0, padding: 0, cursor: 'pointer',
  font: 'inherit', color: 'var(--accent, #FFE600)',
}
async function viewCard(path) {
  if (!path) return
  const { data, error } = await supabase.storage
    .from('hr-offer-pii')
    .createSignedUrl(path, 600)
  if (error || !data?.signedUrl) { toastError(error, 'Could not open the card.'); return }
  window.open(data.signedUrl, '_blank', 'noopener')
}

// Phase 307 - one-click Convert. A random temp password (no look-alike
// characters: no 0/O, 1/l/I) so HR never has to invent one.
function genPassword() {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
  const buf = new Uint32Array(8)
  crypto.getRandomValues(buf)
  return Array.from(buf, n => chars[n % chars.length]).join('')
}

function incentiveText(o, hasIncentive) {
  if (hasIncentive === false) return ''
  const mult = Number(o.incentive_sales_multiplier) || 5
  const nc   = +(((Number(o.incentive_new_client_rate) || 0.05) * 100).toFixed(2))
  const rr   = +(((Number(o.incentive_renewal_rate)    || 0.02) * 100).toFixed(2))
  const flat = Number(o.incentive_flat_bonus) || 0
  return `${mult}x salary target - ${nc}% on new-client revenue - ${rr}% on renewals`
       + (flat > 0 ? ` - flat bonus Rs ${flat.toLocaleString('en-IN')} above target` : '')
}

function loginMessage(d) {
  const first = (d.name || '').trim().split(/\s+/)[0] || 'there'
  return [
    `Hi ${first},`,
    '',
    'Welcome to Untitled Advertising! Your login is ready.',
    '',
    `App: ${d.appUrl}`,
    `Email: ${d.email}`,
    d.reused ? 'Password: use your existing password' : `Password: ${d.password}`,
    d.designation ? `Role: ${d.designation}` : null,
    d.salary > 0 ? `Fixed salary: Rs ${d.salary.toLocaleString('en-IN')} per month` : 'Pay: commission only',
    d.incentive ? `Incentive: ${d.incentive}` : null,
    '',
    'Please sign in and keep this message safe.',
  ].filter(l => l !== null).join('\n')
}

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
  const [password,   setPassword]   = useState(() => genPassword())
  const [existingUser, setExistingUser] = useState(null)
  const [checking, setChecking] = useState(false)
  // The password that was ACTUALLY applied to the login. admin_create_user never
  // overwrites an existing auth user's password, so once the first attempt has
  // created the login this value is the only one that works - lock it and use
  // it in the message. Kept in sessionStorage so Cancel/close + reopen after a
  // failed profile write can't lose or change it. Cleared on success.
  const pwKey = 'offerConvertPw:' + offer.id
  const savedPw = (() => { try { return sessionStorage.getItem(pwKey) } catch { return null } })()
  const appliedPwRef = useRef(savedPw)
  const reusedRef    = useRef(savedPw ? false : null)
  const [pwLocked, setPwLocked] = useState(!!savedPw)
  const [done, setDone] = useState(null)
  const [emailOpen, setEmailOpen] = useState(false)
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

    const email = (offer.candidate_email || '').trim().toLowerCase()
    const name  = offer.full_legal_name || offer.candidate_name

    // Phase 285 — mint the user with the RIGHT role from the offer's
    // designation, not a hardcoded 'sales'. hr_offers carries snapshot
    // fields (designation_auth_role / _team_role / _has_incentive /
    // _name, added by supabase_phase285). Resolution order:
    //   1. the offer's snapshot (Phase-285+ offers),
    //   2. the legacy sales default (pre-Phase-285 offers — all were sales).
    // Matches the correct pattern in pages/v2/HRNewUserV2.jsx.
    const authRole     = offer.designation_auth_role || null
    const teamRole     = offer.designation_team_role || null
    const hasIncentive = offer.designation_has_incentive
    const desigName    = offer.designation_name || null

    const pRole     = authRole || 'sales'
    const pTeamRole = teamRole || 'sales'
    // CLAUDE.md §8 — segment scope on users.segment_access applies ONLY to
    // roles sales + telecaller; every other role = ALL. Compute from the
    // resolved role (a govt hire keeps ALL, not the old hardcoded PRIVATE).
    const pSegment  = (pRole === 'sales' || pRole === 'telecaller') ? 'PRIVATE' : 'ALL'
    // Seed the sales incentive profile only for incentive-earning roles.
    // has_incentive === false (flat-salary ops/accounts/etc) → skip it;
    // null (legacy sales offer) or true → seed the sales profile below.
    const seedIncentive = hasIncentive !== false

    // Phase 109.5 — create the user via the idempotent admin_create_user
    // RPC instead of client signUp. signUp threw "User already registered"
    // whenever the auth user already existed — e.g. a prior convert that
    // created the auth user but failed before flipping the offer status,
    // leaving the offer stuck on 'accepted' and impossible to retry. The
    // RPC REUSES an existing auth user by email AND writes the
    // public.users row server-side (past the client INSERT RLS), so
    // convert is now safely re-runnable and self-heals a half-done one.
    // (admin_create_user keeps the admin's session — no signUp/signOut.)
    const { data: created, error: rpcErr } = await supabase.rpc('admin_create_user', {
      p_email:            email,
      p_password:         appliedPwRef.current ?? password,
      p_name:             name,
      p_role:             pRole,
      p_team_role:        pTeamRole,
      // Give the created user the offer's real designation, not a
      // sales-shaped one (designation snapshot → offer position → null).
      p_designation:      desigName || offer.position || null,
      p_signature_mobile: offer.mobile || null,
      // Phase 161 — a converted rep needs a city for the TA/DA claim window +
      // DA/Hotel ceilings. An offer with no city used to make a city-less rep
      // whose claim window broke (Mayur). Fall back to Vadodara so it's never
      // null; HR can correct in Team.
      p_city:             offer.city || 'Vadodara',
      p_segment_access:   pSegment,
    })

    if (rpcErr) {
      setConvertErr(rpcErr.message || 'Failed to create user')
      setConverting(false)
      return
    }

    const userId = created?.id
    if (!userId) {
      setConvertErr('User creation failed — no user ID returned')
      setConverting(false)
      return
    }

    // First successful create: remember the password that really went in and
    // whether the login pre-existed. Later retries keep these (never re-derived).
    if (appliedPwRef.current == null) {
      appliedPwRef.current = password
      reusedRef.current    = !!existingUser
      try { sessionStorage.setItem(pwKey, password) } catch { /* ignore */ }
      setPwLocked(true)
    }

    // Phase 307 - ALWAYS write the salary profile (a flat-salary hire's fixed
    // pay was silently dropped before) and NEVER overwrite a salary already
    // on file (Phase 327 audit: a convert re-run used to reset it). Incentive
    // terms come from the SIGNED offer; non-incentive roles get zeros.
    const salaryNum = Number(offer.fixed_salary_monthly) || 0
    let profileErr = null
    {
      const { data: existingProf, error: exErr } = await supabase
        .from('staff_incentive_profiles')
        .select('id, monthly_salary')
        .eq('user_id', userId)
        .maybeSingle()
      if (exErr) {
        profileErr = exErr.message
      } else if (!(existingProf && Number(existingProf.monthly_salary) > 0)) {
        const payload = {
          user_id:        userId,
          monthly_salary: salaryNum,
          join_date:      offer.joining_date || new Date().toISOString().split('T')[0],
          is_active:      true,
        }
        if (seedIncentive) {
          payload.sales_multiplier = Number(offer.incentive_sales_multiplier) || 5
          payload.new_client_rate  = Number(offer.incentive_new_client_rate)  || 0.05
          payload.renewal_rate     = Number(offer.incentive_renewal_rate)     || 0.02
          payload.flat_bonus       = Number(offer.incentive_flat_bonus)       || 0
        } else {
          payload.sales_multiplier = 0
          payload.new_client_rate  = 0
          payload.renewal_rate     = 0
          payload.flat_bonus       = 0
        }
        const { error: profErr } = await supabase
          .from('staff_incentive_profiles')
          .upsert([payload], { onConflict: 'user_id' })
        if (profErr) profileErr = profErr.message
      }
    }
    if (profileErr) {
      // Stop BEFORE linking: Convert is safe to press again (the login is
      // reused, the password below is unchanged) - never leave a hire with a
      // login but no pay profile and a "converted" offer.
      setConvertErr('Login created, but the salary profile did not save: ' + profileErr
        + ' - press Convert again to retry (safe), or set it in People > Team.')
      setConverting(false)
      return
    }

    // Auto-start the hire's onboarding from their role template (best-effort;
    // no template for the role -> returns null, no error).
    const { error: obErr } = await supabase.rpc('create_onboarding_run', { p_user_id: userId })
    if (obErr) console.warn('[offer-convert] onboarding run failed:', obErr.message)

    // Link the offer back to the user.
    const { error: linkErr } = await updateOffer(offer.id, {
      converted_user_id: userId,
      converted_at:      new Date().toISOString(),
      status:            'converted_to_user',
    })
    setConverting(false)

    if (linkErr) {
      setConvertErr('User was created but linking to the offer failed: ' + linkErr.message
        + ' - press Convert again to retry (safe).')
      return
    }

    // Stay open: HR now sends the login (WhatsApp / email) from here.
    try { sessionStorage.removeItem(pwKey) } catch { /* ignore */ }
    setShowConvertForm(false)
    setDone({
      name:        name,
      email,
      password:    appliedPwRef.current,
      reused:      !!reusedRef.current,
      appUrl:      window.location.origin,
      designation: desigName || offer.position || '',
      salary:      salaryNum,
      incentive:   incentiveText(offer, hasIncentive),
    })
    onChanged?.()
  }

  async function openConvert() {
    setConvertErr('')
    setShowConvertForm(true)
    if (appliedPwRef.current != null) return   // login already created by an earlier attempt
    const em = (offer.candidate_email || '').trim().toLowerCase()
    if (!em) return
    setChecking(true)
    // users.email is stored lowercased by admin_create_user -> exact match
    // (ilike would treat "_" in an address as a wildcard).
    const { data, error } = await supabase
      .from('users').select('id').eq('email', em).limit(1)
    setExistingUser(!error && data && data.length ? data[0] : null)
    setChecking(false)
  }

  async function copyLogin() {
    const text = loginMessage(done)
    try { await navigator.clipboard.writeText(text); setCopiedKey('login'); setTimeout(() => setCopiedKey(null), 1600) }
    catch { window.prompt('Copy this message:', text) }
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
                {offer.pan_card_path && (
                  <Row label="PAN Card" value={
                    <button type="button" onClick={() => viewCard(offer.pan_card_path)} style={cardLinkStyle}>
                      <Download size={14} /> View PAN card
                    </button>
                  } />
                )}
                {offer.aadhaar_card_path && (
                  <Row label="Aadhaar Card" value={
                    <button type="button" onClick={() => viewCard(offer.aadhaar_card_path)} style={cardLinkStyle}>
                      <Download size={14} /> View Aadhaar card
                    </button>
                  } />
                )}
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

          {done && (
            <div style={{
              marginTop: 12, padding: 14,
              border: '1px solid var(--brd)', borderRadius: 8,
              background: 'rgba(34,197,94,.06)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600, fontSize: '.92rem', marginBottom: 8 }}>
                <KeyRound size={16} /> Login created for {done.name}
              </div>
              <pre style={{
                margin: '0 0 10px', padding: 10, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                background: 'rgba(0,0,0,.18)', borderRadius: 6, fontSize: '.8rem',
                fontFamily: 'inherit', lineHeight: 1.5,
              }}>{loginMessage(done)}</pre>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button className="btn btn-y" disabled={!offer.mobile}
                  title={offer.mobile ? '' : 'No mobile number on this offer'}
                  onClick={() => openWhatsApp(offer.mobile, loginMessage(done))}>
                  <MessageSquare size={14} style={{ marginRight: 6 }} /> Send on WhatsApp
                </button>
                <button className="btn btn-ghost" onClick={() => setEmailOpen(true)}>
                  <Mail size={14} style={{ marginRight: 6 }} /> Send by email
                </button>
                <button className="btn btn-ghost" onClick={copyLogin}>
                  {copiedKey === 'login' ? <><Check size={14} /> Copied</> : <><Copy size={14} /> Copy</>}
                </button>
              </div>
              <div style={{ fontSize: '.74rem', color: 'var(--gray)', marginTop: 8 }}>
                {done.reused
                  ? 'This person already had a login, so their password was not changed.'
                  : 'Keep this message - the password is not shown again after you close this window.'}
              </div>
            </div>
          )}

          {/* Convert-to-user panel */}
          {isAccepted && !done && (
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
                    user account for <strong>{offer.full_legal_name || offer.candidate_name}</strong>.
                  </div>
                  <button className="btn btn-y" onClick={openConvert}>
                    <UserPlus size={15} style={{ marginRight: 6 }} />
                    Convert to User
                  </button>
                </>
              ) : (
                <>
                  <div style={{ fontSize: '.88rem', fontWeight: 600, marginBottom: 10 }}>
                    Confirm and create the login
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
                    <Row label="Name" value={offer.full_legal_name || offer.candidate_name} />
                    <Row label="Login email" value={offer.candidate_email} />
                    <Row label="Mobile (WhatsApp)" value={offer.mobile} />
                    <Row label="Role" value={offer.designation_name || offer.position} />
                    <Row label="Joining date" value={offer.joining_date
                      ? new Date(offer.joining_date).toLocaleDateString('en-IN') : ''} />
                    <Row label="City" value={offer.city || 'Vadodara'} />
                    <Row label="Fixed salary" value={Number(offer.fixed_salary_monthly) > 0
                      ? formatCurrency(Number(offer.fixed_salary_monthly)) + ' / month'
                      : 'Commission only (no fixed salary)'} />
                    <Row label="Incentive" value={offer.designation_has_incentive === false
                      ? 'None (fixed-salary role)' : incentiveText(offer, offer.designation_has_incentive)} />
                  </div>
                  {existingUser && !pwLocked && (
                    <div style={{
                      background: 'rgba(245,158,11,.10)', border: '1px solid rgba(245,158,11,.35)',
                      borderRadius: 6, padding: 8, fontSize: '.8rem', color: 'var(--fg)', marginBottom: 8,
                    }}>
                      This email already has a login. Convert will link it and keep
                      its <strong>existing password</strong> (the one below is ignored).
                    </div>
                  )}
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
                  <div style={{ fontSize: '.74rem', color: 'var(--gray)', marginBottom: 4 }}>
                    {pwLocked ? 'Login already created - this password is locked in' : 'Temporary password (auto-generated - change it if you like)'}
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input
                      type="text"
                      value={pwLocked ? (appliedPwRef.current || '') : password}
                      onChange={e => setPassword(e.target.value)}
                      disabled={converting || !!existingUser || pwLocked}
                      style={{ flex: 1 }}
                    />
                    <button className="btn btn-ghost" onClick={() => setShowConvertForm(false)} disabled={converting}>
                      Cancel
                    </button>
                    <button className="btn btn-y" onClick={handleConvert} disabled={converting || checking}>
                      {converting ? 'Creating...' : (checking ? 'Checking...' : 'Convert & create login')}
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
              Converted to a user{offer.converted_at
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
      {done && (
        <SendEmailModal
          open={emailOpen}
          onClose={() => setEmailOpen(false)}
          kind="offer"
          title="Send login details"
          defaultTo={done.email}
          defaultSubject="Your Untitled Advertising login"
          defaultBody={loginMessage(done)}
          relatedId={offer.id}
        />
      )}
    </div>
  )
}
