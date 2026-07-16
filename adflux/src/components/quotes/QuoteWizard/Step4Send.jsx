import { useState } from 'react'
import { CheckCircle, MessageCircle, FileText, ArrowRight } from 'lucide-react'
import { openWhatsApp } from '../../../utils/whatsapp'
// Phase 239 — share cascade unified with QuoteDetail. This button was link-only
// (owner 16 Jul: "direct quotation share goes as a link"); now it uses the same
// shared helper so the APK attaches the real PDF, web sends a link. ONE
// definition (§71) — no more drift between the two share buttons.
import { shareQuoteViaWhatsApp } from '../../../utils/shareQuoteWhatsApp'
import { formatCurrency } from '../../../utils/formatters'

export function Step4Send({ quote, cities, subtotal, gst_amount, total_amount, onDone, onViewQuote }) {
  const [sent, setSent] = useState(false)
  const [toastMsg, setToastMsg] = useState('')
  const [sending, setSending] = useState(false)
  // Phase 32K — owner reported (10 May 2026) "Open WhatsApp Again"
  // button did nothing. Root cause: the original handler did
  // window.open() AFTER multiple awaits (PDF upload + URL shorten).
  // Mobile Safari + several desktop browsers strip popup permission
  // once the user-gesture context is broken by an await; window.open
  // gets silently blocked. Fix: cache the built message + phone after
  // the first successful send so re-clicks open WhatsApp synchronously
  // with no async work — popup permission stays intact.
  const [cachedMessage, setCachedMessage] = useState(null)

  function reopenWhatsApp() {
    // Synchronous open — no awaits between click and window.open.
    if (cachedMessage) {
      openWhatsApp(quote.client_phone, cachedMessage)
    }
  }

  async function handleWhatsApp() {
    // Already sent once on WEB → re-open synchronously with the cached message
    // (keeps the user-gesture chain unbroken so the popup isn't blocked — Phase
    // 32K). On the APK the native share re-runs below (no popup issue; no cache).
    if (sent && cachedMessage) {
      reopenWhatsApp()
      return
    }
    setSending(true)
    let warned = false
    try {
      // Phase 239 — same cascade as QuoteDetail: attach the PDF on the APK,
      // wa.me link on web. Was link-only here (owner 16 Jul).
      const r = await shareQuoteViaWhatsApp(quote, cities, {
        // Keep the failure reason visible (§236) — do NOT let the summary
        // toast below clobber it into a false "success".
        onStatus: (s) => { warned = true; setToastMsg(s.message) },
      })
      if (r.method !== 'cancelled') {
        if (r.method === 'link' && r.message) setCachedMessage(r.message)   // Phase 32K — cache for re-click (web)
        if (!warned) {
          setToastMsg(r.method === 'attach'
            ? 'PDF attached in WhatsApp.'
            : (r.pdfUrl ? 'PDF link included in WhatsApp message.' : ''))
        }
        setSent(true)
        setTimeout(() => setToastMsg(''), warned ? 12000 : 3500)
      }
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="wizard-step wizard-step--send">
      <div className="send-success">
        <div className="send-success-icon">
          <CheckCircle size={40} color="var(--success)" />
        </div>
        <h2 className="send-success-title">Quote Created!</h2>
        <p className="send-success-sub">
          <strong style={{ color: 'var(--text)' }}>{quote.quote_number}</strong> saved for{' '}
          {quote.client_name}
        </p>
      </div>

      <div className="send-summary">
        <div className="send-summary-row">
          <span>Total Amount</span>
          <strong style={{ color: 'var(--accent)', fontSize: 20 }}>{formatCurrency(total_amount)}</strong>
        </div>
        <div className="send-summary-row">
          <span>Status</span>
          <span className="badge badge-sent">Sent</span>
        </div>
      </div>

      <div className="send-actions">
        {quote.client_phone ? (
          <button
            className={`btn btn-primary send-whatsapp-btn${sent ? ' send-whatsapp-btn--done' : ''}`}
            onClick={handleWhatsApp}
            disabled={sending}
          >
            <MessageCircle size={17} />
            {sending ? 'Preparing PDF…' : sent ? 'Open WhatsApp Again' : 'Send via WhatsApp'}
          </button>
        ) : (
          <div className="send-no-phone">
            No phone number on record — share the quote manually.
          </div>
        )}

        <button className="btn btn-secondary" onClick={onViewQuote}>
          <FileText size={14} />
          View Quote Detail
        </button>

        <button className="btn btn-ghost" onClick={onDone}>
          Back to Quotes
          <ArrowRight size={14} />
        </button>
      </div>

      {toastMsg && (
        <div style={{ background: 'rgba(76,175,80,.1)', border: '1px solid rgba(76,175,80,.3)', borderRadius: 8, padding: '12px 16px', marginTop: 16, fontSize: '.82rem', color: '#81c784' }}>
          {toastMsg}
        </div>
      )}

      {sent && (
        <div className="send-note">
          WhatsApp opened in a new tab. Once the client receives it, follow up in 3 days (auto-scheduled).
        </div>
      )}
    </div>
  )
}
