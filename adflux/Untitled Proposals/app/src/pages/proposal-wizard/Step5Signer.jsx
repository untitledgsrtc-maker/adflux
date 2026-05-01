// =====================================================================
// Step 5 — Pick a signer from team_members. Defaults to first active
// member if there's only one (saves a click).
// =====================================================================

import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useWizardStore } from '@/store/wizardStore';
import { fetchTeamMembers, qk } from '@/lib/proposalApi';
import Stepper from './Stepper';
import WizardNav from './WizardNav';

export default function Step5Signer() {
  const form = useWizardStore((s) => s.form);
  const patch = useWizardStore((s) => s.patch);
  const teamQ = useQuery({ queryKey: qk.teamMembers(), queryFn: fetchTeamMembers });

  // Auto-pick if exactly one active signer
  useEffect(() => {
    if (!form.team_member_id && teamQ.data?.length === 1) {
      const t = teamQ.data[0];
      patch({ team_member_id: t.id, signer_snapshot: t });
    }
  }, [teamQ.data, form.team_member_id, patch]);

  function pick(t) {
    patch({ team_member_id: t.id, signer_snapshot: t });
  }

  return (
    <div className="up-page up-stack-4">
      <header className="up-page__header">
        <div>
          <h1 className="up-page__title">New Proposal</h1>
          <div className="up-page__sub">Step 5 of 6 — Signer</div>
        </div>
      </header>

      <Stepper />

      <div className="up-card up-stack-3">
        <h3 className="up-card__title" style={{ margin: 0 }}>Who signs this proposal?</h3>
        {teamQ.isLoading && <div>Loading team members…</div>}
        {teamQ.error && <div className="up-field__error">Failed to load team members.</div>}
        {teamQ.data && teamQ.data.length === 0 && (
          <div className="up-field__error">
            No active team members. Add at least one in Masters → Team Members before continuing.
          </div>
        )}
        <div className="up-pickergrid">
          {teamQ.data?.map((t) => {
            const picked = form.team_member_id === t.id;
            return (
              <button key={t.id} type="button"
                      className={`up-pickerbtn ${picked ? 'up-pickerbtn--added' : ''}`}
                      onClick={() => pick(t)}>
                <div className="up-pickerbtn__title">{t.name_en}</div>
                <div className="up-pickerbtn__sub up-gu">{t.name_gu}</div>
                <div className="up-pickerbtn__sub">{t.designation_en}</div>
                {t.mobile && <div className="up-pickerbtn__sub">Mob: {t.mobile}</div>}
              </button>
            );
          })}
        </div>
      </div>

      <WizardNav />
    </div>
  );
}
