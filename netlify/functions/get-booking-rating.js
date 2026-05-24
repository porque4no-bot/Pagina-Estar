const https = require('https');

// Service-agnostic Netlify serverless function to fetch Booking.com rating.
// It retrieves the scraping URL from process.env.PROXY_URL.
exports.handler = async (event, context) => {
  const allowedOrigin = process.env.ALLOWED_ORIGIN;
  const corsHeaders = {
    'Content-Type': 'application/json'
  };
  if (allowedOrigin) {
    corsHeaders['Access-Control-Allow-Origin'] = allowedOrigin;
  }

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  const PROXY_URL = process.env.PROXY_URL;
  const FALLBACK_RATING = "9.0";
  const FALLBACK_REVIEWS_COUNT = "126";
  const FALLBACK_LOCATION_RATING = "9.4";

  // If no proxy URL is configured, immediately return the fallback values
  if (!PROXY_URL) {
    return {
      statusCode: 200,
      headers: {
        ...corsHeaders,
        'Cache-Control': 'public, max-age=3600' // Cache fallback for 1 hour
      },
      body: JSON.stringify({
        rating: FALLBACK_RATING,
        reviewsCount: FALLBACK_REVIEWS_COUNT,
        locationRating: FALLBACK_LOCATION_RATING,
        note: 'fallback: PROXY_URL env var is missing'
      })
    };
  }

  try {
    const html = await fetchUrl(PROXY_URL);
    
    // 1. Overall Rating Score
    const ratingMatches = [];
    const ratingRegexes = [
      /"reviewScore"\s*:\s*"([\d.]+)"/g,
      /"ratingValue"\s*:\s*"?([\d.]+)"?/g
    ];
    for (const regex of ratingRegexes) {
      let match;
      while ((match = regex.exec(html)) !== null) {
        ratingMatches.push(parseFloat(match[1]));
      }
    }
    const rating = ratingMatches.length > 0 ? ratingMatches[0].toFixed(1) : FALLBACK_RATING;

    // 2. Review Count
    const reviewsCountMatches = [];
    const reviewsCountRegexes = [
      /"reviewCount"\s*:\s*"(\d+)"/g,
      /"reviewCount"\s*:\s*(\d+)/g,
      /reviewsCount"\s*:\s*(\d+)/g
    ];
    for (const regex of reviewsCountRegexes) {
      let match;
      while ((match = regex.exec(html)) !== null) {
        reviewsCountMatches.push(parseInt(match[1]));
      }
    }
    const reviewsCount = reviewsCountMatches.length > 0 ? String(reviewsCountMatches[0]) : FALLBACK_REVIEWS_COUNT;

    // 3. Location Score
    const locationMatches = [];
    const locationRegexes = [
      /"name"\s*:\s*"hotel_location"[^}]*?"value"\s*:\s*([\d.]+)/g,
      /"question"\s*:\s*"hotel_location"[^}]*?"score"\s*:\s*([\d.]+)/g,
      /hotel_location[^}]*?scoreSegment[^}]*?score"\s*:\s*([\d.]+)/g
    ];
    for (const regex of locationRegexes) {
      let match;
      while ((match = regex.exec(html)) !== null) {
        locationMatches.push(parseFloat(match[1]));
      }
    }
    if (locationMatches.length === 0) {
      const locIndex = html.indexOf('hotel_location');
      if (locIndex !== -1) {
        const snippet = html.substring(locIndex, locIndex + 500);
        const scoreMatch = snippet.match(/"score"\s*:\s*([\d.]+)/) || snippet.match(/"value"\s*:\s*([\d.]+)/);
        if (scoreMatch) {
          locationMatches.push(parseFloat(scoreMatch[1]));
        }
      }
    }
    const locationRating = locationMatches.length > 0 ? locationMatches[0].toFixed(1) : FALLBACK_LOCATION_RATING;

    return {
      statusCode: 200,
      headers: {
        ...corsHeaders,
        // Cache in Netlify Edge CDN for 24 hours
        'Cache-Control': 'public, max-age=86400, s-maxage=86400, stale-while-revalidate=7200'
      },
      body: JSON.stringify({ rating, reviewsCount, locationRating })
    };
  } catch (error) {
    console.error('Dynamic rating fetch error:', error.message);
    return {
      statusCode: 200,
      headers: {
        ...corsHeaders,
        'Cache-Control': 'public, max-age=1800' // Cache error states for 30 minutes
      },
      body: JSON.stringify({
        rating: FALLBACK_RATING,
        reviewsCount: FALLBACK_REVIEWS_COUNT,
        locationRating: FALLBACK_LOCATION_RATING,
        error: 'An error occurred while fetching ratings'
      })
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

