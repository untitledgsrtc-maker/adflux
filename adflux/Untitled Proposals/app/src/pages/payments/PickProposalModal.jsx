// =====================================================================
// "+ New receipt" entry modal — first ask which proposal, then open
// the receipt form pre-bound to that proposal.
// =====================================================================

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchReceivableProposals, qkRcpt } from '@/lib/receiptApi';
import { fmtInrPlain } from '@/lib/format';

export default function PickProposalModal({ onClose, onPicked }) {
  const [search, setSearch] = useState('');
  const q = useQuery({
    queryKey: qkRcpt.proposalsForReceipt(),
    queryFn: fetchReceivableProposals,
  });

  const filtered = useMemo(() => {
    const list = q.data ?? [];
    if (!search.trim()) return list;
    const s = search.toLowerCase();
    return list.filter((p) =>
      (p.ref_no || '').toLowerCase().includes(s)
      || (p.client_name_snapshot || '').toLowerCase().includes(s)
      || (p.client_name_gu_snapshot || '').includes(search)
      || (p.subject_en || '').toLowerCase().includes(s)
    );
  }, [q.data, search]);

  return (
    <div className="up-modal__backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div className="up-modal up-stack-3" style={{ maxWidth: 720 }}>
        <h3 style={{ margin: 0 }}>Pick a proposal</h3>
        <p className="up-field__hint">
          Only WON / PARTIAL_PAID / PAID proposals accept receipts. Draft and rejected won't show up.
        </p>
        <input className="up-input"
               placeholder="Search by ref, client, or subject…"
               value={search} onChange={(e) => setSearch(e.target.value)} autoFocus />

        {q.isLoading && <div>Loading…</div>}
        {q.error && <div className="up-field__error">Failed to load: {String(q.error.message)}</div>}

        <div style={{ maxHeight: 360, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {filtered.map((p) => {
            const expected = Number(p.po_amount || p.total_amount || 0);
            const got = Number(p.total_gross_received || 0);
            const remaining = expected - got;
            return (
              <button key={p.id} type="button" className="up-pickerbtn"
                      onClick={() => onPicked?.(p)}>
                <div className="up-row up-row--between">
                  <div className="up-pickerbtn__title">{p.ref_no}</div>
                  <div className={`up-chip up-chip--${(p.payment_status || 'draft').toLowerCase()}`}>
                    {p.payment_status}
                  </div>
                </div>
                <div className="up-pickerbtn__sub up-gu">{p.client_name_gu_snapshot}</div>
                <div className="up-pickerbtn__sub">{p.client_name_snapshot}</div>
                <div className="up-pickerbtn__sub">
                  Outstanding: ₹{fmtInrPlain(remaining)} of ₹{fmtInrPlain(expected)}
                </div>
              </button>
            );
          })}
          {filtered.length === 0 && !q.isLoading && (
            <div className="up-field__hint">No proposals match.</div>
          )}
        </div>

        <div className="up-row up-row--end">
          <button className="up-btn up-btn--ghost" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
