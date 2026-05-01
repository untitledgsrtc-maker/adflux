// =====================================================================
// HTML → PDF via Puppeteer.
//
// On Vercel: uses puppeteer-core + @sparticuz/chromium (a binary
// shaped for AWS Lambda's filesystem layout).
// Locally:   uses regular puppeteer if RUN_LOCAL=1.
// =====================================================================

import chromium from '@sparticuz/chromium';
import puppeteerCore from 'puppeteer-core';

let _puppeteer = null;
async function getPuppeteer() {
  if (_puppeteer) return _puppeteer;
  if (process.env.RUN_LOCAL === '1') {
    const mod = await import('puppeteer');
    _puppeteer = mod.default;
  } else {
    _puppeteer = puppeteerCore;
  }
  return _puppeteer;
}

let _browser = null;
async function getBrowser() {
  if (_browser && _browser.connected !== false) return _browser;
  const puppeteer = await getPuppeteer();

  const launchOpts = process.env.RUN_LOCAL === '1'
    ? { headless: 'new' }
    : {
        args: chromium.args,
        defaultViewport: chromium.defaultViewport,
        executablePath: await chromium.executablePath(),
        headless: chromium.headless,
      };

  _browser = await puppeteer.launch(launchOpts);
  return _browser;
}

/**
 * Render an HTML string to a PDF Buffer (A4 portrait, 16/18mm margins
 * matching the @page rules in shared/styles.js).
 *
 * Waits for `document.fonts.ready` so the Noto Sans Gujarati webfont
 * has loaded before snapshot — without this, conjuncts render in a
 * fallback face on the first request after a cold start.
 */
export async function renderHtmlToPdf(html) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 20_000 });
    await page.evaluate(async () => { await document.fonts.ready; });
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '18mm', right: '16mm', bottom: '22mm', left: '16mm' },
      // Templates own their @page rules; keep preferCSSPageSize true
      preferCSSPageSize: true,
    });
    return pdf;
  } finally {
    await page.close();
  }
}

/** For graceful shutdown. */
export async function closeBrowser() {
  if (_browser) {
    await _browser.close();
    _browser = null;
  }
}
