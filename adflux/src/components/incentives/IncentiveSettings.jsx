// src/components/incentives/IncentiveSettings.jsx
import { useState, useEffect } from 'react'
import { Settings, Save, RefreshCw } from 'lucide-react'
import { useIncentive } from '../../hooks/useIncentive'
import { formatPercent } from '../../utils/formatters'

export function IncentiveSettings() {
  const { settings, fetchSettings, updateSettings } = useIncentive()
  const [form, setForm]     = useState(null)
  const [saving, setSaving] = useState(false)
  const [saved,  setSaved]  = useState(false)
  const [error,  setError]  = useState(null)

  // Self-fetch on mount so this component works even if the parent
  // hasn't loaded settings (e.g. user lands directly on Settings tab
  // or the parent's fetch failed).
  useEffect(() => {
    if (!settings) fetchSettings()
  }, [])

  useEffect(() => {
    if (settings) {
      setForm({
        default_multiplier: settings.default_multiplier ?? 5,
        new_client_rate:    settings.new_client_rate    ?? 0.05,
        renewal_rate:       settings.renewal_rate       ?? 0.02,
        // DB column is `default_flat_bonus`; accept old `flat_bonus` as fallback
        flat_bonus:         settings.default_flat_bonus ?? settings.flat_bonus ?? 10000,
      })
    }
  }, [settings])

  if (!form) {
    return (
      <div className="settings-card">
        <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading settings…</div>
        <div style={{ marginTop: 10, fontSize: 12, color: 'var(--text-muted)' }}>
          If this stays here more than a few seconds, either the
          <code style={{ margin: '0 4px' }}>incentive_settings</code> table is empty
          (the app will auto-seed it on next reload) or your session doesn't have
          permission to read it. Try reloading the page.
        </div>
      </div>
    )
  }

  function set(k, v) {
    setForm(f => ({ ...f, [k]: v }))
    setSaved(false)
    setError(null)
  }

  async function handleSave() {
    setSaving(true)
    setError(null)
    const { error: err } = await updateSettings({
      default_multiplier: Number(form.default_multiplier),
      new_client_rate:    Number(form.new_client_rate),
      renewal_rate:       Number(form.renewal_rate),
      // Correct DB column is `default_flat_bonus`
      default_flat_bonus: Number(form.flat_bonus),
    })
    setSaving(false)
    if (err) setError(err.message)
    else setSaved(true)
  }

  const salary   = 30000 // example for preview
  const target   = salary * form.default_multiplier
  const threshold = salary * 2

  return (
    <div className="settings-card">
      <div className="settings-card-header">
        <h3>
          <Settings size={15} style={{ marginRight: 6, verticalAlign: 'middle' }} />
          Global Incentive Settings
        </h3>
        <button className="btn btn-primary" onClick={handleSave} disabled={saving} style={{ fontSize: 13 }}>
          {saving
            ? <><RefreshCw size={13} className="spin" style={{ marginRight: 5 }} />Saving…</>
            : <><Save size={13} style={{ marginRight: 5 }} />Save Changes</>
          }
        </button>
      </div>

      <div className="settings-grid">
        <div className="staff-field">
          <label className="staff-label">Sales Multiplier (Target = Salary × X)</label>
          <input
            className="staff-input"
            type="number"
            min="1"
            max="20"
            step="0.5"
            value={form.default_multiplier}
            onChange={e => set('default_multiplier', e.target.value)}
          />
        </div>

        <div className="staff-field">
          <label className="staff-label">Flat Bonus Above Target (₹)</label>
          <input
            className="staff-input"
            type="number"
            min="0"
            step="1000"
            value={form.flat_bonus}
            onChange={e => set('flat_bonus', e.target.value)}
          />
        </div>

        <div className="staff-field">
          <label className="staff-label">New Client Rate (e.g. 0.05 = 5%)</label>
          <input
            className="staff-input"
            type="number"
            min="0"
            max="1"
            step="0.005"
            value={form.new_client_rate}
            onChange={e => set('new_client_rate', e.target.value)}
          />
          <span className="staff-field-error" style={{ color: 'var(--text-muted)' }}>
            = {formatPercent(Number(form.new_client_rate))} per rupee of new client revenue
          </span>
        </div>

        <div className="staff-field">
          <label className="staff-label">Renewal Rate (e.g. 0.02 = 2%)</label>
          <input
            className="staff-input"
            type="number"
            min="0"
            max="1"
            step="0.005"
            value={form.renewal_rate}
            onChange={e => set('renewal_rate', e.target.value)}
          />
          <span className="staff-field-error" style={{ color: 'var(--text-muted)' }}>
            = {formatPercent(Number(form.renewal_rate))} per rupee of renewal revenue
          </span>
        </div>
      </div>

      {/* Live preview */}
      <div style={{
        marginTop: 20,
        padding: '14px 16px',
        background: 'var(--surface2)',
        borderRadius: 10,
        border: '1px solid var(--border)',
        fontSize: 12,
        color: 'var(--text-muted)',
        lineHeight: 1.7,
      }}>
        <strong style={{ color: 'var(--text)', display: 'block', marginBottom: 4 }}>
          Preview (example ₹30,000 salary):
        </strong>
        Threshold = ₹{(threshold).toLocaleString('en-IN')} &nbsp;·&nbsp;
        Target = ₹{(target).toLocaleString('en-IN')} &nbsp;·&nbsp;
        New client rate = {formatPercent(Number(form.new_client_rate))} &nbsp;·&nbsp;
        Renewal rate = {formatPercent(Number(form.renewal_rate))} &nbsp;·&nbsp;
        Bonus above target = ₹{Number(form.flat_bonus).toLocaleString('en-IN')}
      </div>

      {error && (
        <div style={{ marginTop: 12, color: 'var(--danger)', fontSize: 13 }}>
          {error}
        </div>
      )}
      {saved && (
        <div style={{ marginTop: 12, color: 'var(--success)', fontSize: 13 }}>
          Settings saved successfully.
        </div>
      )}

      <p className="settings-hint">
        These are the <strong>default</strong> values applied when a new member is added.
        Each member can have a custom profile set from the Staff Profiles tab.
        Changes here do not retroactively update existing monthly data.
      </p>
    </div>
  )
}
