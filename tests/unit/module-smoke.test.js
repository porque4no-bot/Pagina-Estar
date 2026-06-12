/* Smoke test: verify every Netlify function file loads without a syntax error
   or immediate require-time crash. This catches regressions like duplicate
   `const` declarations that make a function permanently return 500. */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

process.env.GUEST_APP_TOKEN_SECRET = 'smoke-test-secret';
process.env.GUEST_APP_DATA_ENCRYPTION_KEY = 'smoke-test-enc-key';
process.env.GUEST_APP_DEMO_MODE = 'true';

const FUNCTIONS_DIR = path.join(__dirname, '../../netlify/functions');

const MODULES = [
  /* shared helpers */
  '_env', '_guest-app', '_quotes-store', '_otasync', '_email', '_rate-limit',
  '_google-drive', '_pdf-render', '_contract-template', '_quote-lock', '_direct-pricing',
  '_payments', '_firebase-auth', '_quote-audit', '_pricing', '_analytics',
  /* handlers */
  'booking-status', 'check-availability', 'create-booking',
  'create-mercadopago-preference', 'create-quote', 'create-wompi-signature',
  'drive-probe', 'get-booking', 'get-booking-rating', 'get-quote', 'get-reviews',
  'guest-action', 'guest-checkin', 'guest-drive', 'guest-session', 'guest-sync',
  'list-quotes', 'mercadopago-webhook', 'otasync-webhook', 'purge-guest-data',
  'quote-availability', 'read-quote-audit', 'reconcile-payments',
  'request-cancellation', 'request-quote', 'retry-quote-booking', 'revalidate-quotes',
  'send-confirmation', 'send-quote-email', 'update-quote',
  'upload-drive-credentials', 'wompi-webhook'
];

for (const mod of MODULES) {
  test(`${mod}.js loads without errors`, () => {
    assert.doesNotThrow(() => {
      require(path.join(FUNCTIONS_DIR, mod + '.js'));
    });
  });
}
