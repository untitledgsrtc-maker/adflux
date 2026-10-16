# Untitled Adflux — Investor Deck Landing Page (`/investor`) — Design Spec

**Date:** 2026-08-12
**Goal:** A password-gated, interactive investor pitch at `app.untitledad.in/investor` — the 12-slide deck + the Excel model turned into a scrolling web page with a **live forecast calculator**.
**Audience:** Wealthy individuals / angels (HNIs) — local backers writing ₹-crore cheques. Tone: proven-operator, radically honest.
**Sources:** `Untitled_Adflux_Investor_Deck.pptx` (narrative) + `GSRTC_98_Station_Model.xlsx` (numbers). This spec reconciles the two.

---

## 1 · Locked decisions (from brainstorming, 2026-08-12)

| Decision | Choice |
|---|---|
| Audience | HNIs / angels (proven-operator story, tangible assets, clear payback) |
| Access | **Password-gated** (link works for anyone; password shown first; owner shares password with investors) |
| Financial story | **Full transparency** — lead with the hard truth, then the fix |
| Calculator | **Live sliders** — investor moves levers, forecast + payback + equity% recompute |
| Why expand | All three: **fill the empty inventory + lock the concession moat + scale auto-hood** |
| Valuation | **Let the calculator show it** — investor picks a valuation, page shows their % + return |
| Revenue plan | Private-brand sales team + agency/programmatic tie-ups + government (DAVP) volume |
| Funding | **Help-me → resolved (see §4):** ₹5 Cr equity + ₹2.5 Cr receivables-debt + ₹1 Cr accrual, **phased**; debt facility flagged as a condition |
| Design tone | **Bold, like `/led`** — Untitled navy `#0A0E1A` + brand yellow `#FFE600`, LED energy, animated |
| Assets | Reuse `/led` + `/deck`: `station-1.jpg`, `station-2.jpg`, `station-hero.mp4`, `dashboard-real.png`, `logos-1..4.png`, brand SVGs |

---

## 2 · The reconciled financial truth (what the page states)

The `.pptx` (polished) and `.xlsx` (candid) disagreed. Owner-confirmed the real position:

- **Existing 20 stations: ~₹1 L/month LED operating profit** (income ₹10.14 L − opex ₹9.08 L). "Monthly Bill" = electricity, already inside opex; the Funding-sheet "₹12 L loss / survival" narrative is **stale** — do NOT use it.
- **Auto-hood (bus branding): SEPARATE existing business, NOT granted by this tender.** ~₹60 L/mo gross, **25% net margin → ~₹15 L/mo net = ~₹1.8 Cr/yr.** It is the real profit engine — but it stands apart from the 98-station bid.
- **The 98-station expansion is an LED-only play.** LED-only it matures to ~₹0.83–1.0 Cr/yr operating profit; **LED-only payback runs past the 5-year contract.** The page says this out loud.
- **Fill = 2%** of screen slots sold today. The upside is demand, not capacity.
- **We are already profitable** (existing LED + auto-hood). An HNI backs a proven operator making a strategic bet, not a startup chasing breakeven.

### Core numbers (₹, from the model, owner-confirmed)
- Existing: 264 screens / 20 stations; income ₹10.14 L/mo; opex ₹9.08 L/mo; profit ₹1.06 L/mo (₹12.8 L/yr); sunk capex ₹1.84 Cr; fill 2%.
- Auto-hood: gross ₹60 L/mo; **net 25% → ₹15 L/mo = ₹1.8 Cr/yr** (separate).
- New 98: 13.2 screens/station (tender may spec ~10) → ~1,294 screens; mature rev ₹49.7 L/mo; new opex ₹42.7 L/mo (incl GSRTC license ₹18.1 L/mo); mature profit ₹6.95 L/mo (₹83 L/yr); Year-1 (60% ramp) LOSS ₹12.9 L/mo.
- New build capex: **₹6.11 Cr** (LED ₹3.92 Cr · meters ₹0.23 Cr · electrification ₹0.79 Cr · internet ₹0.10 Cr · DAVP file ₹0.98 Cr · cameras ₹0.07 Cr · AI ₹0.05 Cr · survey ₹0.30 Cr · BG fee ₹0.01 Cr).
- Tender: EMD ₹80 L (refundable) · BG = 10% of annual license (₹21.7 L, a bank instrument; cash margin ₹3–33 L) · 3 yrs audited accounts required · 5-yr term.

### 5-year base-case forecast (₹ Cr — the calculator's default state)
| | Y1 | Y2 | Y3 | Y4 | Y5 |
|---|---|---|---|---|---|
| Ramp (% mature) | 60% | 85% | 100% | 100% | 100% |
| Total revenue | 10.79 | 12.32 | 13.25 | 13.29 | 13.33 |
| Total costs | 10.72 | 10.75 | 10.78 | 10.82 | 10.86 |
| **Total op profit** | **0.08** | **1.57** | **2.47** | **2.47** | **2.48** |
| LED-only op profit | −1.42 | 0.07 | 0.97 | 0.97 | 0.98 |
| Capex (Y1) | 6.1 | 0 | 0 | 0 | 0 |
| Net cash | −6.02 | 1.57 | 2.47 | 2.47 | 2.48 |
| **Cumulative cash** | −6.02 | −4.45 | −1.98 | **0.49** | **2.97** |

Cumulative cash turns positive in **Year 4** (total, incl auto-hood). LED-only, longer.

---

## 3 · Page structure (scrolling sections)

Password gate → then:

1. **Hero** — "The proven operator on Gujarat's transit network, ready to scale 5×." Facts: ₹8.8 Cr turnover · 264 screens · 20 stations · **already profitable**. `station-hero.mp4` backdrop, brand LED treatment.
2. **Where we stand today** *(current, detailed)* — honest current economics: existing 20 ≈ ₹1 L/mo LED + **auto-hood ≈ ₹1.8 Cr/yr net (separate engine)**; only **2% of slots sold** → demand is the lever.
3. **The record** *(past)* — 10 yrs, ₹0 → ₹8.8 Cr, **4× in 5 years**; revenue chart; government-anchored (with cyclicality noted).
4. **The bet: 98 stations** *(future capex)* — tender, 5× network, **₹6.1 Cr build**, moat (₹80 L EMD + audited-accounts barrier). What ₹5 Cr buys.
5. **The honest math** — LED-only payback > 5-yr term, **stated plainly**; then the three reasons we do it: **fill upside + concession moat + auto-hood scale**.
6. **The revenue plan** — lift fill from 2%: **private-brand sales team + agency/programmatic + government volume**.
7. **★ Forecast calculator** *(hero interactive)* — see §5.
8. **The ask + funding** — ₹5 Cr; the honest funding stack (§4); use of funds.
9. **Risks, plainly** — govt concentration · election cyclicality · demand-led fill · auto-hood attribution · capital intensity · unaudited (audits + consolidation in progress).
10. **Close** — Brijesh · Founder · Vadodara · "let's talk" + contact.

---

## 4 · Funding stack (the honest resolution)

The ₹9.5 Cr "upfront need" is mostly not hard equity spend:
- **EMD ₹80 L** — refundable deposit (have it, get it back). Not a cost.
- **Bank guarantee** — an instrument; real cash ≈ margin ₹3–33 L, not the full ₹21.7 L.
- **WC buffer ₹2.56 Cr (6 mo)** — cushion, right-sizeable to ~3 mo (₹1.3 Cr); auto-hood cash carries it.
- **Build ₹6.1 Cr** — the only hard spend, and **phased to GSRTC's batch handover**, not day-one.

**Stack presented:** ₹5 Cr equity + ₹2.5 Cr receivables-debt + ₹1 Cr internal accrual, phased.
**Conditions (stated honestly):** (1) bank grants the ₹2.5 Cr facility against government receivables; (2) build phased to handover schedule. Page does NOT claim ₹5 Cr alone covers it.

---

## 5 · The forecast calculator (the standout)

Pure client-side JavaScript — the Excel model, live. No backend. Deterministic; recomputes on every slider move.

### Input sliders (defaults = base case)
1. **New-station fill / demand** — multiplier on new-station mature revenue (default = today's effective rate; the model's `govt+private rev/screen`). Low fill → loss; higher → surplus (Sensitivity sheet).
2. **Auto-hood net margin %** — default **25%** (owner-confirmed). Big swing.
3. **GSRTC new license (annual ₹)** — default ₹2.17 Cr (e-auction can push higher).
4. **Year-1 ramp %** — default 60%.
5. **Screens per station** — default 13.2 (tender may spec ~10).
6. **Valuation (₹ Cr)** — drives the investor's equity %.
7. *(funding)* **WC buffer months** + **debt available (₹)** — drives the funding-gap output.

### Outputs (recompute live)
- **5-year chart** — total revenue, total operating profit, cumulative cash (bars/line). Toggle **LED-only vs total (incl auto-hood)**.
- **Payback year** — first year cumulative cash ≥ 0.
- **Your ₹5 Cr** — equity % at the chosen valuation (`5 / (valuation + 5)` post-money), and a rough **return-by-Year-5** (Year-5 profit × illustrative exit multiple × your % ÷ ₹5 Cr).
- **Funding gap** — upfront need (phased build + EMD + BG margin + WC buffer) vs sources (equity + debt + accrual) → gap, live.

### Model formulas (implement exactly)
```
existing_led_profit_yr   = 0.128 Cr, growing 3%/yr
autohood_net_yr          = gross(6.0 Cr) × margin(default 0.25)      [toggle in/out of "total"]
new_rev_mature_mo        = screens_per_station × 98 × (govt_rev_per_screen + priv_rev_per_screen) × fill_mult
new_rev_year(y)          = new_rev_mature × ramp[y]                  ramp = [0.6,0.85,1,1,1]
new_opex_year            = 5.13 Cr (incl license slider) — FULL from Y1 (costs don't ramp)
led_profit_year(y)       = existing_led(y) + new_rev_year(y) − existing_opex(y) − new_opex
total_profit_year(y)     = led_profit_year(y) + autohood_net_yr(if included)
capex                    = 6.11 Cr in Y1 (or phased across build)
net_cash(y)              = total_profit_year(y) − capex(y)
cumulative(y)            = Σ net_cash
payback                  = first y where cumulative ≥ 0
equity_pct               = 5 / (valuation + 5)
```
(Base-case defaults must reproduce the §2 table exactly — a self-check.)

---

## 6 · Technical implementation

- **Static page**, self-contained, like `/led` (§98/§129): `public/investor/index.html` — inline CSS/JS, same-origin assets from `/deck/` + `/led/`, Google Fonts CSS only. **No CDN `<script>`** (app CSP blocks it — §129 foot-gun). Charts drawn in inline SVG/canvas (no chart CDN).
- **Password gate** — a lightweight client gate: a password field; correct password reveals the page (stored obfuscated in the bundle + `sessionStorage` so it persists per session). NOT real security (client-side), but keeps the public + casual competitors out. Owner sets the password. *(If stronger gating is wanted later, a tiny Edge function can check a server-side secret — flagged, not in v1.)*
- **SW denylist** — add `/^\/investor(?:[/?#]|$)/` to `public/sw.js` NavigationRoute denylist (§76/§181/§223/§224) so a rep's installed service worker serves the static page, not the SPA login shell. Same commit. §224 build tripwire stays green (static folder, not a vercel.json rewrite).
- **§45-safe** — brand-new public page, zero touch to the live app / CRM / any hot path.
- **Reveal pattern** — the §129 rule: content reveal via a scroll sweep + interval + `.js` guard, NEVER IntersectionObserver-only or keyframes-from-invisible (a skipped entry = permanently invisible section).
- Not `/deck` and not the CRM: the investor page is its own file; editing it never touches the pitch deck or the app.

---

## 7 · Out of scope (v1) / open items

- **Real server-side password auth** — v1 is client-gate. Upgrade later if needed.
- **PDF export** of the filled calculator — later.
- **Fresh LED-screen close-up photos** — owner may send; v1 uses existing assets.
- **Exact exit-multiple** for the return output — v1 uses an illustrative, clearly-labelled multiple the investor can read as "directional."
- **Audited numbers** — all figures labelled "unaudited; audits + consolidation in progress" (a condition precedent), per the deck.
- **The password value** — owner to choose at build time.

---

## 8 · Success criteria

- An HNI opens the link, enters the password, and in one scroll understands: what you run, that you're already profitable, the 98-station bet, the honest payback truth, and how their money works.
- They can **move the sliders** and watch the 5-year forecast, payback, and their own equity %/return recompute — doing the math *with* the founder.
- The base-case calculator reproduces the §2 forecast table exactly.
- Nothing in the live CRM changes; the page is additive and password-gated.
