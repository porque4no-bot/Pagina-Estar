const https = require('https');

// Netlify serverless function to fetch Booking.com rating for Estar Apartaestudios
exports.handler = async (event, context) => {
  const targetUrl = 'https://www.booking.com/hotel/co/estar-apartaestudios.html';
  const SCRAPER_API_KEY = process.env.SCRAPER_API_KEY;
  const FALLBACK_RATING = "9.6";

  // If no api key is present, fallback immediately to preserve standard behavior
  if (!SCRAPER_API_KEY) {
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=3600' // Cache fallback for 1 hour
      },
      body: JSON.stringify({ rating: FALLBACK_RATING, note: 'fallback: key missing' })
    };
  }

  // ScraperAPI URL to bypass Booking's AWS WAF checks
  const proxyUrl = `https://api.scraperapi.com/?api_key=${SCRAPER_API_KEY}&url=${encodeURIComponent(targetUrl)}`;

  try {
    const html = await fetchUrl(proxyUrl);
    
    // Attempt to match the rating score from schema JSON-LD or pages scripts
    // Booking.com regularly puts "reviewScore": "9.6" or "ratingValue": 9.6 or "ratingValue":"9.6"
    const scoreMatch = html.match(/"reviewScore"\s*:\s*"([\d.]+)"/) || 
                       html.match(/"ratingValue"\s*:\s*"?([\d.]+)"?/) ||
                       html.match(/score_value[^>]*>([\d.]+)<\/span>/);
    
    if (scoreMatch && scoreMatch[1]) {
      const rating = scoreMatch[1];
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
          // Cache in Netlify Edge CDN for 24 hours (86400 seconds)
          // This keeps ScraperAPI usage to a minimum (only ~30 executions per month)
          'Cache-Control': 'public, max-age=86400, s-maxage=86400, stale-while-revalidate=7200'
        },
        body: JSON.stringify({ rating })
      };
    } else {
      throw new Error('Rating value pattern not found in Booking.com HTML');
    }
  } catch (error) {
    console.error('Dynamic rating fetch error:', error.message);
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=1800' // Cache error states for 30 minutes
      },
      body: JSON.stringify({ rating: FALLBACK_RATING, error: error.message })
    };
  }
};

// Helper function to perform HTTPS GET requests using native node https module
function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`Server returned status code ${res.statusCode}`));
        return;
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}
