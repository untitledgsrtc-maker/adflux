// src/pages/QuoteDetail.jsx
import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  ArrowLeft, Download, MessageCircle, ChevronDown,
  Building2, Phone, Mail, MapPin, FileText, Calendar,
  CheckCircle, CreditCard, X, Pencil
} from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { useQuotes } from '../hooks/useQuotes'
import { usePayments } from '../hooks/usePayments'
import { QuoteStatusBadge } from '../components/quotes/QuoteStatusBadge'
import { downloadQuotePDF, uploadQuotePDF } from '../components/quotes/QuotePDF'
import { buildWhatsAppMessage, openWhatsApp } from '../utils/whatsapp'
import { PaymentModal } from '../components/payments/PaymentModal'
import { PaymentHistory } from '../components/payments/PaymentHistory'
import { PaymentSummary } from '../components/payments/PaymentSummary'
import { FollowUpList } from '../components/followups/FollowUpList'
import { formatCurrency, formatDate, formatDateTime, formatPhone, todayISO } from '../utils/formatters'
import { STATUS_LABELS } from '../utils/constants'

function getAllowedTransitions(quote, hasFinalPayment) {
  if (quote.status === 'won' && !hasFinalPayment) {
    return ['negotiating', 'sent']
  }
  const BASE = {
    draft:       ['sent', 'lost'],
    sent:        ['negotiating', 'won', 'lost'],
    negotiating: ['won', 'lost', 'sent'],
    won:         [],
    lost:        ['negotiating'],
  }
  return BASE[quote.status] || []
}

const TABS = [
  { key: 'overview',  label: 'Overview' },
  { key: 'payments',  label: 'Payments' },
  { key: 'followups', label: 'Follow-ups' },
]

const STATUS_COLORS = {
  draft: 'var(--gray)',
  sent: '#64b5f6',
  negotiating: '#ffb74d',
  won: '#81c784',
  lost: '#ef9a9a',
}

export default function QuoteDetail() {
  const { id } = useParams()
  const navigate = useNavigate()

  const { isAdmin } = useAuth()
  const { fetchQuoteById, updateQuoteStatus, currentQuote } = useQuotes()
  const { payments, loading: paymentsLoading, totalPaid, hasFinalPayment, fetchPayments, addPayment, updatePayment, deletePayment } = usePayments(id)

  const [loading, setLoading]               = useState(true)
  const [activeTab, setActiveTab]           = useState('overview')
  const [statusOpen, setStatusOpen]         = useState(false)
  const [updatingStatus, setUpdatingStatus] = useState(false)
  const [pdfLoading, setPdfLoading]         = useState(false)
  const [error, setError]                   = useState('')
  const [statusMsg, setStatusMsg]           = useState('')
  const [showPaymentModal, setShowPaymentModal] = useState(false)
  const [showWonModal, setShowWonModal]     = useState(false)
  const [showCampaignModal, setShowCampaignModal] = useState(false)
  const [showEditPayment, setShowEditPayment] = useState(false)
  const [editingPayment, setEditingPayment] = useState(null)
  const [pendingStatus, setPendingStatus]   = useState(null)

  useEffect(() => {
    setLoading(true)
    fetchQuoteById(id).finally(() => setLoading(false))
  }, [id])

  // Fetch payments on mount (and when quote id changes) so the Overview
  // tab's PaymentSummary (totalPaid / hasFinalPayment / balance) reflects
  // reality before the user ever clicks the Payments tab. Previously this
  // only fetched when activeTab === 'payments', which left Overview stuck
  // on "UNPAID" even after payments existed.
  useEffect(() => {
    if (id) fetchPayments()
  }, [id, fetchPayments])

  const quote  = currentQuote
  const cities = quote?.quote_cities || []
  const balance = quote ? (quote.total_amount - totalPaid) : 0

  async function handleStatusChange(newStatus) {
    setStatusOpen(false)
    if (!quote || newStatus === quote.status) return

    // When changing to Won, show payment modal first
    if (newStatus === 'won') {
      setPendingStatus('won')
      setShowWonModal(true)
      return
    }

    setUpdatingStatus(true)
    const { error: err } = await updateQuoteStatus(quote.id, newStatus)
    setUpdatingStatus(false)
    if (err) {
      setError(err.message || 'Failed to update status.')
    } else {
      setStatusMsg(`Status updated to ${STATUS_LABELS[newStatus]}`)
      setTimeout(() => setStatusMsg(''), 3000)
    }
  }

  async function handleWonWithPayment(paymentData) {
    setShowWonModal(false)
    setUpdatingStatus(true)

    // Add payment first if provided. CRITICAL: surface the RLS /
    // constraint error. Silent failure here was the bug that made
    // the flow appear to succeed (toast shown, status "pending
    // admin approval") while nothing actually landed in the DB.
    //
    // Strip campaign_start_date / campaign_end_date before the
    // insert — those belong on the quote row, not on payments, and
    // spreading them in causes PostgREST to reject the insert with
    // "Could not find the 'campaign_end_date' column of 'payments'
    // in the schema cache."
    const hasPayment = paymentData && paymentData.amount_received > 0
    if (hasPayment) {
      const {
        campaign_start_date: _csd,
        campaign_end_date:   _ced,
        is_final:            _isFinal,
        ...paymentFields
      } = paymentData
      const result = await addPayment({
        ...paymentFields,
        is_final_payment: paymentData.is_final,
      })
      if (result?.error) {
        setUpdatingStatus(false)
        setError(`Payment could not be saved: ${result.error.message}`)
        return
      }
    }

    // Sales-side gate: a payment punched by sales lands as
    // approval_status='pending'. Flipping the quote to 'won' here
    // would create the exact bug the user flagged — quote shows Won
    // while its payment still sits in admin's Pending Approval list.
    // When sales submits a pending payment, leave the quote in its
    // current status; admin's approval (approvePayment) flips it to
    // 'won' atomically. Campaign dates are still saved so admin
    // doesn't have to re-enter them on approval.
    if (!isAdmin && hasPayment) {
      if (paymentData.campaign_start_date || paymentData.campaign_end_date) {
        const { error: dateErr } = await updateQuoteStatus(quote.id, quote.status, {
          campaign_start_date: paymentData.campaign_start_date,
          campaign_end_date:   paymentData.campaign_end_date,
        })
        if (dateErr) {
          setUpdatingStatus(false)
          setError(`Campaign dates could not be saved: ${dateErr.message}`)
          return
        }
      }
      setUpdatingStatus(false)
      setStatusMsg('Payment submitted for admin approval. Quote will be marked Won once approved.')
      fetchPayments()
      fetchQuoteById(id)
      setTimeout(() => setStatusMsg(''), 4500)
      return
    }

    // Admin path (or sales who skipped the payment): flip to Won now.
    const updates = {
      status: 'won',
      campaign_start_date: paymentData.campaign_start_date,
      campaign_end_date: paymentData.campaign_end_date,
    }
    const { error: err } = await updateQuoteStatus(quote.id, 'won', updates)
    setUpdatingStatus(false)
    if (err) {
      setError(err.message)
    } else {
      setStatusMsg('Quote marked as Won!')
      fetchPayments()
      fetchQuoteById(id)
      setTimeout(() => setStatusMsg(''), 3000)
    }
  }

  async function handleDownloadPDF() {
    if (!quote) return
    setPdfLoading(true)
    try { await downloadQuotePDF(quote, cities) }
    catch (e) { setError('PDF generation failed: ' + e.message) }
    finally { setPdfLoading(false) }
  }

  async function handleWhatsApp() {
    if (!quote) return
    // Upload PDF first so the WhatsApp message carries a public URL
    // the client can tap to download. wa.me can't attach files, so
    // this shortlink is the only way to get the PDF to them.
    // On failure (bucket not set up, RLS block, network), fall back
    // to sending the message without a link + trigger a local
    // download so the sales user can attach it manually.
    let pdfUrl = null
    try {
      setPdfLoading(true)
      pdfUrl = await uploadQuotePDF(quote, cities)
    } catch (e) {
      console.warn('PDF upload failed, falling back:', e.message)
      try { await downloadQuotePDF(quote, cities) } catch {}
      setStatusMsg('PDF uploaded failed — downloaded locally. Please attach it in WhatsApp.')
      setTimeout(() => setStatusMsg(''), 4000)
    } finally {
      setPdfLoading(false)
    }
    openWhatsApp(quote.client_phone, buildWhatsAppMessage(quote, cities, { pdfUrl }))
  }

  async function handleEditPayment(updated) {
    if (!editingPayment) return
    const { error } = await updatePayment(editingPayment.id, updated)
    if (error) {
      setError(error.message)
    } else {
      setShowEditPayment(false)
      setEditingPayment(null)
      fetchPayments()
    }
  }

  async function handleDeletePayment(paymentId) {
    const { error } = await deletePayment(paymentId)
    if (error) {
      setError(error.message)
    } else {
      fetchPayments()
    }
  }

  if (loading) {
    return (
      <div className="loading-screen" style={{ minHeight: 300 }}>
        <div className="spinner" />
      </div>
    )
  }

  if (!quote) {
    return (
      <div className="page">
        <div className="empty-state">
          <p>Quote not found.</p>
          <button className="btn btn-ghost btn-sm" style={{ marginTop: 12 }} onClick={() => navigate('/quotes')}>
            Back to Quotes
          </button>
        </div>
      </div>
    )
  }

  const allowed = getAllowedTransitions(quote, hasFinalPayment)

  return (
    <div className="page">
      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, flexWrap: 'wrap', gap: 10 }}>
        <button className="btn btn-ghost btn-sm" onClick={() => navigate('/quotes')}>
          <ArrowLeft size={15} /> Back
        </button>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {/* Edit button: available to both admin and sales at every
              status except 'lost' — lost quotes are archival. This lets
              either role correct client details, swap cities, or
              adjust rates even after a quote has been sent or won.
              See WizardShell.jsx for status-preservation semantics. */}
          {quote?.status !== 'lost' && (
            <button
              className="btn btn-sec btn-sm"
              onClick={() => navigate(`/quotes/new?editOf=${id}`)}
              title="Edit this quote"
            >
              <Pencil size={14} /> Edit
            </button>
          )}
          <button className="btn btn-sec btn-sm" onClick={handleWhatsApp}>
            <MessageCircle size={14} /> WhatsApp
          </button>
          <button className="btn btn-sec btn-sm" onClick={handleDownloadPDF} disabled={pdfLoading}>
            <Download size={14} /> {pdfLoading ? 'Generating…' : 'PDF'}
          </button>
        </div>
      </div>

      {error && (
        <div style={{ background: 'rgba(229,57,53,.1)', border: '1px solid rgba(229,57,53,.3)', borderRadius: 8, padding: '10px 14px', marginBottom: 14, fontSize: '.82rem', color: '#ef9a9a', display: 'flex', gap: 8, alignItems: 'center' }}>
          <X size={14} /> {error}
          <button style={{ background: 'none', border: 'none', color: '#ef9a9a', marginLeft: 'auto', cursor: 'pointer' }} onClick={() => setError('')}>✕</button>
        </div>
      )}

      {statusMsg && (
        <div style={{ background: 'rgba(76,175,80,.1)', border: '1px solid rgba(76,175,80,.3)', borderRadius: 8, padding: '10px 14px', marginBottom: 14, fontSize: '.82rem', color: '#81c784' }}>
          ✓ {statusMsg}
        </div>
      )}

      {/* ── Quote Card ── */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: '1rem', color: 'var(--y)', letterSpacing: '.08em', marginBottom: 4 }}>
              {quote.quote_number}
            </div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: '1.5rem', letterSpacing: '.03em', marginBottom: 4 }}>
              {quote.client_name}
            </div>
            <div style={{ fontSize: '.82rem', color: 'var(--gray)' }}>
              {quote.client_company} {quote.client_company && '·'} {formatDate(quote.created_at)}
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: '1.8rem', color: 'var(--y)', lineHeight: 1 }}>
              {formatCurrency(quote.total_amount)}
            </div>
            <div style={{ fontSize: '.72rem', color: 'var(--gray)', marginTop: 3 }}>incl. GST</div>

            {/* Status badge + dropdown */}
            <div style={{ position: 'relative', display: 'inline-block', marginTop: 8 }}>
              <button
                onClick={() => allowed.length > 0 && setStatusOpen(o => !o)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  background: 'rgba(255,255,255,.06)', border: `1.5px solid ${STATUS_COLORS[quote.status] || 'var(--brd)'}`,
                  borderRadius: 20, padding: '4px 12px', cursor: allowed.length > 0 ? 'pointer' : 'default',
                  color: STATUS_COLORS[quote.status] || 'var(--gray)', fontSize: '.78rem', fontWeight: 700,
                }}
              >
                {STATUS_LABELS[quote.status] || quote.status}
                {allowed.length > 0 && <ChevronDown size={12} />}
              </button>

              {statusOpen && allowed.length > 0 && (
                <>
                  <div style={{ position: 'fixed', inset: 0, zIndex: 9 }} onClick={() => setStatusOpen(false)} />
                  <div style={{
                    position: 'absolute', right: 0, top: '110%', zIndex: 10,
                    background: 'var(--dk)', border: '1.5px solid var(--brd)', borderRadius: 10,
                    minWidth: 160, overflow: 'hidden', boxShadow: '0 8px 24px rgba(0,0,0,.5)',
                  }}>
                    {allowed.map(s => (
                      <button
                        key={s}
                        onClick={() => handleStatusChange(s)}
                        style={{
                          display: 'block', width: '100%', padding: '10px 14px',
                          background: 'none', border: 'none', textAlign: 'left',
                          color: STATUS_COLORS[s] || 'var(--wh)', fontSize: '.82rem', fontWeight: 600, cursor: 'pointer',
                        }}
                        onMouseEnter={e => e.target.style.background = 'rgba(255,255,255,.05)'}
                        onMouseLeave={e => e.target.style.background = 'none'}
                      >
                        → {STATUS_LABELS[s] || s}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Tabs ── */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 16, background: 'var(--mid)', border: '1.5px solid var(--brd)', borderRadius: 10, padding: 5 }}>
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            style={{
              flex: 1, padding: '8px 12px', borderRadius: 7, border: 'none',
              background: activeTab === t.key ? 'var(--y)' : 'none',
              color: activeTab === t.key ? 'var(--bk)' : 'var(--gray)',
              fontWeight: 700, fontSize: '.82rem', cursor: 'pointer', transition: '.15s',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Overview Tab ── */}
      {activeTab === 'overview' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Client Details */}
          <div className="card">
            <div className="card-h">
              <div className="card-t">Client Details</div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px,1fr))', gap: 14 }}>
              {[
                { icon: <Building2 size={13} />, label: 'Company', val: quote.client_company },
                { icon: <Phone size={13} />, label: 'Phone', val: formatPhone(quote.client_phone) },
                { icon: <Mail size={13} />, label: 'Email', val: quote.client_email },
                { icon: <MapPin size={13} />, label: 'Address', val: quote.client_address },
                { icon: <FileText size={13} />, label: 'GSTIN', val: quote.client_gst },
              ].filter(f => f.val).map((f, i) => (
                <div key={i}>
                  <div style={{ fontSize: '.68rem', color: 'var(--gray)', textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 3, display: 'flex', alignItems: 'center', gap: 4 }}>
                    {f.icon} {f.label}
                  </div>
                  <div style={{ fontSize: '.88rem', fontWeight: 600 }}>{f.val}</div>
                </div>
              ))}
            </div>
            {quote.client_notes && (
              <div style={{ marginTop: 14, padding: '10px 14px', background: 'rgba(255,255,255,.03)', borderRadius: 8, fontSize: '.82rem', color: 'var(--gray)' }}>
                {quote.client_notes}
              </div>
            )}
          </div>

          {/* Campaign Details */}
          <div className="card">
            <div className="card-h">
              <div className="card-t">Campaign Details</div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))', gap: 14, marginBottom: 16 }}>
              {[
                { label: 'Duration', val: `${quote.duration_months} Month${quote.duration_months !== 1 ? 's' : ''}` },
                { label: 'Type', val: quote.revenue_type === 'renewal' ? 'Renewal' : 'New Client' },
                { label: 'Prepared By', val: quote.sales_person_name },
                { label: 'Locations', val: `${cities.length} Cit${cities.length !== 1 ? 'ies' : 'y'}` },
              ].map((f, i) => (
                <div key={i}>
                  <div style={{ fontSize: '.68rem', color: 'var(--gray)', textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 3 }}>{f.label}</div>
                  <div style={{ fontSize: '.88rem', fontWeight: 600 }}>{f.val}</div>
                </div>
              ))}
            </div>

            {/* Cities table */}
            {cities.length > 0 && (
              <div className="tw">
                <table>
                  <thead>
                    <tr>
                      <th>City</th>
                      <th>Grade</th>
                      <th style={{ textAlign: 'center' }}>Screens</th>
                      <th style={{ textAlign: 'center' }}>Duration</th>
                      <th style={{ textAlign: 'right' }}>Listed</th>
                      <th style={{ textAlign: 'right' }}>Offered</th>
                      <th style={{ textAlign: 'right' }}>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cities.map((c, i) => (
                      <tr key={i}>
                        <td style={{ fontWeight: 600 }}>{c.city_name}</td>
                        <td>
                          <span className={`badge ${c.grade === 'A' ? 'b-accepted' : c.grade === 'B' ? 'b-viewed' : 'b-draft'}`}>
                            {c.grade}
                          </span>
                        </td>
                        <td style={{ textAlign: 'center' }}>{c.screens}</td>
                        <td style={{ textAlign: 'center' }}>{c.duration_months}mo</td>
                        <td style={{ textAlign: 'right', color: 'var(--gray)', textDecoration: 'line-through', fontSize: '.78rem' }}>
                          {formatCurrency(c.listed_rate)}
                        </td>
                        <td style={{ textAlign: 'right', color: '#81c784', fontWeight: 600 }}>
                          {formatCurrency(c.offered_rate)}
                        </td>
                        <td style={{ textAlign: 'right', fontWeight: 700 }}>
                          {formatCurrency(c.campaign_total)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Totals */}
            <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div className="sum-row"><span>Subtotal</span><span>{formatCurrency(quote.subtotal)}</span></div>
              <div className="sum-row"><span>GST (18%)</span><span>{formatCurrency(quote.gst_amount)}</span></div>
              <div className="sum-tot">
                <span>Total</span>
                <span style={{ fontFamily: 'var(--font-display)', fontSize: '1.4rem' }}>{formatCurrency(quote.total_amount)}</span>
              </div>
            </div>
          </div>

          {/* Payment Summary */}
          <PaymentSummary totalAmount={quote.total_amount} totalPaid={totalPaid} hasFinalPayment={hasFinalPayment} />

          {/* Won quote actions — Create Renewal stays here so the
              renewal CTA is visible at the bottom of the quote.
              The previous "Edit Campaign Dates" / "Edit Client Details"
              buttons opened a modal that was never rendered (dead state);
              full editing now lives on the Edit button in the header
              and is available for every status except 'lost'. */}
          {quote.status === 'won' && (
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
              <button className="btn btn-y btn-sm" onClick={() => navigate(`/quotes/new?renewalOf=${id}`)}>
                Create Renewal Quote
              </button>
            </div>
          )}

          {/* Add payment button — both admin and sales can add */}
          {quote.status !== 'lost' && !hasFinalPayment && (
            <div style={{ textAlign: 'center' }}>
              <button className="btn btn-y" onClick={() => { fetchPayments(); setShowPaymentModal(true) }}>
                <CreditCard size={15} /> Add Payment
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── Payments Tab ── */}
      {activeTab === 'payments' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <PaymentSummary totalAmount={quote.total_amount} totalPaid={totalPaid} hasFinalPayment={hasFinalPayment} />
          <PaymentHistory
            payments={payments}
            loading={paymentsLoading}
            onEdit={p => { setEditingPayment(p); setShowEditPayment(true) }}
            onDelete={handleDeletePayment}
          />
          {quote.status !== 'lost' && !hasFinalPayment && (
            <div style={{ textAlign: 'center', paddingBottom: 8 }}>
              <button className="btn btn-y" onClick={() => setShowPaymentModal(true)}>
                <CreditCard size={15} /> Add Payment
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── Follow-ups Tab ── */}
      {activeTab === 'followups' && (
        <div className="card">
          <FollowUpList quoteId={id} assignedTo={quote.created_by} />
        </div>
      )}

      {/* ── Payment Modal ── */}
      {showPaymentModal && (
        <PaymentModal
          quote={quote}
          totalPaid={totalPaid}
          existingPayments={payments}
          onClose={() => setShowPaymentModal(false)}
          onSave={async (paymentData) => {
            const result = await addPayment(paymentData)
            if (!result.error) {
              fetchPayments()
              fetchQuoteById(id)
            }
            return result
          }}
        />
      )}

      {/* ── Edit Payment Modal ── */}
      {showEditPayment && editingPayment && (
        <PaymentModal
          quote={quote}
          totalPaid={totalPaid - (editingPayment.amount_received || 0)}
          existingPayments={payments.filter(p => p.id !== editingPayment.id)}
          initialPayment={editingPayment}
          onClose={() => { setShowEditPayment(false); setEditingPayment(null) }}
          onSave={async (paymentData) => {
            const result = await updatePayment(editingPayment.id, paymentData)
            if (!result.error) {
              fetchPayments()
              fetchQuoteById(id)
            }
            return result
          }}
        />
      )}

      {/* ── Won Modal — collect payment when marking Won ── */}
      {showWonModal && (
        <WonPaymentModal
          quote={quote}
          onConfirm={handleWonWithPayment}
          onSkip={() => { setShowWonModal(false); handleStatusChange_direct('won') }}
          onClose={() => setShowWonModal(false)}
        />
      )}
    </div>
  )

  async function handleStatusChange_direct(newStatus) {
    setUpdatingStatus(true)
    const { error: err } = await updateQuoteStatus(quote.id, newStatus)
    setUpdatingStatus(false)
    if (err) setError(err.message)
    else { setStatusMsg(`Status updated to ${STATUS_LABELS[newStatus]}`); setTimeout(() => setStatusMsg(''), 3000) }
  }
}

// ── Won Payment Modal ────────────────────────────────────────────────────────
function WonPaymentModal({ quote, onConfirm, onSkip, onClose }) {
  const today = todayISO()
  const [form, setForm] = useState({
    amount_received: '',
    payment_mode: 'NEFT',
    payment_date: today,
    payment_notes: '',
    is_final: false,
    campaign_start_date: today,
    campaign_end_date: '',
  })

  function set(k, v) {
    const updated = { ...form, [k]: v }
    // Auto-calculate end date if start changes and duration exists
    if (k === 'campaign_start_date' && quote.duration_months) {
      const start = new Date(v)
      const end = new Date(start)
      end.setMonth(end.getMonth() + quote.duration_months)
      updated.campaign_end_date = end.toISOString().split('T')[0]
    }
    setForm(updated)
  }

  const balance = quote.total_amount - (Number(form.amount_received) || 0)
  const campaignDatesValid = form.campaign_start_date && form.campaign_end_date

  return (
    <div className="mo">
      <div className="md">
        <div className="md-h">
          <div>
            <div className="md-t">💰 Mark as Won</div>
            <div style={{ fontSize: '.75rem', color: 'var(--gray)', marginTop: 3 }}>Enter payment details to confirm</div>
          </div>
          <button className="md-x" onClick={onClose}>✕</button>
        </div>
        <div className="md-b">
          {/* Quote summary */}
          <div style={{ background: 'rgba(255,230,0,.08)', border: '1.5px solid rgba(255,230,0,.2)', borderRadius: 9, padding: '13px 16px', marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: '.72rem', color: 'var(--gray)' }}>Quote</div>
                <div style={{ fontWeight: 700, color: 'var(--y)' }}>{quote.quote_number}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: '.72rem', color: 'var(--gray)' }}>Invoice Total</div>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: '1.4rem', color: 'var(--y)' }}>
                  {formatCurrency(quote.total_amount)}
                </div>
              </div>
            </div>
          </div>

          <div className="grid2">
            <div className="fg">
              <label>Amount Received (₹)</label>
              <input type="number" value={form.amount_received} onChange={e => set('amount_received', e.target.value)} placeholder="Enter amount" />
            </div>
            <div className="fg">
              <label>Payment Mode</label>
              <select value={form.payment_mode} onChange={e => set('payment_mode', e.target.value)}>
                {['NEFT','RTGS','UPI','Cheque','Cash'].map(m => <option key={m}>{m}</option>)}
              </select>
            </div>
          </div>

          <div className="fg">
            <label>Payment Date</label>
            <input type="date" value={form.payment_date} onChange={e => set('payment_date', e.target.value)} />
          </div>

          <div className="fg">
            <label>Notes (cheque no., UTR, etc.)</label>
            <textarea value={form.payment_notes} onChange={e => set('payment_notes', e.target.value)} placeholder="Optional" style={{ minHeight: 60 }} />
          </div>

          <div style={{ borderTop: '1px solid rgba(255,255,255,.1)', paddingTop: 14, marginTop: 14 }}>
            <div style={{ fontSize: '.78rem', color: 'var(--gray)', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 10, fontWeight: 600 }}>Campaign Dates *</div>
            <div className="grid2">
              <div className="fg">
                <label>Start Date</label>
                <input type="date" value={form.campaign_start_date} onChange={e => set('campaign_start_date', e.target.value)} />
              </div>
              <div className="fg">
                <label>End Date</label>
                <input type="date" value={form.campaign_end_date} onChange={e => set('campaign_end_date', e.target.value)} />
              </div>
            </div>
            {!campaignDatesValid && (
              <div style={{ fontSize: '.78rem', color: '#ef9a9a', marginTop: 6 }}>Both dates required to mark Won</div>
            )}
          </div>

          {form.amount_received > 0 && balance > 0 && (
            <div style={{ background: 'rgba(229,57,53,.1)', border: '1px solid rgba(229,57,53,.3)', borderRadius: 8, padding: '10px 14px', marginBottom: 12, fontSize: '.82rem', marginTop: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#ef9a9a', fontWeight: 700 }}>Balance Due</span>
                <span style={{ color: '#ef9a9a', fontWeight: 800 }}>{formatCurrency(balance)}</span>
              </div>
            </div>
          )}

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12 }}>
            <input type="checkbox" id="isFinal" checked={form.is_final} onChange={e => set('is_final', e.target.checked)} />
            <label htmlFor="isFinal" style={{ fontSize: '.82rem', cursor: 'pointer' }}>
              This is the final / full payment
            </label>
          </div>
        </div>
        <div className="md-f">
          <button className="btn btn-ghost" onClick={onSkip}>Skip Payment for Now</button>
          <button className="btn btn-y" onClick={() => onConfirm(form)} disabled={!campaignDatesValid}>✓ Confirm & Mark Won</button>
        </div>
      </div>
    </div>
  )
}


