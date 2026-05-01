// src/pages/v2/GsrtcStationsV2.jsx
//
// Admin master page — GSRTC station editor.
// 20 rows. Inline edit on screens_count, category, davp_per_slot_rate,
// agency_monthly_rate, agency_rack_rate. Live computed monthly cost
// per row (= 100 × screens × 30 × DAVP rate).

import { useEffect, useMemo, useState } from 'react'
import { Save, RotateCcw } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { formatINREnglish } from '../../utils/gujaratiNumber'

const CATEGORIES = ['A', 'B', 'C']

export default function GsrtcStationsV2() {
  const [rows,    setRows]    = useState([])
  const [edits,   setEdits]   = useState({})           // id → patch obj
  const [loading, setLoading] = useState(true)
  const [saving,  setSaving]  = useState(false)
  const [toast,   setToast]   = useState(null)

  async function load() {
    setLoading(true)
    const { data, error } = await supabase
      .from('gsrtc_stations')
      .select('id, serial_no, station_name_en, station_name_gu, category, screens_count, monthly_spots, davp_per_slot_rate, agency_monthly_rate, agency_rack_rate, is_active')
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
      [id]: { ...(e[id] || {}), [field]: val === '' ? null : (typeof val === 'string' && /^\d+(\.\d+)?$/.test(val) ? Number(val) : val) },
    }))
  }

  const liveRows = useMemo(() => rows.map(r => ({
    ...r,
    ...(edits[r.id] || {}),
  })), [rows, edits])

  const dirty = Object.keys(edits).length > 0
  const totalMonthly = liveRows.reduce((s, r) => {
    const screens = Number(r.screens_count) || 0
    const rate    = Number(r.davp_per_slot_rate) || 0
    return s + (screens * 100 * 30 * rate)
  }, 0)

  async function save() {
    setSaving(true)
    const updates = Object.entries(edits).map(([id, patch]) => {
      const cleanPatch = { ...patch }
      // monthly_spots is auto-computed (= 3000 × screens) per phase5
      // logic; keep it in sync if screens_count changed.
      if (cleanPatch.screens_count != null) {
        cleanPatch.monthly_spots = 3000 * Number(cleanPatch.screens_count)
      }
      return supabase.from('gsrtc_stations').update(cleanPatch).eq('id', id)
    })
    const results = await Promise.all(updates)
    const firstErr = results.find(r => r.error)
    if (firstErr) {
      setToast({ type: 'error', msg: firstErr.error.message })
    } else {
      setToast({ type: 'ok', msg: `Saved ${updates.length} station${updates.length > 1 ? 's' : ''}.` })
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
          <h1 className="govt-master__title">GSRTC Stations</h1>
          <div className="govt-master__sub">
            20 GSRTC bus stations. Edit screens / category / rates to keep
            in sync with the latest GSRTC rate sheet. Monthly cost per row =
            screens × 100 daily spots × 30 days × DAVP rate.
          </div>
        </div>
      </div>

      {toast && (
        <div className={toast.type === 'error' ? 'govt-master__warn' : 'govt-master__ok'}>
          {toast.msg}
        </div>
      )}

      <div className="govt-master__ok">
        <strong>Combined monthly DAVP total: ₹{formatINREnglish(totalMonthly)}</strong>
      </div>

      <table className="govt-table">
        <thead>
          <tr>
            <th style={{ width: 40 }}>#</th>
            <th>Station (EN)</th>
            <th>બસ સ્ટેશન (GU)</th>
            <th style={{ width: 80 }}>Cat</th>
            <th className="num">Screens</th>
            <th className="num">DAVP/slot</th>
            <th className="num">Agency ₹/mo</th>
            <th className="num">Agency rack</th>
            <th className="num">Monthly DAVP</th>
          </tr>
        </thead>
        <tbody>
          {loading && (
            <tr><td colSpan={9}><em>Loading…</em></td></tr>
          )}
          {liveRows.map(r => {
            const screens = Number(r.screens_count) || 0
            const rate    = Number(r.davp_per_slot_rate) || 0
            const monthly = screens * 100 * 30 * rate
            return (
              <tr key={r.id}>
                <td className="num">{r.serial_no}</td>
                <td>{r.station_name_en}</td>
                <td>{r.station_name_gu}</td>
                <td>
                  <select
                    className="govt-input-cell"
                    value={r.category || 'B'}
                    onChange={e => setEdit(r.id, 'category', e.target.value)}
                  >
                    {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </td>
                <td className="num">
                  <input
                    type="number"
                    min="0"
                    className="govt-input-cell"
                    value={r.screens_count ?? ''}
                    onChange={e => setEdit(r.id, 'screens_count', e.target.value)}
                  />
                </td>
                <td className="num">
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    className="govt-input-cell"
                    value={r.davp_per_slot_rate ?? ''}
                    onChange={e => setEdit(r.id, 'davp_per_slot_rate', e.target.value)}
                  />
                </td>
                <td className="num">
                  <input
                    type="number"
                    step="1"
                    min="0"
                    className="govt-input-cell"
                    value={r.agency_monthly_rate ?? ''}
                    onChange={e => setEdit(r.id, 'agency_monthly_rate', e.target.value)}
                  />
                </td>
                <td className="num">
                  <input
                    type="number"
                    step="1"
                    min="0"
                    className="govt-input-cell"
                    value={r.agency_rack_rate ?? ''}
                    onChange={e => setEdit(r.id, 'agency_rack_rate', e.target.value)}
                  />
                </td>
                <td className="num"><strong>₹{formatINREnglish(monthly)}</strong></td>
              </tr>
            )
          })}
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
