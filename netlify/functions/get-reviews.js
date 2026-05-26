const fs = require('fs');
const path = require('path');

// Helper to load local .env variables if not already set (e.g. running outside Netlify dev)
function loadEnv() {
  if (process.env.NODE_ENV === 'production' || process.env.NETLIFY === 'true') {
    return;
  }
  try {
    const envPath = path.join(__dirname, '../../.env');
    if (fs.existsSync(envPath)) {
      const envContent = fs.readFileSync(envPath, 'utf8');
      envContent.split('\n').forEach(line => {
        const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
        if (match) {
          const key = match[1];
          let value = match[2] || '';
          if (value.startsWith('"') && value.endsWith('"')) {
            value = value.substring(1, value.length - 1);
          } else if (value.startsWith("'") && value.endsWith("'")) {
            value = value.substring(1, value.length - 1);
          }
          if (!process.env[key]) {
            process.env[key] = value.trim();
          }
        }
      });
    }
  } catch (e) {
    console.error('Failed to load local .env file:', e.message);
  }
}

loadEnv();

// In-memory cache for the authentication session key (pkey)
let sessionCache = {
  pkey: null,
  expiresAt: null,
  promise: null
};

// Log in and get session key (pkey)
async function getSessionKey(token, username, password) {
  const now = Date.now();
  if (sessionCache.pkey && sessionCache.expiresAt && sessionCache.expiresAt > now) {
    return sessionCache.pkey;
  }

  if (sessionCache.promise) {
    try {
      return await sessionCache.promise;
    } catch (err) {
      sessionCache.promise = null;
    }
  }

  sessionCache.promise = (async () => {
    const authController = new AbortController();
    const authTimeoutId = setTimeout(() => authController.abort(), 10000);
    let response;
    try {
      response = await fetch('https://app.otasync.me/api/user/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, username, password, remember: 0 }),
        signal: authController.signal
      });
      clearTimeout(authTimeoutId);
    } catch (err) {
      clearTimeout(authTimeoutId);
      if (err.name === 'AbortError') {
        throw new Error('Request timeout during authentication');
      }
      throw err;
    }

    if (!response.ok) {
      throw new Error(`Authentication failed with status ${response.status}`);
    }

    const data = await response.json();
    if (!data.pkey) {
      throw new Error('Authentication response did not contain a session key (pkey)');
    }

    // Cache session key for 30 minutes
    sessionCache.pkey = data.pkey;
    sessionCache.expiresAt = Date.now() + 30 * 60 * 1000;
    return data.pkey;
  })();

  try {
    return await sessionCache.promise;
  } finally {
    sessionCache.promise = null;
  }
}

// Static fallback reviews
const FALLBACK_REVIEWS = [
  {
    text: "Nos quedamos cinco noches y la quinta sentíamos que era nuestra casa. La cocina, la luz por la mañana, el silencio. Eso no se finge.",
    author: "Mariana & Felipe",
    country: "Colombia",
    score: 10,
    date: "2025",
    source: "booking_com"
  }
];

// Format a date string to "YYYY-MM" for the output date field
function formatReviewDate(raw) {
  if (!raw) return '';
  // Try parsing as a full date
  const d = new Date(raw);
  if (!isNaN(d.getTime())) {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    return `${year}-${month}`;
  }
  // Already in YYYY-MM or YYYY format — return as-is
  return String(raw).slice(0, 7);
}

// Map a raw OTASync review object to our output format
function mapReview(r) {
  const text =
    r.content || r.review_text || r.text || r.comment ||
    r.review || r.description || r.body || '';

  const author =
    r.author_name || r.author || r.reviewer_name ||
    r.guest_name || r.name || 'Huésped';

  const country =
    r.country || r.country_name || r.guest_country ||
    r.nationality || '';

  const score =
    typeof r.score === 'number' ? r.score :
    typeof r.rating === 'number' ? r.rating :
    parseFloat(r.score || r.rating || r.note || r.grade || 0);

  const rawDate =
    r.date || r.review_date || r.created_at ||
    r.submitted_at || r.check_out_date || '';

  return {
    text: String(text).trim(),
    author: String(author).trim(),
    country: String(country).trim(),
    score: score,
    date: formatReviewDate(rawDate),
    source: 'booking_com'
  };
}

exports.handler = async (event, context) => {
  // CORS Headers
  const allowedOrigin = process.env.ALLOWED_ORIGIN;
  const corsHeaders = {
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json'
  };
  if (allowedOrigin && allowedOrigin !== '*') {
    corsHeaders['Access-Control-Allow-Origin'] = allowedOrigin;
  }

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  // Read environment variables
  const token = process.env.OTASYNC_TOKEN || '';
  const username = process.env.OTASYNC_USERNAME || '';
  const password = process.env.OTASYNC_PASSWORD || '';
  const propertyId = process.env.OTASYNC_PROPERTY_ID || '9889';

  const hasCredentials = token && username && password;

  // Return fallback if no credentials
  if (!hasCredentials) {
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ reviews: FALLBACK_REVIEWS, isMock: true })
    };
  }

  // Build date range: last 18 months → today
  const today = new Date();
  const dfrom = new Date(today);
  dfrom.setMonth(dfrom.getMonth() - 18);

  const toDateStr = today.toISOString().split('T')[0];
  const fromDateStr = dfrom.toISOString().split('T')[0];

  try {
    const pkey = await getSessionKey(token, username, password);

    const payload = {
      key: pkey,
      id_properties: propertyId,
      sourceCode: 2,
      dfrom: fromDateStr,
      dto: toDateStr
    };

    const reviewsController = new AbortController();
    const reviewsTimeoutId = setTimeout(() => reviewsController.abort(), 10000);
    let response;
    try {
      response = await fetch('https://app.otasync.me/api/reviews/data/details', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: reviewsController.signal
      });
      clearTimeout(reviewsTimeoutId);
    } catch (err) {
      clearTimeout(reviewsTimeoutId);
      if (err.name === 'AbortError') {
        console.error('get-reviews: request timeout fetching reviews');
        return {
          statusCode: 200,
          headers: corsHeaders,
          body: JSON.stringify({ reviews: FALLBACK_REVIEWS, isMock: true })
        };
      }
      throw err;
    }

    if (!response.ok) {
      console.error(`get-reviews: OTASync returned status ${response.status}`);
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({ reviews: FALLBACK_REVIEWS, isMock: true })
      };
    }

    const otaData = await response.json();

    // OTASync may return reviews under different keys
    const rawList =
      otaData.reviews || otaData.data || otaData.items ||
      otaData.results || otaData.list || [];

    if (!Array.isArray(rawList) || rawList.length === 0) {
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({ reviews: FALLBACK_REVIEWS, isMock: true })
      };
    }

    // Map, filter (score >= 8), sort descending, take top 6
    const reviews = rawList
      .map(mapReview)
      .filter(r => r.score >= 8)
      .sort((a, b) => b.score - a.score)
      .slice(0, 6);

    if (reviews.length === 0) {
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({ reviews: FALLBACK_REVIEWS, isMock: true })
      };
    }

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ reviews, isMock: false })
    };

  } catch (error) {
    console.error('get-reviews error:', error.message);
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ reviews: FALLBACK_REVIEWS, isMock: true })
    };
  }
};
