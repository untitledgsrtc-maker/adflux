// src/components/govt/steps/Step1Client.jsx
//
// Wizard Step 1 — recipient client + multi-line address block.
//
// Used by BOTH the Auto Hood and GSRTC LED wizards (the shape of the
// recipient block is identical — Government department + address).
// The recipient_block stored on the quotes row is the SNAPSHOT that
// gets rendered on the letter, so a future client edit doesn't
// rewrite history.
//
// We deliberately keep this simpler than the AdFlux private wizard:
// no phone autocomplete, no GST field, no notes. Government clients
// are typed in by hand once and re-used by ref-by-name. Sprint 3 can
// add a govt-clients picker if the workflow demands it.

export function Step1Client({ data, onChange }) {
  const set = (field, value) => onChange({ [field]: value })

  return (
    <div>
      <h2 className="govt-step__title">Recipient (વિભાગ)</h2>
      <p className="govt-step__sub">
        This block prints at the top-left of the proposal letter, exactly
        as you type it here. Use the same format as your existing letters —
        4-6 lines, Gujarati script welcome.
      </p>

      <div className="govt-field-row govt-field-row--2">
        <div className="govt-field">
          <label className="govt-field__label">Department / Recipient name</label>
          <input
            type="text"
            className="govt-field__input"
            placeholder="e.g. નિયામકશ્રી, (અનુસૂચિત જાતિ કલ્યાણ)"
            value={data.client_name || ''}
            onChange={e => set('client_name', e.target.value)}
          />
          <div className="govt-field__hint">Appears as the first line of the recipient block.</div>
        </div>
        <div className="govt-field">
          <label className="govt-field__label">Sub-department (optional)</label>
          <input
            type="text"
            className="govt-field__input"
            placeholder="e.g. ગુજરાત સરકાર"
            value={data.client_company || ''}
            onChange={e => set('client_company', e.target.value)}
          />
          <div className="govt-field__hint">Optional second line — leave blank if not needed.</div>
        </div>
      </div>

      <div className="govt-field">
        <label className="govt-field__label">Full address (multi-line)</label>
        <textarea
          className="govt-field__textarea"
          rows={5}
          placeholder={'e.g.\nબ્લોક નંબર - ૪, રજો માળ\nડૉ. જીવરાજ મહેતા ભવન\nગાંધીનગર, ગુજરાત'}
          value={data.client_address || ''}
          onChange={e => set('client_address', e.target.value)}
        />
        <div className="govt-field__hint">
          Each line breaks where you press Enter. Prints exactly as you type it.
        </div>
      </div>

      <div className="govt-field-row govt-field-row--2">
        <div className="govt-field">
          <label className="govt-field__label">Contact phone (optional)</label>
          <input
            type="text"
            className="govt-field__input"
            placeholder="e.g. 079-XXXXXXXX"
            value={data.client_phone || ''}
            onChange={e => set('client_phone', e.target.value)}
          />
        </div>
        <div className="govt-field">
          <label className="govt-field__label">Contact email (optional)</label>
          <input
            type="email"
            className="govt-field__input"
            placeholder="department@gujarat.gov.in"
            value={data.client_email || ''}
            onChange={e => set('client_email', e.target.value)}
          />
        </div>
      </div>
    </div>
  )
}

export function validateStep1(data) {
  if (!data.client_name?.trim()) return 'Recipient name is required.'
  if (!data.client_address?.trim()) return 'Address is required (it prints on the letter).'
  return null
}
