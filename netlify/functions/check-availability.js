const fs = require('fs');
const path = require('path');

// Helper to load local .env variables if not already set (e.g. running outside Netlify dev)
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

// In-memory cache for the authentication session key (pkey)
let sessionCache = {
  pkey: null,
  expiresAt: null
};

// Log in and get session key (pkey)
async function getSessionKey(token, username, password) {
  const now = Date.now();
  if (sessionCache.pkey && sessionCache.expiresAt && sessionCache.expiresAt > now) {
    return sessionCache.pkey;
  }

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

  // Cache session key for 30 minutes
  sessionCache.pkey = data.pkey;
  sessionCache.expiresAt = now + 30 * 60 * 1000;
  return data.pkey;
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

  // Parse parameters (supports both query string and POST body)
  let checkin = '';
  let checkout = '';
  let guests = 1;

  if (event.httpMethod === 'POST' && event.body) {
    try {
      const body = JSON.parse(event.body);
      checkin = body.checkin;
      checkout = body.checkout;
      guests = parseInt(body.guests) || 1;
    } catch (e) {
      // fallback to query parameters
    }
  }

  if (!checkin || !checkout) {
    checkin = event.queryStringParameters.checkin;
    checkout = event.queryStringParameters.checkout;
    guests = parseInt(event.queryStringParameters.guests) || 1;
  }

  if (!checkin || !checkout) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Missing checkin or checkout parameters' })
    };
  }

  // Calculate number of nights
  const checkinDate = new Date(checkin);
  const checkoutDate = new Date(checkout);
  const diffTime = checkoutDate - checkinDate;
  const nights = Math.max(1, Math.ceil(diffTime / (1000 * 60 * 60 * 24)));

  // Read environment variables
  const token = process.env.OTASYNC_TOKEN || '';
  const username = process.env.OTASYNC_USERNAME || '';
  const password = process.env.OTASYNC_PASSWORD || '';
  const propertyId = process.env.OTASYNC_PROPERTY_ID || '9889';

  const hasCredentials = token && username && password;

  // ROOM DETAILS (Mock descriptions matching Estar style & metadata)
  const roomDetails = {
    "31348": {
      name: "Clásica",
      sub: "Compacto, cálido, todo a la mano.",
      description: "Cama queen, escritorio frente a la ventana, cocina equipada con menaje completo y baño privado con ducha. La esencia de estar, en 28 m².",
      capacity: 2,
      beds: "1 queen",
      area: "28 m²",
      view: "Ciudad",
      basePrice: 195000,
      image: "assets/photos/tipo1/1.webp",
      gallery: [
        "assets/photos/tipo1/1.webp",
        "assets/photos/tipo1/2.webp",
        "assets/photos/tipo1/3.webp"
      ]
    },
    "31349": {
      name: "Selección",
      sub: "Un poco de afuera, adentro.",
      description: "Mismo plano del Clásica, ahora con balcón privado para tu café de la mañana. La luz natural cambia toda la sensación del espacio.",
      capacity: 2,
      beds: "1 queen",
      area: "32 m²",
      view: "Cordillera",
      basePrice: 235000,
      image: "assets/photos/tipo2/1.webp",
      gallery: [
        "assets/photos/tipo2/1.webp",
        "assets/photos/tipo2/2.webp",
        "assets/photos/tipo2/3.webp",
        "assets/photos/tipo2/4.webp"
      ]
    },
    "31350": {
      name: "Reserva",
      sub: "Zona de estar separada de la cama.",
      description: "Espacios definidos: dormitorio, sala con sofá y zona de trabajo. Smart TV de 55\", cocina abierta y un baño más amplio con ventana al exterior.",
      capacity: 2,
      beds: "1 king",
      area: "42 m²",
      view: "Ciudad",
      basePrice: 285000,
      image: "assets/photos/tipo3/1.webp",
      gallery: [
        "assets/photos/tipo3/1.webp",
        "assets/photos/tipo3/2.webp",
        "assets/photos/tipo3/3.webp"
      ]
    },
    "31351": {
      name: "Origen",
      sub: "Nuestra habitación más pedida.",
      description: "El apartaestudio Origen con balcón al frente — el lugar donde la mayoría de huéspedes pasa la tarde leyendo o trabajando con el rumor de la ciudad de fondo.",
      capacity: 2,
      beds: "1 king",
      area: "48 m²",
      view: "Cordillera",
      basePrice: 335000,
      image: "assets/photos/tipo4/1.webp",
      gallery: [
        "assets/photos/tipo4/1.webp",
        "assets/photos/tipo4/2.webp",
        "assets/photos/tipo4/3.webp",
        "assets/photos/tipo4/4.webp",
        "assets/photos/tipo4/5.webp"
      ]
    },
    "31352": {
      name: "Especial",
      sub: "Dos ambientes, una sola tarifa.",
      description: "Cama king + sofá cama doble en zona de estar separada. Cocina completa con nevera grande. Ideal para familias o tres amigos viajando juntos.",
      capacity: 4,
      beds: "1 king + sofá cama",
      area: "55 m²",
      view: "Cordillera",
      basePrice: 420000,
      image: "assets/photos/tipo5/1.webp",
      gallery: [
        "assets/photos/tipo5/1.webp",
        "assets/photos/tipo5/2.webp",
        "assets/photos/tipo5/3.webp",
        "assets/photos/tipo5/4.webp"
      ]
    }
  };

  // 1. MOCK DATA FALLBACK (If no credentials are set in Environment)
  if (!hasCredentials) {
    const mockRooms = Object.keys(roomDetails).map(id => {
      const details = roomDetails[id];
      const totalPrice = details.basePrice * nights;
      
      // Calculate daily price details
      const dailyPrices = [];
      for (let i = 0; i < nights; i++) {
        const d = new Date(checkinDate);
        d.setDate(d.getDate() + i);
        const dateStr = d.toISOString().split('T')[0];
        dailyPrices.push({
          date: dateStr,
          price: details.basePrice
        });
      }

      return {
        id_room_types: id,
        name: details.name,
        sub: details.sub,
        description: details.description,
        capacity: details.capacity,
        beds: details.beds,
        area: details.area,
        view: details.view,
        image: details.image,
        gallery: details.gallery,
        available: guests <= details.capacity,
        totalPrice: totalPrice,
        avgPrice: details.basePrice,
        nights: nights,
        dailyPrices: dailyPrices,
        currency: 'COP'
      };
    });

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        rooms: mockRooms,
        isMock: true,
        note: 'fallback: OTASYNC_USERNAME or OTASYNC_PASSWORD is missing in server configuration'
      })
    };
  }

  // 2. REAL OTASYNC INTEGRATION
  try {
    const pkey = await getSessionKey(token, username, password);

    // Call OTASync availability endpoint
    const response = await fetch('https://app.otasync.me/api/room/data/availableRoomTypesAndRooms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        key: pkey,
        id_properties: propertyId,
        dfrom: checkin,
        dto: checkout,
        token: token,
        real_only: 1,
        check_restrictions: 1,
        allow_overbookings: 0
      })
    });

    if (!response.ok) {
      throw new Error(`Kunas API returned status ${response.status}`);
    }

    const otaRooms = await response.json();
    
    if (!Array.isArray(otaRooms)) {
      throw new Error('Invalid response from Kunas API: expected an array of room types');
    }

    // Map Kunas response to Estar format
    const rooms = otaRooms.map(otaRoom => {
      const id = String(otaRoom.id_room_types);
      const details = roomDetails[id] || {
        name: otaRoom.name,
        sub: "Habitación de Hotel Estar",
        description: otaRoom.description || "Disfruta de tu estadía en Manizales.",
        capacity: parseInt(otaRoom.occupancy) || 2,
        beds: "1 cama",
        area: otaRoom.area ? `${otaRoom.area} m²` : "30 m²",
        view: "Ciudad",
        image: "assets/photos/tipo1/1.webp",
        gallery: ["assets/photos/tipo1/1.webp"]
      };

      // Check room availability (Kunas returns rooms available)
      const isAvailable = Array.isArray(otaRoom.rooms) && otaRoom.rooms.length > 0;

      // Extract daily prices
      const dailyPrices = [];
      let totalAmount = 0;
      let count = 0;

      if (otaRoom.prices) {
        Object.keys(otaRoom.prices).forEach(dateStr => {
          const price = parseFloat(otaRoom.prices[dateStr]) || 0;
          dailyPrices.push({ date: dateStr, price });
          totalAmount += price;
          count++;
        });
      }

      const avgPrice = count > 0 ? (totalAmount / count) : (details.basePrice || 195000);
      const totalPrice = count > 0 ? totalAmount : (avgPrice * nights);

      return {
        id_room_types: id,
        name: details.name,
        sub: details.sub,
        description: details.description,
        capacity: details.capacity,
        beds: details.beds,
        area: details.area,
        view: details.view,
        image: details.image,
        gallery: details.gallery,
        available: isAvailable && (guests <= details.capacity),
        totalPrice: totalPrice,
        avgPrice: avgPrice,
        nights: nights,
        dailyPrices: dailyPrices,
        currency: 'COP'
      };
    });

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ rooms, isMock: false })
    };

  } catch (error) {
    console.error('Kunas Integration Error:', error.message);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({
        error: 'Failed to retrieve availability',
        message: error.message
      })
    };
  }
};
