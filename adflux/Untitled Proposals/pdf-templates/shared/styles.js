// =====================================================================
// Shared CSS for every PDF template.
// Returned as a string so each template can drop it into <style>.
// Same brand tokens as the React app's tokens.css — single source of
// visual truth across screen + print.
// =====================================================================

export const SHARED_CSS = /* css */ `
@page { size: A4 portrait; margin: 18mm 16mm 22mm 16mm; }

@font-face {
  font-family: 'Noto Sans Gujarati';
  font-display: swap;
  src: local('Noto Sans Gujarati');
}

:root {
  --ink:       #1a1a1a;
  --ink-mute:  #4a4a4a;
  --ink-soft:  #717171;
  --line:      #d8d8d8;
  --line-soft: #ececec;
  --accent:    #8b1f2a;
  --bg-tint:   #faf7f4;
}

* { box-sizing: border-box; }

html, body {
  margin: 0;
  padding: 0;
  color: var(--ink);
  font-family: 'DM Sans', 'Noto Sans Gujarati', system-ui, sans-serif;
  font-size: 10.5pt;
  line-height: 1.5;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}

.gu {
  font-family: 'Noto Sans Gujarati', 'DM Sans', system-ui, sans-serif;
  font-feature-settings: "akhn", "blwf", "half", "haln", "vatu", "pres", "abvs", "blws", "psts";
}

h1, h2, h3 {
  font-family: 'Space Grotesk', 'Noto Sans Gujarati', sans-serif;
  margin: 0 0 6pt;
  font-weight: 600;
  letter-spacing: -0.01em;
}
h1 { font-size: 17pt; }
h2 { font-size: 12pt; color: var(--accent); margin-top: 14pt; }
h3 { font-size: 10.5pt; color: var(--ink-mute); margin-top: 10pt; }

p { margin: 0 0 6pt; }
small { font-size: 9pt; color: var(--ink-mute); }

hr { border: 0; border-top: 1px solid var(--line); margin: 8pt 0; }

table { width: 100%; border-collapse: collapse; margin: 4pt 0; font-size: 9.5pt; }
th, td { padding: 5pt 7pt; border: 1px solid var(--line-soft); text-align: left; vertical-align: top; }
th { background: var(--bg-tint); font-weight: 600; font-size: 9pt; text-transform: uppercase; color: var(--ink-mute); letter-spacing: 0.04em; }

.right { text-align: right; }
.center { text-align: center; }
.muted { color: var(--ink-mute); }
.tiny  { font-size: 8.5pt; }
.bold  { font-weight: 600; }

.brand {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  border-bottom: 2px solid var(--accent);
  padding-bottom: 6pt;
  margin-bottom: 10pt;
}
.brand__name {
  font-family: 'Space Grotesk', sans-serif;
  font-weight: 700;
  font-size: 18pt;
  color: var(--accent);
  letter-spacing: -0.02em;
  margin: 0;
}
.brand__name-gu { font-size: 12pt; color: var(--ink-mute); margin-top: 2pt; }
.brand__meta { text-align: right; font-size: 8.5pt; color: var(--ink-mute); line-height: 1.5; }

.refstrip {
  display: flex;
  justify-content: space-between;
  font-size: 9pt;
  color: var(--ink-mute);
  margin-bottom: 6pt;
}

.subject {
  background: var(--bg-tint);
  border-left: 3px solid var(--accent);
  padding: 8pt 12pt;
  margin: 8pt 0 12pt;
  font-size: 10.5pt;
}

.totals {
  width: 60%;
  margin-left: auto;
  margin-top: 6pt;
}
.totals td { border: none; padding: 4pt 8pt; }
.totals tr.grand td {
  border-top: 1.5px solid var(--ink);
  border-bottom: 1.5px solid var(--ink);
  font-weight: 700;
  font-size: 11pt;
  background: var(--bg-tint);
}

.signer {
  margin-top: 24pt;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 24pt;
}

.foot {
  position: running(footer);
  font-size: 8pt;
  color: var(--ink-soft);
  text-align: center;
}

@page { @bottom-center { content: element(footer); } }

.stamp {
  display: inline-block;
  padding: 2pt 7pt;
  border: 1.2px solid var(--accent);
  color: var(--accent);
  font-size: 8.5pt;
  font-weight: 700;
  letter-spacing: 0.08em;
  border-radius: 2pt;
  text-transform: uppercase;
}

.notice {
  margin-top: 12pt;
  padding: 8pt 12pt;
  border: 1px dashed var(--line);
  background: #fffdfa;
  font-size: 9pt;
  color: var(--ink-mute);
}

.davp-watermark {
  display: inline-block;
  padding: 1pt 6pt;
  background: #fef6e7;
  border-radius: 2pt;
  font-size: 8.5pt;
  font-weight: 600;
  color: #b45309;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.agency-watermark {
  display: inline-block;
  padding: 1pt 6pt;
  background: #eff4ff;
  border-radius: 2pt;
  font-size: 8.5pt;
  font-weight: 600;
  color: #1d4ed8;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
`;
