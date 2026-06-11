const crypto = require('crypto');

const { getStore } = require('@netlify/blobs');

const memoryBuckets = new Map();

function clientIp(event) {
  const headers = event.headers || {};
  const raw =
    headers['x-nf-client-connection-ip'] ||
    headers['client-ip'] ||
    headers['x-forwarded-for'] ||
    headers['X-Forwarded-For'] ||
    '';
  return String(raw).split(',')[0].trim() || 'unknown';
}

function bucketKey(event, name) {
  const ipHash = crypto.createHash('sha256').update(clientIp(event)).digest('hex').slice(0, 32);
  return `${name}:${ipHash}`;
}

function result(bucket, limit, now) {
  return {
    ok: bucket.count <= limit,
    retryAfter: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))
  };
}

/* Atomic increment via compare-and-set (A-5). The previous implementation did
   a plain read-modify-write, so two concurrent requests could both read the
   same count and both save count+1, letting the limit be exceeded under load.
   We read the bucket with its etag and write back with onlyIfMatch /
   onlyIfNew (@netlify/blobs >= 10): a failed precondition resolves with
   { modified: false } (it does not throw), in which case a competing writer
   won and we retry. Netlify Blobs has no TTL; expiry is the resetAt check.
   Falls back to the non-atomic path on stores without getWithMetadata. */
async function casUpdate(store, key, limit, windowMs, now) {
  const ATTEMPTS = 5;
  for (let i = 0; i < ATTEMPTS; i++) {
    const current = await store.getWithMetadata(key, { type: 'text' });
    let bucket;
    try { bucket = current && current.data ? JSON.parse(current.data) : null; }
    catch (e) { bucket = null; }
    if (!bucket || bucket.resetAt <= now) bucket = { count: 0, resetAt: now + windowMs };
    bucket.count += 1;

    const opts = (current && current.etag)
      ? { onlyIfMatch: current.etag }
      : { onlyIfNew: true };
    try {
      const res = await store.set(key, JSON.stringify(bucket), opts);
      /* { modified: false } => precondition failed, a competing writer won. */
      if (res && res.modified === false) continue;
      return result(bucket, limit, now);
    } catch (e) {
      /* API mismatch (store without conditional writes) — let the caller
         fall back to read-modify-write; precondition-throwing stores retry. */
      if (i === ATTEMPTS - 1) throw e;
    }
  }
  /* Exhausted retries under heavy contention: fail safe by counting the hit. */
  return { ok: false, retryAfter: Math.ceil(windowMs / 1000) };
}

async function checkRateLimit(event, { name, limit, windowMs }) {
  const now = Date.now();
  const key = bucketKey(event, name);

  try {
    const store = getStore({ name: 'rate-limit', consistency: 'strong' });
    if (typeof store.getWithMetadata === 'function') {
      try {
        return await casUpdate(store, key, limit, windowMs, now);
      } catch (casErr) {
        /* CAS unsupported in this Blobs build — fall back to read-modify-write. */
        const raw = await store.get(key);
        let bucket = raw ? JSON.parse(raw) : null;
        if (!bucket || bucket.resetAt <= now) bucket = { count: 0, resetAt: now + windowMs };
        bucket.count += 1;
        await store.set(key, JSON.stringify(bucket));
        return result(bucket, limit, now);
      }
    }
    const raw = await store.get(key);
    let bucket = raw ? JSON.parse(raw) : null;
    if (!bucket || bucket.resetAt <= now) bucket = { count: 0, resetAt: now + windowMs };
    bucket.count += 1;
    await store.set(key, JSON.stringify(bucket));
    return result(bucket, limit, now);
  } catch (e) {
    /* Blobs unavailable — per-instance memory fallback (best effort). */
    let bucket = memoryBuckets.get(key);
    if (!bucket || bucket.resetAt <= now) bucket = { count: 0, resetAt: now + windowMs };
    bucket.count += 1;
    memoryBuckets.set(key, bucket);
    return result(bucket, limit, now);
  }
}

function rateLimitResponse(headers, retryAfter) {
  return {
    statusCode: 429,
    headers: { ...headers, 'Retry-After': String(retryAfter) },
    body: JSON.stringify({ error: 'Demasiadas solicitudes. Intenta de nuevo más tarde.' })
  };
}

module.exports = { checkRateLimit, rateLimitResponse };
