// Phase 365 - the 3-column task board (Assigned / In process / Finished).
// Shared by the person's My Work and the admin Team Work. Drag a card to move it,
// or use the Start / Finish buttons. The database decides who may move what
// (a person only their own part, forward only; a head any).
import { useEffect, useState } from 'react'
import { Clock, Play, Check, AlertTriangle, GripVertical } from 'lucide-react'
import UserAvatar from '../common/UserAvatar'
import { dueState, initialsOf, fmtDur, clientColor, fmtTimeIST, fmtDateShort, addDaysISO } from '../../utils/workUtils'
import { istTodayISO } from '../../utils/istDate'

const COLS = [
  { key: 'assigned',   title: 'Assigned',   color: 'var(--text-muted)' },
  { key: 'in_process', title: 'In process', color: 'var(--accent)' },
  { key: 'finished',   title: 'Finished',   color: 'var(--success)' },
  { key: 'postponed',  title: 'Postponed',  color: 'var(--w-wat, #FBBF24)' },
]

// Due pill as in the owner's design: "On track, 18 Oct" / "Due today" / "Overdue, 12 Oct" / "Finished 12:40".
const fmtHM = (t) => { const [h, m] = String(t).split(':'); const H = Number(h); return `${H % 12 || 12}:${m} ${H < 12 ? 'AM' : 'PM'}` }
function duePill(it) {
  if (it.status === 'postponed') return { cls: 'warn', Icon: Clock, text: `Back ${fmtDateShort(it.postponedUntil || '').replace(/^\w+,\s*/, '')}` }
  if (it.status === 'finished') return { cls: 'ok', Icon: Check, text: it.finishedAt ? `Finished ${fmtTimeIST(it.finishedAt)}` : 'Finished' }
  if (!it.due) return { cls: '', Icon: Clock, text: 'No due date' }
  const t = istTodayISO()
  const short = fmtDateShort(it.due).replace(/^\w+,\s*/, '')
  if (it.due < t) return { cls: 'bad', Icon: AlertTriangle, text: `Overdue, ${short}` }
  if (it.due === t) return { cls: 'warn', Icon: Clock, text: it.dueTime ? `Due today, ${fmtHM(it.dueTime)}` : 'Due today' }
  return { cls: 'ok', Icon: Check, text: `On track, ${short}` }
}

export default function WorkBoard({ items, onMove, onOpen, onStart, onFinish, onPostpone, uid, runningPartId = null, showCost, actForAll, emptyText = 'Drop a task here' }) {
  const [drag, setDrag] = useState(null)
  const [over, setOver] = useState('')
  const [phone, setPhone] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 860px)').matches)
  const [col, setCol] = useState('assigned')
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 860px)')
    const f = () => setPhone(mq.matches)
    mq.addEventListener('change', f)
    return () => mq.removeEventListener('change', f)
  }, [])
  const total = items.length || 1

  return (
    <>
      {phone && (
        <div className="wk-seg" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 4, marginBottom: 12, borderRadius: 16 }}>
          {COLS.map((c) => (
            <button key={c.key} style={{ minWidth: 0, whiteSpace: 'nowrap' }} className={col === c.key ? 'on' : ''} onClick={() => setCol(c.key)}>
              {c.title} {items.filter((i) => i.status === c.key).length}
            </button>
          ))}
        </div>
      )}
      <div className="wk-board">
        {COLS.filter((c) => !phone || c.key === col).map((c) => {
          const rows = items.filter((i) => i.status === c.key)
          return (
            <div
              key={c.key}
              className={`wk-col${over === c.key ? ' over' : ''}${over === c.key && c.key === 'finished' ? ' fin' : ''}`}
              onDragOver={(e) => { e.preventDefault(); if (over !== c.key) setOver(c.key) }}
              onDragLeave={() => setOver('')}
              onDrop={(e) => {
                e.preventDefault(); setOver('')
                if (drag && drag.status !== c.key) { if (c.key === 'postponed') onPostpone?.(drag); else onMove(drag.id, c.key) }
                setDrag(null)
              }}
            >
              <div className="wk-row">
                <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span className="wk-dot" style={{ background: c.color }} aria-hidden="true" />
                  <b>{c.title}</b>
                </span>
                <span className="wk-cnt">{rows.length}</span>
              </div>
              <div className="wk-bar"><i style={{ width: `${Math.round(rows.length / total * 100)}%`, background: c.color }} /></div>
              {rows.map((it) => {
                const mine = !!actForAll || it.assigneeId === uid
                const dp = duePill(it)
                const Pi = dp.Icon
                return (
                  <div
                    key={it.id}
                    className={`wk-tk${drag?.id === it.id ? ' drag' : ''}${it.status === 'finished' ? ' done' : ''}${dp.cls === 'bad' && it.status !== 'finished' ? ' late' : ''}`}
                    draggable
                    tabIndex={0}
                    onDragStart={(e) => { setDrag(it); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', it.id) }}
                    onDragEnd={() => { setDrag(null); setOver('') }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') onOpen(it.taskId)
                      const order = ['assigned', 'in_process', 'finished']
                      const i = order.indexOf(it.status)
                      if (i < 0) return   // postponed: use the Bring back button
                      if (e.key === 'ArrowRight' && i < 2) onMove(it.id, order[i + 1])
                      if (e.key === 'ArrowLeft' && i > 0) onMove(it.id, order[i - 1])
                    }}
                    onClick={() => onOpen(it.taskId)}
                  >
                    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                      <GripVertical size={16} className="wk-mu" aria-hidden="true" style={{ marginTop: 2, flex: 'none' }} />
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ fontWeight: 500 }}>{it.title}</div>
                        {it.label && <div className="wk-sm">{it.label}</div>}
                      </div>
                    </div>
                    <div className="wk-grp" style={{ gap: 8, margin: '8px 0 0 24px', flexWrap: 'nowrap' }}>
                      <span className="wk-dot" style={{ background: clientColor(it.client), width: 8, height: 8 }} aria-hidden="true" />
                      <span className="wk-sm">{it.client || 'No client'}</span>
                    </div>
                    <div style={{ margin: '8px 0 0 24px' }}>
                      <span className={`wk-pill ${dp.cls}`}><Pi size={13} aria-hidden="true" /> {dp.text}</span>
                    </div>
                    {it.status === 'postponed' && (
                      <div className="wk-sm" style={{ margin: '8px 0 0 24px' }}>
                        Asked by {it.postponedBy || 'someone'}{it.postponeCount > 1 ? ` · postponed ${it.postponeCount} times` : ''}
                      </div>
                    )}
                    {it.partsTotal > 1 && (
                      <div className="wk-sm" style={{ margin: '8px 0 0 24px' }}>{it.partsDone} of {it.partsTotal} people done</div>
                    )}
                    {showCost && it.status === 'finished' && it.cost != null && (
                      <div className="wk-row" style={{ marginTop: 10, padding: '8px 10px', borderRadius: 10, background: 'var(--surface-2)' }}>
                        <span className="wk-sm">{fmtDur(it.seconds)} tracked</span>
                        <b className="wk-num">Rs {Number(it.cost).toLocaleString('en-IN')}</b>
                      </div>
                    )}
                    <div className="wk-row" style={{ marginTop: 12, flexWrap: 'wrap', gap: 8 }}>
                      <UserAvatar className="wk-av" name={it.assigneeName} url={it.assigneePhoto} userId={it.assigneeId} />
                      {mine && it.status === 'assigned' && onStart && (
                        <button className="wk-btn g sm" onClick={(e) => { e.stopPropagation(); onStart(it) }}>
                          <Play size={14} aria-hidden="true" /> Start
                        </button>
                      )}
                      {mine && it.status === 'postponed' && (
                        <button className="wk-btn g sm" onClick={(e) => { e.stopPropagation(); onMove(it.id, 'assigned') }}>
                          Bring back
                        </button>
                      )}
                      {mine && it.status === 'in_process' && onStart && it.assigneeId === uid && runningPartId !== it.id && (
                        <button className="wk-btn y sm" onClick={(e) => { e.stopPropagation(); onStart(it) }}>
                          <Play size={14} aria-hidden="true" /> Resume
                        </button>
                      )}
                      {mine && it.status === 'in_process' && onFinish && (
                        <button className="wk-btn g sm" onClick={(e) => { e.stopPropagation(); onFinish(it) }}>
                          <Check size={14} aria-hidden="true" /> Finish
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
              <div className="wk-dz">{emptyText}</div>
            </div>
          )
        })}
      </div>
    </>
  )
}
