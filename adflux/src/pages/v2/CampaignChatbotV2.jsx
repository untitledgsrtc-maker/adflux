// src/pages/v2/CampaignChatbotV2.jsx
//
// Campaign Module — Chatbot BUILDER (real branching flow, Phase B).
//
// A true node-graph editor on react-flow: drag typed blocks from the rail,
// connect their ports, edit each node in the right panel. The whole graph is
// stored as react-flow-shaped JSON in campaign_bot_flows.draft_flow (Phase A,
// C12). On first open with no draft, it SEEDS the graph from the existing
// greeting (whatsapp_accounts.auto_reply_*) + keyword rules
// (campaign_bot_rules) + buttons (campaign_bot_buttons) so nothing is lost.
//
// Node types (v1): start / message / buttons / keyword / action / handoff.
// A buttons node exposes one output PORT per button (Handle id "btn_<i>");
// each button either wires to a target node (edge) or sends its inline reply.
//
// §45-safe: admin-only page. Writes campaign_bot_flows.draft_flow + the
// campaign-media bucket. The LIVE bot still runs off the old flat tables
// (campaign_bot_rules + auto_reply_*) — the runtime switches to this graph
// only when Phase C is wired + the flow is Published. So editing here cannot
// break the live customer bot.

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import ReactFlow, {
  Background, Controls, addEdge, useNodesState, useEdgesState, Handle, Position, MarkerType,
} from 'reactflow'
import 'reactflow/dist/style.css'
import {
  Loader2, AlertTriangle, MessageSquare, MousePointerClick, Search, Zap, LogOut,
  Plus, Trash2, RefreshCw, UploadCloud,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/authStore'
import CampaignChrome from '../../components/v2/CampaignChrome'
import { toastError, toastSuccess } from '../../components/v2/Toast'
import { confirmDialog } from '../../components/v2/ConfirmDialog'
import MediaPicker from '../../components/campaign/MediaPicker'

// ─── ids + media helpers ─────────────────────────────────────────────
let _seq = 0
function uid(prefix = 'n') {
  // App-side id (the Date.now/Math.random ban is workflow-scripts only).
  _seq += 1
  return `${prefix}_${Date.now().toString(36)}${_seq}${Math.random().toString(36).slice(2, 6)}`
}
// The palette the rail offers. type = the node type inserted.
const BLOCKS = [
  { type: 'message', label: 'Message', Icon: MessageSquare, tint: 'var(--v2-blue, #60a5fa)' },
  { type: 'buttons', label: 'Buttons', Icon: MousePointerClick, tint: 'var(--v2-yellow, #FFE600)' },
  { type: 'keyword', label: 'Keyword', Icon: Search, tint: 'var(--v2-green, #22c55e)' },
  { type: 'action', label: 'Action', Icon: Zap, tint: 'var(--v2-amber, #F59E0B)' },
  { type: 'handoff', label: 'Handoff', Icon: LogOut, tint: 'var(--v2-rose, #f87171)' },
]

const TITLE = {
  start: 'Start', message: 'Message', buttons: 'Buttons',
  keyword: 'Keyword', action: 'Action', handoff: 'Human handoff',
}
const DOT = {
  start: 'var(--v2-green, #22c55e)', message: 'var(--v2-blue, #60a5fa)',
  buttons: 'var(--v2-yellow, #FFE600)', keyword: 'var(--v2-green, #22c55e)',
  action: 'var(--v2-amber, #F59E0B)', handoff: 'var(--v2-rose, #f87171)',
}

// ─── node card shell ─────────────────────────────────────────────────
function Shell({ type, selected, children, showTarget = true, showSource = true }) {
  return (
    <div style={{
      width: 210, background: 'var(--v2-bg-1, #0f1525)', borderRadius: 12,
      border: `1px solid ${selected ? 'var(--v2-yellow, #FFE600)' : 'var(--v2-line, #2a3556)'}`,
      boxShadow: selected ? '0 0 0 2px rgba(255,230,0,0.16), 0 10px 28px rgba(0,0,0,.5)' : '0 8px 24px rgba(0,0,0,.4)',
    }}>
      {showTarget && <Handle type="target" position={Position.Left} style={handleStyle} />}
      <div style={{
        padding: '8px 11px', borderBottom: '1px solid var(--v2-line)', fontSize: 12, fontWeight: 700,
        color: DOT[type] === 'var(--v2-yellow, #FFE600)' ? 'var(--v2-ink-0)' : DOT[type],
        display: 'flex', alignItems: 'center', gap: 7,
      }}>
        <span style={{ width: 8, height: 8, borderRadius: 3, background: DOT[type], flexShrink: 0 }} />
        {TITLE[type]}
      </div>
      <div style={{ padding: '9px 11px', fontSize: 11.5, color: 'var(--v2-ink-1)', lineHeight: 1.45, wordBreak: 'break-word' }}>
        {children}
      </div>
      {showSource && <Handle type="source" position={Position.Right} style={handleStyle} />}
    </div>
  )
}
const handleStyle = { width: 10, height: 10, background: 'var(--v2-yellow, #FFE600)', border: '2px solid var(--v2-bg-0, #0b1222)' }

function clip(s, n = 84) { s = s || ''; return s.length > n ? s.slice(0, n) + '…' : s }

function StartNode({ selected }) {
  return <Shell type="start" selected={selected} showTarget={false}>Customer&rsquo;s first message / QR scan lands here.</Shell>
}
function MessageNode({ data, selected }) {
  return <Shell type="message" selected={selected}>
    {data?.media_url && <span style={mediaTag}>{data.media_type || 'file'}</span>}
    {clip(data?.text) || <i style={{ color: 'var(--v2-ink-2)' }}>Empty message…</i>}
  </Shell>
}
function KeywordNode({ data, selected }) {
  return <Shell type="keyword" selected={selected}>
    <div style={{ color: 'var(--v2-green, #22c55e)', fontSize: 11, marginBottom: 3 }}>
      if contains: {(data?.keywords || []).join(', ') || '—'}
    </div>
    {clip(data?.reply, 60) || <i style={{ color: 'var(--v2-ink-2)' }}>reply…</i>}
  </Shell>
}
function ActionNode({ data, selected }) {
  const kindLabel = { send_media: 'Send media', create_lead: 'Create lead', handoff: 'Hand off' }[data?.kind] || 'Action'
  return <Shell type="action" selected={selected} showSource={data?.kind !== 'handoff'}>
    <b style={{ color: 'var(--v2-amber, #F59E0B)' }}>{kindLabel}</b>
    {data?.text ? <div style={{ marginTop: 3 }}>{clip(data.text, 60)}</div> : null}
  </Shell>
}
function HandoffNode({ selected }) {
  return <Shell type="handoff" selected={selected} showSource={false}>Stop the bot &rarr; hand to a telecaller.</Shell>
}
// Buttons node: one output Handle per button (id btn_<i>), stacked on the right.
function ButtonsNode({ data, selected }) {
  const btns = data?.buttons || []
  return (
    <div style={{
      width: 210, background: 'var(--v2-bg-1, #0f1525)', borderRadius: 12,
      border: `1px solid ${selected ? 'var(--v2-yellow, #FFE600)' : 'var(--v2-line, #2a3556)'}`,
      boxShadow: selected ? '0 0 0 2px rgba(255,230,0,0.16), 0 10px 28px rgba(0,0,0,.5)' : '0 8px 24px rgba(0,0,0,.4)',
    }}>
      <Handle type="target" position={Position.Left} style={handleStyle} />
      <div style={{ padding: '8px 11px', borderBottom: '1px solid var(--v2-line)', fontSize: 12, fontWeight: 700, color: 'var(--v2-ink-0)', display: 'flex', alignItems: 'center', gap: 7 }}>
        <span style={{ width: 8, height: 8, borderRadius: 3, background: DOT.buttons, flexShrink: 0 }} />Buttons
      </div>
      <div style={{ padding: '9px 11px', fontSize: 11.5, color: 'var(--v2-ink-1)', lineHeight: 1.4 }}>
        {data?.media_url && <span style={mediaTag}>{data.media_type || 'file'}</span>}
        {clip(data?.text, 60) || <i style={{ color: 'var(--v2-ink-2)' }}>prompt…</i>}
      </div>
      <div style={{ borderTop: '1px solid var(--v2-line)' }}>
        {btns.length === 0 && <div style={{ padding: '7px 11px', fontSize: 11, color: 'var(--v2-ink-2)' }}>No buttons yet</div>}
        {btns.map((b, i) => (
          <div key={i} style={{ position: 'relative', padding: '7px 11px', fontSize: 11.5, color: 'var(--v2-ink-0)', borderTop: i ? '1px solid var(--v2-line)' : 'none' }}>
            {b.label || `Button ${i + 1}`}
            <Handle type="source" id={`btn_${i}`} position={Position.Right} style={{ ...handleStyle, top: '50%' }} />
          </div>
        ))}
      </div>
    </div>
  )
}
const mediaTag = { display: 'inline-block', fontSize: 9.5, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--v2-green, #22c55e)', border: '1px solid var(--v2-green, #22c55e)', borderRadius: 5, padding: '0 5px', marginRight: 6, marginBottom: 4 }

const nodeTypes = { start: StartNode, message: MessageNode, buttons: ButtonsNode, keyword: KeywordNode, action: ActionNode, handoff: HandoffNode }

// ─── seed a graph from the existing flat bot (lossless migration) ────
function seedFlow(acct, rules, buttons) {
  const nodes = [{ id: 'start', type: 'start', position: { x: 40, y: 240 }, data: {} }]
  const edges = []
  const greetId = uid('greet')
  const hasButtons = (buttons || []).length > 0
  nodes.push({
    id: greetId, type: hasButtons ? 'buttons' : 'message', position: { x: 320, y: 200 },
    data: {
      text: acct?.auto_reply_text || '',
      media_url: acct?.auto_reply_media_url || null,
      media_type: acct?.auto_reply_media_type || null,
      buttons: (buttons || []).map((b) => ({
        label: b.label || 'Button', reply_text: b.reply_text || '',
        media_url: b.media_url || null, media_type: b.media_type || null,
        action: b.action || 'send',
      })),
    },
  })
  edges.push({ id: uid('e'), source: 'start', target: greetId, markerEnd: { type: MarkerType.ArrowClosed } })
  ;(rules || []).forEach((r, i) => {
    const rid = uid('kw')
    nodes.push({
      id: rid, type: 'keyword', position: { x: 640, y: 40 + i * 150 },
      data: { keywords: r.keywords || [], reply: r.reply || '', media_url: r.media_url || null, media_type: r.media_type || null },
    })
    edges.push({ id: uid('e'), source: greetId, target: rid, markerEnd: { type: MarkerType.ArrowClosed } })
  })
  const hId = uid('handoff')
  nodes.push({ id: hId, type: 'handoff', position: { x: 640, y: 40 + (rules || []).length * 150 }, data: {} })
  edges.push({ id: uid('e'), source: greetId, target: hId, markerEnd: { type: MarkerType.ArrowClosed } })
  return { nodes, edges }
}

// strip react-flow runtime fields before persisting
function serialize(nodes, edges) {
  return {
    nodes: nodes.map((n) => ({ id: n.id, type: n.type, position: n.position, data: n.data || {} })),
    edges: edges.map((e) => ({ id: e.id, source: e.source, sourceHandle: e.sourceHandle || null, target: e.target, targetHandle: e.targetHandle || null })),
  }
}

export default function CampaignChatbotV2() {
  const profile = useAuthStore((s) => s.profile)
  const [loading, setLoading] = useState(true)
  const [tablesMissing, setTablesMissing] = useState(false)
  const [acct, setAcct] = useState(null)
  const [flows, setFlows] = useState([])       // C14 — [{id,name,is_published}] per number
  const [flowId, setFlowId] = useState(null)   // the flow currently being edited
  const [curName, setCurName] = useState('')   // editable name of the current flow
  const [nodes, setNodes, onNodesChange] = useNodesState([])
  const [edges, setEdges, onEdgesChange] = useEdgesState([])
  const [selId, setSelId] = useState(null)
  const [saving, setSaving] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [toggling, setToggling] = useState(false)
  const readyRef = useRef(false)      // guards autosave from firing during load
  const saveTimer = useRef(null)

  // Load a flow row's graph JSON into the canvas. Disarms autosave so the load
  // itself isn't written back; re-arms after two frames.
  const loadIntoCanvas = useCallback((flowRow) => {
    readyRef.current = false
    setFlowId(flowRow?.id || null)
    setCurName(flowRow?.name || '')
    const g = flowRow?.draft_flow && Array.isArray(flowRow.draft_flow.nodes) && flowRow.draft_flow.nodes.length
      ? flowRow.draft_flow : { nodes: [], edges: [] }
    setNodes((g.nodes || []).map((n) => ({ ...n })))
    setEdges((g.edges || []).map((e) => ({ ...e, markerEnd: e.markerEnd || { type: MarkerType.ArrowClosed } })))
    setSelId(null)
    setTimeout(() => { readyRef.current = true }, 400)
  }, [setNodes, setEdges])

  // Build a starter graph from the existing flat bot (lossless) — tolerant of
  // un-run tables.
  async function seedFromExisting(a) {
    let rules = []
    const rr = await supabase.from('campaign_bot_rules')
      .select('id, keywords, reply, media_url, media_type, display_order').order('display_order', { ascending: true })
    if (!rr.error) rules = rr.data || []
    let btns = []
    const bb = await supabase.from('campaign_bot_buttons')
      .select('label, position, action, reply_text, media_url, media_type').eq('whatsapp_account_id', a.id).order('position', { ascending: true })
    if (!bb.error) btns = bb.data || []
    return seedFlow(a, rules, btns)
  }

  const load = useCallback(async () => {
    setLoading(true); readyRef.current = false
    const { data: a } = await supabase.from('whatsapp_accounts')
      .select('*').eq('is_active', true).order('created_at', { ascending: true }).limit(1).maybeSingle()
    setAcct(a || null)
    if (!a?.id) { setLoading(false); return }

    // C14 — all flows for this number.
    let list = null
    const r1 = await supabase.from('campaign_bot_flows')
      .select('id, name, is_published, draft_flow').eq('account_id', a.id).order('created_at', { ascending: true })
    if (r1.error && /relation .* does not exist|could not find the table/i.test(r1.error.message || '')) {
      setTablesMissing(true); setLoading(false); return
    }
    if (r1.error && /name|is_published|could not find|column/i.test(r1.error.message || '')) {
      // pre-C14 (no name/is_published columns) — degrade to a single 'Main'.
      const r2 = await supabase.from('campaign_bot_flows').select('id, draft_flow').eq('account_id', a.id)
      list = (r2.data || []).map((x) => ({ ...x, name: 'Main', is_published: false }))
    } else {
      list = r1.data || []
    }

    if (!list.length) {
      const graph = await seedFromExisting(a)
      const ins = await supabase.from('campaign_bot_flows')
        .insert({ account_id: a.id, name: 'Main', draft_flow: graph })
        .select('id, name, is_published, draft_flow').maybeSingle()
      list = ins.data ? [ins.data] : [{ id: null, name: 'Main', is_published: false, draft_flow: graph }]
    }
    setFlows(list.map((f) => ({ id: f.id, name: f.name, is_published: !!f.is_published })))
    loadIntoCanvas(list.find((f) => f.is_published) || list[0])
    setLoading(false)
  }, [loadIntoCanvas])
  useEffect(() => { load() }, [load])

  // ── autosave draft (debounced) ──
  const saveDraft = useCallback(async () => {
    if (!acct?.id || !flowId) return
    setSaving(true)
    const { error } = await supabase.from('campaign_bot_flows')
      .update({ draft_flow: serialize(nodes, edges) }).eq('id', flowId)
    if (error) toastError(error, 'Could not save the flow.')
    setSaving(false)
  }, [acct?.id, flowId, nodes, edges])

  useEffect(() => {
    if (!readyRef.current) return
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(saveDraft, 800)
    return () => saveTimer.current && clearTimeout(saveTimer.current)
  }, [nodes, edges, saveDraft])

  const onConnect = useCallback((params) => {
    setEdges((eds) => addEdge({ ...params, id: uid('e'), markerEnd: { type: MarkerType.ArrowClosed } }, eds))
  }, [setEdges])

  const onSelectionChange = useCallback(({ nodes: sel }) => {
    setSelId(sel && sel.length === 1 ? sel[0].id : null)
  }, [])

  function addBlock(type) {
    const id = uid(type)
    const seed = type === 'buttons'
      ? { text: 'Pick one:', buttons: [{ label: 'Option 1', action: 'send', reply_text: '' }] }
      : type === 'keyword' ? { keywords: ['rate'], reply: 'Type your reply…' }
      : type === 'action' ? { kind: 'send_media', text: '' }
      : type === 'message' ? { text: 'Your message…' }
      : {}
    // drop it near the current viewport centre-ish
    const y = 60 + (nodes.length % 6) * 90
    setNodes((nds) => nds.concat({ id, type, position: { x: 420 + (nodes.length % 3) * 60, y }, data: seed }))
    setSelId(id)
  }

  // patch the selected node's data
  const sel = useMemo(() => nodes.find((n) => n.id === selId) || null, [nodes, selId])
  const patch = useCallback((fields) => {
    setNodes((nds) => nds.map((n) => n.id === selId ? { ...n, data: { ...n.data, ...fields } } : n))
  }, [selId, setNodes])

  async function delSelected() {
    if (!sel || sel.type === 'start') return
    const ok = await confirmDialog({ title: 'Delete block?', message: 'Remove this block and its connections?', confirmLabel: 'Delete', danger: true })
    if (!ok) return
    setEdges((eds) => eds.filter((e) => e.source !== selId && e.target !== selId))
    setNodes((nds) => nds.filter((n) => n.id !== selId))
    setSelId(null)
  }


  async function toggleBot() {
    if (!acct?.id) { toastError(new Error('acct'), 'No active WhatsApp number.'); return }
    setToggling(true)
    const next = !acct.bot_enabled
    const { error } = await supabase.from('whatsapp_accounts').update({ bot_enabled: next }).eq('id', acct.id)
    if (error) { toastError(error, 'Could not switch the bot.'); setToggling(false); return }
    setAcct({ ...acct, bot_enabled: next }); toastSuccess(next ? 'Bot ON.' : 'Bot OFF.'); setToggling(false)
  }

  async function publish() {
    if (!acct?.id || !flowId) return
    if (saveTimer.current) clearTimeout(saveTimer.current)
    setPublishing(true)
    const draft = serialize(nodes, edges)
    // One Live flow per number -> un-publish siblings, then publish this.
    await supabase.from('campaign_bot_flows').update({ is_published: false }).eq('account_id', acct.id)
    const { error } = await supabase.from('campaign_bot_flows')
      .update({ draft_flow: draft, published_flow: draft, is_published: true, published_at: new Date().toISOString(), published_by: profile?.id || null })
      .eq('id', flowId)
    if (error) toastError(error, 'Could not publish.')
    else { setFlows((fs) => fs.map((f) => ({ ...f, is_published: f.id === flowId }))); toastSuccess('This chatbot is now Live on WhatsApp.') }
    setPublishing(false)
  }

  // ── C14 — multiple named chatbots per number ──
  async function newFlow() {
    if (!acct?.id) return
    const graph = { nodes: [{ id: 'start', type: 'start', position: { x: 60, y: 240 }, data: {} }], edges: [] }
    const { data, error } = await supabase.from('campaign_bot_flows')
      .insert({ account_id: acct.id, name: `Bot ${flows.length + 1}`, draft_flow: graph })
      .select('id, name, is_published, draft_flow').maybeSingle()
    if (error || !data) { toastError(error, 'Could not create the chatbot.'); return }
    setFlows((fs) => [...fs, { id: data.id, name: data.name, is_published: false }])
    loadIntoCanvas(data)
    toastSuccess('New chatbot created. Build it, then Publish to go Live.')
  }
  async function switchFlow(id) {
    if (!id || id === flowId) return
    if (saveTimer.current) clearTimeout(saveTimer.current)
    const { data } = await supabase.from('campaign_bot_flows')
      .select('id, name, is_published, draft_flow').eq('id', id).maybeSingle()
    if (data) loadIntoCanvas(data)
  }
  async function renameFlow(name) {
    const nm = (name || '').trim()
    if (!flowId || !nm || nm === flows.find((f) => f.id === flowId)?.name) return
    const { error } = await supabase.from('campaign_bot_flows').update({ name: nm }).eq('id', flowId)
    if (error) { toastError(error, 'Could not rename.'); return }
    setFlows((fs) => fs.map((f) => f.id === flowId ? { ...f, name: nm } : f))
  }
  async function delFlow() {
    if (!flowId) return
    if (flows.length <= 1) { toastError(new Error('min'), 'Keep at least one chatbot.'); return }
    const ok = await confirmDialog({ title: 'Delete chatbot?', message: `Delete "${curName}"? This removes the whole flow.`, confirmLabel: 'Delete', danger: true })
    if (!ok) return
    if (saveTimer.current) clearTimeout(saveTimer.current)
    const { error } = await supabase.from('campaign_bot_flows').delete().eq('id', flowId)
    if (error) { toastError(error, 'Could not delete.'); return }
    const rest = flows.filter((f) => f.id !== flowId)
    setFlows(rest)
    const { data } = await supabase.from('campaign_bot_flows')
      .select('id, name, is_published, draft_flow').eq('id', rest[0].id).maybeSingle()
    if (data) loadIntoCanvas(data)
    toastSuccess('Chatbot deleted.')
  }

  const on = !!acct?.bot_enabled
  const refreshBtn = <button type="button" onClick={load} style={btnG}><RefreshCw size={14} strokeWidth={1.6} /> Refresh</button>

  if (tablesMissing) {
    return (
      <CampaignChrome active="chatbot" title="Chatbot" right={refreshBtn}>
        <div style={banner}><AlertTriangle size={18} strokeWidth={1.6} style={{ color: 'var(--v2-amber, #F59E0B)', flexShrink: 0, marginTop: 1 }} />
          <div style={{ fontSize: 13, color: 'var(--v2-ink-1)' }}>Run <b style={{ color: 'var(--v2-ink-0)' }}>supabase_campaign_c12_bot_flow_model.sql</b>, then reload.</div></div>
      </CampaignChrome>
    )
  }

  return (
    <CampaignChrome active="chatbot" title="Chatbot"
      sub="Drag a block from the left onto the canvas, then drag between the dots to connect. Click a block to edit it on the right."
      right={(
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {saving ? <span style={{ fontSize: 11, color: 'var(--v2-ink-2)' }}>saving…</span> : null}
          {refreshBtn}
          <button type="button" onClick={publish} disabled={publishing} style={{ ...btnG, opacity: publishing ? 0.6 : 1 }}>
            {publishing ? <Loader2 size={14} strokeWidth={1.6} className="spin" /> : <UploadCloud size={14} strokeWidth={1.6} />} Publish
          </button>
          <button type="button" onClick={toggleBot} disabled={toggling} style={{ ...(on ? btnG : btnY), opacity: toggling ? 0.6 : 1 }}>
            {toggling ? <Loader2 size={14} strokeWidth={1.6} className="spin" /> : null} {on ? 'Bot ON · turn off' : 'Bot OFF · turn on'}
          </button>
        </div>
      )}>
      {loading ? (
        <div style={{ padding: 40, textAlign: 'center' }}><Loader2 size={20} strokeWidth={1.6} className="spin" style={{ color: 'var(--v2-yellow, #FFE600)' }} /></div>
      ) : !acct?.id ? (
        <div style={banner}><AlertTriangle size={18} strokeWidth={1.6} style={{ color: 'var(--v2-amber, #F59E0B)' }} />
          <div style={{ fontSize: 13, color: 'var(--v2-ink-1)' }}>No active WhatsApp number to attach the bot to.</div></div>
      ) : (
        <>
        {/* C14 — pick which chatbot to edit; one is Live on WhatsApp */}
        <div style={flowbar}>
          <span style={{ fontSize: 10.5, color: 'var(--v2-ink-2)', textTransform: 'uppercase', letterSpacing: '.07em', fontWeight: 600 }}>Chatbot</span>
          <select style={{ ...pinp, width: 'auto', minWidth: 130, height: 34 }} value={flowId || ''} onChange={(e) => switchFlow(e.target.value)}>
            {flows.map((f) => <option key={f.id || 'x'} value={f.id || ''}>{f.name}{f.is_published ? '  ·  LIVE' : ''}</option>)}
          </select>
          <input style={{ ...pinp, width: 150, height: 34 }} value={curName} onChange={(e) => setCurName(e.target.value)} onBlur={() => renameFlow(curName)} placeholder="name" title="Rename this chatbot" />
          <button type="button" onClick={newFlow} style={{ ...btnG, height: 34 }}><Plus size={13} strokeWidth={1.8} /> New</button>
          <button type="button" onClick={delFlow} style={{ ...btnG, height: 34, padding: '0 10px', color: 'var(--v2-rose, #f87171)' }} title="Delete this chatbot"><Trash2 size={13} strokeWidth={1.6} /></button>
          <span style={{ marginLeft: 'auto', fontSize: 11.5, fontWeight: 600, color: (flows.find((f) => f.id === flowId)?.is_published) ? 'var(--v2-green, #22c55e)' : 'var(--v2-ink-2)' }}>
            {(flows.find((f) => f.id === flowId)?.is_published) ? '● LIVE on WhatsApp' : 'Draft — Publish to go Live'}
          </span>
        </div>
        <div style={botwrap}>
          {/* rail — drag OR click to add a typed block */}
          <div style={rail}>
            {BLOCKS.map((b) => (
              <div key={b.type} title={`Add ${b.label}`} onClick={() => addBlock(b.type)}
                draggable onDragStart={(e) => e.dataTransfer.setData('application/bot-block', b.type)}
                style={{ ...ri, color: b.tint }}>
                <b.Icon size={17} strokeWidth={1.8} />
                <span style={{ fontSize: 8.5, marginTop: 2, color: 'var(--v2-ink-2)' }}>{b.label}</span>
              </div>
            ))}
          </div>

          {/* canvas */}
          <div style={canvas}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); const t = e.dataTransfer.getData('application/bot-block'); if (t) addBlock(t) }}>
            <ReactFlow
              nodes={nodes} edges={edges}
              onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
              onConnect={onConnect} onSelectionChange={onSelectionChange}
              nodeTypes={nodeTypes} fitView minZoom={0.3} maxZoom={1.6}
              defaultEdgeOptions={{ style: { stroke: 'var(--v2-yellow, #FFE600)', strokeWidth: 2 }, markerEnd: { type: MarkerType.ArrowClosed } }}
              proOptions={{ hideAttribution: true }}>
              <Background color="var(--v2-line, #23324f)" gap={22} size={1} />
              <Controls showInteractive={false} />
            </ReactFlow>
          </div>

          {/* properties */}
          <div style={props}>
            {!sel ? (
              <div style={{ fontSize: 12.5, color: 'var(--v2-ink-2)', lineHeight: 1.6 }}>
                Select a block to edit it.<br /><br />
                Drag a block from the left onto the canvas, then drag from one block&rsquo;s dot to another&rsquo;s to connect them.
              </div>
            ) : (
              <>
                <div style={ph}><span style={{ width: 9, height: 9, borderRadius: 3, background: DOT[sel.type], display: 'inline-block' }} />{TITLE[sel.type]}</div>
                <div style={psub}>{sel.type} block</div>
                <NodeEditor node={sel} patch={patch} />
                {sel.type !== 'start' && (
                  <button type="button" style={{ ...btnG, color: 'var(--v2-rose, #f87171)', marginTop: 16 }} onClick={delSelected}>
                    <Trash2 size={14} strokeWidth={1.6} /> Delete block
                  </button>
                )}
              </>
            )}
          </div>
        </div>
        </>
      )}
      <style>{`@keyframes spin{to{transform:rotate(360deg)}} .spin{animation:spin 1s linear infinite}
        .react-flow__attribution{display:none}
        .react-flow__controls button{background:var(--v2-bg-1)!important;border-bottom:1px solid var(--v2-line)!important;fill:var(--v2-ink-1)!important}`}</style>
    </CampaignChrome>
  )
}

// ─── per-node-type property editor ───────────────────────────────────
function NodeEditor({ node, patch }) {
  const d = node.data || {}
  const setMedia = (url, type) => patch({ media_url: url, media_type: type })
  const mediaRow = (
    <div style={{ marginTop: 10 }}>
      <label style={plabel}>Attach image / video / PDF (optional)</label>
      {d.media_url ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12 }}>
          <span style={{ color: 'var(--v2-green, #22c55e)', textTransform: 'capitalize' }}>{d.media_type || 'file'} attached</span>
          <a href={d.media_url} target="_blank" rel="noreferrer" style={{ color: 'var(--v2-ink-2)' }}>view</a>
          <button type="button" onClick={() => setMedia(null, null)} style={{ ...btnG, height: 28, padding: '0 10px', fontSize: 12 }}>Remove</button>
        </div>
      ) : (
        <MediaPicker accept="image/*,video/*,application/pdf" onSelect={(url, type) => setMedia(url, type)} />
      )}
    </div>
  )

  if (node.type === 'start') {
    return <div style={{ fontSize: 12, color: 'var(--v2-ink-1)', lineHeight: 1.6, marginTop: 8 }}>Entry point. The customer&rsquo;s first message (or a QR scan) starts the flow here. Connect it to your first block.</div>
  }
  if (node.type === 'handoff') {
    return <div style={{ fontSize: 12, color: 'var(--v2-ink-1)', lineHeight: 1.6, marginTop: 8 }}>Stops the bot and hands the chat to a telecaller. Nothing to configure.</div>
  }
  if (node.type === 'message') {
    return <>
      <label style={plabel}>Message text</label>
      <textarea style={ptext} value={d.text || ''} onChange={(e) => patch({ text: e.target.value })} placeholder="What the bot sends…" />
      {mediaRow}
    </>
  }
  if (node.type === 'keyword') {
    return <>
      <label style={plabel}>If the message contains (comma-separated)</label>
      <input style={pinp} value={(d.keywords || []).join(', ')} onChange={(e) => patch({ keywords: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })} placeholder="rate, price, cost" />
      <label style={{ ...plabel, marginTop: 12 }}>Reply with</label>
      <textarea style={ptext} value={d.reply || ''} onChange={(e) => patch({ reply: e.target.value })} />
      {mediaRow}
    </>
  }
  if (node.type === 'action') {
    return <>
      <label style={plabel}>Action</label>
      <select style={pinp} value={d.kind || 'send_media'} onChange={(e) => patch({ kind: e.target.value })}>
        <option value="send_media">Send media / message</option>
        <option value="create_lead">Create a lead</option>
        <option value="handoff">Hand off to a person</option>
      </select>
      {d.kind !== 'create_lead' && d.kind !== 'handoff' && (
        <>
          <label style={{ ...plabel, marginTop: 12 }}>Message (optional)</label>
          <textarea style={ptext} value={d.text || ''} onChange={(e) => patch({ text: e.target.value })} />
          {mediaRow}
        </>
      )}
    </>
  }
  if (node.type === 'buttons') {
    const btns = d.buttons || []
    const setBtn = (i, f) => patch({ buttons: btns.map((b, j) => j === i ? { ...b, ...f } : b) })
    return <>
      <label style={plabel}>Prompt text</label>
      <textarea style={ptext} value={d.text || ''} onChange={(e) => patch({ text: e.target.value })} placeholder="Pick one:" />
      {mediaRow}
      <label style={{ ...plabel, marginTop: 14 }}>Buttons (up to 10) — each is an output port</label>
      {btns.map((b, i) => (
        <div key={i} style={{ border: '1px solid var(--v2-line)', borderRadius: 10, padding: 10, marginBottom: 8, background: 'var(--v2-bg-2, #1a2742)' }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <input style={{ ...pinp, flex: 1 }} value={b.label || ''} maxLength={24} onChange={(e) => setBtn(i, { label: e.target.value })} placeholder="Rates" />
            <button type="button" onClick={() => patch({ buttons: btns.filter((_, j) => j !== i) })} style={{ ...btnG, height: 38, padding: '0 8px', color: 'var(--v2-rose, #f87171)' }}><Trash2 size={13} strokeWidth={1.6} /></button>
          </div>
          <div style={{ fontSize: 10.5, color: 'var(--v2-ink-2)', marginTop: 6 }}>Wire this button&rsquo;s dot to a block, or type an inline reply below.</div>
          <textarea style={{ ...ptext, minHeight: 54, marginTop: 6 }} value={b.reply_text || ''} onChange={(e) => setBtn(i, { reply_text: e.target.value })} placeholder="Inline reply (if not wired)…" />
        </div>
      ))}
      {btns.length < 10 && (
        <button type="button" onClick={() => patch({ buttons: [...btns, { label: `Option ${btns.length + 1}`, action: 'send', reply_text: '' }] })} style={btnG}>
          <Plus size={14} strokeWidth={1.6} /> Add button
        </button>
      )}
      <div style={{ fontSize: 11, color: 'var(--v2-ink-2)', marginTop: 6 }}>1-3 buttons show as tap buttons; 4-10 as a pick-list.</div>
    </>
  }
  return null
}

// ─── styles ──────────────────────────────────────────────────────────
const banner = { border: '1px solid var(--v2-amber, #F59E0B)', borderRadius: 14, padding: 18, background: 'var(--v2-amber-soft, rgba(245,158,11,0.12))', display: 'flex', gap: 10, alignItems: 'flex-start' }
const flowbar = { display: 'flex', alignItems: 'center', gap: 8, padding: '9px 12px', marginBottom: 10, border: '1px solid var(--v2-line, #1f2b47)', borderRadius: 12, background: 'var(--v2-bg-1, #0f1525)', flexWrap: 'wrap' }
const botwrap = { display: 'flex', border: '1px solid var(--v2-line, #1f2b47)', borderRadius: 14, overflow: 'hidden', background: 'var(--v2-bg-1, #0f1525)', height: 620 }
const rail = { width: 64, borderRight: '1px solid var(--v2-line)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: '14px 0', background: 'var(--v2-bg-2, #1a2742)', flexShrink: 0 }
const ri = { width: 50, height: 50, borderRadius: 10, border: '1px solid var(--v2-line)', background: 'var(--v2-bg-1)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', cursor: 'grab' }
const canvas = { flex: 1, position: 'relative', backgroundColor: 'var(--v2-bg-0, #0b1222)' }
const props = { width: 300, borderLeft: '1px solid var(--v2-line)', background: 'var(--v2-bg-1, #0f1525)', padding: 18, overflow: 'auto', flexShrink: 0 }
const ph = { fontFamily: 'var(--v2-display)', fontSize: 15, fontWeight: 600, color: 'var(--v2-ink-0)', display: 'flex', alignItems: 'center', gap: 8 }
const psub = { fontSize: 11, color: 'var(--v2-ink-2)', margin: '3px 0 14px', textTransform: 'capitalize' }
const plabel = { fontSize: 10, color: 'var(--v2-ink-2)', textTransform: 'uppercase', letterSpacing: '.08em', fontWeight: 600, margin: '0 0 6px', display: 'block' }
const pinp = { width: '100%', height: 38, padding: '0 11px', background: 'var(--v2-bg-2, #1a2742)', border: '1px solid var(--v2-line)', borderRadius: 8, color: 'var(--v2-ink-0)', fontSize: 12.5, outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }
const ptext = { width: '100%', minHeight: 80, background: 'var(--v2-bg-2, #1a2742)', border: '1px solid var(--v2-line)', borderRadius: 8, color: 'var(--v2-ink-0)', fontFamily: 'inherit', fontSize: 12.5, padding: '9px 11px', outline: 'none', resize: 'vertical', boxSizing: 'border-box' }
const btnY = { background: 'var(--v2-yellow, #FFE600)', color: 'var(--accent-fg, #0b1220)', border: 'none', borderRadius: 10, height: 38, padding: '0 16px', fontWeight: 700, fontSize: 13, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }
const btnG = { background: 'transparent', color: 'var(--v2-ink-1, #a9b3c7)', border: '1px solid var(--v2-line, #1f2b47)', borderRadius: 10, height: 38, padding: '0 14px', fontWeight: 600, fontSize: 13, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }
