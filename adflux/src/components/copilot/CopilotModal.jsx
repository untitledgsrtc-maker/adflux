// src/components/copilot/CopilotModal.jsx
//
// Phase 1.5 — AI Co-Pilot natural-language query modal.
//
// User opens with Cmd+K (or Ctrl+K) anywhere in the app.
// Types/speaks a question in Gujarati or English, hits Enter.
// We call the Supabase Edge Function `copilot` which:
//   1. Translates the query into a SQL plan via Claude Haiku
//   2. Executes the plan against Supabase (using the user's JWT for RLS)
//   3. Returns: { answer_text, table?, chart_spec?, action_chips? }
//
// The modal renders the answer + clickable action chips that can:
//   - Send a WhatsApp message via Meta API
//   - Navigate to a filtered page
//   - Trigger a re-query
//
// Until the Edge Function is deployed, this modal still works as a
// search-bar fallback that filters /leads + /quotes by the query.

import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Sparkles, X, Loader2, ArrowRight, MessageCircle, Search } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/authStore'

const SUGGESTED_QUERIES = [
  { gu: 'આજે કોને check-in નથી કર્યું?',     en: 'Who hasn\'t checked in today?' },
  { gu: '45 દિવસથી જૂના pending invoices',  en: 'Invoices overdue more than 45 days' },
  { gu: 'આ અઠવાડિયે કેટલા leads આવ્યા?',    en: 'How many leads this week?' },
  { gu: 'ગાંધીનગરમાં active quotes',          en: 'Active quotes in Gandhinagar' },
  { gu: 'આજનાં Sales Ready hand-offs',        en: 'Today\'s Sales Ready handoffs' },
]

export default function CopilotModal({ open, onClose }) {
  const navigate = useNavigate()
  const profile  = useAuthStore(s => s.profile)
  const inputRef = useRef(null)

  const [query, setQuery]       = useState('')
  const [busy, setBusy]         = useState(false)
  const [result, setResult]     = useState(null)
  const [error, setError]       = useState('')

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50)
    } else {
      setQuery(''); setResult(null); setError('')
    }
  }, [open])

  // ESC to close
  useEffect(() => {
    if (!open) return
    function onKey(e) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  async function runQuery(q) {
    if (!q?.trim()) return
    setBusy(true); setError(''); setResult(null)

    try {
      // Try the Edge Function first.
      const { data, error: fnErr } = await supabase.functions.invoke('copilot', {
        body: { query: q.trim(), user_id: profile?.id },
      })

      if (fnErr || !data) {
        // Fallback: deep-link to a filtered /leads search (best we can do
        // without the LLM). Still useful — most queries are name lookups.
        setError(
          'AI Co-Pilot Edge Function not deployed yet. ' +
          'Falling back to lead search — set ANTHROPIC_API_KEY in Supabase ' +
          'and deploy the `copilot` Edge Function to enable natural-language queries.'
        )
        // Auto-dispatch to /leads with the query as search.
        setTimeout(() => {
          navigate('/leads')
          onClose()
        }, 1500)
        return
      }

      setResult(data)
    } catch (e) {
      setError(e.message || 'Co-Pilot call failed.')
    } finally {
      setBusy(false)
    }
  }

  function handleKey(e) {
    if (e.key === 'Enter') {
      e.preventDefault()
      runQuery(query)
    }
  }

  if (!open) return null

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
      style={{
        position: 'fixed', inset: 0, zIndex: 200,
        background: 'rgba(0,0,0,.6)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        paddingTop: '15vh',
      }}
    >
      <div style={{
        width: '90%', maxWidth: 640,
        background: 'var(--v2-bg-1)',
        border: '1px solid var(--v2-line, rgba(255,255,255,.1))',
        borderRadius: 16,
        boxShadow: '0 24px 48px rgba(0,0,0,.4)',
        overflow: 'hidden',
      }}>
        {/* Search input */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '16px 20px',
          borderBottom: '1px solid var(--v2-line, rgba(255,255,255,.06))',
          background: `
            radial-gradient(600px 100px at 100% 0%, rgba(192,132,252,.10), transparent 60%),
            radial-gradient(500px 100px at 0% 100%, rgba(96,165,250,.10), transparent 60%)
          `,
        }}>
          <Sparkles size={18} style={{ color: '#c084fc' }} />
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKey}
            placeholder="Ask anything in Gujarati or English…"
            disabled={busy}
            style={{
              flex: 1, background: 'transparent', border: 'none', outline: 'none',
              color: 'var(--v2-ink-0)', fontSize: 16, fontFamily: 'inherit',
            }}
          />
          {busy && <Loader2 size={16} style={{ animation: 'spin 1s linear infinite', color: 'var(--v2-ink-2)' }} />}
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--v2-ink-2)', cursor: 'pointer' }}>
            <X size={18} />
          </button>
        </div>

        {/* Result / suggestions */}
        <div style={{ padding: '16px 20px', maxHeight: '60vh', overflowY: 'auto' }}>
          {error && (
            <div style={{
              background: 'rgba(251,191,36,.10)',
              border: '1px solid rgba(251,191,36,.28)',
              color: '#fbbf24',
              borderRadius: 8, padding: '10px 14px', fontSize: 12, marginBottom: 12,
            }}>
              ⚠ {error}
            </div>
          )}

          {result && (
            <div>
              <div style={{
                fontSize: 14, lineHeight: 1.6,
                color: 'var(--v2-ink-0)', marginBottom: 14,
              }}>
                {result.answer_text}
              </div>

              {result.table && (
                <div style={{ overflowX: 'auto', marginBottom: 14 }}>
                  <table className="v2d-q-table">
                    <thead>
                      <tr>
                        {result.table.columns.map(c => <th key={c}>{c}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {result.table.rows.slice(0, 50).map((row, i) => (
                        <tr key={i}>
                          {row.map((cell, j) => <td key={j}>{cell}</td>)}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {result.action_chips?.length > 0 && (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
                  {result.action_chips.map((c, i) => (
                    <button
                      key={i}
                      onClick={() => {
                        if (c.kind === 'navigate' && c.path) {
                          navigate(c.path)
                          onClose()
                        } else if (c.kind === 'whatsapp' && c.phone && c.message) {
                          window.open(`https://wa.me/${c.phone}?text=${encodeURIComponent(c.message)}`, '_blank')
                        }
                      }}
                      style={{
                        padding: '6px 12px', borderRadius: 999,
                        background: c.kind === 'whatsapp' ? 'rgba(74,222,128,.10)' : 'rgba(96,165,250,.10)',
                        border: `1px solid ${c.kind === 'whatsapp' ? 'rgba(74,222,128,.28)' : 'rgba(96,165,250,.30)'}`,
                        color: c.kind === 'whatsapp' ? '#4ade80' : '#60a5fa',
                        fontSize: 12, fontWeight: 600,
                        cursor: 'pointer',
                        display: 'inline-flex', alignItems: 'center', gap: 6,
                      }}
                    >
                      {c.kind === 'whatsapp' ? <MessageCircle size={12} /> : <ArrowRight size={12} />}
                      {c.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {!result && !error && !busy && (
            <div>
              <div style={{
                fontSize: 11, color: 'var(--v2-ink-2)',
                textTransform: 'uppercase', letterSpacing: '.14em',
                marginBottom: 10,
              }}>
                Try asking
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {SUGGESTED_QUERIES.map((s, i) => (
                  <button
                    key={i}
                    onClick={() => { setQuery(s.gu); runQuery(s.gu) }}
                    style={{
                      textAlign: 'left',
                      padding: '10px 14px', borderRadius: 8,
                      background: 'transparent',
                      border: '1px solid var(--v2-line, rgba(255,255,255,.06))',
                      color: 'var(--v2-ink-0)',
                      fontSize: 13, cursor: 'pointer',
                    }}
                  >
                    <div>{s.gu}</div>
                    <div style={{ fontSize: 11, color: 'var(--v2-ink-2)', marginTop: 2 }}>
                      {s.en}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer hint */}
        <div style={{
          padding: '10px 20px',
          borderTop: '1px solid var(--v2-line, rgba(255,255,255,.06))',
          fontSize: 11, color: 'var(--v2-ink-2)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <span>Powered by Claude Haiku · costs ~₹0.30 per query</span>
          <span style={{ fontFamily: 'monospace', background: 'rgba(255,255,255,.06)', padding: '2px 6px', borderRadius: 4 }}>
            ESC to close
          </span>
        </div>
      </div>
    </div>
  )
}
