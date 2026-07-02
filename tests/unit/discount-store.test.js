/* Unit tests for _discount-store: discount-code definitions, validity rules,
 * atomic usage counting (CAS), one-use-per-email and idempotent consumption.
 * No real Blobs nor network — an in-memory fake store is injected via deps. */

const test = require('node:test');
const assert = require('node:assert/strict');

const store = require('../../netlify/functions/_discount-store');

/* ── In-memory fake of the @netlify/blobs store, supporting the conditional
   (CAS) writes consumeDiscountUse relies on (getWithMetadata + onlyIfMatch /
   onlyIfNew). One bucket per store name; getStore returns the right bucket. */
function makeBlobs() {
  const buckets = new Map();
  function bucketFor(name) {
    if (!buckets.has(name)) buckets.set(name, new Map());
    return buckets.get(name);
  }
  let etagSeq = 1;
  function getStore(opts) {
    const b = bucketFor(opts.name);
    return {
      async get(key) { const v = b.get(key); return v ? v.data : null; },
      async getWithMetadata(key) {
        const v = b.get(key);
        return v ? { data: v.data, etag: v.etag } : null;
      },
      async set(key, data, options) {
        const cur = b.get(key);
        if (options && options.onlyIfMatch) {
          if (!cur || cur.etag !== options.onlyIfMatch) return { modified: false };
        }
        if (options && options.onlyIfNew) {
          if (cur) return { modified: false };
        }
        b.set(key, { data, etag: 'e' + (etagSeq++) });
        return { modified: true };
      },
      async delete(key) { b.delete(key); },
      async list() { return { blobs: [...b.keys()].map(k => ({ key: k })) }; }
    };
  }
  return { getStore, buckets };
}

function deps() { return { getStore: makeBlobs().getStore }; }

/* A deps object sharing ONE blobs instance across calls (so a saved code can be
   re-read by the same test). */
function sharedDeps() {
  const blobs = makeBlobs();
  return { getStore: blobs.getStore };
}

/* ── normalizeCode ── */
test('normalizeCode upper-cases, strips junk and trims length', () => {
  assert.equal(store.normalizeCode('  bien venido!15  '), 'BIENVENIDO15');
  assert.equal(store.normalizeCode('promo-2026_x'), 'PROMO-2026_X');
  assert.equal(store.normalizeCode('a'.repeat(60)).length, 40);
});

/* ── buildDefinition ── */
test('buildDefinition: valid percent code', () => {
  const { def, error } = store.buildDefinition({ code: 'WELCOME15', type: 'percent', value: 15, active: true }, { now: '2026-06-01T00:00:00Z', actor: 'me' });
  assert.equal(error, undefined);
  assert.equal(def.code, 'WELCOME15');
  assert.equal(def.type, 'percent');
  assert.equal(def.value, 15);
  assert.equal(def.active, true);
  assert.equal(def.onePerEmail, true);
  assert.equal(def.notCombinable, true);
  assert.equal(def.audit.length, 1);
  assert.equal(def.audit[0].action, 'create');
});

test('buildDefinition rejects bad type, value and percent over 100', () => {
  assert.ok(store.buildDefinition({ code: 'X1', type: 'bogus', value: 10 }).error);
  assert.ok(store.buildDefinition({ code: 'X1', type: 'percent', value: 0 }).error);
  assert.ok(store.buildDefinition({ code: 'X1', type: 'percent', value: 150 }).error);
  assert.ok(store.buildDefinition({ code: 'AB', type: 'percent', value: 10 }).error); /* code too short */
});

test('buildDefinition rejects validFrom after validTo', () => {
  const r = store.buildDefinition({ code: 'RANGE', type: 'fixed', value: 100, validFrom: '2026-08-01', validTo: '2026-07-01' });
  assert.ok(r.error);
});

test('buildDefinition keeps createdAt/createdBy on update', () => {
  const first = store.buildDefinition({ code: 'KEEP', type: 'percent', value: 10 }, { now: '2026-01-01T00:00:00Z', actor: 'a' }).def;
  const second = store.buildDefinition({ code: 'KEEP', type: 'percent', value: 20 }, { now: '2026-02-01T00:00:00Z', actor: 'b', existing: first }).def;
  assert.equal(second.createdAt, '2026-01-01T00:00:00Z');
  assert.equal(second.createdBy, 'a');
  assert.equal(second.updatedBy, 'b');
  assert.equal(second.value, 20);
  assert.equal(second.audit[second.audit.length - 1].action, 'update');
});

/* ── discountCentsFor ── */
test('discountCentsFor: percent and fixed, capped at subtotal', () => {
  assert.equal(store.discountCentsFor({ type: 'percent', value: 10 }, 100000), 10000);
  assert.equal(store.discountCentsFor({ type: 'fixed', value: 500 }, 100000), 50000); /* 500 COP -> 50000 cents */
  /* fixed larger than subtotal is capped */
  assert.equal(store.discountCentsFor({ type: 'fixed', value: 5000 }, 100000), 100000);
  assert.equal(store.discountCentsFor(null, 100000), 0);
  assert.equal(store.discountCentsFor({ type: 'percent', value: 10 }, 0), 0);
});

/* ── checkRules ── */
test('checkRules: inactive code is rejected', () => {
  const def = store.buildDefinition({ code: 'OFF', type: 'percent', value: 10, active: false }).def;
  assert.deepEqual(store.checkRules(def, { now: '2026-06-01' }), { valid: false, reason: 'inactive' });
});

test('checkRules: not-found when def is null', () => {
  assert.equal(store.checkRules(null, {}).reason, 'not_found');
});

test('checkRules: validity window', () => {
  const def = store.buildDefinition({ code: 'WIN', type: 'percent', value: 10, active: true, validFrom: '2026-07-01', validTo: '2026-07-31' }).def;
  assert.equal(store.checkRules(def, { now: '2026-06-15' }).reason, 'not_yet_valid');
  assert.equal(store.checkRules(def, { now: '2026-08-15' }).reason, 'expired');
  assert.equal(store.checkRules(def, { now: '2026-07-15' }).valid, true);
});

test('checkRules: minimum nights', () => {
  const def = store.buildDefinition({ code: 'STAY', type: 'percent', value: 10, active: true, minNights: 3 }).def;
  assert.equal(store.checkRules(def, { now: '2026-06-15', nights: 2 }).reason, 'min_nights');
  assert.equal(store.checkRules(def, { now: '2026-06-15', nights: 3 }).valid, true);
});

test('checkRules: room eligibility', () => {
  const def = store.buildDefinition({ code: 'ROOM', type: 'percent', value: 10, active: true, roomTypeIds: ['31348', '31349'] }).def;
  assert.equal(store.checkRules(def, { now: '2026-06-15', roomTypeId: '31350' }).reason, 'room_not_eligible');
  assert.equal(store.checkRules(def, { now: '2026-06-15', roomTypeId: '31348' }).valid, true);
});

test('checkRules: blackout dates block stays overlapping excluded nights', () => {
  const def = store.buildDefinition({
    code: 'BLK', type: 'percent', value: 10, active: true,
    blackoutDates: [{ from: '2027-01-04', to: '2027-01-10' }] /* Feria de Manizales */
  }).def;
  /* Stay 2027-01-05 -> 2027-01-07 overlaps the blackout */
  assert.equal(store.checkRules(def, { now: '2026-12-01', checkin: '2027-01-05', checkout: '2027-01-07' }).reason, 'blackout');
  /* Stay entirely before the blackout is fine */
  assert.equal(store.checkRules(def, { now: '2026-12-01', checkin: '2026-12-20', checkout: '2026-12-22' }).valid, true);
  /* Check-out lands on the first blackout day but its last NIGHT (the 3rd) is before it -> allowed */
  assert.equal(store.checkRules(def, { now: '2026-12-01', checkin: '2027-01-02', checkout: '2027-01-04' }).valid, true);
});

test('stayHitsBlackout supports single-day string entries', () => {
  assert.equal(store.stayHitsBlackout(['2026-12-25'], '2026-12-24', '2026-12-26'), true);
  assert.equal(store.stayHitsBlackout(['2026-12-25'], '2026-12-26', '2026-12-28'), false);
});

test('enumerateNights returns [checkin, checkout)', () => {
  assert.deepEqual(store.enumerateNights('2026-07-01', '2026-07-04'), ['2026-07-01', '2026-07-02', '2026-07-03']);
});

/* ── verifyDiscountCode (full: rules + usage + per-email), injected store ── */
test('verifyDiscountCode: valid code returns discountCents on a subtotal', async () => {
  const d = sharedDeps();
  await store.saveCode(store.buildDefinition({ code: 'GO10', type: 'percent', value: 10, active: true }).def, d);
  const r = await store.verifyDiscountCode({ code: 'GO10', subtotalCents: 200000, now: '2026-06-15' }, d);
  assert.equal(r.valid, true);
  assert.equal(r.discountCents, 20000);
});

test('verifyDiscountCode: unknown code is not_found (does not throw without Blobs)', async () => {
  const d = sharedDeps();
  const r = await store.verifyDiscountCode({ code: 'NOPE', subtotalCents: 200000 }, d);
  assert.equal(r.valid, false);
  assert.equal(r.reason, 'not_found');
  assert.equal(r.discountCents, 0);
});

test('verifyDiscountCode: exhausted when usage reaches maxUses', async () => {
  const d = sharedDeps();
  await store.saveCode(store.buildDefinition({ code: 'CAP1', type: 'percent', value: 10, active: true, maxUses: 1 }).def, d);
  /* consume once */
  const c1 = await store.consumeDiscountUse('CAP1', { email: 'a@b.co', bookingCode: 'EST-1', maxUses: 1 }, d);
  assert.equal(c1.ok, true);
  const r = await store.verifyDiscountCode({ code: 'CAP1', subtotalCents: 100000, now: '2026-06-15' }, d);
  assert.equal(r.valid, false);
  assert.equal(r.reason, 'exhausted');
});

test('verifyDiscountCode: one-use-per-email blocks the same email twice', async () => {
  const d = sharedDeps();
  await store.saveCode(store.buildDefinition({ code: 'ONCE', type: 'percent', value: 10, active: true, onePerEmail: true }).def, d);
  await store.consumeDiscountUse('ONCE', { email: 'Repeat@B.co', bookingCode: 'EST-9' }, d);
  const sameEmail = await store.verifyDiscountCode({ code: 'ONCE', email: 'repeat@b.co', subtotalCents: 100000, now: '2026-06-15' }, d);
  assert.equal(sameEmail.valid, false);
  assert.equal(sameEmail.reason, 'already_used');
  const otherEmail = await store.verifyDiscountCode({ code: 'ONCE', email: 'fresh@b.co', subtotalCents: 100000, now: '2026-06-15' }, d);
  assert.equal(otherEmail.valid, true);
});

/* ── consumeDiscountUse: atomic count + idempotency ── */
test('consumeDiscountUse increments the count and is idempotent per bookingCode', async () => {
  const d = sharedDeps();
  await store.saveCode(store.buildDefinition({ code: 'CNT', type: 'percent', value: 10, active: true }).def, d);
  const a = await store.consumeDiscountUse('CNT', { email: 'x@y.co', bookingCode: 'EST-A' }, d);
  assert.equal(a.ok, true);
  assert.equal(a.count, 1);
  /* same booking again -> alreadyCounted, count unchanged */
  const again = await store.consumeDiscountUse('CNT', { email: 'x@y.co', bookingCode: 'EST-A' }, d);
  assert.equal(again.alreadyCounted, true);
  assert.equal(await store.getUsageCount('CNT', d), 1);
  /* different booking -> count goes to 2 */
  const b = await store.consumeDiscountUse('CNT', { email: 'z@y.co', bookingCode: 'EST-B' }, d);
  assert.equal(b.count, 2);
});

test('consumeDiscountUse respects maxUses under repeated calls', async () => {
  const d = sharedDeps();
  await store.saveCode(store.buildDefinition({ code: 'LIM', type: 'percent', value: 10, active: true, maxUses: 2 }).def, d);
  const r1 = await store.consumeDiscountUse('LIM', { bookingCode: 'b1' }, d);
  const r2 = await store.consumeDiscountUse('LIM', { bookingCode: 'b2' }, d);
  const r3 = await store.consumeDiscountUse('LIM', { bookingCode: 'b3' }, d);
  assert.equal(r1.ok, true);
  assert.equal(r2.ok, true);
  assert.equal(r3.ok, false);
  assert.equal(r3.reason, 'exhausted');
  assert.equal(await store.getUsageCount('LIM', d), 2);
});

test('consumeDiscountUse reads maxUses from the definition when not passed', async () => {
  const d = sharedDeps();
  await store.saveCode(store.buildDefinition({ code: 'AUTO', type: 'percent', value: 10, active: true, maxUses: 1 }).def, d);
  const r1 = await store.consumeDiscountUse('AUTO', { bookingCode: 'b1' }, d); /* no maxUses arg */
  const r2 = await store.consumeDiscountUse('AUTO', { bookingCode: 'b2' }, d);
  assert.equal(r1.ok, true);
  assert.equal(r2.ok, false);
  assert.equal(r2.reason, 'exhausted');
});

test('restoreDiscountUse decrements the count and frees the email', async () => {
  const d = sharedDeps();
  await store.saveCode(store.buildDefinition({ code: 'REST', type: 'percent', value: 10, active: true, maxUses: 1, onePerEmail: true }).def, d);
  await store.consumeDiscountUse('REST', { email: 'cancel@me.co', bookingCode: 'EST-C' }, d);
  assert.equal(await store.getUsageCount('REST', d), 1);
  await store.restoreDiscountUse('REST', { email: 'cancel@me.co', bookingCode: 'EST-C' }, d);
  assert.equal(await store.getUsageCount('REST', d), 0);
  /* email freed and cup available again -> valid again */
  const r = await store.verifyDiscountCode({ code: 'REST', email: 'cancel@me.co', subtotalCents: 100000, now: '2026-06-15' }, d);
  assert.equal(r.valid, true);
});

test('concurrent consumeDiscountUse for distinct bookings never exceeds maxUses', async () => {
  const d = sharedDeps();
  await store.saveCode(store.buildDefinition({ code: 'RACE', type: 'percent', value: 10, active: true, maxUses: 3 }).def, d);
  const results = await Promise.all(
    Array.from({ length: 8 }, (_, i) => store.consumeDiscountUse('RACE', { bookingCode: 'r' + i, maxUses: 3 }, d))
  );
  const ok = results.filter(r => r.ok).length;
  assert.equal(ok, 3);
  assert.equal(await store.getUsageCount('RACE', d), 3);
});

/* ── loadCode / saveCode / listCodes mock-safety ── */
test('loadCode returns null without Blobs (mock-safe)', async () => {
  /* deps with a getStore that throws -> treated as "no Blobs" */
  const throwing = { getStore: () => { throw new Error('no blobs'); } };
  assert.equal(await store.loadCode('ANY', throwing), null);
});

test('listCodes returns saved codes', async () => {
  const d = sharedDeps();
  await store.saveCode(store.buildDefinition({ code: 'LST1', type: 'percent', value: 10 }).def, d);
  await store.saveCode(store.buildDefinition({ code: 'LST2', type: 'fixed', value: 50 }).def, d);
  const codes = await store.listCodes(d);
  const names = codes.map(c => c.code).sort();
  assert.deepEqual(names, ['LST1', 'LST2']);
});
