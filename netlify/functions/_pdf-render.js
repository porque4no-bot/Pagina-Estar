/* HTML → PDF rendering helper for Netlify Functions.
 *
 * Uses puppeteer-core + @sparticuz/chromium, the standard Lambda-friendly
 * stack: @sparticuz/chromium ships a minimal Chromium binary tuned for the
 * Lambda environment (Netlify Functions run on Lambda) and exposes a
 * pre-computed executable path plus the right launch flags.
 *
 * The browser is launched fresh on each invocation and closed in a finally
 * block so a render failure never leaves a zombie Chromium process behind.
 */

async function htmlToPdfBuffer(html) {
  if (typeof html !== 'string' || !html.length) {
    throw new Error('htmlToPdfBuffer: html must be a non-empty string');
  }

  const chromium = require('@sparticuz/chromium');
  const puppeteer = require('puppeteer-core');

  const browser = await puppeteer.launch({
    args: chromium.args,
    defaultViewport: chromium.defaultViewport,
    executablePath: await chromium.executablePath(),
    headless: chromium.headless
  });

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '0mm', bottom: '0mm', left: '0mm', right: '0mm' }
    });
    return Buffer.isBuffer(pdf) ? pdf : Buffer.from(pdf);
  } finally {
    try { await browser.close(); } catch (e) { /* ignore */ }
  }
}

module.exports = { htmlToPdfBuffer };
