// =====================================================================
// P&L module entry point.
//
// Sequence:
//   1. RequireRole('owner', 'co_owner') gates this route in main.jsx.
//   2. PnLGate decides what to render:
//        a. profile.totp_enrolled === false → <EnrollTotp/>
//        b. enrolled but step-up expired      → <VerifyTotp/>
//        c. enrolled + verified within 15 min → <PnLTabs/>
//   3. PnLTabs switches between Summary / Per-proposal / Admin / Log.
//
// Verification is in-memory (totpVerifiedAt in authStore) — every fresh
// page load forces re-verification by design.
// =====================================================================

import { useState } from 'react';
import { useAuthStore } from '@/store/authStore';

import EnrollTotp from './pnl/EnrollTotp';
import VerifyTotp from './pnl/VerifyTotp';
import PnLSummary from './pnl/PnLSummary';
import ProposalPnL from './pnl/ProposalPnL';
import AdminExpenses from './pnl/AdminExpenses';
import AccessLog from './pnl/AccessLog';

const TABS = [
  { id: 'summary',   label: 'Summary'        },
  { id: 'proposals', label: 'Per proposal'   },
  { id: 'admin',     label: 'Admin expenses' },
  { id: 'log',       label: 'Access log'     },
];

export default function PnLLanding() {
  const profile = useAuthStore((s) => s.profile);
  const totpVerifiedAt = useAuthStore((s) => s.totpVerifiedAt);

  // First-time enrollment
  if (profile && !profile.totp_enrolled) {
    return <EnrollTotp onEnrolled={() => { /* state already updated */ }} />;
  }

  // Step-up auth (re-required every 15 min or on tab refresh)
  const ageOk = totpVerifiedAt && (Date.now() - new Date(totpVerifiedAt).getTime() < 15 * 60 * 1000);
  if (!ageOk) {
    return <VerifyTotp reason={totpVerifiedAt ? 'expired' : 'initial'} />;
  }

  return <PnLTabs />;
}

function PnLTabs() {
  const [tab, setTab] = useState('summary');
  const profile = useAuthStore((s) => s.profile);
  const totpVerifiedAt = useAuthStore((s) => s.totpVerifiedAt);
  const remainingMs = totpVerifiedAt ? 15 * 60 * 1000 - (Date.now() - new Date(totpVerifiedAt).getTime()) : 0;
  const remainingMin = Math.max(0, Math.ceil(remainingMs / 60000));

  return (
    <div className="up-page up-stack-4">
      <header className="up-page__header">
        <div>
          <h1 className="up-page__title">P&amp;L</h1>
          <div className="up-page__sub">
            {profile?.full_name} ({profile?.role}) · re-verify in ~{remainingMin} min
          </div>
        </div>
      </header>

      <div className="up-stepper" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} type="button"
                  role="tab"
                  aria-selected={tab === t.id}
                  className={`up-stepper__item ${tab === t.id ? 'up-stepper__item--active' : ''}`}
                  onClick={() => setTab(t.id)}>
            <span>{t.label}</span>
          </button>
        ))}
      </div>

      {tab === 'summary'   && <PnLSummary />}
      {tab === 'proposals' && <ProposalPnL />}
      {tab === 'admin'     && <AdminExpenses />}
      {tab === 'log'       && <AccessLog />}
    </div>
  );
}
