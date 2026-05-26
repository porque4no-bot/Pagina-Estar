const fs = require('fs');
const path = require('path');

function loadEnv() {
  if (process.env.NODE_ENV === 'production' || process.env.NETLIFY === 'true') return;
  try {
    const envPath = path.join(__dirname, '../../.env');
    if (fs.existsSync(envPath)) {
      fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
        const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
        if (match) {
          const key = match[1];
          let value = match[2] || '';
          if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
          }
          if (!process.env[key]) process.env[key] = value.trim();
        }
      });
    }
  } catch (e) {
    console.error('Failed to load local .env file:', e.message);
  }
}

loadEnv();

let sessionCache = { pkey: null, expiresAt: null, promise: null };

async function getSessionKey(token, username, password) {
  const now = Date.now();
  if (sessionCache.pkey && sessionCache.expiresAt && sessionCache.expiresAt > now) return sessionCache.pkey;
  if (sessionCache.promise) {
    try { return await sessionCache.promise; } catch { sessionCache.promise = null; }
  }
  sessionCache.promise = (async () => {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 10000);
    let res;
    try {
      res = await fetch('https://app.otasync.me/api/user/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, username, password, remember: 0 }),
        signal: ctrl.signal
      });
      clearTimeout(tid);
    } catch (err) {
      clearTimeout(tid);
      throw err.name === 'AbortError' ? new Error('Auth timeout') : err;
    }
    if (!res.ok) throw new Error(`Auth failed: ${res.status}`);
    const data = await res.json();
    if (!data.pkey) throw new Error('No pkey in auth response');
    sessionCache.pkey = data.pkey;
    sessionCache.expiresAt = Date.now() + 30 * 60 * 1000;
    return data.pkey;
  })();
  try { return await sessionCache.promise; } finally { sessionCache.promise = null; }
}

const FALLBACK_REVIEWS = [
  {
    text: "Muy conveniente, económico, limpio y moderno. Lo recomiendo altamente. La ubicación es excelente, cerca de buenas tiendas, restaurantes y vida nocturna. El apartamento es muy moderno, limpio, espacioso y bien iluminado. El personal es súper amable y servicial.",
    author: "Douglas",
    country: "Canadá",
    score: 10,
    date: "2024-04",
    source: "booking_com"
  },
  {
    text: "Excelente hotel, situado en un barrio muy agradable. Los apartaestudios son modernos, cómodos y espaciosos. Todo está muy limpio y bien mantenido. Dormimos de maravilla. El desayuno es delicioso y variado. El personal es adorable y servicial. Lo recomiendo al 100%.",
    author: "Catherine",
    country: "Bélgica",
    score: 10,
    date: "2025-02",
    source: "booking_com"
  },
  {
    text: "¡Wooow, el mejor lugar para quedarse en Manizales! Amé cada detalle del lugar, lo limpio y acogedor que era. 20 de 10 en ubicación: súper cerca al Cable, la Av. Santander y restaurantes. El barrio La Estrella es un lugar que invita a recorrer. 100% recomendado.",
    author: "Angélica",
    country: "Colombia",
    score: 10,
    date: "2023-09",
    source: "booking_com"
  },
  {
    text: "Anfitriona increíble, gran comodidad y ubicación. La estancia fue perfecta; tiene una ubicación grandiosa que facilitó disfrutar de la ciudad. Es un vecindario lindo y tranquilo rodeado de excelentes restaurantes. La habitación era muy cómoda y agradable.",
    author: "Manuela",
    country: "Países Bajos",
    score: 10,
    date: "2023-09",
    source: "booking_com"
  },
  {
    text: "La habitación tiene espacio de sobra para las 6 maletas y mochilas. Excelente cama para descansar y una ducha espectacular. Además, el diseño de la iluminación está muy bien logrado. Los blackouts funcionan a la perfección. Altamente recomendado.",
    author: "Renatus",
    country: "Panamá",
    score: 10,
    date: "2023-12",
    source: "booking_com"
  },
  {
    text: "La cocineta está muy bien equipada, excelente ubicación cerca de centros comerciales, cafés, restaurantes y vías principales. Hay café y aromática disponibles todo el tiempo en la recepción. No tengo quejas, todo estuvo muy bien.",
    author: "Francia",
    country: "Colombia",
    score: 10,
    date: "2024-10",
    source: "booking_com"
  },
  {
    text: "Totalmente nuevo, bien decorado, luminoso y ventilado. Cama y sábanas extremadamente cómodas. El personal fue muy amable y dispuesto a ayudar. Excelente ubicación en la zona rosa pero lo suficientemente apartado para no escuchar ruido por la noche.",
    author: "Maisie",
    country: "Reino Unido",
    score: 10,
    date: "2023-12",
    source: "booking_com"
  },
  {
    text: "El personal de recepción y la señora Marta tuvieron un 10 en su disposición y con el desayuno. Las instalaciones y la ubicación hacen de Estar una excelente alternativa en Manizales.",
    author: "Rodrigo",
    country: "Chile",
    score: 10,
    date: "2024-05",
    source: "booking_com"
  },
  {
    text: "Me encantó, quiero volver. Es un apartaestudio muy moderno, cómodo y limpio. Está ubicado en un punto muy estratégico de la ciudad y es fácil de llegar. Me encantó el servicio y la amabilidad del anfitrión.",
    author: "Huésped verificado",
    country: "Colombia",
    score: 10,
    date: "2023-09",
    source: "booking_com"
  },
  {
    text: "Excelente ubicación, lo cual facilitaba mucho el movimiento por la ciudad. El espacio fue totalmente satisfactorio y la cama es sumamente cómoda. Una experiencia muy buena.",
    author: "Jose",
    country: "Colombia",
    score: 10,
    date: "2023-09",
    source: "booking_com"
  }
];

function mapReview(r) {
  const text = r.content || r.review_text || r.text || r.comment || r.description || r.body || '';
  const author = r.author_name || r.author || r.reviewer_name || r.guest_name || r.name || 'Huésped';
  const country = r.country || r.country_name || r.guest_country || r.nationality || '';
  const score = typeof r.score === 'number' ? r.score :
                typeof r.rating === 'number' ? r.rating :
                parseFloat(r.score || r.rating || r.note || r.grade || 0);
  const rawDate = r.date || r.review_date || r.created_at || r.submitted_at || r.check_out_date || '';
  let date = '';
  if (rawDate) {
    const d = new Date(rawDate);
    if (!isNaN(d.getTime())) {
      date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    } else {
      date = String(rawDate).slice(0, 7);
    }
  }
  return { text: String(text).trim(), author: String(author).trim(), country: String(country).trim(), score, date, source: 'booking_com' };
}

exports.handler = async (event, context) => {
  const allowedOrigin = process.env.ALLOWED_ORIGIN;
  const corsHeaders = {
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json'
  };
  if (allowedOrigin && allowedOrigin !== '*') corsHeaders['Access-Control-Allow-Origin'] = allowedOrigin;

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: corsHeaders, body: '' };

  const token = process.env.OTASYNC_TOKEN || '';
  const username = process.env.OTASYNC_USERNAME || '';
  const password = process.env.OTASYNC_PASSWORD || '';
  const propertyId = process.env.OTASYNC_PROPERTY_ID || '9889';

  if (!token || !username || !password) {
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ reviews: FALLBACK_REVIEWS, isMock: true }) };
  }

  const today = new Date();
  const start = new Date(today);
  start.setFullYear(start.getFullYear() - 2);

  try {
    const pkey = await getSessionKey(token, username, password);

    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 10000);
    let res;
    try {
      res = await fetch('https://app.otasync.me/api/reviews/details', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${pkey}` },
        body: JSON.stringify({
          key: pkey,
          hotelCode: propertyId,
          sourceCodes: [2],
          reviewDateFilter: {
            start: start.toISOString().split('T')[0],
            end: today.toISOString().split('T')[0]
          },
          limit: 20,
          offset: 0
        }),
        signal: ctrl.signal
      });
      clearTimeout(tid);
    } catch (err) {
      clearTimeout(tid);
      console.error('get-reviews fetch error:', err.message);
      return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ reviews: FALLBACK_REVIEWS, isMock: true }) };
    }

    if (!res.ok) {
      console.error(`get-reviews: OTASync returned ${res.status}`);
      return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ reviews: FALLBACK_REVIEWS, isMock: true }) };
    }

    const otaData = await res.json();
    const rawList = otaData.reviews || otaData.data || otaData.items || otaData.results || otaData.list || [];

    if (!Array.isArray(rawList) || !rawList.length) {
      return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ reviews: FALLBACK_REVIEWS, isMock: true }) };
    }

    const reviews = rawList.map(mapReview).filter(r => r.score >= 8).sort((a, b) => b.score - a.score).slice(0, 6);

    if (!reviews.length) {
      return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ reviews: FALLBACK_REVIEWS, isMock: true }) };
    }

    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ reviews, isMock: false }) };

  } catch (error) {
    console.error('get-reviews error:', error.message);
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ reviews: FALLBACK_REVIEWS, isMock: true }) };
  }
};
