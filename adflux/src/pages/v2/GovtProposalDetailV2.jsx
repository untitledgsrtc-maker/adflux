// src/pages/v2/GovtProposalDetailV2.jsx
//
// Read view for a saved Government proposal. Shows the rendered
// Gujarati letter (HTML) with a Print button (browser-print → PDF).
// Status transition buttons (Send / Won / Lost) live in the header
// bar so admin/owner/co_owner can advance the lifecycle.
//
// If the URL points at a non-government quote, we redirect to the
// existing QuoteDetail page (which already handles private LED).

import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Printer, Send, CheckCircle2, XCircle } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { GovtProposalRenderer } from '../../components/govt/GovtProposalRenderer'
import { useAuth } from '../../hooks/useAuth'
import { formatINREnglish } from '../../utils/gujaratiNumber'

const STATUS_COLORS = {
  draft:        'var(--text-muted)',
  sent:         'var(--blue)',
  negotiating:  'var(--warning)',
  won:          'var(--success)',
  lost:         'var(--danger)',
}

export default function GovtProposalDetailV2() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { isPrivileged } = useAuth()

  const [quote,    setQuote]    = useState(null)
  const [items,    setItems]    = useState([])
  const [template, setTemplate] = useState(null)
  const [signer,   setSigner]   = useState(null)
  const [loading,  setLoading]  = useState(true)
  const [savingStatus, setSavingStatus] = useState(null)

  useEffect(() => {
    let cancel = false
    async function load() {
      setLoading(true)
      const { data: q, error: qErr } = await supabase
        .from('quotes')
        .select('*')
        .eq('id', id)
        .single()
      if (cancel) return
      if (qErr || !q) {
        navigate('/quotes')
        return
      }
      // If this isn't a govt quote, defer to existing QuoteDetail
      if (q.segment !== 'GOVERNMENT') {
        navigate(`/quotes/${id}`, { replace: true })
        return
      }
      setQuote(q)

      // Line items, template, signer in parallel
      const [li, tpl, sg] = await Promise.all([
        supabase.from('quote_cities')
          .select('*').eq('quote_id', id),
        supabase.from('proposal_templates')
          .select('*')
          .eq('segment', 'GOVERNMENT')
          .eq('media_type', q.media_type)
          .eq('language', 'gu')
          .eq('is_active', true)
          .is('effective_to', null)
          .maybeSingle(),
        q.signer_user_id
          ? supabase.from('users')
              .select('id, name, email, role, signature_title, signature_mobile')
              .eq('id', q.signer_user_id)
              .maybeSingle()
          : Promise.resolve({ data: null }),
      ])
      if (cancel) return
      setItems(li.data || [])
      setTemplate(tpl.data || null)
      setSigner(sg.data || null)
      setLoading(false)
    }
    load()
    return () => { cancel = true }
  }, [id, navigate])

  const renderedData = useMemo(() => {
    if (!quote) return null
    const lineItems = items.map(it => {
      const screens = Number(it.screens) || 0
      const rate    = Number(it.unit_rate ?? it.offered_rate ?? 0)
      const monthly = screens * 100 * 30 * rate
      return {
        id:           it.id,
        ref_kind:     it.ref_kind,
        description:  it.description || it.city_name,
        category:     it.grade,
        screens,
        monthly_spots: screens * 100 * 30,
        unit_rate:    rate,
        monthly_total: monthly,
        allocated_qty: Number(it.qty) || 0,
      }
    })
    return {
      recipient_block:        quote.recipient_block,
      proposal_date:          quote.proposal_date,
      auto_total_quantity:    quote.auto_total_quantity,
      gsrtc_campaign_months:  quote.gsrtc_campaign_months,
      unit_rate:              quote.media_type === 'AUTO_HOOD'
        ? Number(items[0]?.unit_rate ?? items[0]?.offered_rate ?? 825)
        : 0,
      line_items:             lineItems,
    }
  }, [quote, items])

  async function changeStatus(next) {
    if (!quote || savingStatus) return
    setSavingStatus(next)
    const { data, error } = await supabase
      .from('quotes')
      .update({ status: next })
      .eq('id', quote.id)
      .select()
      .single()
    if (!error) setQuote(data)
    setSavingStatus(null)
  }

  if (loading) {
    return <div className="govt-master"><em>Loading proposal…</em></div>
  }
  if (!quote) {
    return <div className="govt-master"><em>Proposal not found.</em></div>
  }

  return (
    <div className="govt-master">
      <div className="govt-master__head">
        <div>
          <div className="govt-master__kicker">
            {quote.media_type === 'AUTO_HOOD' ? 'Government — Auto Hood' : 'Government — GSRTC LED'}
          </div>
          <h1 className="govt-master__title">{quote.quote_number}</h1>
          <div className="govt-master__sub">
            <span style={{
              display: 'inline-block',
              padding: '2px 10px',
              borderRadius: 999,
              background: 'var(--surface-3)',
              color: STATUS_COLORS[quote.status] || 'var(--text-muted)',
              fontSize: 12, fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
            }}>{quote.status}</span>
            {' · '}
            Total ₹{formatINREnglish(quote.total_amount || 0)}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            type="button"
            className="govt-wiz__btn"
            onClick={() => navigate('/quotes')}
          >
            <ArrowLeft size={14} /> Back
          </button>
          <button
            type="button"
            className="govt-wiz__btn govt-wiz__btn--primary"
            onClick={() => window.print()}
          >
            <Printer size={14} /> Print / Save PDF
          </button>
          {isPrivileged && quote.status === 'draft' && (
            <button
              type="button"
              className="govt-wiz__btn"
              disabled={savingStatus === 'sent'}
              onClick={() => changeStatus('sent')}
            >
              <Send size={14} /> Mark Sent
            </button>
          )}
          {isPrivileged && (quote.status === 'sent' || quote.status === 'negotiating') && (
            <>
              <button
                type="button"
                className="govt-wiz__btn"
                disabled={savingStatus === 'won'}
                onClick={() => changeStatus('won')}
                style={{ borderColor: 'var(--success)', color: 'var(--success)' }}
              >
                <CheckCircle2 size={14} /> Mark Won
              </button>
              <button
                type="button"
                className="govt-wiz__btn"
                disabled={savingStatus === 'lost'}
                onClick={() => changeStatus('lost')}
                style={{ borderColor: 'var(--danger)', color: 'var(--danger)' }}
              >
                <XCircle size={14} /> Mark Lost
              </button>
            </>
          )}
        </div>
      </div>

      <GovtProposalRenderer
        template={template}
        data={renderedData}
        signer={signer}
        mediaType={quote.media_type}
      />

      {/* Auto Hood: per-district allocation list (always shown) */}
      {quote.media_type === 'AUTO_HOOD' && items.length > 0 && (
        <>
          <h2 style={{
            fontFamily: 'var(--font-display)',
            color: 'var(--text)',
            margin: '24px 0 8px',
            fontSize: 16,
          }}>
            District allocation (attached to letter)
          </h2>
          <table className="govt-table">
            <thead>
              <tr>
                <th>District</th>
                <th className="num">Rickshaws</th>
                <th className="num">Rate</th>
                <th className="num">Amount</th>
              </tr>
            </thead>
            <tbody>
              {items.map(it => (
                <tr key={it.id}>
                  <td>{it.description || it.city_name}</td>
                  <td className="num">{formatINREnglish(it.qty || 0)}</td>
                  <td className="num">₹{formatINREnglish(it.unit_rate || 0)}</td>
                  <td className="num">₹{formatINREnglish(it.amount || 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  )
}
