# HR Onboarding/Training + Recruitment module — Spec (2026-08-03)

Owner directive: HR gets (A) a per-role **onboarding & training timeline** so every
new hire "knows everything, no doubts", and (B) a **recruitment** surface (resumes +
shortlist + call logging). Owner decisions (2026-08-03):
- Onboarding steps are **split**: HR ticks setup steps; the new hire ticks their own
  training steps from their OWN login.
- **Real in-app tests** (owner writes questions; hire answers in-app; auto-scored;
  must pass to complete that step).
- **In-app training material** stored per step (PDF / video / link).
- Recruitment calls = **call LOGS** (number/time/duration/outcome), NO audio (phones
  can't record in-app — same as telecaller).

Governing rules: additive only (§45 — new `hr_*`/`onboarding_*` tables + routes, zero
touch to sales/leads/quotes/payroll); RLS role-scoped (HR+admin manage; each hire
sees only THEIR own onboarding); §66 server aggregates; §154 bundle SQL per phase.

---

## Part A — Onboarding & Training

### Data model
- **`onboarding_templates`** — id, role (sales/telecaller/accounts/hr/designer/
  video_editor/admin/agency/…), name, is_active. One template per role (editable).
- **`onboarding_steps`** — id, template_id, step_order, title, description,
  owner (`hr` | `hire` | `manager`), material_url, material_type (pdf/video/link),
  has_test bool, is_active. The ordered steps of a role's onboarding.
- **`onboarding_step_questions`** — id, step_id, q_order, question, options jsonb
  (array), correct_index int. (only for has_test steps)
- **`onboarding_runs`** — id, user_id (the new hire), template_id, started_at,
  status (active/complete). One per hire (created when HR onboards them / on hire).
- **`onboarding_progress`** — id, run_id, step_id, status (pending/done),
  done_by, done_at, test_score int, test_passed bool. Per-hire per-step.
- Storage: **`onboarding-material`** bucket (private; HR uploads step material) +
  reuse for hire viewing (signed URL or public-read admin bucket).

### Flows
- **HR builds a template** (per role): add/reorder steps, set owner (HR vs hire),
  attach material, add test questions. (`/hr/onboarding/templates`)
- **Onboard a hire**: HR picks a new member → creates an `onboarding_run` from the
  role template → seeds `onboarding_progress` (all pending).
- **HR view**: timeline of every active hire — role, day N, X/Y steps, who's stuck.
  (`/hr/onboarding`)
- **Hire view** ("My Onboarding", every role): their steps in order, open the
  material in-app, take the test on has_test steps (pass → step auto-done), tick
  their own `owner='hire'` steps. HR-owned steps show as "HR is setting up".
  (`/my-onboarding`)
- Test: hire answers → client scores vs correct_index → writes test_score +
  test_passed; pass threshold (e.g. ≥70%) marks the step done. (Score check also
  re-validated server-side in a later hardening.)

### Access / RLS
- `onboarding_templates/steps/questions`: HR + admin FOR ALL; hire READ (their
  role's template only, to see steps + material). Correct answers NOT exposed to
  the hire (questions RLS hides correct_index — serve via a gated RPC that returns
  options without the answer, scores server-side; v1 may score client-side + hide
  correct_index via a view — decide at build).
- `onboarding_runs/progress`: HR + admin FOR ALL; hire FOR (SELECT + UPDATE own
  `owner='hire'` steps) where run.user_id = auth.uid().

---

## Part B — Recruitment

### Data model
- **`hr_candidates`** — id, name, phone, email, role_applied, stage
  (applied/shortlisted/interview/hired/rejected), resume_url, source, notes,
  rating, created_by, created_at, updated_at.
- **`hr_candidate_calls`** — id, candidate_id, called_by, call_at, duration_seconds,
  outcome, notes. (mirrors the telecaller call-log pattern; NO audio)
- Storage: **`candidate-resumes`** bucket (private; HR upload/download).

### Flows
- **Candidates page** (`/hr/candidates`): add candidate + upload resume; Kanban or
  filterable list by stage; move stage (Applied→Shortlisted→Interview→Hired/Rejected).
- **Call logging**: a "Call" button (tel: link) logs a `hr_candidate_calls` row
  (like WorkV2/TelecallerV2 quickLogCall) — HR's recruitment activity is visible.
- **Hire → convert**: "Hired" → one click into the existing HR Add Member + offer
  flow (HRNewUserV2), then auto-start their onboarding_run.

### Access / RLS
- `hr_candidates` + `hr_candidate_calls`: HR + admin FOR ALL. No one else.
- `candidate-resumes` bucket: HR + admin only (private, signed URLs).

---

## Phases (each ships + owner-verified; SQL bundled per §154)
- **P1 — Recruitment** (candidates + resume upload + shortlist stages + call log).
  Standalone, immediately useful. `/hr/candidates`.
- **P2 — Onboarding templates** (HR defines steps per role + material + owner).
  `/hr/onboarding/templates`.
- **P3 — Onboarding runs + progress** (assign to a hire; HR + hire tick; timeline).
  `/hr/onboarding` (HR) + `/my-onboarding` (hire, every role).
- **P4 — In-app material** (upload/store/view per step).
- **P5 — Tests** (questions + auto-score + gate step completion + server re-check).
- **P6 — Convert candidate → member → auto onboarding_run**; HR dashboard rollup.

### Owner provides (the content)
Per role (start with SALES — owner's example — then the rest: telecaller / accounts /
hr / designer / video_editor / admin / any other), the ordered onboarding steps, each
with: **title · who does it (HR or new hire) · has a test? · material (file/video/
link)?**. For test steps: the **questions + options + correct answer**. Owner's sales
seed example: SIM ready · iPad ready · account created · offer letter · mobile-app
training · questionnaire test · product knowledge · next plan · team coordination · …

### Acceptance criteria (per §3)
- HR builds a role template; onboarding a hire seeds their checklist; HR sees each
  hire's timeline + %.
- The hire sees ONLY their own onboarding, opens material in-app, passes a test to
  complete a test-gated step, ticks their own steps; cannot see other hires or the
  correct test answers up front.
- Recruitment: add candidate + resume, move stages, log a call; "Hired" flows into
  Add Member.
- Zero touch to sales/leads/quotes/payroll; HR-only + hire-own RLS (no leak).
