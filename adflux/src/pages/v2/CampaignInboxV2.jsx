// src/pages/v2/CampaignInboxV2.jsx
//
// Campaign Module — C5 Inbox (read-only MVP), styled to the owner-approved
// mockup (_design_reference/campaign_module_mockup.html → Inbox tab): thread
// list with avatars + last-message preview + status chips, a conversation
// pane with day-separators + chat bubbles + stamps, a 24h-window bar, and a
// LOCKED composer (outbound send needs the edigiexpert token).
//
// Reads whatsapp_conversations + whatsapp_messages (new Phase-C2 tables, the
// C4-store data layer). Admin / co_owner only (RLS wa_conv_admin /
// wa_msg_admin + RequirePrivileged route). Touches NO existing flow / frozen
// table / hot path (§45) — new page, reads new tables only.

import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate, Navigate } from 'react-router-dom'
import { useAuthStore } from '../../store/authStore'   // Phase 205 — rep vs admin scope
import {
  Loader2, AlertTriangle, RefreshCw, MessageSquare, Lock, ArrowLeft, Send, Check, CheckCheck,
  ChevronDown, FileText, X, Film, ImageIcon, Search,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import CampaignChrome from '../../components/v2/CampaignChrome'
import MediaPicker from '../../components/campaign/MediaPicker'
import { toastError, toastSuccess } from '../../components/v2/Toast'

// Quick-reply chips (mockup) — label on the chip, fuller text in the box.
const CANNED = [
  { label: 'Greet',          text: 'Thanks for reaching out to Untitled Advertising! How can we help?' },
  { label: 'Ask city + media', text: 'Could you share your city and which media you are looking for (hoarding / LED / etc.)?' },
  { label: 'Rate card',      text: 'Sure — I will share our rate card shortly.' },
  { label: 'Book a call',    text: 'Can we hop on a quick call to discuss? What time suits you?' },
]

// 919812345678 → +91 98123 45678 (best-effort; falls back to a bare +digits).
function fmtPhone(waId) {
  const d = String(waId || '').replace(/\D/g, '')
  if (d.length === 12 && d.startsWith('91')) return `+91 ${d.slice(2, 7)} ${d.slice(7)}`
  if (d.length === 10) return `+91 ${d.slice(0, 5)} ${d.slice(5)}`
  return d ? `+${d}` : '—'
}
// Avatar = last 2 digits, tinted by a stable hash (mockup's colourful pills).
const AV_TINTS = [
  { bg: 'var(--v2-tint-yellow, rgba(255,230,0,0.14))', fg: 'var(--v2-yellow, #FFE600)' },
  { bg: 'var(--v2-green-soft, rgba(34,197,94,0.14))', fg: 'var(--v2-green, #22c55e)' },
  { bg: 'var(--v2-blue-soft, rgba(59,130,246,0.14))',  fg: 'var(--v2-blue, #60a5fa)' },
]
function avatarFor(waId) {
  const d = String(waId || '').replace(/\D/g, '')
  let h = 0
  for (let i = 0; i < d.length; i++) h = (h * 31 + d.charCodeAt(i)) >>> 0
  return { text: d.slice(-2) || '··', ...AV_TINTS[h % AV_TINTS.length] }
}
function relTime(iso) {
  if (!iso) return ''
  const s = (Date.now() - new Date(iso).getTime()) / 1000
  if (s < 60) return 'now'
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86400)}d`
}
function msgTime(iso) {
  try {
    return new Date(iso).toLocaleTimeString('en-IN', {
      hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata',
    })
  } catch { return '' }
}
function dayLabel(iso) {
  try {
    const d = new Date(iso)
    const today = new Date()
    const isToday = d.toDateString() === today.toDateString()
    if (isToday) return 'Today'
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' })
  } catch { return '' }
}
function windowOpen(expiresIso) {
  return !!expiresIso && new Date(expiresIso).getTime() > Date.now()
}
function windowLeft(expiresIso) {
  if (!windowOpen(expiresIso)) return null
  const s = (new Date(expiresIso).getTime() - Date.now()) / 1000
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return `${h}h ${m}m left`
}
// An inbound photo we can render via the media proxy (api/wa/media).
function isImageMsg(m) {
  return !!m.media_id && (m.type === 'image' || m.type === 'sticker')
}

export default function CampaignInboxV2() {
  const navigate = useNavigate()
  // Phase 205 — admin sees all + can reassign; a sales/telecaller/agency rep
  // sees only their assigned chats (RLS-scoped) and replies, no reassign.
  const profile = useAuthStore((s) => s.profile)
  const isPrivileged = ['admin', 'co_owner'].includes(profile?.role) || profile?.team_role === 'sales_manager'
  const canInbox = isPrivileged || ['sales', 'telecaller', 'agency'].includes(profile?.role)

  const [loading, setLoading] = useState(true)
  const [tablesMissing, setTablesMissing] = useState(false)
  const [threads, setThreads] = useState([])
  const [previews, setPreviews] = useState({}) // convId → last message body
  const [selId, setSelId] = useState(null)
  // Phase 258 — conversation search (name or number) + status filter. Purely
  // client-side over the already-loaded threads (no new query). A TC searches
  // within their own assigned threads (RLS-scoped, §243).
  const [convSearch, setConvSearch] = useState('')
  const [convFilter, setConvFilter] = useState('all') // all | open | needs | reply
  const [msgs, setMsgs] = useState([])
  const [msgLoading, setMsgLoading] = useState(false)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const sendingRef = useRef(false)   // §47 synchronous latch — no double-send on a WebView ghost-click
  const msgScrollRef = useRef(null)  // C5.1 — auto-scroll anchor for the message pane
  const prevMsgCount = useRef(0)
  // Phase 251 — inbox sort column; drops to the legacy last_inbound_at once
  // per session if the new column's SQL has not been run yet.
  const sortColRef = useRef('last_message_at')
  const [tcs, setTcs] = useState([])          // telecallers (reassign dropdown)
  const [selLead, setSelLead] = useState(null) // selected conversation's lead row
  const [reassignOpen, setReassignOpen] = useState(false)
  const [reassigning, setReassigning] = useState(false)
  // Phase 254 — composer attachment (from the media library / rate-card chip)
  // + the "Send quote" picker for the chat's lead.
  const [attach, setAttach] = useState(null)         // { url, type, name } | null
  const [brochureUrl, setBrochureUrl] = useState(null)
  const [quoteMenuOpen, setQuoteMenuOpen] = useState(false)
  const [leadQuotes, setLeadQuotes] = useState(null) // null = not loaded yet
  const [quotesLoading, setQuotesLoading] = useState(false)
  // Phase 254.1 — Video button: station videos (cities.youtube_url, the same
  // links the AI shares) + a video-only cut of the media library.
  const [videoMenuOpen, setVideoMenuOpen] = useState(false)
  const [stationVideos, setStationVideos] = useState(null) // null = not loaded yet
  const [stationsLoading, setStationsLoading] = useState(false)
  // Phase 255 — closed-window follow-up: pick an APPROVED template (the §120
  // Utility set) and send it from the company number via send-template.js.
  const [tplPanelOpen, setTplPanelOpen] = useState(false)
  const [outTemplates, setOutTemplates] = useState(null) // null = not loaded yet
  const [tplLoading, setTplLoading] = useState(false)

  const loadThreads = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    // Phase 251 — sort by last MESSAGE (in OR out), not last inbound. A thread
    // created by an outbound template send has last_inbound_at NULL and used to
    // sort dead last, past the old .limit(200) → never fetched, invisible to
    // admin AND the sending TC. last_message_at is stamped by the Phase 251
    // trigger on every whatsapp_messages insert; until the owner runs that SQL
    // we fall back to the legacy sort so the inbox never breaks (§45).
    // Chunked .range paging replaces the hard 200 cap (§66 — 332 threads and
    // growing meant 132 conversations were invisible to everyone).
    const sortCol = sortColRef.current
    const PAGE = 500
    let rows = []
    let error = null
    for (let from = 0; from < 4000; from += PAGE) {
      let q = supabase
        .from('whatsapp_conversations')
        // '*' so customer_name (C11) + last_message_* (Phase 251) flow through
        // and a missing column never breaks the inbox load before the SQL runs.
        .select('*')
        .order(sortCol, { ascending: false, nullsFirst: false })
        .range(from, from + PAGE - 1) // cap-ok: chunked pages, 4000 backstop
      // Phase 243 — a rep sees only their own conversations. RLS already scopes
      // this, but filter in the UI too so the intent is explicit and a rep never
      // relies solely on RLS. Admin / co_owner / manager see every thread.
      if (!isPrivileged && profile?.id) q = q.eq('assigned_to', profile.id)
      const { data, error: pageErr } = await q
      if (pageErr) { error = pageErr; break }
      rows = rows.concat(data || [])
      if (!data || data.length < PAGE) break
    }
    // Phase 251 SQL not run yet → the new sort column 400s. Drop to the legacy
    // sort ONCE for this session and retry (no loop: after the flip the guard
    // below can never match again).
    if (error && sortCol === 'last_message_at' && /last_message_at/i.test(error.message || '')) {
      sortColRef.current = 'last_inbound_at'
      return loadThreads(silent)
    }
    if (error) {
      // On a silent poll, swallow transient errors (no spinner, no toast spam).
      if (!silent) {
        if (/relation .* does not exist|could not find the table/i.test(error.message || '')) {
          setTablesMissing(true)
        } else {
          toastError(error, 'Could not load conversations.')
        }
        setLoading(false)
      }
      return
    }
    setThreads(rows)
    if (!silent) setLoading(false)

    // Best-effort last-message preview per thread (one query, newest first).
    if (rows.length) {
      const ids = rows.slice(0, 300).map((r) => r.id) // preview budget: newest threads only
      const { data: pm } = await supabase
        .from('whatsapp_messages')
        .select('conversation_id, body, type, at')
        .in('conversation_id', ids)
        .order('at', { ascending: false })
        .limit(600)
      const map = {}
      for (const m of pm || []) {
        if (!map[m.conversation_id]) map[m.conversation_id] = m.body || `[${m.type || 'media'}]`
      }
      setPreviews(map)
    }
  }, [isPrivileged, profile?.id])

  const loadMsgs = useCallback(async (convId, silent = false) => {
    if (!convId) { setMsgs([]); return }
    if (!silent) setMsgLoading(true)
    // error_detail (Phase 253) shows Meta's failure reason on failed bubbles.
    // Tolerant: until its SQL runs, selecting it 400s — retry without so the
    // deploy-before-SQL window can't blank the message pane (§45).
    let { data, error } = await supabase
      .from('whatsapp_messages')
      .select('id, direction, type, body, status, at, media_id, error_detail')
      .eq('conversation_id', convId)
      .order('at', { ascending: true })
      .limit(500)
    if (error && /error_detail/i.test(error.message || '')) {
      ({ data, error } = await supabase
        .from('whatsapp_messages')
        .select('id, direction, type, body, status, at, media_id')
        .eq('conversation_id', convId)
        .order('at', { ascending: true })
        .limit(500))
    }
    // Don't blank the open conversation on a transient (silent) error.
    if (error) { if (!silent) toastError(error, 'Could not load messages.') }
    else setMsgs(data || [])
    if (!silent) setMsgLoading(false)
  }, [])

  useEffect(() => { loadThreads() }, [loadThreads])
  useEffect(() => { loadMsgs(selId) }, [selId, loadMsgs])

  // C5.1 — auto-refresh: poll while the tab is visible so new inbound /
  // outbound messages appear WITHOUT a manual reload (silent = no spinner
  // flash). §45-safe: reads campaign tables only, admin page, off the rep
  // hot path. (A Supabase Realtime upgrade is a later option; polling needs
  // no SQL + no publication change.)
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState !== 'visible') return
      loadThreads(true)
      if (selId) loadMsgs(selId, true)
    }
    const iv = setInterval(tick, 7000)
    const onFocus = () => { if (document.visibilityState === 'visible') tick() }
    document.addEventListener('visibilitychange', onFocus)
    window.addEventListener('focus', onFocus)
    return () => {
      clearInterval(iv)
      document.removeEventListener('visibilitychange', onFocus)
      window.removeEventListener('focus', onFocus)
    }
  }, [loadThreads, loadMsgs, selId])

  // Reset the scroll anchor when switching conversations.
  useEffect(() => { prevMsgCount.current = 0 }, [selId])

  // Phase 254 — an attachment / quote picker never carries across chats
  // (guards against sending a file staged for one customer to another).
  useEffect(() => {
    setAttach(null)
    setQuoteMenuOpen(false)
    setLeadQuotes(null)
    setVideoMenuOpen(false)
    setTplPanelOpen(false)
  }, [selId])

  // Phase 254 — the PRIVATE company brochure powers the "Rate card" chip
  // (one small read; RLS-blocked or missing → chip stays text-only).
  useEffect(() => {
    supabase.from('companies').select('brochure_url').eq('segment', 'PRIVATE').maybeSingle()
      .then(({ data }) => { if (data?.brochure_url) setBrochureUrl(data.brochure_url) })
      .catch(() => {})
  }, [])

  // Auto-scroll to the newest message: on open, and when a new message
  // arrives while already near the bottom (don't yank the view if the user
  // scrolled up to read history).
  useEffect(() => {
    const el = msgScrollRef.current
    if (el && msgs.length > prevMsgCount.current) {
      const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 140
      if (prevMsgCount.current === 0 || nearBottom) el.scrollTop = el.scrollHeight
    }
    prevMsgCount.current = msgs.length
  }, [msgs])

  // Telecallers — for the reassign dropdown (admin only; reps don't reassign).
  useEffect(() => {
    if (!isPrivileged) return
    supabase.from('users').select('id, name').eq('role', 'telecaller').order('name')
      .then(({ data }) => setTcs(data || []))
  }, [isPrivileged])

  const sel = threads.find((t) => t.id === selId) || null
  const openCount = threads.filter((t) => windowOpen(t.window_expires_at)).length

  // Phase 258 — filter the loaded threads by the search box (name OR number)
  // and the status chip. Client-side only; the full list stays in `threads`.
  const searchQ = convSearch.trim().toLowerCase()
  const searchDigits = searchQ.replace(/\D/g, '')
  const filteredThreads = threads.filter((t) => {
    const isOpen = windowOpen(t.window_expires_at)
    if (convFilter === 'open' && !isOpen) return false
    if (convFilter === 'needs' && isOpen) return false
    if (convFilter === 'reply' && !(t.last_message_direction === 'in' && isOpen)) return false
    if (!searchQ) return true
    const name = String(t.customer_name || '').toLowerCase()
    if (name.includes(searchQ)) return true
    if (searchDigits.length >= 3) {
      const phone = String(t.customer_wa_id || '').replace(/\D/g, '')
      if (phone.includes(searchDigits)) return true
    }
    return false
  })

  // Load the selected conversation's lead (powers the assigned/reassign pill +
  // Create quote). One small read per conversation-open; campaign admin page.
  useEffect(() => {
    setReassignOpen(false)
    const leadId = sel?.lead_id
    if (!leadId) { setSelLead(null); return }
    let alive = true
    supabase.from('leads')
      .select('id, name, company, phone, email, notes, segment, telecaller_id, assigned_to')
      .eq('id', leadId).maybeSingle()
      .then(({ data }) => { if (alive) setSelLead(data || null) })
    return () => { alive = false }
  }, [sel?.lead_id])

  // Send a free-form reply (only reachable when the 24h window is open). The
  // server (api/wa/send) re-checks the window + role, so this is just the UX.
  // Phase 254: `extra` carries an attachment (media_url/…) or a quote_id —
  // ONE send path for text, media and quote-PDF so the latch + error handling
  // never fork (§71). Phase 254.1: `textOverride` sends a prepared message
  // (station video link) WITHOUT consuming the rep's typed draft or staged
  // attachment.
  async function sendReply(extra = null, textOverride = null) {
    const text = (textOverride ?? draft).trim()
    const withAttach = !!(extra?.media_url || extra?.quote_id)
    if ((!text && !withAttach) || !sel) return
    if (sendingRef.current || sending) return   // §47 latch — same-tick ghost-click guard
    sendingRef.current = true
    setSending(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const jwt = session?.access_token
      if (!jwt) { toastError(new Error('Session expired'), 'Please sign in again.'); return }
      const resp = await fetch('/api/wa/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
        body: JSON.stringify({ conversation_id: sel.id, text, ...(extra || {}) }),
      })
      const data = await resp.json().catch(() => ({}))
      if (!resp.ok) {
        const msg = data?.error === 'quote_pdf_missing'
          ? (data?.detail || 'This quote has no PDF yet — open the quote and share it once first.')
          : (data?.detail || data?.error || `Send failed (${resp.status})`)
        toastError(new Error(msg), 'Could not send.')
        return
      }
      if (!textOverride) { setDraft(''); setAttach(null) }   // a prepared send leaves the composer as-is
      setQuoteMenuOpen(false)
      setVideoMenuOpen(false)
      setPreviews((p) => ({ ...p, [sel.id]: data?.message?.body || text || '[attachment]' }))
      loadMsgs(sel.id)            // reload to show the just-sent row from the DB
    } catch (e) {
      toastError(e, 'Could not send.')
    } finally {
      setSending(false)
      sendingRef.current = false
    }
  }

  // Composer Send button — includes the staged attachment, if any.
  function sendFromComposer() {
    if (attach) {
      sendReply({ media_url: attach.url, media_type: attach.type || 'document', filename: attach.name || undefined })
    } else {
      sendReply()
    }
  }

  // Phase 254 — "Send quote": list this chat's lead's quotes (RLS-scoped:
  // rep sees own, admin all), tap one → the server resolves its stored PDF.
  async function openQuoteMenu() {
    if (!sel?.lead_id) return
    setQuoteMenuOpen((o) => !o)
    setVideoMenuOpen(false)
    if (leadQuotes !== null || quotesLoading) return
    setQuotesLoading(true)
    const { data, error } = await supabase.from('quotes')
      .select('id, quote_number, total_amount, status') // cap-ok — per-lead, .limit(20)
      .eq('lead_id', sel.lead_id)
      .order('created_at', { ascending: false })
      .limit(20)
    if (error) toastError(error, 'Could not load quotes.')
    setLeadQuotes(data || [])
    setQuotesLoading(false)
  }

  function sendQuote(q) {
    sendReply({ quote_id: q.id })
  }

  // Phase 254.1 — Video button: station videos come from the cities master
  // (name + youtube_url, active only — the same links the AI shares, §246.1;
  // sent as TEXT so WhatsApp previews the video, no file-size limits). The
  // list is global → cached for the session, not per-conversation.
  async function openVideoMenu() {
    setVideoMenuOpen((o) => !o)
    setQuoteMenuOpen(false)
    if (stationVideos !== null || stationsLoading) return
    setStationsLoading(true)
    const { data, error } = await supabase.from('cities')
      .select('id, name, youtube_url') // cap-ok — active cities with a video, .limit(60)
      .eq('is_active', true)
      .not('youtube_url', 'is', null)
      .order('name')
      .limit(60)
    if (error) toastError(error, 'Could not load station videos.')
    setStationVideos(data || [])
    setStationsLoading(false)
  }

  function sendStationVideo(c) {
    sendReply(null, `${c.name} station video: ${c.youtube_url}`)
  }

  // Phase 255 — closed-window: send an APPROVED template from the company
  // number. Only the STANDALONE templates are pickable (callback/meeting
  // confirm a specific time — the server refuses them here too). The server
  // re-checks role / lead ownership / opt-out / the 1-per-lead-24h throttle.
  const PICKABLE_TPLS = [
    { key: 'positive', label: 'Thank you + brochure' },
    { key: 'neutral',  label: 'Follow-up + brochure' },
    { key: 'nurture',  label: 'Stay in touch' },
    { key: 'negative', label: 'Polite sign-off' },
  ]
  const canCompanySend = isPrivileged || profile?.role === 'telecaller'

  async function openTplPanel() {
    setTplPanelOpen((o) => !o)
    if (outTemplates !== null || tplLoading) return
    setTplLoading(true)
    const { data, error } = await supabase.from('wa_outcome_templates')
      .select('outcome, meta_template_name, preview_body, header_doc_url')
      .eq('is_active', true)
      .in('outcome', PICKABLE_TPLS.map((t) => t.key))
    if (error) toastError(error, 'Could not load templates.')
    setOutTemplates(data || [])
    setTplLoading(false)
  }

  async function sendCompanyTemplate(key) {
    if (!sel?.lead_id) return
    if (sendingRef.current || sending) return   // §47 latch — shared with the composer
    sendingRef.current = true
    setSending(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const jwt = session?.access_token
      if (!jwt) { toastError(new Error('Session expired'), 'Please sign in again.'); return }
      const resp = await fetch('/api/wa/send-template', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
        body: JSON.stringify({ lead_id: sel.lead_id, template_key: key }),
      })
      const data = await resp.json().catch(() => ({}))
      if (!resp.ok) {
        const msg = data?.error === 'already_sent_today'
          ? 'Already messaged this lead in the last 24 hours.'
          : (data?.detail || data?.error || `Send failed (${resp.status})`)
        toastError(new Error(msg), 'Could not send.')
        return
      }
      setTplPanelOpen(false)
      toastSuccess('Sent from the company number. Their reply re-opens the chat.')
      // Guardian P1 — the template goes out on the MARKETING number. If this
      // open thread is on the service number, the message lands in a SIBLING
      // conversation (same customer, marketing account) — so jump the rep to
      // the thread it actually landed in instead of showing no change here.
      const landedIn = data?.conversation_id || null
      await loadThreads(true)
      if (landedIn && landedIn !== sel.id) setSelId(landedIn)
      else loadMsgs(sel.id, true)
    } catch (e) {
      toastError(e, 'Could not send.')
    } finally {
      setSending(false)
      sendingRef.current = false
    }
  }

  // Reassign the lead to another telecaller (admin action). Sets BOTH owner
  // columns (telecaller_id + assigned_to) to the chosen TC — the C4.5 contract,
  // so the live round-robin can't hijack it — and syncs the conversation row.
  async function reassignTo(tcId) {
    if (!sel?.lead_id || !tcId || reassigning) return
    setReassigning(true)
    try {
      const { error } = await supabase.from('leads')
        .update({ telecaller_id: tcId, assigned_to: tcId })
        .eq('id', sel.lead_id)
      if (error) { toastError(error, 'Could not reassign.'); return }
      await supabase.from('whatsapp_conversations').update({ assigned_to: tcId }).eq('id', sel.id)
      setSelLead((p) => (p ? { ...p, telecaller_id: tcId, assigned_to: tcId } : p))
      setThreads((ts) => ts.map((t) => (t.id === sel.id ? { ...t, assigned_to: tcId } : t)))
      toastSuccess(`Reassigned to ${tcs.find((u) => u.id === tcId)?.name || 'telecaller'}.`)
      setReassignOpen(false)
    } catch (e) {
      toastError(e, 'Could not reassign.')
    } finally {
      setReassigning(false)
    }
  }

  // Open the new-quote wizard prefilled from this lead (mirrors LeadDetailV2:597).
  function createQuote() {
    if (!selLead) return
    navigate('/quotes/new', {
      state: { prefill: {
        client_name:    selLead.name || '',
        client_company: selLead.company || '',
        client_phone:   selLead.phone || sel?.customer_wa_id || '',
        client_email:   selLead.email || '',
        client_address: '',
        client_notes:   selLead.notes || '',
        lead_id:        selLead.id,
        segment:        selLead.segment || 'PRIVATE',
      } },
    })
  }

  const refreshBtn = (
    <button type="button" onClick={loadThreads} title="Refresh" style={btnGhost}>
      <RefreshCw size={16} strokeWidth={1.6} /> Refresh
    </button>
  )

  // Phase 205 — fail CLOSED while auth hydrates: show a loader until the
  // profile resolves (nothing sensitive renders in the unknown window), then
  // bounce non-rep roles (hr / accounts / office_staff) who have no inbox.
  if (!profile) {
    return (
      <CampaignChrome active="inbox" title="Inbox" right={refreshBtn}>
        <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
          <Loader2 size={22} strokeWidth={1.6} className="spin" style={{ color: 'var(--v2-yellow, #FFE600)' }} />
        </div>
      </CampaignChrome>
    )
  }
  if (!canInbox) return <Navigate to="/" replace />

  if (tablesMissing) {
    return (
      <CampaignChrome active="inbox" title="Inbox" right={refreshBtn}>
        <div style={{
          padding: 16, borderRadius: 14, display: 'flex', gap: 10, alignItems: 'flex-start',
          background: 'var(--v2-amber-soft, rgba(245,158,11,0.12))',
          border: '1px solid var(--v2-amber, #F59E0B)', color: 'var(--v2-ink-1, #a9b3c7)',
        }}>
          <AlertTriangle size={18} strokeWidth={1.6} style={{ color: 'var(--v2-amber, #F59E0B)', flexShrink: 0, marginTop: 1 }} />
          <span style={{ fontSize: 13 }}>
            Campaign tables not found. Run <code>supabase_campaign_c2_foundation.sql</code> in Supabase Studio, then reload.
          </span>
        </div>
      </CampaignChrome>
    )
  }

  return (
    <CampaignChrome active="inbox" title="Inbox" right={refreshBtn}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'stretch' }}>
        {/* ─── thread list ─── */}
        <div style={{
          flex: '1 1 300px', minWidth: 280, maxWidth: 360,
          background: 'var(--v2-bg-1)', border: '1px solid var(--v2-line)',
          borderRadius: 14, overflow: 'hidden', alignSelf: 'flex-start',
        }}>
          <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--v2-line)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--v2-ink-0, #f5f7fb)', fontFamily: 'var(--v2-display)' }}>
                Conversations
              </span>
              {threads.length > 0 && <span style={chipY}>{openCount} open</span>}
            </div>

            {/* Phase 258 — search by name or number */}
            <div style={{ position: 'relative' }}>
              <Search size={15} strokeWidth={1.6} style={{
                position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)',
                color: 'var(--v2-ink-2, #6a7590)', pointerEvents: 'none',
              }} />
              <input
                type="text"
                value={convSearch}
                onChange={(e) => setConvSearch(e.target.value)}
                placeholder="Search name or number"
                aria-label="Search conversations by name or number"
                style={{
                  width: '100%', boxSizing: 'border-box',
                  padding: '9px 30px 9px 32px', fontSize: 13,
                  background: 'var(--v2-bg-2)', color: 'var(--v2-ink-0, #f5f7fb)',
                  border: '1px solid var(--v2-line)', borderRadius: 10, outline: 'none',
                }}
              />
              {convSearch && (
                <button
                  type="button"
                  onClick={() => setConvSearch('')}
                  title="Clear"
                  style={{
                    position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)',
                    display: 'flex', padding: 4, border: 'none', background: 'transparent',
                    color: 'var(--v2-ink-2, #6a7590)', cursor: 'pointer',
                  }}
                >
                  <X size={15} strokeWidth={1.8} />
                </button>
              )}
            </div>

            {/* status filter chips */}
            <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
              {[
                { key: 'all', label: 'All' },
                { key: 'reply', label: 'Reply' },
                { key: 'open', label: 'Open' },
                { key: 'needs', label: 'Needs template' },
              ].map((f) => {
                const on = convFilter === f.key
                return (
                  <button
                    key={f.key}
                    type="button"
                    onClick={() => setConvFilter(f.key)}
                    style={{
                      fontSize: 11.5, fontWeight: 600, padding: '4px 10px', borderRadius: 999,
                      cursor: 'pointer', border: '1px solid ' + (on ? 'var(--v2-yellow, #FFE600)' : 'var(--v2-line)'),
                      background: on ? 'var(--v2-tint-yellow, rgba(255,230,0,0.14))' : 'transparent',
                      color: on ? 'var(--v2-yellow, #FFE600)' : 'var(--v2-ink-2, #6a7590)',
                    }}
                  >
                    {f.label}
                  </button>
                )
              })}
            </div>
          </div>

          {loading ? (
            <div style={{ padding: 28, display: 'flex', justifyContent: 'center' }}>
              <Loader2 size={18} strokeWidth={1.6} className="spin" style={{ color: 'var(--v2-yellow, #FFE600)' }} />
            </div>
          ) : threads.length === 0 ? (
            <div style={{ padding: '30px 18px', textAlign: 'center', color: 'var(--v2-ink-2, #6a7590)' }}>
              <MessageSquare size={22} strokeWidth={1.6} style={{ opacity: 0.5 }} />
              <p style={{ fontSize: 13, margin: '10px 0 0' }}>No conversations yet.</p>
              <p style={{ fontSize: 12, margin: '4px 0 0' }}>A WhatsApp message to your number appears here.</p>
            </div>
          ) : filteredThreads.length === 0 ? (
            <div style={{ padding: '30px 18px', textAlign: 'center', color: 'var(--v2-ink-2, #6a7590)' }}>
              <Search size={22} strokeWidth={1.6} style={{ opacity: 0.5 }} />
              <p style={{ fontSize: 13, margin: '10px 0 0' }}>No conversations match.</p>
              <p style={{ fontSize: 12, margin: '4px 0 0' }}>Try a different name, number or filter.</p>
            </div>
          ) : (
            <div style={{ maxHeight: 600, overflowY: 'auto' }}>
              {filteredThreads.map((t) => {
                const active = t.id === selId
                const av = avatarFor(t.customer_wa_id)
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setSelId(t.id)}
                    style={{
                      width: '100%', textAlign: 'left', cursor: 'pointer',
                      display: 'flex', alignItems: 'flex-start', gap: 11,
                      padding: '12px 14px', border: 'none',
                      borderBottom: '1px solid var(--v2-line)',
                      borderLeft: active ? '2px solid var(--v2-yellow, #FFE600)' : '2px solid transparent',
                      background: active ? 'var(--v2-bg-2)' : 'transparent',
                    }}
                  >
                    <span style={{ ...avBox, background: av.bg, color: av.fg }}>{av.text}</span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                        <span style={{
                          fontSize: 13.5, fontWeight: 700, color: 'var(--v2-ink-0, #f5f7fb)',
                          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                        }}>
                          {t.customer_name || fmtPhone(t.customer_wa_id)}
                        </span>
                        <span style={{ fontSize: 11, color: 'var(--v2-ink-2, #6a7590)', flexShrink: 0 }}>{relTime(t.last_message_at || t.last_inbound_at)}</span>
                      </span>
                      <span style={{
                        display: 'block', fontSize: 12.5, color: 'var(--v2-ink-2, #6a7590)', marginTop: 2,
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 230,
                      }}>
                        {previews[t.id] || '…'}
                      </span>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
                        <span style={windowOpen(t.window_expires_at) ? chipG : chipA}>
                          {windowOpen(t.window_expires_at) ? 'Open' : 'Needs template'}
                        </span>
                        {/* Phase 251 — last word is the customer's: somebody must answer */}
                        {t.last_message_direction === 'in' && windowOpen(t.window_expires_at) && (
                          <span style={chipA}>Reply</span>
                        )}
                        {t.lead_id && <span style={chipB}>Lead</span>}
                      </span>
                    </span>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* ─── conversation pane ─── */}
        <div style={{
          flex: '2 1 380px', minWidth: 300, alignSelf: 'stretch',
          background: 'var(--v2-bg-1)', border: '1px solid var(--v2-line)',
          borderRadius: 14, display: 'flex', flexDirection: 'column', minHeight: 460,
        }}>
          {!sel ? (
            <div style={{
              flex: 1, display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center', padding: 30,
              color: 'var(--v2-ink-2, #6a7590)', textAlign: 'center',
            }}>
              <MessageSquare size={22} strokeWidth={1.6} style={{ opacity: 0.5 }} />
              <p style={{ fontSize: 13, margin: '10px 0 0' }}>Pick a conversation to read it.</p>
            </div>
          ) : (
            <>
              {/* conversation header */}
              <div style={{
                padding: '12px 16px', borderBottom: '1px solid var(--v2-line)',
                display: 'flex', alignItems: 'center', gap: 11, flexWrap: 'wrap',
              }}>
                <button type="button" onClick={() => setSelId(null)} title="Back" style={iconBtn}>
                  <ArrowLeft size={18} strokeWidth={1.6} />
                </button>
                <span style={{ ...avBox, ...(() => { const a = avatarFor(sel.customer_wa_id); return { background: a.bg, color: a.fg } })() }}>
                  {avatarFor(sel.customer_wa_id).text}
                </span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 14, fontWeight: 700, color: 'var(--v2-ink-0, #f5f7fb)' }}>
                    {sel.customer_name || fmtPhone(sel.customer_wa_id)}
                  </span>
                  {sel.customer_name && (
                    <span style={{ display: 'block', fontSize: 11, color: 'var(--v2-ink-2, #6a7590)' }}>{fmtPhone(sel.customer_wa_id)}</span>
                  )}
                  <span style={{ fontSize: 11.5, color: windowOpen(sel.window_expires_at) ? 'var(--v2-green, #22c55e)' : 'var(--v2-ink-2, #6a7590)' }}>
                    {windowOpen(sel.window_expires_at) ? `Window open · ${windowLeft(sel.window_expires_at)}` : 'Window closed — needs a template to re-open'}
                  </span>
                </span>
                {sel.lead_id && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    {/* assigned-to + reassign — admin only (Phase 205) */}
                    {isPrivileged && (
                    <div style={{ position: 'relative' }}>
                      <button type="button" onClick={() => setReassignOpen((o) => !o)} style={btnGhost} title="Reassign telecaller">
                        {(() => {
                          const owner = selLead?.telecaller_id || selLead?.assigned_to
                          const nm = tcs.find((u) => u.id === owner)?.name
                          return (<><span style={miniAv}>{(nm || '?').charAt(0).toUpperCase()}</span>{nm || 'Assign'}</>)
                        })()}
                        <ChevronDown size={14} strokeWidth={1.6} />
                      </button>
                      {reassignOpen && (
                        <div style={reassignMenu}>
                          {tcs.length === 0
                            ? <div style={{ padding: '8px 12px', fontSize: 12, color: 'var(--v2-ink-2)' }}>No telecallers</div>
                            : tcs.map((u) => (
                              <button key={u.id} type="button" disabled={reassigning} onClick={() => reassignTo(u.id)} style={reassignItem}>
                                <span style={miniAv}>{(u.name || '?').charAt(0).toUpperCase()}</span>{u.name}
                              </button>
                            ))}
                        </div>
                      )}
                    </div>
                    )}
                    <button type="button" onClick={() => navigate(`/leads/${sel.lead_id}`)} style={btnGhost}>Open lead</button>
                    <button type="button" onClick={createQuote} style={btnY}><FileText size={14} strokeWidth={1.6} /> Create quote</button>
                  </div>
                )}
              </div>

              {/* messages */}
              <div ref={msgScrollRef} style={{ flex: 1, overflowY: 'auto', padding: '14px 16px', maxHeight: 500 }}>
                {msgLoading ? (
                  <div style={{ display: 'flex', justifyContent: 'center', padding: 24 }}>
                    <Loader2 size={18} strokeWidth={1.6} className="spin" style={{ color: 'var(--v2-yellow, #FFE600)' }} />
                  </div>
                ) : msgs.length === 0 ? (
                  <p style={{ fontSize: 13, color: 'var(--v2-ink-2, #6a7590)', textAlign: 'center', margin: '24px 0' }}>
                    No messages in this conversation.
                  </p>
                ) : (
                  msgs.map((m, i) => {
                    const out = m.direction === 'out'
                    const prevDay = i > 0 ? dayLabel(msgs[i - 1].at) : null
                    const thisDay = dayLabel(m.at)
                    const showSep = thisDay && thisDay !== prevDay
                    return (
                      <div key={m.id}>
                        {showSep && (
                          <div style={{ textAlign: 'center', margin: '6px 0 12px' }}>
                            <span style={{
                              fontSize: 10.5, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase',
                              color: 'var(--v2-ink-2, #6a7590)', background: 'var(--v2-bg-2)',
                              border: '1px solid var(--v2-line)', borderRadius: 999, padding: '3px 10px',
                            }}>
                              {thisDay}
                            </span>
                          </div>
                        )}
                        <div style={{ display: 'flex', justifyContent: out ? 'flex-end' : 'flex-start', marginBottom: 8 }}>
                          <div style={{
                            // Mockup: outbound = WhatsApp-green tint with a chat-tail;
                            // inbound = surface bubble. Both light text on dark.
                            maxWidth: '76%', padding: '8px 11px',
                            borderRadius: 10,
                            borderBottomRightRadius: out ? 6 : 10,
                            borderBottomLeftRadius: out ? 10 : 6,
                            background: out ? 'var(--v2-green-soft, rgba(34,197,94,0.18))' : 'var(--v2-bg-2)',
                            color: 'var(--v2-ink-0, #f5f7fb)',
                            border: out ? '1px solid rgba(34,197,94,0.34)' : '1px solid var(--v2-line)',
                          }}>
                            <div style={{ fontSize: 13.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                              {isImageMsg(m) && (
                                <a href={`/api/wa/media?id=${encodeURIComponent(m.media_id)}`} target="_blank" rel="noreferrer" style={{ display: 'block' }}>
                                  <img
                                    src={`/api/wa/media?id=${encodeURIComponent(m.media_id)}`}
                                    alt={m.body || 'photo'} loading="lazy"
                                    style={{ maxWidth: 220, maxHeight: 260, borderRadius: 8, display: 'block', marginBottom: m.body ? 6 : 0 }}
                                  />
                                </a>
                              )}
                              {m.body
                                ? m.body
                                : (!isImageMsg(m) && <em style={{ opacity: 0.7 }}>[{m.type || 'media'}]</em>)}
                            </div>
                            <div style={{
                              fontSize: 10, marginTop: 3, display: 'flex', alignItems: 'center',
                              justifyContent: 'flex-end', gap: 4, color: 'var(--v2-ink-2, #6a7590)',
                            }}>
                              {msgTime(m.at)}
                              {/* WhatsApp-style delivery ticks (outbound only): sent ✓, delivered ✓✓, read ✓✓ blue */}
                              {out && (m.status === 'read' || m.status === 'delivered') && (
                                <CheckCheck size={13} strokeWidth={1.6}
                                  style={{ color: m.status === 'read' ? 'var(--v2-blue, #60a5fa)' : 'var(--v2-ink-2, #6a7590)' }} />
                              )}
                              {out && m.status === 'sent' && (
                                <Check size={13} strokeWidth={1.6} />
                              )}
                              {/* Phase 253 — a failed send says so (+ Meta's reason
                                  when the webhook captured one) instead of silently
                                  showing no ticks. */}
                              {out && m.status === 'failed' && (
                                <span
                                  style={{ color: 'var(--v2-rose, #EF4444)', fontWeight: 600 }}
                                  title={m.error_detail || 'Delivery failed'}
                                >
                                  failed{m.error_detail ? ` · ${String(m.error_detail).slice(0, 60)}` : ''}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    )
                  })
                )}
              </div>

              {/* window bar */}
              <div style={{
                padding: '8px 16px', fontSize: 11.5, fontWeight: 600,
                borderTop: '1px solid var(--v2-line)',
                color: windowOpen(sel.window_expires_at) ? 'var(--v2-green, #22c55e)' : 'var(--v2-amber, #F59E0B)',
                background: windowOpen(sel.window_expires_at) ? 'var(--v2-green-soft, rgba(34,197,94,0.12))' : 'var(--v2-amber-soft, rgba(245,158,11,0.12))',
              }}>
                {windowOpen(sel.window_expires_at)
                  ? `24h window OPEN · ${windowLeft(sel.window_expires_at)}`
                  : '24h window CLOSED · needs an approved template'}
              </div>

              {/* composer — free-form text + attachments, only inside the 24h window */}
              {windowOpen(sel.window_expires_at) ? (
                <div style={{ padding: '10px 12px', borderTop: '1px solid var(--v2-line)', background: 'var(--v2-bg-2)' }}>
                  {/* quick-reply chips (mockup) — click fills the box for editing.
                      Phase 254: Rate card also stages the real brochure PDF when
                      the company row carries one. */}
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8, alignItems: 'center' }}>
                    {CANNED.map((c) => (
                      <button
                        key={c.label} type="button" style={chipReply} title={c.text}
                        onClick={() => {
                          if (c.label === 'Rate card' && brochureUrl) {
                            setDraft('Please find our rate card attached.')
                            setAttach({ url: brochureUrl, type: 'document', name: 'Untitled Advertising - GSRTC LED Network.pdf' })
                          } else {
                            setDraft(c.text)
                          }
                        }}
                      >
                        {c.label}
                      </button>
                    ))}
                    {/* Phase 254 — attach from the media library (Phase 241) */}
                    <MediaPicker
                      triggerLabel="Attach"
                      onSelect={(url, type, name) => setAttach({ url, type: type || 'document', name: name || null })}
                    />
                    {/* Phase 254.1 — send a video (station links / video files) */}
                    <button type="button" onClick={openVideoMenu} style={chipReply}>
                      <Film size={14} strokeWidth={1.6} style={{ verticalAlign: 'text-bottom', marginRight: 4 }} />
                      Video
                    </button>
                    {/* Phase 254 — send one of this lead's quote PDFs */}
                    {sel.lead_id && (
                      <button type="button" onClick={openQuoteMenu} style={chipReply}>
                        <FileText size={14} strokeWidth={1.6} style={{ verticalAlign: 'text-bottom', marginRight: 4 }} />
                        Send quote
                      </button>
                    )}
                  </div>

                  {/* video picker — station videos (sent as a link the customer
                      can play in-chat) + the video-only media library */}
                  {videoMenuOpen && (
                    <div style={{
                      marginBottom: 8, padding: 8, borderRadius: 10,
                      background: 'var(--v2-bg-1, #0f1525)', border: '1px solid var(--v2-line, #1f2b47)',
                    }}>
                      <div style={{
                        fontSize: 10.5, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase',
                        color: 'var(--v2-ink-2, #6a7590)', padding: '2px 6px 6px',
                      }}>
                        Station videos
                      </div>
                      {stationsLoading ? (
                        <div style={{ display: 'flex', justifyContent: 'center', padding: 8 }}>
                          <Loader2 size={15} strokeWidth={1.6} className="spin" style={{ color: 'var(--v2-yellow, #FFE600)' }} />
                        </div>
                      ) : !stationVideos || stationVideos.length === 0 ? (
                        <div style={{ fontSize: 12.5, color: 'var(--v2-ink-2, #6a7590)', padding: '0 6px 6px' }}>
                          No station videos yet — add a YouTube link on a city (Master → Cities).
                        </div>
                      ) : (
                        <div style={{ maxHeight: 180, overflowY: 'auto' }}>
                          {stationVideos.map((c) => (
                            <button
                              key={c.id} type="button" disabled={sending}
                              onClick={() => sendStationVideo(c)}
                              style={{
                                width: '100%', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 8,
                                padding: '7px 8px', fontSize: 12.5, fontWeight: 600, cursor: sending ? 'default' : 'pointer',
                                background: 'transparent', border: 'none', borderRadius: 10, color: 'var(--v2-ink-0, #f5f7fb)',
                              }}
                            >
                              <Film size={14} strokeWidth={1.6} style={{ color: 'var(--v2-ink-2, #6a7590)', flexShrink: 0 }} />
                              {c.name}
                              <span style={{ color: 'var(--v2-ink-2, #6a7590)', marginLeft: 'auto', fontSize: 11.5 }}>Send link</span>
                            </button>
                          ))}
                        </div>
                      )}
                      <div style={{ borderTop: '1px solid var(--v2-line, #1f2b47)', margin: '6px 0', paddingTop: 8, paddingLeft: 6 }}>
                        <MediaPicker
                          accept="video/*"
                          filterType="video"
                          triggerLabel="Pick / upload a video file"
                          onSelect={(url, type, name) => {
                            setAttach({ url, type: 'video', name: name || null })
                            setVideoMenuOpen(false)
                          }}
                        />
                      </div>
                    </div>
                  )}

                  {/* quote picker */}
                  {quoteMenuOpen && (
                    <div style={{
                      marginBottom: 8, padding: 8, borderRadius: 10,
                      background: 'var(--v2-bg-1, #0f1525)', border: '1px solid var(--v2-line, #1f2b47)',
                    }}>
                      {quotesLoading ? (
                        <div style={{ display: 'flex', justifyContent: 'center', padding: 8 }}>
                          <Loader2 size={15} strokeWidth={1.6} className="spin" style={{ color: 'var(--v2-yellow, #FFE600)' }} />
                        </div>
                      ) : !leadQuotes || leadQuotes.length === 0 ? (
                        <div style={{ fontSize: 12.5, color: 'var(--v2-ink-2, #6a7590)', padding: '4px 6px' }}>
                          No quotes on this lead (that you can see).
                        </div>
                      ) : (
                        leadQuotes.map((q) => (
                          <button
                            key={q.id} type="button" disabled={sending}
                            onClick={() => sendQuote(q)}
                            style={{
                              width: '100%', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 8,
                              padding: '7px 8px', fontSize: 12.5, fontWeight: 600, cursor: sending ? 'default' : 'pointer',
                              background: 'transparent', border: 'none', borderRadius: 10, color: 'var(--v2-ink-0, #f5f7fb)',
                            }}
                          >
                            <FileText size={14} strokeWidth={1.6} style={{ color: 'var(--v2-ink-2, #6a7590)', flexShrink: 0 }} />
                            <span style={{ fontFamily: 'var(--v2-display)' }}>{q.quote_number}</span>
                            <span style={{ color: 'var(--v2-ink-2, #6a7590)', marginLeft: 'auto' }}>
                              {q.total_amount != null ? `₹${Number(q.total_amount).toLocaleString('en-IN')}` : ''}
                              {q.status ? ` · ${q.status}` : ''}
                            </span>
                          </button>
                        ))
                      )}
                    </div>
                  )}

                  {/* staged attachment chip */}
                  {attach && (
                    <div style={{
                      display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: 8,
                      padding: '5px 10px', borderRadius: 999, fontSize: 12, fontWeight: 600,
                      background: 'var(--v2-tint-yellow, rgba(255,230,0,0.14))',
                      border: '1px solid var(--v2-line, #1f2b47)', color: 'var(--v2-ink-0, #f5f7fb)',
                      maxWidth: '100%',
                    }}>
                      {attach.type === 'image'
                        ? <ImageIcon size={14} strokeWidth={1.6} />
                        : attach.type === 'video'
                          ? <Film size={14} strokeWidth={1.6} />
                          : <FileText size={14} strokeWidth={1.6} />}
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 220 }}>
                        {attach.name || attach.type || 'attachment'}
                      </span>
                      <button type="button" onClick={() => setAttach(null)} style={iconBtn} title="Remove attachment">
                        <X size={14} strokeWidth={1.6} />
                      </button>
                    </div>
                  )}

                  <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
                    <textarea
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendFromComposer() } }}
                      placeholder={attach ? 'Add a caption… (optional)' : 'Type a reply…'}
                      rows={1}
                      style={{
                        flex: 1, resize: 'none', maxHeight: 120, minHeight: 38, padding: '9px 12px',
                        background: 'var(--v2-bg-1, #0f1525)', border: '1px solid var(--v2-line)', borderRadius: 10,
                        color: 'var(--v2-ink-0, #f5f7fb)', fontSize: 13, fontFamily: 'inherit', outline: 'none',
                      }}
                    />
                    <button
                      type="button" onClick={sendFromComposer} disabled={sending || (!draft.trim() && !attach)}
                      style={{
                        flexShrink: 0, height: 38, padding: '0 14px', borderRadius: 10, border: 'none',
                        background: 'var(--v2-yellow, #FFE600)', color: 'var(--accent-fg, #0f172a)',
                        fontWeight: 700, fontSize: 13, cursor: (sending || (!draft.trim() && !attach)) ? 'default' : 'pointer',
                        opacity: (sending || (!draft.trim() && !attach)) ? 0.55 : 1, display: 'inline-flex', alignItems: 'center', gap: 6,
                      }}
                    >
                      {sending ? <Loader2 size={15} strokeWidth={1.6} className="spin" /> : <Send size={15} strokeWidth={1.6} />}
                      Send
                    </button>
                  </div>
                </div>
              ) : (
                <div style={{ padding: '12px 16px', borderTop: '1px solid var(--v2-line)', background: 'var(--v2-bg-2)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <Lock size={16} strokeWidth={1.6} style={{ color: 'var(--v2-ink-2, #6a7590)', flexShrink: 0 }} />
                    <span style={{ fontSize: 12.5, color: 'var(--v2-ink-2, #6a7590)', flex: 1, minWidth: 200 }}>
                      {sel.lead_id && canCompanySend
                        ? '24h window closed — send an approved message to reach them again (their reply re-opens the chat).'
                        : '24h window closed — re-opening needs an approved template.'}
                    </span>
                    {/* Phase 255 — closed-window follow-up via approved template */}
                    {sel.lead_id && canCompanySend && (
                      <button type="button" onClick={openTplPanel} style={chipReply}>
                        <Send size={14} strokeWidth={1.6} style={{ verticalAlign: 'text-bottom', marginRight: 4 }} />
                        Send approved message
                      </button>
                    )}
                  </div>

                  {tplPanelOpen && (
                    <div style={{
                      marginTop: 10, padding: 8, borderRadius: 10,
                      background: 'var(--v2-bg-1, #0f1525)', border: '1px solid var(--v2-line, #1f2b47)',
                    }}>
                      {tplLoading ? (
                        <div style={{ display: 'flex', justifyContent: 'center', padding: 8 }}>
                          <Loader2 size={15} strokeWidth={1.6} className="spin" style={{ color: 'var(--v2-yellow, #FFE600)' }} />
                        </div>
                      ) : (
                        PICKABLE_TPLS.map((t) => {
                          const row = (outTemplates || []).find((r) => r.outcome === t.key)
                          if (outTemplates !== null && !row) return null   // not mapped/active → hide
                          const preview = row?.preview_body
                            ? String(row.preview_body).replace(/\{\{\d\}\}/g, '…').replace(/\s+/g, ' ').slice(0, 110)
                            : ''
                          return (
                            <button
                              key={t.key} type="button" disabled={sending}
                              onClick={() => sendCompanyTemplate(t.key)}
                              style={{
                                width: '100%', textAlign: 'left', display: 'block',
                                padding: '8px 8px', cursor: sending ? 'default' : 'pointer',
                                background: 'transparent', border: 'none', borderRadius: 10,
                                opacity: sending ? 0.6 : 1,
                              }}
                            >
                              <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 700, color: 'var(--v2-ink-0, #f5f7fb)' }}>
                                {t.label}
                                {row?.header_doc_url && (
                                  <span style={{ ...chipYSmall }}>PDF</span>
                                )}
                              </span>
                              {preview && (
                                <span style={{ display: 'block', fontSize: 11.5, color: 'var(--v2-ink-2, #6a7590)', marginTop: 2 }}>
                                  {preview}…
                                </span>
                              )}
                            </button>
                          )
                        })
                      )}
                      <div style={{ fontSize: 10.5, color: 'var(--v2-ink-2, #6a7590)', padding: '6px 8px 2px', borderTop: '1px solid var(--v2-line, #1f2b47)', marginTop: 4 }}>
                        Fixed Meta-approved wording (name auto-filled) · sent from the company number · max one per lead per 24h.
                      </div>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </CampaignChrome>
  )
}

// ─── shared inline styles ───────────────────────────────────────────────
const avBox = {
  width: 36, height: 36, borderRadius: 999, flexShrink: 0,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  fontSize: 12, fontWeight: 700, fontFamily: 'var(--v2-display)',
}
const chipBase = {
  display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px',
  borderRadius: 999, fontSize: 10, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase',
}
const chipG = { ...chipBase, background: 'var(--v2-green-soft, rgba(34,197,94,0.14))', color: 'var(--v2-green, #22c55e)' }
const chipA = { ...chipBase, background: 'var(--v2-amber-soft, rgba(245,158,11,0.14))', color: 'var(--v2-amber, #F59E0B)' }
const chipB = { ...chipBase, background: 'var(--v2-blue-soft, rgba(59,130,246,0.14))', color: 'var(--v2-blue, #60a5fa)' }
const chipY = { ...chipBase, background: 'var(--v2-tint-yellow, rgba(255,230,0,0.14))', color: 'var(--v2-yellow, #FFE600)' }
const btnGhost = {
  display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 700, cursor: 'pointer',
  background: 'var(--v2-bg-2)', color: 'var(--v2-ink-1, #a9b3c7)',
  border: '1px solid var(--v2-line)', borderRadius: 10, padding: '8px 12px',
}
const iconBtn = {
  background: 'transparent', border: 'none', cursor: 'pointer',
  color: 'var(--v2-ink-2, #6a7590)', display: 'flex', padding: 2,
}
const btnY = {
  display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 700, cursor: 'pointer',
  background: 'var(--v2-yellow, #FFE600)', color: 'var(--accent-fg, #0b1220)',
  border: 'none', borderRadius: 10, padding: '8px 12px',
}
const miniAv = {
  width: 18, height: 18, borderRadius: 999, flexShrink: 0, marginRight: 2,
  background: 'var(--v2-blue-soft, rgba(96,165,250,0.16))', color: 'var(--v2-blue, #60a5fa)',
  fontSize: 9, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
}
const chipYSmall = {
  display: 'inline-flex', alignItems: 'center', padding: '1px 6px', borderRadius: 999,
  fontSize: 9.5, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase',
  background: 'var(--v2-tint-yellow, rgba(255,230,0,0.14))', color: 'var(--v2-yellow, #FFE600)',
}
const chipReply = {
  fontSize: 12, fontWeight: 600, cursor: 'pointer',
  background: 'var(--v2-bg-1, #0f1525)', color: 'var(--v2-ink-1, #a9b3c7)',
  border: '1px solid var(--v2-line, #1f2b47)', borderRadius: 999, padding: '5px 11px',
}
const reassignMenu = {
  position: 'absolute', top: '100%', right: 0, marginTop: 4, zIndex: 100,
  background: 'var(--v2-bg-1, #0f1525)', border: '1px solid var(--v2-line, #1f2b47)',
  borderRadius: 10, boxShadow: '0 12px 30px rgba(0,0,0,.4)', minWidth: 180, padding: 4,
  maxHeight: 240, overflowY: 'auto',
}
const reassignItem = {
  width: '100%', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 8,
  padding: '8px 10px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
  background: 'transparent', border: 'none', borderRadius: 10, color: 'var(--v2-ink-0, #f5f7fb)',
}
