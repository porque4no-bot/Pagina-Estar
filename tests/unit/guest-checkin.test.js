const assert = require('node:assert/strict');
const test = require('node:test');

const { _test } = require('../../netlify/functions/guest-checkin');

test('Azure Colombian national ID docType maps to CC and Colombia without CountryRegion', () => {
  const parsed = _test.parseAzureResult({
    analyzeResult: {
      documents: [
        {
          docType: 'idDocument.nationalIdentityCard',
          fields: {
            FirstName: { valueString: 'Andrea', confidence: 0.98 },
            LastName: { valueString: 'Restrepo', confidence: 0.97 },
            DocumentNumber: { valueString: '1234567890', confidence: 0.99 },
            DateOfBirth: { valueDate: '1992-05-16', confidence: 0.96 }
          }
        }
      ]
    }
  });

  assert.equal(parsed.fields.documentType, 'CC');
  assert.equal(parsed.fields.nationality, 'Colombia');
});
