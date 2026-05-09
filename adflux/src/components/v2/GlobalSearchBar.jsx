// src/components/v2/GlobalSearchBar.jsx
//
// Phase 31A.3 — global cross-entity search. Owner sales-exec analysis
// (8 May 2026): "no global search". Co-Pilot covers natural-language
// queries; this is the fast literal lookup ("where is Patel · what's
// quote 0042 status · find Sondarva Mayur").
//
// Searches in parallel:
//   leads     — name / company / phone
//   clients   — name / company / phone
//   quotes    — client_name / client_company / quote_number / ref_number
//
// Debounced 250ms. Click → navigate to detail. Esc closes. ⌘/ focuses.

import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, X, Inbox, Contact2, FileText } from 'lucide-react'
import { supabase } from '../../lib/supabase'

const ICONS = { lead: Inbox, client: Contact2, quote: FileText }

export default function GlobalSearchBar() {
  const navigate = useNavigate()
  const [q, setQ]               = useState('')
  const [results, setResults]   = useState({ leads: [], clients: [], quotes: [] })
  const [loading, setLoading]   = useState(false)
  const [open, setOpen]         = useState(false)
  const [highlight, setHighlight] = useState(0)
  const inputRef = useRef(null)
  const wrapRef  = useRef(null)

  // ⌘/ — focus search bar from anywhere.
  useEffect(() => {
    function onKey(e) {
      if ((e.metaKey || e.ctrlKey) && e.key === '/') {
        e.preventDefault()
        inputRef.current?.focus()
      }
      if (e.key === 'Escape') {
        setOpen(false)
        inputRef.current?.blur()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Click-outside closes the dropdown.
  useEffect(() => {
    function onClick(e) {
      if (!wrapRef.current) return
      if (!wrapRef.current.contains(e.target)) setOpen(false)
    }
    if (open) document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  // Debounced fetch — 250ms after last keystroke.
  useEffect(() => {
    const term = q.trim()
    if (term.length < 2) { setResults({ leads: [], clients: [], quotes: [] }); return }
    const ctrl = new AbortController()
    const t = setTimeout(async () => {
      setLoading(true)
      const like = `%${term}%`
      const [lRes, cRes, qRes] = await Promise.all([
        supabase.from('leads')
          .select('id, name, company, phone, stage')
          .or(`name.ilike.${like},company.ilike.${like},phone.ilike.${like}`)
          .limit(5),
        supabase.from('clients')
          .select('id, name, company, phone')
          .or(`name.ilike.${like},company.ilike.${like},phone.ilike.${like}`)
          .limit(5),
        supabase.from('quotes')
          .select('id, segment, media_type, quote_number, ref_number, client_name, client_company, status')
          .or(`client_name.ilike.${like},client_company.ilike.${like},quote_number.ilike.${like},ref_number.ilike.${like}`)
          .limit(5),
      ])
      if (ctrl.signal.aborted) return
      setResults({
        leads:   lRes.data || [],
        clients: cRes.data || [],
        quotes:  qRes.data || [],
      })
      setLoading(false)
      setHighlight(0)
    }, 250)
    return () => { clearTimeout(t); ctrl.abort() }
  }, [q])

  const flat = useMemo(() => [
    ...results.leads  .map(r => ({ kind: 'lead',   id: r.id, primary: r.company || r.name || '—', secondary: [r.name, r.phone, r.stage].filter(Boolean).join(' · '), to: `/leads/${r.id}` })),
    ...results.quotes .map(r => ({ kind: 'quote',  id: r.id, primary: r.quote_number || r.ref_number || '—', secondary: [r.client_company || r.client_name, r.status].filter(Boolean).join(' · '), to: r.segment === 'GOVERNMENT' ? `/proposal/${r.id}` : `/quotes/${r.id}` })),
    ...results.clients.map(r => ({ kind: 'client', id: r.id, primary: r.company || r.name || '—', secondary: [r.name, r.phone].filter(Boolean).join(' · '), to: '/clients' })),
  ], [results])

  function pick(item) {
    setOpen(false)
    setQ('')
    navigate(item.to)
  }

  function onKeyDown(e) {
    if (!open || flat.length === 0) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight(h => Math.min(h + 1, flat.length - 1)) }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setHighlight(h => Math.max(h - 1, 0)) }
    if (e.key === 'Enter')     { e.preventDefault(); pick(flat[highlight]) }
  }

  return (
    <div ref={wrapRef} style={{ position: 'relative', minWidth: 220, maxWidth: 320 }}>
      <div className="v2d-search" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 10px' }}>
        <Search size={14} style={{ color: 'var(--v2-ink-2)' }} />
        <input
          ref={inputRef}
          value={q}
          onChange={e => { setQ(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="Find lead, client, quote…"
          style={{
            flex: 1, background: 'transparent', border: 0, outline: 'none',
            color: 'var(--text)', fontSize: 13, padding: '8px 0', minWidth: 0,
          }}
        />
        {q ? (
          <button
            type="button"
            onClick={() => { setQ(''); inputRef.current?.focus() }}
            style={{ background: 'none', border: 0, color: 'var(--v2-ink-2)', cursor: 'pointer', padding: 0 }}
            aria-label="Clear"
          >
            <X size={12} />
          </button>
        ) : (
          <span style={{
            fontFamily: 'monospace', fontSize: 10,
            background: 'rgba(255,255,255,.06)',
            padding: '2px 6px', borderRadius: 4,
            color: 'var(--v2-ink-2)',
          }}>⌘/</span>
        )}
      </div>

      {open && q.trim().length >= 2 && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 6,
          background: 'var(--surface, #1e293b)',
          border: '1px solid var(--border, #334155)',
          borderRadius: 10,
          boxShadow: '0 10px 30px rgba(0,0,0,.35)',
          maxHeight: '60vh', overflowY: 'auto', zIndex: 200,
        }}>
          {loading && (
            <div style={{ padding: 12, fontSize: 12, color: 'var(--text-muted)' }}>Searching…</div>
          )}
          {!loading && flat.length === 0 && (
            <div style={{ padding: 12, fontSize: 12, color: 'var(--text-muted)' }}>
              No matches for "{q.trim()}"
            </div>
          )}
          {!loading && flat.length > 0 && flat.map((item, i) => {
            const Icon = ICONS[item.kind] || Search
            const tint = item.kind === 'lead' ? '#60A5FA'
                      : item.kind === 'quote' ? '#FBBF24'
                      : '#4ADE80'
            return (
              <div
                key={`${item.kind}-${item.id}`}
                onClick={() => pick(item)}
                onMouseEnter={() => setHighlight(i)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '10px 12px', cursor: 'pointer',
                  background: i === highlight ? 'rgba(255,255,255,.04)' : 'transparent',
                  borderTop: i === 0 ? 'none' : '1px solid var(--border-soft, rgba(255,255,255,.04))',
                }}
              >
                <Icon size={14} style={{ color: tint, flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize: 13, fontWeight: 500,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {item.primary}
                  </div>
                  {item.secondary && (
                    <div style={{
                      fontSize: 11, color: 'var(--text-muted)',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {item.secondary}
                    </div>
                  )}
                </div>
                <span style={{
                  fontSize: 9, letterSpacing: '.08em', textTransform: 'uppercase',
                  color: tint, opacity: .85,
                }}>
                  {item.kind}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
