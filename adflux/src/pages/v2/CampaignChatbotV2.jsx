// src/pages/v2/CampaignChatbotV2.jsx
//
// Campaign Module — Chatbot. A reliable keyword auto-responder: when ON, an
// inbound message matching a rule's keywords gets that rule's reply (sent by
// the webhook, free-form in-window). It PAUSES the moment a human (telecaller)
// replies in that chat — so the customer never gets bot + human double-msgs.
//
// §45-safe: new admin page. Reads/writes the campaign_bot_rules table + the
// active whatsapp_accounts row's bot_enabled flag. No live-app table touched.

import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Loader2, AlertTriangle, Plus, Trash2, Bot, RefreshCw, MessageSquare,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/authStore'
import CampaignChrome from '../../components/v2/CampaignChrome'
import { toastError, toastSuccess } from '../../components/v2/Toast'
import { confirmDialog } from '../../components/v2/ConfirmDialog'

const SAMPLES = [
  { kw: 'rate, price, cost', reply: 'Our rate card depends on the location + duration. Share your city and we will send options right away.' },
  { kw: 'photo, image, pic', reply: 'Here are some of our hoarding / LED sites — our team will share photos for your area shortly.' },
  { kw: 'location, where, area', reply: 'We cover Ahmedabad, Vadodara, Surat, Rajkot and more. Which city are you looking at?' },
]

export default function CampaignChatbotV2() {
  const profile = useAuthStore((s) => s.profile)
  const [loading, setLoading] = useState(true)
  const [tablesMissing, setTablesMissing] = useState(false)
  const [acct, setAcct] = useState(null)
  const [rules, setRules] = useState([])
  const [kw, setKw] = useState('')
  const [reply, setReply] = useState('')
  const [saving, setSaving] = useState(false)
  const [toggling, setToggling] = useState(false)
  const saveRef = useRef(false)

  const load = useCallback(async () => {
    setLoading(true)
    const { data: a } = await supabase.from('whatsapp_accounts')
      .select('*').eq('is_active', true).order('created_at', { ascending: true }).limit(1).maybeSingle()
    setAcct(a || null)
    const { data: r, error } = await supabase.from('campaign_bot_rules')
      .select('id, keywords, reply, is_active, display_order').order('display_order', { ascending: true })
    if (error) {
      if (/relation .* does not exist|could not find the table/i.test(error.message || '')) setTablesMissing(true)
      else toastError(error, 'Could not load bot rules.')
      setLoading(false); return
    }
    setRules(r || [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  async function toggleBot() {
    if (!acct?.id) { toastError(new Error('acct'), 'No active WhatsApp number to attach the bot to.'); return }
    setToggling(true)
    const next = !acct.bot_enabled
    const { error } = await supabase.from('whatsapp_accounts').update({ bot_enabled: next }).eq('id', acct.id)
    if (error) { toastError(error, 'Could not switch the bot.'); setToggling(false); return }
    setAcct({ ...acct, bot_enabled: next })
    toastSuccess(next ? 'Chatbot ON.' : 'Chatbot OFF.')
    setToggling(false)
  }

  async function addRule(presetKw, presetReply) {
    const keywords = (presetKw ?? kw).split(',').map((s) => s.trim()).filter(Boolean)
    const rep = (presetReply ?? reply).trim()
    if (!keywords.length) { toastError(new Error('kw'), 'Add at least one keyword.'); return }
    if (!rep) { toastError(new Error('reply'), 'Write the reply.'); return }
    if (saveRef.current || saving) return
    saveRef.current = true; setSaving(true)
    const { error } = await supabase.from('campaign_bot_rules').insert({
      keywords, reply: rep, display_order: rules.length, created_by: profile?.id || null,
    })
    if (error) { toastError(error, 'Could not add the rule.') }
    else { toastSuccess('Rule added.'); if (presetKw == null) { setKw(''); setReply('') }; load() }
    setSaving(false); saveRef.current = false
  }

  async function delRule(rule) {
    const ok = await confirmDialog({ title: 'Delete rule?', message: `Delete the reply for "${(rule.keywords || []).join(', ')}"?`, confirmLabel: 'Delete', danger: true })
    if (!ok) return
    const { error } = await supabase.from('campaign_bot_rules').delete().eq('id', rule.id)
    if (error) { toastError(error, 'Could not delete.'); return }
    toastSuccess('Rule deleted.'); load()
  }

  const refreshBtn = <button type="button" onClick={load} style={btnG}><RefreshCw size={14} strokeWidth={1.6} /> Refresh</button>

  if (tablesMissing) {
    return (
      <CampaignChrome active="chatbot" title="Chatbot" right={refreshBtn}>
        <div style={banner}>
          <AlertTriangle size={18} strokeWidth={1.6} style={{ color: 'var(--v2-amber, #F59E0B)', flexShrink: 0, marginTop: 1 }} />
          <div style={{ fontSize: 13, color: 'var(--v2-ink-1)' }}>Run <b style={{ color: 'var(--v2-ink-0)' }}>supabase_campaign_chatbot.sql</b> in Supabase Studio, then reload.</div>
        </div>
      </CampaignChrome>
    )
  }

  const on = !!acct?.bot_enabled

  return (
    <CampaignChrome
      active="chatbot"
      title="Chatbot"
      sub="Auto-answer common questions on WhatsApp. It pauses the moment your telecaller replies — no double-messages."
      right={refreshBtn}
    >
      {loading ? (
        <div style={{ padding: 40, textAlign: 'center' }}><Loader2 size={20} strokeWidth={1.6} className="spin" style={{ color: 'var(--v2-yellow, #FFE600)' }} /></div>
      ) : (
        <>
          {/* on/off */}
          <div style={{ ...panel, marginBottom: 18, display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
            <span style={{ width: 44, height: 44, borderRadius: 12, background: on ? 'var(--v2-green-soft, rgba(34,197,94,0.14))' : 'var(--v2-bg-2, #1a2742)', color: on ? 'var(--v2-green, #22c55e)' : 'var(--v2-ink-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <Bot size={22} strokeWidth={1.6} />
            </span>
            <div style={{ flex: 1, minWidth: 180 }}>
              <div style={{ fontFamily: 'var(--v2-display)', fontWeight: 700, fontSize: 15, color: 'var(--v2-ink-0)' }}>Chatbot is {on ? 'ON' : 'OFF'}</div>
              <div style={{ fontSize: 12.5, color: 'var(--v2-ink-2)', marginTop: 2 }}>{on ? 'Answering keyword questions until a human replies.' : 'Switch on to auto-answer keyword questions.'}</div>
            </div>
            <button type="button" onClick={toggleBot} disabled={toggling} style={{ ...(on ? btnG : btnY), opacity: toggling ? 0.6 : 1 }}>
              {toggling ? <Loader2 size={14} strokeWidth={1.6} className="spin" /> : null} {on ? 'Turn off' : 'Turn on'}
            </button>
          </div>

          {/* add rule */}
          <div style={{ ...panel, marginBottom: 18 }}>
            <div style={{ fontFamily: 'var(--v2-display)', fontWeight: 600, color: 'var(--v2-ink-0)', fontSize: 14, marginBottom: 12 }}>Add an auto-reply</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
              <div>
                <label style={lbl}>If the message contains (comma-separated)</label>
                <input style={inp} value={kw} onChange={(e) => setKw(e.target.value)} placeholder="rate, price, cost" />
              </div>
              <div>
                <label style={lbl}>Reply with</label>
                <input style={inp} value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Our rate card depends on…" />
              </div>
            </div>
            <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <button type="button" style={{ ...btnY, opacity: saving ? 0.6 : 1 }} onClick={() => addRule()} disabled={saving}>
                {saving ? <Loader2 size={14} strokeWidth={1.6} className="spin" /> : <Plus size={14} strokeWidth={1.6} />} Add reply
              </button>
              {rules.length === 0 && (
                <span style={{ fontSize: 11.5, color: 'var(--v2-ink-2)' }}>
                  or add a sample:&nbsp;
                  {SAMPLES.map((s, i) => (
                    <button key={i} type="button" onClick={() => addRule(s.kw, s.reply)} style={chipBtn}>{s.kw.split(',')[0]}</button>
                  ))}
                </span>
              )}
            </div>
          </div>

          {/* rules list */}
          <div style={{ ...panel, padding: 0 }}>
            <div style={{ padding: '13px 18px', borderBottom: '1px solid var(--v2-line)', fontFamily: 'var(--v2-display)', fontWeight: 600, color: 'var(--v2-ink-0)', fontSize: 14 }}>
              Auto-replies{rules.length ? ` · ${rules.length}` : ''}
            </div>
            {rules.length === 0 ? (
              <div style={{ padding: 40, textAlign: 'center', color: 'var(--v2-ink-2)', fontSize: 13 }}>
                <MessageSquare size={22} strokeWidth={1.6} style={{ opacity: 0.5 }} />
                <div style={{ marginTop: 8 }}>No auto-replies yet. Add one above (or a sample) to teach the bot.</div>
              </div>
            ) : rules.map((r) => (
              <div key={r.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '14px 18px', borderBottom: '1px solid var(--v2-line)' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 6 }}>
                    {(r.keywords || []).map((k, i) => <span key={i} style={kwChip}>{k}</span>)}
                  </div>
                  <div style={{ fontSize: 12.5, color: 'var(--v2-ink-1)', lineHeight: 1.5 }}>{r.reply}</div>
                </div>
                <button type="button" title="Delete" onClick={() => delRule(r)} style={{ ...btnG, height: 32, padding: '0 8px', color: 'var(--v2-rose, #f87171)', flexShrink: 0 }}>
                  <Trash2 size={14} strokeWidth={1.6} />
                </button>
              </div>
            ))}
          </div>

          <p style={{ fontSize: 11.5, color: 'var(--v2-ink-2)', margin: '14px 0 0', lineHeight: 1.6 }}>
            The first-message welcome is your <b style={{ color: 'var(--v2-ink-1)' }}>auto-reply</b> (set in the database). These rules answer the follow-on questions and stop the instant a telecaller replies in the chat.
          </p>
        </>
      )}

      <style>{`@keyframes spin{to{transform:rotate(360deg)}} .spin{animation:spin 1s linear infinite}`}</style>
    </CampaignChrome>
  )
}

const panel = { background: 'var(--v2-bg-1, #0f1525)', border: '1px solid var(--v2-line, #1f2b47)', borderRadius: 14, padding: 18 }
const banner = { ...panel, borderColor: 'var(--v2-amber, #F59E0B)', background: 'var(--v2-amber-soft, rgba(245,158,11,0.12))', display: 'flex', gap: 10, alignItems: 'flex-start' }
const lbl = { fontSize: 11, color: 'var(--v2-ink-2, #6a7590)', textTransform: 'uppercase', letterSpacing: '.08em', fontWeight: 600, marginBottom: 6, display: 'block' }
const inp = { width: '100%', height: 38, padding: '0 12px', background: 'var(--v2-bg-2, #1a2742)', border: '1px solid var(--v2-line, #1f2b47)', borderRadius: 10, color: 'var(--v2-ink-0, #f5f7fb)', fontSize: 13, outline: 'none', fontFamily: 'inherit' }
const btnY = { background: 'var(--v2-yellow, #FFE600)', color: 'var(--accent-fg, #0b1220)', border: 'none', borderRadius: 10, height: 38, padding: '0 16px', fontWeight: 700, fontSize: 13, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }
const btnG = { background: 'transparent', color: 'var(--v2-ink-1, #a9b3c7)', border: '1px solid var(--v2-line, #1f2b47)', borderRadius: 10, height: 38, padding: '0 14px', fontWeight: 600, fontSize: 13, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }
const kwChip = { fontSize: 11.5, fontWeight: 600, padding: '2px 9px', borderRadius: 999, background: 'var(--v2-tint-yellow, rgba(255,230,0,0.14))', color: 'var(--v2-yellow, #FFE600)' }
const chipBtn = { fontSize: 11, fontWeight: 600, padding: '2px 9px', borderRadius: 999, border: '1px solid var(--v2-line)', background: 'var(--v2-bg-2)', color: 'var(--v2-ink-1)', cursor: 'pointer', marginRight: 4 }
