const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, emit, once, key, sleep } = require('./helpers');
const CARS = require('../src/cars.json');
const { buildQueue } = require('../src/party');
const { fullModel } = require('../public/scoring.js');

const fast = { party: { roundMs: 400, timeAttackMs: 300, graceMs: 300, awayMs: 150, sweepMs: 1000 } };

async function lobby(srv, n = 2, mode = 'worldwide') {
  const host = await srv.client();
  const created = await emit(host, 'party:create', { name: 'Host', mode, key: key('h') });
  assert.ok(created.ok);
  const guests = [];
  for (let i = 0; i < n - 1; i++) {
    const g = await srv.client();
    const j = await emit(g, 'party:join', { name: `G${i}`, code: created.code, key: key(`g${i}`) });
    assert.ok(j.ok, j.error);
    guests.push(g);
  }
  return { host, guests, code: created.code, created };
}

test('buildQueue: no repeats when pool >= 10, kit pool only kit cars', () => {
  for (let i = 0; i < 50; i++) {
    const q = buildQueue(CARS, 'worldwide');
    assert.equal(new Set(q).size, 10);
    assert.ok(q.every(c => !c.kit));
    const k = buildQueue(CARS, 'kit');
    assert.ok(k.every(c => c.kit));
    for (let j = 1; j < k.length; j++) assert.notEqual(k[j], k[j - 1], 'no back-to-back repeat');
  }
});

test('create/join, unknown code, duplicate names get suffixed', async () => {
  const srv = await startServer(fast);
  try {
    const { code } = await lobby(srv, 1);
    const bad = await emit(await srv.client(), 'party:join', { name: 'X', code: 'ZZZZZ' });
    assert.equal(bad.ok, false);
    const g = await srv.client();
    const j = await emit(g, 'party:join', { name: 'Host', code: code.toLowerCase(), key: key('dup') });
    assert.ok(j.ok);
    assert.deepEqual(j.players.map(p => p.name).sort(), ['Host', 'Host 2']);
  } finally { await srv.stop(); }
});

test('malformed payloads never crash the server', async () => {
  const srv = await startServer(fast);
  try {
    const c = await srv.client();
    for (const ev of ['party:create', 'party:join', 'party:guess', 'party:start', 'party:next', 'party:resume']) {
      for (const p of [null, 42, 'str', [], { name: { a: 1 }, code: ['x'], mode: {} }]) {
        const r = await emit(c, ev, p);
        assert.equal(typeof r.ok, 'boolean', `${ev} ${JSON.stringify(p)}`);
      }
    }
    assert.equal((await srv.api('GET', '/api/health')).status, 200);
  } finally { await srv.stop(); }
});

test('only host can start; guesses scored server-side; one guess per round', async () => {
  const srv = await startServer(fast);
  try {
    const { host, guests } = await lobby(srv, 2);
    assert.equal((await emit(guests[0], 'party:start', {})).ok, false);
    const roundP = once(guests[0], 'party:round');
    assert.ok((await emit(host, 'party:start', {})).ok);
    const round = await roundP;
    assert.equal(round.idx, 0);
    assert.ok(round.deadline > Date.now());
    assert.equal(round.make, undefined, 'answer is not leaked');
    const r1 = await emit(guests[0], 'party:guess', { make: 'definitely wrong', idx: 0 });
    assert.ok(r1.ok);
    assert.equal(r1.pts, 0);
    const r2 = await emit(guests[0], 'party:guess', { make: 'again' });
    assert.equal(r2.ok, false);
  } finally { await srv.stop(); }
});

test('round reveals when everyone connected has answered', async () => {
  const srv = await startServer({ party: { ...fast.party, roundMs: 10_000 } });
  try {
    const { host, guests } = await lobby(srv, 2);
    await emit(host, 'party:start', {});
    const rev = once(host, 'party:reveal');
    await emit(host, 'party:guess', { make: 'x' });
    await emit(guests[0], 'party:guess', { make: 'y' });
    const r = await rev;
    assert.ok(r.make && r.model && r.year);
    assert.equal(r.standings.length, 2);
  } finally { await srv.stop(); }
});

test('server timer reveals the round if someone never answers', async () => {
  const srv = await startServer(fast);
  try {
    const { host } = await lobby(srv, 2);
    await emit(host, 'party:start', {});
    await emit(host, 'party:guess', { make: 'x' });
    const r = await once(host, 'party:reveal', 2000);
    assert.equal(r.idx, 0);
  } finally { await srv.stop(); }
});

test('kit party scores tuner names', async () => {
  const srv = await startServer({ party: { ...fast.party, roundMs: 10_000 } });
  try {
    const { host } = await lobby(srv, 1, 'kit');
    const roundP = once(host, 'party:round');
    await emit(host, 'party:start', {});
    await roundP;
    const revP = once(host, 'party:reveal');
    const r = await emit(host, 'party:guess', { kit: 'nope' });
    assert.equal(r.pts, 0);
    const rev = await revP;
    assert.ok(rev.kit, 'reveal includes the kit');
    // Round 2: answer correctly using the dataset and expect full kit points.
    const round2 = once(host, 'party:round');
    await emit(host, 'party:next', { idx: 0 });
    const { img } = await round2;
    const car = CARS.find(c => c.img === img && c.kit);
    const good = await emit(host, 'party:guess', { kit: car.kit, make: car.make, model: fullModel(car) });
    assert.equal(good.pts, 10);
  } finally { await srv.stop(); }
});

test('host leaving hands host to next player; next/final flow works', async () => {
  const srv = await startServer({ party: { ...fast.party, roundMs: 10_000 } });
  try {
    const { host, guests } = await lobby(srv, 2);
    const g = guests[0];
    const playersP = once(g, 'party:players');
    await emit(host, 'party:leave', {});
    const { players } = await playersP;
    assert.equal(players.length, 1);
    assert.equal(players[0].host, true);
    // New host can now run a whole game alone.
    await emit(g, 'party:start', {});
    for (let i = 0; i < 10; i++) {
      const rev = once(g, 'party:reveal');
      await emit(g, 'party:guess', { make: 'x' });
      await rev;
      const nxt = i < 9 ? once(g, 'party:round') : once(g, 'party:final');
      assert.ok((await emit(g, 'party:next', { idx: i })).ok);
      await nxt;
    }
    // Stale "next" from a double-click is rejected.
    assert.equal((await emit(g, 'party:next', { idx: 9 })).ok, false);
  } finally { await srv.stop(); }
});

test('disconnect keeps the seat; resume restores score and round', async () => {
  const srv = await startServer({ party: { ...fast.party, roundMs: 10_000, graceMs: 2000, awayMs: 600 } });
  try {
    const { host, guests, code } = await lobby(srv, 2);
    await emit(host, 'party:start', {});
    const dropped = once(host, 'party:players');
    const t0 = Date.now();
    guests[0].close();
    const { players } = await dropped;
    assert.equal(players.find(p => p.name === 'G0').connected, false);
    // Host answering doesn't end the round instantly (the guest may just be refreshing),
    // but after the short away window the round stops waiting for them.
    const rev = once(host, 'party:reveal', 3000);
    await emit(host, 'party:guess', { make: 'y' });
    await rev;
    assert.ok(Date.now() - t0 >= 550, `waited for the away window (${Date.now() - t0}ms)`);
    const back = await srv.client();
    const res = await emit(back, 'party:resume', { code, key: key('g0') });
    assert.ok(res.ok, res.error);
    assert.equal(res.state, 'reveal');
    assert.ok(res.reveal && res.reveal.make);
    assert.equal(res.players.find(p => p.id === res.youId).name, 'G0');
  } finally { await srv.stop(); }
});

test('seat is released after the grace period; empty rooms are destroyed', async () => {
  const srv = await startServer(fast);
  try {
    const { host, guests, code } = await lobby(srv, 2);
    guests[0].close();
    await sleep(600);
    const back = await srv.client();
    assert.equal((await emit(back, 'party:resume', { code, key: key('g0') })).ok, false);
    host.close();
    await sleep(600);
    const late = await srv.client();
    assert.equal((await emit(late, 'party:join', { name: 'Z', code })).ok, false, 'room is gone');
  } finally { await srv.stop(); }
});

test('joining another party leaves the first one (no ghost players)', async () => {
  const srv = await startServer(fast);
  try {
    const a = await lobby(srv, 1);
    const b = await lobby(srv, 1);
    const roamer = await srv.client();
    await emit(roamer, 'party:join', { name: 'R', code: a.code, key: key('r') });
    const left = once(a.host, 'party:players');
    await emit(roamer, 'party:join', { name: 'R', code: b.code, key: key('r') });
    const { players } = await left;
    assert.deepEqual(players.map(p => p.name), ['Host']);
  } finally { await srv.stop(); }
});

test('cannot join a game in progress', async () => {
  const srv = await startServer({ party: { ...fast.party, roundMs: 10_000 } });
  try {
    const { host, code } = await lobby(srv, 1);
    await emit(host, 'party:start', {});
    const late = await srv.client();
    const r = await emit(late, 'party:join', { name: 'Late', code });
    assert.equal(r.ok, false);
  } finally { await srv.stop(); }
});

test('scores stay hidden until the reveal', async () => {
  const srv = await startServer({ party: { ...fast.party, roundMs: 10_000 } });
  try {
    const { host, guests } = await lobby(srv, 2);
    const roundP = once(host, 'party:round');
    await emit(host, 'party:start', {});
    const { img } = await roundP;
    const car = CARS.find(c => c.img === img && !c.kit);
    const prog = once(guests[0], 'party:progress');
    const r = await emit(host, 'party:guess', { make: car.make, model: fullModel(car), year: String(car.year) });
    assert.equal(r.pts, 10);
    const p = await prog;
    const h = p.players.find(x => x.name === 'Host');
    assert.equal(h.score, 0, 'score not visible mid-round');
    assert.equal(h.lastPts, null);
    const rev = once(guests[0], 'party:reveal');
    await emit(guests[0], 'party:guess', { make: 'x' });
    const d = await rev;
    assert.equal(d.standings.find(x => x.name === 'Host').score, 10);
    assert.equal(d.standings.find(x => x.name === 'Host').lastPts, 10);
  } finally { await srv.stop(); }
});
