// =====================================================================
// Per-step schema validation tests. The wizard relies on these to gate
// nextStep — bugs here would let invalid data through to the RPC.
// =====================================================================

import { describe, it, expect } from 'vitest';
import { validateStep } from './proposalSchema';

const validStep1 = {
  client_id: '11111111-1111-1111-1111-111111111111',
  media_id:  '22222222-2222-2222-2222-222222222222',
  media_code: 'AUTO',
  rate_type: 'DAVP',
  language: 'gu',
};

const validStep2 = {
  proposal_date: '2026-04-22',
  subject_en: 'Subject',
  subject_gu: 'વિષય',
  campaign_duration_days: 30,
  campaign_start_date: '',
  campaign_end_date: '',
  expire_after_days: 120,
};

const validLineItem = {
  location_type: 'AUTO_DISTRICT',
  location_name_snapshot: 'Ahmedabad',
  location_name_gu_snapshot: 'અમદાવાદ',
  units: 100,
  duration_days: 30,
  unit_rate_snapshot: 825,
  line_subtotal: 82500,
};

describe('Step 1 — client + media', () => {
  it('passes with valid input', () => {
    expect(validateStep(1, validStep1).ok).toBe(true);
  });
  it('rejects missing client_id', () => {
    const r = validateStep(1, { ...validStep1, client_id: null });
    expect(r.ok).toBe(false);
    expect(r.errors.client_id).toMatch(/Pick a client/);
  });
  it('rejects missing media_id', () => {
    const r = validateStep(1, { ...validStep1, media_id: null });
    expect(r.ok).toBe(false);
  });
  it('rejects bogus media_code', () => {
    const r = validateStep(1, { ...validStep1, media_code: 'BILLBOARD' });
    expect(r.ok).toBe(false);
  });
});

describe('Step 2 — subject + dates', () => {
  it('passes with valid input', () => {
    expect(validateStep(2, validStep2).ok).toBe(true);
  });
  it('requires subject_en', () => {
    const r = validateStep(2, { ...validStep2, subject_en: '   ' });
    expect(r.ok).toBe(false);
    expect(r.errors.subject_en).toBeTruthy();
  });
  it('requires subject_gu', () => {
    const r = validateStep(2, { ...validStep2, subject_gu: '' });
    expect(r.ok).toBe(false);
  });
  it('rejects bad date format', () => {
    const r = validateStep(2, { ...validStep2, proposal_date: '22-04-2026' });
    expect(r.ok).toBe(false);
  });
  it('rejects end-before-start campaign window', () => {
    const r = validateStep(2, {
      ...validStep2,
      campaign_start_date: '2026-05-01',
      campaign_end_date: '2026-04-15',
    });
    expect(r.ok).toBe(false);
    expect(r.errors.campaign_end_date).toMatch(/on or after/);
  });
  it('allows omitted campaign window', () => {
    const r = validateStep(2, validStep2);
    expect(r.ok).toBe(true);
  });
});

describe('Step 3 — line items', () => {
  it('passes with at least one valid line', () => {
    expect(validateStep(3, { line_items: [validLineItem] }).ok).toBe(true);
  });
  it('rejects empty array', () => {
    const r = validateStep(3, { line_items: [] });
    expect(r.ok).toBe(false);
    expect(r.errors.line_items).toMatch(/at least one/);
  });
  it('rejects zero units', () => {
    const r = validateStep(3, { line_items: [{ ...validLineItem, units: 0 }] });
    expect(r.ok).toBe(false);
  });
});

describe('Step 4 — pricing', () => {
  it('passes with no discount', () => {
    expect(validateStep(4, { gst_percent: 18, discount_percent: 0, discount_amount: 0, discount_reason: '' }).ok).toBe(true);
  });
  it('rejects both percent and flat discount', () => {
    const r = validateStep(4, { gst_percent: 18, discount_percent: 5, discount_amount: 100, discount_reason: 'bulk' });
    expect(r.ok).toBe(false);
    expect(r.errors['discount_amount']).toMatch(/either percent or flat/);
  });
  it('requires discount_reason when discount applied', () => {
    const r = validateStep(4, { gst_percent: 18, discount_percent: 5, discount_amount: 0, discount_reason: '' });
    expect(r.ok).toBe(false);
    expect(r.errors['discount_reason']).toMatch(/required/);
  });
  it('accepts discount with reason', () => {
    expect(validateStep(4, {
      gst_percent: 18, discount_percent: 5, discount_amount: 0, discount_reason: 'Bulk volume',
    }).ok).toBe(true);
  });
});

describe('Step 5 — signer', () => {
  it('passes with team_member_id', () => {
    expect(validateStep(5, { team_member_id: '33333333-3333-3333-3333-333333333333' }).ok).toBe(true);
  });
  it('rejects missing signer', () => {
    const r = validateStep(5, { team_member_id: null });
    expect(r.ok).toBe(false);
  });
});

describe('Step 6 — review', () => {
  it('passes with empty notes', () => {
    expect(validateStep(6, { notes_internal: '', notes_client: '' }).ok).toBe(true);
  });
  it('rejects oversized notes', () => {
    const r = validateStep(6, { notes_internal: 'x'.repeat(2001), notes_client: '' });
    expect(r.ok).toBe(false);
  });
});
