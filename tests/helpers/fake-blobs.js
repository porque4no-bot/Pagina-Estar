/* In-memory fake of @netlify/blobs for unit tests (Frente codes).
 *
 * Supports what the discount modules use: get, getWithMetadata (etag), set
 * with the conditional writes onlyIfMatch / onlyIfNew (resolving
 * { modified:false } on a failed precondition, like the real client), delete
 * and list({ prefix }). One bucket per store name.
 *
 * Two ways to use it:
 *   - makeBlobs().getStore  → inject as deps.getStore into the pure modules.
 *   - installFakeBlobsModule() → replaces '@netlify/blobs' in require.cache so
 *     handlers that import getStore at module load use the fake (node --test
 *     runs each file in its own process, so the cache never leaks). */

function makeBlobs() {
  const buckets = new Map();
  function bucketFor(name) {
    if (!buckets.has(name)) buckets.set(name, new Map());
    return buckets.get(name);
  }
  let etagSeq = 1;
  function getStore(opts) {
    const name = typeof opts === 'string' ? opts : opts.name;
    const b = bucketFor(name);
    return {
      async get(key) { const v = b.get(key); return v ? v.data : null; },
      async getWithMetadata(key) {
        const v = b.get(key);
        return v ? { data: v.data, etag: v.etag, metadata: {} } : null;
      },
      async set(key, data, options) {
        const cur = b.get(key);
        if (options && options.onlyIfMatch && (!cur || cur.etag !== options.onlyIfMatch)) return { modified: false };
        if (options && options.onlyIfNew && cur) return { modified: false };
        const etag = 'e' + (etagSeq++);
        b.set(key, { data: String(data), etag });
        return { modified: true, etag };
      },
      async setJSON(key, value, options) { return this.set(key, JSON.stringify(value), options); },
      async delete(key) { b.delete(key); },
      async list(listOpts) {
        const prefix = listOpts && listOpts.prefix ? String(listOpts.prefix) : '';
        return { blobs: [...b.keys()].filter(k => k.startsWith(prefix)).map(k => ({ key: k, etag: b.get(k).etag })), directories: [] };
      }
    };
  }
  return { getStore, buckets };
}

function installFakeBlobsModule() {
  const blobs = makeBlobs();
  const id = require.resolve('@netlify/blobs');
  require.cache[id] = { id, filename: id, loaded: true, exports: { getStore: blobs.getStore } };
  return blobs;
}

module.exports = { makeBlobs, installFakeBlobsModule };
