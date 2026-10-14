// Phase 365 - the 3-column task board (Assigned / In process / Finished).
// Shared by the person's My Work and the admin Team Work. Drag a card to move it,
// or use the Start / Finish buttons. The database decides who may move what
// (a person only their own part, forward only; a head any).
import { useState } from 'react'
import { Clock, Play, Check } from 'lucide-react'
import { dueState, initialsOf, fmtDur, clientColor } from '../../utils/workUtils'

const COLS = [
  { key: 'assigned',   title: 'Assigned',   color: 'var(--text-muted)' },
  { key: 'in_process', title: 'In process', color: 'var(--accent)' },
  { key: 'finished',   title: 'Finished',   color: 'var(--success)' },
]

export default function WorkBoard({ items, onMove, onOpen, onStart, onFinish, uid, showCost, emptyText = 'Drop a task here' }) {
  const [drag, setDrag] = useState(null)
  const [over, setOver] = useState('')
  const total = items.length || 1

  return (
    <div className="wk-board">
      {COLS.map((c) => {
        const rows = items.filter((i) => i.status === c.key)
        return (
          <div
            key={c.key}
            className={`wk-col${over === c.key ? ' over' : ''}${over === c.key && c.key === 'finished' ? ' fin' : ''}`}
            onDragOver={(e) => { e.preventDefault(); if (over !== c.key) setOver(c.key) }}
            onDragLeave={() => setOver('')}
            onDrop={(e) => {
              e.preventDefault(); setOver('')
              if (drag && drag.status !== c.key) onMove(drag.id, c.key)
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
              const ds = dueState(it.due, it.status)
              const mine = it.assigneeId === uid
              return (
                <div
                  key={it.id}
                  className={`wk-tk${drag?.id === it.id ? ' drag' : ''}${it.status === 'finished' ? ' done' : ''}${ds.cls === 'bad' ? ' late' : ''}`}
                  draggable
                  tabIndex={0}
                  onDragStart={(e) => { setDrag(it); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', it.id) }}
                  onDragEnd={() => { setDrag(null); setOver('') }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') onOpen(it.taskId)
                    const order = ['assigned', 'in_process', 'finished']
                    const i = order.indexOf(it.status)
                    if (e.key === 'ArrowRight' && i < 2) onMove(it.id, order[i + 1])
                    if (e.key === 'ArrowLeft' && i > 0) onMove(it.id, order[i - 1])
                  }}
                  onClick={() => onOpen(it.taskId)}
                >
                  <div className="wk-row" style={{ justifyContent: 'flex-start' }}>
                    <span className="wk-ctile" aria-hidden="true" style={{ background: `${clientColor(it.client)}33`, color: clientColor(it.client) }}>{(it.client || '?')[0].toUpperCase()}</span>
                    <div style={{ minWidth: 0 }}>
                      <div className="wk-sm">{it.client || 'No client'}</div>
                      <b>{it.title}</b>
                      {it.label && <div className="wk-sm">{it.label}</div>}
                    </div>
                  </div>
                  {it.partsTotal > 1 && (
                    <>
                      <div className="wk-bar" style={{ margin: '10px 0 4px' }}><i style={{ width: `${Math.round(it.partsDone / it.partsTotal * 100)}%` }} /></div>
                      <div className="wk-sm">{it.partsDone} of {it.partsTotal} people done</div>
                    </>
                  )}
                  <div className="wk-row" style={{ marginTop: 10 }}>
                    <span className={`wk-pill ${it.status === 'finished' ? 'ok' : ds.cls}`}>
                      {it.status === 'finished' ? <Check size={14} aria-hidden="true" /> : <Clock size={14} aria-hidden="true" />}
                      {it.status === 'finished' ? 'Finished' : ds.label}
                    </span>
                    <span className="wk-av" title={it.assigneeName}>{initialsOf(it.assigneeName)}</span>
                  </div>
                  {showCost && it.status === 'finished' && it.cost != null && (
                    <div className="wk-row" style={{ marginTop: 10, padding: '8px 10px', borderRadius: 10, background: 'var(--surface-2)' }}>
                      <span className="wk-sm">{fmtDur(it.seconds)} tracked</span>
                      <b className="wk-num">Rs {Number(it.cost).toLocaleString('en-IN')}</b>
                    </div>
                  )}
                  {mine && it.status === 'assigned' && onStart && (
                    <button className="wk-btn y sm" style={{ width: '100%', marginTop: 10 }}
                      onClick={(e) => { e.stopPropagation(); onStart(it) }}>
                      <Play size={16} aria-hidden="true" /> Start
                    </button>
                  )}
                  {mine && it.status === 'in_process' && onFinish && (
                    <button className="wk-btn g sm" style={{ width: '100%', marginTop: 10 }}
                      onClick={(e) => { e.stopPropagation(); onFinish(it) }}>
                      <Check size={16} aria-hidden="true" /> Finish
                    </button>
                  )}
                </div>
              )
            })}
            <div className="wk-dz">{emptyText}</div>
          </div>
        )
      })}
    </div>
  )
}
