const { defineConfig, devices } = require('@playwright/test');

/* Puerto configurable (E2E_PORT) para correr varias copias del repo en paralelo
   sin que una sirva el dist de otra (reuseExistingServer). Default 3401. */
const PORT = parseInt(process.env.E2E_PORT, 10) || 3401;

module.exports = defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  timeout: 30000,
  expect: {
    timeout: 7000
  },
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI
    ? [['line'], ['html', { open: 'never' }]]
    : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    /* Sandboxed environments that can't download Playwright's browsers can
       point CHROMIUM_PATH at any Chromium binary (e.g. @sparticuz/chromium). */
    ...(process.env.CHROMIUM_PATH
      ? { launchOptions: { executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox', '--disable-gpu'] } }
      : {})
  },
  webServer: {
    command: `node tests/helpers/static-server.js dist ${PORT}`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 30000
  },
  projects: [
    {
      name: 'chromium-desktop',
      use: {
        ...devices['Desktop Chrome']
      }
    },
    {
      name: 'chromium-mobile',
      use: {
        ...devices['Pixel 7']
      }
    }
  ]
});
