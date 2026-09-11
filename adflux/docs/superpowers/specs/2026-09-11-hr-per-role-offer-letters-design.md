# AdFlux Per-Role Offer-Letter Module — Design Spec

**Purpose of this document:** two audiences. **Owner (Brijesh):** read Section 2 — it is the actual wording of the three new letters. Approve or redline the paragraphs; every place a real number/policy is still a guess is tagged **[OWNER TO CONFIRM]**. **Engineer:** Sections 1, 3, 4, 5 — the resolution rule, the exact file:line wiring, the convert-to-user role-mint fix, and the ship order.

**Legal note (not a lawyer):** these are employment letters. Nothing below is vetted counsel; the wording mirrors the existing sales letter's structure and cites Indian statutes as the sales letter already does. Treat the [OWNER TO CONFIRM] figures as the load-bearing decisions.

---

## 1 · Problem, the 4-variant model, and the role→template rule

**Problem (one line):** the offer-letter PDF is hardcoded to the sales letter (sales grades L1/L2/L3, "Sales & Business Development" department, a commission Annexure, sales KPIs) — so an Operations technician, a telecaller, or an accountant all currently receive a *sales* letter with commission clauses that do not apply to them, and on "convert to user" they are all minted as **sales** users regardless of designation.

**The 4-variant model.** One letter body per role shape. The **SALES** letter stays byte-for-byte unchanged. Three new bodies are added:

| Variant | Who gets it | Key shape |
|---|---|---|
| **SALES** (unchanged) | Field sales — auth_role `sales`, incentive on | L1/L2/L3 grade, commission Annexure B.2, bike TA/DA Annexure C |
| **OPERATIONS** (new) | LED-network field/desk ops — `operation_executive`, `operation_head` | Uptime-linked variable (not commission), Operations TA/DA chart, station KPIs |
| **TELECALLER** (new) | Inside-sales phone reps — auth_role `telecaller`, incentive on | Call/connect/qualified-lead incentive, **no** field TA/DA, flat "TC" grade |
| **GENERIC_SALARIED** (new) | Flat-salary office roles — HR, Accounts, Designer, Video Editor, Office Boy, Creative Lead, Admin, co_owner | Pure fixed salary, **no** variable/commission, **no** field TA/DA, no grade/territory rows |

**The resolution rule (deterministic, from the designation's own fields).** New shared helper `src/utils/offerTemplate.js`:

```
resolveOfferTemplate({ auth_role, team_role, has_incentive }):
  if has_incentive === true:
      'telecaller'  when auth_role === 'telecaller'
      'sales'       when auth_role === 'sales'
      'generic'     otherwise
  if has_incentive === false:
      'ops'         when auth_role === 'staff'
      'generic'     otherwise            (HR, Admin, Accounts, co_owner)
  default on any null/unknown → 'generic'   (safe: generic drops sales-only annexures)
```

Reads only from the **designations master** row that was picked when the offer was sent. `team_role` is not needed for the four buckets.

> **[OWNER TO CONFIRM — one design decision]** The `auth_role='staff'` bucket currently collapses **Graphic Designer, Video Editor, Operation Execution, Creative Lead, and Office Boy** all into the **OPERATIONS** letter (with its "screen uptime / station coverage" KPIs). That fits the two Operations roles, but a **Graphic Designer** or an **Office Boy** reads far more naturally as a **GENERIC** salaried letter than a field-uptime one. Two options — pick one:
> - **(a)** Keep the rule as-is: all `staff` → Operations letter. Simplest.
> - **(b)** Split: only `team_role IN ('ops_execution')` → Operations; every other `staff` → Generic. One extra line of code. **Recommended** — it stops a designer getting a "maintain 95% screen uptime" letter.

---

## 2 · The three new letters — WORDING FOR OWNER REVIEW

Each clause is tagged **[STANDARD]** (same wording family as the sales letter you already approved — skim) or **[REVIEW — role-specific]** (new or changed — read closely). To avoid three copies of identical boilerplate, **Operations is printed in full**; Telecaller and Generic then show only what changes from it, plus their own full annexures.

---

### 2A · OPERATIONS letter — "LED Screen Network Maintenance"

**Applies to:** Operations Executive (Field Maintenance Technician) — `operation_executive`, GPS-tracked field role — and Operations Head — `operation_head`, desk role owning network-wide uptime. Both are internal Untitled Advertising employees on the GSRTC LED screen network. Neither is a sales/commission role.

**Printed title (derived from role, the way the sales letter derives L1/L2/L3):**
- `operation_executive` → **Operations Executive (Field Maintenance Technician)**; grade line **"OPS-FT — Field Maintenance Technician"**
- `operation_head` → **Operations Head**; grade line **"OPS-HD — Operations Head"**

**Department:** Operations (LED Screen Network Maintenance) — replaces "Sales & Business Development".
**Reporting To:** Executive → the Operations Head; Head → Mr. Brijesh Solanki, Proprietor – Sales & Operations.
**"Assigned Territory" row is relabelled "Assigned Stations / Depots".**

> **[OWNER TO CONFIRM] grade codes** "OPS-FT" and "OPS-HD" are drafted labels. Say the word if you want different codes (or none).

#### Clause 1 — Position, Designation & Reporting  **[REVIEW]**
Your appointment is on the following particulars. **Designation:** Operations Executive (Field Maintenance Technician) for an operations executive, or Operations Head for the head. **Grade / Level:** OPS-FT — Field Maintenance Technician, or OPS-HD — Operations Head, per Annexure A. **Department:** Operations (LED Screen Network Maintenance). **Reporting To:** for a field technician, the Operations Head; for the Operations Head, Mr. Brijesh Solanki, Proprietor – Sales & Operations. **Work Location:** Vadodara and the LED screen stations / bus-station depots assigned to you across Gujarat. **Assigned Stations / Depots:** the LED screens and station/depot locations allotted to you from time to time (for the Operations Head, the entire LED screen network). **Date of Joining** as stated above. The Company reserves the right to transfer, depute, or reassign you to any other station, depot, route, function, location, branch, or associate entity within India, based on operational requirements, without any change in the essential terms of employment other than those strictly necessitated by such reassignment.

#### Clause 2 — Nature of Employment  **[REVIEW — one added sentence]**
Full-time, subject to successful completion of the probation period in Clause 4. Employment is exclusive; you shall not engage, directly or indirectly, in any other trade, business, profession, employment, or remunerative activity during your tenure, whether during or outside working hours, without prior written permission from the Proprietor. *Added for this role:* by the nature of the role you may be required to attend to screen faults, preventive maintenance, and station coverage outside standard hours where an outage or the station operating window so requires.

#### Clause 3 — Date of Joining & Documentation  **[REVIEW — extra field-role documents]**
Join on or before the joining date stated above; failure to do so without prior written approval renders the offer null and void, with no obligation to extend or re-issue. At joining, submit self-attested copies (originals for verification): PAN & Aadhaar; educational certificates (10th, 12th, and any technical / ITI / diploma certificate, as applicable); experience/relieving letters; last 3 months' salary slips and last 2 FYs' Form 16 where applicable; **valid two-wheeler/vehicle driving licence and vehicle RC [field technician role, as field travel is a core requirement]**; 4 passport photos; proof of current address; bank details (cancelled cheque/passbook) for salary transfer; two professional/character references. Appointment is contingent on document verification, background/reference checks, and medical fitness where required. The Company may withdraw the offer or terminate with immediate effect, without notice or pay in lieu, if any information is found false, misleading, or materially incomplete at any time.

#### Clause 4 — Probation & Confirmation  **[REVIEW — uptime KPIs replace sales KPIs]**
Probation of **six (6) months** from joining. Performance is evaluated on defined KPIs including **monthly-average screen uptime maintained across your assigned screens (network-wide uptime, for the Operations Head), fault-resolution turnaround, station and depot coverage, adherence to reporting and attendance discipline, care of Company equipment, and overall conduct.** Probation may be extended up to **three (3) months** at the Company's sole discretion. Confirmation is intimated in writing; until then you remain on probation. If performance is unsatisfactory the Company may (a) extend probation, (b) reassign you to different stations or a different role, or (c) terminate under Clause 14.

> **[OWNER TO CONFIRM]** 6-month probation + 3-month extension (same as sales letter). Change if ops should differ.

#### Clause 5 — Compensation & Remuneration  **[REVIEW — 70:30 uptime-linked, not commission]**
Your CTC is as stated (per month and per annum), paid monthly, inclusive of all statutory and non-statutory components save as in Annexure B. Your monthly remuneration is structured **70:30** — a **Fixed Base of 70% of CTC** (guaranteed monthly), and an **Uptime-Linked Variable of up to 30% of the Fixed Base**, per Annexure B. Currently the Company operates no EPF/ESIC/similar deduction scheme; remuneration is gross, subject only to TDS (Income Tax Act, 1961) and Professional Tax (Gujarat, 1976) where applicable. **Future statutory compliance:** when the Company becomes liable under EPF (1952), ESI (1948), Gratuity (1972) or other labour law, the CTC will be restructured to accommodate contributions **without reducing your net take-home pay**. **Uptime-linked variable pay:** this is **not a sales incentive or commission** — it is earned on the monthly-average uptime of the LED screens you are responsible for, measured by the Company's screen-monitoring system; **no part of your pay is linked to sales revenue, billings, client acquisition, or commission of any kind.** **TA/DA:** field maintenance travel is paid per the "Untitled Operations – Field Travel Allowance Chart (2026-27)" at Annexure C. **Annual review:** ordinarily each April, at the Proprietor's sole discretion; not an entitlement.

#### Clause 6 — Working Days, Hours & Field Travel  **[REVIEW]**
Working days **Monday to Saturday**. Standard hours aligned to the LED screen operating window and the field-maintenance schedule (**ordinarily 9:00 AM to 6:00 PM**, 30-minute lunch, not less than **8.5 working hours/day**), per the Gujarat Shops & Establishments Act, 2019. As the screens operate during the station window (**ordinarily 7:00 AM to 9:00 PM**), you may be required to attend a screen outage, preventive maintenance, or station coverage outside standard hours where operationally required. By the nature of the field-technician role you will travel extensively within your assigned station cluster (and occasionally outside it) for preventive maintenance, fault resolution, coordination with station authorities and local electricians, and uptime; the Operations Head travels as supervision/escalation requires. Sundays and Gujarat government public holidays are weekly off / paid holidays per the Company's published calendar, **subject to on-call for critical outages.**

> **[OWNER TO CONFIRM]** Hours 9–6 for ops (sales/others use 10–7). Station window 7 AM–9 PM. On-call expectation for outages — confirm this is acceptable to state in writing.

#### Clause 7 — Leave Entitlement  **[STANDARD — one added phrase]**
Per the Gujarat Shops & Establishments Act, 2019, and Company policy, pro-rated in the joining year: **EL/PL 21 days/yr** (1.75/completed month, available after 240 working days); **CL 7 days/yr** (non-carry-forward, non-encashable); **SL 7 days/yr** (non-carry-forward, non-encashable; >2 consecutive days needs a registered practitioner's certificate); **Public/Festival holidays** per calendar (typically 10/yr); **Maternity Leave** per the Maternity Benefit Act, 1961. All leave except unforeseen sick leave needs prior written approval of the Reporting Manager **and shall be planned so as not to leave an assigned station uncovered.** Unauthorised absence is loss of pay (LOP) and, if continuous, may amount to misconduct under Clause 14.

> **[OWNER TO CONFIRM]** Leave figures are copied from the sales letter. Confirm they apply unchanged to ops.

#### Clause 8 — Code of Conduct & Company Policies  **[REVIEW — field-safety policy added]**
Highest standards of integrity, honesty, diligence, professionalism; comply with all Company policies including the Code of Conduct & Ethics; Anti-Bribery/Anti-Corruption & Gifts; **Field Safety, Equipment Handling and Working-at-Height Policy (given electrical LED equipment at stations and depots)**; POSH Policy (POSH Act, 2013); Information Security/IT/Data Protection; Social Media & External Communication; Conflict of Interest & Outside Engagement; and Expense Reimbursement & Travel. Devote your whole working time exclusively to the maintenance operations of the Company; no conflicting activity.

#### Clause 9 — Confidentiality & Proprietary Information  **[REVIEW — ops examples]**
You will access Confidential Information including **the LED screen inventory and station/depot lists, screen configurations and player settings, maintenance logs and fault histories, uptime and monitoring data, camera and audience-measurement data, station-authority and local-electrician/vendor contacts and terms, network and CMS credentials,** plus supplier agreements, business plans, financials, trade secrets, know-how, software, databases, and any other proprietary information. During and after employment you shall: hold it in strict confidence and not disclose it except in proper performance of duties with the Proprietor's written authorisation; not use it for any purpose other than the Company's legitimate business; take reasonable steps against unauthorised disclosure/copying; and on cessation return all of it (physical/electronic) with all copies and permanently delete it from personal devices, email, and cloud. Obligations survive termination **indefinitely for trade secrets and for three (3) years for other Confidential Information.**

#### Clause 10 — Intellectual Property  **[REVIEW — ops examples]**
All IP — **maintenance procedures, station and network documentation, software configurations and scripts, checklists, photographs, reports, processes, methods** and any other works created during employment or using Company resources — is the Company's sole property ("Company IP"). You assign (and agree to assign on first creation) all right, title and interest (copyright, design, patent, confidential-information rights) to the Company, absolutely and worldwide, free of encumbrances; you waive moral rights to the maximum extent permitted; and you will execute documents/acts as reasonably required, at the Company's cost, to perfect those rights.

#### Clause 11 — Non-Solicitation  **[REVIEW — adds station authorities/electricians]**
For the term and **twelve (12) months** after cessation (however arising), you shall not directly or indirectly: solicit/entice any **client, station authority, vendor, or electrician** of the Company (with whom you dealt or about whom you had Confidential Information in your last 24 months) to cease/reduce/transfer dealings or engage a competitor; solicit any employee/consultant/vendor/electrician/supplier to leave the Company; or interfere with the Company's relationships with clients, station authorities, vendors, electricians, employees, or associates. **Enforceability note:** these are non-solicitation and legitimate-interest protections only and do not restrain your lawful profession/trade/business post-employment, consistent with Section 27 of the Indian Contract Act, 1872.

#### Clause 12 — Notice Period & Resignation  **[REVIEW — role-split notice]**
**During probation:** fifteen (15) days from either side, or pay in lieu. **Post confirmation:** **Operations Head — sixty (60) days**, or pay in lieu; **field technician — thirty (30) days**, or pay in lieu. Serve the full notice unless the Company accepts shorter/waives it. During notice the Company may place you on garden leave, require handover of assignments/station charge/tools/equipment, bar contact with station authorities and vendors, and/or require return of property. Employment ceases only after you (a) serve notice (or pay in lieu), (b) complete handover of assigned stations, tools, equipment and knowledge transfer, (c) return all property, and (d) receive a written relieving letter and full-and-final settlement.

> **[OWNER TO CONFIRM]** Head 60 days / technician 30 days / probation 15 days.

#### Clause 13 — Full and Final Settlement  **[REVIEW — uptime variable + ops TA]**
On cessation for any reason you receive: (a) salary to the last working day; (b) encashment of unavailed Earned Leave (capped at 30 days' accrual); (c) pending travel-allowance reimbursements supported by the Daily Visit Report and bills; (d) any earned-but-unpaid uptime-linked variable pay computed and approved up to the last completed month — **less** (i) notice shortfall, (ii) advances/loans/dues, (iii) non-returned property (tools, equipment, spare modules, devices) at replacement value, (iv) TDS and statutory deductions. Ordinarily paid within **forty-five (45) working days** from the last working day, subject to exit formalities and clearance.

#### Clause 14 — Termination  **[REVIEW — ops misconduct list]**
Terminable per Clause 12. In addition, the Company may terminate forthwith, without notice or pay in lieu, for gross misconduct including: fraud/theft/embezzlement/misappropriation/dishonesty; **wilful neglect of, or failure to attend to, an assigned screen, station, or fault**; wilful disobedience of lawful instructions; breach of confidentiality/IP/non-solicitation; **acceptance of bribes/kickbacks/gifts of significant value from vendors, electricians, or station authorities without written approval**; conviction for an offence of moral turpitude; **falsification of records, maintenance logs, attendance, GPS/field-location records, travel claims, or reimbursement bills**; alcohol/illegal substances during work or reporting under influence; **unsafe handling of Company equipment causing damage or injury**; repeated non-performance or failure to meet minimum uptime/performance standards after warning; or unauthorised absence of eight (8)+ consecutive working days without approval, provided a show-cause notice was issued and unanswered in time. Save where urgent protective action is needed, the Company observes natural justice (show-cause + opportunity to respond) before acting.

#### Clause 15 — Post-Employment Obligations  **[REVIEW — ops property list]**
On cessation you shall: return forthwith all Company property including **tools, testing/measuring equipment, ladders and safety gear, spare LED modules and parts, laptops, mobile phones, SIM cards, identity/access cards, station keys,** and any other records; permanently delete all Confidential Information from personal devices/email/cloud/social media (with a written declaration if required); cooperate in orderly handover of assigned stations, pending faults, maintenance schedules and station charge to a successor; and continue observing Clauses 9 and 11.

#### Clause 16 — Data Protection & Privacy  **[REVIEW — GPS data noted]**
The Company processes your personal data (**including demographic, financial, identification, and field-location/GPS details captured for attendance and travel-allowance purposes**) for employment administration, payroll, statutory compliance, performance/uptime management and related purposes, per the Digital Personal Data Protection Act, 2023. By accepting, you consent to this processing and to sharing with authorised third-party providers (payroll processors, banks, statutory authorities, auditors) on a need-to-know basis.

#### Clause 17 — Prevention of Sexual Harassment (POSH)  **[STANDARD]**
The Company provides a safe, respectful workplace free from sexual harassment; it maintains an Internal Complaints Committee / redressal mechanism per the POSH Act, 2013; you must familiarise yourself with and comply with the POSH Policy. Any act of sexual harassment is gross misconduct under Clause 14.

#### Clause 18 — Governing Law & Jurisdiction  **[STANDARD]**
Governed by the laws of India. Disputes arising from your employment or its termination are subject to the exclusive jurisdiction of the competent courts at Vadodara, Gujarat, without prejudice to any mandatory statutory forum (labour courts, industrial tribunals).

#### Clause 19 — General Provisions  **[STANDARD — Annexures A–C]**
Entire Agreement (this letter + **Annexures A–C**); Amendment only in writing signed by the Proprietor; Severability; Waiver; **Confidentiality of Remuneration** (personal to you, not to be disclosed save as required by law or with written permission); Notices in writing by hand/registered post/courier/email to the address at the top.

#### Clause 20 — Acceptance  **[STANDARD — ops welcome line]**
Signify acceptance by digitally accepting through the Company's HR portal on or before the joining date; failure renders the offer null and void at the Company's discretion. "We welcome you to the **Untitled Advertising Operations team**, and look forward to a long, mutually rewarding, and professionally fulfilling association."

---

#### Operations — Annexure A · Role-Specific Terms, Responsibilities & KPIs  **[REVIEW]**
*Role-selected (parallel to the sales letter's L1/L2/L3 selection) — only the block matching the role is printed.*

**OPERATIONS EXECUTIVE — FIELD MAINTENANCE TECHNICIAN (`operation_executive`).** Reporting to the Operations Head. Scope: the LED screens and bus-station/depot locations allotted from time to time. **Responsibilities:** (1) preventive maintenance and fault resolution across assigned screens/stations; (2) maintain monthly-average uptime of assigned screens at/above the Annexure B target; (3) attend a reported screen/camera fault within the Company's service-level turnaround; (4) log every visit, fault, cause, resolution in the operations system with photo proof; (5) coordinate with station authorities and local electricians for power, wiring, connectivity, access; (6) report camera/network/timer/content faults on the dashboard; (7) maintain and account for tools, spare modules, equipment. **Indicative uptime target: not less than 95% monthly-average uptime** across assigned screens (measured during the station operating window). **Confirmation criteria:** sustained uptime at/near target over the final three months of probation, disciplined field reporting/attendance, and a conduct rating of "Meets Expectations" or above.

**OPERATIONS HEAD (`operation_head`).** Reporting to the Proprietor. Scope: the entire LED screen network. **Responsibilities:** (1) end-to-end ownership of network-wide uptime and fault resolution; (2) planning, supervision, routing of the field-technician team (station coverage, workload balancing); (3) ticket triage/escalation/closure network-wide; (4) vendor/electrician/station-authority management; (5) preventive-maintenance scheduling and spare-parts planning; (6) coordination with the screen-monitoring/CMS dashboard and the office team on new station rollouts. **Indicative uptime target: network-wide monthly-average uptime at/above 95%.** **Confirmation criteria:** sustained network uptime at/near target over the final three probation months, a functioning disciplined field team, conduct "Meets Expectations" or above. Where performance is below threshold but trending positive, the Company may offer a documented **Performance Improvement Plan (up to 90 days)** in lieu of immediate termination.

*Note:* this is a maintenance/operations role. **No sales, revenue, billing, client-acquisition, cluster-revenue, or commission targets** attach — performance is measured on screen uptime, fault resolution, and station coverage only.

#### Operations — Annexure B · Compensation & Uptime-Linked Variable Pay  **[REVIEW — the key numbers]**
**B.1 — 70:30 structure.** Fixed Base = **70% of CTC** (guaranteed monthly); Uptime-Linked Variable = **up to 30% of the Fixed Base**. Printed table (actual figures): Level (OPS-FT/OPS-HD); Position; Fixed Base/Month (=70% CTC); Fixed Base/Annum; Max Variable/Month (=30% of Fixed Base). Salary by bank transfer **on or before the 7th** of the succeeding month, less TDS (Sec 192) and Professional Tax where applicable.

**B.2 — Uptime-linked variable (NOT commission).** Earned solely on monthly-average uptime of the screens you're responsible for (your stations, or the whole network for the Head). "Uptime" = monthly-average % of time your responsible screens are online **during the station operating window (ordinarily 7:00 AM–9:00 PM)**, as recorded by the Company's screen-monitoring system (**sole and conclusive source**). Computation:
- **≥ 95% uptime → full 30% variable**
- **< 85% uptime → variable is ZERO**
- **85%–95% → pro-rata: Variable = 30% of Fixed Base × (Uptime% − 85) / 10**

Worked examples on a Fixed Base of ₹20,000 (max variable ₹6,000): 96% → ₹6,000; 95% → ₹6,000; 90% → ₹3,000; 87% → ₹1,200; 85% → ₹0; ≤84% → ₹0. Rounding applied in your favour. **No threshold multiple of salary, no monthly billing target, no new-client/renewal commission, no flat stretch bonus** — none of the sales-incentive mechanisms apply.

**B.3 — Terms.** (1) Computed and paid monthly with salary. (2) The monitoring system's uptime figure is final and conclusive; disputes resolved by reference to that record. (3) Screens intentionally powered off outside the station window aren't counted against uptime. (4) Outages from a documented event outside your reasonable control (station-side power failure, authority-directed shutdown), once verified, may be excluded at the Company's assessment. (5) On separation, variable is computed/paid only to the last completed month worked. (6) The Company may revise the bands/structure on **30 days' written notice**, prospectively.

**B.4 — Field travel allowance** per the Untitled Operations chart at Annexure C (distinct from any sales-team chart).

> **[OWNER TO CONFIRM — the load-bearing numbers]** 70:30 split; full-variable at **95%**; zero below **85%**; linear in between. The ₹20,000 base is only an illustration. These bands decide real pay — confirm before this goes out.

#### Operations — Annexure C · Untitled Operations Field Travel Allowance Chart (2026-27)  **[REVIEW]**
*The Operations field chart — separate from, and not to be confused with, the "Gujarat Sales Team – Bike Travel TA-DA Chart"; the sales chart does not apply.*
**Rules:** (1) Two-wheeler/vehicle **₹3/km** on round-trip distance to/from the assigned station/depot (shortest route per Google Maps), no minimum. (2) **DA ₹200 per field-tour day** (food & misc), fixed, no bills. (3) **Toll & parking** 100% on receipts (photo shared on WhatsApp with the Operations Head same day). (4) **Hotel/overnight** only where the station is distant and pre-approved in writing by the Operations Head, within the city ceilings below, inclusive of GST, against an invoice in the name/GSTIN of Untitled Advertising. (5) **Advance** may be drawn each Monday on the planned station-tour programme. (6) **Claims** submitted every Saturday evening with the Daily Visit Report (station, purpose, faults attended, km); settled by the following Tuesday. Non-compliance, inflated claims, or falsified bills/GPS records is gross misconduct under Clause 14.
**City/station hotel ceilings (incl. GST; DA ₹200/day and ₹3/km apply everywhere):** Surat (Cat A) **₹1,100**; B-category (Gandhinagar, Ankleshwar, Valsad/Vapi, Bhavnagar, Junagadh, Jamnagar) **₹900**; C-category (Anand, Kheda/Nadiad, Himmatnagar, Dahod, Godhra, Chikhli, Botad, Veraval, Porbandar, Dwarka, Morbi, Bhachau, Surendranagar) **₹700**. The station list mirrors the active GSRTC LED network and may be amended as it grows.

> **[OWNER TO CONFIRM]** ₹3/km, ₹200 DA, and the three hotel ceilings (₹1,100/₹900/₹700). These mirror the sales chart's rates under an Operations label — confirm they carry over.

---

### 2B · TELECALLER letter — "Inside Sales / Telecalling"

**Applies to:** desk-based phone reps who qualify leads and (where the role includes phone-closing) close over the phone — `telecaller`, `has_incentive = true` (Dhara, Rima, and the Telecaller Team Lead, Renuka). **One flat grade — no L1/L2/L3.**
**Printed title:** `offer.position`, defaulting to **"Telecaller (Inside-Sales Executive)"**. No resolveLevel mapping. Grade/Level row prints **"TC — Telecaller"**. A team-lead hire may print "Telecaller Team Lead" via `offer.position` but rides the same clause set.
**Department:** Inside Sales / Telecalling. **Reporting To:** Telecaller Team Lead (or Mr. Brijesh Solanki, Proprietor – Sales & Operations).

**Clause-by-clause (deltas from Operations §2A unless full text shown):**

- **Clause 1 — Position [REVIEW]:** Desk-based, phone-driven inside-sales. Designation: Telecaller (Inside-Sales Executive) or as in the offer. **Grade/Level: TC – Telecaller** (single grade, no field tier). Department: Inside Sales / Telecalling. Reporting To: Telecaller Team Lead (or the Proprietor). **Work Location: Office, Vadodara (desk-based).** **"Assigned Segment / Lead Queue"** as allocated from time to time (in place of a field territory). Transfer/reassignment paragraph as standard.
- **Clause 2 — Nature of Employment [STANDARD]:** base wording (no out-of-hours field sentence).
- **Clause 3 — Documentation [REVIEW]:** same as Operations **but without the driving-licence/RC requirement** (desk role) and with graduation/post-graduation certificates listed.
- **Clause 4 — Probation [REVIEW]:** 6 months. KPIs: **daily call volume, connect rate, number of qualified lead hand-offs, conversion of qualified leads, callback and follow-up SLA discipline, accuracy of CRM/call logging, and conduct.** Extension up to 3 months; reassign to a different lead segment or role if unsatisfactory.
- **Clause 5 — Compensation [REVIEW]:** CTC as in Annexure B, monthly, inclusive of statutory/non-statutory save as in Annexure B. No EPF/ESIC currently; gross, TDS + Professional Tax only; future-statutory-compliance paragraph as standard. **Performance incentives** per Annexure B, earned on **call-activity, connect-rate and qualified-lead targets (not field billings)**; discretionary, contingent on pre-defined targets. **No field TA/DA** — role is desk/office-based; rare pre-approved travel reimbursed against actual bills only, with no standing allowance. Annual April review, discretionary.
- **Clause 6 — Working Days & Hours [REVIEW]:** Monday–Saturday, **10:00 AM–7:00 PM**, 30-min lunch, ≥8.5 hrs/day (Gujarat S&E Act 2019). Desk-based inside-sales over phone and CRM; **no field travel by nature**; rare off-site only with prior written approval, reimbursed against bills. Sundays + Gujarat holidays as weekly off/paid holidays.
- **Clause 7 — Leave [STANDARD]:** identical figures to Operations (no station-cover phrase).
- **Clause 8 — Code of Conduct [REVIEW]:** standard list **plus a "Telecalling, Do-Not-Call (DNC) and Call-Recording Compliance Policy, and applicable telecom/TRAI regulations governing unsolicited commercial communication."** (No field-safety policy.)
- **Clause 9 — Confidentiality [REVIEW — telecaller examples]:** examples are **client and prospect lists, contact details and lead databases, call data and call recordings, rate cards and commercial terms, pricing strategies, campaign and lead-source information,** plus business plans, financials, trade secrets, software, databases, marketing plans. Reasonable-steps bullet explicitly covers **"including the export or copying of lead/contact databases."** Survival: indefinite for trade secrets, 3 years otherwise.
- **Clause 10 — IP [REVIEW — telecaller examples]:** **call scripts, pitch and objection-handling material, creative concepts, copy, client proposals, lead databases, call recordings, reports, software, databases, processes, methods.** Assignment/waiver wording as standard.
- **Clause 11 — Non-Solicitation [STANDARD]:** base wording (clients/customers, employees/consultants/vendors/suppliers) — no station-authority/electrician additions. 12-month term. Section 27 enforceability note.
- **Clause 12 — Notice [REVIEW]:** **Probation 15 days; post-confirmation a flat 30 days** (no 60-day head branch in the base variant). Garden leave, handover of pending assignments and **open leads**, bar on contacting clients, return of property. Cessation only after notice served, handover of open leads/callbacks, property returned, relieving letter + FnF.
- **Clause 13 — FnF [REVIEW]:** (a) salary to last day; (b) EL encashment capped at 30 days; (c) pending reimbursements on bills; (d) **earned-but-unpaid incentives crystallised per Annexure B** — less notice shortfall, advances/dues, non-returned property, TDS. Within 45 working days.
- **Clause 14 — Termination [REVIEW — telecaller misconduct list]:** standard gross-misconduct list **plus**: breach of confidentiality/IP/non-solicitation **including export or unauthorised use of lead/contact databases**; **manipulation/falsification/padding of call logs, connect-rate, call-duration, or qualified-lead data**; **breach of DNC/call-recording or telecom/TRAI regulations, or abusive/harassing/fraudulent calls**; plus the usual bribery, moral-turpitude conviction, record falsification, substance use, POSH violation, repeated non-performance, and 8+ day unauthorised absence (with show-cause). Natural justice save where urgent.
- **Clause 15 — Post-Employment [REVIEW — telecaller property]:** return **laptops, headsets, mobile phones, SIM cards, dialer/CRM login credentials, identity/access cards, visiting cards, lead lists, call scripts, presentation decks, marketing collateral, expense advances,** and other records; permanently delete all Confidential Information **including any lead or contact data**; hand over open leads/callbacks/pipelines; continue Clauses 9 & 11.
- **Clause 16 — Data Protection [REVIEW]:** standard employee-data paragraph **plus:** "You shall likewise handle all customer and prospect personal data accessed in your telecalling duties strictly per the DPDP Act, 2023 and the Company's Data Protection Policy."
- **Clauses 17, 18 — POSH, Governing Law [STANDARD]:** identical to Operations.
- **Clause 19 — General Provisions [STANDARD — Annexures A–B]:** same as Operations but the Entire-Agreement reference is **Annexures A–B** (no Annexure C).
- **Clause 20 — Acceptance [STANDARD]:** digital acceptance on the HR portal by joining date; welcome to the "**Untitled Advertising family**".

#### Telecaller — Annexure A · Role-Specific Terms, Responsibilities & KPIs  **[REVIEW]**
Reporting to the Telecaller Team Lead / Proprietor. Work queue = assigned lead segment/campaign (in place of a field territory). **Responsibilities:** outbound calling on assigned leads and fresh inquiries — **a minimum of fifty (50) genuine calls per working day**, every outcome logged in the CRM; maintain a **connect rate of at least 30%** of dialled calls (a "connected call" = ≥10 seconds); qualify inquiries and **hand off at least five (5) qualified leads per week** with complete notes (a "qualified lead" = advanced to Working/QuoteSent in the CRM after a genuine conversation); callback discipline (honour every scheduled callback in-window, clear the daily queue); **follow-up SLA — first response within 24 hours, zero SLA breaches**; where the role includes phone closing, convert qualified leads to quotations and Won deals per the CRM and coordinate collections; adhere to approved scripts, DNC rules, and call-recording policy. **Indicative daily/weekly targets:** 50 calls/day · ≥30% connect · ≥5 qualified/week · zero 24-hour SLA breaches. All performance measured from the CRM and call-audit logs (definitive record). **Confirmation criteria:** sustained achievement over the final three probation months + conduct "Meets Expectations" or above.

#### Telecaller — Annexure B · Compensation & Performance Incentive  **[REVIEW — figures are BLANK]**
**B.1 — Fixed monthly remuneration (gross).** Level TC – Telecaller; Position as in the offer; Fixed Gross/Month as in the offer; Fixed Gross/Annum = 12× monthly. Salary by bank transfer on/before the 7th, less TDS (Sec 192) + Professional Tax.
**B.2 — Performance incentive (call/connect/qualified-lead based; NOT field billings or cluster revenue).**
- **(a) Monthly activity gate** — incentive unlocks only when the monthly averages meet **all** of: **≥50 genuine calls/working day; ≥30% connect rate (connected = ≥10s); ≥5 qualified hand-offs/week; zero 24-hour follow-up SLA breaches.**
- **(b) Computation on meeting the gate:** **Qualified-Lead Incentive** = a flat **[₹ per qualified hand-off]** for each qualified lead handed off that month; **Quality/Connect-Rate Bonus** = a fixed monthly **[₹]** when the monthly connect rate ≥ target; **Conversion Bonus (phone-closing roles only)** = **[₹ / %]** for each qualified lead handed off/closed that later converts to a Won deal **and on which billing is realised** — this component alone carries the realised-billing rule in B.3.

**B.3 — Terms.** Computed monthly, **paid quarterly within 30 days of quarter-close**, subject to continued employment and no notice served by either party. Metrics measured solely from the CRM and call-audit logs; any manipulation/falsification/padding disqualifies the incentive, makes it recoverable, and is gross misconduct under Clause 14. Conversion Bonus only: disputed/written-off/bad-debt/reversed invoices don't qualify; bonus paid on such is recoverable. A qualified lead later found false/duplicate/ineligible is excluded and any incentive paid on it is recoverable. On separation, no variable accrues for the quarter of separation save amounts crystallised and approved in writing before the separation date. Structure/targets/rates revisable on **30 days' written notice**, prospectively.
**No field TA/DA** — desk role, no travel chart.

> **[OWNER TO CONFIRM — cannot ship without this]** The three incentive amounts in B.2 are **literal blanks** in the draft: **[₹ per qualified hand-off]**, the **[₹] connect-rate bonus**, and the **[₹ / %] conversion bonus**. Give the figures. Also confirm: targets (50/30%/5/zero-SLA), monthly-compute-quarterly-pay cadence, and whether **Renuka (Team Lead) keeps a flat 30-day notice** or a longer one.

---

### 2C · GENERIC_SALARIED letter — flat-salary office roles

**Applies to:** flat fixed-salary, non-field/office roles — HR, Accounts, Graphic Designer, Video Editor, Office Boy, Creative Lead, Admin, co_owner (any salaried designation with `has_incentive = false`). **Not** sales/telecaller/agency.
**Printed title:** the designation name verbatim (`offer.position` from the master — "Graphic Designer", "Accounts Executive", "Video Editor", "Office Boy", "Creative Lead", "HR", "Admin"). No L1/L2/L3 fallback; if `offer.position` is blank, fall back to the designation master name — **never** to "Sales Person". Subject line: **"Letter of Appointment – Position of {position}"**.
**Department (per designation, not hardcoded):** Creative/Video/Creative Lead → "Creative & Design"; Accounts → "Accounts & Finance"; HR → "Human Resources"; Office Boy/Admin → "Administration & Support"; co_owner/Proprietor → "Management"; unknown → neutral "Operations / Administration".
**Reporting To:** "Mr. Brijesh Solanki, Proprietor" (or the department head where one exists) — **drop the "– Sales & Operations" qualifier.**

**Clause-by-clause (deltas from Operations §2A unless full text shown):**

- **Clause 1 — Position [REVIEW]:** a terms table with **these rows only** — Designation = {position}; Department = {department}; Reporting To = {reportingTo | "Mr. Brijesh Solanki, Proprietor"}; Work Location = {place | "Vadodara"}; Date of Joining. **The "Grade/Level" and "Assigned Territory" rows are removed** (no grade, no territory for an office role). Below the table: standard transfer/reassignment paragraph (to any department/function/location/branch/associate entity within India).
- **Clause 2 — Nature of Employment [STANDARD]:** base wording.
- **Clause 3 — Documentation [STANDARD]:** standard list (PAN/Aadhaar, education incl. graduation/PG, experience/relieving letters, 3 months' slips + 2 FYs' Form 16, 4 photos, address proof, bank details, 2 references). **No driving-licence/RC.**
- **Clause 4 — Probation [REVIEW]:** 6 months. **KPIs are generic — quality, accuracy and timeliness of work output; adherence to processes and reporting discipline; reliability and initiative; conduct.** The sales metrics "revenue generation, client acquisition, territory coverage" are removed. Extension up to 3 months; reassign to a different role if unsatisfactory.
- **Clause 5 — Compensation [REVIEW]:** "Your fixed monthly remuneration (CTC) shall be {salaryLine} — i.e. {monthlySalary}/month ({monthlySalary × 12}/annum). A **PURE fixed monthly salary**, inclusive of statutory/non-statutory save as in Annexure B. **There is NO variable pay, sales incentive, or commission.**" No EPF/ESIC currently; gross, TDS + Professional Tax; future-statutory-compliance paragraph as standard. **Travel reimbursement:** official travel reimbursed per Company policy on bills — **no field TA/DA scheme, bike chart, or daily allowance.** Annual April review, discretionary.
- **Clause 6 — Working Days & Hours [REVIEW]:** Monday–Saturday, **10:00 AM–7:00 PM**, 30-min lunch, ≥8.5 hrs/day. **Primarily office-based**; occasional directed travel reimbursed per policy. (The sales "travel 50–60% of working days" paragraph is removed.) Sundays + Gujarat holidays off/paid.
- **Clause 7 — Leave [STANDARD]:** identical figures.
- **Clause 8 — Code of Conduct [STANDARD]:** standard policy list (Code of Conduct; Anti-Bribery; POSH; InfoSec/IT/Data; Social Media; Conflict of Interest; Expense & Travel). No DNC, no field-safety.
- **Clause 9 — Confidentiality [REVIEW — office examples]:** examples are **client lists and contacts, rate cards and commercial terms, creative files, designs, artwork, footage and project sources, financial records, accounts, payroll and salary data, employee and vendor records,** plus business plans, pricing, trade secrets, software, databases, marketing plans. Survival: indefinite (trade secrets) / 3 years.
- **Clause 10 — IP [REVIEW — creative examples]:** **creative concepts, designs, artwork, copy, layouts, pitch decks, client proposals, photographs, video footage, edits, animations, software, databases, processes, methods.** Assignment/waiver as standard.
- **Clause 11 — Non-Solicitation [STANDARD]:** base wording, 12-month term, Section 27 note.
- **Clause 12 — Notice [REVIEW]:** **Probation 15 days; post-confirmation 30 days** by default. **No sales-head 60-day branch by default** — a senior/leadership designation may carry 60 days only where expressly stated in the letter. Garden leave, handover, property return; cessation only after notice/handover/property/relieving+FnF.
- **Clause 13 — FnF [REVIEW]:** (a) salary to last day; (b) EL encashment capped at 30 days; (c) pending reimbursements on bills — less notice shortfall, advances/dues, non-returned property, TDS. **The sales "earned-but-unpaid incentives on realised billings" component is removed** (no incentive).
- **Clause 14 — Termination [STANDARD, trimmed]:** standard gross-misconduct list (fraud/theft/dishonesty; wilful disobedience; breach of confidentiality/IP/non-solicitation; bribery; moral-turpitude conviction; falsification of records/expense claims/attendance/bills; substance use; POSH violation; repeated non-performance after warning; 8+ day unauthorised absence with show-cause). Natural justice save where urgent.
- **Clause 15 — Post-Employment [REVIEW — office property]:** return **laptops, mobile phones, SIM cards, identity/access cards, visiting cards, letterheads, keys, project files, creative source files, records**; delete Confidential Information; hand over responsibilities; continue Clauses 9 & 11.
- **Clauses 16, 17, 18 — Data Protection, POSH, Governing Law [STANDARD]:** base wording (Data Protection = standard employee-data paragraph, no GPS/customer-data additions).
- **Clause 19 — General Provisions [STANDARD — Annexures A–B]:** same as standard but Entire-Agreement reference is **Annexures A–B** (no Annexure C).
- **Clause 20 — Acceptance [STANDARD]:** digital acceptance by joining date; welcome to the "Untitled Advertising family". Digital-sign block unchanged (company "DIGITALLY SIGNED" by Brijesh Solanki, Proprietor; candidate "DIGITALLY ACCEPTED" on acceptance).

#### Generic — Annexure A · Role & Responsibilities  **[REVIEW]**
Replaces the sales "Role-Specific Terms, Responsibilities & KPIs" (with its L1/L2/L3 levels and billing targets). **No sales levels, no revenue/billing targets.** Terms table: Designation = {position}; Reporting To = {reportingTo | "Proprietor"}; Department = {department}. **Generic responsibilities frame:** perform the duties ordinarily associated with the position of {position} to the standard reasonably expected; carry out tasks/assignments/directions of the Reporting Manager/Proprietor appropriate to your role and skills; maintain quality, accuracy and timeliness of output and adhere to the Company's processes, systems and reporting discipline; handle Company information/records/files/property with due care and confidentiality; coordinate with other departments/team members. *(Drafter may substitute designation-specific bullets — Designer/Video/Creative Lead: creative design, artwork, editing, delivery to brief; Accounts: bookkeeping, invoicing, payments, statutory filings, records; HR: recruitment, onboarding, attendance, payroll coordination, records; Office Boy: office upkeep, dispatch, support; Admin: office administration, coordination, facilities; Management: overall direction.)* **Confirmation criteria:** satisfactory performance assessment on quality, reliability, timeliness and conduct + rating "Meets Expectations" or above. **No minimum monthly billing/revenue target applies.**

#### Generic — Annexure B · Fixed Remuneration  **[REVIEW]**
Replaces the sales "Compensation, Incentive & Commission Structure". **Contains only B.1** — sub-sections B.2 (Incentive & Commission), B.3 (Variable-pay terms) and B.4 (TA/DA) are **removed entirely** (no variable pay, commission, or field TA/DA).
**B.1 — Fixed monthly remuneration (gross).** Terms table: Position → {position}; Fixed Gross/Month → {formatCurrency(monthlySalary)}; Fixed Gross/Annum → {formatCurrency(monthlySalary × 12)}. **The sales "Level → L1/L2/L3" row is removed.** Salary by bank transfer on/before the 7th, less TDS (Sec 192) + Professional Tax. **Travel & expenses:** reasonable official-purpose expenses reimbursed per Company policy on bills + manager approval; **no fixed daily allowance, km allowance, or field TA/DA.**

> **[OWNER TO CONFIRM]** (1) The department mapping per designation (list above) — confirm or correct. (2) Which, if any, generic designations (e.g. co_owner, Creative Lead) get a **60-day** post-confirmation notice instead of 30. (3) That leave figures carry over unchanged.

---

## 3 · Data + wiring changes (all files NON-frozen — no sales-module-guardian gate; a code-reviewer pass still warranted because the convert path mints roles)

### 3.1 · `hr_offers` — new columns (new idempotent SQL, e.g. `supabase_phaseN_hr_offer_role_signal.sql`)
Snapshot **both** the FK and the resolved signal at send-time, so neither the PDF resolver nor the convert-mint depends on a later-drifted designations master (the "auth_role was mis-seeded once" lesson):
```sql
ALTER TABLE hr_offers ADD COLUMN IF NOT EXISTS designation_id            uuid REFERENCES designations(id);
ALTER TABLE hr_offers ADD COLUMN IF NOT EXISTS designation_auth_role     text;
ALTER TABLE hr_offers ADD COLUMN IF NOT EXISTS designation_team_role     text;
ALTER TABLE hr_offers ADD COLUMN IF NOT EXISTS designation_has_incentive boolean;
-- VERIFY: 4 columns present
NOTIFY pgrst, 'reload schema';
```
- `designation_id` = FK (convert re-derives authoritatively; survives a rename). The three text/boolean columns = the **snapshot at send-time** so convert mints the role the offer was *issued* for even if the master changes later.
- `designation_name` is **not** added — `position` already stores `picked.name`.
- No RLS change (additive columns; existing `hr_offers` policies cover them). No CHECK on the snapshot columns.

### 3.2 · `src/hooks/useOffers.js` — `OFFER_COLS` (`:12-32`)
Add the 4 new columns to the round-trip whitelist so they come back on fetch. `createOffer` (`:93-101`) / `updateOffer` already spread `...payload` / `patch`, so no other change here. **Ordering risk:** because the offers-list SELECT names `OFFER_COLS`, PostgREST will 400 if a listed column doesn't yet exist — so **the SQL in 3.1 must run before this frontend change deploys** (see Section 5).

### 3.3 · `src/components/hr/SendOfferModal.jsx`
- **`:76`** widen the designations select to `'id, name, default_monthly_salary, has_incentive, auth_role, team_role'` so `picked` carries the signal.
- **`:138-155`** add to the `createOffer` payload: `designation_id: form.designation_id`, `designation_auth_role: picked?.auth_role ?? null`, `designation_team_role: picked?.team_role ?? null`, `designation_has_incentive: picked ? !!picked.has_incentive : null`.

### 3.4 · `src/pages/v2/HROfferLetterV2.jsx`
- **`:181`** change `downloadOfferLetter(offer, null)` → `downloadOfferLetter(offer, resolveOfferTemplate(picked))`. `picked` (select at `:93`) already has `auth_role, team_role, has_incentive`. Import `resolveOfferTemplate` from the new `src/utils/offerTemplate.js`.
- *(Optional)* stamp `designation_*` onto the synthetic `offer` at `:142-180` for symmetry — not required, since the template is passed directly.

### 3.5 · `src/components/hr/OfferLetterPDF.jsx` — actually consume the prop (today `:293` destructures `template` and never uses it; the body is hardcoded sales)
- At the top of `OfferDocument` (`:293`): `const tpl = ['sales','ops','telecaller','generic'].includes(template) ? template : resolveOfferTemplate(offer)`. **This dual-resolve is the crux:** when `template` is passed (HROfferLetterV2) it wins; when absent/null (any offer-row-driven render, e.g. the accept-flow) it resolves from the snapshotted `offer.designation_*`. Both entry points then branch correctly.
- Branch the sales-specific body on `tpl`:
  - **`sales`** → current output unchanged (dept `:388`, Annexure A tiers `:880-882 / :1014-1101`, commission B.2 `:908-933`, notice-tier `:687`). `resolveLevel`/`levelTitle` (`:277-289`) L1/L2/L3 selection wraps **inside the `sales` branch only.**
  - **`telecaller`** → telecaller dept/KPIs (50 calls/day etc.); **keep** the incentive Annexure B (they earn incentive).
  - **`ops`** → operations dept + ops responsibilities; **drop** commission B.2 → Annexure B is fixed remuneration + uptime variable + TA/DA (Annexure C).
  - **`generic`** → per-designation dept; **drop** Annexure A sales tiers + the commission block; Annexure B = B.1 only; no Annexure C.
- Update the file-header comment (`:17-23`) to say `template` now carries the role-variant string, **not** an `hr_offer_templates` row (that was a different concept — clause-boilerplate rows, never the role shape).

### 3.6 · New shared file `src/utils/offerTemplate.js`
Single definition of `resolveOfferTemplate({auth_role, team_role, has_incentive})` (the rule in Section 1). Imported by `OfferLetterPDF` + `HROfferLetterV2` (and optionally `OfferDetailModal` for the incentive-gate decision). One definition, no duplication.

---

## 4 · The `OfferDetailModal.handleConvert` fix — the role-mint bug (same class as the testope1 / Aayushi incidents)

**Today (`OfferDetailModal.jsx:132-146`)** `handleConvert` hardcodes `p_role:'sales'`, `p_team_role:'sales'`, `p_segment_access:'PRIVATE'` for **every** convert, and the incentive upsert (`:166-181`) seeds sales defaults (5× / 0.05 / 0.02) for everyone. So converting an Operations tech, telecaller, or accountant mints them as a **sales** user with a sales incentive profile. The correct pattern already exists at `HRNewUserV2.jsx:195-197` (`p_role: pickedDesignation.auth_role`, `p_team_role: pickedDesignation.team_role`, `p_designation: pickedDesignation.name`) — convert must mirror it.

**The fix:**
- **`:137`** `p_role: 'sales'` → `p_role: offer.designation_auth_role || 'sales'`
- **`:138`** `p_team_role: 'sales'` → `p_team_role: offer.designation_team_role || 'sales'`
- **`:145`** `p_segment_access: 'PRIVATE'` → `'PRIVATE'` **only when** the resolved role ∈ `('sales','telecaller')`, else `'ALL'` (per CLAUDE.md §8: segment scope applies only to sales + telecaller; hr/accounts/ops/generic = ALL).
- **Old-offer fallback** (rows created before the §3.1 columns — all of which were sales): if `offer.designation_auth_role` is null **and** `offer.designation_id` is set → `SELECT auth_role, team_role, has_incentive FROM designations WHERE id = offer.designation_id` before minting; if neither is present → keep the legacy `'sales' / 'sales' / 'PRIVATE'` default (old offers were all sales). No regression.
- **Incentive upsert (`:166-181`) — gate on `has_incentive`:** for a flat-salary role (`designation_has_incentive === false`) do **not** seed a 5× / 0.05 / 0.02 sales profile — either seed a zero/flat profile (`sales_multiplier:0, new_client_rate:0, renewal_rate:0`) or skip the upsert. Mirrors how `SendOfferModal` already zeroes incentive for flat roles (`:147-150`).
- **Convert-UI copy — generalise:** `:388-390` "create a **Sales** user account" → role-neutral ("create a user account"); the confirmation at `:440` "Converted to a **sales** user" → neutral.

---

## 5 · Build order + risk

**This is a legal document. The sales path must stay byte-for-byte identical.** The whole design is a *branch*: `tpl === 'sales'` returns exactly today's output; the three new bodies are additive. Any diff that changes a sales-letter byte is a defect.

**Deploy order (the one hard dependency):**
1. **Owner runs the §3.1 ADD-COLUMN SQL in Supabase Studio first.** It is idempotent and additive. (Mirrors the §169/§210 ordering pattern.)
2. **Then** push the frontend (§3.2–3.6 + §4). If the frontend deploys *before* the SQL, the `OFFER_COLS` SELECT names columns that don't exist and PostgREST 400s the whole offers list — so SQL leads.
3. New file `src/utils/offerTemplate.js` ships with the frontend.

**Risks / watch-items:**
- **Reversed order breaks the offers list** (400 on missing column) — call this out explicitly in the handoff to the owner.
- **Old offers** (pre-§3.1) have null snapshot columns — the §4 fallback (FK re-derive, else legacy sales default) keeps them working; verify at least one legacy offer converts correctly.
- **The `staff`→`ops` bucket edge** (Section 1 decision) must be settled before send, or a Graphic Designer gets an uptime-KPI letter.
- **Telecaller Annexure B is unshippable until the owner fills the three blank incentive figures.**
- **code-reviewer pass** on the convert path (`OfferDetailModal.handleConvert`) since it mints roles and touches `admin_create_user`. Not sales-module-frozen, so no guardian gate — but the role-mint is exactly the class of bug that burned testope1/Aayushi.

**Smoke test (four offers, one per variant), after the SQL + deploy:**
1. **Sales** offer → download PDF: L1/L2/L3 grade, "Sales & Business Development", commission Annexure B.2, bike TA/DA Annexure C — **identical to today**. Convert → sales user, PRIVATE, sales incentive profile.
2. **Operations** offer (`operation_executive`) → PDF: OPS-FT grade, "Operations (LED Screen Network Maintenance)", uptime Annexure B (70:30, 95/85 bands), Operations TA/DA Annexure C, no commission. Convert → `operation_executive` / `staff` team_role, segment_access **ALL**, no sales incentive profile.
3. **Telecaller** offer → PDF: "TC – Telecaller", Inside Sales dept, call/connect/qualified KPIs, incentive Annexure B **with the owner's figures**, no field TA/DA. Convert → `telecaller`, segment_access as set for telecaller, incentive profile per has_incentive.
4. **Generic** offer (e.g. Accounts) → PDF: designation-name title, "Accounts & Finance", no grade/territory rows, Annexure B = fixed only, no Annexure C, no commission. Convert → correct auth_role, segment_access **ALL**, **no** sales incentive seeded.
5. On staging iPhone, hard-refresh (PWA cache) before judging the rendered PDFs.

**Touch-point files (all non-frozen):** new SQL `supabase_phaseN_hr_offer_role_signal.sql` · `src/hooks/useOffers.js` · `src/components/hr/SendOfferModal.jsx` · `src/pages/v2/HROfferLetterV2.jsx` · `src/components/hr/OfferLetterPDF.jsx` · `src/components/hr/OfferDetailModal.jsx` · new `src/utils/offerTemplate.js`.

---

### Consolidated [OWNER TO CONFIRM] list (decide these before it goes out)
1. **Staff-bucket rule:** Designer/Office Boy → Operations letter, or split to Generic? (Section 1 — recommend split.)
2. **Operations uptime bands:** 70:30 split; full at 95%; zero below 85%; linear between. (Annexure B.)
3. **Operations grade codes** OPS-FT / OPS-HD; hours 9–6; on-call for outages; notice 60/30/15.
4. **Operations TA/DA:** ₹3/km, ₹200 DA, hotel ceilings ₹1,100 / ₹900 / ₹700.
5. **Telecaller incentive figures — the three blanks:** ₹ per qualified hand-off, ₹ connect-rate bonus, ₹ / % conversion bonus. Plus targets (50 / 30% / 5 / zero-SLA) and Renuka's notice period.
6. **Generic:** the per-designation department mapping; which designations get 60-day notice; leave figures.
7. **All variants:** leave entitlements (copied from the sales letter) apply unchanged?