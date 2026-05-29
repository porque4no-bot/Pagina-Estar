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

async function checkRateLimit(event, { name, limit, windowMs }) {
  const now = Date.now();
  const key = bucketKey(event, name);
  const ttlSeconds = Math.ceil(windowMs / 1000);

  async function updateBucket(load, save) {
    let bucket = await load();
    if (!bucket || bucket.resetAt <= now) bucket = { count: 0, resetAt: now + windowMs };
    bucket.count += 1;
    await save(bucket);
    return {
      ok: bucket.count <= limit,
      retryAfter: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))
    };
  }

  try {
    const store = getStore({ name: 'rate-limit', consistency: 'strong' });
    return await updateBucket(
      async () => {
        const raw = await store.get(key);
        return raw ? JSON.parse(raw) : null;
      },
      async bucket => store.set(key, JSON.stringify(bucket), { ttl: ttlSeconds })
    );
  } catch (e) {
    return updateBucket(
      async () => memoryBuckets.get(key),
      async bucket => memoryBuckets.set(key, bucket)
    );
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
