const test = require('node:test');
const assert = require('node:assert/strict');

const { _test } = require('../../netlify/functions/wompi-webhook');

function encodeReference(parts) {
  return Buffer.from(parts.join('|'), 'utf8').toString('base64url');
}

test('decodeReference round-trips all booking fields and optional flags', () => {
  const reference = encodeReference([
    '1', '260701', '260705', '3', '31348', 'Ana', 'Pérez',
    'ana@example.com', '+573001112233', '101001', 'ABC123', '1', '0'
  ]);

  assert.deepEqual(_test.decodeReference(reference), {
    bookingCode: 'ABC123',
    checkin: '2026-07-01',
    checkout: '2026-07-05',
    guestsCount: 3,
    roomTypeId: '31348',
    firstName: 'Ana',
    lastName: 'Pérez',
    email: 'ana@example.com',
    phone: '+573001112233',
    extrasMask: '101001',
    isColombian: true,
    isBusiness: false
  });
});

test('decodeReference rejects malformed, wrong-version and incomplete references', () => {
  assert.equal(_test.decodeReference(null), null);
  assert.equal(_test.decodeReference('%%%'), null);
  assert.equal(_test.decodeReference(encodeReference(['2', '260701', '260705'])), null);
  assert.equal(_test.decodeReference(encodeReference(['1', '260701', '260705', '2'])), null);
  assert.equal(_test.decodeReference(encodeReference(['garbage'])), null);
});

test('decodeReference preserves absent optional flags', () => {
  const reference = encodeReference([
    '1', '260701', '260705', '2', '31349', 'Luis', 'Díaz',
    'luis@example.com', '5551234', '000000', 'OLD123'
  ]);
  const decoded = _test.decodeReference(reference);

  assert.equal(decoded.isColombian, undefined);
  assert.equal(decoded.isBusiness, undefined);
});

test('sanitizePhone and escapeHtml protect outbound OTASync fields', () => {
  assert.equal(_test.sanitizePhone('<b>+57 (300) 111-22-33</b>'), '+57 300 1112233');
  assert.equal(_test.sanitizePhone('123456789012345678901234'), '12345678901234567890');
  assert.equal(
    _test.escapeHtml('<script>alert("x")</script> & \'quote\''),
    '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;quote&#39;'
  );
});

test('IVA flags take precedence over the legacy Colombian phone heuristic', () => {
  assert.equal(_test.mustChargeDirectBookingIva({
    isColombian: false,
    isBusiness: false,
    phone: '+573001112233'
  }), false);
  assert.equal(_test.mustChargeDirectBookingIva({ isColombian: true, isBusiness: false }), true);
  assert.equal(_test.mustChargeDirectBookingIva({ isColombian: false, isBusiness: true }), true);
});

test('legacy IVA heuristic recognizes all Colombian phone formats', () => {
  assert.equal(_test.mustChargeDirectBookingIva({ phone: '+57 300 111 2233' }), true);
  assert.equal(_test.mustChargeDirectBookingIva({ phone: '573001112233' }), true);
  assert.equal(_test.mustChargeDirectBookingIva({ phone: '3001112233' }), true);
  assert.equal(_test.mustChargeDirectBookingIva({ phone: '+12025550123' }), false);
});

test('directBookingPricing records IVA only in the PMS room amount when applicable', () => {
  assert.deepEqual(_test.directBookingPricing({
    isColombian: true,
    isBusiness: false
  }, 100_000), {
    mustPayIva: true,
    ivaAmount: 19_000,
    ivaNote: 'POR COBRAR EN ALOJAMIENTO (19000)',
    roomPrice: 119_000
  });

  assert.deepEqual(_test.directBookingPricing({
    isColombian: false,
    isBusiness: false
  }, 100_000), {
    mustPayIva: false,
    ivaAmount: 19_000,
    ivaNote: 'EXENTO PRELIMINAR - validar documento y motivo; si no corresponde, cobrar IVA (19000)',
    roomPrice: 100_000
  });
});

test('Wompi checksum uses signature.properties order and verifies timing-safe equality', () => {
  const secret = 'prod_events_OcHnIzeBl5socpwByQ4hA52Em3USQ93Z';
  const body = {
    timestamp: 1_530_291_411,
    signature: {
      properties: [
        'transaction.id',
        'transaction.status',
        'transaction.amount_in_cents'
      ]
    },
    data: {
      transaction: {
        id: '1234-1610641025-49201',
        status: 'APPROVED',
        amount_in_cents: 4_490_000
      }
    }
  };

  const checksum = _test.computeWompiChecksum(body, secret);
  assert.equal(checksum, '5a18ec5e8fdb7df463e9f94774cba8f583ba21bd04a09ceff2ea68a4bc0aefbe');
  assert.equal(_test.verifyWompiSignature(body, checksum, secret), true);
  assert.equal(_test.verifyWompiSignature(body, '0'.repeat(64), secret), false);

  const reordered = {
    ...body,
    signature: {
      properties: [...body.signature.properties].reverse()
    }
  };
  assert.notEqual(_test.computeWompiChecksum(reordered, secret), checksum);
});

test('Wompi signature verification rejects malformed and missing property paths', () => {
  const body = {
    timestamp: 123,
    signature: { properties: ['transaction.missing'] },
    data: { transaction: { id: 'value' } }
  };

  assert.throws(
    () => _test.computeWompiChecksum(body, 'secret'),
    /no encontrada/
  );
  assert.throws(
    () => _test.verifyWompiSignature(body, 'a'.repeat(64), 'secret'),
    /no encontrada/
  );
  assert.equal(_test.verifyWompiSignature(body, 'not-hex', 'secret'), false);

  body.signature.properties = ['transaction.__proto__.polluted'];
  assert.throws(
    () => _test.computeWompiChecksum(body, 'secret'),
    /no encontrada/
  );
});
