// Work module helpers (Phase 365). Pure functions, IST based.
import { istTodayISO } from './istDate'

export const fmtDur = (s) => {
  const t = Math.max(0, Math.round(Number(s) || 0))
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60)
  return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`
}
export const fmtClock = (s) => {
  const t = Math.max(0, Math.floor(Number(s) || 0))
  const p = (n) => String(n).padStart(2, '0')
  return `${p(Math.floor(t / 3600))}:${p(Math.floor((t % 3600) / 60))}:${p(t % 60)}`
}
export const dayStartISO = (ymd) => `${ymd}T00:00:00+05:30`
export const addDaysISO = (ymd, n) => {
  const d = new Date(`${ymd}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
export const monthStartISO = (ymd) => `${ymd.slice(0, 8)}01`
export const fmtTimeIST = (iso) => {
  if (!iso) return '-'
  return new Date(iso).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: true })
}
export const fmtDateShort = (ymd) => {
  if (!ymd) return ''
  const d = new Date(`${ymd}T00:00:00Z`)
  return d.toLocaleDateString('en-GB', { timeZone: 'UTC', day: '2-digit', month: '2-digit', year: 'numeric' })
}
export const istHour = () => Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', hour12: false }).format(new Date()))
export const initialsOf = (name) => (name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase()
export const todayIST = istTodayISO
export const STATUS_LABEL = { assigned: 'Assigned', in_process: 'In process', finished: 'Finished', postponed: 'Postponed' }
export const dueState = (due, status) => {
  if (status === 'postponed') return { cls: '', label: 'Postponed' }   // never overdue while postponed
  if (!due || status === 'finished') return { cls: '', label: due ? fmtDateShort(due) : 'No due date' }
  const t = istTodayISO()
  if (due < t) return { cls: 'bad', label: 'Late ' + Math.max(1, Math.round((new Date(t) - new Date(due)) / 86400000)) + 'd' }
  if (due === t) return { cls: 'warn', label: 'Today' }
  if (due === addDaysISO(t, 1)) return { cls: 'warn', label: 'Tomorrow' }
  return { cls: '', label: fmtDateShort(due) }
}

// Stable colour per client name (the design's client tags). Same name = same colour everywhere.
const CLIENT_COLORS = ['#38bdf8', '#a78bfa', '#f472b6', '#fb923c', '#34d399', '#e879f9', '#60a5fa', '#f87171', '#2dd4bf', '#c084fc']
export const clientColor = (name) => {
  const t = String(name || '').trim().toLowerCase()
  if (!t) return '#64748b'
  let h = 0
  for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) >>> 0
  return CLIENT_COLORS[h % CLIENT_COLORS.length]
}
