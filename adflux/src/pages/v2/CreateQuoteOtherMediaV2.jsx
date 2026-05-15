// src/pages/v2/CreateQuoteOtherMediaV2.jsx
//
// Phase 15 rev2 — Other Media wizard, simplified per owner directive
// (6 May 2026): "use private LED quote PDF format, only GST 18% — no
// HSN/SAC, no CGST/SGST split". So:
//
//   • The media dropdown reads from the `media_types` master (admin
//     CRUD via Master → Media Types). Free-text fallback for one-offs.
//   • Each line: [Media dropdown] [Description] [Qty] [Unit] [Rate].
//     No HSN, no CGST%, no SGST%, no per-line tax inputs.
//   • Quote-level tax: a single 18% GST toggle. gst_rate=0.18, gst_amount
//     = round(subtotal × 0.18). PDF prints a single GST @18% line, no
//     CGST/SGST split.
//   • The `quote_cities.hsn_sac / cgst_pct / sgst_pct / cgst_amount /
//     sgst_amount` columns added in the original Phase 15 SQL are left
//     in place but no longer populated.
//
// PDF renderer: src/components/quotes/OtherMediaQuotePDF.jsx — uses
// @react-pdf/renderer to mirror the Private LED quote PDF visually.

import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import {
  ArrowLeft, Plus, Trash2, Loader2, Save, Send, Newspaper,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/authStore'
import { syncClientFromQuote } from '../../utils/syncClient'

/* Owner directive: keep the wizard simple — single 18% GST at quote
   level. No per-line HSN/CGST/SGST (the columns exist on quote_cities
   but we don't populate them in this rev). */
const GST_PCT = 18

const EMPTY_LINE = () => ({
  media_type_id:   null,    // FK into media_types when picked from master
  media_type_name: '',      // denormalized — works for both master + free-text
  description:     '',
  qty:             1,
  unit:            'unit',
  unit_rate:       0,
})

export default function CreateQuoteOtherMediaV2() {
  const navigate = useNavigate()
  const location = useLocation()
  const profile  = useAuthStore(s => s.profile)
  const prefill  = location.state?.prefill || {}
  const leadId   = prefill.lead_id || null

  // Phase 29b — owner spec: every quote should be editable. Detail
  // page Edit on an Other Media draft routes here with editingId set.
  const editingId = location.state?.editingId || null

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

  const [mediaTypes, setMediaTypes] = useState([])
  const [loadingMaster, setLoadingMaster] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState('')
  const [editLoading, setEditLoading] = useState(!!editingId)

  // Phase 29b — load existing Other Media quote + line items for edit.
  useEffect(() => {
    if (!editingId) return
    let cancelled = false
    ;(async () => {
      const { data: q, error: qErr } = await supabase
        .from('quotes').select('*').eq('id', editingId).single()
      if (cancelled) return
      if (qErr || !q) {
        setError('Could not load this draft for editing — ' + (qErr?.message || 'not found'))
        setEditLoading(false)
        return
      }
      if (q.status !== 'draft') {
        setError(`This quote is "${q.status}" — only drafts can be edited.`)
        setEditLoading(false)
        return
      }
      const { data: cities } = await supabase
        .from('quote_cities').select('*').eq('quote_id', editingId)
      if (cancelled) return

      setClient({
        name:    q.client_name    || '',
        company: q.client_company || '',
        phone:   q.client_phone   || '',
        email:   q.client_email   || '',
        address: q.client_address || '',
        gstin:   q.client_gst     || '',
      })
      setCampaignStartDate(q.campaign_start_date || '')
      setCampaignEndDate(q.campaign_end_date || '')
      setIncludeGst(Number(q.gst_rate) > 0)
      const reloadedLines = (cities || []).map(c => ({
        media_type_id:   null,           // will be re-resolved by name match below
        media_type_name: c.city_name || '',
        description:     c.description || '',
        qty:             Number(c.qty) || 1,
        unit:            'unit',
        unit_rate:       Number(c.unit_rate) || 0,
      }))
      setLines(reloadedLines.length ? reloadedLines : [EMPTY_LINE()])
      setEditLoading(false)
    })()
    return () => { cancelled = true }
  }, [editingId])

  /* ─── Fetch media_types master on mount ─── */
  useEffect(() => {
    let cancelled = false
    async function load() {
      const { data, error } = await supabase
        .from('media_types')
        .select('id, name')
        .eq('is_active', true)
        .order('display_order', { ascending: true })
        .order('name', { ascending: true })
      if (cancelled) return
      if (error) {
        console.warn('[OtherMedia] media_types fetch failed:', error.message)
        setMediaTypes([
          { id: null, name: 'Newspaper' },
          { id: null, name: 'Hoarding (Outdoor)' },
          { id: null, name: 'Cinema' },
          { id: null, name: 'Other' },
        ])
      } else {
        setMediaTypes(data || [])
      }
      setLoadingMaster(false)
    }
    load()
    return () => { cancelled = true }
  }, [])

  /* ─── Totals — single 18% GST at quote level ─── */
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

  /** When rep picks a media from the master dropdown OR types a free-text
      name, just record the name + (if matched) the master id. No tax
      fields anymore. */
  function setLineMedia(i, name) {
    const match = mediaTypes.find(m => m.name.toLowerCase() === name.toLowerCase())
    setLine(i, {
      media_type_id:   match?.id || null,
      media_type_name: name,
    })
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
    const validLines = lines.filter(l => l.media_type_name.trim() && l.description.trim() && Number(l.unit_rate) > 0)
    if (validLines.length === 0) {
      setError('Add at least one line item with media, description and rate.')
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
      // Phase 29b — only stamp creator + lead_id on INSERT.
      ...(editingId ? {} : {
        created_by:        profile?.id,
        sales_person_name: profile?.name,
        lead_id:           leadId,
      }),
    }

    let quote
    if (editingId) {
      const { data: updated, error: uErr } = await supabase
        .from('quotes').update(quotePayload).eq('id', editingId).select().single()
      if (uErr) {
        setSaving(false)
        setError(uErr.message || 'Failed to update quote.')
        return
      }
      quote = updated
      const { error: dErr } = await supabase
        .from('quote_cities').delete().eq('quote_id', editingId)
      if (dErr) {
        setSaving(false)
        setError('Updated quote but could not clear old line items: ' + dErr.message)
        return
      }
    } else {
      const { data: inserted, error: qErr } = await supabase
        .from('quotes').insert([quotePayload]).select().single()
      if (qErr) {
        setSaving(false)
        setError(qErr.message || 'Failed to save quote.')
        return
      }
      quote = inserted
    }

    const lineItems = validLines.map(l => {
      const amt = (Number(l.qty) || 0) * (Number(l.unit_rate) || 0)
      return {
        quote_id:        quote.id,
        ref_kind:        'FREE_TEXT',
        city_id:         null,
        city_name:       l.media_type_name,        // PDF reads media name from here
        description:     l.description,             // pure description; PDF prints it under the media name
        qty:             Number(l.qty) || 1,
        unit_rate:       Number(l.unit_rate) || 0,
        amount:          amt,
        screens:         0,
        grade:           null,
        listed_rate:     Number(l.unit_rate) || 0,
        offered_rate:    Number(l.unit_rate) || 0,
        campaign_total:  amt,
        duration_months: 1,
        slot_seconds:    0,
        slots_per_day:   0,
        // Phase 15 rev2 — HSN / CGST / SGST left NULL on the row.
        // Columns kept on the table for backward-compat with rev1 rows
        // but no longer populated by this wizard. PDF renders single
        // GST 18% from the quote-level gst_rate / gst_amount.
      }
    })

    if (lineItems.length) {
      const { error: liErr } = await supabase.from('quote_cities').insert(lineItems)
      if (liErr) {
        setSaving(false)
        setError(`Quote saved but line items failed: ${liErr.message}`)
        return
      }
    }

    syncClientFromQuote(quote, editingId ? 'update' : 'create')

    // Phase 29b — only advance the lead funnel on initial INSERT.
    if (!editingId && leadId) {
      await supabase
        .from('leads')
        .update({ stage: 'QuoteSent', quote_id: quote.id })
        .eq('id', leadId)
    }

    setSaving(false)
    navigate(`/quotes/${quote.id}`)
  }

  if (editLoading) {
    return (
      <div style={{ padding: 40, color: 'var(--text-muted)', textAlign: 'center' }}>
        Loading draft for editing…
      </div>
    )
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
            Pick a media from the master, add a description, qty and rate. Tax breakup on the PDF is set per media in Master → Media Types.
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
              placeholder="Any campaign details to include on the PDF."
              style={{ minHeight: 60 }}
            />
          </div>
        </div>
      </div>

      {/* ─── Line items ─── */}
      <div className="v2d-panel" style={{ padding: 20, marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>
            Line items
            {loadingMaster && (
              <span style={{ marginLeft: 8, color: 'var(--v2-ink-2)', fontWeight: 400 }}>
                <Loader2 size={11} style={{ animation: 'spin 1s linear infinite', verticalAlign: '-2px' }} /> loading media…
              </span>
            )}
          </div>
          <button className="v2d-ghost v2d-ghost--btn" onClick={addLine}>
            <Plus size={12} /> Add line
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {lines.map((l, i) => {
            const lineTotal = (Number(l.qty) || 0) * (Number(l.unit_rate) || 0)
            const dlId = `media-options-${i}`
            return (
              <div key={i} style={{
                display: 'grid',
                gridTemplateColumns: '180px 1fr 70px 80px 110px 110px 28px',
                gap: 8, alignItems: 'center',
              }}>
                {/* Media: free-text input wired to a <datalist> backed by master.
                    Reps can pick from the dropdown OR type a one-off name. */}
                <input
                  list={dlId}
                  placeholder="Media (e.g. Newspaper)"
                  value={l.media_type_name}
                  onChange={e => setLineMedia(i, e.target.value)}
                />
                <datalist id={dlId}>
                  {mediaTypes.map(m => (
                    <option key={m.name} value={m.name} />
                  ))}
                </datalist>

                <input
                  placeholder="Description (e.g. Times of India full page · Vadodara · 19 Sep)"
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

        <div style={{ marginTop: 12, fontSize: 11, color: 'var(--v2-ink-2)' }}>
          <Newspaper size={11} style={{ verticalAlign: '-1px', marginRight: 4 }} />
          Media options are managed in <strong>Master → Media Types</strong>. Pick from the list or type a one-off name.
        </div>
      </div>

      {/* ─── Totals — single GST 18% line, matches Private LED PDF format ─── */}
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
            GST {GST_PCT}%
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
          <span style={{ fontSize: 14, fontWeight: 700 }}>Total</span>
          <span style={{ fontFamily: 'var(--v2-display)', fontWeight: 700, fontSize: 22, color: 'var(--v2-yellow, #FFE600)' }}>
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
