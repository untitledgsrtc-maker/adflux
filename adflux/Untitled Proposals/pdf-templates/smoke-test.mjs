// =====================================================================
// Smoke test for PDF templates.
//
// Renders all 6 templates with realistic mock data, writes the HTML
// files to ./out/, and runs structural assertions:
//   - non-empty output
//   - contains <!DOCTYPE html>, opening and closing <html> + <body>
//   - balanced <table>/</table> tag counts
//   - contains the expected watermark / stamp text
//   - contains the brand name
//   - contains the rupee sign
//   - contains Gujarati Unicode characters
//
// We can't render to PDF here (sandbox aarch64 has no Chromium), but
// this catches the most common breakage classes — undefined data
// bindings, missing helper imports, broken HTML structure.
// =====================================================================

import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { renderTemplate } from './render.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, 'out');

// ---------- Mock data ----------
const brand = {
  brandName: 'Untitled Advertising',
  brandNameGu: 'અનટાઈટલ્ડ એડવર્ટાઇઝિંગ',
  gstin: '24ABCDE1234F1Z5',
  pan: 'ABCDE1234F',
  hsn: '998361',
};

const signer = {
  name_en: 'Brijesh Patel',
  name_gu: 'બ્રિજેશ પટેલ',
  designation_en: 'Proprietor',
  designation_gu: 'માલિક',
  mobile: '+91 98765 43210',
};

const client = {
  name_en: 'Government of Gujarat — Information Department',
  name_gu: 'ગુજરાત સરકાર — માહિતી ખાતું',
  department_en: 'Information Department',
  department_gu: 'માહિતી ખાતું',
  address_en: 'Block 7, Sachivalaya, Sector 10',
  city: 'Gandhinagar',
  pincode: '382010',
  gst_number: '24AAAGG0123A1ZK',
};

const contact = {
  salutation: 'Shri',
  name_en: 'Vikram Solanki',
  name_gu: 'વિક્રમ સોલંકી',
  designation_en: 'Joint Director',
};

const baseProposal = {
  ref_no: 'UA/PROP/AUTO/2026-27/0042',
  proposal_date: '2026-04-20',
  subject_en: 'Auto-rickshaw hood publicity for Polio drive — Apr-Jun 2026',
  subject_gu: 'પોલિયો ડ્રાઇવ માટે ઓટો-રિક્ષા હૂડ પ્રચાર — એપ્રિલ-જૂન ૨૦૨૬',
  subtotal: 247500.00,
  discountAmount: 0,
  gstPercent: 18,
  gstAmount: 44550.00,
  totalAmount: 292050.00,
  total_amount: 292050.00,
  po_amount: null,
};

const autoLineItems = [
  {
    location_name_snapshot: 'Ahmedabad',
    location_name_gu_snapshot: 'અમદાવાદ',
    units: 100,
    duration_days: 30,
    unit_rate_snapshot: 825,
    line_subtotal: 82500.00,
  },
  {
    location_name_snapshot: 'Vadodara',
    location_name_gu_snapshot: 'વડોદરા',
    units: 100,
    duration_days: 30,
    unit_rate_snapshot: 825,
    line_subtotal: 82500.00,
  },
  {
    location_name_snapshot: 'Surat',
    location_name_gu_snapshot: 'સુરત',
    units: 100,
    duration_days: 30,
    unit_rate_snapshot: 825,
    line_subtotal: 82500.00,
  },
];

const gsrtcLineItems = [
  {
    location_name_snapshot: 'Ahmedabad Central Bus Station',
    location_name_gu_snapshot: 'અમદાવાદ સેન્ટ્રલ બસ સ્ટેશન',
    units: 27000,            // 30 spots/hr × 15 hr × 60 days = 27,000 slots
    duration_days: 60,
    unit_rate_snapshot: 3.00,
    line_subtotal: 81000.00,
    meta_snapshot: { category: 'A', screens_count: 4, monthly_spots: 13500 },
  },
  {
    location_name_snapshot: 'Vadodara Bus Station',
    location_name_gu_snapshot: 'વડોદરા બસ સ્ટેશન',
    units: 24750,
    duration_days: 60,
    unit_rate_snapshot: 2.75,
    line_subtotal: 68062.50,
    meta_snapshot: { category: 'B', screens_count: 3, monthly_spots: 12375 },
  },
];

const autoRateDavp = {
  davp_per_rickshaw_rate: 825,
  agency_per_rickshaw_rate: 1200,
  campaign_duration_days: 30,
  size_rear: '17"x39"',
  size_left: '17"x16"',
  size_right: '17"x16"',
  davp_source_reference: 'DAVP Approved Rate (Auto-rickshaw hood, Gujarat) FY 2025-26',
};

const autoRateAgency = { ...autoRateDavp };

// ---------- Test runner ----------
const results = [];

function assert(cond, msg) {
  if (!cond) throw new Error(`Assertion failed: ${msg}`);
}

function structuralChecks(name, html, mustContain = []) {
  assert(html.length > 1000, `${name}: html too short (${html.length} chars)`);
  assert(html.startsWith('<!DOCTYPE html>'), `${name}: missing <!DOCTYPE html>`);
  assert(html.includes('<html'), `${name}: missing <html`);
  assert(html.includes('</html>'), `${name}: missing </html>`);
  assert(html.includes('<body>'), `${name}: missing <body>`);
  assert(html.includes('</body>'), `${name}: missing </body>`);

  // tag balance — naive but catches gross structural breakage
  const open = (html.match(/<table[^>]*>/g) || []).length;
  const close = (html.match(/<\/table>/g) || []).length;
  assert(open === close, `${name}: <table> tags unbalanced (open=${open}, close=${close})`);

  // brand name
  assert(html.includes('Untitled Advertising'), `${name}: brand name missing`);

  // rupee sign or inline ₹
  assert(html.includes('₹'), `${name}: no ₹ sign in output`);

  // Gujarati script (any character in the Gujarati Unicode block)
  assert(/[\u0A80-\u0AFF]/.test(html), `${name}: no Gujarati Unicode characters`);

  for (const needle of mustContain) {
    assert(html.includes(needle), `${name}: expected to contain "${needle}"`);
  }
}

async function run(name, payload, mustContain = []) {
  try {
    const html = renderTemplate(payload);
    structuralChecks(name, html, mustContain);
    await writeFile(join(OUT_DIR, `${name}.html`), html, 'utf8');
    results.push({ name, status: 'PASS', size: html.length });
    console.log(`✓ ${name.padEnd(28)} ${html.length} bytes`);
  } catch (err) {
    results.push({ name, status: 'FAIL', error: err.message });
    console.error(`✗ ${name.padEnd(28)} ${err.message}`);
  }
}

await mkdir(OUT_DIR, { recursive: true });

await run('proposal-davp-auto', {
  kind: 'PROPOSAL',
  rateBasis: 'DAVP',
  media: 'AUTO',
  data: {
    brand, signer, client, contact,
    proposal: baseProposal,
    lineItems: autoLineItems,
    autoRate: autoRateDavp,
    copyKind: 'ORIGINAL',
  },
}, ['DAVP Approved Rate', 'Auto Hood', 'Polio', '825', 'Ahmedabad']);

await run('proposal-davp-gsrtc', {
  kind: 'PROPOSAL',
  rateBasis: 'DAVP',
  media: 'GSRTC',
  data: {
    brand, signer, client, contact,
    proposal: { ...baseProposal, ref_no: 'UA/PROP/GSRTC/2026-27/0007' },
    lineItems: gsrtcLineItems,
    copyKind: 'ORIGINAL',
  },
}, ['DAVP Approved Rate', 'GSRTC', '10-second slot', 'Cat A']);

await run('proposal-agency-auto', {
  kind: 'PROPOSAL',
  rateBasis: 'AGENCY',
  media: 'AUTO',
  data: {
    brand, signer, client, contact,
    proposal: { ...baseProposal, ref_no: 'UA/PROP/AUTO/2026-27/0043' },
    lineItems: autoLineItems.map((li) => ({ ...li, unit_rate_snapshot: 1200, line_subtotal: 120000 })),
    autoRate: autoRateAgency,
    copyKind: 'CUSTOMER COPY',
  },
}, ['Commercial Rate', 'Auto Hood', 'commercial']);

await run('proposal-agency-gsrtc', {
  kind: 'PROPOSAL',
  rateBasis: 'AGENCY',
  media: 'GSRTC',
  data: {
    brand, signer, client, contact,
    proposal: { ...baseProposal, ref_no: 'UA/PROP/GSRTC/2026-27/0008' },
    lineItems: gsrtcLineItems.map((li) => ({
      ...li,
      units: (li.meta_snapshot.screens_count || 1) * 2,    // screen-months
      unit_rate_snapshot: 8000,                            // ₹/screen/month
      line_subtotal: 8000 * (li.meta_snapshot.screens_count || 1) * 2,
    })),
    copyKind: 'ORIGINAL',
  },
}, ['Commercial Rate', 'GSRTC', 'Screen-months']);

const sampleReceipt = {
  receipt_no: 'UA/RV/2026-27/0001',
  receipt_date: '2026-04-22',
  receipt_type: 'ADVANCE',
  gross_amount: 100000,
  tds_income_percent: 2,
  tds_income_amount: 2000,
  tds_gst_percent: 2,
  tds_gst_amount: 2000,
  net_received_amount: 96000,
  payment_mode: 'NEFT',
  cheque_or_ref_no: 'NEFT-REF-2026-04-22-XYZ123',
  bank_name: 'State Bank of India, Vadodara Main',
  subject_to_realisation: false,
  hsn_sac_code: '998361',
  gst_percent_applied: 18,
  client_name_snapshot: client.name_en,
  client_name_gu_snapshot: client.name_gu,
  client_gst_snapshot: client.gst_number,
  proposal_subject_snapshot: baseProposal.subject_en,
  proposal_ref_snapshot: baseProposal.ref_no,
  notes: 'First instalment against above proposal.',
};

await run('receipt-voucher', {
  kind: 'RECEIPT',
  data: {
    brand, signer,
    receipt: sampleReceipt,
    copyKind: 'ORIGINAL',
    runningTotals: {
      expected: 292050.00,
      gross: 100000,
      tds: 4000,
      net: 96000,
      outstanding: 192050.00,
    },
  },
}, ['Receipt Voucher', 'Rule 50', 'TDS', '194C', 'Section 51'.replace('Section', 'sec')]);

await run('receipt-final-paid', {
  kind: 'SETTLEMENT',
  data: {
    brand, signer, client,
    proposal: {
      ...baseProposal,
      total_gross_received: 292050,
    },
    receipts: [
      { ...sampleReceipt },
      {
        ...sampleReceipt,
        receipt_no: 'UA/RV/2026-27/0009',
        receipt_date: '2026-05-15',
        receipt_type: 'PART_PAYMENT',
        gross_amount: 92050,
        tds_income_amount: 1841,
        tds_gst_amount: 1841,
        net_received_amount: 88368,
        payment_mode: 'CHEQUE',
        cheque_or_ref_no: '023145',
        cheque_date: '2026-05-14',
      },
      {
        ...sampleReceipt,
        receipt_no: 'UA/RV/2026-27/0021',
        receipt_date: '2026-06-30',
        receipt_type: 'FINAL_PAYMENT',
        gross_amount: 100000,
        tds_income_amount: 2000,
        tds_gst_amount: 2000,
        net_received_amount: 96000,
        payment_mode: 'RTGS',
        cheque_or_ref_no: 'RTGS-FINAL-2026-06-30',
      },
    ],
    statementDate: '2026-07-01',
  },
}, ['Final Settlement Statement', 'Paid in Full']);

await run('receipt-final-open', {
  kind: 'SETTLEMENT',
  data: {
    brand, signer, client,
    proposal: {
      ...baseProposal,
      total_gross_received: 100000,
    },
    receipts: [{ ...sampleReceipt }],
    statementDate: '2026-05-01',
  },
}, ['Final Settlement Statement', 'open balance']);

// ---------- Summary ----------
const failed = results.filter((r) => r.status === 'FAIL');
console.log(`\n${results.length - failed.length}/${results.length} templates passed`);
console.log(`Output: ${OUT_DIR}`);

if (failed.length > 0) {
  console.error('\nFailures:');
  for (const f of failed) console.error(`  ${f.name}: ${f.error}`);
  process.exit(1);
}
