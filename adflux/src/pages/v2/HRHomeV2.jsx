// =============================================================================
// HRHomeV2 — HR daily cockpit (spec: docs/HR_ONBOARDING_RECRUITMENT_SPEC.md).
// The landing for role='hr' (+ admin/co_owner). Surfaces what needs HR today +
// links to the 5 lifecycle stages: Recruit → Hire → Onboard → Manage → Exit.
// Counts via HR's own RLS (leaves/ta_da_requests FOR ALL, users read, hr_offers).
// Additive, HR-facing. Recruit + Onboard cards are placeholders until built.
// =============================================================================
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Users, CalendarCheck, Wallet, FileText, MapPin, UserPlus, ClipboardList,
  GraduationCap, ChevronRight, LogOut,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/authStore'

export default function HRHomeV2() {
  const nav = useNavigate()
  const profile = useAuthStore(s => s.profile)
  const [c, setC] = useState({ leaves: 0, ta: 0, team: 0, offers: 0, candidates: 0 })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    ;(async () => {
      const [lv, ta, tm, of, cand] = await Promise.all([
        supabase.from('leaves').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
        supabase.from('ta_da_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
        supabase.from('users').select('id', { count: 'exact', head: true }).eq('is_active', true),
        supabase.from('hr_offers').select('id', { count: 'exact', head: true }).in('status', ['draft', 'sent', 'filled']),
        // Phase 281 — new candidates to review. Errors (returns null count) until
        // the Recruit SQL is applied → shows 0, never breaks the cockpit.
        supabase.from('hr_candidates').select('id', { count: 'exact', head: true }).eq('stage', 'applied'),
      ])
      if (!alive) return
      setC({ leaves: lv.count || 0, ta: ta.count || 0, team: tm.count || 0, offers: of.count || 0, candidates: cand.count || 0 })
      setLoading(false)
    })()
    return () => { alive = false }
  }, [])

  const name = (profile?.name || 'there').split(' ')[0]
  const hour = new Date().getHours()
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
  const pending = c.leaves + c.ta + c.candidates

  return (
    <div className="v2d-page">
      <div className="v2d-page-head">
        <div>
          <div className="v2d-page-kicker">HR workspace</div>
          <h1 className="v2d-page-title">{greet}, {name}</h1>
          <div className="v2d-page-sub">{pending > 0 ? `${pending} item${pending > 1 ? 's' : ''} need you today.` : 'Nothing pending — all caught up.'}</div>
        </div>
      </div>

      {/* pending actions */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14, marginBottom: 18 }}>
        <Kpi label="New candidates" value={loading ? '…' : c.candidates} accent={c.candidates > 0} onClick={() => nav('/hr/candidates')} Icon={ClipboardList} />
        <Kpi label="Leaves to approve" value={loading ? '…' : c.leaves} accent={c.leaves > 0} onClick={() => nav('/admin/leaves')} Icon={CalendarCheck} />
        <Kpi label="TA/DA to approve" value={loading ? '…' : c.ta} accent={c.ta > 0} onClick={() => nav('/admin/ta-payouts')} Icon={Wallet} />
        <Kpi label="Open offers" value={loading ? '…' : c.offers} onClick={() => nav('/hr/offers')} Icon={FileText} />
        <Kpi label="Team members" value={loading ? '…' : c.team} onClick={() => nav('/team')} Icon={Users} />
      </div>

      {/* lifecycle sections */}
      <Section title="1 · Recruit" sub="find + shortlist candidates">
        <Tile title="Candidates" sub="resumes · shortlist · calls" Icon={ClipboardList} onClick={() => nav('/hr/candidates')} badge={c.candidates} />
      </Section>

      <Section title="2 · Hire" sub="make them official">
        <Tile title="Add member" sub="create account + set salary/targets" Icon={UserPlus} onClick={() => nav('/hr/new-user')} />
        <Tile title="Offers / invites" sub="send + track offer letters" Icon={FileText} onClick={() => nav('/hr/offers')} />
      </Section>

      <Section title="3 · Onboard & train" sub="first days — no doubts">
        <Tile title="Onboarding timeline" sub="role steps · training · tests" Icon={GraduationCap} soon />
      </Section>

      <Section title="4 · Manage" sub="day-to-day people ops">
        <Tile title="Leaves" sub="approve / reject" Icon={CalendarCheck} onClick={() => nav('/admin/leaves')} badge={c.leaves} />
        <Tile title="TA / DA claims" sub="approve travel claims" Icon={Wallet} onClick={() => nav('/admin/ta-payouts')} badge={c.ta} />
        <Tile title="Team roster" sub="members · roles · designations" Icon={Users} onClick={() => nav('/team')} />
        <Tile title="Attendance / GPS" sub="who's in the field today" Icon={MapPin} onClick={() => nav('/team-dashboard')} />
      </Section>

      <Section title="5 · Exit" sub="offboarding">
        <Tile title="Offboarding" sub="deactivate · collect assets" Icon={LogOut} soon />
      </Section>
    </div>
  )
}

function Kpi({ label, value, accent, onClick, Icon }) {
  return (
    <div onClick={onClick} style={{ cursor: 'pointer', background: 'var(--surface, #1e293b)', border: `1px solid ${accent ? 'var(--warning, #F59E0B)' : 'var(--border, #334155)'}`, borderRadius: 14, padding: 18 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--text-subtle, #64748b)', fontWeight: 600 }}>{label}</div>
        <Icon size={18} style={{ color: accent ? 'var(--warning, #F59E0B)' : 'var(--text-muted, #94a3b8)' }} />
      </div>
      <div style={{ fontFamily: 'Space Grotesk, sans-serif', fontWeight: 600, fontSize: 30, marginTop: 6, color: accent ? 'var(--warning, #F59E0B)' : 'var(--text, #f1f5f9)' }}>{value}</div>
    </div>
  )
}

function Section({ title, sub, children }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 10 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text, #f1f5f9)' }}>{title}</div>
        <div style={{ fontSize: 12, color: 'var(--text-subtle, #64748b)' }}>{sub}</div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12 }}>{children}</div>
    </div>
  )
}

function Tile({ title, sub, Icon, onClick, soon, badge }) {
  return (
    <div onClick={soon ? undefined : onClick}
      style={{ cursor: soon ? 'default' : 'pointer', opacity: soon ? 0.55 : 1, background: 'var(--surface, #1e293b)', border: '1px solid var(--border, #334155)', borderRadius: 12, padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12, position: 'relative' }}>
      <span style={{ width: 36, height: 36, borderRadius: 10, background: 'var(--surface-2, #334155)', display: 'grid', placeItems: 'center', color: 'var(--accent, #FFE600)', flexShrink: 0 }}><Icon size={18} /></span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text, #f1f5f9)' }}>{title}{soon && <span style={{ marginLeft: 8, fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 999, background: 'var(--surface-2, #334155)', color: 'var(--text-subtle)' }}>soon</span>}</div>
        <div style={{ fontSize: 11.5, color: 'var(--text-subtle, #64748b)', marginTop: 2 }}>{sub}</div>
      </div>
      {badge > 0 && <span style={{ fontSize: 11, fontWeight: 700, minWidth: 20, height: 20, padding: '0 6px', borderRadius: 999, background: 'var(--warning-soft, rgba(245,158,11,.12))', color: 'var(--warning, #F59E0B)', display: 'grid', placeItems: 'center' }}>{badge}</span>}
      {!soon && <ChevronRight size={16} style={{ color: 'var(--text-subtle)', flexShrink: 0 }} />}
    </div>
  )
}
