// =====================================================================
// Step 2 — Subject (en + gu), proposal date, optional campaign window,
// expiry override.
// =====================================================================

import { useWizardStore } from '@/store/wizardStore';
import Stepper from './Stepper';
import WizardNav from './WizardNav';

export default function Step2Subject() {
  const form = useWizardStore((s) => s.form);
  const patch = useWizardStore((s) => s.patch);

  function set(field) {
    return (e) => patch({ [field]: e.target.value });
  }

  return (
    <div className="up-page up-stack-4">
      <header className="up-page__header">
        <div>
          <h1 className="up-page__title">New Proposal</h1>
          <div className="up-page__sub">Step 2 of 6 — Subject + Dates</div>
        </div>
      </header>

      <Stepper />

      <div className="up-card up-stack-4">
        <div className="up-grid-2">
          <div className="up-field">
            <label className="up-field__label">Proposal date</label>
            <input type="date" className="up-input"
                   value={form.proposal_date}
                   onChange={set('proposal_date')} />
            <div className="up-field__hint">Drives ref-no FY (Apr–Mar). Don't backdate without reason.</div>
          </div>
          <div className="up-field">
            <label className="up-field__label">Auto-expire after (days)</label>
            <input type="number" className="up-input" min={7} max={365}
                   value={form.expire_after_days}
                   onChange={(e) => patch({ expire_after_days: Number(e.target.value) })} />
            <div className="up-field__hint">SENT proposals with no activity for this long flip to EXPIRED.</div>
          </div>
        </div>

        <div className="up-field">
          <label className="up-field__label">Subject — English</label>
          <input className="up-input" placeholder="e.g. Auto-rickshaw hood publicity for Polio drive — Apr-Jun 2026"
                 value={form.subject_en} onChange={set('subject_en')} />
        </div>
        <div className="up-field">
          <label className="up-field__label up-gu">વિષય — ગુજરાતી</label>
          <input className="up-input up-gu" placeholder="દા.ત. પોલિયો ડ્રાઇવ માટે ઓટો-રિક્ષા હૂડ પ્રચાર — એપ્રિલ-જૂન ૨૦૨૬"
                 value={form.subject_gu} onChange={set('subject_gu')} />
        </div>

        <div className="up-grid-3">
          <div className="up-field">
            <label className="up-field__label">Campaign duration (days)</label>
            <input type="number" className="up-input" min={1}
                   value={form.campaign_duration_days}
                   onChange={(e) => patch({ campaign_duration_days: Number(e.target.value) })} />
          </div>
          <div className="up-field">
            <label className="up-field__label">Campaign start (optional)</label>
            <input type="date" className="up-input"
                   value={form.campaign_start_date} onChange={set('campaign_start_date')} />
          </div>
          <div className="up-field">
            <label className="up-field__label">Campaign end (optional)</label>
            <input type="date" className="up-input"
                   value={form.campaign_end_date} onChange={set('campaign_end_date')} />
          </div>
        </div>
      </div>

      <WizardNav />
    </div>
  );
}
