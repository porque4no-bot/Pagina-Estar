const { releaseHold } = require('./_otasync');

// Temporary admin function — remove after deleting test reservations
exports.handler = async (event) => {
  // Test reservation IDs created during debugging on 2026-06-07
  const TEST_IDS = [2915431, 2915519, 2915608];

  const results = {};
  for (const id of TEST_IDS) {
    try {
      await releaseHold(id);
      results[id] = 'deleted';
    } catch (e) {
      results[id] = `error: ${e.message}`;
    }
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ results }, null, 2)
  };
};
