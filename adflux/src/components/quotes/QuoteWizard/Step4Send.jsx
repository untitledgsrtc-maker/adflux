import { useState } from 'react'
import { CheckCircle, MessageCircle, FileText, ArrowRight } from 'lucide-react'
import { buildWhatsAppMessage, openWhatsApp } from '../../../utils/whatsapp'
import { downloadQuotePDF } from '../QuotePDF'
import { formatCurrency } from '../../../utils/formatters'

export function Step4Send({ quote, cities, subtotal, gst_amount, total_amount, onDone, onViewQuote }) {
  const [sent, setSent] = useState(false)
  const [toastMsg, setToastMsg] = useState('')

  async function handleWhatsApp() {
    try {
      // First download PDF
      await downloadQuotePDF(quote, cities)
      setToastMsg('PDF downloaded — please attach it in WhatsApp.')
      setTimeout(() => setToastMsg(''), 3000)

      // Then open WhatsApp
      const message = buildWhatsAppMessage(quote, cities)
      openWhatsApp(quote.client_phone, message)
      setSent(true)
    } catch (e) {
      setToastMsg('Failed to download PDF')
      setTimeout(() => setToastMsg(''), 3000)
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
          >
            <MessageCircle size={17} />
            {sent ? 'Open WhatsApp Again' : 'Send via WhatsApp'}
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
