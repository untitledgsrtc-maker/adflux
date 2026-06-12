-- =====================================================================
-- PHASE 140 — Government proposal English language option (Auto Hood + GSRTC)
-- 2026-06-12
--
-- Owner: "I want the 2 govt media proposals (Auto Hood + GSRTC LED) in
--   English too. Default Gujarati; if anyone wants English they pick it.
--   Same structure/layout — only the language changes."
--
-- This is ADDITIVE + §45-safe:
--   • quotes gains ONE nullable column `proposal_language` DEFAULT 'gu'.
--     No existing code reads it until this phase ships, and the default
--     means every existing quote + every Gujarati quote renders BYTE-
--     IDENTICALLY (the renderer + fetch fall back to 'gu').
--   • proposal_templates gains TWO new rows (AUTO_HOOD + GSRTC_LED,
--     language='en'). The existing gu rows are UNTOUCHED. The English
--     rows are copied from the gu rows so they inherit every column
--     (header/footer/etc) — only language + subject_line + body_html +
--     version differ.
--   • No trigger, no RLS change, no hot-path load. Existing RLS on
--     quotes / proposal_templates already covers the new column + rows.
--
-- The English subject_line + body_html below are the owner-supplied
-- English letters (Gsrtc 2.docx / Auto 2.docx, 12 Jun 2026), mapped onto
-- the SAME placeholder structure the Gujarati templates use so the
-- React renderer (GovtProposalRenderer.jsx) produces an identical layout
-- with English labels + English digits when language='en'.
-- =====================================================================


-- ─── 1. quotes.proposal_language (additive, default Gujarati) ────────
ALTER TABLE public.quotes
  ADD COLUMN IF NOT EXISTS proposal_language text DEFAULT 'gu';

-- Defensive backfill (PG11+ ADD COLUMN DEFAULT already fills existing
-- rows, but make the intent explicit + safe on older engines).
UPDATE public.quotes
   SET proposal_language = 'gu'
 WHERE proposal_language IS NULL;

-- Restrict to the two supported languages (idempotent).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'quotes_proposal_language_check'
  ) THEN
    ALTER TABLE public.quotes
      ADD CONSTRAINT quotes_proposal_language_check
      CHECK (proposal_language IN ('gu', 'en'));
  END IF;
END $$;


-- ─── 2. English AUTO_HOOD template (copied from the gu row) ──────────
-- Copies header_html / footer_html (and any other shared columns) from
-- the active Gujarati row; overrides language + subject + body. The
-- NOT EXISTS guard makes a re-run a no-op (idempotent).
INSERT INTO public.proposal_templates
  (segment, media_type, language, subject_line, body_html,
   is_active, version, effective_to, header_html, footer_html)
SELECT
  'GOVERNMENT', 'AUTO_HOOD', 'en',
  $SUBJ$Advertisement on auto rickshaws plying in every corner of Gujarat state regarding providing services at the price approved by DAVP$SUBJ$,
  $BODY$<p>Honorable Sir,</p>

<p>The Government of Gujarat carries out publicity work for the public interest through various media for outdoor publicity of welfare schemes and messages. We are Untitled Advertising, a Vadodara-based advertising agency operating across Gujarat, with 9 years of experience working with various departments of the Government of Gujarat.</p>

<p>Advertisement on an auto rickshaw is the best medium that comes to the attention of any person immediately and reaches the last person. It can be seen repeatedly. This is a means of transport as well as a medium that is very different from other means of advertising and promotion, and it is available at the most reasonable price compared to other means.</p>

<p><strong>Details of cost for advertisement on the hood of the auto rickshaw, as per DAVP-approved price:</strong></p>

{{rate_table}}

<p style="font-size:12.5px;color:#444;margin-top:6px;"><em>Note: The above rate is for the complete package of advertisement on 3 sides (rear + left + right) combined.</em></p>

<p>The above prices include auto rickshaws from every district of Gujarat state ({{districts_count}} districts). The detailed district-wise list is shown above, and is also included in the letter from DAVP and enclosed herewith.</p>

<p>We humbly request that you approve a work order for our auto rickshaw advertising service for the publicity of your department's public welfare schemes and public awareness messages, or include us in your upcoming media plan. We are committed to providing the service with full transparency as per the rate list fixed by DAVP.</p>

<p>Looking forward to your cooperation.</p>

<p>Thank you,</p>

{{signer_block}}

{{bidan_block}}$BODY$,
  true, 1, NULL, src.header_html, src.footer_html
FROM public.proposal_templates src
WHERE src.segment = 'GOVERNMENT' AND src.media_type = 'AUTO_HOOD'
  AND src.language = 'gu' AND src.is_active = true AND src.effective_to IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.proposal_templates e
    WHERE e.segment = 'GOVERNMENT' AND e.media_type = 'AUTO_HOOD'
      AND e.language = 'en' AND e.is_active = true AND e.effective_to IS NULL
  );


-- ─── 3. English GSRTC_LED template (copied from the gu row) ──────────
INSERT INTO public.proposal_templates
  (segment, media_type, language, subject_line, body_html,
   is_active, version, effective_to, header_html, footer_html)
SELECT
  'GOVERNMENT', 'GSRTC_LED', 'en',
  $SUBJ$Proposal for displaying government schemes / advertisements of your department on AI based LED display (55 inches) on platforms inside 20 GSRTC bus depots located in Gujarat (as per the price fixed by GSRTC)$SUBJ$,
  $BODY$<p>Dear Sir / Madam,</p>

<p>We are Untitled Advertising, a Vadodara-based advertising agency displaying advertisements all over Gujarat. We have 9 years of experience working in the advertising sector with the Government of Gujarat. Our services include LED screens, outdoor hoardings, auto rickshaws, vehicle branding, and digital advertising.</p>

<p>We have recently received a tender to install LED screens (55 inches) on the platforms inside the bus depots of Gujarat GSRTC, and we have fully started our LED screens on the platforms of 20 depot stations awarded to us through the tender from GSRTC. These are placed on the platforms where passengers wait for the bus, where thousands of passengers travel regularly every day — making this an extremely effective medium to reach a wide audience with your department's message.</p>

<p><strong>We would like to provide an AI based state-of-the-art LED display system for your department, which provides the following features:</strong></p>

<ul style="margin:6px 0 12px 22px;padding:0;">
  <li>High-resolution outdoor LED display — 55-inch state-of-the-art screen with clear visibility and high quality.</li>
  <li>Centralized remote content management — content can be updated instantly across all 20 district depots, from one place, at the same time.</li>
  <li>AI-based Audience Analytics System (special feature) — accurate daily count of how many people saw your advertisement / message (Impression Count), detailed reporting by age group, gender and time period, delivered as a weekly / monthly PDF report in a transparent and verifiable form.</li>
</ul>

<p>Through this medium, your department's schemes, public awareness campaigns, and government messages can be delivered effectively to lakhs of citizens of the state, carrying the government's message to a wide audience.</p>

<p><strong>GSRTC approved rate table — campaign for {{months}} month(s):</strong></p>

{{rate_table}}

<p>We humbly request that you give us direct work for this, or include our services in your department's upcoming media plan. We are committed to providing the service with full transparency as per the rate list fixed by GSRTC.</p>

<p>Thank you,</p>

{{signer_block}}

{{bidan_block}}$BODY$,
  true, 1, NULL, src.header_html, src.footer_html
FROM public.proposal_templates src
WHERE src.segment = 'GOVERNMENT' AND src.media_type = 'GSRTC_LED'
  AND src.language = 'gu' AND src.is_active = true AND src.effective_to IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.proposal_templates e
    WHERE e.segment = 'GOVERNMENT' AND e.media_type = 'GSRTC_LED'
      AND e.language = 'en' AND e.is_active = true AND e.effective_to IS NULL
  );


-- self-register
DO $$
BEGIN
  IF to_regclass('public.applied_migrations') IS NOT NULL THEN
    INSERT INTO public.applied_migrations (name, note)
    VALUES ('supabase_phase140_proposal_language_english.sql',
            'quotes.proposal_language + English AUTO_HOOD/GSRTC_LED proposal_templates (additive, default gu)')
    ON CONFLICT (name) DO NOTHING;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';


-- ─── VERIFY — expect col=1, check=1, en_templates=2 ──────────────────
SELECT
  (SELECT count(*) FROM information_schema.columns
     WHERE table_name='quotes' AND column_name='proposal_language')        AS col_present,
  (SELECT count(*) FROM pg_constraint
     WHERE conname='quotes_proposal_language_check')                       AS check_present,
  (SELECT count(*) FROM public.proposal_templates
     WHERE segment='GOVERNMENT' AND language='en'
       AND is_active=true AND effective_to IS NULL)                        AS en_templates;

SELECT segment, media_type, language, version, length(body_html) AS body_len,
       left(subject_line, 60) AS subject_preview
  FROM public.proposal_templates
 WHERE segment='GOVERNMENT' AND is_active=true AND effective_to IS NULL
 ORDER BY media_type, language;

SELECT 'Phase 140 proposal English language applied' AS status;
