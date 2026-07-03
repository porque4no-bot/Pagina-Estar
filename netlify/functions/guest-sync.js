const crypto = require('crypto');
const { adminEmail, sendEmail } = require('./_email');
const {
  cleanText,
  guestStore,
  isDemoMode,
  json,
  parseJsonBody,
  protectRecord
} = require('./_guest-app');

const ALLOWED_TYPES = new Set([
  'guest_checkin',
  'order',
  'contract',
  'reservation_change',
  'support'
]);

function bearerToken(event) {
  const headers = event.headers || {};
  const authorization = headers.authorization || headers.Authorization || '';
  const match = String(authorization).match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : '';
}

function validSecret(received) {
  const expected = process.env.GUEST_APP_SYNC_WEBHOOK_SECRET || '';
  if (!expected || !received) return false;
  const receivedBuffer = Buffer.from(String(received));
  const expectedBuffer = Buffer.from(String(expected));
  return receivedBuffer.length === expectedBuffer.length &&
    crypto.timingSafeEqual(receivedBuffer, expectedBuffer);
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character]);
}

function eventSummary(record) {
  if (record.type === 'guest_checkin') {
    return 'El huésped completó el pre check-in y el expediente quedó listo para revisión.';
  }
  if (record.type === 'order') {
    const names = (record.items || []).map(item => `${item.quantity} × ${item.name}`).join(', ');
    return `Nuevo pedido por ${record.total || 0} COP: ${names || 'sin detalle'}.`;
  }
  if (record.type === 'contract') {
    return `Contrato aceptado electrónicamente por ${record.signedName || record.guestName || 'el huésped'}.`;
  }
  if (record.type === 'reservation_change') {
    return `Solicitud de reserva: ${record.requestKind || 'otro'}. ${record.message || ''}`;
  }
  return `Mensaje de concierge: ${record.message || ''}`;
}

function notificationHtml(record, syncId) {
  return `<!doctype html>
  <html lang="es">
    <body style="font-family:Arial,sans-serif;color:#28292b;line-height:1.6">
      <h2 style="margin-bottom:8px">Nueva actividad en la guest app</h2>
      <p><strong>Tipo:</strong> ${escapeHtml(record.type)}</p>
      <p><strong>Reserva:</strong> ${escapeHtml(record.bookingCode)}</p>
      <p><strong>Huésped:</strong> ${escapeHtml(record.guestName || (record.guest && `${record.guest.firstName || ''} ${record.guest.lastName || ''}`))}</p>
      <p><strong>Resumen:</strong> ${escapeHtml(eventSummary(record))}</p>
      <p><strong>Referencia interna:</strong> ${escapeHtml(syncId)}</p>
      <p style="color:#6b6c6f;font-size:12px">El evento completo está cifrado en Netlify Blobs, almacén guest-sync-queue.</p>
    </body>
  </html>`;
}

async function persist(record) {
  try {
    await guestStore('guest-sync-queue').setJSON(record.syncId, protectRecord(record));
    return true;
  } catch (error) {
    if (isDemoMode()) {
      console.warn('[guest-sync] Local demo did not persist the event:', error.message);
      return false;
    }
    throw error;
  }
}

exports.handler = async event => {
  if (event.httpMethod === 'OPTIONS') {
    return json(200, {});
  }
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method not allowed' });
  }
  if (!validSecret(bearerToken(event))) {
    return json(401, { error: 'Unauthorized' });
  }

  try {
    const incoming = parseJsonBody(event, 150000);
    const type = cleanText(incoming.type, 60);
    if (!ALLOWED_TYPES.has(type)) {
      return json(400, { error: 'Unsupported guest event type' });
    }

    const bookingCode = cleanText(incoming.bookingCode, 80);
    if (!bookingCode) {
      return json(400, { error: 'Missing bookingCode' });
    }

    const syncId = `SYNC-${Date.now()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    const record = {
      ...incoming,
      type,
      bookingCode,
      syncId,
      syncStatus: 'queued',
      receivedAt: new Date().toISOString()
    };

    const persisted = await persist(record);
    let notified = false;
    try {
      const notification = await sendEmail({
        to: adminEmail(),
        subject: `Guest app: ${type} · reserva ${bookingCode}`,
        html: notificationHtml(record, syncId)
      });
      notified = Boolean(notification && notification.sent);
    } catch (error) {
      console.error('[guest-sync] Notification failed:', error.message);
    }

    return json(202, {
      accepted: true,
      syncId,
      persisted,
      notified,
      otasyncStatus: 'pending_adapter'
    });
  } catch (error) {
    console.error('[guest-sync]', error.message);
    return json(error.statusCode || 500, {
      error: error.statusCode ? error.message : 'Guest sync could not process the event'
    });
  }
};
