// =====================================================================
// Untitled Proposals — Local Gujarati PDF render PoC
//
// Usage:
//   cd pdf-poc && npm install && npm run render:local
//   open out/poc-local.pdf
//
// Why a local script?
//   The first thing we have to prove is that Chromium + HarfBuzz can
//   render the conjunct cluster in test.html without dotted-circle
//   fallbacks. If THIS render fails, the Vercel render will too — so
//   debug here first.
// =====================================================================

import puppeteer from 'puppeteer';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HTML_PATH = join(__dirname, 'test.html');
const OUT_DIR   = join(__dirname, 'out');
const OUT_PDF   = join(OUT_DIR, 'poc-local.pdf');

async function main() {
  const html = await readFile(HTML_PATH, 'utf8');
  await mkdir(OUT_DIR, { recursive: true });

  const t0 = Date.now();
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--font-render-hinting=none'],
  });

  try {
    const page = await browser.newPage();

    //
    // setContent waits for fonts via networkidle0; we bump the timeout
    // because the first cold load of Noto Sans Gujarati from Google
    // Fonts can take 3–4 seconds on a slow connection.
    //
    await page.setContent(html, {
      waitUntil: ['networkidle0', 'load'],
      timeout: 60_000,
    });

    //
    // document.fonts.ready is the canonical signal that all @font-face
    // declarations have actually loaded — networkidle0 alone has burned
    // people before because Google Fonts' CSS arrives before the woff2.
    //
    await page.evaluate(() => document.fonts.ready);

    await page.pdf({
      path: OUT_PDF,
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: '18mm', right: '16mm', bottom: '22mm', left: '16mm' },
    });

    const ms = Date.now() - t0;
    console.log(`✅ Rendered ${OUT_PDF} in ${ms}ms`);
    console.log(`   Open it and scan for: dotted circles, square boxes,`);
    console.log(`   visible halants (વ્), or any glyph in section 1 that`);
    console.log(`   looks broken. If anything is off, the font stack is wrong.`);

    // Smoke artifact: also export a screenshot of section 1 so reviewers
    // can compare side-by-side without opening the PDF.
    const section1 = await page.$('h2');
    if (section1) {
      const png = join(OUT_DIR, 'poc-local-section1.png');
      await page.screenshot({
        path: png,
        clip: await section1.boundingBox().then(b => ({
          x: 0, y: b.y - 10, width: 800, height: 600,
        })),
      });
      console.log(`   Screenshot: ${png}`);
    }
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error('❌ Render failed:', err);
  process.exit(1);
});
