import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { fmtInr } from '@/lib/format';

export default function Masters() {
  const stations = useQuery({
    queryKey: ['masters', 'gsrtc'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('gsrtc_stations')
        .select('serial_no, station_name_en, station_name_gu, category, screens_count, monthly_spots, davp_per_slot_rate, agency_monthly_rate')
        .eq('is_active', true)
        .order('serial_no');
      if (error) throw error;
      return data;
    },
  });

  const districts = useQuery({
    queryKey: ['masters', 'districts'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('auto_districts')
        .select('serial_no, district_name_en, district_name_gu, available_rickshaw_count')
        .eq('is_active', true)
        .order('serial_no');
      if (error) throw error;
      return data;
    },
  });

  const rate = useQuery({
    queryKey: ['masters', 'auto-rate'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('auto_rate_master')
        .select('*')
        .is('effective_to', null)
        .order('effective_from', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  return (
    <div className="up-page">
      <header className="up-page__header">
        <div>
          <h1 className="up-page__title">Masters</h1>
          <div className="up-page__sub">Reference data — rates, stations, districts.</div>
        </div>
      </header>

      <section className="up-card">
        <h3 className="up-card__title">Auto Hood — current rate</h3>
        {rate.data ? (
          <div className="up-grid-3">
            <div><div style={{ color: 'var(--up-ink-soft)', fontSize: 12 }}>DAVP per rickshaw</div><div style={{ fontSize: 20, fontWeight: 600 }}>{fmtInr(rate.data.davp_per_rickshaw_rate)}</div></div>
            <div><div style={{ color: 'var(--up-ink-soft)', fontSize: 12 }}>Agency per rickshaw</div><div style={{ fontSize: 20, fontWeight: 600 }}>{rate.data.agency_per_rickshaw_rate ? fmtInr(rate.data.agency_per_rickshaw_rate) : 'Not set'}</div></div>
            <div><div style={{ color: 'var(--up-ink-soft)', fontSize: 12 }}>Campaign duration</div><div style={{ fontSize: 20, fontWeight: 600 }}>{rate.data.campaign_duration_days} days</div></div>
          </div>
        ) : <div style={{ color: 'var(--up-ink-soft)' }}>Loading rate…</div>}
      </section>

      <section className="up-card" style={{ padding: 0, overflow: 'hidden' }}>
        <h3 className="up-card__title" style={{ padding: '20px 24px 0' }}>GSRTC Stations ({stations.data?.length ?? 0})</h3>
        {stations.isLoading && <div style={{ padding: 24 }}>Loading…</div>}
        {stations.data && (
          <table className="up-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Station</th>
                <th>Cat</th>
                <th style={{ textAlign: 'right' }}>Screens</th>
                <th style={{ textAlign: 'right' }}>Spots/mo</th>
                <th style={{ textAlign: 'right' }}>DAVP/slot</th>
                <th style={{ textAlign: 'right' }}>Agency/mo</th>
              </tr>
            </thead>
            <tbody>
              {stations.data.map((s) => (
                <tr key={s.serial_no}>
                  <td>{s.serial_no}</td>
                  <td>{s.station_name_en}<br/><small className="up-gu" style={{ color: 'var(--up-ink-soft)' }}>{s.station_name_gu}</small></td>
                  <td>{s.category}</td>
                  <td style={{ textAlign: 'right' }}>{s.screens_count}</td>
                  <td style={{ textAlign: 'right' }}>{s.monthly_spots}</td>
                  <td style={{ textAlign: 'right' }}>{fmtInr(s.davp_per_slot_rate)}</td>
                  <td style={{ textAlign: 'right' }}>{s.agency_monthly_rate ? fmtInr(s.agency_monthly_rate) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="up-card" style={{ padding: 0, overflow: 'hidden' }}>
        <h3 className="up-card__title" style={{ padding: '20px 24px 0' }}>Auto Districts ({districts.data?.length ?? 0})</h3>
        {districts.isLoading && <div style={{ padding: 24 }}>Loading…</div>}
        {districts.data && (
          <table className="up-table">
            <thead>
              <tr>
                <th>#</th>
                <th>District</th>
                <th style={{ textAlign: 'right' }}>Available rickshaws</th>
              </tr>
            </thead>
            <tbody>
              {districts.data.map((d) => (
                <tr key={d.serial_no}>
                  <td>{d.serial_no}</td>
                  <td>{d.district_name_en}<br/><small className="up-gu" style={{ color: 'var(--up-ink-soft)' }}>{d.district_name_gu}</small></td>
                  <td style={{ textAlign: 'right' }}>{d.available_rickshaw_count.toLocaleString('en-IN')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
