// src/pages/v2/CampaignChatbotV2.jsx
//
// Campaign Module — Chatbot, pixel-matched to the mockup's node-canvas (rail +
// dotted canvas with nodes & wires + a properties panel). It's NOT a toy: each
// "Send …" node IS a real campaign_bot_rule (keywords -> reply), edited in the
// right panel. Start / Greeting / Handoff are fixed flow nodes. The bot answers
// keyword questions and pauses the moment a telecaller replies (webhook logic).
//
// §45-safe: new admin page. Reads/writes campaign_bot_rules + the active
// whatsapp_accounts.bot_enabled flag. No live-app table touched.

import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Loader2, AlertTriangle, MessageSquare, GitBranch, Zap, Users, Code2, Plus, Trash2, RefreshCw,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/authStore'
import CampaignChrome from '../../components/v2/CampaignChrome'
import { toastError, toastSuccess } from '../../components/v2/Toast'
import { confirmDialog } from '../../components/v2/ConfirmDialog'

const RAIL = [MessageSquare, GitBranch, Zap, Users, Code2]
const NODE_W = 190
const COL_X = 470          // x of the action-node column
const ROW_H = 120          // vertical spacing of action nodes

export default function CampaignChatbotV2() {
  const profile = useAuthStore((s) => s.profile)
  const [loading, setLoading] = useState(true)
  const [tablesMissing, setTablesMissing] = useState(false)
  const [acct, setAcct] = useState(null)
  const [rules, setRules] = useState([])
  const [sel, setSel] = useState('greeting')   // 'greeting' | 'handoff' | <rule id>
  const [editKw, setEditKw] = useState('')
  const [editReply, setEditReply] = useState('')
  const [saving, setSaving] = useState(false)
  const [toggling, setToggling] = useState(false)
  const saveRef = useRef(false)
  // Phase 201 — welcome auto-reply (reply to everyone's first message, free).
  const [greetingText, setGreetingText] = useState('')
  const [savingGreet, setSavingGreet] = useState(false)
  const [greetMediaBusy, setGreetMediaBusy] = useState(false)
  const [ruleMediaBusy, setRuleMediaBusy] = useState(false)
  // Phase 204 — greeting tap-buttons.
  const [buttons, setButtons] = useState([])
  const [selBtn, setSelBtn] = useState(null)
  const [btnBusy, setBtnBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const { data: a } = await supabase.from('whatsapp_accounts')
      .select('*').eq('is_active', true).order('created_at', { ascending: true }).limit(1).maybeSingle()
    setAcct(a || null)
    setGreetingText(a?.auto_reply_text || '')   // Phase 201
    if (a?.id) {   // Phase 204 — greeting buttons (tolerant if the table isn't run)
      const { data: b } = await supabase.from('campaign_bot_buttons')
        .select('id, label, position, action, reply_text, media_url, media_type')
        .eq('whatsapp_account_id', a.id).order('position', { ascending: true })
      setButtons(b || [])
    }
    // Phase 203 — include media_url/type; fall back if those columns aren't run.
    let { data: r, error } = await supabase.from('campaign_bot_rules')
      .select('id, keywords, reply, media_url, media_type, is_active, display_order').order('display_order', { ascending: true })
    if (error && /media_url|media_type|could not find|column/i.test(error.message || '')) {
      ;({ data: r, error } = await supabase.from('campaign_bot_rules')
        .select('id, keywords, reply, is_active, display_order').order('display_order', { ascending: true }))
    }
    if (error) {
      if (/relation .* does not exist|could not find the table/i.test(error.message || '')) setTablesMissing(true)
      else toastError(error, 'Could not load bot rules.')
      setLoading(false); return
    }
    setRules(r || [])
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  function pickRule(rule) {
    setSel(rule.id); setEditKw((rule.keywords || []).join(', ')); setEditReply(rule.reply || '')
  }

  async function toggleBot() {
    if (!acct?.id) { toastError(new Error('acct'), 'No active WhatsApp number to attach the bot to.'); return }
    setToggling(true)
    const next = !acct.bot_enabled
    const { error } = await supabase.from('whatsapp_accounts').update({ bot_enabled: next }).eq('id', acct.id)
    if (error) { toastError(error, 'Could not switch the bot.'); setToggling(false); return }
    setAcct({ ...acct, bot_enabled: next }); toastSuccess(next ? 'Chatbot ON.' : 'Chatbot OFF.'); setToggling(false)
  }

  // Phase 201 — welcome auto-reply: reply to EVERY customer's first message with
  // a set greeting (free service message). Independent of the keyword chatbot.
  async function toggleWelcome() {
    if (!acct?.id) { toastError(new Error('acct'), 'No active WhatsApp number.'); return }
    if (!acct.auto_reply_enabled && !greetingText.trim()) { toastError(new Error('text'), 'Write the welcome message first.'); return }
    const next = !acct.auto_reply_enabled
    const { error } = await supabase.from('whatsapp_accounts')
      .update({ auto_reply_enabled: next, auto_reply_text: greetingText.trim() || null }).eq('id', acct.id)
    if (error) { toastError(error, 'Could not switch the welcome reply.'); return }
    setAcct({ ...acct, auto_reply_enabled: next, auto_reply_text: greetingText.trim() })
    toastSuccess(next ? 'Welcome reply ON.' : 'Welcome reply OFF.')
  }
  async function saveGreeting() {
    if (!acct?.id) { toastError(new Error('acct'), 'No active WhatsApp number.'); return }
    if (!greetingText.trim()) { toastError(new Error('text'), 'Write the welcome message.'); return }
    setSavingGreet(true)
    const { error } = await supabase.from('whatsapp_accounts').update({ auto_reply_text: greetingText.trim() }).eq('id', acct.id)
    if (error) toastError(error, 'Could not save.')
    else { setAcct({ ...acct, auto_reply_text: greetingText.trim() }); toastSuccess('Welcome message saved.') }
    setSavingGreet(false)
  }

  // Phase 203 — upload a bot-reply image/video/PDF to the campaign-media bucket.
  async function uploadMedia(file) {
    const ext = ((file.name.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '')) || 'bin'
    const path = `bot-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
    const { error } = await supabase.storage.from('campaign-media').upload(path, file, { upsert: false, contentType: file.type || undefined })
    if (error) throw error
    return supabase.storage.from('campaign-media').getPublicUrl(path).data.publicUrl
  }
  function mediaKind(file) {
    const t = (file?.type || '').toLowerCase()
    if (t.startsWith('image/')) return 'image'
    if (t.startsWith('video/')) return 'video'
    return 'document'
  }
  async function saveGreetMedia(file) {
    if (!acct?.id) return
    if (!file) {
      const { error } = await supabase.from('whatsapp_accounts').update({ auto_reply_media_url: null, auto_reply_media_type: null }).eq('id', acct.id)
      if (error) { toastError(error, 'Could not remove.'); return }
      setAcct({ ...acct, auto_reply_media_url: null, auto_reply_media_type: null }); toastSuccess('Media removed.'); return
    }
    setGreetMediaBusy(true)
    try {
      const url = await uploadMedia(file); const kind = mediaKind(file)
      const { error } = await supabase.from('whatsapp_accounts').update({ auto_reply_media_url: url, auto_reply_media_type: kind }).eq('id', acct.id)
      if (error) throw error
      setAcct({ ...acct, auto_reply_media_url: url, auto_reply_media_type: kind }); toastSuccess('Media added to the welcome.')
    } catch (e) { toastError(e, 'Media upload failed.') } finally { setGreetMediaBusy(false) }
  }
  // Save a keyword rule's media (or clear it).
  async function saveRuleMedia(file) {
    if (typeof sel !== 'string' || sel === 'greeting' || sel === 'handoff') return
    if (!file) {
      const { error } = await supabase.from('campaign_bot_rules').update({ media_url: null, media_type: null }).eq('id', sel)
      if (error) { toastError(error, 'Could not remove.'); return }
      setRules((p) => p.map((x) => x.id === sel ? { ...x, media_url: null, media_type: null } : x)); toastSuccess('Media removed.'); return
    }
    setRuleMediaBusy(true)
    try {
      const url = await uploadMedia(file); const kind = mediaKind(file)
      const { error } = await supabase.from('campaign_bot_rules').update({ media_url: url, media_type: kind }).eq('id', sel)
      if (error) throw error
      setRules((p) => p.map((x) => x.id === sel ? { ...x, media_url: url, media_type: kind } : x)); toastSuccess('Media added to this answer.')
    } catch (e) { toastError(e, 'Media upload failed.') } finally { setRuleMediaBusy(false) }
  }

  // Phase 204 — greeting tap-button CRUD.
  async function addButton() {
    if (!acct?.id) { toastError(new Error('acct'), 'No active WhatsApp number.'); return }
    if (buttons.length >= 10) { toastError(new Error('max'), 'Max 10 buttons (WhatsApp limit).'); return }
    const { data, error } = await supabase.from('campaign_bot_buttons')
      .insert({ whatsapp_account_id: acct.id, label: 'New button', position: buttons.length, action: 'send', reply_text: '', created_by: profile?.id || null })
      .select('id, label, position, action, reply_text, media_url, media_type').maybeSingle()
    if (error || !data) {
      if (/relation .* does not exist|could not find the table/i.test(error?.message || '')) toastError(error, 'Run the Phase 204 SQL first (buttons table).')
      else toastError(error, 'Could not add the button.')
      return
    }
    setButtons((p) => [...p, data]); setSelBtn(data.id)
  }
  async function saveButton(id, patch) {
    setButtons((p) => p.map((b) => b.id === id ? { ...b, ...patch } : b))
    const { error } = await supabase.from('campaign_bot_buttons').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id)
    if (error) toastError(error, 'Could not save the button.')
  }
  async function delButton(id) {
    const ok = await confirmDialog({ title: 'Delete button?', message: 'Remove this button from the greeting?', confirmLabel: 'Delete', danger: true })
    if (!ok) return
    const { error } = await supabase.from('campaign_bot_buttons').delete().eq('id', id)
    if (error) { toastError(error, 'Could not delete.'); return }
    setButtons((p) => p.filter((b) => b.id !== id)); if (selBtn === id) setSelBtn(null)
  }
  async function saveBtnMedia(id, file) {
    if (!file) { await saveButton(id, { media_url: null, media_type: null }); return }
    setBtnBusy(true)
    try { const url = await uploadMedia(file); await saveButton(id, { media_url: url, media_type: mediaKind(file) }); toastSuccess('Media added.') }
    catch (e) { toastError(e, 'Upload failed.') } finally { setBtnBusy(false) }
  }

  async function addNode() {
    if (saveRef.current) return
    saveRef.current = true
    const { data, error } = await supabase.from('campaign_bot_rules')
      .insert({ keywords: ['rate'], reply: 'Type your reply here…', display_order: rules.length, created_by: profile?.id || null })
      .select('id, keywords, reply, is_active, display_order').maybeSingle()
    saveRef.current = false
    if (error || !data) { toastError(error, 'Could not add a node.'); return }
    setRules((p) => [...p, data]); pickRule(data)
  }

  async function saveRule() {
    if (typeof sel !== 'string' || sel === 'greeting' || sel === 'handoff') return
    const keywords = editKw.split(',').map((s) => s.trim()).filter(Boolean)
    if (!keywords.length) { toastError(new Error('kw'), 'Add at least one keyword.'); return }
    if (!editReply.trim()) { toastError(new Error('reply'), 'Write the reply.'); return }
    if (saveRef.current || saving) return
    saveRef.current = true; setSaving(true)
    const { error } = await supabase.from('campaign_bot_rules').update({ keywords, reply: editReply.trim(), updated_at: new Date().toISOString() }).eq('id', sel)
    if (error) toastError(error, 'Could not save.')
    else { toastSuccess('Saved.'); setRules((p) => p.map((x) => x.id === sel ? { ...x, keywords, reply: editReply.trim() } : x)) }
    setSaving(false); saveRef.current = false
  }

  async function delRule() {
    if (typeof sel !== 'string' || sel === 'greeting' || sel === 'handoff') return
    const ok = await confirmDialog({ title: 'Delete node?', message: 'Delete this auto-reply node?', confirmLabel: 'Delete', danger: true })
    if (!ok) return
    const { error } = await supabase.from('campaign_bot_rules').delete().eq('id', sel)
    if (error) { toastError(error, 'Could not delete.'); return }
    setRules((p) => p.filter((x) => x.id !== sel)); setSel('greeting'); toastSuccess('Node deleted.')
  }

  const refreshBtn = <button type="button" onClick={load} style={btnG}><RefreshCw size={14} strokeWidth={1.6} /> Refresh</button>
  const on = !!acct?.bot_enabled

  if (tablesMissing) {
    return (
      <CampaignChrome active="chatbot" title="Chatbot" right={refreshBtn}>
        <div style={banner}><AlertTriangle size={18} strokeWidth={1.6} style={{ color: 'var(--v2-amber, #F59E0B)', flexShrink: 0, marginTop: 1 }} />
          <div style={{ fontSize: 13, color: 'var(--v2-ink-1)' }}>Run <b style={{ color: 'var(--v2-ink-0)' }}>supabase_campaign_chatbot.sql</b>, then reload.</div></div>
      </CampaignChrome>
    )
  }

  // layout maths
  const handoffTop = 30 + rules.length * ROW_H + 12
  const canvasH = Math.max(560, handoffTop + 120)
  const greetY = 178
  const selRule = rules.find((x) => x.id === sel)

  return (
    <CampaignChrome active="chatbot" title="Chatbot"
      sub="Drag-free flow: each card answers a keyword. Click a card to edit it on the right. The bot pauses the moment a telecaller replies."
      right={(
        <div style={{ display: 'flex', gap: 8 }}>
          {refreshBtn}
          <button type="button" onClick={toggleBot} disabled={toggling} style={{ ...(on ? btnG : btnY), opacity: toggling ? 0.6 : 1 }}>
            {toggling ? <Loader2 size={14} strokeWidth={1.6} className="spin" /> : null} {on ? 'Bot ON · turn off' : 'Bot OFF · turn on'}
          </button>
        </div>
      )}>
      {loading ? (
        <div style={{ padding: 40, textAlign: 'center' }}><Loader2 size={20} strokeWidth={1.6} className="spin" style={{ color: 'var(--v2-yellow, #FFE600)' }} /></div>
      ) : (
        <div style={botwrap}>
          {/* rail */}
          <div style={rail}>
            <div title="Add a reply node" onClick={addNode} style={{ ...ri, ...riOn }}><Plus size={18} strokeWidth={1.8} /></div>
            {RAIL.map((Ic, i) => <div key={i} style={ri}><Ic size={18} strokeWidth={1.8} /></div>)}
          </div>

          {/* canvas */}
          <div style={canvas}>
            <div style={{ position: 'relative', width: 680, height: canvasH }}>
              <svg width="680" height={canvasH} style={{ position: 'absolute', left: 0, top: 0, zIndex: 1, pointerEvents: 'none' }} fill="none">
                {/* Start -> Greeting */}
                <path d={`M204,282 C220,282 214,${greetY} 232,${greetY}`} stroke="var(--v2-line, #2a3556)" strokeWidth="2" />
                {/* Greeting -> each rule */}
                {rules.map((r, i) => {
                  const y = 30 + i * ROW_H + 22
                  return <path key={r.id} d={`M${232 + NODE_W},${greetY} C452,${greetY} 452,${y} ${COL_X},${y}`} stroke="var(--v2-line, #2a3556)" strokeWidth="2" />
                })}
                {/* Greeting -> Handoff */}
                <path d={`M${232 + NODE_W},${greetY} C456,${greetY + 6} 456,${handoffTop + 22} ${COL_X},${handoffTop + 22}`} stroke="var(--v2-line, #2a3556)" strokeWidth="2" />
              </svg>

              {/* Start */}
              <Node x={14} y={236} kind="start" title="Start">QR scan or message in.</Node>
              {/* Greeting */}
              <Node x={232} y={128} kind="bot" selected={sel === 'greeting'} title="Greeting" onClick={() => setSel('greeting')}>
                {acct?.auto_reply_text || 'Welcome message (your auto-reply).'}
              </Node>
              {/* rule nodes */}
              {rules.map((r, i) => (
                <Node key={r.id} x={COL_X} y={30 + i * ROW_H} kind="act" selected={sel === r.id} title={(r.keywords || [])[0] || 'reply'} onClick={() => pickRule(r)}>
                  {(r.reply || '').slice(0, 70)}{(r.reply || '').length > 70 ? '…' : ''}
                </Node>
              ))}
              {rules.length === 0 && (
                <div style={{ position: 'absolute', left: COL_X, top: 60, width: NODE_W, fontSize: 12, color: 'var(--v2-ink-2)' }}>
                  Tap <b style={{ color: 'var(--v2-yellow, #FFE600)' }}>+</b> on the left to add your first reply node.
                </div>
              )}
              {/* Handoff */}
              <Node x={COL_X} y={handoffTop} kind="human" title="Human handoff">On &ldquo;talk to a person&rdquo; or a telecaller reply &rarr; bot stops.</Node>
            </div>
          </div>

          {/* properties */}
          <div style={props}>
            {selRule ? (
              <>
                <div style={ph}><span style={{ width: 9, height: 9, borderRadius: 3, background: 'var(--v2-ink-2)', display: 'inline-block' }} />Auto-reply node</div>
                <div style={psub}>Keyword block · sends a reply</div>
                <div style={plabel}>If the message contains (comma-separated)</div>
                <input style={pinp} value={editKw} onChange={(e) => setEditKw(e.target.value)} placeholder="rate, price, cost" />
                <div style={plabel}>Reply with</div>
                <textarea style={ptext} value={editReply} onChange={(e) => setEditReply(e.target.value)} />
                <div style={{ marginTop: 10 }}>
                  <label style={plabel}>Attach image / video / PDF (optional)</label>
                  {(() => {
                    const rr = rules.find((x) => x.id === sel)
                    return rr?.media_url ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12 }}>
                        <span style={{ color: 'var(--v2-green, #22c55e)', textTransform: 'capitalize' }}>{rr.media_type || 'file'} attached</span>
                        <a href={rr.media_url} target="_blank" rel="noreferrer" style={{ color: 'var(--v2-ink-2)' }}>view</a>
                        <button type="button" onClick={() => saveRuleMedia(null)} style={{ ...btnG, height: 28, padding: '0 10px', fontSize: 12 }}>{ruleMediaBusy ? '…' : 'Remove'}</button>
                      </div>
                    ) : (
                      <input type="file" accept="image/*,video/*,application/pdf" disabled={ruleMediaBusy}
                        onChange={(e) => e.target.files?.[0] && saveRuleMedia(e.target.files[0])}
                        style={{ ...pinp, padding: '7px 10px' }} />
                    )
                  })()}
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                  <button type="button" style={{ ...btnY, opacity: saving ? 0.6 : 1 }} onClick={saveRule} disabled={saving}>{saving ? <Loader2 size={14} strokeWidth={1.6} className="spin" /> : null} Save</button>
                  <button type="button" style={{ ...btnG, color: 'var(--v2-rose, #f87171)' }} onClick={delRule}><Trash2 size={14} strokeWidth={1.6} /></button>
                </div>
              </>
            ) : sel === 'greeting' ? (
              <>
                <div style={ph}><span style={{ width: 9, height: 9, borderRadius: 3, background: 'var(--v2-blue, #60a5fa)', display: 'inline-block' }} />Greeting</div>
                <div style={psub}>The first-message welcome</div>
                <div style={plabel}>Welcome message — auto-sent to everyone on their first message (free)</div>
                <textarea style={{ ...ptext, minHeight: 120 }} value={greetingText} onChange={(e) => setGreetingText(e.target.value)}
                  placeholder="Hi! Thanks for messaging Untitled Advertising. How can we help?" />
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10, flexWrap: 'wrap' }}>
                  <button type="button" style={{ ...btnY, opacity: savingGreet ? 0.6 : 1 }} onClick={saveGreeting} disabled={savingGreet}>{savingGreet ? <Loader2 size={14} strokeWidth={1.6} className="spin" /> : null} Save welcome</button>
                </div>
                <div style={{ marginTop: 10 }}>
                  <label style={plabel}>Image / video / PDF (optional — rides on top of the welcome)</label>
                  {acct?.auto_reply_media_url ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12 }}>
                      <span style={{ color: 'var(--v2-green, #22c55e)', textTransform: 'capitalize' }}>{acct.auto_reply_media_type || 'file'} attached</span>
                      <a href={acct.auto_reply_media_url} target="_blank" rel="noreferrer" style={{ color: 'var(--v2-ink-2)' }}>view</a>
                      <button type="button" onClick={() => saveGreetMedia(null)} style={{ ...btnG, height: 28, padding: '0 10px', fontSize: 12 }}>{greetMediaBusy ? '…' : 'Remove'}</button>
                    </div>
                  ) : (
                    <input type="file" accept="image/*,video/*,application/pdf" disabled={greetMediaBusy}
                      onChange={(e) => e.target.files?.[0] && saveGreetMedia(e.target.files[0])}
                      style={{ ...pinp, padding: '7px 10px' }} />
                  )}
                </div>
                {/* Phase 204 — tap-buttons: customer taps instead of typing */}
                <div style={{ marginTop: 14 }}>
                  <label style={plabel}>Buttons — customer taps instead of typing (up to 10)</label>
                  {buttons.map((b) => (
                    <div key={b.id} style={{ border: '1px solid var(--v2-line)', borderRadius: 10, padding: 10, marginBottom: 8, background: 'var(--v2-bg-2, #1a2742)' }}>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <input style={{ ...pinp, flex: 1 }} value={b.label || ''} maxLength={24}
                          onChange={(e) => setButtons((p) => p.map((x) => x.id === b.id ? { ...x, label: e.target.value } : x))}
                          onBlur={(e) => saveButton(b.id, { label: e.target.value.trim() || 'Button' })} placeholder="Rates" />
                        <button type="button" onClick={() => setSelBtn(selBtn === b.id ? null : b.id)} style={{ ...btnG, height: 30, padding: '0 10px', fontSize: 12 }}>{selBtn === b.id ? 'Close' : 'Edit'}</button>
                        <button type="button" onClick={() => delButton(b.id)} style={{ ...btnG, height: 30, padding: '0 8px', color: 'var(--v2-rose, #f87171)' }}><Trash2 size={13} strokeWidth={1.6} /></button>
                      </div>
                      {selBtn === b.id && (
                        <div style={{ marginTop: 10 }}>
                          <label style={plabel}>When tapped</label>
                          <select style={pinp} value={b.action || 'send'} onChange={(e) => saveButton(b.id, { action: e.target.value })}>
                            <option value="send">Send a reply</option>
                            <option value="handoff">Talk to a person (hand off)</option>
                          </select>
                          {b.action !== 'handoff' && (
                            <>
                              <label style={{ ...plabel, marginTop: 10 }}>Reply text</label>
                              <textarea style={{ ...ptext, minHeight: 70 }} value={b.reply_text || ''}
                                onChange={(e) => setButtons((p) => p.map((x) => x.id === b.id ? { ...x, reply_text: e.target.value } : x))}
                                onBlur={(e) => saveButton(b.id, { reply_text: e.target.value })} placeholder="Here are our rates…" />
                              <label style={{ ...plabel, marginTop: 10 }}>Attach image / video / PDF (optional)</label>
                              {b.media_url ? (
                                <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12 }}>
                                  <span style={{ color: 'var(--v2-green, #22c55e)', textTransform: 'capitalize' }}>{b.media_type || 'file'} attached</span>
                                  <a href={b.media_url} target="_blank" rel="noreferrer" style={{ color: 'var(--v2-ink-2)' }}>view</a>
                                  <button type="button" onClick={() => saveBtnMedia(b.id, null)} style={{ ...btnG, height: 26, padding: '0 10px', fontSize: 12 }}>Remove</button>
                                </div>
                              ) : (
                                <input type="file" accept="image/*,video/*,application/pdf" disabled={btnBusy}
                                  onChange={(e) => e.target.files?.[0] && saveBtnMedia(b.id, e.target.files[0])} style={{ ...pinp, padding: '7px 10px' }} />
                              )}
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                  <button type="button" onClick={addButton} style={btnG}>+ Add button</button>
                  <div style={{ fontSize: 11, color: 'var(--v2-ink-2)', marginTop: 6 }}>1-3 buttons show as tap buttons; 4-10 as a pick-list. The welcome text + media above ride along.</div>
                </div>
                <div style={{ ...toggle, marginTop: 14 }}><span>Welcome reply is {acct?.auto_reply_enabled ? 'ON' : 'OFF'}</span>
                  <button type="button" onClick={toggleWelcome} style={{ ...sw, background: acct?.auto_reply_enabled ? 'var(--v2-green, #22c55e)' : 'var(--v2-bg-3)' }}><span style={{ ...swDot, [acct?.auto_reply_enabled ? 'right' : 'left']: 2 }} /></button>
                </div>
                <div style={{ fontSize: 11, color: 'var(--v2-ink-2)', marginTop: 8 }}>Below: keyword answers (need the chatbot ON). The welcome above fires on the first message regardless.</div>
                <div style={{ ...toggle, marginTop: 16 }}><span>Bot is {on ? 'ON' : 'OFF'}</span>
                  <button type="button" onClick={toggleBot} style={{ ...sw, background: on ? 'var(--v2-green, #22c55e)' : 'var(--v2-bg-3)' }}><span style={{ ...swDot, [on ? 'right' : 'left']: 2 }} /></button>
                </div>
              </>
            ) : (
              <>
                <div style={ph}><span style={{ width: 9, height: 9, borderRadius: 3, background: 'var(--v2-yellow, #FFE600)', display: 'inline-block' }} />Human handoff</div>
                <div style={psub}>Automatic</div>
                <div style={{ fontSize: 12, color: 'var(--v2-ink-1)', lineHeight: 1.6, marginTop: 10 }}>When a telecaller sends a reply in a chat, the bot stops for that chat — no double-messages. Nothing to configure.</div>
              </>
            )}
          </div>
        </div>
      )}
      <style>{`@keyframes spin{to{transform:rotate(360deg)}} .spin{animation:spin 1s linear infinite}`}</style>
    </CampaignChrome>
  )
}

function Node({ x, y, kind, title, selected, onClick, children }) {
  const dot = { start: 'var(--v2-green, #22c55e)', bot: 'var(--v2-blue, #60a5fa)', act: 'var(--v2-ink-2)', human: 'var(--v2-yellow, #FFE600)' }[kind]
  const hColor = { start: 'var(--v2-green, #22c55e)', bot: 'var(--v2-blue, #60a5fa)', act: 'var(--v2-ink-0)', human: 'var(--v2-yellow, #FFE600)' }[kind]
  return (
    <div onClick={onClick} style={{
      position: 'absolute', left: x, top: y, width: NODE_W, zIndex: 2, cursor: onClick ? 'pointer' : 'default',
      background: 'var(--v2-bg-1, #0f1525)', borderRadius: 12,
      border: `1px solid ${selected || kind === 'human' ? 'var(--v2-yellow, #FFE600)' : 'var(--v2-line, #2a3556)'}`,
      boxShadow: selected ? '0 0 0 2px var(--v2-tint-yellow, rgba(255,230,0,0.14)), 0 10px 28px rgba(0,0,0,.5)' : '0 8px 24px rgba(0,0,0,.4)',
    }}>
      <div style={{ padding: '9px 12px', borderBottom: '1px solid var(--v2-line)', fontSize: 12, fontWeight: 700, color: hColor, display: 'flex', alignItems: 'center', gap: 7 }}>
        <span style={{ width: 8, height: 8, borderRadius: 3, background: dot, flexShrink: 0 }} />{title}
      </div>
      <div style={{ padding: '10px 12px', fontSize: 11.5, color: 'var(--v2-ink-1)', lineHeight: 1.45 }}>{children}</div>
    </div>
  )
}

const banner = { border: '1px solid var(--v2-amber, #F59E0B)', borderRadius: 14, padding: 18, background: 'var(--v2-amber-soft, rgba(245,158,11,0.12))', display: 'flex', gap: 10, alignItems: 'flex-start' }
const botwrap = { display: 'flex', border: '1px solid var(--v2-line, #1f2b47)', borderRadius: 14, overflow: 'hidden', background: 'var(--v2-bg-1, #0f1525)', minHeight: 560 }
const rail = { width: 54, borderRight: '1px solid var(--v2-line)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: '14px 0', background: 'var(--v2-bg-2, #1a2742)', flexShrink: 0 }
const ri = { width: 38, height: 38, borderRadius: 10, border: '1px solid var(--v2-line)', background: 'var(--v2-bg-1)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--v2-ink-2)', cursor: 'pointer' }
const riOn = { color: 'var(--accent-fg, #0b1220)', background: 'var(--v2-yellow, #FFE600)', borderColor: 'transparent' }
const canvas = { flex: 1, position: 'relative', overflow: 'auto', backgroundColor: 'var(--v2-bg-0, #0b1222)', backgroundImage: 'radial-gradient(var(--v2-line, #1f2b47) 1px, transparent 1px)', backgroundSize: '22px 22px' }
const props = { width: 296, borderLeft: '1px solid var(--v2-line)', background: 'var(--v2-bg-1, #0f1525)', padding: 18, overflow: 'auto', flexShrink: 0 }
const ph = { fontFamily: 'var(--v2-display)', fontSize: 15, fontWeight: 600, color: 'var(--v2-ink-0)', display: 'flex', alignItems: 'center', gap: 8 }
const psub = { fontSize: 11, color: 'var(--v2-ink-2)', margin: '3px 0 14px' }
const plabel = { fontSize: 10, color: 'var(--v2-ink-2)', textTransform: 'uppercase', letterSpacing: '.08em', fontWeight: 600, margin: '16px 0 6px' }
const pinp = { width: '100%', height: 38, padding: '0 11px', background: 'var(--v2-bg-2, #1a2742)', border: '1px solid var(--v2-line)', borderRadius: 8, color: 'var(--v2-ink-0)', fontSize: 12.5, outline: 'none', fontFamily: 'inherit' }
const ptext = { width: '100%', minHeight: 80, background: 'var(--v2-bg-2, #1a2742)', border: '1px solid var(--v2-line)', borderRadius: 8, color: 'var(--v2-ink-0)', fontFamily: 'inherit', fontSize: 12.5, padding: '9px 11px', outline: 'none', resize: 'vertical', boxSizing: 'border-box' }
const toggle = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 12, color: 'var(--v2-ink-1)', padding: '10px 0', borderTop: '1px solid var(--v2-line)' }
const sw = { width: 34, height: 20, borderRadius: 999, position: 'relative', flexShrink: 0, border: 'none', cursor: 'pointer', padding: 0 }
const swDot = { content: '""', position: 'absolute', top: 2, width: 16, height: 16, borderRadius: 999, background: '#fff' }
const btnY = { background: 'var(--v2-yellow, #FFE600)', color: 'var(--accent-fg, #0b1220)', border: 'none', borderRadius: 10, height: 38, padding: '0 16px', fontWeight: 700, fontSize: 13, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }
const btnG = { background: 'transparent', color: 'var(--v2-ink-1, #a9b3c7)', border: '1px solid var(--v2-line, #1f2b47)', borderRadius: 10, height: 38, padding: '0 14px', fontWeight: 600, fontSize: 13, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }
