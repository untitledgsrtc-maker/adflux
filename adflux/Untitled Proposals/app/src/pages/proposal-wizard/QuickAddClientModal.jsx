// =====================================================================
// Inline "+ Add new client" modal for Step 1.
// Calls create_client_minimal RPC, then returns the new row to the
// caller so the wizard can immediately select it.
// =====================================================================

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { quickAddClient, qk } from '@/lib/proposalApi';
import { isValidGstin } from '@/lib/format';

export default function QuickAddClientModal({ onClose, onAdded }) {
  const qc = useQueryClient();
  const [name_en, setNameEn] = useState('');
  const [name_gu, setNameGu] = useState('');
  const [is_government, setIsGovt] = useState(true);
  const [gst_number, setGst] = useState('');
  const [department_en, setDeptEn] = useState('');
  const [department_gu, setDeptGu] = useState('');
  const [errors, setErrors] = useState({});

  const mut = useMutation({
    mutationFn: quickAddClient,
    onSuccess: (newClient) => {
      qc.invalidateQueries({ queryKey: qk.clients() });
      onAdded?.(newClient);
      onClose?.();
    },
  });

  function handleSave(e) {
    e.preventDefault();
    const errs = {};
    if (!name_en.trim()) errs.name_en = 'Required';
    if (!name_gu.trim()) errs.name_gu = 'જરૂરી';
    if (gst_number && !isValidGstin(gst_number.toUpperCase())) errs.gst_number = 'Invalid GSTIN format';
    if (Object.keys(errs).length) { setErrors(errs); return; }
    setErrors({});
    mut.mutate({
      name_en: name_en.trim(),
      name_gu: name_gu.trim(),
      is_government,
      gst_number: gst_number ? gst_number.toUpperCase().trim() : null,
      department_en: department_en.trim(),
      department_gu: department_gu.trim(),
    });
  }

  return (
    <div className="up-modal__backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <form className="up-modal up-stack-4" onSubmit={handleSave}>
        <h3 style={{ margin: 0 }}>Add client (quick)</h3>
        <p className="up-field__hint" style={{ marginTop: -8 }}>
          Minimum-fields-only insert. You can fill the rest from the Clients page later.
        </p>

        <div className="up-grid-2">
          <div className="up-field">
            <label className="up-field__label">Name (English)</label>
            <input className={`up-input ${errors.name_en ? 'up-input--invalid' : ''}`}
                   value={name_en} onChange={(e) => setNameEn(e.target.value)} autoFocus />
            {errors.name_en && <div className="up-field__error">{errors.name_en}</div>}
          </div>
          <div className="up-field">
            <label className="up-field__label up-gu">નામ (ગુજરાતી)</label>
            <input className={`up-input up-gu ${errors.name_gu ? 'up-input--invalid' : ''}`}
                   value={name_gu} onChange={(e) => setNameGu(e.target.value)} />
            {errors.name_gu && <div className="up-field__error">{errors.name_gu}</div>}
          </div>
        </div>

        <div className="up-grid-2">
          <div className="up-field">
            <label className="up-field__label">Department (English)</label>
            <input className="up-input" value={department_en} onChange={(e) => setDeptEn(e.target.value)} />
          </div>
          <div className="up-field">
            <label className="up-field__label up-gu">વિભાગ (ગુજરાતી)</label>
            <input className="up-input up-gu" value={department_gu} onChange={(e) => setDeptGu(e.target.value)} />
          </div>
        </div>

        <div className="up-grid-2">
          <div className="up-field">
            <label className="up-field__label">Client type</label>
            <select className="up-select"
                    value={is_government ? 'GOV' : 'PRIVATE'}
                    onChange={(e) => setIsGovt(e.target.value === 'GOV')}>
              <option value="GOV">Government / PSU</option>
              <option value="PRIVATE">Private / Commercial</option>
            </select>
          </div>
          <div className="up-field">
            <label className="up-field__label">GSTIN (optional)</label>
            <input className={`up-input ${errors.gst_number ? 'up-input--invalid' : ''}`}
                   value={gst_number}
                   onChange={(e) => setGst(e.target.value.toUpperCase())}
                   placeholder="22AAAAA0000A1Z5" maxLength={15} />
            {errors.gst_number && <div className="up-field__error">{errors.gst_number}</div>}
          </div>
        </div>

        {mut.error && (
          <div className="up-field__error" role="alert">
            Save failed: {String(mut.error.message || mut.error)}
          </div>
        )}

        <div className="up-row up-row--end" style={{ marginTop: 12 }}>
          <button type="button" className="up-btn up-btn--ghost" onClick={onClose} disabled={mut.isPending}>
            Cancel
          </button>
          <button type="submit" className="up-btn up-btn--primary" disabled={mut.isPending}>
            {mut.isPending ? 'Saving…' : 'Add client'}
          </button>
        </div>
      </form>
    </div>
  );
}
