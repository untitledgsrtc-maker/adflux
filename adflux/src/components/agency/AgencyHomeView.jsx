// src/components/agency/AgencyHomeView.jsx
//
// Phase 101.B (2026-05-29) — agency Home dashboard.
//
// Mounted by DashboardV2 switcher when `profile?.role === 'agency'`.
// Mirrors the SalesDashboard mobile layout (KPI grid + ActiveCampaigns
// + FAB BottomNav) but with agency-specific metrics:
//   - NO score / variable / incentive slab math
//   - NO team leaderboard
//   - NO ProposedIncentive forecast
//   - YES commission earned + payable (Phase 101.A1 formula)
//   - YES quote / payment / follow-up KPIs from own rows
//
// Bottom-nav stacking note: V2AppShell.jsx:778 still renders the
// v2d-mnav mobile nav (3-item AGENCY_NAV) under this component's
// .v2-nav (z-index 50 > 40). Same z-index masking pattern
// SalesDashboard uses today. User sees only the FAB nav.
//
// Backend doctrine (Phase 101.A1, live + verified 2026-05-29):
//   - users.agency_commission_percent (default 5.00, range 0..100)
//   - commission_earned = quote.subtotal × pct / 100
//   - Payable = won AND ≥1 payments.approval_status='approved'
//   - quotes.subtotal = GST-excluded base
//   - quotes.updated_at = Won-date proxy (no won_at column)
//
// Brand: reuses .v2-card / .v2-kpi / .v2-glance-head / .v2-nav /
// .v2-fab / .v2d-camp-* classes from src/styles/v2.css. No new CSS.

import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Home, FileText, Plus, BarChart3, Wallet, RefreshCw,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/authStore'
import { todayISO } from '../../utils/formatters'
import '../../styles/v2.css'

// ──────────────────────────────────────────────────────────────
// Helpers (kept local — copy-inline per Phase 101.B Q-101.B-2)
// ──────────────────────────────────────────────────────────────

function Money({ value }) {
  const n = Number(value) || 0
  return <>₹{new Intl.NumberFormat('en-IN').format(Math.round(n))}</>
}

function daysBetween(a, b) {
  const MS = 1000 * 60 * 60 * 24
  return Math.max(0, Math.round((new Date(a) - new Date(b)) / MS))
}

// IST-anchored YYYY-MM bucket (matches Phase 47.9 / istDate.js pattern).
function istThisMonth() {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
    }).format(new Date())
  } catch {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  }
}

function greeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

// ──────────────────────────────────────────────────────────────
// KPI tile — copy-inline of SalesDashboard Kpi (L485-503)
// ──────────────────────────────────────────────────────────────
function Kpi({ label, value, count, sub, tone, dot }) {
  const toneClass = tone === 'green' ? 'v2-kpi--green'
                  : tone === 'blue'  ? 'v2-kpi--blue'
                  : tone === 'rose'  ? 'v2-kpi--rose' : ''
  return (
    <div className={`v2-kpi ${toneClass}`}>
      {dot && <span className="v2-kpi-dot" />}
      <div className="v2-kpi-label">{label}</div>
      <div className="v2-kpi-value">
        {value !== undefined ? <Money value={value} /> : <>{count ?? 0}</>}
      </div>
      {sub && (
        <div style={{ marginTop: 2, fontSize: 11, color: 'var(--v2-ink-2)', fontWeight: 500 }}>
          {sub}
        </div>
      )}
    </div>
  )
}

// ──────────────────────────────────────────────────────────────
// ActiveCampaignsCard — copy-inline of SalesDashboard (L551-608)
// ──────────────────────────────────────────────────────────────
function ActiveCampaignsCard({ rows, onOpen }) {
  const today = todayISO()
  return (
    <div className="v2-card" style={{ padding: '14px 15px 12px' }}>
      <div className="v2-card-h">
        <div className="v2-card-t">My active campaigns</div>
        {rows.length > 0 && <div className="v2-badge v2-badge--green">{rows.length} running</div>}
      </div>
      {rows.length === 0 ? (
        <div className="v2-empty-hint" style={{ padding: '12px 0' }}>
          No active campaigns. Won quotes with a live window appear here.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 8 }}>
          {rows.map(r => {
            const daysLeft = daysBetween(r.campaign_end_date, today)
            const pillCls = daysLeft <= 3 ? 'v2d-camp-pill--end'
                          : daysLeft <= 7 ? 'v2d-camp-pill--soon'
                          : 'v2d-camp-pill--live'
            const pillLabel = daysLeft <= 3 ? 'Ending' : daysLeft <= 7 ? 'Soon' : 'Live'
            const totalDays = r.campaign_start_date
              ? daysBetween(r.campaign_end_date, r.campaign_start_date)
              : 30
            const elapsed = r.campaign_start_date
              ? Math.max(0, daysBetween(today, r.campaign_start_date))
              : 0
            const pct = totalDays > 0 ? Math.min(100, Math.round((elapsed / totalDays) * 100)) : 0
            const ageKey = r._ageKey || 'fresh'
            const ageBadge = ageKey === 'stale' ? { cls: 'v2d-camp-age--stale', label: `Stale ${r._ageDays}d` }
                           : ageKey === 'aging' ? { cls: 'v2d-camp-age--aging', label: `Aging ${r._ageDays}d` }
                           :                      { cls: 'v2d-camp-age--fresh', label: `Fresh ${r._ageDays}d` }
            return (
              <div
                key={r.id}
                className="v2d-camp"
                onClick={() => onOpen(r.id)}
                style={{ cursor: 'pointer' }}
              >
                <div className="v2d-camp-h">
                  <div className="v2d-camp-n" title={r.client_company || r.client_name}>
                    {r.client_company || r.client_name}
                  </div>
                  <span className={`v2d-camp-pill ${pillCls}`}>{pillLabel}</span>
                </div>
                <div className="v2d-camp-s">{r.quote_number}</div>
                <div className="v2d-camp-s" style={{ marginTop: 4, color: 'var(--v2-ink-0)', fontWeight: 700, fontSize: 13 }}>
                  {daysLeft} day{daysLeft === 1 ? '' : 's'} left · <Money value={r.subtotal || 0} />
                </div>
                <div className="v2d-camp-prog"><div className="v2d-camp-prog-fill" style={{ width: `${pct}%` }} /></div>
                <div className={`v2d-camp-age ${ageBadge.cls}`}>{ageBadge.label}</div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ──────────────────────────────────────────────────────────────
// BottomNav — copy-inline of SalesDashboard (L673-698)
// 5 slots: Home (active) / Quotes / [+] FAB / Earnings / Offer
// ──────────────────────────────────────────────────────────────
function BottomNav({ onNew, onNav }) {
  return (
    <nav className="v2-nav" aria-label="Primary">
      <div className="v2-nav-items">
        <button className="v2-nav-item v2-nav-item--active" type="button">
          <Home size={18} /> Home
        </button>
        <button className="v2-nav-item" type="button" onClick={() => onNav('quotes')}>
          <FileText size={18} /> Quotes
        </button>
        <div className="v2-nav-center">
          <button className="v2-fab" type="button" onClick={onNew} aria-label="New quote">
            <Plus size={24} strokeWidth={2.4} />
          </button>
          <span className="v2-fab-caption">CREATE QUOTE</span>
        </div>
        <button className="v2-nav-item" type="button" onClick={() => onNav('earnings')}>
          <BarChart3 size={18} /> Earnings
        </button>
        <button className="v2-nav-item" type="button" onClick={() => onNav('offer')}>
          <FileText size={18} /> Offer
        </button>
      </div>
    </nav>
  )
}

// ──────────────────────────────────────────────────────────────
// AgencyHomeView — main export
// ──────────────────────────────────────────────────────────────
export default function AgencyHomeView() {
  const profile = useAuthStore(s => s.profile)
  const navigate = useNavigate()
  const [state, setState] = useState({ loading: true })

  useEffect(() => {
    if (!profile?.id) return
    let cancelled = false
    async function load() {
      const uid = profile.id
      const monthKey = istThisMonth()
      const today = todayISO()

      // Single batched fetch — agency commission %, own quotes, own
      // payments slice by quote_id (broader than received_by so
      // admin-recorded payments still count toward Pending/Approved).
      // Step 1: quotes + user pct.
      const [userRes, qRes, fRes] = await Promise.all([
        supabase.from('users')
          .select('agency_commission_percent')
          .eq('id', uid)
          .maybeSingle(),
        supabase.from('quotes')
          .select('id, quote_number, client_name, client_company, subtotal, total_amount, status, revenue_type, created_at, updated_at, created_by, campaign_start_date, campaign_end_date')
          .eq('created_by', uid)
          .order('created_at', { ascending: false }),
        supabase.from('follow_ups')
          .select('id')
          .eq('assigned_to', uid)
          .eq('is_done', false)
          .lte('follow_up_date', today),
      ])
      if (cancelled) return

      const pct = Number(userRes.data?.agency_commission_percent ?? 5.00)
      const quotes = qRes.data || []
      const followups = fRes.data || []

      // Step 2: payments for own quote IDs (only if we have quotes).
      const myQuoteIds = quotes.map(q => q.id)
      let allPayments = []
      if (myQuoteIds.length > 0) {
        const { data: pays } = await supabase
          .from('payments')
          .select('quote_id, amount_received, approval_status, is_final_payment, payment_date')
          .in('quote_id', myQuoteIds)
        allPayments = pays || []
      }
      if (cancelled) return

      // Aggregations.
      const approvedByQuote = {}
      let pendingCount = 0
      let pendingValue = 0
      for (const p of allPayments) {
        if (p.approval_status === 'approved') {
          if (!approvedByQuote[p.quote_id]) {
            approvedByQuote[p.quote_id] = { paid: 0, final: false, lastDate: null }
          }
          approvedByQuote[p.quote_id].paid += Number(p.amount_received) || 0
          if (p.is_final_payment) approvedByQuote[p.quote_id].final = true
          if (p.payment_date && (!approvedByQuote[p.quote_id].lastDate
                || p.payment_date > approvedByQuote[p.quote_id].lastDate)) {
            approvedByQuote[p.quote_id].lastDate = p.payment_date
          }
        } else if (p.approval_status === 'pending') {
          pendingCount += 1
          pendingValue += Number(p.amount_received) || 0
        }
      }

      // Won this month — updated_at falls in current IST month.
      const wonThisMonth = quotes.filter(
        q => q.status === 'won' && (q.updated_at || '').slice(0, 7) === monthKey
      )
      const wonBase = wonThisMonth.reduce((s, q) => s + (Number(q.subtotal) || 0), 0)
      const commissionEarnedMonth = wonBase * pct / 100

      // Commission Payable — won quotes (any month) with ≥1 approved
      // payment, commission summed × pct.
      const payableQuotes = quotes.filter(
        q => q.status === 'won' && approvedByQuote[q.id]
      )
      const commissionPayable = payableQuotes.reduce(
        (s, q) => s + (Number(q.subtotal) || 0) * pct / 100, 0
      )

      // Quotes Sent — status sent/negotiating, created this month.
      const sentQuotes = quotes.filter(
        q => ['sent', 'negotiating'].includes(q.status)
          && (q.created_at || '').slice(0, 7) === monthKey
      )
      const quotesSentCount = sentQuotes.length
      const quotesSentValue = sentQuotes.reduce((s, q) => s + (Number(q.total_amount) || 0), 0)

      // Outstanding — non-lost quotes, total_amount − approved_paid > 0.
      const outstandingRows = quotes
        .filter(q => q.status !== 'lost')
        .map(q => {
          const a = approvedByQuote[q.id]
          const paid = a?.paid || 0
          const final = a?.final || false
          const committed = q.status === 'won' || paid > 0
          const balance = Math.max(0, (Number(q.total_amount) || 0) - paid)
          return { balance, final, committed }
        })
        .filter(r => r.committed && !r.final && r.balance > 0)
      const outstandingTotal = outstandingRows.reduce((s, r) => s + r.balance, 0)
      const outstandingCount = outstandingRows.length

      // Active campaigns — won + campaign_end_date >= today.
      const activeCampaigns = quotes
        .filter(q => q.status === 'won' && q.campaign_end_date && q.campaign_end_date >= today)
        .sort((a, b) => (a.campaign_end_date || '').localeCompare(b.campaign_end_date || ''))
        .slice(0, 6)
        .map(q => {
          const days = daysBetween(today, q.updated_at || q.created_at)
          const ageKey = days < 30 ? 'fresh' : days < 60 ? 'aging' : 'stale'
          return { ...q, _ageDays: days, _ageKey: ageKey }
        })

      setState({
        loading: false,
        pct,
        isZero: quotes.length === 0,
        commissionEarnedMonth,
        commissionPayable,
        wonBase,
        wonCount: wonThisMonth.length,
        quotesSentCount,
        quotesSentValue,
        pendingCount,
        pendingValue,
        todoCount: followups.length,
        outstanding: { total: outstandingTotal, count: outstandingCount },
        activeCampaigns,
      })
    }
    load()
    return () => { cancelled = true }
  }, [profile?.id])

  if (state.loading) {
    return (
      <div className="v2d">
        <div className="v2d-loading"><div className="v2d-spinner" /> Loading…</div>
      </div>
    )
  }

  const firstName = (profile?.name || 'there').split(' ')[0]

  return (
    <div className="v2-page">
      <div className="v2-page-body" style={{ paddingBottom: 96 }}>
        {/* Greeting + role marker */}
        <div className="v2-head" style={{ paddingTop: 4 }}>
          <div className="v2-hello">
            <div className="v2-hello-kicker">{greeting()}</div>
            <div className="v2-hello-name">{firstName}</div>
          </div>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '4px 10px', borderRadius: 999,
            background: 'var(--accent-soft)',
            color: 'var(--accent-fg)',
            border: '1px solid var(--accent)',
            fontSize: 11, fontWeight: 700,
            letterSpacing: '.06em',
          }}>
            <Wallet size={14} /> {state.pct.toFixed(2)}% AGENCY
          </div>
        </div>

        {/* Day-1 empty banner — Q-101.B-3 owner directive */}
        {state.isZero && (
          <div className="v2-banner v2-banner--reset">
            <RefreshCw size={16} strokeWidth={2.2} style={{ flexShrink: 0, marginTop: 1, color: 'var(--v2-yellow)' }} />
            <div>
              <span className="v2-banner-title">No quotes yet.</span>{' '}
              Tap the <b style={{ color: 'var(--v2-yellow)' }}>+</b> below to draft
              your first quote. Commission appears here once you create one and it moves to Won.
            </div>
          </div>
        )}

        <div className="v2-glance-head">This month at a glance</div>

        {/* 6 KPI tiles */}
        <div className="v2-kpi-grid">
          <Kpi
            label="Commission Earned"
            value={state.commissionEarnedMonth}
            sub={`${state.pct.toFixed(2)}% on won base · this month`}
            tone="green"
          />
          <Kpi
            label="Won Base"
            value={state.wonBase}
            sub={`${state.wonCount} quote${state.wonCount === 1 ? '' : 's'} · GST-excluded`}
            tone="blue"
          />
          <Kpi
            label="Commission Payable"
            value={state.commissionPayable}
            sub="After first approved payment"
            tone="green"
          />
          <Kpi
            label="Quotes Sent"
            value={state.quotesSentValue}
            sub={`${state.quotesSentCount} quote${state.quotesSentCount === 1 ? '' : 's'} · this month`}
            tone="blue"
          />
          <Kpi
            label="Pending Approval"
            count={state.pendingCount}
            tone="rose"
            dot={state.pendingCount > 0}
            sub={state.pendingValue > 0
              ? `₹${new Intl.NumberFormat('en-IN').format(Math.round(state.pendingValue))} awaiting`
              : null}
          />
          <Kpi
            label="Outstanding"
            value={state.outstanding?.total || 0}
            sub={`${state.outstanding?.count || 0} quote${(state.outstanding?.count || 0) === 1 ? '' : 's'} unpaid`}
            tone="rose"
            dot={(state.outstanding?.count || 0) > 0}
          />
        </div>

        {/* Follow-ups Due — full-width tile beneath the grid (visually
            distinct because agency follow-ups are typically rep-set
            reminders, not a SLA-style queue). */}
        {state.todoCount > 0 && (
          <div
            className="v2-card"
            onClick={() => navigate('/follow-ups')}
            style={{
              cursor: 'pointer',
              marginTop: 14,
              padding: '12px 15px',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              gap: 12,
            }}
          >
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.08em', color: 'var(--v2-ink-2)', textTransform: 'uppercase' }}>
                Follow-ups due
              </div>
              <div style={{ fontFamily: 'var(--v2-display)', fontWeight: 700, fontSize: 22, color: 'var(--v2-ink-0)', marginTop: 2 }}>
                {state.todoCount}
              </div>
            </div>
            <div style={{ fontSize: 12, color: 'var(--v2-yellow)', fontWeight: 700, letterSpacing: '.06em' }}>
              OPEN →
            </div>
          </div>
        )}

        {/* Active Campaigns card */}
        <ActiveCampaignsCard
          rows={state.activeCampaigns || []}
          onOpen={(id) => navigate(`/quotes/${id}`)}
        />

        <div className="v2-empty-hint" style={{ opacity: 0.6, marginTop: 14 }}>
          Agency commission ledger lives under Earnings — tap the bottom-nav.
        </div>
      </div>

      <BottomNav
        onNew={() => navigate('/quotes/new')}
        onNav={(k) => {
          if (k === 'quotes')   navigate('/quotes')
          if (k === 'earnings') navigate('/my-performance')
          if (k === 'offer')    navigate('/my-offer')
        }}
      />
    </div>
  )
}
