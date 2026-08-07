// src/components/govt/steps/Step2DateSigner.jsx
//
// Wizard Step 2 — proposal date + signer.
//
// Date defaults to today (editable). Signer dropdown is populated
// from users where signing_authority = true (Brijesh + Vishal at
// the time of writing, future-extensible by toggling the flag in
// Team management).
//
// Phase 101.C.JSX (2026-05-29) — agency role lock. When the wizard
// passes `agencyLocked={true}`:
//   • dropdown disabled
//   • selected value shown read-only with hint "Assigned by admin"
//   • when `agencyLockedReason='unassigned'` (no default_signer_user_id
//     on the agency's users row), render red banner with owner-locked
//     copy "Ask admin to assign your proposal signer." and disable Next.
// Non-agency callers omit both props → original free-pick behaviour
// byte-identical.

import { useMemo } from 'react'
import { Lock, AlertTriangle } from 'lucide-react'
import { useSigners } from '../../../hooks/useGovtMasters'

export function Step2DateSigner({
  data,
  onChange,
  agencyLocked = false,
  agencyLockedReason = null,   // 'admin' = signer assigned; 'unassigned' = no default
}) {
  const { signers, loading, error } = useSigners()
  const set = (field, value) => onChange({ [field]: value })

  // Phase 101.C.JSX — resolve the locked-signer display row from the
  // signers list. If the saved signer_user_id no longer matches any
  // active signing-authority user (admin demoted them), display
  // shows id-only fallback so the wizard doesn't blank-state.
  const lockedSigner = useMemo(
    () => signers.find(s => s.id === data.signer_user_id) || null,
    [signers, data.signer_user_id]
  )

  const showUnassignedBanner =
    agencyLocked && agencyLockedReason === 'unassigned'

  return (
    <div>
      <h2 className="govt-step__title">Date & Signer</h2>
      <p className="govt-step__sub">
        The date prints in the top-right corner of the letter.
        The signer's name + title + mobile prints at the bottom.
      </p>

      {showUnassignedBanner && (
        <div
          className="govt-master__warn"
          style={{
            marginBottom: 14,
            display: 'flex', alignItems: 'flex-start', gap: 8,
          }}
        >
          <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 2 }} />
          <span>Ask admin to assign your proposal signer.</span>
        </div>
      )}

      {/* Phase 140 — letter language. Default Gujarati; English is an
          opt-in per proposal. Drives which proposal_templates row the
          renderer uses + the renderer's own labels/digits/date. */}
      <div className="govt-field-row">
        <div className="govt-field">
          <label className="govt-field__label">Letter language</label>
          <select
            className="govt-field__select"
            value={data.proposal_language || 'gu'}
            onChange={e => set('proposal_language', e.target.value)}
          >
            <option value="gu">ગુજરાતી (Gujarati) — default</option>
            <option value="en">English</option>
          </select>
          <div className="govt-field__hint">
            The whole letter prints in this language. Gujarati is the default.
          </div>
        </div>
      </div>

      {/* Govt-team commission moved to the payment screen (owner 2026-08-07):
          the % is entered when a payment is added, not at quote-create. */}

      <div className="govt-field-row govt-field-row--2">
        <div className="govt-field">
          <label className="govt-field__label">Proposal date</label>
          <input
            type="date"
            className="govt-field__input"
            value={data.proposal_date || todayIso()}
            onChange={e => set('proposal_date', e.target.value)}
          />
          <div className="govt-field__hint">Defaults to today. Edit if backdating.</div>
        </div>

        <div className="govt-field">
          <label className="govt-field__label">
            Signed by
            {agencyLocked && (
              <span
                style={{
                  marginLeft: 8,
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  fontSize: 11, fontWeight: 600,
                  color: 'var(--text-muted)',
                  textTransform: 'none', letterSpacing: 0,
                }}
              >
                <Lock size={14} /> Assigned by admin
              </span>
            )}
          </label>
          {loading && <div className="govt-field__hint">Loading signers…</div>}
          {error && <div className="govt-field__error">Couldn't load signers.</div>}
          {!loading && !error && (
            <select
              className="govt-field__select"
              value={data.signer_user_id || ''}
              onChange={e => set('signer_user_id', e.target.value || null)}
              disabled={agencyLocked}
              style={agencyLocked ? { opacity: 0.7, cursor: 'not-allowed' } : undefined}
            >
              <option value="">— pick a signer —</option>
              {/* Phase 101.C.JSX — if the locked signer isn't in the
                  current useSigners() result (e.g. admin demoted them
                  but the saved value still references the id), include
                  a fallback option so the disabled <select> still
                  displays the chosen value rather than going blank. */}
              {agencyLocked && data.signer_user_id && !lockedSigner && (
                <option value={data.signer_user_id}>
                  Assigned signer (no longer active)
                </option>
              )}
              {signers.map(s => (
                <option key={s.id} value={s.id}>
                  {s.name} {s.signature_title ? `(${s.signature_title})` : ''}
                </option>
              ))}
            </select>
          )}
          <div className="govt-field__hint">
            {agencyLocked
              ? 'Locked by admin via Team settings.'
              : 'Anyone with signing-authority on Team. Brijesh + Vishal by default.'}
          </div>
        </div>
      </div>
    </div>
  )
}

function todayIso() {
  return new Date().toISOString().slice(0, 10)
}

// Phase 101.C.JSX — accept opts so the agency-without-default path
// surfaces the owner-locked copy "Ask admin to assign your proposal
// signer." instead of the generic "Pick a signer." Non-agency call
// sites omit opts → byte-identical behaviour.
export function validateStep2(data, opts = {}) {
  if (!data.proposal_date) return 'Proposal date is required.'
  if (!data.signer_user_id) {
    return opts.isAgency
      ? 'Ask admin to assign your proposal signer.'
      : 'Pick a signer.'
  }
  return null
}
