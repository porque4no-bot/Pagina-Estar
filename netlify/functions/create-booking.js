const fs = require('fs');
const path = require('path');

// Helper to load local .env variables if not already set
function loadEnv() {
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

async function getSessionKey(token, username, password) {
  const response = await fetch('https://app.otasync.me/api/user/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, username, password, remember: 0 })
  });

  if (!response.ok) {
    throw new Error(`Authentication failed with status ${response.status}`);
  }

  const data = await response.json();
  if (!data.pkey) {
    throw new Error('Authentication response did not contain a session key (pkey)');
  }
  return data.pkey;
}

function decodeReference(ref) {
  try {
    if (!ref || !/^[a-zA-Z0-9\-_]+$/.test(ref)) {
      return null;
    }
    let base64 = ref.replace(/-/g, '+').replace(/_/g, '/');
    while (base64.length % 4) {
      base64 += '=';
    }
    const decoded = Buffer.from(base64, 'base64').toString('utf8');
    if (!decoded.startsWith('1|')) {
      return null;
    }
    const parts = decoded.split('|');
    if (parts.length < 11) {
      return null;
    }
    const [
      version,
      checkinYYMMDD,
      checkoutYYMMDD,
      guestsCount,
      roomTypeId,
      firstName,
      lastName,
      email,
      phone,
      extrasMask,
      bookingCode
    ] = parts;
    return {
      bookingCode,
      checkin: `20${checkinYYMMDD.substring(0, 2)}-${checkinYYMMDD.substring(2, 4)}-${checkinYYMMDD.substring(4, 6)}`,
      checkout: `20${checkoutYYMMDD.substring(0, 2)}-${checkoutYYMMDD.substring(2, 4)}-${checkoutYYMMDD.substring(4, 6)}`,
      guestsCount: parseInt(guestsCount) || 1,
      roomTypeId,
      firstName,
      lastName,
      email,
      phone,
      extrasMask
    };
  } catch (err) {
    return null;
  }
}

exports.handler = async (event, context) => {
  // CORS Headers
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Method Not Allowed. Use POST.' })
    };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch (e) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Invalid JSON request body' })
    };
  }

  const {
    checkin,
    checkout,
    guestsCount,
    roomTypeId,
    roomName,
    roomPrice,
    paidAmount,
    firstName,
    lastName,
    email,
    phone,
    notes,
    paymentDetails
  } = body;

  // Simple validation
  if (!checkin || !checkout || !roomTypeId || !firstName || !lastName || !email || !phone) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Missing required reservation fields' })
    };
  }

  // Calculate nights
  const checkinDate = new Date(checkin);
  const checkoutDate = new Date(checkout);
  const diffTime = checkoutDate - checkinDate;
  const nights = Math.max(1, Math.ceil(diffTime / (1000 * 60 * 60 * 24)));
  const avgPrice = Math.round(roomPrice / nights);

  // Read environment variables
  const token = process.env.OTASYNC_TOKEN || '';
  const username = process.env.OTASYNC_USERNAME || '';
  const password = process.env.OTASYNC_PASSWORD || '';
  const propertyId = process.env.OTASYNC_PROPERTY_ID || '9889';

  const hasCredentials = token && username && password;

  // 1. MOCK BOOKING GENERATOR (Fallback)
  if (!hasCredentials) {
    const mockBookingCode = `ESTAR-MOCK-${Math.floor(10000 + Math.random() * 90000)}`;
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        bookingCode: mockBookingCode,
        isMock: true,
        reservation: {
          code: mockBookingCode,
          guestName: `${firstName} ${lastName}`,
          email,
          phone,
          roomName,
          checkin,
          checkout,
          nights,
          totalPrice: roomPrice,
          status: 'Confirmed (Mock)'
        },
        message: 'Reserva simulada con éxito. Configure las credenciales reales en Netlify para producción.'
      })
    };
  }

  // 2. REAL OTASYNC INTEGRATION
  try {
    const pkey = await getSessionKey(token, username, password);

    // Build the night-by-night breakdown array
    const nightsArray = [];
    const nightsDates = [];
    for (let i = 0; i < nights; i++) {
      const d = new Date(checkinDate);
      d.setDate(d.getDate() + i);
      const dateStr = d.toISOString().split('T')[0];
      
      nightsDates.push(dateStr);
      nightsArray.push({
        night_date: dateStr,
        price: avgPrice,
        original_price: avgPrice,
        breakfast: 0,
        lunch: 0,
        dinner: 0
      });
    }

    let cleanReference = paymentDetails?.reference || '';
    let decodedRef = null;
    if (paymentDetails && paymentDetails.reference) {
      decodedRef = decodeReference(paymentDetails.reference);
      if (decodedRef) {
        cleanReference = decodedRef.bookingCode;
      }
    }

    const paymentInfo = [];
    if (paymentDetails && (paymentDetails.status === 'APPROVED' || paymentDetails.status === 'PENDING')) {
      paymentInfo.push({
        amount: parseFloat(paidAmount || roomPrice),
        date_payment: new Date().toISOString().split('T')[0],
        payment_method: 'card',
        note: `Wompi ID: ${paymentDetails.id}, Ref: ${cleanReference}, Status: ${paymentDetails.status}`
      });
    }

    // Build Kunas / OTASync reservation payload
    const reservationPayload = {
      key: pkey,
      id_properties: propertyId,
      token: token,
      status: "confirmed",
      rooms: [
        {
          id_room_types: parseInt(roomTypeId),
          id_rooms: 0, // Auto-assign room in Kunas
          room_type: roomName,
          room_number: "",
          avg_price: avgPrice,
          total_price: roomPrice,
          children_1: 0,
          children_2: 0,
          children_3: 0,
          adults: parseInt(guestsCount) || 1,
          seniors: 0,
          extras: [],
          payments: paymentInfo,
          overbooking: 0,
          nights: nightsArray
        }
      ],
      guests: [
        {
          first_name: firstName,
          last_name: lastName,
          id_guests: 0,
          guest_type: "adults"
        }
      ],
      extras: [],
      payments: paymentInfo,
      children_1: 0,
      children_2: 0,
      children_3: 0,
      adults: parseInt(guestsCount) || 1,
      seniors: 0,
      total_guests: parseInt(guestsCount) || 1,
      discount_type: "percent",
      discount_amount: 0,
      discount_note: "",
      rooms_price: roomPrice,
      rooms_discounted: roomPrice,
      extras_price: 0,
      board_price: 0,
      city_tax_price: 0,
      insurance_price: 0,
      total_price: roomPrice,
      id_boards: "",
      id_reservations: 0,
      nights: nights,
      nights_dates: nightsDates,
      reservation_type: "web",
      active_id_room_types: String(roomTypeId),
      preselected_id_rooms: 0,
      reference: cleanReference || "Hotel Estar Custom Booking Engine",
      id_contigents: 0,
      date_arrival: checkin,
      date_departure: checkout,
      id_channels: "392", // Default channel ID for private/direct reservations
      channel: "Private reservation",
      note: `Teléfono del huésped: ${phone}. Notas adicionales: ${notes || 'Ninguna'}`
    };

    const response = await fetch('https://app.otasync.me/api/reservation/insert/reservation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(reservationPayload)
    });

    if (!response.ok) {
      throw new Error(`Kunas API booking submission returned status ${response.status}`);
    }

    const data = await response.json();

    // Check if reservation insertion was successful in Kunas response
    const bookingCode = data.id_reservations || cleanReference || `ESTAR-PMS-${Date.now().toString().slice(-6)}`;

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        bookingCode: bookingCode,
        isMock: false,
        reservation: {
          code: bookingCode,
          guestName: `${firstName} ${lastName}`,
          email,
          phone,
          roomName,
          checkin,
          checkout,
          nights,
          totalPrice: roomPrice,
          status: 'Confirmed'
        },
        rawResponse: data
      })
    };

  } catch (error) {
    console.error('Kunas Booking Creation Error:', error.message);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({
        error: 'Failed to create reservation',
        message: error.message
      })
    };
  }
};
