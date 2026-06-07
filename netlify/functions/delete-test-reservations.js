const { releaseHold } = require('./_otasync');

// Temporary admin function — remove after deleting remaining test reservations
exports.handler = async (event) => {
  // Remaining test reservation IDs not caught in first cleanup
  const TEST_IDS = [2915257, 2915728];

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
