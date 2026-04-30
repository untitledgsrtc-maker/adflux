// =====================================================================
// Untitled Proposals — Vercel-style Gujarati PDF render PoC
//
// This emulates how the production render will run on Vercel:
// puppeteer-core + @sparticuz/chromium (a slimmed Chromium tarball
// that fits inside the 50 MB AWS Lambda zipped layer limit Vercel
// inherits).
//
// Run locally with:
//   cd pdf-poc && npm install && npm run render:vercel
//
// On macOS this WILL download a Linux Chromium binary (~50 MB) which
// then runs through Rosetta — slow, but the point is to validate that
// Gujarati renders identically in the production binary, not to be fast.
// =====================================================================

import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HTML_PATH = join(__dirname, 'test.html');
const OUT_DIR   = join(__dirname, 'out');
const OUT_PDF   = join(OUT_DIR, 'poc-vercel.pdf');

async function main() {
  const html = await readFile(HTML_PATH, 'utf8');
  await mkdir(OUT_DIR, { recursive: true });

  // @sparticuz/chromium ships its own font config; we add Indic fonts
  // by loading them from Google Fonts in the HTML itself (already done).
  // For zero-cold-start we'd self-host woff2 and inline the @font-face,
  // but for the PoC the Google Fonts CDN is fine.

  const t0 = Date.now();
  const browser = await puppeteer.launch({
    args: chromium.args,
    defaultViewport: chromium.defaultViewport,
    executablePath: await chromium.executablePath(),
    headless: chromium.headless,
  });

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: ['networkidle0', 'load'], timeout: 60_000 });
    await page.evaluate(() => document.fonts.ready);

    await page.pdf({
      path: OUT_PDF,
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: '18mm', right: '16mm', bottom: '22mm', left: '16mm' },
    });

    console.log(`✅ Rendered ${OUT_PDF} in ${Date.now() - t0}ms`);
    console.log(`   This file should be byte-similar to poc-local.pdf —`);
    console.log(`   if Gujarati renders here, it will render on Vercel.`);
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error('❌ Vercel-style render failed:', err);
  process.exit(1);
});
