-- =====================================================================
-- ADFLUX → UNTITLED OS  •  PHASE 11d
-- Proposal templates v2 — new writeup from owner-supplied .docx files
-- =====================================================================
--
-- WHY:
--   Owner supplied two new template .docx files on 4 May 2026:
--     • Auto_Rickshaw_Proposal_Template.docx       → AUTO_HOOD body
--     • Government_Proposal_Letter_Template.docx   → GSRTC_LED body
--
--   The previous templates (Phase 5 seed) used older copy that the
--   owner asked to replace. The new copy is more polished, references
--   CBC (formerly DAVP) by both names, includes a "બિડાણ:" enclosure
--   list at the bottom (standard Gujarati govt-letter convention), and
--   matches the writeup the owner wants to send out.
--
--   Layout, fonts, A4 sizing, and the rate-table renderer remain the
--   same — owner explicitly said "old format was good and font also
--   good, I just want you to use this writeup". So we change ONLY
--   subject_line + body_html, and add a new {{bidan_block}}
--   placeholder rendered by the React renderer with the appropriate
--   enclosure list per media type.
--
-- DESIGN:
--   • Bumps version + 1 on each row so admin can see this is a new
--     revision in Master.Documents.
--   • Keeps existing placeholders: {{rate_table}}, {{districts_count}},
--     {{signer_block}}.
--   • Adds new placeholder: {{bidan_block}} → expanded by the renderer
--     into a media-type-specific enclosure list.
--   • Idempotent — re-running this UPSERTs the same content.
--
-- =====================================================================


-- 1) AUTO_HOOD — Auto rickshaw proposal -----------------------------
UPDATE public.proposal_templates
   SET subject_line =
         'ગુજરાત રાજ્યના સમગ્ર જિલ્લાઓમાં કાર્યરત ઓટો રિક્ષાઓ પર આપના વિભાગની સરકારી યોજનાઓ તથા જનજાગૃતિ સંદેશાની જાહેરાત CBC (પૂર્વે DAVP) દ્વારા મંજૂર થયેલ દરો અનુસાર પ્રસારિત કરવા અંગેની દરખાસ્ત.',
       body_html = E'<p>માનનીય સાહેબશ્રી,</p>\n\n'
         || E'<p>સવિનય જણાવવાનું કે, ગુજરાત સરકારની કલ્યાણકારી યોજનાઓ તથા જનહિતના સંદેશાઓના આઉટડોર પ્રચાર-પ્રસાર માટે વિવિધ માધ્યમોનો ઉપયોગ થાય છે. અમે અનટાઇટલ એડવર્ટાઇઝિંગ, વડોદરા સ્થિત તથા સમગ્ર ગુજરાતમાં કાર્યરત જાહેરાત એજન્સી, ગુજરાત સરકારના વિવિધ વિભાગો સાથે ૯ વર્ષનો અનુભવ ધરાવીએ છીએ.</p>\n\n'
         || E'<p>ઓટો રિક્ષા પરની જાહેરાત એક અત્યંત અસરકારક અને વ્યાપક માધ્યમ છે — જે ગ્રામીણ તથા શહેરી વિસ્તારના નાગરિકો સુધી દૈનિક ધોરણે પહોંચે છે, વારંવાર દૃષ્ટિગોચર થાય છે, અને અન્ય માધ્યમોની સરખામણીમાં સૌથી વ્યાજબી દરે ઉપલબ્ધ છે. પરિવહનનું માધ્યમ હોવાથી જાહેરાત સ્થિર સ્થળે મર્યાદિત ન રહેતાં સતત ગતિશીલ રહીને વિશાળ પ્રેક્ષક સુધી પહોંચે છે.</p>\n\n'
         || E'<p><strong>CBC (પૂર્વે DAVP) મંજૂર દરો અનુસાર ખર્ચની વિગત:</strong></p>\n\n'
         || E'{{rate_table}}\n\n'
         || E'<p style="font-size:12.5px;color:#444;margin-top:6px;"><em>નોંધ: ઉપરોક્ત દર ૩ બાજુ (પાછળ + ડાબી + જમણી) સંયુક્ત જાહેરાતના સંપૂર્ણ પેકેજ માટે છે.</em></p>\n\n'
         || E'<p>આ દરોમાં ગુજરાત રાજ્યના {{districts_count}} જિલ્લાઓની ઓટો રિક્ષાઓનો સમાવેશ થાય છે. જિલ્લાવાર વિગતવાર યાદી ઉપર દર્શાવેલ છે, તથા CBC ના પત્રમાં તથા આ સાથે બિડાણ તરીકે પણ સામેલ કરેલ છે.</p>\n\n'
         || E'<p>આથી, અમારી નમ્ર વિનંતી છે કે આપના વિભાગની તથા જનજાગૃતિ સંદેશાના પ્રચાર-પ્રસાર માટે અમારી ઓટો રિક્ષા જાહેરાત સેવાનો વર્ક ઓર્ડર મંજૂર કરવા અથવા આપના આગામી મીડિયા પ્લાનમાં અમને પૅનલમાં સામેલ કરવા કૃપા કરશો. અમે CBC દ્વારા નિર્ધારિત દરપત્રક અનુસાર સંપૂર્ણ પારદર્શિતા સાથે સેવા પૂરી પાડવા પ્રતિબદ્ધ છીએ.</p>\n\n'
         || E'<p>આપશ્રીના સહકારની અપેક્ષા સહ.</p>\n\n'
         || E'<p>આભાર સહ,</p>\n\n'
         || E'{{signer_block}}\n\n'
         || E'{{bidan_block}}',
       version = COALESCE(version, 1) + 1,
       updated_at = now()
 WHERE segment = 'GOVERNMENT'
   AND media_type = 'AUTO_HOOD'
   AND is_active = true;


-- 2) GSRTC_LED — GSRTC bus depot LED proposal ------------------------
UPDATE public.proposal_templates
   SET subject_line =
         'ગુજરાત રાજ્યના ૨૦ GSRTC બસ ડેપો ખાતે પ્લેટફોર્મ પર સ્થાપિત AI-આધારિત LED ડિસ્પ્લે (૫૫ ઇંચ) મારફતે આપના વિભાગની સરકારી યોજનાઓ તથા જનજાગૃતિ સંદેશા પ્રસારિત કરવા અંગેની દરખાસ્ત — GSRTC દ્વારા નિર્ધારિત દરો અનુસાર.',
       body_html = E'<p>માનનીય સાહેબશ્રી,</p>\n\n'
         || E'<p>સવિનય જણાવવાનું કે, અનટાઇટલ એડવર્ટાઇઝિંગ એ વડોદરા સ્થિત તથા સમગ્ર ગુજરાતમાં કાર્યરત એક પ્રતિષ્ઠિત જાહેરાત એજન્સી છે. ગુજરાત સરકારના વિવિધ વિભાગો સાથે જાહેરાત ક્ષેત્રે કામગીરીનો અમારો ૯ વર્ષનો બહોળો અનુભવ છે. અમારી સેવાઓમાં LED સ્ક્રીન, આઉટડોર હોર્ડિંગ્સ, ઓટો રિક્ષા, વાહન બ્રાન્ડિંગ, તથા ડિજિટલ જાહેરાતનો સમાવેશ થાય છે.</p>\n\n'
         || E'<p>તાજેતરમાં અમને ગુજરાત રાજ્ય માર્ગ વાહન વ્યવહાર નિગમ (GSRTC) તરફથી રીતસરની ટેન્ડર પ્રક્રિયા હેઠળ રાજ્યના ૨૦ બસ ડેપો મથકોના પ્લેટફોર્મ પર ૫૫ ઇંચની હાઇ-રિઝોલ્યુશન LED સ્ક્રીનો સ્થાપિત કરવાનો કોન્ટ્રાક્ટ ફાળવવામાં આવેલ છે, જે અંતર્ગત તમામ ૨૦ ડેપો ખાતેની LED સ્ક્રીનો સંપૂર્ણપણે કાર્યરત કરી દેવામાં આવેલ છે. આ સ્ક્રીનો મુસાફરોના વેઇટિંગ પ્લેટફોર્મ પર સ્થાપિત હોવાથી દૈનિક ધોરણે હજારો યાત્રિકો તેના સંપર્કમાં આવે છે, જે આપના વિભાગના સંદેશા વ્યાપક પ્રેક્ષક સુધી પહોંચાડવા માટે અત્યંત અસરકારક માધ્યમ બની શકે છે.</p>\n\n'
         || E'<p><strong>સેવાની વિશેષતાઓ:</strong></p>\n\n'
         || E'<ul style="margin:6px 0 12px 22px;padding:0;">\n'
         || E'  <li>હાઇ-રિઝોલ્યુશન આઉટડોર LED ડિસ્પ્લે — ૫૫ ઇંચની અત્યાધુનિક સ્ક્રીન, સ્પષ્ટ દૃશ્યતા તથા ઉચ્ચ ગુણવત્તા સાથે.</li>\n'
         || E'  <li>કેન્દ્રિત રિમોટ કન્ટેન્ટ મેનેજમેન્ટ — એક જ સ્થળેથી, એક જ સમયે, સમગ્ર ૨૦ જિલ્લાઓના ડેપો પર કન્ટેન્ટ ત્વરિત અપડેટ કરવાની સુવિધા.</li>\n'
         || E'  <li>AI-આધારિત ઓડિયન્સ એનાલિટિક્સ સિસ્ટમ — દૈનિક ધોરણે જાહેરાત જોનાર વ્યક્તિઓની ચોક્કસ સંખ્યા (Impression Count), ઉંમર-જૂથ તથા સમય-આધારિત વિગતવાર પ્રેક્ષક પૃથક્કરણ, સાપ્તાહિક / માસિક PDF રિપોર્ટ — પારદર્શક અને ચકાસણીપાત્ર સ્વરૂપે.</li>\n'
         || E'</ul>\n\n'
         || E'<p>આ માધ્યમ દ્વારા આપના વિભાગની યોજનાઓ, જનજાગૃતિ સંદેશા તથા સરકારી પહેલની માહિતી રાજ્યના લાખો નાગરિકો સુધી અસરકારક રીતે પહોંચાડી શકાશે, જે મિશન/વિભાગના મૂળ ઉદ્દેશ્યોને બળ આપશે.</p>\n\n'
         || E'<p><strong>GSRTC માન્ય રેટ ટેબલ — {{months}} માસ માટે કેમ્પેઇન:</strong></p>\n\n'
         || E'{{rate_table}}\n\n'
         || E'<p>આથી, અમારી નમ્ર વિનંતી છે કે આપના વિભાગના આગામી મીડિયા પ્લાન / જાહેરાત આયોજનમાં અમારી સેવાઓને સામેલ કરવા અથવા આ કામગીરી અમને સોંપવા સંબંધિત યોગ્ય માર્ગદર્શન આપવા કૃપા કરશો. અમે GSRTC દ્વારા નિર્ધારિત દરપત્રક અનુસાર સંપૂર્ણ પારદર્શિતા સાથે સેવા પૂરી પાડવા પ્રતિબદ્ધ છીએ.</p>\n\n'
         || E'<p>આભાર સહ,<br/>સાદર પ્રણામ.</p>\n\n'
         || E'{{signer_block}}\n\n'
         || E'{{bidan_block}}',
       version = COALESCE(version, 1) + 1,
       updated_at = now()
 WHERE segment = 'GOVERNMENT'
   AND media_type = 'GSRTC_LED'
   AND is_active = true;


-- =====================================================================
-- VERIFY:
--   SELECT segment, media_type, version, length(body_html) AS body_len,
--          left(subject_line, 80) AS subject_preview
--     FROM public.proposal_templates
--    WHERE segment = 'GOVERNMENT' AND is_active = true
--    ORDER BY media_type;
-- =====================================================================
