// src/components/v2/ErrorBoundary.jsx
//
// Phase 104.1 — catch a page's render crash and show the error message +
// stack ON SCREEN (brand-styled) instead of a white screen. Lets a
// non-technical owner screenshot the exact error so the real bug can be
// pinpointed without chrome://inspect on the APK.
//
// React error boundaries MUST be class components (getDerivedStateFromError
// / componentDidCatch have no hook equivalent). Wrap a route element:
//   <ErrorBoundary label="Telecaller Today"><TelecallerV2 /></ErrorBoundary>

import { Component } from 'react'

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null, info: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    this.setState({ info })
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary]', this.props.label || '', error, info)
  }

  render() {
    if (!this.state.error) return this.props.children

    const msg = this.state.error?.message || String(this.state.error)
    const stack = (this.state.error?.stack || '').split('\n').slice(0, 8).join('\n')
    const comp = (this.state.info?.componentStack || '').split('\n').slice(0, 8).join('\n')

    return (
      <div style={{
        margin: 16, padding: 16, borderRadius: 14,
        background: 'var(--danger-soft, rgba(239,68,68,0.12))',
        border: '1px solid var(--danger, #EF4444)',
        color: 'var(--text, #f1f5f9)', fontSize: 13, lineHeight: 1.5,
      }}>
        <div style={{ fontWeight: 700, marginBottom: 8, color: 'var(--danger, #EF4444)' }}>
          {this.props.label ? `${this.props.label} hit an error` : 'This page hit an error'}
        </div>
        <div style={{ marginBottom: 10, fontWeight: 600 }}>{msg}</div>
        <pre style={{
          whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          fontSize: 11, color: 'var(--text-muted, #94a3b8)',
          background: 'var(--surface-2, #334155)', padding: 10,
          borderRadius: 10, margin: 0, maxHeight: 260, overflow: 'auto',
        }}>{stack}{comp ? `\n\ncomponent stack:${comp}` : ''}</pre>
        <button
          type="button"
          onClick={() => { try { window.location.reload() } catch { /* noop */ } }}
          style={{
            marginTop: 12, padding: '8px 16px', borderRadius: 10,
            background: 'var(--accent, #FFE600)', color: 'var(--accent-fg, #0f172a)',
            border: 0, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
          }}
        >
          Reload
        </button>
      </div>
    )
  }
}
