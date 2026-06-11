/* Shared local-development .env loader.
   In production (NODE_ENV=production or NETLIFY=true) this is a no-op;
   Netlify injects environment variables directly. Locally it reads the
   project-root .env file so netlify dev and node unit runs see the same vars. */

const fs = require('fs');
const path = require('path');

function loadEnv() {
  if (process.env.NODE_ENV === 'production' || process.env.NETLIFY === 'true') return;
  try {
    const envPath = path.join(__dirname, '../../.env');
    if (!fs.existsSync(envPath)) return;
    fs.readFileSync(envPath, 'utf8').split(/\r?\n/).forEach(line => {
      const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
      if (!match) return;
      const key = match[1];
      let value = match[2] || '';
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = value.trim();
    });
  } catch (e) {
    console.error('[_env] Failed to load .env:', e.message);
  }
}

loadEnv();
