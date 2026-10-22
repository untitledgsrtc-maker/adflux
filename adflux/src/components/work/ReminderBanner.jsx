// Phase 462: banner shown when someone (admin / HR) sent me a "say hi" or "send your evening report" reminder.
// It goes away by itself once I have done it (said hi / shared the report) or when I dismiss it.
import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import '../../styles/work.css'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/authStore'
import { istTodayISO } from '../../utils/istDate'
import { openWhatsApp } from '../../utils/whatsapp'

const ASSISTANT = '9581578261'

export default function ReminderBanner() {
  const uid = useAuthStore((s) => s.profile?.id)
  const mapped = String(useAuthStore((s) => s.profile?.whatsapp_number) || '').replace(/\D/g, '').length >= 10
  const nav = useNavigate()
  const [kinds, setKinds] = useState([])   // open reminders, newest first

  const check = useCallback(async () => {
    if (!uid) return
    try {
      const since = new Date(Date.now() - 14 * 3600e3).toISOString()
      const { data } = await supabase.from('work_reminders').select('kind,created_at').eq('user_id', uid).is('seen_at', null).gte('created_at', since).order('created_at', { ascending: false })
      const out = []
      for (const k of [...new Set((data || []).map((r) => r.kind))]) {
        let done = false
        if (k === 'morning') { const r = await supabase.rpc('assistant_greeted_today'); done = r.data === true }
        else {
          const day = istTodayISO()
          const a = await supabase.from('work_report_shares').select('id', { count: 'exact', head: true }).eq('user_id', uid).eq('work_date', day)
          const b = await supabase.from('work_sessions').select('evening_summary_sent_at').eq('user_id', uid).eq('work_date', day).maybeSingle()
          done = (a.count || 0) > 0 || !!b.data?.evening_summary_sent_at
        }
        if (done) supabase.rpc('work_reminder_seen', { p_kind: k }).then(() => {}, () => {})
        else out.push(k)
      }
      setKinds(out)
    } catch { /* best effort: never block the app */ }
  }, [uid])

  useEffect(() => {
    if (!uid) return undefined
    check()
    const ch = supabase.channel(`work-rem-${uid}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'work_reminders', filter: `user_id=eq.${uid}` }, () => check())
      .subscribe()
    window.addEventListener('focus', check)
    const t = setInterval(check, 120000)
    return () => { supabase.removeChannel(ch); window.removeEventListener('focus', check); clearInterval(t) }
  }, [uid, check])

  const dismiss = (k) => { setKinds((a) => a.filter((x) => x !== k)); supabase.rpc('work_reminder_seen', { p_kind: k }).then(() => {}, () => {}) }
  if (!kinds.length) return null
  const k = kinds[0]
  return (
    <div role="alert" style={{ position: 'fixed', top: 'calc(var(--topbar-height, 60px) + 8px)', left: '50%', transform: 'translateX(-50%)', zIndex: 100, width: 'min(560px, calc(100vw - 24px))',
      background: 'var(--surface, #1e293b)', border: '1px solid var(--warning, #F59E0B)', borderRadius: 14, padding: '12px 16px', boxShadow: '0 10px 30px rgba(0,0,0,.45)',
      display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
      <div style={{ flex: 1, minWidth: 200 }}>
        <div style={{ fontWeight: 600 }}>{k === 'morning' ? 'Please say good morning' : 'Please send your evening report'}</div>
        <div style={{ fontSize: 13, color: 'var(--text-muted, #94a3b8)' }}>{k === 'morning' ? 'Say hi on WhatsApp to the 95815 78261 number to start your day.' : 'Open My Work and tap Share on the evening report.'}</div>
      </div>
      {k === 'morning' && !mapped
        ? null
        : k === 'morning'
        ? <button className="wk-btn y sm" onClick={() => openWhatsApp(ASSISTANT, 'Good morning')}>Say hi</button>
        : <button className="wk-btn y sm" onClick={() => { nav('/my-work'); }}>Open report</button>}
      <button className="wk-btn o sm" onClick={() => dismiss(k)}>Dismiss</button>
    </div>
  )
}
