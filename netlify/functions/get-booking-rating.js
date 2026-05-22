const https = require('https');

// Service-agnostic Netlify serverless function to fetch Booking.com rating.
// It retrieves the scraping URL from process.env.PROXY_URL.
exports.handler = async (event, context) => {
  const PROXY_URL = process.env.PROXY_URL;
  const FALLBACK_RATING = "9.6";

  // If no proxy URL is configured, immediately return the fallback rating
  if (!PROXY_URL) {
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=3600' // Cache fallback for 1 hour
      },
      body: JSON.stringify({ rating: FALLBACK_RATING, note: 'fallback: PROXY_URL env var is missing' })
    };
  }

  try {
    const html = await fetchUrl(PROXY_URL);
    
    // Attempt to match the rating score from schema JSON-LD or page scripts
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
          // This keeps proxy requests to a minimum (only ~30 executions per month)
          'Cache-Control': 'public, max-age=86400, s-maxage=86400, stale-while-revalidate=7200'
        },
        body: JSON.stringify({ rating })
      };
    } else {
      throw new Error('Rating value pattern not found in HTML response');
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

// Helper function to perform HTTPS GET requests using native Node.js https module
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
