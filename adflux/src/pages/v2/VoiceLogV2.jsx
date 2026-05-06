// src/pages/v2/VoiceLogV2.jsx
//
// Phase 16 commit 8 — Voice-First mobile screens, ported visually from
// _design_reference/Leads/lead-voice.jsx (MVoiceListening, MVoiceConfirm,
// MEveningReport).
//
// Status: UI shells only. Functional voice recording / Whisper / Claude
// extraction is **NOT WIRED** yet — depends on task #97 (Anthropic API
// key + Edge Function deploy + Whisper integration).
//
// Each "Tap to record" button shows a banner explaining this and offers
// a deep link to the API integration guide. Once the API is live, this
// page swaps to functional MediaRecorder + Whisper transcribe + Claude
// extract.
//
// Route: /voice. Three tabs (Listening / Confirm / Evening) so the
// designer can verify all three screens at once.

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowLeft, Mic, MicOff, MapPin, CheckCircle2, Sparkles, Phone,
} from 'lucide-react'
import { Pill } from '../../components/leads/LeadShared'

const TABS = [
  { key: 'listen',  label: '1 · Listening' },
  { key: 'confirm', label: '2 · Confirm' },
  { key: 'evening', label: '3 · Evening report' },
]

export default function VoiceLogV2() {
  const navigate = useNavigate()
  const [tab, setTab] = useState('listen')
  const [showApiBanner, setShowApiBanner] = useState(false)

  return (
    <div className="lead-root">
      <button
        className="lead-btn lead-btn-sm"
        onClick={() => navigate('/leads')}
        style={{ marginBottom: 16 }}
      >
        <ArrowLeft size={12} /> Leads
      </button>

      <div className="lead-page-head">
        <div>
          <div className="lead-page-eyebrow">Voice-First · Gujarati / Hindi / English</div>
          <div className="lead-page-title">Voice Log</div>
          <div className="lead-page-sub">
            3× faster than typing. Speak naturally — system transcribes via Whisper, extracts via Claude.
          </div>
        </div>
        <Pill tone="warn">
          <MicOff size={11} style={{ marginRight: 6 }} />
          Phase 2 · API not wired
        </Pill>
      </div>

      {/* Tab strip — picks which mobile preview to render */}
      <div className="lead-filter-tabs" style={{ marginBottom: 16 }}>
        {TABS.map(t => (
          <span
            key={t.key}
            className={`lead-filter-tab ${tab === t.key ? 'active' : ''}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </span>
        ))}
      </div>

      {/* API gate banner */}
      {showApiBanner && (
        <div
          className="lead-card lead-card-pad"
          style={{
            marginBottom: 14,
            background: 'var(--warning-soft)',
            borderColor: 'var(--warning)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600, fontSize: 13, color: 'var(--warning)', marginBottom: 6 }}>
            <Sparkles size={14} />
            Voice integration not yet live
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.6 }}>
            To enable voice logging, the Anthropic API key needs to be set on
            the Supabase project and the copilot Edge Function needs to be
            deployed. See the deployment guide pinned at the top of CLAUDE.md
            (Step 1–7). Once that's done, a Whisper-based recorder will plug
            into this screen and these mock transcripts go away.
          </div>
        </div>
      )}

      {/* Mobile preview frame — keep the same 360-440 phone width
          so the screen looks like it would on a rep's device. */}
      <div
        style={{
          maxWidth: 440, margin: '0 auto',
          background: 'var(--bg)',
          border: '1px solid var(--border)',
          borderRadius: 24,
          padding: 4,
          boxShadow: 'var(--shadow)',
        }}
      >
        <div className="m-screen" style={{ borderRadius: 20 }}>
          {tab === 'listen'  && <Listening  onTap={() => setShowApiBanner(true)} />}
          {tab === 'confirm' && <Confirm    onTap={() => setShowApiBanner(true)} />}
          {tab === 'evening' && <Evening    onTap={() => setShowApiBanner(true)} />}
        </div>
      </div>
    </div>
  )
}

/* ─── Screen 1: Listening ─── */
function Listening({ onTap }) {
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
        <ArrowLeft size={14} />
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Logging call · Dr. Mehta</span>
      </div>

      <div className="voice-card" style={{ textAlign: 'center', padding: 18 }}>
        <span className="voice-pill">
          <span className="mic" /> Listening · Gujarati
        </span>
        <div
          className="voice-mic live"
          style={{ width: 80, height: 80, margin: '20px auto 14px' }}
          onClick={onTap}
        >
          <Phone size={32} />
        </div>
        <div className="wave-big">
          {Array.from({ length: 20 }).map((_, i) => <span key={i} />)}
        </div>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 600, color: 'var(--purple)' }}>
          0:24
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-subtle)', marginTop: 4, letterSpacing: '.12em', textTransform: 'uppercase' }}>
          Tap to stop
        </div>
      </div>

      <div className="m-card" style={{ marginTop: 12 }}>
        <div className="m-card-title">Live transcript</div>
        <div className="guj-quote" style={{ fontSize: 13 }}>
          Mehta sahebne mali aavyo, demo set thai gayo…
          <span className="en">Met Mehta. Demo set…</span>
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-subtle)', marginTop: 8 }}>
          Speak naturally — system understands Gujarati, Hindi, English
        </div>
      </div>
    </>
  )
}

/* ─── Screen 2: Confirm extracted data ─── */
function Confirm({ onTap }) {
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
        <ArrowLeft size={14} />
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Confirm log · Dr. Mehta</span>
      </div>

      <div className="voice-card" style={{ marginBottom: 12 }}>
        <span className="voice-pill" style={{ marginBottom: 8 }}>
          <CheckCircle2 size={11} style={{ marginRight: 4 }} /> Transcribed · 0:24
        </span>
        <div className="guj-quote">
          Mehta sahebne mali aavyo, demo set thai gayo. ₹3.8 lakh nu quote mokalvaanu chhe.
          <span className="en">Met Mehta. Demo scheduled. Need to send ₹3.8L quote.</span>
        </div>
      </div>

      <div className="m-card">
        <div className="m-card-title">AI extracted · review</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div>
            <label className="lead-fld-label">Outcome</label>
            <div className="lead-radio-grp">
              <span className="opt on pos">Positive</span>
              <span className="opt">Neutral</span>
              <span className="opt">Negative</span>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label className="lead-fld-label">Next action</label>
              <input className="lead-inp" defaultValue="Send quote" disabled />
            </div>
            <div>
              <label className="lead-fld-label">Amount</label>
              <input className="lead-inp" defaultValue="₹3,80,000" disabled />
            </div>
          </div>
          <div>
            <label className="lead-fld-label">Move stage to</label>
            <select className="lead-inp" disabled defaultValue="SalesReady">
              <option>SalesReady</option>
            </select>
          </div>
          <Pill style={{ alignSelf: 'flex-start' }}>
            <MapPin size={11} style={{ marginRight: 4 }} /> GPS · Surat · Adajan · ±12m
          </Pill>
        </div>
      </div>

      <button className="m-cta" onClick={onTap}>Looks good · save log</button>
      <button className="m-cta m-cta-ghost" onClick={onTap}>Re-record</button>
    </>
  )
}

/* ─── Screen 3: Evening report (spoken) ─── */
function Evening({ onTap }) {
  return (
    <>
      <div className="m-greet">
        <div>
          <div className="hello">Evening report</div>
          <div className="date">Saturday · 19:42 · check-out</div>
        </div>
        <span className="voice-pill">
          <Mic size={10} style={{ marginRight: 4 }} /> AI
        </span>
      </div>

      <div className="voice-card" style={{ marginBottom: 12, textAlign: 'center' }}>
        <span className="voice-pill" style={{ marginBottom: 10 }}>
          <span className="mic" /> Speak summary · 30s
        </span>
        <div
          className="voice-mic live"
          style={{ width: 64, height: 64, margin: '10px auto' }}
          onClick={onTap}
        >
          <Phone size={24} />
        </div>
        <div className="guj-quote" style={{ textAlign: 'left' }}>
          Aaje 3 meetings karya, Sunrise close thavaani randami. Bisleri renewal ma site survey Monday e karvi.
          <span className="en">3 meetings today, Sunrise close to closing. Bisleri site survey on Monday.</span>
        </div>
      </div>

      <div className="m-card">
        <div className="m-card-title">
          AI summary
          <Pill tone="success">approved</Pill>
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.6 }}>
          <b style={{ color: 'var(--text)' }}>Highlights:</b> 3 meetings completed · Sunrise Diagnostics → SalesReady · ₹6.2L pipeline added.<br />
          <b style={{ color: 'var(--text)' }}>Blockers:</b> Bisleri renewal site survey pending — scheduled Monday.<br />
          <b style={{ color: 'var(--text)' }}>Tomorrow:</b> Send Sunrise quote · close Patel Auto Hub.
        </div>
      </div>

      <button className="m-cta" onClick={onTap}>Submit report</button>
    </>
  )
}
