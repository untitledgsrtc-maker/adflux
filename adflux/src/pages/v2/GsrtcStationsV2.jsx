// src/pages/v2/GsrtcStationsV2.jsx
//
// Admin master page — GSRTC station editor.
// Inline edit on name (EN), name (GU), category, screens_count, all rates,
// is_active toggle. "Add station" button creates a new row with rate
// defaults from the chosen category. Remove = soft-delete via Active
// toggle (preserves old quote_cities references).
//
// Wizard hook (useGsrtcStations) filters is_active=true, so a deactivated
// station vanishes from the next proposal but old saved proposals keep
// their snapshot via stored ref_id + city_name.

import { useEffect, useMemo, useState } from 'react'
import { Save, RotateCcw, Plus } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { formatINREnglish } from '../../utils/gujaratiNumber'

const CATEGORIES = ['A', 'B', 'C']

// Default rates per category — keep in sync with the GSRTC rate sheet
// (last reviewed 30 Apr 2026). Cat A = top 6 city stations,
// Cat B = mid stations, Cat C = small stations.
const RATE_DEFAULTS = {
  A: { davp_per_slot_rate: 3.00, agency_monthly_rate: 850, agency_rack_rate: 2250 },
  B: { davp_per_slot_rate: 2.75, agency_monthly_rate: 650, agency_rack_rate: 1800 },
  C: { davp_per_slot_rate: 2.50, agency_monthly_rate: 650, agency_rack_rate: 1800 },
}

export default function GsrtcStationsV2() {
  const [rows,    setRows]    = useState([])
  const [edits,   setEdits]   = useState({})           // id → patch obj
  const [loading, setLoading] = useState(true)
  const [saving,  setSaving]  = useState(false)
  const [adding,  setAdding]  = useState(false)
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
      [id]: { ...(e[id] || {}), [field]: val },
    }))
  }

  // Toggling category in the master also resets the three rates to the
  // category default — admin can still tweak them after.
  function setCategory(id, newCat) {
    const def = RATE_DEFAULTS[newCat]
    setEdits(e => ({
      ...e,
      [id]: {
        ...(e[id] || {}),
        category: newCat,
        ...(def && {
          davp_per_slot_rate:  def.davp_per_slot_rate,
          agency_monthly_rate: def.agency_monthly_rate,
          agency_rack_rate:    def.agency_rack_rate,
        }),
      },
    }))
  }

  const liveRows = useMemo(() => rows.map(r => ({
    ...r,
    ...(edits[r.id] || {}),
  })), [rows, edits])

  const dirty = Object.keys(edits).length > 0
  const totalMonthly = liveRows
    .filter(r => r.is_active)
    .reduce((s, r) => {
      const screens = Number(r.screens_count) || 0
      const rate    = Number(r.davp_per_slot_rate) || 0
      return s + (screens * 100 * 30 * rate)
    }, 0)

  async function save() {
    setSaving(true)
    const updates = Object.entries(edits).map(([id, patch]) => {
      const cleanPatch = { ...patch }
      ;['screens_count', 'davp_per_slot_rate', 'agency_monthly_rate', 'agency_rack_rate'].forEach(f => {
        if (cleanPatch[f] !== undefined && cleanPatch[f] !== null && cleanPatch[f] !== '') {
          cleanPatch[f] = Number(cleanPatch[f])
        }
      })
      // monthly_spots is auto-derived (= 3000 × screens) per phase 5.
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

  // Insert a new station seeded with category-B defaults. Admin then
  // edits the name (EN + GU), picks the right category, and saves.
  async function addStation() {
    const nextSerial = (rows[rows.length - 1]?.serial_no || 0) + 1
    setAdding(true)
    const def = RATE_DEFAULTS.B
    const { error } = await supabase
      .from('gsrtc_stations')
      .insert([{
        serial_no:           nextSerial,
        station_name_en:     `New Station ${nextSerial}`,
        station_name_gu:     'નવું સ્ટેશન',
        category:            'B',
        screens_count:       10,
        monthly_spots:       30000,
        davp_per_slot_rate:  def.davp_per_slot_rate,
        agency_monthly_rate: def.agency_monthly_rate,
        agency_rack_rate:    def.agency_rack_rate,
        is_active:           true,
      }])
    setAdding(false)
    if (error) {
      setToast({ type: 'error', msg: error.message })
    } else {
      setToast({ type: 'ok', msg: `Added station #${nextSerial}. Edit name and save.` })
      await load()
    }
    setTimeout(() => setToast(null), 3500)
  }

  return (
    <div className="govt-master">
      <div className="govt-master__head">
        <div>
          <div className="govt-master__kicker">Government masters</div>
          <h1 className="govt-master__title">GSRTC Stations</h1>
          <div className="govt-master__sub">
            GSRTC bus stations. Edit names, category, screens, or rates.
            Toggle Active off to remove a station from new proposals (old
            proposals keep their snapshot). Add a new station as GSRTC
            expands. Monthly cost per row = screens × 100 daily spots × 30
            days × DAVP rate.
          </div>
        </div>
        <div>
          <button
            type="button"
            className="govt-wiz__btn govt-wiz__btn--primary"
            onClick={addStation}
            disabled={adding || saving}
          >
            <Plus size={14} /> {adding ? 'Adding…' : 'Add station'}
          </button>
        </div>
      </div>

      {toast && (
        <div className={toast.type === 'error' ? 'govt-master__warn' : 'govt-master__ok'}>
          {toast.msg}
        </div>
      )}

      <div className="govt-master__ok">
        <strong>Active monthly DAVP total: ₹{formatINREnglish(totalMonthly)}</strong>
      </div>

      <table className="govt-table">
        <thead>
          <tr>
            <th style={{ width: 40 }}>#</th>
            <th>Station (EN)</th>
            <th>Station (GU)</th>
            <th style={{ width: 80 }}>Cat</th>
            <th className="num">Screens</th>
            <th className="num">DAVP/slot</th>
            <th className="num">Agency ₹/mo</th>
            <th className="num">Agency rack</th>
            <th className="num">Monthly DAVP</th>
            <th style={{ width: 90 }}>Active</th>
          </tr>
        </thead>
        <tbody>
          {loading && (
            <tr><td colSpan={10}><em>Loading…</em></td></tr>
          )}
          {liveRows.map(r => {
            const screens = Number(r.screens_count) || 0
            const rate    = Number(r.davp_per_slot_rate) || 0
            const monthly = screens * 100 * 30 * rate
            return (
              <tr key={r.id} style={{ opacity: r.is_active ? 1 : 0.55 }}>
                <td className="num">{r.serial_no}</td>
                <td>
                  <input
                    type="text"
                    className="govt-input-cell"
                    style={{ maxWidth: 180, textAlign: 'left' }}
                    value={r.station_name_en ?? ''}
                    onChange={e => setEdit(r.id, 'station_name_en', e.target.value)}
                  />
                </td>
                <td>
                  <input
                    type="text"
                    className="govt-input-cell"
                    style={{ maxWidth: 180, textAlign: 'left' }}
                    value={r.station_name_gu ?? ''}
                    onChange={e => setEdit(r.id, 'station_name_gu', e.target.value)}
                  />
                </td>
                <td>
                  <select
                    className="govt-input-cell"
                    value={r.category || 'B'}
                    onChange={e => setCategory(r.id, e.target.value)}
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
