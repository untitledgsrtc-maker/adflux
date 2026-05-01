import { describe, it, expect } from 'vitest';
import {
  round2, sumLineItems, calcProposalTotals,
  calcReceiptTds, calcPaymentStatus,
} from './calc';

describe('round2', () => {
  it('rounds 1.005 → 1.01 (matches Postgres, beats IEEE 754 quirk)', () => {
    expect(round2(1.005)).toBe(1.01);
    expect(round2(1.004)).toBe(1.0);
    expect(round2(1.015)).toBe(1.02);
  });
  it('handles 0.1+0.2 cleanly', () => {
    expect(round2(0.1 + 0.2)).toBe(0.3);
  });
  it('handles negatives', () => {
    expect(round2(-1.005)).toBe(-1.01);
  });
  it('handles null/undefined as 0', () => {
    expect(round2(null)).toBe(0);
    expect(round2(undefined)).toBe(0);
  });
});

describe('sumLineItems', () => {
  it('sums line subtotals', () => {
    expect(sumLineItems([{ line_subtotal: 100 }, { line_subtotal: 50.25 }])).toBe(150.25);
  });
  it('handles empty / null', () => {
    expect(sumLineItems([])).toBe(0);
    expect(sumLineItems(null)).toBe(0);
  });
});

describe('calcProposalTotals', () => {
  it('computes GST on undiscounted subtotal', () => {
    const r = calcProposalTotals({
      lines: [{ line_subtotal: 87000 }],
      gstPercent: 18,
    });
    expect(r.subtotal).toBe(87000);
    expect(r.taxable).toBe(87000);
    expect(r.gstAmount).toBe(15660);
    expect(r.totalAmount).toBe(102660);
  });

  it('applies flat discount before GST', () => {
    const r = calcProposalTotals({
      lines: [{ line_subtotal: 100000 }],
      gstPercent: 18,
      discountAmount: 5000,
    });
    expect(r.discountAmount).toBe(5000);
    expect(r.taxable).toBe(95000);
    expect(r.gstAmount).toBe(17100);
    expect(r.totalAmount).toBe(112100);
  });

  it('applies percent discount', () => {
    const r = calcProposalTotals({
      lines: [{ line_subtotal: 100000 }],
      discountPercent: 10,
    });
    expect(r.discountAmount).toBe(10000);
    expect(r.taxable).toBe(90000);
  });

  it('flat discount wins over percent when both set', () => {
    const r = calcProposalTotals({
      lines: [{ line_subtotal: 100000 }],
      discountPercent: 10,
      discountAmount: 7500,
    });
    expect(r.discountAmount).toBe(7500);
  });
});

describe('calcReceiptTds', () => {
  it('default 2% + 2% on 100000', () => {
    const r = calcReceiptTds({ gross: 100000 });
    expect(r.tdsIncome).toBe(2000);
    expect(r.tdsGst).toBe(2000);
    expect(r.totalTds).toBe(4000);
    expect(r.net).toBe(96000);
  });

  it('custom percentages', () => {
    const r = calcReceiptTds({ gross: 50000, tdsIncomePercent: 1, tdsGstPercent: 0 });
    expect(r.tdsIncome).toBe(500);
    expect(r.tdsGst).toBe(0);
    expect(r.net).toBe(49500);
  });
});

describe('calcPaymentStatus', () => {
  it('NOT_STARTED when nothing received', () => {
    expect(calcPaymentStatus({ expected: 100, grossReceived: 0 }).paymentStatus).toBe('NOT_STARTED');
  });
  it('PARTIAL when underpaid', () => {
    expect(calcPaymentStatus({ expected: 100, grossReceived: 60 }).paymentStatus).toBe('PARTIAL');
  });
  it('FULL when matched', () => {
    expect(calcPaymentStatus({ expected: 100, grossReceived: 100 }).paymentStatus).toBe('FULL');
  });
  it('OVERPAID when excess', () => {
    expect(calcPaymentStatus({ expected: 100, grossReceived: 105 }).paymentStatus).toBe('OVERPAID');
  });
});
