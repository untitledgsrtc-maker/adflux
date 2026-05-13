// src/pages/QuoteDetail.jsx
import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  ArrowLeft, Download, MessageCircle, ChevronDown,
  Building2, Phone, Mail, MapPin, FileText, Calendar,
  CheckCircle, CreditCard, X, Pencil, Trash2
} from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { useQuotes } from '../hooks/useQuotes'
import { usePayments } from '../hooks/usePayments'
import { supabase } from '../lib/supabase'
import { QuoteStatusBadge } from '../components/quotes/QuoteStatusBadge'
import { downloadQuotePDF, uploadQuotePDF } from '../components/quotes/QuotePDF'
// Phase 15 — ENIL-style PDF for Other Media quotes (newspaper, hoarding,
// cinema, …). Routed in handleDownloadPDF based on quote.media_type so
// the existing private LED PDF stays untouched.
import { downloadOtherMediaPdf } from '../components/quotes/OtherMediaQuotePDF'
import { buildWhatsAppMessage, openWhatsApp, shortenUrl } from '../utils/whatsapp'
import { PaymentModal } from '../components/payments/PaymentModal'
import { PaymentHistory } from '../components/payments/PaymentHistory'
import { PaymentSummary } from '../components/payments/PaymentSummary'
import IncentiveForecastCard from '../components/quotes/IncentiveForecastCard'
import { WonPaymentModal } from '../components/payments/WonPaymentModal'
import { toastError } from '../components/v2/Toast'
import { STATUS_COLOR_VARS as STATUS_COLORS } from '../utils/constants'
import { DidYouKnow } from '../components/v2/DidYouKnow'
import { FollowUpList } from '../components/followups/FollowUpList'
import { formatCurrency, formatDate, formatPhone, todayISO } from '../utils/formatters'
import { STATUS_LABELS } from '../utils/constants'

function getAllowedTransitions(quote, hasFinalPayment) {
  // Won-with-no-final-payment is the "client said yes, never paid"
  // case. Allow rep to back it out to negotiating/sent (still chasing)
  // OR mark it lost (gave up). Adding 'lost' here is what stops stale
  // won quotes from sitting in the forecast forever — once a rep
  // accepts the deal isn't going to settle, they can close the loop.
  // Won-WITH-final-payment stays locked: the money cleared, the rep
  // earned the incentive, no take-backs.
  if (quote.status === 'won' && !hasFinalPayment) {
    return ['negotiating', 'sent', 'lost']
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

// Phase 34g — was a local hex-table (#64b5f6, #ffb74d, #81c784,
// #ef9a9a — off-brand Material Design palette). Switched to the
// single shared map STATUS_COLOR_VARS in utils/constants.js so brand
// changes propagate automatically. Import is at the top of the file.

export default function QuoteDetail() {
  const { id } = useParams()
  const navigate = useNavigate()

  const { isAdmin, profile } = useAuth()
  const { fetchQuoteById, updateQuoteStatus, currentQuote } = useQuotes()

  // Phase 30C — auto-log every WhatsApp / Email click on the quote
  // detail page as a lead_activity entry, so admin sees a touch
  // history per lead without each rep manually opening the activity
  // modal first. Only inserts when the quote is linked to a lead
  // (Phase 14 lead_id column) — older quotes without lead_id silently
  // skip the log to avoid NOT NULL violations.
  async function logQuoteTouch(activityType, notes) {
    if (!currentQuote?.lead_id) return
    try {
      await supabase.from('lead_activities').insert([{
        lead_id:       currentQuote.lead_id,
        activity_type: activityType,
        outcome:       null,
        notes,
        created_by:    profile?.id || null,
      }])
    } catch (e) {
      // Logging is best-effort — never block the user-facing action.
      console.warn('[quote-touch] activity log failed:', e?.message)
    }
  }
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

  // Phase 6: Government quotes have their own renderer page. If we
  // landed here for a govt-segment quote (legacy bookmark or list
  // click before the QuotesV2 list learned to discriminate), bounce
  // over to /proposal/:id without losing the user's place.
  useEffect(() => {
    if (currentQuote?.segment === 'GOVERNMENT') {
      navigate(`/proposal/${id}`, { replace: true })
    }
  }, [currentQuote?.segment, id, navigate])

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

    // Sales-with-payment gate: payment lands as approval_status='pending'.
    // We DON'T flip the quote to 'won' here — admin's approval flow
    // (approvePayment) does that atomically when the payment is
    // approved. Otherwise the quote would show Won while its payment
    // still sits in admin's pending queue. Campaign dates are still
    // saved so admin doesn't have to re-enter them on approval.
    //
    // Sales-WITHOUT-payment falls through to the win-now path below —
    // there's no payment to approve, so the quote just flips to Won.
    // Incentive still doesn't credit until a final approved payment
    // lands (DB trigger gates monthly_sales_data on that).
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
    try {
      // Phase 15 — Other Media quotes get the ENIL-style invoice PDF.
      // Everything else (private LED, govt) keeps the existing PDF.
      if (quote.media_type === 'OTHER_MEDIA') {
        await downloadOtherMediaPdf({ quote, lines: cities })
      } else {
        await downloadQuotePDF(quote, cities)
      }
    }
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
      // Phase 34c — the inner catch on downloadQuotePDF was empty, so
      // if both upload AND local download failed the user saw
      // "downloaded locally" while nothing was downloaded — then the
      // WhatsApp opened with no attachment and they thought the deal
      // had shipped with a PDF. Surface that double-failure via toast.
      console.warn('PDF upload failed, falling back:', e.message)
      let downloadedLocally = false
      try {
        await downloadQuotePDF(quote, cities)
        downloadedLocally = true
      } catch (dlErr) {
        toastError(dlErr, 'PDF upload AND local download failed. WhatsApp will open without an attachment.')
      }
      if (downloadedLocally) {
        setStatusMsg('PDF upload failed — downloaded locally. Please attach it in WhatsApp.')
        setTimeout(() => setStatusMsg(''), 4000)
      }
    } finally {
      setPdfLoading(false)
    }
    // Shorten the Supabase storage URL (~130 chars) to a tinyurl.com
    // link so WhatsApp shows a clean preview card instead of a wrapped
    // spammy-looking blob. Shortener failures fall back to the original
    // URL inside shortenUrl — never blocks the send.
    if (pdfUrl) {
      try { pdfUrl = await shortenUrl(pdfUrl) } catch {}
    }
    openWhatsApp(quote.client_phone, buildWhatsAppMessage(quote, cities, { pdfUrl }))
    // Phase 30C — record the touch in the lead's activity timeline.
    logQuoteTouch('whatsapp', `WhatsApp · proposal ${quote.quote_number || quote.ref_number || ''}${pdfUrl ? ' · PDF link sent' : ''}`)
  }

  // Phase 11i — team feedback: add Email parallel to WhatsApp.
  // Phase 11j — switched from mailto: to Gmail web compose.
  // mailto: silently no-ops on macs without a configured mail handler;
  // Gmail compose URL works in any browser for the user's Gmail account.
  async function handleEmail() {
    if (!quote) return
    let pdfUrl = null
    try {
      setPdfLoading(true)
      pdfUrl = await uploadQuotePDF(quote, cities)
    } catch (e) {
      console.warn('[email] PDF upload failed:', e?.message)
    } finally {
      setPdfLoading(false)
    }
    if (pdfUrl) {
      try { pdfUrl = await shortenUrl(pdfUrl) } catch {}
    }
    const to      = (quote.client_email || '').trim()
    const subject = `Proposal — ${quote.quote_number || quote.ref_number || ''}`
    let body =
      `Dear ${quote.client_name || 'Sir/Madam'},\n\n` +
      `Please find our proposal — ${quote.quote_number || quote.ref_number || ''}.\n` +
      `Total: Rs. ${formatCurrency(quote.total_amount).replace('₹','')}\n`
    if (pdfUrl) body += `\nProposal PDF: ${pdfUrl}\n`
    body += `\nThank you,\nUntitled Adflux Pvt Ltd`

    const gmailHref =
      `https://mail.google.com/mail/?view=cm&fs=1` +
      `&to=${encodeURIComponent(to)}` +
      `&su=${encodeURIComponent(subject)}` +
      `&body=${encodeURIComponent(body)}`

    const win = window.open(gmailHref, '_blank', 'noopener')
    if (!win) {
      const mailtoHref =
        `mailto:${encodeURIComponent(to)}` +
        `?subject=${encodeURIComponent(subject)}` +
        `&body=${encodeURIComponent(body)}`
      window.location.href = mailtoHref
    }
    // Phase 30C — record the touch in the lead's activity timeline.
    logQuoteTouch('email', `Email · proposal ${quote.quote_number || quote.ref_number || ''}${pdfUrl ? ' · PDF link sent' : ''}${to ? ` · to ${to}` : ''}`)
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
      {/* Phase 34.9 (C) discoverability — show the rep where the
          incentive forecast lives + remind about Mark Won workflow. */}
      <DidYouKnow id="quote-detail-mark-won-2026-05-13" title="Closing this deal?">
        Scroll to "If you close this this month" — shows exactly how much
        incentive you'll earn. When client says yes, click <strong>Mark Won</strong>
        — upload WO + dates + payment. Auto-credits your monthly slab.
      </DidYouKnow>

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
              See WizardShell.jsx for status-preservation semantics.
              Phase 29b — Other Media has its own wizard; the Private
              LED WizardShell can't load OTHER_MEDIA quotes correctly,
              so route by media_type. */}
          {quote?.status !== 'lost' && (
            <button
              className="btn btn-sec btn-sm"
              onClick={() => {
                // Phase 32C — owner reported (10 May 2026) Edit button
                // does nothing. Root cause: /quotes/new routes to
                // CreateQuoteChooserV2 (the "Govt or Private?" picker),
                // NOT the Private LED wizard, which lives at
                // /quotes/new/private. The chooser dropped the editOf
                // query string, so reps landed on the picker page with
                // no edit context and assumed nothing happened.
                // Fixed: navigate directly to the wizard route by
                // media_type. Same pattern OTHER_MEDIA already uses.
                if (quote?.media_type === 'OTHER_MEDIA') {
                  navigate('/quotes/new/private/other-media', { state: { editingId: id } })
                } else {
                  navigate(`/quotes/new/private?editOf=${id}`)
                }
              }}
              title="Edit this quote"
            >
              <Pencil size={14} /> Edit
            </button>
          )}
          <button className="btn btn-sec btn-sm" onClick={handleWhatsApp}>
            <MessageCircle size={14} /> WhatsApp
          </button>
          {/* Phase 11i — Email parallel to WhatsApp; uploads PDF and
              opens default mail client with the link prefilled. */}
          <button className="btn btn-sec btn-sm" onClick={handleEmail} disabled={pdfLoading}>
            <Mail size={14} /> Email
          </button>
          <button className="btn btn-sec btn-sm" onClick={handleDownloadPDF} disabled={pdfLoading}>
            <Download size={14} /> {pdfLoading ? 'Generating…' : 'PDF'}
          </button>
          {/* Phase 29b — Delete (hard remove from DB), drafts only.
              Phase 11b's DB trigger blocks delete on non-draft quotes
              so the button is hidden when status != 'draft' to avoid
              an obvious dead click. Confirmation prompt prevents
              accidents. */}
          {quote?.status === 'draft' && (
            <button
              className="btn btn-sec btn-sm"
              style={{ borderColor: 'var(--red)', color: 'var(--red)' }}
              onClick={async () => {
                if (!confirm('DELETE this draft quote permanently? This cannot be undone.')) return
                const { error: delErr } = await supabase
                  .from('quotes').delete().eq('id', id)
                if (delErr) {
                  setError(delErr.message || 'Failed to delete draft.')
                  return
                }
                navigate('/quotes')
              }}
              title="Delete this draft permanently"
            >
              <Trash2 size={14} /> Delete
            </button>
          )}
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
                  <div style={{ position: 'fixed', inset: 0, zIndex: 999 }} onClick={() => setStatusOpen(false)} />
                  <div style={{
                    position: 'absolute', right: 0, top: '110%', zIndex: 1000,
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
                      <th style={{ textAlign: 'center' }}>Slot</th>
                      <th style={{ textAlign: 'center' }}>Slots/day</th>
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
                        {/* Slot metadata — pre-migration rows lack these
                            columns, so we fall back to the historical
                            defaults (10s, 100/day) rather than showing —. */}
                        <td style={{ textAlign: 'center' }}>{c.slot_seconds ?? 10}s</td>
                        <td style={{ textAlign: 'center' }}>
                          {c.slots_per_day ?? 100}
                          {c.slots_override_reason && (
                            <span
                              title={c.slots_override_reason}
                              style={{ marginLeft: 4, color: '#ffb74d', fontSize: '.7rem' }}
                            >
                              *
                            </span>
                          )}
                        </td>
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
            {/* GST row reads the per-quote gst_rate so "No GST" quotes
                don't display a phantom 18% line. Fallback to 0.18 for
                rows that predate the gst_rate migration. */}
            {(() => {
              const rate = quote.gst_rate !== null && quote.gst_rate !== undefined
                ? Number(quote.gst_rate)
                : 0.18
              const pct = Math.round(rate * 100)
              return (
                <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div className="sum-row"><span>Subtotal</span><span>{formatCurrency(quote.subtotal)}</span></div>
                  {rate > 0 ? (
                    <div className="sum-row"><span>GST ({pct}%)</span><span>{formatCurrency(quote.gst_amount)}</span></div>
                  ) : (
                    <div className="sum-row" style={{ color: 'var(--text-muted)' }}><span>No GST</span><span>—</span></div>
                  )}
                  <div className="sum-tot">
                    <span>Total</span>
                    <span style={{ fontFamily: 'var(--font-display)', fontSize: '1.4rem' }}>{formatCurrency(quote.total_amount)}</span>
                  </div>
                </div>
              )
            })()}
          </div>

          {/* Payment Summary */}
          <PaymentSummary totalAmount={quote.total_amount} totalPaid={totalPaid} hasFinalPayment={hasFinalPayment} />

          {/* Phase 34D — incentive forecast. Hidden for admin + for
              already-won/lost quotes. Tells the rep how much closing
              this quote this month bumps their incentive. */}
          <IncentiveForecastCard quote={quote} />

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

      {/* ── Won Modal — collect payment when marking Won ──
          Only way to mark Won is by recording a payment. The previous
          "Skip Payment for Now" button flipped status to Won with no
          payment, which caused the Won Revenue KPI and Active Campaigns
          to show quotes that had nothing received. Removed so the
          business rule "no payment = no Won" is enforced at the UI. */}
      {showWonModal && (
        <WonPaymentModal
          quote={quote}
          totalPaid={totalPaid}
          onConfirm={handleWonWithPayment}
          onClose={() => setShowWonModal(false)}
        />
      )}
    </div>
  )
}

// WonPaymentModal extracted to src/components/payments/WonPaymentModal.jsx
// so the govt detail page can share the same flow.
