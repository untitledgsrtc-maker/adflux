// src/pages/v2/CreateQuoteOtherMediaV2.jsx
//
// Phase 12 rev2 — Private "Other Media" quote.
//
// Owner spec: "when private rep create quote he need to see 2 thing
// gsrtc quote or other media, so other media quote will be different".
//
// "Other media" covers everything that isn't LED:
//   • Newspaper (full page / quarter / classifieds)
//   • Hoarding (size + location + duration)
//   • Cinema (slot + theatre)
//   • Mall (kiosk / standee / lift wrap)
//   • Digital (banner / mailer / social)
//   • Radio
//
// Single-page form: client info + free-form line items + GST + total.
// Persists as a quote with segment='PRIVATE', media_type='OTHER_MEDIA'.
// Reuses existing payments + approvals + clients sync infrastructure.

import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import {
  ArrowLeft, Plus, Trash2, Loader2, Save, Send,
  Newspaper, Building2, Film, Radio, Globe,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/authStore'
import { syncClientFromQuote } from '../../utils/syncClient'

const MEDIA_TYPES = [
  { value: 'NEWSPAPER', label: 'Newspaper',  icon: Newspaper },
  { value: 'HOARDING',  label: 'Hoarding',   icon: Building2 },
  { value: 'CINEMA',    label: 'Cinema',     icon: Film },
  { value: 'MALL',      label: 'Mall',       icon: Building2 },
  { value: 'DIGITAL',   label: 'Digital',    icon: Globe },
  { value: 'RADIO',     label: 'Radio',      icon: Radio },
  { value: 'OTHER',     label: 'Other',      icon: Newspaper },
]

const GST_PCT = 18

const EMPTY_LINE = () => ({
  media_type: 'NEWSPAPER',
  description: '',
  qty: 1,
  unit: 'unit',
  unit_rate: 0,
})

export default function CreateQuoteOtherMediaV2() {
  const navigate = useNavigate()
  const location = useLocation()
  const profile  = useAuthStore(s => s.profile)
  const prefill  = location.state?.prefill || {}
  const leadId   = prefill.lead_id || null

  const [client, setClient] = useState({
    name:    prefill.client_name    || '',
    company: prefill.client_company || '',
    phone:   prefill.client_phone   || '',
    email:   prefill.client_email   || '',
    address: prefill.client_address || '',
    gstin:   prefill.client_gst     || '',
  })

  const [campaignNotes, setCampaignNotes] = useState('')
  const [campaignStartDate, setCampaignStartDate] = useState('')
  const [campaignEndDate, setCampaignEndDate]     = useState('')
  const [includeGst, setIncludeGst] = useState(true)
  const [lines, setLines] = useState([EMPTY_LINE()])

  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState('')

  /* ─── Totals ─── */
  const totals = useMemo(() => {
    const subtotal = lines.reduce(
      (s, l) => s + (Number(l.qty) || 0) * (Number(l.unit_rate) || 0),
      0,
    )
    const gst   = includeGst ? Math.round(subtotal * GST_PCT / 100) : 0
    const total = subtotal + gst
    return { subtotal, gst, total }
  }, [lines, includeGst])

  /* ─── Line item helpers ─── */
  function setLine(i, patch) {
    setLines(prev => prev.map((l, j) => j === i ? { ...l, ...patch } : l))
  }
  function addLine() {
    setLines(prev => [...prev, EMPTY_LINE()])
  }
  function removeLine(i) {
    setLines(prev => prev.filter((_, j) => j !== i))
  }

  /* ─── Save ─── */
  async function handleSave(targetStatus = 'draft') {
    setError('')
    if (!client.name.trim()) {
      setError('Client name is required.')
      return
    }
    if (lines.length === 0 || lines.every(l => !l.description.trim() || !l.unit_rate)) {
      setError('Add at least one line item with a description and rate.')
      return
    }
    setSaving(true)

    const quotePayload = {
      client_name:    client.name.trim(),
      client_company: client.company.trim() || null,
      client_phone:   client.phone.trim() || null,
      client_email:   client.email.trim() || null,
      client_address: client.address.trim() || null,
      client_gst:     client.gstin.trim() || null,
      revenue_type:   'new',
      status:         targetStatus,
      subtotal:       totals.subtotal,
      gst_rate:       includeGst ? GST_PCT / 100 : 0,
      gst_amount:     totals.gst,
      total_amount:   totals.total,
      duration_months: 1,
      segment:        'PRIVATE',
      media_type:     'OTHER_MEDIA',
      proposal_date:  new Date().toISOString().slice(0, 10),
      campaign_start_date: campaignStartDate || null,
      campaign_end_date:   campaignEndDate || null,
      created_by:     profile?.id,
      sales_person_name: profile?.name,
      // Phase 12 rev2 — link to lead if this came from "Convert to Quote"
      lead_id:        leadId,
    }

    const { data: quote, error: qErr } = await supabase
      .from('quotes')
      .insert([quotePayload])
      .select()
      .single()

    if (qErr) {
      setSaving(false)
      setError(qErr.message || 'Failed to save quote.')
      return
    }

    // Save line items as quote_cities rows (reusing existing line-item table).
    const lineItems = lines
      .filter(l => l.description.trim())
      .map(l => ({
        quote_id:     quote.id,
        ref_kind:     'FREE_TEXT',
        city_id:      null,
        city_name:    l.media_type,
        description:  `${MEDIA_TYPES.find(m => m.value === l.media_type)?.label || l.media_type}: ${l.description}`,
        qty:          Number(l.qty) || 1,
        unit_rate:    Number(l.unit_rate) || 0,
        amount:       (Number(l.qty) || 0) * (Number(l.unit_rate) || 0),
        screens:      0,
        grade:        null,
        listed_rate:  Number(l.unit_rate) || 0,
        offered_rate: Number(l.unit_rate) || 0,
        campaign_total: (Number(l.qty) || 0) * (Number(l.unit_rate) || 0),
        duration_months: 1,
        slot_seconds:  0,
        slots_per_day: 0,
      }))

    if (lineItems.length) {
      const { error: liErr } = await supabase.from('quote_cities').insert(lineItems)
      if (liErr) {
        setSaving(false)
        setError(`Quote saved but line items failed: ${liErr.message}`)
        return
      }
    }

    // Sync client to CRM
    syncClientFromQuote(quote, 'create')

    // If this quote was converted from a lead, update the lead's stage + quote_id
    if (leadId) {
      await supabase
        .from('leads')
        .update({ stage: 'QuoteSent', quote_id: quote.id })
        .eq('id', leadId)
    }

    setSaving(false)
    navigate(`/quotes/${quote.id}`)
  }

  return (
    <div className="v2d-create-other">
      <button
        className="v2d-ghost v2d-ghost--btn"
        onClick={() => navigate('/quotes/new')}
        style={{ marginBottom: 16 }}
      >
        <ArrowLeft size={14} /> Quote type
      </button>

      <div className="v2d-page-head">
        <div>
          <div className="v2d-page-kicker">Private — Other Media</div>
          <h1 className="v2d-page-title">New Other Media Quote</h1>
          <div className="v2d-page-sub">
            Newspaper, hoarding, cinema, mall, digital, radio. Free-form line items.
          </div>
        </div>
      </div>

      {error && (
        <div style={{
          background: 'rgba(248,113,113,.10)',
          border: '1px solid rgba(248,113,113,.28)',
          color: '#f87171',
          borderRadius: 12, padding: '12px 16px', marginBottom: 12, fontSize: 13,
        }}>⚠ {error}</div>
      )}

      {/* ─── Client info ─── */}
      <div className="v2d-panel" style={{ padding: 20, marginBottom: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>Client</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
          <div className="fg" style={{ marginBottom: 0 }}>
            <label>Name <span style={{ color: '#f87171' }}>*</span></label>
            <input value={client.name} onChange={e => setClient(c => ({ ...c, name: e.target.value }))} />
          </div>
          <div className="fg" style={{ marginBottom: 0 }}>
            <label>Company</label>
            <input value={client.company} onChange={e => setClient(c => ({ ...c, company: e.target.value }))} />
          </div>
          <div className="fg" style={{ marginBottom: 0 }}>
            <label>Phone</label>
            <input value={client.phone} onChange={e => setClient(c => ({ ...c, phone: e.target.value }))} />
          </div>
          <div className="fg" style={{ marginBottom: 0 }}>
            <label>Email</label>
            <input type="email" value={client.email} onChange={e => setClient(c => ({ ...c, email: e.target.value }))} />
          </div>
          <div className="fg" style={{ marginBottom: 0, gridColumn: '1 / -1' }}>
            <label>Address</label>
            <input value={client.address} onChange={e => setClient(c => ({ ...c, address: e.target.value }))} />
          </div>
          <div className="fg" style={{ marginBottom: 0 }}>
            <label>GSTIN</label>
            <input value={client.gstin} onChange={e => setClient(c => ({ ...c, gstin: e.target.value }))} placeholder="24XXXXXXXXX1Z5" />
          </div>
        </div>
      </div>

      {/* ─── Campaign dates + notes ─── */}
      <div className="v2d-panel" style={{ padding: 20, marginBottom: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>Campaign</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
          <div className="fg" style={{ marginBottom: 0 }}>
            <label>Start date</label>
            <input type="date" value={campaignStartDate} onChange={e => setCampaignStartDate(e.target.value)} />
          </div>
          <div className="fg" style={{ marginBottom: 0 }}>
            <label>End date</label>
            <input type="date" value={campaignEndDate} onChange={e => setCampaignEndDate(e.target.value)} />
          </div>
          <div className="fg" style={{ marginBottom: 0, gridColumn: '1 / -1' }}>
            <label>Notes</label>
            <textarea
              value={campaignNotes}
              onChange={e => setCampaignNotes(e.target.value)}
              placeholder="Any campaign details to include."
              style={{ minHeight: 60 }}
            />
          </div>
        </div>
      </div>

      {/* ─── Line items ─── */}
      <div className="v2d-panel" style={{ padding: 20, marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>Line items</div>
          <button className="v2d-ghost v2d-ghost--btn" onClick={addLine}>
            <Plus size={12} /> Add line
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {lines.map((l, i) => {
            const Icon = MEDIA_TYPES.find(m => m.value === l.media_type)?.icon || Newspaper
            const lineTotal = (Number(l.qty) || 0) * (Number(l.unit_rate) || 0)
            return (
              <div key={i} style={{
                display: 'grid',
                gridTemplateColumns: '140px 1fr 80px 90px 130px 110px 28px',
                gap: 8, alignItems: 'center',
              }}>
                <select
                  value={l.media_type}
                  onChange={e => setLine(i, { media_type: e.target.value })}
                >
                  {MEDIA_TYPES.map(m => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
                </select>
                <input
                  placeholder="Description (e.g. Times of India full page · Vadodara edition · 19 Sep)"
                  value={l.description}
                  onChange={e => setLine(i, { description: e.target.value })}
                />
                <input
                  type="number"
                  min="0"
                  placeholder="Qty"
                  value={l.qty}
                  onChange={e => setLine(i, { qty: e.target.value })}
                  style={{ textAlign: 'right' }}
                />
                <input
                  placeholder="Unit"
                  value={l.unit}
                  onChange={e => setLine(i, { unit: e.target.value })}
                />
                <input
                  type="number"
                  min="0"
                  placeholder="Rate ₹"
                  value={l.unit_rate}
                  onChange={e => setLine(i, { unit_rate: e.target.value })}
                  style={{ textAlign: 'right' }}
                />
                <div style={{ fontFamily: 'var(--v2-display)', fontWeight: 600, textAlign: 'right' }}>
                  ₹{lineTotal.toLocaleString('en-IN')}
                </div>
                <button
                  type="button"
                  onClick={() => removeLine(i)}
                  style={{ background: 'transparent', border: 'none', color: 'var(--v2-ink-2)', cursor: 'pointer' }}
                  title="Remove line"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            )
          })}
        </div>
      </div>

      {/* ─── Totals + GST ─── */}
      <div className="v2d-panel" style={{ padding: 20, marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <span style={{ fontSize: 13, color: 'var(--v2-ink-1)' }}>Subtotal</span>
          <span style={{ fontFamily: 'var(--v2-display)', fontWeight: 600 }}>
            ₹{totals.subtotal.toLocaleString('en-IN')}
          </span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--v2-ink-1)' }}>
            <input type="checkbox" checked={includeGst} onChange={e => setIncludeGst(e.target.checked)} />
            GST 18%
          </label>
          <span style={{ fontFamily: 'var(--v2-display)', fontWeight: 600 }}>
            ₹{totals.gst.toLocaleString('en-IN')}
          </span>
        </div>
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          paddingTop: 12, marginTop: 12,
          borderTop: '1px solid var(--v2-line, rgba(255,255,255,.06))',
        }}>
          <span style={{ fontSize: 16, fontWeight: 700 }}>Total</span>
          <span style={{ fontFamily: 'var(--v2-display)', fontWeight: 700, fontSize: 22, color: 'var(--v2-yellow, #facc15)' }}>
            ₹{totals.total.toLocaleString('en-IN')}
          </span>
        </div>
      </div>

      {/* ─── Action bar ─── */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <button
          className="v2d-ghost v2d-ghost--btn"
          onClick={() => navigate('/quotes')}
          disabled={saving}
        >
          Cancel
        </button>
        <button
          className="v2d-ghost v2d-ghost--btn"
          onClick={() => handleSave('draft')}
          disabled={saving}
        >
          {saving ? <><Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Saving…</> : <><Save size={14} /> Save draft</>}
        </button>
        <button
          className="v2d-cta"
          onClick={() => handleSave('sent')}
          disabled={saving}
        >
          {saving ? <><Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Saving…</> : <><Send size={14} /> Save & Mark Sent</>}
        </button>
      </div>
    </div>
  )
}
