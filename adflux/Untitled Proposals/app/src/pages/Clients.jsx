import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export default function Clients() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['clients'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('clients')
        .select('id, name_en, name_gu, city, gst_number, is_government')
        .order('name_en')
        .limit(200);
      if (error) throw error;
      return data;
    },
  });

  return (
    <div className="up-page">
      <header className="up-page__header">
        <div>
          <h1 className="up-page__title">Clients</h1>
          <div className="up-page__sub">Government departments + private agencies.</div>
        </div>
      </header>
      <div className="up-card" style={{ padding: 0, overflow: 'hidden' }}>
        {isLoading && <div style={{ padding: 24 }}>Loading…</div>}
        {error    && <div style={{ padding: 24, color: '#b91c1c' }}>{error.message}</div>}
        {data && (
          <table className="up-table">
            <thead>
              <tr>
                <th>Name (EN)</th>
                <th>Name (GU)</th>
                <th>City</th>
                <th>GSTIN</th>
                <th>Type</th>
              </tr>
            </thead>
            <tbody>
              {data.length === 0 && (
                <tr><td colSpan={5} style={{ padding: 24, textAlign: 'center', color: 'var(--up-ink-soft)' }}>No clients yet.</td></tr>
              )}
              {data.map((c) => (
                <tr key={c.id}>
                  <td>{c.name_en}</td>
                  <td><span className="up-gu">{c.name_gu}</span></td>
                  <td>{c.city || '—'}</td>
                  <td style={{ fontFamily: 'var(--up-font-mono)', fontSize: 12 }}>{c.gst_number || '—'}</td>
                  <td>{c.is_government ? 'Government' : 'Private'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
