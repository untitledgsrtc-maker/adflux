// src/pages/v2/GovtProposalDetailV2.jsx
//
// Read view for a saved Government proposal. Shows the rendered
// Gujarati letter (HTML) with a Print button (browser-print → PDF).
// Status transition buttons (Send / Won / Lost) live in the header
// bar so admin/owner/co_owner can advance the lifecycle.
//
// If the URL points at a non-government quote, we redirect to the
// existing QuoteDetail page (which already handles private LED).

import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft, Send, CheckCircle2, XCircle, Paperclip, Plus, Trash2,
  CreditCard, Upload, Download, FileText, Lock, Loader2, MessageCircle, Calendar,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { GovtProposalRenderer } from '../../components/govt/GovtProposalRenderer'
import { useAuth } from '../../hooks/useAuth'
import { useAuthStore } from '../../store/authStore'
import { usePayments } from '../../hooks/usePayments'
import { PaymentModal } from '../../components/payments/PaymentModal'
import { PaymentHistory } from '../../components/payments/PaymentHistory'
import { PaymentSummary } from '../../components/payments/PaymentSummary'
import { WonPaymentModal } from '../../components/payments/WonPaymentModal'
import { FollowUpList } from '../../components/followups/FollowUpList'
import { openWhatsApp, shortenUrl } from '../../utils/whatsapp'
import { formatINREnglish } from '../../utils/gujaratiNumber'
import { syncClientFromQuote } from '../../utils/syncClient'
import {
  uploadAttachment, getSignedUrl, fetchAsMergeInput,
  buildCombinedPdf, downloadPdfBlob, generateLockedProposalPdf,
} from '../../utils/proposalPdf'

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
  const profile = useAuthStore(s => s.profile)
  const isAdmin = profile?.role === 'admin'

  const [quote,    setQuote]    = useState(null)
  const [items,    setItems]    = useState([])
  const [template, setTemplate] = useState(null)
  const [signer,   setSigner]   = useState(null)
  const [company,  setCompany]  = useState(null)  // Phase 10 — companies row
  const [loading,  setLoading]  = useState(true)
  const [savingStatus, setSavingStatus] = useState(null)
  const [statusMsg,    setStatusMsg]    = useState('')
  const [statusError,  setStatusError]  = useState('')
  // Phase 7 — attachments checklist
  const [attachmentTpl, setAttachmentTpl] = useState([])  // standard items from attachment_templates
  const [savingAttachments, setSavingAttachments] = useState(false)
  const [customLabel, setCustomLabel] = useState('')

  // Payments (Phase B parity with private flow)
  const {
    payments, loading: paymentsLoading, totalPaid, hasFinalPayment,
    fetchPayments, addPayment, updatePayment, deletePayment,
  } = usePayments(id)
  const [showPaymentModal, setShowPaymentModal] = useState(false)
  const [showWonModal,     setShowWonModal]     = useState(false)
  const [showEditPayment,  setShowEditPayment]  = useState(false)
  const [editingPayment,   setEditingPayment]   = useState(null)
  // "Mark Sent" pre-flight modal — opens when user clicks Mark Sent.
  // Shows the OC-copy requirement, lets them upload it inline, then
  // Confirm & Send executes the original flip-to-sent flow.
  const [showSentModal,    setShowSentModal]    = useState(false)
  const [sentModalBusy,    setSentModalBusy]    = useState(false)
  const [sentModalUploadingOc, setSentModalUploadingOc] = useState(false)
  // Phase 11 — Mark Won pre-flight: same inline-upload pattern as Sent's
  // OC gate, but for the Work Order / PO copy. Banner lives inside
  // WonPaymentModal and disables Confirm until poUploaded === true.
  const [wonModalUploadingPo, setWonModalUploadingPo] = useState(false)
  // Phase 11c — admin-only "regenerate locked PDF". Locked PDFs from
  // before the A4 + letterhead fix have wrong-aspect pages; admin
  // needs to re-rasterize without losing the Sent state.
  const [regeneratingLocked, setRegeneratingLocked] = useState(false)

  // Phase 8 — file storage + locked proposal PDF + combined PDF
  // rendererRef is captured by html2canvas when generating the locked
  // proposal PDF on Mark Sent. We attach it to a wrapper around
  // GovtProposalRenderer so the rasterizer sees the exact rendered DOM.
  const rendererRef = useRef(null)
  // signedUrls maps storage path → short-lived signed URL for display.
  // We refresh on demand (clicking download) since signed URLs expire.
  const [signedUrls, setSignedUrls] = useState({})
  // Per-row upload busy state, keyed by checklist index.
  const [uploadingIdx, setUploadingIdx] = useState(null)
  // Top-level busy flags for the two heavy ops.
  const [generatingPdf,    setGeneratingPdf]    = useState(false)
  const [combinedPdfBusy,  setCombinedPdfBusy]  = useState(false)

  // Pull payments on mount so the summary shows real numbers before the
  // user clicks anything — same pattern as private QuoteDetail.
  useEffect(() => {
    if (id) fetchPayments()
  }, [id, fetchPayments])

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

      // Line items, template, signer, attachment template, company,
      // and (for AUTO_HOOD) the auto_districts master so we can
      // surface Gujarati district names in the rendered letter.
      const [li, tpl, sg, atpl, co, dist] = await Promise.all([
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
        supabase.from('attachment_templates')
          .select('id, display_order, label, is_required, default_file_url, default_file_uploaded_at')
          .eq('segment', 'GOVERNMENT')
          .eq('media_type', q.media_type)
          .eq('is_active', true)
          .order('display_order'),
        // Phase 10 — fetch the GOVERNMENT company row so the renderer
        // can use its name_gu / GSTIN / etc. instead of the hardcoded
        // string. maybeSingle() so a missing companies row falls back
        // gracefully (renderer treats null company as legacy mode).
        supabase.from('companies')
          .select('*')
          .eq('segment', 'GOVERNMENT')
          .eq('is_active', true)
          .maybeSingle(),
        // Phase 11d (rev6) — auto_districts master, only when the
        // quote is AUTO_HOOD. The wizard saves quote_cities.description
        // = district_name_en (English) so the rendered letter was
        // showing English district names. Owner spec: list must be
        // in Gujarati. We fetch the master here, build a Map of
        // id → district_name_gu, and merge it into line_items below.
        q.media_type === 'AUTO_HOOD'
          ? supabase.from('auto_districts')
              .select('id, district_name_en, district_name_gu')
          : Promise.resolve({ data: [] }),
      ])
      if (cancel) return
      // Augment line_items with Gujarati district names for AUTO_HOOD.
      // Match on ref_id (set by the wizard to auto_districts.id) so we
      // can pull district_name_gu through to the renderer. Items for
      // GSRTC_LED don't go through this lookup (their station names
      // already come from gsrtc_stations master with Gujarati baked in).
      const distMap = new Map((dist.data || []).map(d => [d.id, d]))
      const itemsWithGu = (li.data || []).map(it => {
        const d = it.ref_id ? distMap.get(it.ref_id) : null
        return d
          ? { ...it, district_name_gu: d.district_name_gu, district_name_en: d.district_name_en }
          : it
      })
      setItems(itemsWithGu)
      setTemplate(tpl.data || null)
      setSigner(sg.data || null)
      setAttachmentTpl(atpl.data || [])
      setCompany(co.data || null)
      setLoading(false)
    }
    load()
    return () => { cancel = true }
  }, [id, navigate])

  // Effective signer = the user record with the per-quote mobile
  // override (if set). Phase 8B: lets the team change the desk-specific
  // mobile per proposal without rewriting the signer's user record.
  const effectiveSigner = useMemo(() => {
    if (!signer) return null
    const override = (quote?.signer_mobile_override || '').trim()
    if (!override) return signer
    return { ...signer, signature_mobile: override }
  }, [signer, quote?.signer_mobile_override])

  const renderedData = useMemo(() => {
    if (!quote) return null
    const lineItems = items.map(it => {
      const screens  = Number(it.screens) || 0
      const rate     = Number(it.unit_rate ?? it.offered_rate ?? 0)
      // Phase 7: respect per-row overrides if present, else defaults.
      const daily    = Number(it.daily_spots_override ?? it.slots_per_day ?? 100)
      const days     = Number(it.days_override ?? 30)
      const duration = Number(it.spot_duration_sec_override ?? it.slot_seconds ?? 10)
      const monthly  = screens * daily * days * rate
      return {
        id:           it.id,
        ref_kind:     it.ref_kind,
        // Phase 11d (rev6) — pass Gujarati name through when available
        // (set by the load() useEffect's auto_districts JOIN). The
        // renderer's district list prefers district_name_gu over
        // description, so AUTO_HOOD letters show Gujarati names instead
        // of English ones the wizard saved into description.
        description:  it.description || it.city_name,
        district_name_gu: it.district_name_gu,
        district_name_en: it.district_name_en,
        category:     it.grade,
        screens,
        daily_spots:       daily,
        days,
        spot_duration_sec: duration,
        monthly_spots: screens * daily * days,
        unit_rate:    rate,
        monthly_total: monthly,
        allocated_qty: Number(it.qty) || 0,
      }
    })
    // Bidan items — dynamic from the checklist. Phase 11d (rev7+8):
    // owner spec "ticked document should listed in attachment". Replace
    // the hardcoded list with rows that have either checked=true OR a
    // file_url set, so the rendered બિડાણ section reflects what's
    // actually attached to THIS proposal.
    //
    // CRITICAL — read from quote.attachments_checklist DIRECTLY rather
    // than the `checklist` useMemo above. Reason: that useMemo is
    // declared AFTER this one (line 635), and reading it here triggers
    // a ReferenceError (TDZ on `const`) — every proposal detail page
    // crashed with a blank screen until this was fixed.
    const rawChecklist = Array.isArray(quote.attachments_checklist) ? quote.attachments_checklist : []
    const bidanItems = rawChecklist
      .filter(c => c && (c.checked || (c.file_url && String(c.file_url).trim() !== '')))
      .map(c => c.label)
      .filter(Boolean)

    return {
      // Phase 11d (rev7) — pass quote/ref number through so the
      // renderer can stamp "સંદર્ભ ક્રમાંક: ..." at the top of the
      // letter. Owner spec from the docx template.
      quote_number:           quote.quote_number,
      ref_number:             quote.ref_number,
      recipient_block:        quote.recipient_block,
      proposal_date:          quote.proposal_date,
      auto_total_quantity:    quote.auto_total_quantity,
      gsrtc_campaign_months:  quote.gsrtc_campaign_months,
      unit_rate:              quote.media_type === 'AUTO_HOOD'
        ? Number(items[0]?.unit_rate ?? items[0]?.offered_rate ?? 825)
        : 0,
      line_items:             lineItems,
      bidan_items:            bidanItems,
    }
    // Reading quote.attachments_checklist directly (not the
    // `checklist` useMemo defined further down — TDZ would crash).
  }, [quote, items])

  // Helper used by both changeStatus and handleWonWithPayment to
  // confirm a specific labelled attachment has actually been uploaded
  // before the user can advance the lifecycle. Phase 8 spec:
  //   • Mark Sent → require OC copy uploaded
  //   • Mark Won  → require PO copy / Work Order uploaded
  //
  // We match by case-insensitive label substring so a small wording
  // change in attachment_templates doesn't silently bypass the gate.
  function findUploadedByLabel(substr) {
    const needle = String(substr || '').toLowerCase()
    return checklist.find(c =>
      String(c.label || '').toLowerCase().includes(needle) &&
      c.file_url && String(c.file_url).trim().length > 0
    )
  }

  async function changeStatus(next) {
    if (!quote || savingStatus) return

    // Mark Won → existing flow: opens the payment+campaign modal.
    if (next === 'won') {
      setShowWonModal(true)
      return
    }

    // Mark Sent → open the pre-flight modal. The modal shows the
    // OC-copy requirement and lets the user upload it inline before
    // confirming. Replaces the old inline error banner.
    if (next === 'sent') {
      setStatusError('')
      setShowSentModal(true)
      return
    }

    // Other transitions (lost, draft, negotiating) — direct flip.
    setSavingStatus(next)
    setStatusError('')
    setStatusMsg('')
    const { data, error } = await supabase
      .from('quotes')
      .update({ status: next })
      .eq('id', quote.id)
      .select()
      .single()
    setSavingStatus(null)
    if (error) {
      setStatusError(error.message || 'Failed to update status.')
      return
    }
    setQuote(data)
  }

  // Confirms the Sent transition from inside the modal. Generates
  // the locked proposal PDF, flips status to sent, closes modal.
  async function confirmMarkSent() {
    if (!quote || sentModalBusy) return
    // Belt-and-suspenders: re-check OC upload right before confirming.
    // The modal's Confirm button is already disabled when OC is missing,
    // but data could shift between disable and click in a multi-tab race.
    const oc = findUploadedByLabel('oc copy')
    if (!oc) {
      setStatusError('Upload the OC copy first — you cannot mark Sent without it.')
      return
    }
    setSentModalBusy(true)
    setStatusError('')
    setStatusMsg('')

    let lockedFields = {}
    if (!quote.locked_proposal_pdf_url) {
      try {
        setGeneratingPdf(true)
        const { path } = await generateLockedProposalPdf({
          domNode: rendererRef.current,
          quoteId: quote.id,
        })
        lockedFields = {
          locked_proposal_pdf_url: path,
          locked_proposal_pdf_at:  new Date().toISOString(),
        }
      } catch (e) {
        setSentModalBusy(false)
        setGeneratingPdf(false)
        // Phase 11d (rev7) — friendlier error for the common stale-
        // Vite-chunk failure ("Failed to fetch dynamically imported
        // module"). User just needs to hard refresh.
        const msg = String(e?.message || e)
        if (msg.includes('dynamically imported module') || msg.includes('Failed to fetch')) {
          setStatusError(
            'Could not load PDF generator — stale page from before the last deploy. ' +
            'Hard refresh (Cmd+Shift+R / Ctrl+Shift+R) and click Mark Sent again.'
          )
        } else {
          setStatusError(`Failed to lock proposal PDF: ${msg}`)
        }
        return
      }
      setGeneratingPdf(false)
    }

    const { data, error } = await supabase
      .from('quotes')
      .update({ status: 'sent', ...lockedFields })
      .eq('id', quote.id)
      .select()
      .single()
    setSentModalBusy(false)
    if (error) {
      setStatusError(error.message || 'Failed to update status.')
      return
    }
    setQuote(data)
    setShowSentModal(false)
    if (lockedFields.locked_proposal_pdf_url) {
      setStatusMsg('Proposal marked Sent. Letter PDF locked — future quote edits will not change what was sent.')
      setTimeout(() => setStatusMsg(''), 4500)
    }
  }

  // Modal-side OC upload helper. Finds the OC copy template row in the
  // checklist and runs the same upload flow the inline UI uses.
  async function handleSentModalOcUpload(file) {
    if (!file || !quote) return
    const idx = checklist.findIndex(c => /oc copy/i.test(c.label || ''))
    if (idx < 0) {
      setStatusError('OC copy template row not found — refresh the page and retry.')
      return
    }
    setSentModalUploadingOc(true)
    try {
      await handleFilePick(idx, file)
    } finally {
      setSentModalUploadingOc(false)
    }
  }

  // Phase 11c — admin: regenerate the locked proposal PDF in place.
  //   Why this exists: Sent quotes from before the A4-lock + letterhead
  //   fixes have a stored locked PDF with 6+ oversized empty pages.
  //   Re-running Mark Sent isn't possible because the status one-way
  //   trigger blocks sent → draft. So we provide a direct regenerate
  //   path that re-rasterizes the CURRENT renderer DOM and overwrites
  //   the same storage path. Same render code, same path = same legal
  //   evidence chain, just with proper A4 dimensions.
  //
  //   Admin-only on purpose — sales reps shouldn't be able to silently
  //   change what was "sent" to the client even if the new render is
  //   visually equivalent. The locked_proposal_pdf_at timestamp gets
  //   updated so the audit trail shows the regen happened.
  async function handleRegenerateLockedPdf() {
    if (!quote || regeneratingLocked) return
    if (!isAdmin) {
      setStatusError('Only admin can regenerate the locked PDF.')
      return
    }
    if (!rendererRef.current) {
      setStatusError('Renderer not ready — wait a moment and retry.')
      return
    }
    if (!confirm(
      'Regenerate the locked PDF for this proposal?\n\n' +
      'This re-rasterizes the current letter render and overwrites the ' +
      'stored snapshot. Use this only after fixing layout bugs (e.g. A4 ' +
      'sizing, missing district list). The PDF content will reflect the ' +
      "current quote data — if any line items have changed since the " +
      "original send, those changes will appear in the regenerated PDF."
    )) return

    setRegeneratingLocked(true)
    setStatusError('')
    setStatusMsg('')
    try {
      const { path } = await generateLockedProposalPdf({
        domNode: rendererRef.current,
        quoteId: quote.id,
      })
      const { data, error } = await supabase
        .from('quotes')
        .update({
          locked_proposal_pdf_url: path,
          locked_proposal_pdf_at:  new Date().toISOString(),
        })
        .eq('id', quote.id)
        .select()
        .single()
      if (error) throw error
      setQuote(data)
      setStatusMsg('Locked PDF regenerated. Old combined-PDF previews are now stale — re-download to see the new version.')
      setTimeout(() => setStatusMsg(''), 5000)
    } catch (e) {
      setStatusError(`Could not regenerate locked PDF: ${e?.message || e}`)
    } finally {
      setRegeneratingLocked(false)
    }
  }

  // Phase 11e — modal-side AWARDED Work Order upload helper.
  //   Targets the "Awarded Work Order" template row specifically (NOT
  //   the proposal-phase "Sample Work Order" or generic "PO copy").
  //   Owner spec: the awarded WO is the formal document issued by THIS
  //   department for THIS proposal — it's what proves the deal closed.
  async function handleWonModalPoUpload(file) {
    if (!file || !quote) return
    const idx = checklist.findIndex(c =>
      /awarded work order/i.test(c.label || '')
    )
    if (idx < 0) {
      setStatusError(
        'Awarded Work Order template row not found in checklist. ' +
        'Run supabase_phase11e_awarded_wo_attachment.sql in Studio, then refresh.'
      )
      return
    }
    setWonModalUploadingPo(true)
    try {
      await handleFilePick(idx, file)
    } finally {
      setWonModalUploadingPo(false)
    }
  }

  // Mirrors handleWonWithPayment from src/pages/QuoteDetail.jsx so the
  // govt and private flows behave identically:
  //   • Sales + payment   → payment lands pending, quote stays as-is
  //   • Sales no payment  → quote flips to Won (no incentive until cash)
  //   • Admin             → flip + payment all in one
  async function handleWonWithPayment(paymentData) {
    // Mark Won gate (Phase 8 + 11 + 11e): the AWARDED Work Order must
    // be uploaded — specifically the WO issued by THIS department for
    // THIS proposal. A "Sample Work Order (reference)" attached during
    // the proposal phase is NOT enough — that's just an example from
    // another department. Match the label "awarded work order"
    // exactly so we don't accept the sample by accident.
    if (quote?.segment === 'GOVERNMENT') {
      const awarded = findUploadedByLabel('awarded work order')
      if (!awarded) {
        setShowWonModal(false)
        setStatusError(
          'Cannot mark Won — upload the Awarded Work Order issued by this department for this proposal. ' +
          '(A "Sample Work Order" attached at proposal phase does not count.)'
        )
        return
      }
    }

    setShowWonModal(false)
    setSavingStatus('won')
    setStatusError('')
    setStatusMsg('')

    const hasPayment = paymentData && Number(paymentData.amount_received) > 0
    if (hasPayment) {
      // Strip the WonPaymentModal-only fields before insert; payments
      // doesn't have campaign_*_date columns.
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
        setSavingStatus(null)
        setStatusError(`Payment could not be saved: ${result.error.message}`)
        return
      }
    }

    const prior = quote.status

    // Sales-with-payment: payment lands pending, admin's approval flow
    // flips the quote to Won. Persist campaign dates now so admin
    // doesn't have to retype them on approval.
    if (!isAdmin && hasPayment) {
      if (paymentData.campaign_start_date || paymentData.campaign_end_date) {
        const { data, error } = await supabase
          .from('quotes')
          .update({
            campaign_start_date: paymentData.campaign_start_date,
            campaign_end_date:   paymentData.campaign_end_date,
          })
          .eq('id', quote.id)
          .select()
          .single()
        if (error) {
          setSavingStatus(null)
          setStatusError(`Campaign dates could not be saved: ${error.message}`)
          return
        }
        setQuote(data)
      }
      setSavingStatus(null)
      setStatusMsg('Payment submitted for admin approval. Proposal will be marked Won once approved.')
      fetchPayments()
      setTimeout(() => setStatusMsg(''), 4500)
      return
    }

    // Admin path (or sales who skipped the payment): flip to Won now.
    const { data, error } = await supabase
      .from('quotes')
      .update({
        status: 'won',
        campaign_start_date: paymentData.campaign_start_date,
        campaign_end_date:   paymentData.campaign_end_date,
      })
      .eq('id', quote.id)
      .select()
      .single()
    setSavingStatus(null)
    if (error) {
      setStatusError(error.message || 'Failed to mark Won.')
      return
    }
    setQuote(data)
    if (prior !== 'won') {
      syncClientFromQuote(data, 'won')
    }
    setStatusMsg('Proposal marked as Won.')
    fetchPayments()
    setTimeout(() => setStatusMsg(''), 3000)
  }

  // WhatsApp share — govt-flavored. Builds a short message in
  // English/Gujarati referencing the proposal number and amount, plus
  // a tinyurl-shortened link to the locked PDF when one exists. If no
  // locked PDF yet (still draft), the message just references the
  // proposal number; the team can re-share after Mark Sent generates
  // the snapshot.
  async function handleWhatsApp() {
    if (!quote) return
    const phone = (
      quote.client_phone ||
      // Govt proposals often don't capture a phone in the recipient
      // block — try parsing the recipient_block for a 10-digit number
      // as a fallback. Best-effort only.
      (quote.recipient_block || '').match(/\b\d{10}\b/)?.[0] ||
      ''
    )
    let msg = `નમસ્કાર,\n\nઅનટાઇટલ્ડ એડવર્ટાઇઝિંગ તરફથી ${quote.media_type === 'AUTO_HOOD' ? 'ઓટો રિક્ષા હૂડ' : 'GSRTC LED'} પ્રપોઝલ —\n${quote.quote_number || quote.ref_number || ''}\nરકમ: ₹${formatINREnglish(quote.total_amount || 0)}/-\n`
    if (quote.locked_proposal_pdf_url) {
      try {
        const url = await getSignedUrl(quote.locked_proposal_pdf_url, 24 * 3600) // 24h link
        const short = await shortenUrl(url).catch(() => url)
        msg += `\nપ્રપોઝલ PDF: ${short}\n`
      } catch (e) {
        // signed URL failed — send without link, user can retry
      }
    }
    msg += `\nઆભાર.`
    openWhatsApp(phone, msg)
  }

  async function handleDeletePayment(paymentId) {
    const { error } = await deletePayment(paymentId)
    if (error) {
      setStatusError(error.message)
    } else {
      fetchPayments()
    }
  }

  // ─── Phase 7 — attachments checklist ──────────────────────────────
  // attachments_checklist on quotes is a jsonb array. Each entry is
  // { template_id?, label, checked, file_url?, custom?: true }.
  // Standard items are derived from attachment_templates and merged
  // with whatever's saved on the quote. Custom items live alongside.
  const checklist = useMemo(() => {
    const saved = Array.isArray(quote?.attachments_checklist) ? quote.attachments_checklist : []
    // Merge order:
    //   1. existing per-quote upload (saved.file_url) — wins, owner edited it
    //   2. template default file (Phase 8C — uploaded once on Master page,
    //      auto-attaches here) — fallback so new proposals don't have to
    //      re-upload reusable docs (DAVP letter, Advisory, etc.)
    //   3. empty — slot waits for user upload (OC copy / PO copy)
    const fromTpl = attachmentTpl.map(t => {
      const existing  = saved.find(s => s.template_id === t.id)
      const effective = existing?.file_url || t.default_file_url || ''
      return {
        template_id:        t.id,
        label:              t.label,
        is_required:        t.is_required,
        // Auto-tick when EITHER a per-quote upload OR a master default
        // file is present — both mean "this attachment is real".
        checked:            existing?.checked ?? Boolean(effective),
        file_url:           effective,
        // Distinguish where the file came from in the UI so users know
        // not to assume an uploaded file is per-quote.
        from_master_default: !existing?.file_url && Boolean(t.default_file_url),
        custom:             false,
      }
    })
    const customs = saved.filter(s => s.custom === true).map(s => ({ ...s }))
    return [...fromTpl, ...customs]
  }, [quote?.attachments_checklist, attachmentTpl])

  async function persistChecklist(next) {
    setSavingAttachments(true)
    const { data, error } = await supabase
      .from('quotes')
      .update({ attachments_checklist: next })
      .eq('id', quote.id)
      .select()
      .single()
    if (!error) setQuote(data)
    setSavingAttachments(false)
  }

  function toggleAttachment(idx, field, value) {
    const next = checklist.map((c, i) => i === idx ? { ...c, [field]: value } : c)
    persistChecklist(next)
  }

  function addCustomAttachment() {
    const label = customLabel.trim()
    if (!label) return
    const next = [
      ...checklist,
      { custom: true, label, checked: true, file_url: '' },
    ]
    setCustomLabel('')
    persistChecklist(next)
  }

  function removeCustomAttachment(idx) {
    const next = checklist.filter((_, i) => i !== idx)
    persistChecklist(next)
  }

  // ─── Phase 8 — file upload + signed URLs + combined PDF ───────────

  // User picks a file for a checklist row → upload to Supabase Storage,
  // store the resulting path in attachments_checklist[idx].file_url.
  // We intentionally OVERWRITE any prior URL paste — switching from
  // "URL paste" to "real upload" is the whole point of Phase 8.
  async function handleFilePick(idx, file) {
    if (!file) return
    setUploadingIdx(idx)
    setStatusError('')
    try {
      const row = checklist[idx]
      const tpl = attachmentTpl.find(t => t.id === row?.template_id)
      const { path } = await uploadAttachment({
        file,
        quoteId: quote.id,
        displayOrder: tpl?.display_order,
        label: row?.label,
      })
      // Mark this row as having a real file: file_url = storage path,
      // and auto-tick checked since uploading IS confirming presence.
      const next = checklist.map((c, i) =>
        i === idx ? { ...c, file_url: path, checked: true } : c
      )
      await persistChecklist(next)
    } catch (e) {
      setStatusError(`Upload failed: ${e?.message || e}`)
    } finally {
      setUploadingIdx(null)
    }
  }

  // Resolve a stored file path to a downloadable URL on demand. Cached
  // per-path inside signedUrls — but signed URLs expire so a refresh
  // is fine; we cache only to avoid re-fetching during a single click.
  async function openAttachment(path) {
    if (!path) return
    if (path.startsWith('http')) {
      // Old data: a pasted URL, not a storage path. Open as-is.
      window.open(path, '_blank', 'noopener')
      return
    }
    try {
      const url = await getSignedUrl(path, 600)
      setSignedUrls(prev => ({ ...prev, [path]: url }))
      window.open(url, '_blank', 'noopener')
    } catch (e) {
      setStatusError(`Could not open file: ${e?.message || e}`)
    }
  }

  // Build one consolidated PDF: locked proposal letter (if sent) +
  // every uploaded checklist item, in checklist display order. Skips
  // rows that only have a pasted URL (we can't reach external URLs
  // from the browser due to CORS) and rows with unsupported file types.
  async function handleDownloadCombinedPdf() {
    if (!quote || combinedPdfBusy) return
    setCombinedPdfBusy(true)
    setStatusError('')
    setStatusMsg('')
    try {
      const inputs = []

      // 1) Proposal letter PDF first.
      //    Phase 11d (rev4) — ALWAYS rasterize fresh from the current
      //    renderer instead of using the locked PDF. The locked PDF is
      //    legal evidence of "what was originally sent" and stays on
      //    Storage (still viewable via the Locked-PDF banner's "View"
      //    button), but the Combined PDF is a working copy meant to
      //    reflect current quote data + latest layout fixes. Without
      //    this change, every layout improvement (A4 lock, district
      //    list, font compaction) would only apply to NEW quotes —
      //    existing Sent quotes would forever show stale 6-page
      //    PDFs in their Combined download until admin manually
      //    clicked Regenerate. That's a footgun. Better: View = legal
      //    snapshot, Combined = current view.
      if (rendererRef.current) {
        // Draft preview: rasterize current state, embed as PDF in-memory
        // (no Storage upload).
        //
        // CRITICAL — must mirror generateLockedProposalPdf's A4 logic:
        //   1. Clone rendererRef into an off-screen 794px-wide wrapper
        //      so the captured canvas matches A4 width (else the stretched
        //      single-image addImage produces wrong-aspect pages).
        //   2. Slice the canvas into A4-tall (≈297mm) pages and add each
        //      to the PDF as its own page — same as the locked path.
        // The previous version called pdf.addImage with full canvas height
        // scaled to 210mm width, which gave PDFs where one giant image
        // got stretched/squashed onto a single A4 page.
        try {
          const html2canvas = (await import('html2canvas')).default
          const { jsPDF } = await import('jspdf')

          const A4_WIDTH_PX = 794
          const wrapper = document.createElement('div')
          wrapper.style.position   = 'fixed'
          wrapper.style.left       = '-100000px'
          wrapper.style.top        = '0'
          wrapper.style.width      = `${A4_WIDTH_PX}px`
          wrapper.style.background = '#ffffff'
          wrapper.style.padding    = '0'
          wrapper.style.zIndex     = '-1'
          wrapper.appendChild(rendererRef.current.cloneNode(true))
          document.body.appendChild(wrapper)

          let canvas
          try {
            canvas = await html2canvas(wrapper, {
              scale: 2, backgroundColor: '#ffffff', useCORS: true, logging: false,
              width: A4_WIDTH_PX, windowWidth: A4_WIDTH_PX,
            })
          } finally {
            document.body.removeChild(wrapper)
          }

          const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
          const pageWidthMm  = 210
          const pageHeightMm = 297
          const pxPerMm      = canvas.width / pageWidthMm
          const pageHpx      = Math.floor(pageHeightMm * pxPerMm)

          let remaining   = canvas.height
          let yOffsetPx   = 0
          let isFirstPage = true

          while (remaining > 0) {
            const sliceHpx = Math.min(pageHpx, remaining)
            // Phase 11d (rev7) — skip trailing tiny slice (kills the
            // phantom blank page caused by margin/border rounding).
            if (!isFirstPage && sliceHpx < pageHpx * 0.10) {
              break
            }
            if (!isFirstPage) pdf.addPage()
            isFirstPage = false

            const slice    = document.createElement('canvas')
            slice.width    = canvas.width
            slice.height   = sliceHpx
            slice.getContext('2d').drawImage(
              canvas,
              0, yOffsetPx, canvas.width, sliceHpx,
              0, 0,         canvas.width, sliceHpx,
            )
            const sliceData = slice.toDataURL('image/jpeg', 0.92)
            const sliceMm   = sliceHpx / pxPerMm
            pdf.addImage(sliceData, 'JPEG', 0, 0, pageWidthMm, sliceMm, undefined, 'FAST')

            yOffsetPx += sliceHpx
            remaining -= sliceHpx
          }

          const buf = pdf.output('arraybuffer')
          inputs.push({ kind: 'pdf', data: buf })
        } catch (e) {
          // Phase 11d (rev7) — surface this. Previously logged to
          // console.warn and swallowed, then the user got the
          // misleading "Nothing to merge" message. Common cause is a
          // stale Vite chunk hash after a deploy ("Failed to fetch
          // dynamically imported module: jspdf.es.min-...js") — hard
          // refresh fixes it.
          const msg = String(e?.message || e)
          if (msg.includes('dynamically imported module') || msg.includes('Failed to fetch')) {
            setStatusError(
              'Could not load PDF generator — your browser has a stale page from before the last deploy. ' +
              'Hard refresh (Cmd+Shift+R / Ctrl+Shift+R) and try again.'
            )
          } else {
            setStatusError(`Could not render proposal letter: ${msg}`)
          }
          setCombinedPdfBusy(false)
          return
        }
      }

      // 2) Each uploaded attachment in checklist order.
      // Phase 11d (rev) — track included vs skipped attachments by
      // reason so the user gets actionable feedback instead of silent
      // misses. "Combined PDF showing only the letter" was confusing
      // when the rep didn't realize their pasted URLs / failed fetches
      // were being dropped.
      const merged_in    = []
      const skipped_url  = []   // pasted http URLs (CORS-blocked)
      const skipped_no   = []   // checklist row exists but no file
      const skipped_err  = []   // fetch threw — file missing or RLS denied
      for (const c of checklist) {
        const label = c.label || 'unnamed'
        if (!c.file_url) {
          skipped_no.push(label)
          continue
        }
        if (String(c.file_url).startsWith('http')) {
          skipped_url.push(label)
          continue
        }
        try {
          const part = await fetchAsMergeInput(c.file_url)
          if (part) {
            inputs.push(part)
            merged_in.push(label)
          } else {
            skipped_err.push(label)
          }
        } catch (e) {
          console.warn('[combined-pdf] skipped attachment:', label, e?.message)
          skipped_err.push(label)
        }
      }

      if (inputs.length === 0) {
        setStatusError('Nothing to merge — upload at least one attachment first.')
        return
      }

      const merged = await buildCombinedPdf(inputs)
      const filename = `${quote.quote_number || quote.ref_number || 'proposal'}-combined.pdf`
        .replace(/[^a-z0-9-_.]/gi, '-')
      downloadPdfBlob(merged, filename)

      // Build a feedback message that calls out skipped attachments
      // by name so the rep knows exactly what's missing from the PDF.
      const totalAttachments = checklist.length
      const parts = [`Combined PDF generated (${inputs.length} document${inputs.length === 1 ? '' : 's'}).`]
      if (merged_in.length) {
        parts.push(`Included: ${merged_in.join(', ')}.`)
      }
      if (skipped_url.length) {
        parts.push(`Skipped pasted-URL attachments (re-upload as files): ${skipped_url.join(', ')}.`)
      }
      if (skipped_err.length) {
        parts.push(`Failed to fetch: ${skipped_err.join(', ')} — check the file still exists in storage.`)
      }
      if (totalAttachments === 0) {
        parts.push('No attachment rows in checklist yet — upload OC copy / PO copy / supporting docs to include them.')
      }
      setStatusMsg(parts.join(' '))
      // Longer timeout when there are skipped items so the rep has time
      // to read the failure list.
      setTimeout(() => setStatusMsg(''), (skipped_url.length + skipped_err.length) ? 9000 : 4500)
    } catch (e) {
      setStatusError(`Failed to build combined PDF: ${e?.message || e}`)
    } finally {
      setCombinedPdfBusy(false)
    }
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
            className="govt-wiz__btn"
            onClick={handleWhatsApp}
            title="Share via WhatsApp with the locked proposal PDF link"
          >
            <MessageCircle size={14} /> WhatsApp
          </button>
          {/* Phase 11d (rev9) — Print / Save PDF button removed.
              Owner asked twice. Combined PDF (next button) is the
              canonical download path; the browser-native window.print()
              produced inconsistent output and confused the workflow. */}
          <button
            type="button"
            className="govt-wiz__btn govt-wiz__btn--primary"
            disabled={combinedPdfBusy}
            onClick={handleDownloadCombinedPdf}
            title="Merge proposal letter + all uploaded attachments into a single PDF"
          >
            {combinedPdfBusy
              ? <><Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Building…</>
              : <><Download size={14} /> Combined PDF</>}
          </button>
          {/* Status transitions — Mark Sent / Won / Lost.
              Phase 10d: previously gated behind isPrivileged so sales
              reps couldn't advance their own govt proposals. Owner
              spec is that sales runs the full send-to-client flow
              themselves (small-business model, no manager review
              hierarchy). The Mark Sent pre-flight modal still enforces
              OC-copy upload, and Mark Won enforces PO upload + payment
              capture, so removing the role gate doesn't bypass any
              data-quality guard — those gates live on the modal flow.
              RLS allows sales to UPDATE their own quotes
              (quotes_sales_own) and INSERT their own payments
              (payments_sales_insert_own), so the writes still succeed. */}
          {quote.status === 'draft' && (
            <button
              type="button"
              className="govt-wiz__btn"
              disabled={savingStatus === 'sent' || generatingPdf}
              onClick={() => changeStatus('sent')}
            >
              {generatingPdf
                ? <><Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Locking…</>
                : <><Send size={14} /> Mark Sent</>}
            </button>
          )}
          {(quote.status === 'sent' || quote.status === 'negotiating') && (
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
          {/* Cancel draft → mark Lost. Visible only on drafts so reps
              can clean up their own pipeline without admin help. Uses
              the same status transition path as Mark Lost from sent;
              the only difference is the entry status. */}
          {quote.status === 'draft' && (
            <button
              type="button"
              className="govt-wiz__btn"
              disabled={savingStatus === 'lost'}
              onClick={() => {
                if (confirm('Cancel this draft proposal? It will be marked Lost and removed from active pipeline.')) {
                  changeStatus('lost')
                }
              }}
              style={{ borderColor: 'var(--danger)', color: 'var(--danger)' }}
              title="Cancel and mark this draft as Lost"
            >
              <XCircle size={14} /> Cancel
            </button>
          )}
        </div>
      </div>

      {statusError && (
        <div style={{
          background: 'rgba(229,57,53,.1)',
          border: '1px solid rgba(229,57,53,.3)',
          borderRadius: 8, padding: '10px 14px', margin: '12px 0',
          fontSize: '.82rem', color: '#ef9a9a',
          display: 'flex', gap: 8, alignItems: 'center',
        }}>
          <XCircle size={14} /> {statusError}
          <button
            style={{ background: 'none', border: 'none', color: '#ef9a9a', marginLeft: 'auto', cursor: 'pointer' }}
            onClick={() => setStatusError('')}
          >✕</button>
        </div>
      )}

      {statusMsg && (
        <div style={{
          background: 'rgba(76,175,80,.1)',
          border: '1px solid rgba(76,175,80,.3)',
          borderRadius: 8, padding: '10px 14px', margin: '12px 0',
          fontSize: '.82rem', color: '#81c784',
        }}>
          ✓ {statusMsg}
        </div>
      )}

      {/* Editable signer mobile (Phase 8B) — the value flows through
          to GovtProposalRenderer via effectiveSigner. Users can type a
          desk-specific mobile per proposal without touching their user
          record. Empty → falls back to signer's default. Saved on
          blur to avoid a save-per-keystroke. */}
      {signer && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          margin: '12px 0', fontSize: 12,
          color: 'var(--text-muted)',
        }}>
          <span style={{ whiteSpace: 'nowrap' }}>
            Signer mobile (overrides default):
          </span>
          <input
            type="text"
            placeholder={signer.signature_mobile || '—'}
            defaultValue={quote.signer_mobile_override || ''}
            onBlur={async (e) => {
              const next = (e.target.value || '').trim() || null
              if (next === (quote.signer_mobile_override || null)) return
              const { data, error } = await supabase
                .from('quotes')
                .update({ signer_mobile_override: next })
                .eq('id', quote.id)
                .select()
                .single()
              if (!error) setQuote(data)
            }}
            className="govt-input-cell"
            style={{ maxWidth: 220 }}
          />
          {quote.locked_proposal_pdf_url && (
            <span style={{ color: 'var(--warning)', fontSize: 11 }}>
              ⚠ Letter PDF already locked — changes affect future renders only, not the snapshot.
            </span>
          )}
        </div>
      )}

      {/* Wrap the renderer in a ref'd container — html2canvas captures
          this exact node when generating the locked PDF on Mark Sent. */}
      <div ref={rendererRef}>
        <GovtProposalRenderer
          template={template}
          data={renderedData}
          signer={effectiveSigner}
          mediaType={quote.media_type}
          company={company}
        />
      </div>

      {/* Locked PDF status — shows once a snapshot exists so the user
          knows the sent version is frozen. */}
      {quote.locked_proposal_pdf_url && (
        <div style={{
          background: 'rgba(100,181,246,.08)',
          border: '1px solid rgba(100,181,246,.25)',
          borderRadius: 8, padding: '10px 14px', margin: '12px 0',
          fontSize: '.82rem', color: '#cdd9e6',
          display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap',
        }}>
          <Lock size={14} style={{ color: '#64b5f6' }} />
          <div style={{ flex: 1 }}>
            <strong>Letter PDF locked</strong>
            {quote.locked_proposal_pdf_at && (
              <> on {new Date(quote.locked_proposal_pdf_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</>
            )}
            . Future quote edits won't change what was sent.
          </div>
          <button
            type="button"
            onClick={() => openAttachment(quote.locked_proposal_pdf_url)}
            style={{
              background: 'transparent', border: '1px solid rgba(100,181,246,.4)',
              color: '#64b5f6', borderRadius: 6, padding: '4px 10px',
              cursor: 'pointer', fontSize: 12, fontWeight: 600,
              display: 'inline-flex', gap: 6, alignItems: 'center',
            }}
          >
            <Download size={12} /> View
          </button>
          {isAdmin && (
            <button
              type="button"
              onClick={handleRegenerateLockedPdf}
              disabled={regeneratingLocked}
              title="Regenerate the locked PDF — use after layout/template fixes"
              style={{
                background: 'transparent', border: '1px solid rgba(255,193,7,.4)',
                color: '#ffc107', borderRadius: 6, padding: '4px 10px',
                cursor: regeneratingLocked ? 'wait' : 'pointer',
                fontSize: 12, fontWeight: 600,
                display: 'inline-flex', gap: 6, alignItems: 'center',
                opacity: regeneratingLocked ? 0.6 : 1,
              }}
            >
              {regeneratingLocked
                ? <><Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> Regenerating…</>
                : <>↻ Regenerate</>}
            </button>
          )}
        </div>
      )}

      {/* ─── Attachments checklist (Phase 7) ─────────────────────── */}
      <h2 style={{
        fontFamily: 'var(--font-display)',
        color: 'var(--text)',
        margin: '24px 0 8px',
        fontSize: 16,
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <Paperclip size={16} /> Attachments to send with proposal
      </h2>
      <div className="govt-master__sub" style={{ marginBottom: 12 }}>
        Standard list for {quote.media_type === 'AUTO_HOOD' ? 'Auto Hood' : 'GSRTC LED'}.
        Upload each file, or paste a URL if it's already hosted somewhere.
        OC copy is required to mark Sent. PO copy / Work Order is required to mark Won.
      </div>
      <div className="govt-list" style={{ marginBottom: 16 }}>
        {checklist.map((c, idx) => {
          // The proposal-letter slot is auto-generated on Mark Sent —
          // the user can't manually upload here. Special read-only row.
          const isAutoProposal =
            String(c.label || '').toLowerCase().includes('auto-generated') ||
            (c.template_id && (c.label || '').toLowerCase().startsWith('proposal letter'))
          const hasUploadedFile = c.file_url && !String(c.file_url).startsWith('http')
          const hasUrlOnly      = c.file_url && String(c.file_url).startsWith('http')

          return (
            <div
              key={`${c.template_id || 'custom'}-${idx}`}
              className="govt-list__row"
              style={{ gridTemplateColumns: '28px 1.2fr 1.6fr 80px 28px', alignItems: 'center' }}
            >
              <span className="govt-list__check">
                <input
                  type="checkbox"
                  checked={!!c.checked}
                  disabled={isAutoProposal}
                  onChange={e => toggleAttachment(idx, 'checked', e.target.checked)}
                />
              </span>
              <span style={{ color: c.checked ? 'var(--text)' : 'var(--text-muted)' }}>
                {c.label}
                {c.is_required && !isAutoProposal && (
                  <span style={{ marginLeft: 6, color: 'var(--danger)', fontSize: 11 }}>required</span>
                )}
                {isAutoProposal && (
                  <span style={{ marginLeft: 6, color: '#64b5f6', fontSize: 11 }}>auto on Sent</span>
                )}
                {c.custom && (
                  <span style={{ marginLeft: 6, color: 'var(--blue)', fontSize: 11 }}>custom</span>
                )}
              </span>

              {/* File picker + URL paste cell. The auto-proposal slot
                  shows a status string instead. */}
              <span>
                {isAutoProposal ? (
                  <span style={{ fontSize: 12, color: 'var(--text-subtle)' }}>
                    {quote.locked_proposal_pdf_url
                      ? <>Locked snapshot — <em>see banner above</em></>
                      : <>Will be auto-generated when proposal is marked Sent.</>}
                  </span>
                ) : (
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    {/* Hidden native input + visible label = nicer UX */}
                    <label
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: 6,
                        padding: '5px 10px', borderRadius: 6,
                        border: '1px solid var(--surface-3)',
                        background: 'var(--surface-2)',
                        color: 'var(--text)', fontSize: 12, fontWeight: 600,
                        cursor: uploadingIdx === idx ? 'wait' : 'pointer',
                        opacity: uploadingIdx === idx ? 0.6 : 1,
                        whiteSpace: 'nowrap',
                      }}
                      title={hasUploadedFile ? 'Replace uploaded file' : 'Upload a file'}
                    >
                      {uploadingIdx === idx ? (
                        <><Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> Uploading…</>
                      ) : (
                        <><Upload size={12} /> {hasUploadedFile ? 'Replace' : 'Upload'}</>
                      )}
                      <input
                        type="file"
                        accept=".pdf,.jpg,.jpeg,.png,.webp"
                        style={{ display: 'none' }}
                        disabled={uploadingIdx === idx}
                        onChange={e => {
                          const f = e.target.files?.[0]
                          if (f) handleFilePick(idx, f)
                          e.target.value = '' // allow re-picking same file
                        }}
                      />
                    </label>
                    <input
                      type="text"
                      placeholder="…or paste URL"
                      value={hasUrlOnly ? c.file_url : ''}
                      onChange={e => toggleAttachment(idx, 'file_url', e.target.value)}
                      disabled={hasUploadedFile}
                      title={hasUploadedFile ? 'Clear the uploaded file (Replace) to paste a URL instead' : ''}
                      className="govt-input-cell"
                      style={{ maxWidth: 'unset', width: '100%', opacity: hasUploadedFile ? 0.5 : 1 }}
                    />
                  </div>
                )}
              </span>

              {/* View / status cell */}
              <span style={{ display: 'flex', justifyContent: 'flex-end' }}>
                {hasUploadedFile && (
                  <button
                    type="button"
                    onClick={() => openAttachment(c.file_url)}
                    title="View uploaded file"
                    style={{
                      background: 'transparent', border: 'none',
                      color: '#64b5f6', cursor: 'pointer',
                      display: 'inline-flex', alignItems: 'center', gap: 4,
                      fontSize: 11, fontWeight: 600,
                    }}
                  >
                    <FileText size={12} /> View
                  </button>
                )}
                {hasUrlOnly && (
                  <button
                    type="button"
                    onClick={() => openAttachment(c.file_url)}
                    title="Open URL"
                    style={{
                      background: 'transparent', border: 'none',
                      color: '#81c784', cursor: 'pointer',
                      display: 'inline-flex', alignItems: 'center', gap: 4,
                      fontSize: 11, fontWeight: 600,
                    }}
                  >
                    <Download size={12} /> Open
                  </button>
                )}
              </span>

              <span>
                {c.custom && (
                  <button
                    type="button"
                    onClick={() => removeCustomAttachment(idx)}
                    title="Remove custom attachment"
                    style={{
                      background: 'transparent', border: 'none',
                      color: 'var(--danger)', cursor: 'pointer',
                    }}
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </span>
            </div>
          )
        })}
        {/* Add-custom row — matches the 5-column grid above */}
        <div
          className="govt-list__row"
          style={{ gridTemplateColumns: '28px 1.2fr 1.6fr 80px 28px', alignItems: 'center' }}
        >
          <span></span>
          <input
            type="text"
            value={customLabel}
            onChange={e => setCustomLabel(e.target.value)}
            placeholder="Add another attachment label…"
            onKeyDown={e => { if (e.key === 'Enter') addCustomAttachment() }}
            className="govt-input-cell"
            style={{ maxWidth: 'unset', width: '100%' }}
          />
          <span style={{ color: 'var(--text-subtle)', fontSize: 12 }}>
            Press Enter or click +
          </span>
          <span></span>
          <span>
            <button
              type="button"
              onClick={addCustomAttachment}
              disabled={!customLabel.trim() || savingAttachments}
              title="Add custom attachment"
              style={{
                background: 'transparent', border: 'none',
                color: customLabel.trim() ? 'var(--accent)' : 'var(--text-subtle)',
                cursor: customLabel.trim() ? 'pointer' : 'not-allowed',
              }}
            >
              <Plus size={14} />
            </button>
          </span>
        </div>
      </div>

      {/* Lightweight global keyframe so the inline Loader2 spinners
          actually rotate. Defined once at the page level so we don't
          touch govt.css on the staging branch. */}
      <style>{`@keyframes spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }`}</style>

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

      {/* ─── Payments (Phase B parity with private LED) ─────────────
           Same components, same hook, same approval flow as
           src/pages/QuoteDetail.jsx — only the surrounding chrome
           differs. The `payments` table is segment-agnostic, and the
           DB trigger rebuild_monthly_sales fires on is_final_payment +
           approval_status='approved' regardless of segment, so once
           govt deals start logging payments they roll into incentives
           the same way private deals do. */}
      <h2 style={{
        fontFamily: 'var(--font-display)',
        color: 'var(--text)',
        margin: '24px 0 8px',
        fontSize: 16,
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <CreditCard size={16} /> Payments
      </h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 24 }}>
        <PaymentSummary
          totalAmount={quote.total_amount}
          totalPaid={totalPaid}
          hasFinalPayment={hasFinalPayment}
        />
        <PaymentHistory
          payments={payments}
          loading={paymentsLoading}
          onEdit={p => { setEditingPayment(p); setShowEditPayment(true) }}
          onDelete={handleDeletePayment}
        />
        {quote.status !== 'lost' && !hasFinalPayment && (
          <div style={{ textAlign: 'center' }}>
            <button
              type="button"
              className="govt-wiz__btn govt-wiz__btn--primary"
              onClick={() => { fetchPayments(); setShowPaymentModal(true) }}
            >
              <CreditCard size={14} /> Add Payment
            </button>
          </div>
        )}
      </div>

      {/* Add Payment modal */}
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
              // Refresh the quote so a status auto-flip from
              // maybeFlipQuoteWon (admin path) is reflected here.
              const { data: q } = await supabase
                .from('quotes').select('*').eq('id', id).single()
              if (q) setQuote(q)
            }
            return result
          }}
        />
      )}

      {/* Edit Payment modal */}
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
              const { data: q } = await supabase
                .from('quotes').select('*').eq('id', id).single()
              if (q) setQuote(q)
            }
            return result
          }}
        />
      )}

      {/* Mark Won modal — collects payment + campaign dates in one pass.
          Phase 11: also gates on Work Order / PO upload via the modal's
          built-in banner. workOrderRequired=true on govt segment so the
          gate fires; private quotes pass false (no WO requirement). */}
      {showWonModal && (
        <WonPaymentModal
          quote={quote}
          totalPaid={totalPaid}
          onConfirm={handleWonWithPayment}
          onClose={() => setShowWonModal(false)}
          workOrderRequired={quote?.segment === 'GOVERNMENT'}
          workOrderUploaded={!!findUploadedByLabel('awarded work order')}
          onUploadWorkOrder={handleWonModalPoUpload}
          uploadingWorkOrder={wonModalUploadingPo}
        />
      )}

      {/* Mark Sent pre-flight modal. Same shell as WonPaymentModal /
          PaymentModal so the experience is consistent. Shows the OC-
          copy requirement, lets the user upload it inline, then
          Confirm & Send executes the lock-PDF + status-flip flow. */}
      {showSentModal && (() => {
        const ocItem = checklist.find(c => /oc copy/i.test(c.label || ''))
        const ocUploaded = ocItem && ocItem.file_url && String(ocItem.file_url).trim() !== ''
        const canConfirm = Boolean(ocUploaded) && !sentModalBusy && !generatingPdf
        return (
          <div className="mo" onClick={e => { if (e.target === e.currentTarget && !sentModalBusy && !generatingPdf) setShowSentModal(false) }}>
            <div className="md" style={{ maxWidth: 520 }}>
              <div className="md-h">
                <div className="md-t">
                  <Send size={16} style={{ marginRight: 8, verticalAlign: 'middle' }} />
                  Mark proposal as Sent
                </div>
                <button
                  className="md-x"
                  onClick={() => setShowSentModal(false)}
                  disabled={sentModalBusy || generatingPdf}
                >✕</button>
              </div>
              <div className="md-b">
                {/* Quick recap card */}
                <div style={{
                  background: 'rgba(100,181,246,.08)',
                  border: '1.5px solid rgba(100,181,246,.2)',
                  borderRadius: 9, padding: '13px 16px', marginBottom: 16,
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontSize: '.72rem', color: 'var(--gray)' }}>Proposal</div>
                      <div style={{ fontWeight: 700, color: '#64b5f6' }}>{quote.quote_number || quote.ref_number}</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: '.72rem', color: 'var(--gray)' }}>Total</div>
                      <div style={{ fontFamily: 'var(--font-display)', fontSize: '1.2rem', color: '#64b5f6' }}>
                        ₹{formatINREnglish(quote.total_amount || 0)}
                      </div>
                    </div>
                  </div>
                </div>

                {/* OC copy requirement row — green when uploaded, amber when missing */}
                <div style={{
                  background: ocUploaded ? 'rgba(76,175,80,.08)' : 'rgba(245,158,11,.08)',
                  border: `1.5px solid ${ocUploaded ? 'rgba(76,175,80,.3)' : 'rgba(245,158,11,.3)'}`,
                  borderRadius: 9, padding: '14px 16px', marginBottom: 12,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: ocUploaded ? 0 : 12 }}>
                    {ocUploaded
                      ? <CheckCircle2 size={18} style={{ color: '#81c784' }} />
                      : <Paperclip size={18} style={{ color: '#fbbf24' }} />}
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 700, color: 'var(--text)', fontSize: 13 }}>
                        OC copy {ocUploaded ? '✓ uploaded' : '— required'}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                        Stamped acknowledgment slip from the government body, brought back by the delivery person.
                      </div>
                    </div>
                  </div>

                  {!ocUploaded && (
                    <label
                      style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                        padding: '10px 14px', borderRadius: 8,
                        border: '1px dashed rgba(245,158,11,.4)',
                        background: 'rgba(245,158,11,.04)',
                        color: '#fbbf24', fontSize: 13, fontWeight: 600,
                        cursor: sentModalUploadingOc ? 'wait' : 'pointer',
                      }}
                    >
                      {sentModalUploadingOc ? (
                        <><Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Uploading…</>
                      ) : (
                        <><Upload size={14} /> Upload OC copy</>
                      )}
                      <input
                        type="file"
                        accept=".pdf,.jpg,.jpeg,.png,.webp"
                        style={{ display: 'none' }}
                        disabled={sentModalUploadingOc}
                        onChange={e => {
                          const f = e.target.files?.[0]
                          if (f) handleSentModalOcUpload(f)
                          e.target.value = ''
                        }}
                      />
                    </label>
                  )}

                  {ocUploaded && (
                    <button
                      type="button"
                      onClick={() => openAttachment(ocItem.file_url)}
                      style={{
                        marginTop: 10,
                        background: 'transparent', border: '1px solid rgba(76,175,80,.4)',
                        color: '#81c784', borderRadius: 6, padding: '4px 10px',
                        cursor: 'pointer', fontSize: 12, fontWeight: 600,
                        display: 'inline-flex', gap: 6, alignItems: 'center',
                      }}
                    >
                      <Download size={12} /> View uploaded file
                    </button>
                  )}
                </div>

                {/* What happens next — sets expectations */}
                <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>
                  <strong style={{ color: 'var(--text)' }}>On confirm:</strong> the Gujarati letter is rasterized
                  to PDF and locked as a snapshot. Future quote edits won't change the locked PDF. Status flips to
                  <strong style={{ color: 'var(--text)' }}> Sent</strong>.
                </div>

                {generatingPdf && (
                  <div style={{
                    marginTop: 12,
                    background: 'rgba(100,181,246,.08)',
                    border: '1px solid rgba(100,181,246,.3)',
                    borderRadius: 8, padding: '10px 12px',
                    fontSize: 12, color: '#64b5f6',
                    display: 'flex', alignItems: 'center', gap: 8,
                  }}>
                    <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />
                    Locking proposal letter as PDF…
                  </div>
                )}
              </div>
              <div className="md-f">
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => setShowSentModal(false)}
                  disabled={sentModalBusy || generatingPdf}
                >Cancel</button>
                <button
                  type="button"
                  className="btn btn-y"
                  onClick={confirmMarkSent}
                  disabled={!canConfirm}
                  title={!ocUploaded ? 'Upload OC copy first to enable' : ''}
                >
                  {sentModalBusy
                    ? 'Sending…'
                    : <><Send size={14} style={{ marginRight: 6, verticalAlign: 'middle' }} /> Confirm & Mark Sent</>}
                </button>
              </div>
            </div>
          </div>
        )
      })()}

      {/* ─── Follow-ups (Phase 8B parity with adflux private flow) ───
           Same component the private QuoteDetail uses, just mounted
           inline at the bottom of the govt page (no tab strip).
           assignedTo defaults to the quote creator so admins creating
           follow-ups still attach them to the rep who owns the quote. */}
      <h2 style={{
        fontFamily: 'var(--font-display)',
        color: 'var(--text)',
        margin: '24px 0 8px',
        fontSize: 16,
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <Calendar size={16} /> Follow-ups
      </h2>
      <div style={{ marginBottom: 24 }}>
        <FollowUpList
          quoteId={quote.id}
          assignedTo={quote.created_by}
        />
      </div>
    </div>
  )
}
