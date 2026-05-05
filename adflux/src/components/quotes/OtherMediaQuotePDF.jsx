// src/components/quotes/OtherMediaQuotePDF.jsx
//
// Phase 15 — Other Media (private) quotation PDF.
//
// Renders the same layout as the uploaded ENIL Quotation #44 sample:
//   • Letterhead with company logo + name + address + GSTIN + phone + email
//   • "Quotation" title + "ORIGINAL FOR RECIPIENT"
//   • Customer detail block (M/S, Address, Phone, GSTIN, PAN, Place of Supply)
//   • Quotation No / Date / Completion Date
//   • Line table: Sr · Name (multi-line desc) · HSN/SAC · Qty · Rate · Taxable · CGST%+amt · SGST%+amt · Total
//   • Totals row, totals strip (Taxable / CGST / SGST / Total After Tax)
//   • Total in words
//   • Bank details panel (4 rows: Name / Branch / Acc Name / Acc# / IFSC / MICR)
//   • Standard footer terms + "Authorised Signatory"
//
// Companies row is read by segment='PRIVATE' (Untitled Adflux Pvt Ltd)
// so address/GSTIN/bank all come from DB, not hardcoded.
//
// DESIGN TOKENS (per UI_DESIGN_SYSTEM.md + tokens.css):
//   • Brand yellow:   #FFE600           (NOT #facc15 — that was a doc-vs-live bug)
//   • Ink primary:    #0c1224           (matches --text-1 Day)
//   • Ink muted:      #4a5474           (matches --text-2 Day)
//   • Border:         #e3e6ee           (matches --border Day)
//   • Surface-2:      #f8f9fc           (matches --surface-2 Day)
//   • Display font:   Space Grotesk     (numbers, headings)
//   • Body font:      Inter / DM Sans
//   • Mono font:      JetBrains Mono    (IDs, currency figures)
// PDFs print on white paper so we use the Day-theme palette deliberately.

import { useEffect, useRef, useState } from 'react'
import { Download, Loader2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { rupeesToWords } from '../../utils/numberToWords'

function fmtINR(n) {
  return Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtDate(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

export function OtherMediaQuotePDF({ quote, lines, onPdfReady }) {
  const ref = useRef(null)
  const [company, setCompany] = useState(null)

  useEffect(() => {
    supabase
      .from('companies')
      .select('*')
      .eq('segment', 'PRIVATE')
      .eq('is_active', true)
      .maybeSingle()
      .then(({ data }) => setCompany(data))
  }, [])

  if (!quote) return null

  const subtotal = (lines || []).reduce((s, l) => s + (Number(l.qty || 0) * Number(l.unit_rate || 0)), 0)
  const cgst     = (lines || []).reduce((s, l) => s + Number(l.cgst_amount || 0), 0)
  const sgst     = (lines || []).reduce((s, l) => s + Number(l.sgst_amount || 0), 0)
  const total    = subtotal + cgst + sgst

  return (
    <div ref={ref} style={{
      width: 794, minHeight: 1123,
      background: '#fff',
      color: '#0c1224',
      fontFamily: '"Inter", system-ui, -apple-system, sans-serif',
      fontSize: 11,
      padding: 28,
      boxSizing: 'border-box',
      lineHeight: 1.4,
    }}>
      {/* ─── Header ─── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, paddingBottom: 14, borderBottom: '1px solid #e3e6ee' }}>
        {company?.logo_url && (
          <img
            src={company.logo_url}
            alt="logo"
            crossOrigin="anonymous"
            style={{ width: 64, height: 64, objectFit: 'contain' }}
          />
        )}
        <div style={{ flex: 1 }}>
          <div style={{
            fontFamily: '"Space Grotesk", "Inter", sans-serif',
            fontWeight: 700, fontSize: 22,
            letterSpacing: '-0.01em',
            color: '#0c1224',
          }}>
            {company?.name || 'Untitled Adflux Private Limited'}
          </div>
          <div style={{ fontSize: 11, color: '#4a5474', marginTop: 4, lineHeight: 1.45 }}>
            {company?.address_line || '203, Sidcup Tower'}
            {company?.city ? <><br/>{company.city}{company.state ? `, ${company.state}` : ''}{company.pincode ? ` - ${company.pincode}` : ''}</> : null}
          </div>
        </div>
        <div style={{ textAlign: 'right', fontSize: 11, color: '#4a5474', lineHeight: 1.6 }}>
          <div><strong style={{ color: '#0c1224' }}>Name:</strong> {company?.name}</div>
          {company?.phone && <div><strong style={{ color: '#0c1224' }}>Phone:</strong> {company.phone}</div>}
          {company?.email && <div><strong style={{ color: '#0c1224' }}>Email:</strong> {company.email}</div>}
        </div>
      </div>

      {/* ─── GSTIN + "Quotation" + ORIGINAL FOR RECIPIENT ─── */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '12px 14px', marginTop: 14, marginBottom: 14,
        background: '#f8f9fc',
        border: '1px solid #e3e6ee',
        borderRadius: 4,
      }}>
        <div style={{ fontSize: 11, fontWeight: 600 }}>
          GSTIN : {company?.gstin || '—'}
        </div>
        <div style={{
          fontFamily: '"Space Grotesk", sans-serif',
          fontSize: 24, fontWeight: 700,
          color: '#0c1224',
          letterSpacing: '-0.02em',
          padding: '2px 12px',
          background: '#FFE600',                /* brand yellow per tokens.css */
          borderRadius: 4,
        }}>
          Quotation
        </div>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.08em', color: '#4a5474' }}>
          ORIGINAL FOR RECIPIENT
        </div>
      </div>

      {/* ─── Customer + Quote Meta ─── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 0, marginBottom: 14, border: '1px solid #e3e6ee' }}>
        <div style={{ padding: '10px 14px', borderRight: '1px solid #e3e6ee' }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.08em', color: '#4a5474', marginBottom: 6 }}>
            CUSTOMER DETAIL
          </div>
          <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 4 }}>
            M/S {quote.client_company || quote.client_name || '—'}
          </div>
          {quote.client_address && (
            <div style={{ fontSize: 11, color: '#4a5474', marginBottom: 2 }}>
              <strong style={{ color: '#0c1224' }}>Address</strong> {quote.client_address}
            </div>
          )}
          {quote.client_phone && (
            <div style={{ fontSize: 11, color: '#4a5474', marginBottom: 2 }}>
              <strong style={{ color: '#0c1224' }}>Phone</strong> {quote.client_phone}
            </div>
          )}
          {quote.client_gst && (
            <div style={{ fontSize: 11, color: '#4a5474', marginBottom: 2 }}>
              <strong style={{ color: '#0c1224' }}>GSTIN</strong> {quote.client_gst}
            </div>
          )}
          <div style={{ fontSize: 11, color: '#4a5474' }}>
            <strong style={{ color: '#0c1224' }}>Place of Supply</strong> Gujarat ( 24 )
          </div>
        </div>
        <div style={{ padding: '10px 14px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, fontSize: 11 }}>
            <div style={{ color: '#4a5474' }}>Quotation No.</div>
            <div style={{ fontWeight: 700, fontFamily: '"JetBrains Mono", monospace' }}>{quote.quote_number || quote.ref_number || '—'}</div>
            <div style={{ color: '#4a5474' }}>Quotation Date</div>
            <div style={{ fontFamily: '"JetBrains Mono", monospace' }}>{fmtDate(quote.proposal_date || quote.created_at)}</div>
            <div style={{ color: '#4a5474' }}>Completion Date</div>
            <div style={{ fontFamily: '"JetBrains Mono", monospace' }}>{fmtDate(quote.campaign_end_date || quote.proposal_date || quote.created_at)}</div>
          </div>
        </div>
      </div>

      {/* ─── Line items table ───
          Width budget: 794 - (2 × 28 padding) = 738 usable.
          Column widths sum to ~528, leaving ~210 for the description
          column — enough for "Newspaper" + 2 lines of description
          without wrapping inside narrow cells. */}
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10, tableLayout: 'fixed' }}>
        <colgroup>
          <col style={{ width: 26 }} />   {/* Sr.No */}
          <col />                          {/* Name (flex) */}
          <col style={{ width: 52 }} />   {/* HSN/SAC */}
          <col style={{ width: 36 }} />   {/* Qty */}
          <col style={{ width: 64 }} />   {/* Rate */}
          <col style={{ width: 74 }} />   {/* Taxable */}
          <col style={{ width: 26 }} />   {/* CGST % */}
          <col style={{ width: 60 }} />   {/* CGST Amount */}
          <col style={{ width: 26 }} />   {/* SGST % */}
          <col style={{ width: 60 }} />   {/* SGST Amount */}
          <col style={{ width: 76 }} />   {/* Total */}
        </colgroup>
        <thead>
          <tr style={{ background: '#f8f9fc' }}>
            <th style={cellHead()}>Sr.<br/>No.</th>
            <th style={{ ...cellHead(), textAlign: 'left' }}>Name of Product / Service</th>
            <th style={cellHead()}>HSN/SAC</th>
            <th style={cellHead()}>Qty</th>
            <th style={cellHead()}>Rate</th>
            <th style={cellHead()}>Taxable</th>
            <th colSpan={2} style={cellHead()}>CGST</th>
            <th colSpan={2} style={cellHead()}>SGST</th>
            <th style={cellHead()}>Total</th>
          </tr>
          <tr style={{ background: '#f8f9fc' }}>
            <th style={cellHeadSub()}></th>
            <th style={cellHeadSub()}></th>
            <th style={cellHeadSub()}></th>
            <th style={cellHeadSub()}></th>
            <th style={cellHeadSub()}></th>
            <th style={cellHeadSub()}></th>
            <th style={cellHeadSub()}>%</th>
            <th style={cellHeadSub()}>Amount</th>
            <th style={cellHeadSub()}>%</th>
            <th style={cellHeadSub()}>Amount</th>
            <th style={cellHeadSub()}></th>
          </tr>
        </thead>
        <tbody>
          {(lines || []).map((l, i) => {
            const taxable = Number(l.qty || 0) * Number(l.unit_rate || 0)
            return (
              <tr key={i}>
                <td style={cellNum()}>{i + 1}</td>
                <td style={cellName()}>
                  {/* The wizard denormalises the media name into city_name
                      (existing schema). Description is the rep-typed body.
                      Strip a "Media: " prefix if any older row carries it. */}
                  <div style={{ fontWeight: 700, fontSize: 10.5 }}>
                    {l.city_name || l.media_label || l.media_type || ''}
                  </div>
                  {l.description && (
                    <div style={{ whiteSpace: 'pre-line', color: '#4a5474', marginTop: 2, fontSize: 9.5, lineHeight: 1.4 }}>
                      {(l.city_name && l.description.startsWith(`${l.city_name}: `))
                        ? l.description.slice(l.city_name.length + 2)
                        : l.description}
                    </div>
                  )}
                </td>
                <td style={cellNum()}>{l.hsn_sac || ''}</td>
                <td style={cellNum()}>{Number(l.qty || 0).toFixed(2)}</td>
                <td style={cellNumR()}>{fmtINR(l.unit_rate)}</td>
                <td style={cellNumR()}>{fmtINR(taxable)}</td>
                <td style={cellNum()}>{Number(l.cgst_pct || 0).toFixed(2)}</td>
                <td style={cellNumR()}>{fmtINR(l.cgst_amount)}</td>
                <td style={cellNum()}>{Number(l.sgst_pct || 0).toFixed(2)}</td>
                <td style={cellNumR()}>{fmtINR(l.sgst_amount)}</td>
                <td style={cellNumR()}>{fmtINR(taxable + Number(l.cgst_amount || 0) + Number(l.sgst_amount || 0))}</td>
              </tr>
            )
          })}
          {/* Totals row */}
          <tr style={{ background: '#f8f9fc', fontWeight: 700 }}>
            <td colSpan={3} style={{ ...cellNum(), textAlign: 'right' }}>Total</td>
            <td style={cellNum()}>{(lines || []).reduce((s, l) => s + Number(l.qty || 0), 0).toFixed(2)}</td>
            <td style={cellNum()}></td>
            <td style={cellNumR()}>{fmtINR(subtotal)}</td>
            <td style={cellNum()}></td>
            <td style={cellNumR()}>{fmtINR(cgst)}</td>
            <td style={cellNum()}></td>
            <td style={cellNumR()}>{fmtINR(sgst)}</td>
            <td style={cellNumR()}>{fmtINR(total)}</td>
          </tr>
        </tbody>
      </table>

      {/* ─── Totals strip + Amount in words + Bank details ─── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 0, marginTop: 0, border: '1px solid #e3e6ee', borderTop: 'none' }}>
        <div style={{ borderRight: '1px solid #e3e6ee' }}>
          <div style={{ padding: '10px 14px', borderBottom: '1px solid #e3e6ee', textAlign: 'center', fontSize: 10, fontWeight: 700, letterSpacing: '.08em', color: '#4a5474' }}>
            TOTAL IN WORDS
          </div>
          <div style={{ padding: '12px 14px', textAlign: 'center', fontSize: 11, fontWeight: 600, fontStyle: 'italic', borderBottom: '1px solid #e3e6ee' }}>
            {rupeesToWords(total).toUpperCase()}
          </div>
          <div style={{ padding: '10px 14px', borderBottom: '1px solid #e3e6ee', textAlign: 'center', fontSize: 10, fontWeight: 700, letterSpacing: '.08em', color: '#4a5474' }}>
            BANK DETAILS
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10.5 }}>
            <tbody>
              <BankRow label="Name"        value={company?.bank_name} />
              <BankRow label="Branch"      value={company?.bank_branch} />
              <BankRow label="Acc. Name"   value={company?.bank_account_name || company?.name} />
              <BankRow label="Acc. Number" value={company?.bank_account_number} mono />
              <BankRow label="IFSC"        value={company?.bank_ifsc} mono />
              <BankRow label="MICR Code"   value={company?.bank_micr} mono last />
            </tbody>
          </table>
        </div>
        <div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
            <tbody>
              <TotalsRow label="Taxable Amount" value={fmtINR(subtotal)} />
              <TotalsRow label="Add : CGST"     value={fmtINR(cgst)} />
              <TotalsRow label="Add : SGST"     value={fmtINR(sgst)} />
              <TotalsRow label="Total Tax"      value={fmtINR(cgst + sgst)} />
              <tr>
                <td style={{
                  padding: '10px 14px', borderTop: '1px solid #e3e6ee',
                  fontWeight: 700, color: '#0c1224',
                }}>Total Amount After Tax</td>
                <td style={{
                  padding: '10px 14px', borderTop: '1px solid #e3e6ee', textAlign: 'right',
                  fontWeight: 700,
                  fontFamily: '"Space Grotesk", sans-serif',
                  fontSize: 14, color: '#0c1224',
                }}>
                  ₹{fmtINR(total)}
                </td>
              </tr>
              <tr>
                <td colSpan={2} style={{ padding: '6px 14px', textAlign: 'right', fontSize: 9, color: '#4a5474', fontStyle: 'italic' }}>
                  (E & O.E.)
                </td>
              </tr>
              <tr>
                <td colSpan={2} style={{ padding: '14px 14px 8px', borderTop: '1px solid #e3e6ee', textAlign: 'center', fontSize: 10, color: '#4a5474' }}>
                  Certified that the particulars given above are true and correct.
                </td>
              </tr>
              <tr>
                <td colSpan={2} style={{ padding: '6px 14px 60px', textAlign: 'center', fontSize: 11, fontWeight: 700 }}>
                  For {company?.name || 'Untitled Adflux Private Limited'}
                </td>
              </tr>
              <tr>
                <td colSpan={2} style={{ padding: '6px 14px 14px', textAlign: 'center', fontSize: 10, color: '#4a5474' }}>
                  Authorised Signatory
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* ─── Standard footer terms ─── */}
      <div style={{
        marginTop: 12, padding: '10px 14px',
        border: '1px solid #e3e6ee',
        fontSize: 10, color: '#4a5474', lineHeight: 1.5,
      }}>
        Subject to our home Jurisdiction.<br/>
        Our Responsibility Ceases as soon as goods leaves our Premises.<br/>
        Goods once sold will not taken back.<br/>
        Delivery Ex-Premises.
      </div>
    </div>
  )
}

/* ─── Helpers ─── */
function cellHead() {
  return {
    padding: '5px 4px',
    border: '1px solid #d8dde8',
    fontSize: 9.5,
    fontWeight: 700,
    color: '#0c1224',
    textAlign: 'center',
    lineHeight: 1.25,
  }
}
function cellHeadSub() {
  return {
    padding: '3px 4px',
    border: '1px solid #d8dde8',
    fontSize: 8.5,
    fontWeight: 600,
    color: '#4a5474',
    textAlign: 'center',
  }
}
function cellName() {
  return {
    padding: '6px 8px', border: '1px solid #d8dde8',
    verticalAlign: 'top', textAlign: 'left',
    wordBreak: 'break-word',
  }
}
function cellNum() {
  return {
    padding: '6px 4px', border: '1px solid #d8dde8',
    textAlign: 'center', fontFamily: '"JetBrains Mono", monospace',
    verticalAlign: 'top', fontSize: 9.5,
  }
}
function cellNumR() {
  return {
    padding: '6px 6px', border: '1px solid #d8dde8',
    textAlign: 'right', fontFamily: '"JetBrains Mono", monospace',
    verticalAlign: 'top', fontSize: 9.5,
  }
}
function BankRow({ label, value, mono, last }) {
  return (
    <tr>
      <td style={{
        padding: '6px 14px',
        borderTop: '1px solid #e3e6ee',
        borderBottom: last ? 'none' : 'none',
        fontWeight: 600, color: '#0c1224', width: 110,
      }}>{label}</td>
      <td style={{
        padding: '6px 14px',
        borderTop: '1px solid #e3e6ee',
        fontFamily: mono ? '"JetBrains Mono", monospace' : 'inherit',
        color: '#0c1224',
      }}>{value || '—'}</td>
    </tr>
  )
}
function TotalsRow({ label, value }) {
  return (
    <tr>
      <td style={{ padding: '6px 14px', color: '#4a5474', borderBottom: '1px solid #e3e6ee' }}>{label}</td>
      <td style={{
        padding: '6px 14px', textAlign: 'right',
        fontFamily: '"JetBrains Mono", monospace',
        borderBottom: '1px solid #e3e6ee',
      }}>{value}</td>
    </tr>
  )
}

/* ─── PDF download helper — call from any page that has the quote ─── */
export async function downloadOtherMediaPdf({ quote, lines }) {
  // Render the component off-screen, snapshot via html2canvas → jsPDF.
  const html2canvas = (await import('html2canvas')).default
  const { jsPDF } = await import('jspdf')

  // Wrap in a hidden container.
  const wrapper = document.createElement('div')
  wrapper.style.position = 'fixed'
  wrapper.style.left = '-100000px'
  wrapper.style.top = '0'
  wrapper.style.background = '#fff'
  wrapper.style.zIndex = '-1'
  document.body.appendChild(wrapper)

  const root = (await import('react-dom/client')).createRoot(wrapper)
  await new Promise(resolve => {
    root.render(<OtherMediaQuotePDF quote={quote} lines={lines} onPdfReady={resolve} />)
    setTimeout(resolve, 600) // give image + supabase fetch time
  })

  const node = wrapper.querySelector('div')
  const canvas = await html2canvas(node, {
    scale: 2, backgroundColor: '#ffffff', useCORS: true, logging: false,
    width: 794, windowWidth: 794,
  })
  document.body.removeChild(wrapper)

  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const pageW = 210
  const pageH = 297
  const pxPerMm = canvas.width / pageW
  const pageHpx = Math.floor(pageH * pxPerMm)

  let yOff = 0
  let remaining = canvas.height
  let firstPage = true
  while (remaining > 0) {
    const slice = document.createElement('canvas')
    const sliceH = Math.min(pageHpx, remaining)
    slice.width = canvas.width
    slice.height = sliceH
    slice.getContext('2d').drawImage(canvas, 0, yOff, canvas.width, sliceH, 0, 0, canvas.width, sliceH)
    const data = slice.toDataURL('image/jpeg', 0.92)
    if (!firstPage) pdf.addPage()
    pdf.addImage(data, 'JPEG', 0, 0, pageW, sliceH / pxPerMm, undefined, 'FAST')
    yOff += sliceH
    remaining -= sliceH
    firstPage = false
  }

  const filename = `${quote.quote_number || 'quotation'}.pdf`.replace(/[^a-z0-9-_.]/gi, '-')
  pdf.save(filename)
}
