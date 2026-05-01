// src/pages/v2/AutoDistrictsV2.jsx
//
// Admin master page — Auto Hood district editor.
// 33 rows. Inline edit on name (EN), name (GU), share_pct, is_active.
// No add/remove — Gujarat has a fixed 33-district list.
// Use the Active toggle to remove a district from new proposals
// (old proposals keep their snapshot via stored ref_id + city_name).
// Live "active rows must total 100%" check before save.

import { useEffect, useMemo, useState } from 'react'
import { Save, RotateCcw } from 'lucide-react'
import { supabase } from '../../lib/supabase'

export default function AutoDistrictsV2() {
  const [rows,    setRows]    = useState([])
  const [edits,   setEdits]   = useState({})            // id → patch obj
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

  function setEdit(id, field, val) {
    setEdits(e => ({
      ...e,
      [id]: { ...(e[id] || {}), [field]: val },
    }))
  }

  const liveRows = useMemo(() => rows.map(r => ({
    ...r,
    ...(edits[r.id] || {}),
  })), [rows, edits])

  // Total share is across ACTIVE rows only — deactivated districts
  // are zero-weighted in the distribution.
  const total = liveRows
    .filter(r => r.is_active)
    .reduce((s, r) => s + (Number(r.share_pct) || 0), 0)
  const totalOk = Math.abs(total - 100) < 0.01
  const dirty = Object.keys(edits).length > 0

  async function save() {
    if (!totalOk) {
      setToast({ type: 'error', msg: `Active total is ${total.toFixed(2)}% — must equal 100% to save.` })
      return
    }
    setSaving(true)
    const updates = Object.entries(edits).map(([id, patch]) => {
      const cleanPatch = { ...patch }
      if (cleanPatch.share_pct !== undefined) {
        cleanPatch.share_pct = Number(cleanPatch.share_pct) || 0
      }
      return supabase.from('auto_districts').update(cleanPatch).eq('id', id)
    })
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
            33 districts of Gujarat (fixed list — no add/remove). Edit names,
            share %, or toggle a district off. Active districts must total
            exactly <strong>100%</strong> to save.
          </div>
        </div>
      </div>

      {toast && (
        <div className={toast.type === 'error' ? 'govt-master__warn' : 'govt-master__ok'}>
          {toast.msg}
        </div>
      )}

      <div className={totalOk ? 'govt-master__ok' : 'govt-master__warn'}>
        <strong>Active total: {total.toFixed(2)}%</strong>
        {' '}— {totalOk ? 'ready to save' : `must equal 100% (${(100 - total).toFixed(2)}% off)`}
      </div>

      <table className="govt-table">
        <thead>
          <tr>
            <th style={{ width: 56 }}>#</th>
            <th>District (EN)</th>
            <th>District (GU)</th>
            <th className="num">Share %</th>
            <th style={{ width: 100 }}>Active</th>
          </tr>
        </thead>
        <tbody>
          {loading && (
            <tr><td colSpan={5}><em>Loading…</em></td></tr>
          )}
          {liveRows.map(r => (
            <tr key={r.id} style={{ opacity: r.is_active ? 1 : 0.55 }}>
              <td className="num">{r.serial_no}</td>
              <td>
                <input
                  type="text"
                  className="govt-input-cell"
                  style={{ maxWidth: 200, textAlign: 'left' }}
                  value={r.district_name_en ?? ''}
                  onChange={e => setEdit(r.id, 'district_name_en', e.target.value)}
                />
              </td>
              <td>
                <input
                  type="text"
                  className="govt-input-cell"
                  style={{ maxWidth: 200, textAlign: 'left' }}
                  value={r.district_name_gu ?? ''}
                  onChange={e => setEdit(r.id, 'district_name_gu', e.target.value)}
                />
              </td>
              <td className="num">
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  max="100"
                  className="govt-input-cell"
                  value={r.share_pct ?? ''}
                  onChange={e => setEdit(r.id, 'share_pct', e.target.value)}
                />
                <span style={{ marginLeft: 4, color: 'var(--text-subtle)' }}>%</span>
              </td>
              <td>
                <button
                  type="button"
                  onClick={() => setEdit(r.id, 'is_active', !r.is_active)}
                  className={r.is_active ? 'govt-pill govt-pill--A' : 'govt-pill govt-pill--C'}
                  style={{
                    cursor: 'pointer',
                    border: 'none',
                    fontFamily: 'inherit',
                    padding: '4px 12px',
                  }}
                  title={r.is_active ? 'Click to deactivate' : 'Click to reactivate'}
                >
                  {r.is_active ? 'Active' : 'Off'}
                </button>
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
