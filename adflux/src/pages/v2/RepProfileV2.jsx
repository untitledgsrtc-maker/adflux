// src/pages/v2/RepProfileV2.jsx
//
// Phase 90 (2026-05-23) — admin rep profile drill-down. Owner
// directive: "if i click on member then his/her all details shows
// — salary, KPI, profile, incentive, TA/DA, leaves, everything in
// one page". This is that page.
//
// Route: /people/:userId
// Mount sites that link in:
//   /people?tab=team rep card  → navigate(/people/<id>)
//   /team-dashboard rep card   → same
//   /admin/gps/<id> top header → same (back-link)
//   Topbar own-avatar click    → /people/<self-id>
//
// Sections (single scroll, top → bottom):
//   1. Header  — avatar, name, role, manager, segment, edit chips
//   2. KPI targets  — daily_targets row, with [Edit] modal
//   3. KPI actuals — today / this week / this month tiles
//   4. Salary — current month compute_monthly_salary, payout history
//   5. Incentive — current month forecast + payout history
//   6. TA / DA — pending + approved this month
//   7. Leaves — used + balance, recent rows
//   8. Activity — last 30-day rollup + link to /admin/gps day-view
//
// Read-mostly v1. Edit surfaces re-use existing modals:
//   TeamMemberModal (profile)
//   IncentivePayoutModal (incentive payout)
//   SalaryPayoutModal (salary payout)
// New small modal: EditTargetsModal (daily_targets edits).
//
// Role gate: admin / co_owner only. Reps hitting this URL bounce to
// /dashboard.

import { useEffect, useMemo, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import {
  ArrowLeft, Edit3, Mail, Shield,
  Wallet, Gift, Coins, Calendar,
  AlertCircle, ChevronRight, Settings, Loader2,
  CheckCircle2, Clock,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/authStore'
import { pushToast, toastError, toastSuccess } from '../../components/v2/Toast'
import { confirmDialog } from '../../components/v2/ConfirmDialog'
import { TeamMemberModal } from '../../components/team/TeamMemberModal'
import { SalaryPayoutModal } from '../../components/incentives/SalaryPayoutModal'
import { IncentivePayoutModal } from '../../components/incentives/IncentivePayoutModal'
import { istCurrentMonthYM, istCurrentMonthLabel, istTodayISO } from '../../utils/istDate'

// ─── Helpers ────────────────────────────────────────────────────────
function fmtINR(n) {
  if (n == null || !Number.isFinite(Number(n))) return '—'
  return `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`
}
function fmtPct(n) {
  if (n == null) return '—'
  return `${Math.round(n)}%`
}
function safeNum(x, d = 0) {
  const n = Number(x)
  return Number.isFinite(n) ? n : d
}

// IST week-start (Monday). Returns YYYY-MM-DD.
function istWeekStartISO() {
  const todayIso = istTodayISO()
  const [y, m, d] = todayIso.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  // 0 = Sunday in UTC getUTCDay; shift to Monday-first
  const dow = (dt.getUTCDay() + 6) % 7
  dt.setUTCDate(dt.getUTCDate() - dow)
  return dt.toISOString().slice(0, 10)
}

// Day-start ISO timestamp (loose IST anchor — same approach used by
// /admin/gps + Team Dashboard, accepts the +5:30 fuzziness).
function dayStartIso(ymd) {
  return `${ymd}T00:00:00+05:30`
}
function dayEndIso(ymd) {
  return `${ymd}T23:59:59.999+05:30`
}

// ─── Small UI primitives ────────────────────────────────────────────
function Tile({ label, value, tone, sub }) {
  const color = tone === 'success' ? 'var(--success)'
              : tone === 'warn'    ? 'var(--warning)'
              : tone === 'danger'  ? 'var(--danger)'
              : 'var(--text)'
  return (
    <div style={{
      background: 'var(--v2-bg-1, var(--surface))',
      border: '1px solid var(--v2-line, var(--border))',
      borderRadius: 14, padding: '12px 14px',
    }}>
      <div style={{
        fontSize: 10.5, letterSpacing: '.12em', textTransform: 'uppercase',
        color: 'var(--v2-ink-2, var(--text-muted))', fontWeight: 700,
      }}>{label}</div>
      <div style={{
        fontFamily: 'var(--v2-display, var(--font-display))',
        fontSize: 22, fontWeight: 700, color, marginTop: 4,
      }}>{value}</div>
      {sub && (
        <div style={{
          fontSize: 11, color: 'var(--v2-ink-2, var(--text-subtle))', marginTop: 4,
        }}>{sub}</div>
      )}
    </div>
  )
}

function SectionCard({ title, sub, action, children }) {
  return (
    <div style={{
      background: 'var(--v2-bg-1, var(--surface))',
      border: '1px solid var(--v2-line, var(--border))',
      borderRadius: 14, padding: 0, overflow: 'hidden',
      marginBottom: 16,
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '14px 18px', borderBottom: '1px solid var(--v2-line, var(--border))',
      }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--v2-ink-0, var(--text))' }}>
            {title}
          </div>
          {sub && (
            <div style={{ fontSize: 11.5, color: 'var(--v2-ink-2, var(--text-muted))', marginTop: 2 }}>
              {sub}
            </div>
          )}
        </div>
        {action}
      </div>
      <div style={{ padding: 18 }}>{children}</div>
    </div>
  )
}

// ─── KPI targets edit modal ────────────────────────────────────────
// Small in-line modal to flip the rep's daily_targets row. Admin /
// co_owner only. UPSERT pattern — creates if missing.
function EditTargetsModal({ userId, current, onClose, onSaved }) {
  const [minCalls, setMinCalls]               = useState(current?.min_calls ?? 50)
  const [minConnect, setMinConnect]           = useState(current?.min_connect_pct ?? 30)
  const [minQualWk, setMinQualWk]             = useState(current?.min_qualified_weekly ?? 5)
  const [minMeetings, setMinMeetings]         = useState(current?.min_meetings ?? 5)
  const [saving, setSaving]                   = useState(false)

  async function handleSave() {
    setSaving(true)
    const payload = {
      user_id:                userId,
      min_calls:              safeNum(minCalls, 50),
      min_connect_pct:        safeNum(minConnect, 30),
      min_qualified_weekly:   safeNum(minQualWk, 5),
      min_meetings:           safeNum(minMeetings, 5),
      effective_from:         istTodayISO(),
      effective_to:           null,
    }
    // Close any prior open row (effective_to = today) so history is preserved.
    await supabase.from('daily_targets')
      .update({ effective_to: istTodayISO() })
      .eq('user_id', userId)
      .is('effective_to', null)
    const { error } = await supabase.from('daily_targets').insert([payload])
    setSaving(false)
    if (error) {
      toastError(error, 'Could not save targets.')
      return
    }
    pushToast('Targets updated.', 'success')
    onSaved?.()
    onClose?.()
  }

  return (
    <div onClick={(e) => { if (e.target === e.currentTarget && !saving) onClose?.() }}
         style={{
           position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)',
           display: 'flex', alignItems: 'center', justifyContent: 'center',
           zIndex: 9000, padding: 16,
         }}>
      <div style={{
        background: 'var(--v2-bg-1, var(--surface))',
        border: '1px solid var(--v2-line, var(--border))',
        borderRadius: 14, padding: 20, width: '100%', maxWidth: 420,
      }}>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 14 }}>
          Edit KPI targets
        </div>
        {[
          ['Min calls / day',        minCalls,   setMinCalls],
          ['Min connect %',          minConnect, setMinConnect],
          ['Min qualified / week',   minQualWk,  setMinQualWk],
          ['Min meetings / day',     minMeetings,setMinMeetings],
        ].map(([label, value, setter]) => (
          <div key={label} style={{ marginBottom: 12 }}>
            <label style={{
              display: 'block', fontSize: 11.5, fontWeight: 600,
              color: 'var(--v2-ink-2, var(--text-muted))', marginBottom: 4,
              textTransform: 'uppercase', letterSpacing: '.08em',
            }}>{label}</label>
            <input
              type="number" inputMode="numeric" min="0"
              value={value}
              onChange={e => setter(e.target.value)}
              disabled={saving}
              style={{
                width: '100%',
                background: 'var(--v2-bg-2, var(--surface-2))',
                color: 'var(--v2-ink-0, var(--text))',
                border: '1px solid var(--v2-line, var(--border))',
                borderRadius: 10, padding: '10px 12px',
                fontSize: 14, fontFamily: 'inherit',
              }}
            />
          </div>
        ))}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
          <button onClick={onClose} disabled={saving}
                  style={{
                    padding: '10px 16px', borderRadius: 10,
                    background: 'transparent',
                    color: 'var(--v2-ink-1, var(--text-muted))',
                    border: '1px solid var(--v2-line, var(--border))',
                    cursor: 'pointer', fontFamily: 'inherit',
                  }}>
            Cancel
          </button>
          <button onClick={handleSave} disabled={saving}
                  style={{
                    padding: '10px 16px', borderRadius: 10,
                    background: 'var(--v2-yellow, #FFE600)',
                    color: 'var(--accent-fg, #0f172a)',
                    border: 'none', fontWeight: 700,
                    cursor: 'pointer', fontFamily: 'inherit',
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                  }}>
            {saving && <Loader2 size={14} className="spin" />}
            Save
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Main page ──────────────────────────────────────────────────────
export default function RepProfileV2() {
  const { userId } = useParams()
  const navigate = useNavigate()
  const profile = useAuthStore(s => s.profile)
  const isAdmin = ['admin', 'co_owner'].includes(profile?.role)
  // Phase 87.5b — HR sign-off helpers. HR can accept but cannot
  // unaccept; admin / co_owner can do both. canViewPage gates the
  // entire route (Phase 90's original isAdmin-only gate widens to
  // admin / co_owner / hr to match the RequireHROrPrivileged route
  // guard added in App.jsx). Without this widening, HR would pass
  // the route guard but bounce off the in-page useEffect redirect.
  const isHR         = profile?.role === 'hr'
  const canViewPage  = isAdmin || isHR
  const canAccept    = isAdmin || isHR
  const canUnaccept  = isAdmin

  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState('')
  const [user, setUser]       = useState(null)
  const [targets, setTargets] = useState(null)
  const [kpi, setKpi]         = useState({
    callsToday: 0, callsWeek: 0, callsMonth: 0,
    meetingsToday: 0, meetingsMonth: 0,
    qualifiedToday: 0, qualifiedWeek: 0,
    leadsAssigned: 0, newLeadsMonth: 0,
    wonMonth: 0, pipelineMonth: 0,
  })
  const [salary, setSalary]       = useState(null)
  const [incentivePayouts, setIncentivePayouts] = useState([])
  const [salaryPayouts, setSalaryPayouts]       = useState([])
  const [taSummary, setTaSummary] = useState({ pending: 0, approvedMonth: 0 })
  const [leavesSummary, setLeavesSummary] = useState({ used: 0, paid: 0, unpaid: 0, pending: 0 })

  // Phase 87.5b — HR sign-off action busy flag.
  const [acceptBusy, setAcceptBusy] = useState(false)

  // Edit-modal toggles
  const [editProfileOpen, setEditProfileOpen]   = useState(false)
  const [editTargetsOpen, setEditTargetsOpen]   = useState(false)
  const [salaryPayoutOpen, setSalaryPayoutOpen] = useState(false)
  const [incentivePayoutOpen, setIncentivePayoutOpen] = useState(false)

  // Role gate
  useEffect(() => {
    // Phase 87.5b — widened from `!isAdmin` to `!canViewPage` so the
    // HR role can land here without the in-page useEffect bouncing
    // them to /dashboard.
    if (profile && !canViewPage) navigate('/dashboard', { replace: true })
  }, [profile, canViewPage, navigate])

  const monthYm = istCurrentMonthYM()
  const monthLabel = istCurrentMonthLabel()
  const todayYmd = istTodayISO()
  const weekStartYmd = istWeekStartISO()
  const monthStartYmd = `${monthYm}-01`

  // ─── Load everything ─────────────────────────────────────────────
  // Phase 87.5b — HR sign-off actions. Both RPCs check role at DB
  // level (SECURITY DEFINER + get_my_role() gate). Client gate is
  // UX-only; the RPC is the enforcement boundary.
  async function handleAccept() {
    if (!user?.id) return
    if (!canAccept) return
    const ok = await confirmDialog({
      title: 'Accept this rep’s profile?',
      message: `Mark ${user.name || 'this rep'} as HR-accepted. This is a one-time sign-off; admin can reverse it later if needed.`,
      confirmLabel: 'Accept',
      cancelLabel: 'Cancel',
    })
    if (!ok) return
    setAcceptBusy(true)
    const { error: rpcErr } = await supabase.rpc('accept_user_profile', {
      p_user_id: user.id,
      p_note: null,
    })
    setAcceptBusy(false)
    if (rpcErr) {
      toastError(rpcErr, 'Could not accept profile.')
      return
    }
    toastSuccess('Profile accepted.')
    loadAll()
  }

  async function handleUnaccept() {
    if (!user?.id) return
    if (!canUnaccept) return
    const ok = await confirmDialog({
      title: 'Reverse HR acceptance?',
      message: `Clear the HR-accepted sign-off for ${user.name || 'this rep'}. Use this if it was marked accepted by mistake.`,
      confirmLabel: 'Reverse',
      cancelLabel: 'Cancel',
      danger: true,
    })
    if (!ok) return
    setAcceptBusy(true)
    const { error: rpcErr } = await supabase.rpc('unaccept_user_profile', {
      p_user_id: user.id,
    })
    setAcceptBusy(false)
    if (rpcErr) {
      toastError(rpcErr, 'Could not reverse acceptance.')
      return
    }
    toastSuccess('Acceptance reversed.')
    loadAll()
  }

  async function loadAll() {
    // Phase 87.5b — widened from `!isAdmin` to `!canViewPage` so HR
    // gets the data fetch instead of an early return.
    if (!userId || !canViewPage) return
    setLoading(true)
    setError('')
    try {
      const dayStart   = dayStartIso(todayYmd)
      const dayEnd     = dayEndIso(todayYmd)
      const weekStart  = dayStartIso(weekStartYmd)
      const monthStart = dayStartIso(monthStartYmd)

      const [
        userRes, targetsRes,
        callsTodayRes, callsWeekRes, callsMonthRes,
        actMonthRes, leadsAssignedRes, leadsCreatedMonthRes,
        quotesWonRes, incentivePayoutsRes, salaryPayoutsRes,
        taPendingRes, taApprovedMonthRes, leavesAllRes,
      ] = await Promise.all([
        // Phase 90 hotfix — drop phone + join_date from users select.
        // Schema: users has no phone column (clients table has phone).
        // join_date lives on staff_incentive_profiles, not users.
        // Pulling those threw "column users.phone does not exist".
        // Phase 87.5b — extend with hr_accepted_at, hr_accepted_by,
        // hr_acceptance_note + joined acceptor name for the HR
        // sign-off section.
        supabase.from('users')
          .select('id, name, email, role, team_role, manager_id, segment_access, city, is_active, profile_image_url, manager:manager_id(id, name), hr_accepted_at, hr_accepted_by, hr_acceptance_note, hr_accepter:hr_accepted_by(id, name)')
          .eq('id', userId)
          .maybeSingle(),
        supabase.from('daily_targets')
          .select('min_calls, min_connect_pct, min_qualified_weekly, min_meetings, effective_from, effective_to')
          .eq('user_id', userId)
          .is('effective_to', null)
          .maybeSingle(),
        // Phase 93.24 — all 3 buckets filter to lead-tied calls only.
        // Calls today (>=10s qualified, lead-tied)
        supabase.from('call_logs').select('id, outcome, duration_seconds', { count: 'exact' })
          .eq('user_id', userId).gte('call_at', dayStart).lte('call_at', dayEnd)
          .gte('duration_seconds', 10)
          .not('lead_id', 'is', null),
        // Calls this week (>=10s, lead-tied)
        supabase.from('call_logs').select('id', { count: 'exact', head: true })
          .eq('user_id', userId).gte('call_at', weekStart)
          .gte('duration_seconds', 10)
          .not('lead_id', 'is', null),
        // Calls this month (>=10s, lead-tied)
        supabase.from('call_logs').select('id', { count: 'exact', head: true })
          .eq('user_id', userId).gte('call_at', monthStart)
          .gte('duration_seconds', 10)
          .not('lead_id', 'is', null),
        // Activities this month (meetings + site_visit + qualifications).
        // id + notes + lead_id needed for the §33 done-meeting contract
        // (exclusions + unique-lead-per-day dedup) applied below.
        supabase.from('lead_activities')
          .select('id, activity_type, created_at, notes, lead_id')
          .eq('created_by', userId)
          .gte('created_at', monthStart),
        // Leads currently assigned (active stages)
        supabase.from('leads').select('id', { count: 'exact', head: true })
          .or(`assigned_to.eq.${userId},telecaller_id.eq.${userId}`)
          .not('stage', 'in', '(Won,Lost)'),
        // New leads created this month
        supabase.from('leads').select('id', { count: 'exact', head: true })
          .eq('created_by', userId)
          .gte('created_at', monthStart),
        // Quotes won this month (use updated_at as proxy per CLAUDE.md §33)
        supabase.from('quotes')
          .select('total_amount, status, updated_at, created_by')
          .eq('status', 'won')
          .eq('created_by', userId)
          .gte('updated_at', monthStart),
        // Incentive payouts (last 12). Phase 90 hotfix — column is
        // `staff_id` not `user_id` (legacy migration name).
        supabase.from('incentive_payouts')
          .select('id, month_year, amount_paid, paid_date, note')
          .eq('staff_id', userId)
          .order('paid_date', { ascending: false })
          .limit(12),
        // Salary payouts (last 12)
        supabase.from('salary_payouts')
          .select('id, month_year, amount_paid, is_full_payment, paid_date, note')
          .eq('user_id', userId)
          .order('paid_date', { ascending: false })
          .limit(12),
        // TA pending count
        supabase.from('ta_da_requests').select('id', { count: 'exact', head: true })
          .eq('user_id', userId).eq('status', 'pending'),
        // TA approved this month. Phase 90 hotfix — column is
        // `claim_amount`, not `approved_amount`. Once approved, the
        // claim_amount is what gets paid out (admin can edit it
        // before approving, see TaPayoutsAdminV2 flow).
        supabase.from('ta_da_requests')
          .select('claim_amount, claim_date')
          .eq('user_id', userId).eq('status', 'approved')
          .gte('claim_date', monthStartYmd),
        // Leaves this calendar year. Phase 90 hotfix — leaves table
        // has `leave_date` (one row per day), not `from_date`/`days`.
        // Phase 36.10 added `is_paid_request` + `is_half_day`. Use
        // row count for total days; half-day counts as 0.5.
        supabase.from('leaves')
          .select('id, status, leave_type, is_paid_request, is_half_day, leave_date')
          .eq('user_id', userId)
          .gte('leave_date', `${monthYm.slice(0, 4)}-01-01`),
      ])

      if (userRes.error) throw userRes.error
      if (!userRes.data) throw new Error('User not found')
      setUser(userRes.data)
      setTargets(targetsRes?.data || null)

      const meetingsToday = (callsTodayRes.data || [])
        .filter(() => false).length  // placeholder — meetings counted separately
      void meetingsToday  // unused; computed via lead_activities below

      setKpi(prev => ({ ...prev,
        callsToday:    callsTodayRes.count ?? 0,
        callsWeek:     callsWeekRes.count  ?? 0,
        callsMonth:    callsMonthRes.count ?? 0,
        leadsAssigned: leadsAssignedRes.count ?? 0,
        newLeadsMonth: leadsCreatedMonthRes.count ?? 0,
        wonMonth:      (quotesWonRes.data || []).length,
        pipelineMonth: (quotesWonRes.data || []).reduce((s, q) => s + safeNum(q.total_amount), 0),
      }))

      // Activities — derive meetings via the §33 done-meeting contract
      // (same as the dashboard/counter/report): meeting+site_visit MINUS
      // scheduled-future + auto-check-in rows, deduped to ONE per lead
      // per IST day (walk-ins without a lead each count once via id).
      // This tile sits next to payout history — it must not inflate.
      const acts = actMonthRes.data || []
      const isDoneMeeting = (a) =>
        (a.activity_type === 'meeting' || a.activity_type === 'site_visit')
        && !(a.notes || '').startsWith('Meeting scheduled')
        && !(a.notes || '').startsWith("I'm here · auto-check-in")
      const istDayOf = (iso) => {
        try { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(iso)) }
        catch { return String(iso).slice(0, 10) }
      }
      const uniqueDoneMeetings = (rows) => {
        const seen = new Set()
        rows.filter(isDoneMeeting).forEach((a) => seen.add(`${istDayOf(a.created_at)}|${a.lead_id || a.id}`))
        return seen.size
      }
      const meetingsMonth = uniqueDoneMeetings(acts)
      const meetingsTodayCount = uniqueDoneMeetings(
        acts.filter(a => a.created_at >= dayStart && a.created_at <= dayEnd)
      )
      setKpi(prev => ({ ...prev,
        meetingsToday: meetingsTodayCount,
        meetingsMonth,
      }))

      // Incentive + salary payouts
      setIncentivePayouts(incentivePayoutsRes.data || [])
      setSalaryPayouts(salaryPayoutsRes.data || [])

      // TA summary
      const taApproved = (taApprovedMonthRes.data || [])
        .reduce((s, r) => s + safeNum(r.claim_amount), 0)
      setTaSummary({
        pending: taPendingRes.count ?? 0,
        approvedMonth: taApproved,
      })

      // Leaves summary. Each row = one day (or half-day). Sum days
      // with the half-day discount applied.
      function dayValue(row) {
        return row.is_half_day ? 0.5 : 1
      }
      const leaves = leavesAllRes.data || []
      const usedDays = leaves
        .filter(l => l.status === 'approved')
        .reduce((s, r) => s + dayValue(r), 0)
      const paidDays = leaves
        .filter(l => l.status === 'approved' && l.is_paid_request)
        .reduce((s, r) => s + dayValue(r), 0)
      const unpaidDays = usedDays - paidDays
      const pendingLeaves = leaves.filter(l => l.status === 'pending').length
      setLeavesSummary({
        used: usedDays, paid: paidDays, unpaid: unpaidDays, pending: pendingLeaves,
      })

      // Salary forecast via RPC. Phase 36.10 signature:
      // compute_monthly_salary(p_user_id uuid, p_year int, p_month int).
      const [yStr, mStr] = monthYm.split('-')
      const { data: salaryRes, error: salaryErr } = await supabase.rpc('compute_monthly_salary', {
        p_user_id: userId,
        p_year:    Number(yStr),
        p_month:   Number(mStr),
      })
      if (salaryErr) console.warn('[RepProfileV2] salary RPC:', salaryErr.message)
      setSalary(salaryRes || null)
    } catch (e) {
      console.error('[RepProfileV2] load failed:', e)
      setError(e?.message || 'Could not load profile.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
    // Phase 87.5b — deps updated from `isAdmin` to `canViewPage` so
    // the effect re-runs when an HR session hydrates.
  }, [userId, canViewPage])

  // Derived month-paid totals from payout history
  const monthPaidIncentive = useMemo(() =>
    incentivePayouts.filter(p => p.month_year === monthYm)
                    .reduce((s, p) => s + safeNum(p.amount_paid), 0),
    [incentivePayouts, monthYm])
  const monthPaidSalary = useMemo(() =>
    salaryPayouts.filter(p => p.month_year === monthYm)
                 .reduce((s, p) => s + safeNum(p.amount_paid), 0),
    [salaryPayouts, monthYm])

  // Phase 87.5b — widened from `!isAdmin` to `!canViewPage` so HR
  // doesn't get a blank null render.
  if (!canViewPage) return null

  if (loading) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
        <Loader2 size={20} className="spin" />
        <div style={{ marginTop: 10 }}>Loading rep profile…</div>
      </div>
    )
  }

  if (error || !user) {
    return (
      <div style={{ padding: 40, color: 'var(--danger)' }}>
        <AlertCircle size={20} />
        <div style={{ marginTop: 10 }}>{error || 'Profile not found.'}</div>
        <button onClick={() => navigate(-1)} style={{
          marginTop: 12, padding: '8px 14px', borderRadius: 10,
          background: 'transparent', border: '1px solid var(--border)',
          color: 'var(--text)', cursor: 'pointer',
        }}>
          ← Back
        </button>
      </div>
    )
  }

  const callsTargetDay   = targets?.min_calls            ?? (user.role === 'telecaller' ? 50 : 20)
  const qualTargetWeek   = targets?.min_qualified_weekly ?? 5
  const meetingsTarget   = targets?.min_meetings         ?? (user.role === 'telecaller' ? 0 : 5)

  return (
    <div className="v2d-rep-profile" style={{ maxWidth: 1100, margin: '0 auto' }}>

      {/* ─── 1. Header ─────────────────────────────────────────────── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14,
        color: 'var(--text-muted)', fontSize: 12.5,
      }}>
        <Link to="/people" style={{ color: 'inherit', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <ArrowLeft size={14} /> Back to People
        </Link>
        <span style={{ opacity: .4 }}>·</span>
        <Link to={`/admin/gps/${user.id}`} style={{ color: 'var(--v2-yellow, #FFE600)', textDecoration: 'none' }}>
          Today's track →
        </Link>
      </div>

      <SectionCard
        title={user.name || '—'}
        sub={[
          user.role,
          user.team_role && user.team_role !== user.role ? user.team_role : null,
          user.segment_access && user.segment_access !== 'ALL' ? user.segment_access : null,
          user.manager?.name ? `reports to ${user.manager.name}` : null,
          user.city,
        ].filter(Boolean).join(' · ')}
        action={
          <button onClick={() => setEditProfileOpen(true)} style={{
            background: 'transparent', border: '1px solid var(--v2-line, var(--border))',
            color: 'var(--v2-ink-1, var(--text))', borderRadius: 10,
            padding: '8px 12px', cursor: 'pointer', display: 'inline-flex',
            alignItems: 'center', gap: 6, fontFamily: 'inherit', fontSize: 13,
          }}>
            <Edit3 size={13} /> Edit profile
          </button>
        }
      >
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: 10,
        }}>
          {user.email && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
              <Mail size={14} strokeWidth={1.6} style={{ color: 'var(--text-muted)' }} />
              {user.email}
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
            <Shield size={14} strokeWidth={1.6} style={{
              color: user.is_active ? 'var(--success)' : 'var(--danger)',
            }} />
            {user.is_active ? 'Active' : 'Inactive'}
          </div>
        </div>
      </SectionCard>

      {/* ─── 1b. HR Acceptance (Phase 87.5b) ──────────────────────── */}
      <SectionCard
        title="HR acceptance"
        sub={user.hr_accepted_at
          ? `Signed off on ${new Date(user.hr_accepted_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}${user.hr_accepter?.name ? ` by ${user.hr_accepter.name}` : ''}`
          : 'Not yet signed off by HR — informational only, does not block the rep’s workflow.'}
        action={
          user.hr_accepted_at
            ? (canUnaccept ? (
                <button
                  onClick={handleUnaccept}
                  disabled={acceptBusy}
                  style={{
                    background: 'transparent',
                    border: '1px solid var(--danger, #EF4444)',
                    color: 'var(--danger, #EF4444)',
                    borderRadius: 10,
                    padding: '8px 12px', cursor: acceptBusy ? 'wait' : 'pointer',
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    fontFamily: 'inherit', fontSize: 13,
                  }}
                >
                  {acceptBusy && <Loader2 size={13} className="spin" />}
                  Reverse acceptance
                </button>
              ) : null)
            : (canAccept ? (
                <button
                  onClick={handleAccept}
                  disabled={acceptBusy}
                  style={{
                    background: 'var(--v2-yellow, #FFE600)',
                    border: '1px solid var(--v2-yellow, #FFE600)',
                    color: 'var(--accent-fg, #0f172a)',
                    borderRadius: 10,
                    padding: '8px 14px', cursor: acceptBusy ? 'wait' : 'pointer',
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    fontFamily: 'inherit', fontSize: 13, fontWeight: 600,
                  }}
                >
                  {acceptBusy ? <Loader2 size={13} className="spin" /> : <CheckCircle2 size={13} strokeWidth={1.8} />}
                  Accept profile
                </button>
              ) : null)
        }
      >
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 8,
          padding: '8px 14px',
          borderRadius: 999,
          fontSize: 12, fontWeight: 600,
          background: user.hr_accepted_at
            ? 'var(--success-soft, rgba(16,185,129,0.12))'
            : 'var(--warning-soft, rgba(245,158,11,0.12))',
          color: user.hr_accepted_at
            ? 'var(--success, #10B981)'
            : 'var(--warning, #F59E0B)',
          border: `1px solid ${user.hr_accepted_at ? 'var(--success, #10B981)' : 'var(--warning, #F59E0B)'}`,
        }}>
          {user.hr_accepted_at
            ? <CheckCircle2 size={14} strokeWidth={1.8} />
            : <Clock size={14} strokeWidth={1.8} />}
          {user.hr_accepted_at ? 'Accepted by HR' : 'Pending HR acceptance'}
        </div>
        {user.hr_acceptance_note && (
          <div style={{
            marginTop: 10,
            padding: '10px 12px',
            borderRadius: 10,
            background: 'var(--v2-bg-2, var(--surface-2))',
            border: '1px solid var(--v2-line, var(--border))',
            fontSize: 12.5, lineHeight: 1.5,
            color: 'var(--v2-ink-1, var(--text))',
            whiteSpace: 'pre-wrap',
          }}>
            <span style={{ color: 'var(--v2-ink-2, var(--text-muted))', fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', display: 'block', marginBottom: 4, fontWeight: 600 }}>
              HR note
            </span>
            {user.hr_acceptance_note}
          </div>
        )}
      </SectionCard>

      {/* ─── 2. KPI targets ────────────────────────────────────────── */}
      <SectionCard
        title="KPI targets"
        sub={targets?.effective_from
          ? `Effective from ${new Date(targets.effective_from).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`
          : 'No targets row — using defaults. Set explicit targets.'}
        action={
          <button onClick={() => setEditTargetsOpen(true)} style={{
            background: 'transparent', border: '1px solid var(--v2-line, var(--border))',
            color: 'var(--v2-ink-1, var(--text))', borderRadius: 10,
            padding: '8px 12px', cursor: 'pointer', display: 'inline-flex',
            alignItems: 'center', gap: 6, fontFamily: 'inherit', fontSize: 13,
          }}>
            <Settings size={13} /> Edit targets
          </button>
        }
      >
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
          gap: 12,
        }}>
          <Tile label="Min calls / day"      value={callsTargetDay} />
          <Tile label="Min connect %"        value={`${targets?.min_connect_pct ?? 30}%`} />
          <Tile label="Min qualified / week" value={qualTargetWeek} />
          <Tile label="Min meetings / day"   value={meetingsTarget || '—'} />
        </div>
      </SectionCard>

      {/* ─── 3. KPI actuals ────────────────────────────────────────── */}
      <SectionCard title="Today / week / month" sub={`Calls counted = duration ≥ 10 sec · ${monthLabel}`}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* TODAY row */}
          <div>
            <div style={{
              fontSize: 11, color: 'var(--text-muted)', letterSpacing: '.12em',
              textTransform: 'uppercase', fontWeight: 700, marginBottom: 6,
            }}>Today</div>
            <div style={{
              display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
              gap: 10,
            }}>
              <Tile label="Calls" value={`${kpi.callsToday}/${callsTargetDay}`}
                    tone={kpi.callsToday >= callsTargetDay ? 'success' : kpi.callsToday > 0 ? 'warn' : 'danger'} />
              {user.role !== 'telecaller' && (
                <Tile label="Meetings" value={`${kpi.meetingsToday}/${meetingsTarget || 0}`}
                      tone={kpi.meetingsToday >= meetingsTarget ? 'success' : kpi.meetingsToday > 0 ? 'warn' : ''} />
              )}
            </div>
          </div>
          {/* WEEK row */}
          <div>
            <div style={{
              fontSize: 11, color: 'var(--text-muted)', letterSpacing: '.12em',
              textTransform: 'uppercase', fontWeight: 700, marginBottom: 6,
            }}>This week</div>
            <div style={{
              display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
              gap: 10,
            }}>
              <Tile label="Calls" value={kpi.callsWeek} />
              <Tile label="Qualified (week)" value={kpi.qualifiedWeek || '—'} sub={`target ${qualTargetWeek}`} />
            </div>
          </div>
          {/* MONTH row */}
          <div>
            <div style={{
              fontSize: 11, color: 'var(--text-muted)', letterSpacing: '.12em',
              textTransform: 'uppercase', fontWeight: 700, marginBottom: 6,
            }}>This month ({monthLabel})</div>
            <div style={{
              display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
              gap: 10,
            }}>
              <Tile label="Calls" value={kpi.callsMonth} />
              <Tile label="Meetings" value={kpi.meetingsMonth} />
              <Tile label="Leads created" value={kpi.newLeadsMonth} />
              <Tile label="Open leads" value={kpi.leadsAssigned} />
              <Tile label="Won deals" value={kpi.wonMonth} />
              <Tile label="Pipeline" value={fmtINR(kpi.pipelineMonth)}
                    tone={kpi.pipelineMonth > 0 ? 'success' : ''} />
            </div>
          </div>
        </div>
      </SectionCard>

      {/* ─── 4. Salary ────────────────────────────────────────────── */}
      <SectionCard
        title={`Salary · ${monthLabel}`}
        sub={salary
          ? `Net payable ${fmtINR(salary.netPayable)} · already paid ${fmtINR(monthPaidSalary)}`
          : 'Salary RPC unavailable.'}
        action={
          <button onClick={() => setSalaryPayoutOpen(true)} style={{
            background: 'var(--v2-yellow, #FFE600)', color: 'var(--accent-fg, #0f172a)',
            border: 'none', borderRadius: 10, padding: '8px 14px',
            cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6,
            fontFamily: 'inherit', fontSize: 13, fontWeight: 700,
          }}>
            <Wallet size={13} /> Pay salary
          </button>
        }
      >
        {salary && (
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
            gap: 12,
          }}>
            <Tile label="Base"        value={fmtINR(salary.base)} />
            <Tile label="Incentive"   value={fmtINR(salary.incentive)} />
            <Tile label="TA / DA"     value={fmtINR(salary.taTotal || salary.ta_total || 0)} />
            <Tile label="Deductions"  value={fmtINR(salary.deductions || 0)}
                  tone={(salary.deductions || 0) > 0 ? 'danger' : ''} />
            <Tile label="Net payable" value={fmtINR(salary.netPayable)} tone="success" />
            <Tile label="Already paid" value={fmtINR(monthPaidSalary)} />
            <Tile label="Pending"     value={fmtINR(safeNum(salary.netPayable) - monthPaidSalary)}
                  tone={salary.netPayable - monthPaidSalary > 0 ? 'warn' : 'success'} />
          </div>
        )}
        {salaryPayouts.length > 0 && (
          <div style={{ marginTop: 18 }}>
            <div style={{
              fontSize: 11, color: 'var(--text-muted)', letterSpacing: '.12em',
              textTransform: 'uppercase', fontWeight: 700, marginBottom: 8,
            }}>Last 12 salary payouts</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {salaryPayouts.map(p => (
                <div key={p.id} style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '8px 12px', background: 'var(--v2-bg-2, var(--surface-2))',
                  borderRadius: 10, fontSize: 13,
                }}>
                  <span>{p.month_year} · {p.paid_date}</span>
                  <span style={{ fontWeight: 700 }}>{fmtINR(p.amount_paid)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </SectionCard>

      {/* ─── 5. Incentive ─────────────────────────────────────────── */}
      <SectionCard
        title={`Incentive · ${monthLabel}`}
        sub={`Paid this month: ${fmtINR(monthPaidIncentive)}`}
        action={
          <button onClick={() => setIncentivePayoutOpen(true)} style={{
            background: 'transparent', border: '1px solid var(--v2-line, var(--border))',
            color: 'var(--v2-ink-1, var(--text))', borderRadius: 10,
            padding: '8px 12px', cursor: 'pointer', display: 'inline-flex',
            alignItems: 'center', gap: 6, fontFamily: 'inherit', fontSize: 13,
          }}>
            <Gift size={13} /> Pay incentive
          </button>
        }
      >
        {incentivePayouts.length === 0 ? (
          <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>
            No incentive payouts yet.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {incentivePayouts.map(p => (
              <div key={p.id} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '8px 12px', background: 'var(--v2-bg-2, var(--surface-2))',
                borderRadius: 10, fontSize: 13,
              }}>
                <span>{p.month_year} · {p.paid_date}</span>
                <span style={{ fontWeight: 700 }}>{fmtINR(p.amount_paid)}</span>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {/* ─── 6. TA / DA ───────────────────────────────────────────── */}
      <SectionCard
        title="TA / DA"
        sub={`Pending claims: ${taSummary.pending} · Approved this month: ${fmtINR(taSummary.approvedMonth)}`}
        action={
          <Link to="/people?tab=ta" style={{
            background: 'transparent', border: '1px solid var(--v2-line, var(--border))',
            color: 'var(--v2-ink-1, var(--text))', borderRadius: 10,
            padding: '8px 12px', cursor: 'pointer', display: 'inline-flex',
            alignItems: 'center', gap: 6, fontSize: 13, textDecoration: 'none',
          }}>
            <Coins size={13} /> Review claims <ChevronRight size={13} />
          </Link>
        }
      >
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
          gap: 12,
        }}>
          <Tile label="Pending claims" value={taSummary.pending}
                tone={taSummary.pending > 0 ? 'warn' : ''} />
          <Tile label="Approved this month" value={fmtINR(taSummary.approvedMonth)} />
        </div>
      </SectionCard>

      {/* ─── 7. Leaves ────────────────────────────────────────────── */}
      <SectionCard
        title="Leaves"
        sub={`${leavesSummary.used} days used this year · ${leavesSummary.paid} paid · ${leavesSummary.unpaid} unpaid · ${leavesSummary.pending} pending`}
        action={
          <Link to="/people?tab=leaves" style={{
            background: 'transparent', border: '1px solid var(--v2-line, var(--border))',
            color: 'var(--v2-ink-1, var(--text))', borderRadius: 10,
            padding: '8px 12px', cursor: 'pointer', display: 'inline-flex',
            alignItems: 'center', gap: 6, fontSize: 13, textDecoration: 'none',
          }}>
            <Calendar size={13} /> Manage leaves <ChevronRight size={13} />
          </Link>
        }
      >
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
          gap: 12,
        }}>
          <Tile label="Used (year)"   value={leavesSummary.used} />
          <Tile label="Paid"          value={leavesSummary.paid} />
          <Tile label="Unpaid"        value={leavesSummary.unpaid}
                tone={leavesSummary.unpaid > 0 ? 'danger' : ''} />
          <Tile label="Pending"       value={leavesSummary.pending}
                tone={leavesSummary.pending > 0 ? 'warn' : ''} />
        </div>
      </SectionCard>

      {/* ─── Edit modals ──────────────────────────────────────────── */}
      {editProfileOpen && (
        <TeamMemberModal
          mode="edit"
          member={user}
          onClose={() => setEditProfileOpen(false)}
          onSuccess={() => { setEditProfileOpen(false); loadAll() }}
        />
      )}
      {editTargetsOpen && (
        <EditTargetsModal
          userId={user.id}
          current={targets}
          onClose={() => setEditTargetsOpen(false)}
          onSaved={loadAll}
        />
      )}
      {salaryPayoutOpen && (
        <SalaryPayoutModal
          staff={{ user_id: user.id, name: user.name }}
          monthYear={monthYm}
          computed={safeNum(salary?.netPayable)}
          onClose={() => setSalaryPayoutOpen(false)}
          onSaved={loadAll}
        />
      )}
      {incentivePayoutOpen && (
        <IncentivePayoutModal
          staff={{ user_id: user.id, name: user.name }}
          monthYear={monthYm}
          monthLabel={monthLabel}
          computed={safeNum(salary?.incentive)}
          onClose={() => setIncentivePayoutOpen(false)}
          onSaved={loadAll}
        />
      )}
    </div>
  )
}
