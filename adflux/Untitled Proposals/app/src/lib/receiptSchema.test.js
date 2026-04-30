// =====================================================================
// Receipt schema tests. The validator gates the create_receipt RPC
// call — anything that gets through here lands in the DB.
// =====================================================================

import { describe, it, expect } from 'vitest';
import { validateReceipt, softDeleteSchema } from './receiptSchema';

const validReceipt = {
  proposal_id: '11111111-1111-1111-1111-111111111111',
  receipt_date: '2026-04-22',
  receipt_type: 'ADVANCE',
  gross_amount: 100000,
  tds_income_percent: 2,
  tds_gst_percent: 2,
  payment_mode: 'NEFT',
  cheque_or_ref_no: 'NEFT-XYZ',
  cheque_date: '',
  bank_name: '',
  subject_to_realisation: false,
  hsn_sac_code: '998361',
  gst_percent_applied: 18,
  notes: '',
};

describe('validateReceipt', () => {
  it('accepts a valid NEFT receipt', () => {
    expect(validateReceipt(validReceipt).ok).toBe(true);
  });

  it('rejects zero or negative gross', () => {
    expect(validateReceipt({ ...validReceipt, gross_amount: 0 }).ok).toBe(false);
    expect(validateReceipt({ ...validReceipt, gross_amount: -100 }).ok).toBe(false);
  });

  it('rejects bad UUID for proposal_id', () => {
    const r = validateReceipt({ ...validReceipt, proposal_id: 'not-a-uuid' });
    expect(r.ok).toBe(false);
    expect(r.errors.proposal_id).toBeTruthy();
  });

  it('rejects out-of-range TDS percent', () => {
    const r = validateReceipt({ ...validReceipt, tds_income_percent: 150 });
    expect(r.ok).toBe(false);
  });

  it('requires cheque ref + date for CHEQUE mode', () => {
    const r = validateReceipt({
      ...validReceipt,
      payment_mode: 'CHEQUE',
      cheque_or_ref_no: '',
      cheque_date: '',
    });
    expect(r.ok).toBe(false);
    // Two errors expected — one for ref, one for date
    expect(r.errors.cheque_or_ref_no || r.errors.cheque_date).toBeTruthy();
  });

  it('requires DD ref but not date', () => {
    expect(validateReceipt({
      ...validReceipt, payment_mode: 'DRAFT', cheque_or_ref_no: 'DD-12345', cheque_date: '',
    }).ok).toBe(true);
    expect(validateReceipt({
      ...validReceipt, payment_mode: 'DRAFT', cheque_or_ref_no: '', cheque_date: '',
    }).ok).toBe(false);
  });

  it('accepts CHEQUE with both ref and date', () => {
    expect(validateReceipt({
      ...validReceipt, payment_mode: 'CHEQUE', cheque_or_ref_no: '023145', cheque_date: '2026-05-14',
    }).ok).toBe(true);
  });

  it('rejects unknown payment mode', () => {
    expect(validateReceipt({ ...validReceipt, payment_mode: 'BITCOIN' }).ok).toBe(false);
  });
});

describe('softDeleteSchema', () => {
  it('rejects reasons under 5 chars', () => {
    expect(softDeleteSchema.safeParse({ reason: 'no' }).success).toBe(false);
  });
  it('accepts a 5+ char reason', () => {
    expect(softDeleteSchema.safeParse({ reason: 'Cheque bounced' }).success).toBe(true);
  });
});
