// src/components/govt/steps/Step2DateSigner.jsx
//
// Wizard Step 2 — proposal date + signer.
//
// Date defaults to today (editable). Signer dropdown is populated
// from users where signing_authority = true (Brijesh + Vishal at
// the time of writing, future-extensible by toggling the flag in
// Team management).

import { useSigners } from '../../../hooks/useGovtMasters'

export function Step2DateSigner({ data, onChange }) {
  const { signers, loading, error } = useSigners()
  const set = (field, value) => onChange({ [field]: value })

  return (
    <div>
      <h2 className="govt-step__title">Date & Signer</h2>
      <p className="govt-step__sub">
        The date prints in the top-right corner of the letter.
        The signer's name + title + mobile prints at the bottom.
      </p>

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
          <label className="govt-field__label">Signed by</label>
          {loading && <div className="govt-field__hint">Loading signers…</div>}
          {error && <div className="govt-field__error">Couldn't load signers.</div>}
          {!loading && !error && (
            <select
              className="govt-field__select"
              value={data.signer_user_id || ''}
              onChange={e => set('signer_user_id', e.target.value || null)}
            >
              <option value="">— pick a signer —</option>
              {signers.map(s => (
                <option key={s.id} value={s.id}>
                  {s.name} {s.signature_title ? `(${s.signature_title})` : ''}
                </option>
              ))}
            </select>
          )}
          <div className="govt-field__hint">
            Anyone with signing-authority on Team. Brijesh + Vishal by default.
          </div>
        </div>
      </div>
    </div>
  )
}

function todayIso() {
  return new Date().toISOString().slice(0, 10)
}

export function validateStep2(data) {
  if (!data.proposal_date) return 'Proposal date is required.'
  if (!data.signer_user_id) return 'Pick a signer.'
  return null
}
