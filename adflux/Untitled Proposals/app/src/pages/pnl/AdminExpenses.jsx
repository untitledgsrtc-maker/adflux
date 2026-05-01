// =====================================================================
// Monthly admin expenses CRUD. Owner-only writes; co_owner reads.
// =====================================================================

import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/store/authStore';
import {
  fetchAdminExpenses, createAdminExpense, updateAdminExpense, deleteAdminExpense,
  ADMIN_EXPENSE_TYPES, qkPnL,
} from '@/lib/pnlApi';
import { fmtInrPlain, fmtDateIn } from '@/lib/format';

function firstOfMonthIso(d = new Date()) {
  const yr = d.getFullYear(), mo = String(d.getMonth() + 1).padStart(2, '0');
  return `${yr}-${mo}-01`;
}

function fyStartIso() {
  const d = new Date();
  const startYear = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
  return `${startYear}-04-01`;
}

export default function AdminExpenses() {
  const totpVerifiedAt = useAuthStore((s) => s.totpVerifiedAt);
  const isOwner = useAuthStore((s) => s.isOwner());
  const qc = useQueryClient();

  const [from, setFrom] = useState(fyStartIso());
  const [to, setTo] = useState(firstOfMonthIso());
  const [type, setType] = useState('');
  const [editing, setEditing] = useState(null); // expense row or 'NEW'

  const filters = { from, to, type: type || null };
  const q = useQuery({
    queryKey: qkPnL.adminExpenses(filters),
    queryFn: () => fetchAdminExpenses(filters, { totpVerifiedAt }),
  });

  const total = (q.data ?? []).reduce((s, r) => s + Number(r.amount || 0), 0);
  const byType = useMemo(() => {
    const m = new Map();
    for (const r of q.data ?? []) {
      m.set(r.expense_type, (m.get(r.expense_type) || 0) + Number(r.amount || 0));
    }
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
  }, [q.data]);

  const delMut = useMutation({
    mutationFn: (id) => deleteAdminExpense(id, { totpVerifiedAt }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qkPnL.adminExpenses() });
      qc.invalidateQueries({ queryKey: qkPnL.summaryFy() });
    },
  });

  return (
    <div className="up-stack-4">
      <div className="up-card">
        <div className="up-row up-row--between">
          <div>
            <h3 className="up-card__title" style={{ margin: 0 }}>Monthly admin expenses</h3>
            <div className="up-field__hint">
              Overheads not tied to a specific proposal. Subtracted from total business profit in P&amp;L summary.
            </div>
          </div>
          {isOwner && (
            <button className="up-btn up-btn--primary"
                    onClick={() => setEditing('NEW')}>+ Add expense</button>
          )}
        </div>
      </div>

      <div className="up-card">
        <div className="up-grid-4">
          <div className="up-field">
            <label className="up-field__label">From (month)</label>
            <input type="month" className="up-input"
                   value={from.slice(0, 7)} onChange={(e) => setFrom(e.target.value + '-01')} />
          </div>
          <div className="up-field">
            <label className="up-field__label">To (month)</label>
            <input type="month" className="up-input"
                   value={to.slice(0, 7)} onChange={(e) => setTo(e.target.value + '-01')} />
          </div>
          <div className="up-field">
            <label className="up-field__label">Type</label>
            <select className="up-select" value={type} onChange={(e) => setType(e.target.value)}>
              <option value="">All categories</option>
              {ADMIN_EXPENSE_TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
            </select>
          </div>
          <div className="up-field" style={{ alignSelf: 'end' }}>
            <button className="up-btn"
                    onClick={() => { setFrom(fyStartIso()); setTo(firstOfMonthIso()); setType(''); }}>
              Reset
            </button>
          </div>
        </div>
      </div>

      <div className="up-grid-2">
        <div className="up-card">
          <div className="up-field__hint">Total in range</div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>₹ {fmtInrPlain(total)}</div>
          <div className="up-field__hint">{q.data?.length ?? 0} entries</div>
        </div>
        <div className="up-card">
          <div className="up-field__hint" style={{ marginBottom: 4 }}>By category</div>
          {byType.length === 0
            ? <div className="up-field__hint">—</div>
            : (
              <div className="up-stack-2">
                {byType.slice(0, 6).map(([t, amt]) => (
                  <div key={t} className="up-row up-row--between">
                    <span style={{ textTransform: 'capitalize' }}>{t.replace(/_/g, ' ')}</span>
                    <strong>₹ {fmtInrPlain(amt)}</strong>
                  </div>
                ))}
                {byType.length > 6 && <div className="up-field__hint">+ {byType.length - 6} more categories</div>}
              </div>
            )
          }
        </div>
      </div>

      <div className="up-card" style={{ overflowX: 'auto' }}>
        {q.isLoading && <div>Loading…</div>}
        {q.error && <div className="up-field__error">{String(q.error.message)}</div>}
        {q.data && q.data.length === 0 && <div className="up-field__hint">No expenses in this range.</div>}
        {q.data && q.data.length > 0 && (
          <table className="up-table">
            <thead>
              <tr>
                <th>Month</th>
                <th>Type</th>
                <th>Description</th>
                <th>Vendor / Ref</th>
                <th style={{ textAlign: 'right' }}>Amount (₹)</th>
                <th style={{ width: 120 }}></th>
              </tr>
            </thead>
            <tbody>
              {q.data.map((r) => (
                <tr key={r.id}>
                  <td>{fmtDateIn(r.expense_month).slice(3)}</td>
                  <td><span className="up-chip" style={{ textTransform: 'capitalize' }}>{r.expense_type.replace(/_/g, ' ')}</span></td>
                  <td>
                    {r.description}
                    {r.paid_date && <div className="up-field__hint">Paid {fmtDateIn(r.paid_date)}</div>}
                  </td>
                  <td>
                    {r.vendor_name}
                    {r.payment_ref && <div className="up-field__hint">{r.payment_ref}</div>}
                  </td>
                  <td style={{ textAlign: 'right' }}>{fmtInrPlain(r.amount)}</td>
                  <td>
                    {isOwner && (
                      <div className="up-row" style={{ gap: 4 }}>
                        <button className="up-btn up-btn--sm" onClick={() => setEditing(r)}>Edit</button>
                        <button className="up-btn up-btn--sm up-btn--danger"
                                onClick={() => { if (confirm('Delete this expense?')) delMut.mutate(r.id); }}>
                          ✕
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {editing && (
        <ExpenseForm
          row={editing === 'NEW' ? null : editing}
          totpVerifiedAt={totpVerifiedAt}
          onClose={() => setEditing(null)}
          onSaved={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function ExpenseForm({ row, totpVerifiedAt, onClose, onSaved }) {
  const qc = useQueryClient();
  const isEdit = !!row;
  const [form, setForm] = useState({
    expense_month: row?.expense_month ?? firstOfMonthIso(),
    expense_type:  row?.expense_type ?? 'rent',
    amount:        row?.amount ?? '',
    description:   row?.description ?? '',
    vendor_name:   row?.vendor_name ?? '',
    paid_date:     row?.paid_date ?? '',
    payment_ref:   row?.payment_ref ?? '',
    notes:         row?.notes ?? '',
  });
  const [error, setError] = useState(null);

  const mut = useMutation({
    mutationFn: (payload) => isEdit
      ? updateAdminExpense(row.id, payload, { totpVerifiedAt })
      : createAdminExpense(payload, { totpVerifiedAt }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qkPnL.adminExpenses() });
      qc.invalidateQueries({ queryKey: qkPnL.summaryFy() });
      onSaved?.();
      onClose?.();
    },
    onError: (e) => setError(e?.message || String(e)),
  });

  function set(k) { return (e) => setForm((f) => ({ ...f, [k]: e.target.value })); }

  function submit(e) {
    e.preventDefault();
    setError(null);
    const amt = Number(form.amount);
    if (!(amt > 0)) { setError('Amount must be > 0'); return; }
    if (!form.description?.trim() && !form.vendor_name?.trim()) {
      setError('Add a description or vendor name'); return;
    }
    mut.mutate({
      expense_month: form.expense_month,
      expense_type: form.expense_type,
      amount: amt,
      description: form.description || null,
      vendor_name: form.vendor_name || null,
      paid_date: form.paid_date || null,
      payment_ref: form.payment_ref || null,
      notes: form.notes || null,
    });
  }

  return (
    <div className="up-modal__backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <form className="up-modal up-stack-3" onSubmit={submit}>
        <h3 style={{ margin: 0 }}>{isEdit ? 'Edit expense' : 'Add expense'}</h3>

        <div className="up-grid-2">
          <div className="up-field">
            <label className="up-field__label">Month</label>
            <input type="month" className="up-input"
                   value={form.expense_month.slice(0, 7)}
                   onChange={(e) => setForm((f) => ({ ...f, expense_month: e.target.value + '-01' }))} />
          </div>
          <div className="up-field">
            <label className="up-field__label">Category</label>
            <select className="up-select" value={form.expense_type} onChange={set('expense_type')}>
              {ADMIN_EXPENSE_TYPES.map((t) =>
                <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
            </select>
          </div>
        </div>

        <div className="up-grid-2">
          <div className="up-field">
            <label className="up-field__label">Amount (₹)</label>
            <input type="number" step="0.01" className="up-input"
                   value={form.amount} onChange={set('amount')} autoFocus />
          </div>
          <div className="up-field">
            <label className="up-field__label">Vendor</label>
            <input className="up-input" value={form.vendor_name} onChange={set('vendor_name')}
                   placeholder="e.g. Reliance Jio" />
          </div>
        </div>

        <div className="up-field">
          <label className="up-field__label">Description</label>
          <input className="up-input" value={form.description} onChange={set('description')}
                 placeholder="Free text — bill no, period covered, etc." />
        </div>

        <div className="up-grid-2">
          <div className="up-field">
            <label className="up-field__label">Paid date (optional)</label>
            <input type="date" className="up-input" value={form.paid_date} onChange={set('paid_date')} />
          </div>
          <div className="up-field">
            <label className="up-field__label">Payment ref (UTR / cheque)</label>
            <input className="up-input" value={form.payment_ref} onChange={set('payment_ref')} />
          </div>
        </div>

        <div className="up-field">
          <label className="up-field__label">Notes</label>
          <textarea className="up-textarea" rows={2} value={form.notes} onChange={set('notes')} />
        </div>

        {error && <div className="up-field__error">{error}</div>}

        <div className="up-row up-row--end">
          <button type="button" className="up-btn up-btn--ghost" onClick={onClose} disabled={mut.isPending}>Cancel</button>
          <button type="submit" className="up-btn up-btn--primary" disabled={mut.isPending}>
            {mut.isPending ? 'Saving…' : (isEdit ? 'Save changes' : 'Add expense')}
          </button>
        </div>
      </form>
    </div>
  );
}
