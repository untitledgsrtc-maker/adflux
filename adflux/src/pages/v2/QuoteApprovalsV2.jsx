// src/pages/v2/QuoteApprovalsV2.jsx
//
// Phase 360 (2026-10-13) - the Sales Head's quote-price approval queue
// (/quote-approvals). Admin has the same queue inside /pending-approvals.
// The page is a thin shell around the shared panel so both screens show ONE
// definition of "a price request" (section 71).

import QuotePriceApprovals from '../../components/quotes/QuotePriceApprovals'
import { PRICE_FLOOR } from '../../utils/quotePriceGate'

export default function QuoteApprovalsV2() {
  return (
    <div className="v2d-pa">
      <div className="v2d-page-head">
        <div>
          <div className="v2d-page-kicker">Sales head review queue</div>
          <h1 className="v2d-page-title">Quote prices</h1>
          <div className="v2d-page-sub">
            Quotes with a price below Rs {PRICE_FLOOR} per screen wait here. Approve to let the rep send it,
            or reject with the price you can accept.
          </div>
        </div>
      </div>
      <QuotePriceApprovals title="Waiting for a decision" />
    </div>
  )
}
