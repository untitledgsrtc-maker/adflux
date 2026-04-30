// =====================================================================
// Template dispatcher.
//
// Single entry point used by the API. Picks the right template based
// on the (kind, rate_basis, media) combination. Throws loudly on
// anything unexpected — silent fallback to the wrong template is the
// last thing we want when the watermark is the only visual difference.
//
// Usage from the API:
//
//   import { renderTemplate } from '../pdf-templates/render.js';
//
//   const html = renderTemplate({
//     kind: 'PROPOSAL',           // or 'RECEIPT' / 'SETTLEMENT'
//     rateBasis: 'DAVP',          // PROPOSAL only: 'DAVP' | 'AGENCY'
//     media: 'AUTO',              // PROPOSAL only: 'AUTO' | 'GSRTC'
//     data: { ... },              // template-specific payload
//   });
//
// The HTML that comes back is then handed to Puppeteer for PDF.
// =====================================================================

import { render as renderDavpAuto    } from './proposal-davp-auto.js';
import { render as renderDavpGsrtc   } from './proposal-davp-gsrtc.js';
import { render as renderAgencyAuto  } from './proposal-agency-auto.js';
import { render as renderAgencyGsrtc } from './proposal-agency-gsrtc.js';
import { render as renderReceipt     } from './receipt-voucher.js';
import { render as renderSettlement  } from './receipt-final.js';

const PROPOSAL_RENDERERS = {
  'DAVP|AUTO':     renderDavpAuto,
  'DAVP|GSRTC':    renderDavpGsrtc,
  'AGENCY|AUTO':   renderAgencyAuto,
  'AGENCY|GSRTC':  renderAgencyGsrtc,
};

export function renderTemplate({ kind, rateBasis, media, data }) {
  if (!data || typeof data !== 'object') {
    throw new Error('renderTemplate: data is required');
  }

  switch (kind) {
    case 'PROPOSAL': {
      if (!rateBasis || !media) {
        throw new Error(`renderTemplate(PROPOSAL): rateBasis and media required (got rateBasis=${rateBasis}, media=${media})`);
      }
      const key = `${rateBasis}|${media}`;
      const fn = PROPOSAL_RENDERERS[key];
      if (!fn) {
        throw new Error(`renderTemplate(PROPOSAL): no renderer for ${key}. Valid: ${Object.keys(PROPOSAL_RENDERERS).join(', ')}`);
      }
      return fn(data);
    }

    case 'RECEIPT':
      return renderReceipt(data);

    case 'SETTLEMENT':
      return renderSettlement(data);

    default:
      throw new Error(`renderTemplate: unknown kind "${kind}". Valid: PROPOSAL, RECEIPT, SETTLEMENT`);
  }
}

// Re-export for direct imports if a consumer wants to skip the dispatch.
export {
  renderDavpAuto,
  renderDavpGsrtc,
  renderAgencyAuto,
  renderAgencyGsrtc,
  renderReceipt,
  renderSettlement,
};
