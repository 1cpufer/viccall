/*
 * Speed on the reveal: the solo "answered in 4.2s · fastest today" line and
 * the party podium. Shown only; scoring must not change with speed.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, emit, once, key, sleep } = require('./helpers');
const { createSpeed, MIN_RECORD_MS } = require('../src/speed');
const { bestAnswer, buildIndex, MAX } = require('../public/scoring.js');
const IDX = buildIndex(require('../src/cars.json'));

test('fastest today: first, slower, faster, wrong, too fast to be real, and a new day', () => {
  let clock = new Date('2026-10-26T15:00:00Z');
  const sp = createSpeed({ tz: 'America/Chicago', now: () => clock });
  assert.deepEqual(sp.answer('a', 4200, true), { ms: 4200, best: 4200, isBest: true, first: true });
  assert.deepEqual(sp.answer('a', 6100, true), { ms: 6100, best: 4200, isBest: false, first: false });
  assert.deepEqual(sp.answer('a', 3000, true), { ms: 3000, best: 3000, isBest: true, first: false }, 'a faster answer takes it');
  assert.deepEqual(sp.answer('a', 1500, false), { ms: 1500, best: 3000, isBest: false, first: false }, 'a wrong answer never counts');
  assert.equal(sp.answer('a', MIN_RECORD_MS - 1, true).isBest, false, 'under a second is not kept as a record');
  assert.equal(sp.fastest('a'), 3000);
  assert.deepEqual(sp.answer('b', 9000, false), { ms: 9000, best: null, isBest: false, first: false });
  // Midnight in Chicago (05:00 UTC in October): a fresh day.
  clock = new Date('2026-10-27T05:30:00Z');
  assert.equal(sp.fastest('a'), null);
  assert.equal(sp.answer('a', 8000, true).first, true);
});

// Open round 0 of a free game on a given car, as if the photo appeared `ago` ms ago.
async function openRound(srv, car, ago) {
  const st = await srv.api('POST', '/api/solo/start', { kind: 'free' });
  const s = srv.sessions.get(st.body.sessionId);
  if (car) s.queue[0] = car;
  assert.equal((await srv.api('POST', '/api/solo/round', { sessionId: s.id, idx: 0 })).status, 200);
  s.openedAt -= ago;
  s.servedAt -= ago;
  return s;
}
const right = car => ({ car: bestAnswer(car, IDX), year: String(car.year) });

test('solo reveal: how fast, and today’s fastest on that car; points unchanged', async () => {
  const srv = await startServer();
  try {
    const a = await openRound(srv, null, 4000);
    const car = a.queue[0];
    const first = (await srv.api('POST', '/api/solo/guess', { sessionId: a.id, idx: 0, ...right(car) })).body;
    assert.ok(first.speed.ms >= 4000 && first.speed.ms < 5000, `ms ${first.speed.ms}`);
    assert.equal(first.speed.isBest, true);
    assert.equal(first.speed.first, true);

    const b = await openRound(srv, car, 7000);
    const slower = (await srv.api('POST', '/api/solo/guess', { sessionId: b.id, idx: 0, ...right(car) })).body;
    assert.equal(slower.speed.isBest, false);
    assert.equal(slower.speed.best, first.speed.ms, 'shows the faster time');
    assert.equal(slower.pts, first.pts, 'same points however long it took');
    assert.equal(slower.pts, MAX);

    const c = await openRound(srv, car, 2000);
    const wrong = (await srv.api('POST', '/api/solo/guess', { sessionId: c.id, idx: 0, make: 'Nope', model: 'Nope' })).body;
    assert.equal(wrong.speed.isBest, false, 'a quick wrong answer is no record');
    assert.equal(wrong.speed.best, first.speed.ms);

    const d = await openRound(srv, car, 1000);
    const skipped = (await srv.api('POST', '/api/solo/guess', { sessionId: d.id, idx: 0, photoFailed: true })).body;
    assert.equal(skipped.speed, null, 'no time for a photo that never loaded');
    const e = await openRound(srv, car, 1000);
    const timedOut = (await srv.api('POST', '/api/solo/guess', { sessionId: e.id, idx: 0, timedOut: true })).body;
    assert.equal(timedOut.speed, null, 'no time when the clock ran out');
    assert.equal(srv.speed.fastest(car.id), first.speed.ms);
  } finally { await srv.stop(); }
});

test('party reveal: podium of the quickest to name the car; slow and wrong answers score as before', async () => {
  const srv = await startServer({ party: { roundMs: 10_000, competitiveMs: 10_000, graceMs: 300, awayMs: 150, sweepMs: 1000 } });
  try {
    const host = await srv.client();
    const { code } = await emit(host, 'party:create', { name: 'Host', playlist: 'world', key: key('h') });
    const g1 = await srv.client();
    const g2 = await srv.client();
    await emit(g1, 'party:join', { name: 'Ana', code, key: key('a') });
    await emit(g2, 'party:join', { name: 'Ben', code, key: key('b') });
    await emit(host, 'party:start', {});
    const room = srv.party.rooms.get(code);
    const car = room.queue[room.curIdx];
    const rev = once(host, 'party:reveal');

    const ana = await emit(g1, 'party:guess', right(car));
    await sleep(60);
    const ben = await emit(g2, 'party:guess', { make: 'Nope', model: 'Nope' });
    await sleep(60);
    const hostR = await emit(host, 'party:guess', right(car));
    assert.ok(ana.ms >= 0 && hostR.ms > ana.ms && ben.ms > ana.ms, 'each answer gets its time');
    assert.equal(ana.pts, hostR.pts, 'first and slower correct answers score the same');

    const r = await rev;
    assert.deepEqual(r.podium.map(p => p.name), ['Ana', 'Host'], 'quickest first; the wrong answer is left off');
    assert.equal(r.podium[0].ms, ana.ms);
    assert.ok(r.podium.every(p => p.id && typeof p.ms === 'number'));

    // A player rejoining during the reveal sees their own time again.
    const snap = await emit(g1, 'party:resume', { code, key: key('a') });
    assert.equal(snap.ok, true);
    assert.equal(snap.round.you.ms, ana.ms);
    assert.deepEqual(snap.reveal.podium.map(p => p.name), ['Ana', 'Host']);
  } finally { await srv.stop(); }
});

test('party: the podium starts empty each round', async () => {
  const srv = await startServer({ party: { roundMs: 300, competitiveMs: 300, graceMs: 300, awayMs: 150, sweepMs: 1000 } });
  try {
    const host = await srv.client();
    const { code } = await emit(host, 'party:create', { name: 'Host', playlist: 'world', key: key('h2') });
    await emit(host, 'party:start', {});
    const room = srv.party.rooms.get(code);
    const first = once(host, 'party:reveal');
    await emit(host, 'party:guess', right(room.queue[room.curIdx]));
    assert.equal((await first).podium.length, 1);
    const round2 = once(host, 'party:round');
    await emit(host, 'party:next', {});
    await round2;
    const second = await once(host, 'party:reveal', 2000); // nobody answers; the timer reveals
    assert.deepEqual(second.podium, []);
  } finally { await srv.stop(); }
});
