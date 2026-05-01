// src/pages/v2/AutoDistrictsV2.jsx
//
// Admin master page — Auto Hood district editor.
// 33 rows. Inline edit on share_pct. Live "must total 100%" check.
// Save sends a batch UPDATE to Supabase.

import { useEffect, useMemo, useState } from 'react'
import { Save, RotateCcw } from 'lucide-react'
import { supabase } from '../../lib/supabase'

export default function AutoDistrictsV2() {
  const [rows,    setRows]    = useState([])
  const [edits,   setEdits]   = useState({})            // id → new share_pct
  const [loading, setLoading] = useState(true)
  const [saving,  setSaving]  = useState(false)
  const [toast,   setToast]   = useState(null)

  async function load() {
    setLoading(true)
    const { data, error } = await supabase
      .from('auto_districts')
      .select('id, serial_no, district_name_en, district_name_gu, share_pct, is_active')
      .order('serial_no')
    if (error) setToast({ type: 'error', msg: error.message })
    else setRows(data || [])
    setEdits({})
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  function setEdit(id, val) {
    const num = val === '' ? '' : Number(val)
    setEdits(e => ({ ...e, [id]: num }))
  }

  const liveRows = useMemo(() => rows.map(r => ({
    ...r,
    share_pct: edits[r.id] !== undefined ? edits[r.id] : r.share_pct,
  })), [rows, edits])

  const total = liveRows.reduce((s, r) => s + (Number(r.share_pct) || 0), 0)
  const totalOk = Math.abs(total - 100) < 0.01
  const dirty = Object.keys(edits).length > 0

  async function save() {
    if (!totalOk) {
      setToast({ type: 'error', msg: `Total is ${total.toFixed(2)}% — must be exactly 100% to save.` })
      return
    }
    setSaving(true)
    const updates = Object.entries(edits).map(([id, share_pct]) =>
      supabase.from('auto_districts').update({ share_pct }).eq('id', id),
    )
    const results = await Promise.all(updates)
    const firstErr = results.find(r => r.error)
    if (firstErr) {
      setToast({ type: 'error', msg: firstErr.error.message })
    } else {
      setToast({ type: 'ok', msg: `Saved ${updates.length} district${updates.length > 1 ? 's' : ''}.` })
      await load()
    }
    setSaving(false)
    setTimeout(() => setToast(null), 3500)
  }

  function reset() {
    setEdits({})
    setToast(null)
  }

  return (
    <div className="govt-master">
      <div className="govt-master__head">
        <div>
          <div className="govt-master__kicker">Government masters</div>
          <h1 className="govt-master__title">Auto Districts</h1>
          <div className="govt-master__sub">
            33 districts of Gujarat. Edit each district's % share — these
            drive how Auto Hood total quantity is distributed in proposals.
            Total must equal exactly <strong>100%</strong> to save.
          </div>
        </div>
      </div>

      {toast && (
        <div className={toast.type === 'error' ? 'govt-master__warn' : 'govt-master__ok'}>
          {toast.msg}
        </div>
      )}

      {/* Live total banner */}
      <div className={totalOk ? 'govt-master__ok' : 'govt-master__warn'}>
        <strong>Total share: {total.toFixed(2)}%</strong>
        {' '}— {totalOk ? '✓ ready to save' : `must equal 100% (${(100 - total).toFixed(2)}% off)`}
      </div>

      <table className="govt-table">
        <thead>
          <tr>
            <th style={{ width: 56 }}>#</th>
            <th>District (EN)</th>
            <th>જિલ્લો (GU)</th>
            <th className="num">Share %</th>
            <th style={{ width: 90 }}>Active</th>
          </tr>
        </thead>
        <tbody>
          {loading && (
            <tr><td colSpan={5}><em>Loading…</em></td></tr>
          )}
          {liveRows.map(r => (
            <tr key={r.id}>
              <td className="num">{r.serial_no}</td>
              <td>{r.district_name_en}</td>
              <td>{r.district_name_gu}</td>
              <td className="num">
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  max="100"
                  className="govt-input-cell"
                  value={r.share_pct ?? ''}
                  onChange={e => setEdit(r.id, e.target.value)}
                />
                <span style={{ marginLeft: 4, color: 'var(--text-subtle)' }}>%</span>
              </td>
              <td>
                <span className={r.is_active ? 'govt-pill govt-pill--A' : 'govt-pill govt-pill--C'}>
                  {r.is_active ? 'Active' : 'Off'}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="govt-action-bar">
        <button
          type="button"
          className="govt-wiz__btn"
          onClick={reset}
          disabled={!dirty || saving}
        >
          <RotateCcw size={14} /> Reset
        </button>
        <button
          type="button"
          className="govt-wiz__btn govt-wiz__btn--primary"
          onClick={save}
          disabled={!dirty || saving}
        >
          <Save size={14} /> {saving ? 'Saving…' : `Save${dirty ? ` (${Object.keys(edits).length})` : ''}`}
        </button>
      </div>
    </div>
  )
}
