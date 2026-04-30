// =====================================================================
// Step 1 — Pick a client + contact, pick media (AUTO/GSRTC), pick rate
// basis (DAVP/AGENCY). Default rate basis flips with client type:
// is_government=true → DAVP, else AGENCY.
// =====================================================================

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useWizardStore } from '@/store/wizardStore';
import { fetchClients, fetchClientContacts, fetchMediaTypes, qk } from '@/lib/proposalApi';
import QuickAddClientModal from './QuickAddClientModal';
import WizardNav from './WizardNav';
import Stepper from './Stepper';

export default function Step1ClientMedia() {
  const form = useWizardStore((s) => s.form);
  const patch = useWizardStore((s) => s.patch);
  const [showAdd, setShowAdd] = useState(false);
  const [search, setSearch] = useState('');

  const clientsQ = useQuery({ queryKey: qk.clients(), queryFn: fetchClients });
  const mediaQ   = useQuery({ queryKey: qk.mediaTypes(), queryFn: fetchMediaTypes });
  const contactsQ = useQuery({
    queryKey: qk.contacts(form.client_id),
    queryFn: () => fetchClientContacts(form.client_id),
    enabled: !!form.client_id,
  });

  // Default the media row when masters load
  useEffect(() => {
    if (mediaQ.data && !form.media_id && form.media_code) {
      const m = mediaQ.data.find((x) => x.code === form.media_code);
      if (m) patch({ media_id: m.id, media_snapshot: m });
    }
  }, [mediaQ.data, form.media_id, form.media_code, patch]);

  const filteredClients = useMemo(() => {
    if (!clientsQ.data) return [];
    if (!search.trim()) return clientsQ.data;
    const q = search.toLowerCase();
    return clientsQ.data.filter(
      (c) => c.name_en?.toLowerCase().includes(q)
          || c.name_gu?.includes(search)
          || c.department_en?.toLowerCase().includes(q)
    );
  }, [clientsQ.data, search]);

  function pickClient(client) {
    // Default rate basis based on client type
    const newRate = client.is_government ? 'DAVP' : 'AGENCY';
    patch({
      client_id: client.id,
      client_snapshot: client,
      client_contact_id: null,
      contact_snapshot: null,
      rate_type: newRate,
    });
  }

  function pickContact(c) {
    patch({ client_contact_id: c.id, contact_snapshot: c });
  }

  function pickMedia(code) {
    const m = mediaQ.data?.find((x) => x.code === code);
    patch({ media_code: code, media_id: m?.id ?? null, media_snapshot: m ?? null });
  }

  return (
    <div className="up-page up-stack-4">
      <header className="up-page__header">
        <div>
          <h1 className="up-page__title">New Proposal</h1>
          <div className="up-page__sub">Step 1 of 6 — Client + Media</div>
        </div>
      </header>

      <Stepper />

      <div className="up-card up-stack-4">
        <div className="up-row up-row--between">
          <h3 className="up-card__title" style={{ margin: 0 }}>Client</h3>
          <button type="button" className="up-btn up-btn--sm" onClick={() => setShowAdd(true)}>
            + Add new client
          </button>
        </div>

        {form.client_snapshot ? (
          <div className="up-card" style={{ background: 'var(--up-bg-tint)', padding: 12 }}>
            <div className="up-row up-row--between">
              <div>
                <div className="up-gu" style={{ fontWeight: 600 }}>{form.client_snapshot.name_gu}</div>
                <div>{form.client_snapshot.name_en}</div>
                <div className="up-field__hint">
                  {form.client_snapshot.is_government ? 'Government / PSU' : 'Private / Commercial'}
                  {form.client_snapshot.gst_number ? ` · GSTIN ${form.client_snapshot.gst_number}` : ''}
                </div>
              </div>
              <button type="button" className="up-btn up-btn--ghost up-btn--sm"
                      onClick={() => patch({ client_id: null, client_snapshot: null, client_contact_id: null, contact_snapshot: null })}>
                Change
              </button>
            </div>
          </div>
        ) : (
          <>
            <input
              className="up-input"
              placeholder="Search by name (English/Gujarati) or department…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {clientsQ.isLoading && <div>Loading clients…</div>}
            {clientsQ.error && <div className="up-field__error">Failed to load clients: {String(clientsQ.error.message)}</div>}
            {clientsQ.data && (
              <div className="up-pickergrid" style={{ maxHeight: 320, overflow: 'auto' }}>
                {filteredClients.slice(0, 60).map((c) => (
                  <button key={c.id} type="button" className="up-pickerbtn" onClick={() => pickClient(c)}>
                    <div className="up-pickerbtn__title up-gu">{c.name_gu}</div>
                    <div className="up-pickerbtn__sub">{c.name_en}</div>
                    {c.department_en && <div className="up-pickerbtn__sub">{c.department_en}</div>}
                  </button>
                ))}
                {filteredClients.length === 0 && <div className="up-field__hint">No matches.</div>}
              </div>
            )}
          </>
        )}
      </div>

      {form.client_id && (
        <div className="up-card up-stack-3">
          <h3 className="up-card__title" style={{ margin: 0 }}>Contact (optional)</h3>
          {contactsQ.isLoading && <div>Loading…</div>}
          {contactsQ.data && contactsQ.data.length === 0 && (
            <div className="up-field__hint">No contacts on file. Skip if not relevant.</div>
          )}
          {contactsQ.data && contactsQ.data.length > 0 && (
            <div className="up-pickergrid">
              {contactsQ.data.map((c) => {
                const picked = form.client_contact_id === c.id;
                return (
                  <button key={c.id} type="button"
                    className={`up-pickerbtn ${picked ? 'up-pickerbtn--added' : ''}`}
                    onClick={() => picked
                      ? patch({ client_contact_id: null, contact_snapshot: null })
                      : pickContact(c)}>
                    <div className="up-pickerbtn__title">
                      {[c.salutation, c.name_en].filter(Boolean).join(' ')}
                    </div>
                    <div className="up-pickerbtn__sub up-gu">{c.name_gu}</div>
                    {c.designation_en && <div className="up-pickerbtn__sub">{c.designation_en}</div>}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      <div className="up-card up-stack-4">
        <h3 className="up-card__title" style={{ margin: 0 }}>Media + Rate</h3>

        <div className="up-grid-2">
          <div className="up-field">
            <label className="up-field__label">Media</label>
            <div className="up-row" style={{ gap: 8 }}>
              {(mediaQ.data ?? [{ code: 'AUTO', name_en: 'Auto Hood' }, { code: 'GSRTC', name_en: 'GSRTC LED' }]).map((m) => (
                <button key={m.code} type="button"
                        className={`up-btn ${form.media_code === m.code ? 'up-btn--primary' : ''}`}
                        onClick={() => pickMedia(m.code)}>
                  {m.name_en}
                </button>
              ))}
            </div>
          </div>

          <div className="up-field">
            <label className="up-field__label">Rate basis</label>
            <div className="up-row" style={{ gap: 8 }}>
              <button type="button"
                      className={`up-btn ${form.rate_type === 'DAVP' ? 'up-btn--primary' : ''}`}
                      onClick={() => patch({ rate_type: 'DAVP' })}>
                DAVP (Government)
              </button>
              <button type="button"
                      className={`up-btn ${form.rate_type === 'AGENCY' ? 'up-btn--primary' : ''}`}
                      onClick={() => patch({ rate_type: 'AGENCY' })}>
                Agency (Commercial)
              </button>
            </div>
            <div className="up-field__hint">
              Defaulted from client type · {form.client_snapshot?.is_government ? 'Govt → DAVP' : 'Private → Agency'}.
              Override if needed.
            </div>
          </div>
        </div>

        <div className="up-field">
          <label className="up-field__label">Document language</label>
          <div className="up-row" style={{ gap: 8 }}>
            <button type="button"
                    className={`up-btn ${form.language === 'gu' ? 'up-btn--primary' : ''}`}
                    onClick={() => patch({ language: 'gu' })}>
              ગુજરાતી primary
            </button>
            <button type="button"
                    className={`up-btn ${form.language === 'en' ? 'up-btn--primary' : ''}`}
                    onClick={() => patch({ language: 'en' })}>
              English primary
            </button>
          </div>
          <div className="up-field__hint">Both languages always appear; this picks which one is dominant.</div>
        </div>
      </div>

      <WizardNav />

      {showAdd && (
        <QuickAddClientModal
          onClose={() => setShowAdd(false)}
          onAdded={(c) => pickClient(c)}
        />
      )}
    </div>
  );
}
