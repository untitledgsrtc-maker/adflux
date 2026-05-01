// =====================================================================
// Step 3 — Line items.
//
// AUTO:  picks from auto_districts; rate snapshot = davp_per_rickshaw_rate
//        OR auto_rate_master.agency_per_rickshaw_rate (per rate_type).
//        units = rickshaws, duration = campaign_duration_days.
//
// GSRTC: picks from gsrtc_stations; rate basis differs:
//   - DAVP:   rate = davp_per_slot_rate, units = monthly_spots × months
//   - AGENCY: rate = agency_monthly_rate, units = screen-months
// =====================================================================

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useWizardStore } from '@/store/wizardStore';
import {
  fetchAutoDistricts, fetchGsrtcStations, fetchActiveAutoRate, qk,
} from '@/lib/proposalApi';
import { fmtInrPlain } from '@/lib/format';
import Stepper from './Stepper';
import WizardNav from './WizardNav';

function round2(n) {
  const v = Number(n) || 0;
  const sign = v < 0 ? -1 : 1;
  const abs = Math.abs(v);
  return sign * Math.round((abs + Number.EPSILON) * 100) / 100;
}

export default function Step3LineItems() {
  const form = useWizardStore((s) => s.form);
  const addLineItem = useWizardStore((s) => s.addLineItem);
  const addLineItems = useWizardStore((s) => s.addLineItems);
  const updateLineItem = useWizardStore((s) => s.updateLineItem);
  const removeLineItem = useWizardStore((s) => s.removeLineItem);
  const clearLineItems = useWizardStore((s) => s.clearLineItems);

  const isAuto = form.media_code === 'AUTO';

  const districtsQ = useQuery({
    queryKey: qk.autoDistricts(), queryFn: fetchAutoDistricts, enabled: isAuto,
  });
  const stationsQ = useQuery({
    queryKey: qk.gsrtcStations(), queryFn: fetchGsrtcStations, enabled: !isAuto,
  });
  const autoRateQ = useQuery({
    queryKey: qk.autoRate(), queryFn: fetchActiveAutoRate, enabled: isAuto,
  });

  const [defaultRickshaws, setDefaultRickshaws] = useState(100);
  const [defaultMonths, setDefaultMonths] = useState(2);

  const addedIds = useMemo(
    () => new Set(form.line_items.map((li) => li.auto_district_id || li.gsrtc_station_id).filter(Boolean)),
    [form.line_items]
  );

  // ---------- AUTO add ----------
  function addDistrict(d) {
    const rate = form.rate_type === 'DAVP'
      ? Number(autoRateQ.data?.davp_per_rickshaw_rate ?? 0)
      : Number(autoRateQ.data?.agency_per_rickshaw_rate ?? autoRateQ.data?.davp_per_rickshaw_rate ?? 0);
    const units = Math.max(1, Number(defaultRickshaws) || 1);
    const days = Number(form.campaign_duration_days) || 30;

    addLineItem({
      location_type: 'AUTO_DISTRICT',
      auto_district_id: d.id,
      gsrtc_station_id: null,
      location_name_snapshot: d.district_name_en,
      location_name_gu_snapshot: d.district_name_gu,
      units, duration_days: days,
      unit_rate_snapshot: rate,
      rate_type_snapshot: form.rate_type,
      meta_snapshot: { available_rickshaws: d.available_rickshaw_count },
      line_subtotal: round2(units * rate),
    });
  }

  function addAllDistricts() {
    const list = districtsQ.data ?? [];
    const rate = form.rate_type === 'DAVP'
      ? Number(autoRateQ.data?.davp_per_rickshaw_rate ?? 0)
      : Number(autoRateQ.data?.agency_per_rickshaw_rate ?? autoRateQ.data?.davp_per_rickshaw_rate ?? 0);
    const units = Math.max(1, Number(defaultRickshaws) || 1);
    const days = Number(form.campaign_duration_days) || 30;
    const newOnes = list
      .filter((d) => !addedIds.has(d.id))
      .map((d) => ({
        location_type: 'AUTO_DISTRICT',
        auto_district_id: d.id,
        gsrtc_station_id: null,
        location_name_snapshot: d.district_name_en,
        location_name_gu_snapshot: d.district_name_gu,
        units, duration_days: days,
        unit_rate_snapshot: rate,
        rate_type_snapshot: form.rate_type,
        meta_snapshot: { available_rickshaws: d.available_rickshaw_count },
        line_subtotal: round2(units * rate),
      }));
    addLineItems(newOnes);
  }

  // ---------- GSRTC add ----------
  function addStation(s) {
    const months = Math.max(1, Number(defaultMonths) || 1);
    const days = months * 30;

    let units, rate;
    if (form.rate_type === 'DAVP') {
      // total slots over the period
      units = Number(s.monthly_spots) * months;
      rate = Number(s.davp_per_slot_rate);
    } else {
      // screen-months × monthly per-screen rate (rough monthly_per_screen = monthly_rate / screens_count)
      const screens = Math.max(1, Number(s.screens_count));
      units = screens * months;
      const monthlyTotal = Number(s.agency_monthly_rate || s.davp_monthly_total || 0);
      rate = round2(monthlyTotal / screens);
    }

    addLineItem({
      location_type: 'GSRTC_STATION',
      gsrtc_station_id: s.id,
      auto_district_id: null,
      location_name_snapshot: s.station_name_en,
      location_name_gu_snapshot: s.station_name_gu,
      units, duration_days: days,
      unit_rate_snapshot: rate,
      rate_type_snapshot: form.rate_type,
      meta_snapshot: {
        category: s.category,
        screens_count: s.screens_count,
        monthly_spots: s.monthly_spots,
      },
      line_subtotal: round2(units * rate),
    });
  }

  function addAllStations() {
    const list = stationsQ.data ?? [];
    const newOnes = list.filter((s) => !addedIds.has(s.id));
    // Reuse single-add logic by mapping then bulk-pushing
    const months = Math.max(1, Number(defaultMonths) || 1);
    const days = months * 30;
    const items = newOnes.map((s) => {
      let units, rate;
      if (form.rate_type === 'DAVP') {
        units = Number(s.monthly_spots) * months;
        rate = Number(s.davp_per_slot_rate);
      } else {
        const screens = Math.max(1, Number(s.screens_count));
        units = screens * months;
        const monthlyTotal = Number(s.agency_monthly_rate || s.davp_monthly_total || 0);
        rate = round2(monthlyTotal / screens);
      }
      return {
        location_type: 'GSRTC_STATION',
        gsrtc_station_id: s.id,
        auto_district_id: null,
        location_name_snapshot: s.station_name_en,
        location_name_gu_snapshot: s.station_name_gu,
        units, duration_days: days,
        unit_rate_snapshot: rate,
        rate_type_snapshot: form.rate_type,
        meta_snapshot: {
          category: s.category,
          screens_count: s.screens_count,
          monthly_spots: s.monthly_spots,
        },
        line_subtotal: round2(units * rate),
      };
    });
    addLineItems(items);
  }

  return (
    <div className="up-page up-stack-4">
      <header className="up-page__header">
        <div>
          <h1 className="up-page__title">New Proposal</h1>
          <div className="up-page__sub">Step 3 of 6 — Line items ({isAuto ? 'Auto districts' : 'GSRTC stations'})</div>
        </div>
      </header>

      <Stepper />

      <div className="up-card up-stack-4">
        <div className="up-row up-row--between">
          <h3 className="up-card__title" style={{ margin: 0 }}>
            Pick {isAuto ? 'districts' : 'stations'} ({form.rate_type})
          </h3>
          <div className="up-row" style={{ gap: 8 }}>
            {isAuto ? (
              <>
                <label className="up-field__hint">Default rickshaws / district:</label>
                <input type="number" min={1} className="up-input" style={{ width: 90 }}
                       value={defaultRickshaws}
                       onChange={(e) => setDefaultRickshaws(Number(e.target.value))} />
                <button type="button" className="up-btn up-btn--sm" onClick={addAllDistricts}
                        disabled={!districtsQ.data || !autoRateQ.data}>
                  + Add all (33)
                </button>
              </>
            ) : (
              <>
                <label className="up-field__hint">Months:</label>
                <input type="number" min={1} className="up-input" style={{ width: 70 }}
                       value={defaultMonths}
                       onChange={(e) => setDefaultMonths(Number(e.target.value))} />
                <button type="button" className="up-btn up-btn--sm" onClick={addAllStations}
                        disabled={!stationsQ.data}>
                  + Add all stations
                </button>
              </>
            )}
          </div>
        </div>

        {(districtsQ.isLoading || stationsQ.isLoading || autoRateQ.isLoading) && <div>Loading masters…</div>}
        {(districtsQ.error || stationsQ.error || autoRateQ.error) && (
          <div className="up-field__error">
            Failed to load masters: {String((districtsQ.error || stationsQ.error || autoRateQ.error)?.message)}
          </div>
        )}
        {isAuto && autoRateQ.data == null && !autoRateQ.isLoading && (
          <div className="up-field__error">
            No active row in <code>auto_rate_master</code>. Add one in Masters before continuing.
          </div>
        )}

        <div className="up-pickergrid" style={{ maxHeight: 360, overflow: 'auto' }}>
          {(isAuto ? districtsQ.data : stationsQ.data)?.map((row) => {
            const id = row.id;
            const added = addedIds.has(id);
            return (
              <button key={id} type="button"
                className={`up-pickerbtn ${added ? 'up-pickerbtn--added' : ''}`}
                onClick={() => isAuto ? addDistrict(row) : addStation(row)}
                disabled={added || (isAuto && !autoRateQ.data)}>
                <div className="up-pickerbtn__title up-gu">
                  {isAuto ? row.district_name_gu : row.station_name_gu}
                </div>
                <div className="up-pickerbtn__sub">
                  {isAuto ? row.district_name_en : row.station_name_en}
                </div>
                <div className="up-pickerbtn__sub">
                  {isAuto
                    ? `~${row.available_rickshaw_count} rickshaws available`
                    : `Cat ${row.category} · ${row.screens_count} screens · ${row.monthly_spots}/mo`}
                </div>
                {added && <div className="up-pickerbtn__sub" style={{ color: 'var(--up-accent)' }}>✓ Added</div>}
              </button>
            );
          })}
        </div>
      </div>

      <div className="up-card up-stack-3">
        <div className="up-row up-row--between">
          <h3 className="up-card__title" style={{ margin: 0 }}>Selected line items ({form.line_items.length})</h3>
          {form.line_items.length > 0 && (
            <button type="button" className="up-btn up-btn--ghost up-btn--sm" onClick={clearLineItems}>
              Clear all
            </button>
          )}
        </div>

        {form.line_items.length === 0 ? (
          <p className="up-field__hint">No line items yet. Pick from the list above.</p>
        ) : (
          <table className="up-table">
            <thead>
              <tr>
                <th>{isAuto ? 'District' : 'Station'}</th>
                <th style={{ width: 100 }}>{isAuto ? 'Rickshaws' : 'Units'}</th>
                <th style={{ width: 100 }}>Days</th>
                <th style={{ width: 120 }}>Rate (₹)</th>
                <th style={{ width: 130, textAlign: 'right' }}>Subtotal (₹)</th>
                <th style={{ width: 40 }}></th>
              </tr>
            </thead>
            <tbody>
              {form.line_items.map((li, i) => (
                <tr key={i}>
                  <td>
                    <div>{li.location_name_snapshot}</div>
                    <div className="up-gu" style={{ fontSize: 12, color: 'var(--up-ink-soft)' }}>
                      {li.location_name_gu_snapshot}
                    </div>
                  </td>
                  <td>
                    <input type="number" className="up-input" min={1}
                           value={li.units}
                           onChange={(e) => updateLineItem(i, { units: Number(e.target.value) })} />
                  </td>
                  <td>
                    <input type="number" className="up-input" min={1}
                           value={li.duration_days}
                           onChange={(e) => updateLineItem(i, { duration_days: Number(e.target.value) })} />
                  </td>
                  <td>
                    <input type="number" step="0.01" className="up-input"
                           value={li.unit_rate_snapshot}
                           onChange={(e) => updateLineItem(i, { unit_rate_snapshot: Number(e.target.value) })} />
                  </td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {fmtInrPlain(li.line_subtotal)}
                  </td>
                  <td>
                    <button type="button" className="up-btn up-btn--ghost up-btn--sm"
                            onClick={() => removeLineItem(i)} title="Remove">
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <WizardNav />
    </div>
  );
}
