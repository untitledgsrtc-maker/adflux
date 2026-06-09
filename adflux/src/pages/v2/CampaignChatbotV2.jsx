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
                <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                  <button type="button" style={{ ...btnY, opacity: saving ? 0.6 : 1 }} onClick={saveRule} disabled={saving}>{saving ? <Loader2 size={14} strokeWidth={1.6} className="spin" /> : null} Save</button>
                  <button type="button" style={{ ...btnG, color: 'var(--v2-rose, #f87171)' }} onClick={delRule}><Trash2 size={14} strokeWidth={1.6} /></button>
                </div>
              </>
            ) : sel === 'greeting' ? (
              <>
                <div style={ph}><span style={{ width: 9, height: 9, borderRadius: 3, background: 'var(--v2-blue, #60a5fa)', display: 'inline-block' }} />Greeting</div>
                <div style={psub}>The first-message welcome</div>
                <div style={plabel}>Welcome message (your auto-reply)</div>
                <div style={{ ...ptext, minHeight: 'auto', padding: '10px 11px', color: 'var(--v2-ink-1)', whiteSpace: 'pre-wrap' }}>{acct?.auto_reply_text || 'Set via the auto-reply config.'}</div>
                <div style={{ fontSize: 11, color: 'var(--v2-ink-2)', marginTop: 8 }}>Edit the welcome in the auto-reply config (DB). Add answer nodes with <b style={{ color: 'var(--v2-yellow, #FFE600)' }}>+</b>.</div>
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
