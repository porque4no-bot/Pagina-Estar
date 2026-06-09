/* Shared Google Drive helper using a service account.
 *
 * Credential storage strategy:
 *   1. Netlify Blobs ('secrets/google-service-account.json') — preferred, set
 *      once via the admin endpoint /api/upload-drive-credentials. AWS Lambda
 *      enforces a 4KB hard limit on the COMBINED size of all function env vars,
 *      and a Google service account JSON alone is 2-3KB, so keeping it out of
 *      env vars is necessary to leave room for other secrets.
 *   2. GOOGLE_SERVICE_ACCOUNT_JSON env var — legacy fallback, only used in
 *      environments where the Blob hasn't been seeded yet.
 *
 * The destination folder id stays in GOOGLE_DRIVE_FOLDER_ID (a short string,
 * not a secret).
 *
 * Supports Shared Drives via supportsAllDrives:true and includeItemsFromAllDrives:true.
 */

const SCOPES = ['https://www.googleapis.com/auth/drive'];
const SECRETS_STORE = 'secrets';
const CREDENTIALS_KEY = 'google-service-account.json';

let cachedClient = null;
let cachedCredentials = null;

function rootFolderId() {
  return process.env.GOOGLE_DRIVE_FOLDER_ID || '';
}

function getSecretsStore() {
  try {
    const { getStore } = require('@netlify/blobs');
    const opts = { name: SECRETS_STORE, consistency: 'strong' };
    /* Explicit credentials are required when the Blobs auto-discovery doesn't
       kick in (e.g. esbuild-bundled functions on certain Netlify build paths).
       BLOBS_TOKEN + NETLIFY_SITE_ID are already configured in this project. */
    if (process.env.BLOBS_TOKEN && process.env.NETLIFY_SITE_ID) {
      opts.token = process.env.BLOBS_TOKEN;
      opts.siteID = process.env.NETLIFY_SITE_ID;
    }
    return getStore(opts);
  } catch (e) {
    console.error('[_google-drive] Blobs unavailable:', e.message);
    return null;
  }
}

async function readBlobCredentials() {
  const store = getSecretsStore();
  if (!store) return null;
  try {
    const raw = await store.get(CREDENTIALS_KEY, { type: 'json' });
    if (raw && raw.private_key && raw.client_email) return raw;
  } catch (e) { /* fall through */ }
  return null;
}

function readEnvCredentials() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '';
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && parsed.private_key && parsed.client_email) return parsed;
    return null;
  } catch (e) {
    console.error('[_google-drive] GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON:', e.message);
    return null;
  }
}

async function loadCredentials() {
  if (cachedCredentials) return cachedCredentials;
  const fromBlob = await readBlobCredentials();
  if (fromBlob) { cachedCredentials = fromBlob; return fromBlob; }
  const fromEnv = readEnvCredentials();
  if (fromEnv) { cachedCredentials = fromEnv; return fromEnv; }
  return null;
}

async function writeBlobCredentials(credentials) {
  if (!credentials || !credentials.private_key || !credentials.client_email) {
    throw new Error('Invalid service account JSON: missing private_key or client_email');
  }
  const store = getSecretsStore();
  if (!store) throw new Error('Netlify Blobs unavailable');
  await store.setJSON(CREDENTIALS_KEY, credentials);
  cachedCredentials = credentials;
  cachedClient = null;  /* force a fresh client with the new credentials next time */
}

async function isConfigured() {
  if (!rootFolderId()) return false;
  const credentials = await loadCredentials();
  return Boolean(credentials);
}

async function getDriveClient() {
  if (cachedClient) return cachedClient;
  const credentials = await loadCredentials();
  if (!credentials) throw new Error('Google service account credentials are not configured');
  const { google } = require('googleapis');
  const auth = new google.auth.GoogleAuth({ credentials, scopes: SCOPES });
  const drive = google.drive({ version: 'v3', auth });
  cachedClient = drive;
  return drive;
}

/* Find a folder by name under parentId, or create one. Returns the folder id. */
async function findOrCreateFolder({ parentId, name }) {
  const drive = await getDriveClient();
  const safeName = String(name || 'sin-nombre')
    .replace(/[\\/:*?"<>|#% -]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120) || 'sin-nombre';

  /* Query: same name, mimeType=folder, parent=parentId, not trashed. */
  const escapedName = safeName.replace(/'/g, "\\'");
  const q = `name = '${escapedName}' and mimeType = 'application/vnd.google-apps.folder' and '${parentId}' in parents and trashed = false`;
  const search = await drive.files.list({
    q,
    fields: 'files(id, name)',
    pageSize: 1,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
    corpora: 'allDrives'
  });
  if (search.data.files && search.data.files.length) return search.data.files[0].id;

  const created = await drive.files.create({
    requestBody: {
      name: safeName,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentId]
    },
    fields: 'id',
    supportsAllDrives: true
  });
  return created.data.id;
}

/* Upload a buffer as a file inside folderId. Returns the file id and webViewLink. */
async function uploadFile({ folderId, name, mimeType, body }) {
  const drive = await getDriveClient();
  const { Readable } = require('stream');
  const stream = Buffer.isBuffer(body) ? Readable.from(body) : body;

  const res = await drive.files.create({
    requestBody: {
      name: String(name || 'archivo').slice(0, 250),
      parents: [folderId]
    },
    media: {
      mimeType: mimeType || 'application/octet-stream',
      body: stream
    },
    fields: 'id, webViewLink, size, mimeType, name',
    supportsAllDrives: true
  });
  return res.data;
}

/* Quick health probe — verifies credentials parse and the destination root
   folder is reachable. Used by an admin endpoint and never exposed publicly. */
async function probe() {
  if (!rootFolderId()) {
    return { ok: false, reason: 'missing GOOGLE_DRIVE_FOLDER_ID' };
  }
  const credentials = await loadCredentials();
  if (!credentials) {
    return { ok: false, reason: 'service account JSON not loaded. POST it once to /api/upload-drive-credentials.' };
  }
  try {
    const drive = await getDriveClient();
    const res = await drive.files.get({
      fileId: rootFolderId(),
      fields: 'id, name, mimeType, driveId',
      supportsAllDrives: true
    });
    return {
      ok: true,
      folderId: res.data.id,
      folderName: res.data.name,
      mimeType: res.data.mimeType,
      sharedDriveId: res.data.driveId || null,
      source: cachedCredentials === (await readBlobCredentials()) ? 'blobs' : 'env'
    };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

module.exports = {
  isConfigured,
  rootFolderId,
  getDriveClient,
  findOrCreateFolder,
  uploadFile,
  probe,
  writeBlobCredentials
};
