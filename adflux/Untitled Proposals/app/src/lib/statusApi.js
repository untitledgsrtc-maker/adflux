// =====================================================================
// Status-transition API. Wraps the transition_proposal_status RPC.
// =====================================================================

import { callRpc } from './supabase';

export const STATUSES = ['DRAFT', 'SENT', 'WON', 'PARTIAL_PAID', 'PAID', 'CANCELLED', 'REJECTED', 'EXPIRED'];

export const SUBMISSION_MODES = ['PHYSICAL', 'EMAIL', 'COURIER'];

/**
 * Returns the array of (label, target_status) buttons that should
 * appear given the current proposal status.
 */
export function allowedTransitions(currentStatus) {
  switch (currentStatus) {
    case 'DRAFT':
      return [
        { label: 'Mark sent',     target: 'SENT',      kind: 'primary' },
        { label: 'Cancel',        target: 'CANCELLED', kind: 'danger'  },
      ];
    case 'SENT':
      return [
        { label: 'Mark won (PO received)', target: 'WON',       kind: 'primary' },
        { label: 'Client rejected',        target: 'REJECTED',  kind: 'ghost'   },
        { label: 'Cancel',                 target: 'CANCELLED', kind: 'danger'  },
      ];
    case 'WON':
    case 'PARTIAL_PAID':
      return [
        { label: 'Cancel',        target: 'CANCELLED', kind: 'danger' },
      ];
    case 'EXPIRED':
      return [
        { label: 'Resend',        target: 'SENT',      kind: 'primary' },
      ];
    case 'PAID':
    case 'REJECTED':
    case 'CANCELLED':
    default:
      return [];
  }
}

export async function transitionStatus(proposalId, newStatus, payload = {}) {
  return callRpc('transition_proposal_status', {
    p_proposal_id: proposalId,
    p_new_status: newStatus,
    p_payload: payload,
  });
}
