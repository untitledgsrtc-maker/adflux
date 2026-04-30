// =====================================================================
// Status-transition schema tests. Mirrors transition_proposal_status
// RPC validation + the existing DB triggers.
// =====================================================================

import { describe, it, expect } from 'vitest';
import { validateTransition } from './statusSchema';

describe('SENT transition', () => {
  it('accepts EMAIL with no office copy', () => {
    expect(validateTransition('SENT', { submission_mode: 'EMAIL', office_copy_url: '' }).ok).toBe(true);
  });
  it('rejects PHYSICAL without office copy', () => {
    const r = validateTransition('SENT', { submission_mode: 'PHYSICAL', office_copy_url: '' });
    expect(r.ok).toBe(false);
    expect(r.errors.office_copy_url).toMatch(/required for PHYSICAL/i);
  });
  it('accepts PHYSICAL with valid Drive URL', () => {
    expect(validateTransition('SENT', {
      submission_mode: 'PHYSICAL',
      office_copy_url: 'https://drive.google.com/file/d/abc',
    }).ok).toBe(true);
  });
  it('rejects non-http office copy URL', () => {
    const r = validateTransition('SENT', {
      submission_mode: 'PHYSICAL',
      office_copy_url: 'ftp://drive.google.com/file/d/abc',
    });
    expect(r.ok).toBe(false);
    expect(r.errors.office_copy_url).toMatch(/http/i);
  });
});

describe('WON transition', () => {
  const valid = {
    po_number: 'PO/2026/12345',
    po_date: '2026-04-22',
    po_amount: 100000,
    po_file_url: 'https://drive.google.com/file/d/xyz',
  };

  it('accepts complete PO data', () => {
    expect(validateTransition('WON', valid).ok).toBe(true);
  });
  it('rejects missing PO number', () => {
    expect(validateTransition('WON', { ...valid, po_number: '' }).ok).toBe(false);
  });
  it('rejects zero PO amount', () => {
    expect(validateTransition('WON', { ...valid, po_amount: 0 }).ok).toBe(false);
  });
  it('rejects bad date format', () => {
    expect(validateTransition('WON', { ...valid, po_date: '22-04-2026' }).ok).toBe(false);
  });
  it('rejects non-URL po_file_url', () => {
    const r = validateTransition('WON', { ...valid, po_file_url: 'not a url' });
    expect(r.ok).toBe(false);
  });
});

describe('REJECTED transition', () => {
  it('accepts empty reason', () => {
    expect(validateTransition('REJECTED', { rejected_reason: '' }).ok).toBe(true);
  });
  it('accepts a reason', () => {
    expect(validateTransition('REJECTED', { rejected_reason: 'Lost on price.' }).ok).toBe(true);
  });
});

describe('CANCELLED transition', () => {
  it('rejects short reason', () => {
    expect(validateTransition('CANCELLED', { cancelled_reason: 'no' }).ok).toBe(false);
  });
  it('rejects whitespace-only reason', () => {
    expect(validateTransition('CANCELLED', { cancelled_reason: '       ' }).ok).toBe(false);
  });
  it('accepts a 5+ char reason', () => {
    expect(validateTransition('CANCELLED', { cancelled_reason: 'Postponed indefinitely' }).ok).toBe(true);
  });
});

describe('Unknown target', () => {
  it('passes through (RPC will reject)', () => {
    expect(validateTransition('PAID', {}).ok).toBe(true);
  });
});
