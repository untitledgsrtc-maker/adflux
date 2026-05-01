// =====================================================================
// Add Receipt modal. Pre-fills TDS percents from the client's defaults
// (client.default_tds_income_percent / _gst_percent), falling back to
// 2/2 if NULL.
//
// Live-shows net amount = gross − tds_income − tds_gst, exactly the
// way the DB trigger will compute it.
// =====================================================================

import { useEffect, useState } from 'react';
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { createReceipt, qkRcpt } from '@/lib/receiptApi';
import { qk } from '@/lib/proposalApi';
import { validateReceipt, RECEIPT_TYPES, PAYMENT_MODES } from '@/lib/receiptSchema';
import { calcReceiptTds } from '@/lib/calc';
import { fmtInrPlain } from '@/lib/format';
import { supabase } from '@/lib/supabase';

const todayIso = () => new Date().toISOString().slice(0, 10);

// Suggest a receipt_type based on running totals
function suggestType({ proposal, gross }) {
  if (!proposal) return 'ADVANCE';
  const expected = Number(proposal.po_amount || proposal.total_amount || 0);
  const got = Number(proposal.total_gross_received || 0);
  const remaining = expected - got;
  const newGot = got + Number(gross || 0);
  if (got === 0 && Number(gross || 0) >= expected) return 'FULL_PAYMENT';
  if (got === 0) return 'ADVANCE';
  if (newGot >= expected) return 'FINAL_PAYMENT';
  return 'PART_PAYMENT';
}

export default function ReceiptForm({ proposal, onClose, onSaved }) {
  const qc = useQueryClient();

  // Look up the client's TDS defaults so we can prefill — RLS allows
  // any authenticated user to read clients basics.
  const clientQ = useQuery({
    queryKey: ['client-tds-defaults', proposal?.id],
    enabled: !!proposal?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('proposals')
        .select('client_id, clients:client_id(default_tds_income_percent, default_tds_gst_percent)')
        .eq('id', proposal.id)
        .maybeSingle();
      if (error) throw error;
      return data?.clients ?? null;
    },
  });

  const [form, setForm] = useState({
    proposal_id: proposal?.id ?? '',
    receipt_date: todayIso(),
    receipt_type: 'ADVANCE',
    gross_amount: '',
    tds_income_percent: 2,
    tds_gst_percent: 2,
    payment_mode: 'NEFT',
    cheque_or_ref_no: '',
    cheque_date: '',
    bank_name: '',
    subject_to_realisation: true,
    hsn_sac_code: '998361',
    gst_percent_applied: 18,
    notes: '',
  });
  const [errors, setErrors] = useState({});

  // Apply TDS defaults when client data arrives
  useEffect(() => {
    const c = clientQ.data;
    if (!c) return;
    setForm((f) => ({
      ...f,
      tds_income_percent: c.default_tds_income_percent ?? f.tds_income_percent,
      tds_gst_percent:    c.default_tds_gst_percent ?? f.tds_gst_percent,
    }));
  }, [clientQ.data]);

  // Auto-suggest receipt_type as gross changes
  useEffect(() => {
    setForm((f) => ({ ...f, receipt_type: suggestType({ proposal, gross: f.gross_amount }) }));
  }, [proposal, form.gross_amount]); // eslint-disable-line react-hooks/exhaustive-deps

  function set(field) {
    return (e) => setForm((f) => ({ ...f, [field]: e.target?.value ?? e }));
  }

  const tds = calcReceiptTds({
    gross: Number(form.gross_amount) || 0,
    tdsIncomePercent: Number(form.tds_income_percent) || 0,
    tdsGstPercent: Number(form.tds_gst_percent) || 0,
  });

  const mut = useMutation({
    mutationFn: createReceipt,
    onSuccess: (row) => {
      qc.invalidateQueries({ queryKey: qkRcpt.receiptsByProposal(form.proposal_id) });
      qc.invalidateQueries({ queryKey: qkRcpt.receipts() });
      qc.invalidateQueries({ queryKey: qk.proposal(form.proposal_id) });
      qc.invalidateQueries({ queryKey: qk.proposals() });
      onSaved?.(row);
      onClose?.();
    },
  });

  function handleSubmit(e) {
    e.preventDefault();
    const r = validateReceipt(form);
    if (!r.ok) { setErrors(r.errors); return; }
    setErrors({});
    mut.mutate(r.value);
  }

  const isCheque = form.payment_mode === 'CHEQUE';
  const isDD = form.payment_mode === 'DRAFT';

  return (
    <div className="up-modal__backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <form className="up-modal up-stack-4" onSubmit={handleSubmit} style={{ maxWidth: 720 }}>
        <div className="up-row up-row--between" style={{ alignItems: 'flex-start' }}>
          <div>
            <h3 style={{ margin: 0 }}>Record receipt</h3>
            {proposal && (
              <div className="up-field__hint">
                Against <strong>{proposal.ref_no}</strong> · {proposal.client_name_snapshot}
                {' · Outstanding: ₹'}
                {fmtInrPlain(Number(proposal.po_amount || proposal.total_amount || 0) - Number(proposal.total_gross_received || 0))}
              </div>
            )}
          </div>
        </div>

        <div className="up-grid-3">
          <div className="up-field">
            <label className="up-field__label">Date</label>
            <input type="date" className="up-input"
                   value={form.receipt_date} onChange={set('receipt_date')} />
          </div>
          <div className="up-field">
            <label className="up-field__label">Type</label>
            <select className="up-select" value={form.receipt_type} onChange={set('receipt_type')}>
              {RECEIPT_TYPES.map((t) => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}
            </select>
          </div>
          <div className="up-field">
            <label className="up-field__label">Mode</label>
            <select className="up-select" value={form.payment_mode} onChange={set('payment_mode')}>
              {PAYMENT_MODES.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
        </div>

        <div className="up-field">
          <label className="up-field__label">Gross amount (₹)</label>
          <input type="number" step="0.01" className={`up-input ${errors.gross_amount ? 'up-input--invalid' : ''}`}
                 value={form.gross_amount}
                 onChange={set('gross_amount')}
                 placeholder="e.g. 100000" autoFocus />
          {errors.gross_amount && <div className="up-field__error">{errors.gross_amount}</div>}
        </div>

        <div className="up-grid-2">
          <div className="up-field">
            <label className="up-field__label">TDS — Income Tax (sec 194C) %</label>
            <input type="number" step="0.01" className="up-input"
                   value={form.tds_income_percent}
                   onChange={set('tds_income_percent')} />
          </div>
          <div className="up-field">
            <label className="up-field__label">TDS — GST (sec 51) %</label>
            <input type="number" step="0.01" className="up-input"
                   value={form.tds_gst_percent}
                   onChange={set('tds_gst_percent')} />
          </div>
        </div>

        {(isCheque || isDD) && (
          <div className="up-grid-2">
            <div className="up-field">
              <label className="up-field__label">{isCheque ? 'Cheque no.' : 'DD no.'}</label>
              <input className={`up-input ${errors.cheque_or_ref_no ? 'up-input--invalid' : ''}`}
                     value={form.cheque_or_ref_no} onChange={set('cheque_or_ref_no')} />
              {errors.cheque_or_ref_no && <div className="up-field__error">{errors.cheque_or_ref_no}</div>}
            </div>
            <div className="up-field">
              <label className="up-field__label">{isCheque ? 'Cheque date' : 'DD date'}</label>
              <input type="date" className={`up-input ${errors.cheque_date ? 'up-input--invalid' : ''}`}
                     value={form.cheque_date} onChange={set('cheque_date')} />
              {errors.cheque_date && <div className="up-field__error">{errors.cheque_date}</div>}
            </div>
          </div>
        )}

        {!isCheque && !isDD && form.payment_mode !== 'CASH' && (
          <div className="up-field">
            <label className="up-field__label">Reference no. (optional)</label>
            <input className="up-input"
                   value={form.cheque_or_ref_no} onChange={set('cheque_or_ref_no')}
                   placeholder="UTR / UPI ref" />
          </div>
        )}

        {(isCheque || isDD || form.payment_mode === 'NEFT' || form.payment_mode === 'RTGS') && (
          <div className="up-field">
            <label className="up-field__label">Bank (optional)</label>
            <input className="up-input"
                   value={form.bank_name} onChange={set('bank_name')}
                   placeholder="State Bank of India, Vadodara Main" />
          </div>
        )}

        {(isCheque || isDD) && (
          <label className="up-row" style={{ gap: 8 }}>
            <input type="checkbox" checked={form.subject_to_realisation}
                   onChange={(e) => setForm((f) => ({ ...f, subject_to_realisation: e.target.checked }))} />
            <span>Subject to realisation</span>
          </label>
        )}

        <div className="up-card" style={{ background: 'var(--up-bg-tint)', padding: 12 }}>
          <strong>Net to bank: ₹ {fmtInrPlain(tds.net)}</strong>
          <div className="up-field__hint">
            Gross ₹{fmtInrPlain(tds.gross)} − Income TDS ₹{fmtInrPlain(tds.tdsIncome)}
            {' '}− GST TDS ₹{fmtInrPlain(tds.tdsGst)} = ₹{fmtInrPlain(tds.net)}
          </div>
        </div>

        <div className="up-field">
          <label className="up-field__label">Notes (optional)</label>
          <textarea className="up-textarea" rows={2}
                    value={form.notes} onChange={set('notes')} />
        </div>

        {mut.error && (
          <div className="up-field__error" role="alert">
            Save failed: {String(mut.error.message || mut.error)}
          </div>
        )}

        <div className="up-row up-row--end" style={{ marginTop: 8 }}>
          <button type="button" className="up-btn up-btn--ghost" onClick={onClose} disabled={mut.isPending}>
            Cancel
          </button>
          <button type="submit" className="up-btn up-btn--primary" disabled={mut.isPending}>
            {mut.isPending ? 'Saving…' : 'Record receipt'}
          </button>
        </div>
      </form>
    </div>
  );
}
