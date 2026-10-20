const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, key } = require('./helpers');
const { fullModel } = require('../public/scoring.js');
const CARS = require('../src/cars.json');

// Plays a whole session with perfect answers, reading the answers off the server (tests only).
async function play(srv, req, { answer = 'perfect', player } = {}) {
  const start = await srv.api('POST', '/api/solo/start', { ...req, player });
  assert.equal(start.status, 200, JSON.stringify(start.body));
  const { sessionId, rounds, roundKind } = start.body;
  const s = srv.sessions.get(sessionId);
  let last;
  for (let i = 0; rounds ? i < rounds : !(last && last.body.done); i++) {
    const r = await srv.api('POST', '/api/solo/round', { sessionId, idx: i });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const car = s.queue[i];
    const guess = answer === 'wrong' ? { make: 'Nope', model: 'Nope' }
      : roundKind === 'kit' ? { kit: car.kit, make: car.make, model: fullModel(car) }
      : { make: car.make, model: fullModel(car), year: String(car.year) };
    last = await srv.api('POST', '/api/solo/guess', { sessionId, idx: i, ...guess });
    assert.equal(last.status, 200, JSON.stringify(last.body));
  }
  return { sessionId, start: start.body, last };
}

test('solo: nothing in start/round payloads gives the car away', async () => {
  const srv = await startServer();
  try {
    const start = await srv.api('POST', '/api/solo/start', { kind: 'ranked', playlist: 'jdm' });
    assert.equal(start.status, 200);
    const s = srv.sessions.get(start.body.sessionId);
    const round = await srv.api('POST', '/api/solo/round', { sessionId: start.body.sessionId, idx: 0 });
    const blob = JSON.stringify([start.body, round.body]);
    assert.equal(blob.includes('"make"'), false, 'no answer fields');
    assert.match(round.body.img, /^\/api\/img\/[\w-]{16,}$/, 'ranked photo URL is opaque');
    for (const word of s.queue[0].credit.split(/[\s_,.()]+/).filter(w => w.length > 3)) assert.equal(round.body.img.includes(word), false, word);
    assert.equal(round.body.next, null, 'ranked does not hand out the next photo early');
  } finally { await srv.stop(); }
});

test('solo: free play gives direct photos plus the next one to preload', async () => {
  const srv = await startServer();
  try {
    const start = await srv.api('POST', '/api/solo/start', { kind: 'free', filters: { region: 'japan', era: 'any' } });
    assert.equal(start.body.board, null);
    assert.equal(start.body.ruleset, 'casual');
    const r = await srv.api('POST', '/api/solo/round', { sessionId: start.body.sessionId, idx: 0 });
    assert.match(r.body.img, /^https:\/\/upload\.wikimedia\.org\//);
    assert.match(r.body.next, /^https:\/\/upload\.wikimedia\.org\//);
    const s = srv.sessions.get(start.body.sessionId);
    assert.ok(s.queue.every(c => c.region === 'japan' && !c.kit));
    const none = await srv.api('POST', '/api/solo/start', { kind: 'free', filters: { era: 'classic', type: 'kit', region: 'japan' } });
    assert.equal(none.status, 400);
    assert.match(none.body.error, /No cars match/);
  } finally { await srv.stop(); }
});

test('solo: perfect ranked game = 100, answers include variant and photo credit', async () => {
  const srv = await startServer();
  try {
    const { last, start } = await play(srv, { kind: 'ranked', playlist: 'world' });
    assert.equal(start.ruleset, 'competitive');
    assert.equal(start.clockMs, 45_000);
    assert.equal(last.body.score, 100);
    assert.equal(last.body.done, true);
    assert.equal(last.body.streak, 10);
    assert.equal(last.body.bestStreak, 10);
    assert.ok(last.body.answer.make && last.body.answer.credit);
    assert.ok('variant' in last.body.answer);
  } finally { await srv.stop(); }
});

test('solo: rounds must be opened in order; replays and skips are rejected', async () => {
  const srv = await startServer();
  try {
    const { body } = await srv.api('POST', '/api/solo/start', { kind: 'free' });
    const sid = body.sessionId;
    assert.equal((await srv.api('POST', '/api/solo/guess', { sessionId: sid, idx: 0, make: 'x' })).status, 409, 'guess before the round opens');
    assert.equal((await srv.api('POST', '/api/solo/round', { sessionId: sid, idx: 1 })).status, 409, 'skip ahead');
    assert.equal((await srv.api('POST', '/api/solo/round', { sessionId: sid, idx: 0 })).status, 200);
    assert.equal((await srv.api('POST', '/api/solo/guess', { sessionId: sid, idx: 1, make: 'x' })).status, 409);
    assert.equal((await srv.api('POST', '/api/solo/guess', { sessionId: sid, idx: 0, make: 'x' })).status, 200);
    assert.equal((await srv.api('POST', '/api/solo/guess', { sessionId: sid, idx: 0, make: 'x' })).status, 409);
    assert.equal((await srv.api('POST', '/api/solo/guess', { sessionId: 'nope', idx: 0 })).status, 404);
    for (const bad of [{ kind: 'mars' }, { kind: 'ranked', playlist: 'constructor' }, { kind: 'ranked', playlist: '__proto__' }, {}]) {
      assert.equal((await srv.api('POST', '/api/solo/start', bad)).status, 400, JSON.stringify(bad));
    }
  } finally { await srv.stop(); }
});

test('solo: an answer after the clock runs out scores nothing', async () => {
  const srv = await startServer();
  try {
    const { body } = await srv.api('POST', '/api/solo/start', { kind: 'ranked', playlist: 'world' });
    const s = srv.sessions.get(body.sessionId);
    await srv.api('POST', '/api/solo/round', { sessionId: body.sessionId, idx: 0 });
    s.openedAt -= 60_000; s.servedAt = 0; // pretend a minute passed and the photo was never fetched
    const car = s.queue[0];
    const g = await srv.api('POST', '/api/solo/guess', { sessionId: body.sessionId, idx: 0, make: car.make, model: fullModel(car), year: String(car.year) });
    assert.equal(g.body.late, true);
    assert.equal(g.body.pts, 0);
    assert.equal(g.body.streak, 0);
  } finally { await srv.stop(); }
});

test('solo: endless ends after three misses and serves no repeats', async () => {
  const srv = await startServer();
  try {
    const { last, sessionId } = await play(srv, { kind: 'endless' }, { answer: 'wrong' });
    assert.equal(last.body.done, true);
    assert.equal(last.body.strikes, 3);
    assert.equal(last.body.idx, 3);
    assert.equal((await srv.api('POST', '/api/solo/round', { sessionId, idx: 3 })).status, 409);
    // A perfect run keeps going: play 15 cars then miss three.
    const start = await srv.api('POST', '/api/solo/start', { kind: 'endless' });
    const s = srv.sessions.get(start.body.sessionId);
    let r;
    for (let i = 0; !(r && r.body.done); i++) {
      await srv.api('POST', '/api/solo/round', { sessionId: s.id, idx: i });
      const car = s.queue[i];
      r = await srv.api('POST', '/api/solo/guess', { sessionId: s.id, idx: i, ...(i < 15 ? { make: car.make, model: fullModel(car), year: String(car.year) } : { make: 'x' }) });
    }
    assert.equal(r.body.idx, 18);
    assert.equal(r.body.bestStreak, 15);
    assert.equal(new Set(s.queue.map(c => c.id)).size, s.queue.length, 'no repeats');
    const saved = await srv.api('POST', '/api/scores', { sessionId: s.id, name: 'Runner' });
    assert.equal(saved.status, 200);
    const lb = await srv.api('GET', '/api/leaderboard?board=endless');
    assert.equal(lb.body[0].cars, 15);
    assert.equal(lb.body[0].maxScore, 180);
  } finally { await srv.stop(); }
});

test('daily: same cars for everyone, one ranked attempt per browser', async () => {
  const srv = await startServer();
  try {
    const a = await srv.api('POST', '/api/solo/start', { kind: 'daily', player: key('a') });
    const b = await srv.api('POST', '/api/solo/start', { kind: 'daily', player: key('b') });
    const qa = srv.sessions.get(a.body.sessionId).queue.map(c => c.id);
    assert.deepEqual(srv.sessions.get(b.body.sessionId).queue.map(c => c.id), qa);
    assert.match(a.body.board, /^daily:\d{4}-\d{2}-\d{2}$/);
    const first = await play(srv, { kind: 'daily' }, { player: key('a') });
    assert.equal((await srv.api('POST', '/api/scores', { sessionId: first.sessionId, name: 'A' })).status, 200);
    const again = await play(srv, { kind: 'daily' }, { player: key('a') });
    assert.equal(again.start.alreadyPlayed, true);
    assert.equal(again.start.board, null);
    assert.equal((await srv.api('POST', '/api/scores', { sessionId: again.sessionId, name: 'A' })).status, 409);
  } finally { await srv.stop(); }
});

test('leaderboard: only finished ranked sessions, once each, per playlist', async () => {
  const srv = await startServer();
  try {
    const forged = await srv.api('POST', '/api/scores', { name: 'Cheater', board: 'ranked:world', score: 100 });
    assert.equal(forged.status, 400);
    const { body } = await srv.api('POST', '/api/solo/start', { kind: 'ranked', playlist: 'world' });
    assert.equal((await srv.api('POST', '/api/scores', { sessionId: body.sessionId, name: 'Early' })).status, 400);
    const free = await play(srv, { kind: 'free' });
    assert.equal((await srv.api('POST', '/api/scores', { sessionId: free.sessionId, name: 'Free' })).status, 400, 'free play is unranked');
    const { sessionId } = await play(srv, { kind: 'ranked', playlist: 'world' });
    const saved = await srv.api('POST', '/api/scores', { sessionId, name: '<b>Ferd</b>' });
    assert.equal(saved.status, 200);
    assert.equal(saved.body.rank, 1);
    assert.equal((await srv.api('POST', '/api/scores', { sessionId, name: 'Again' })).status, 409);
    const lb = await srv.api('GET', '/api/leaderboard?board=ranked:world');
    assert.equal(lb.body.length, 1);
    assert.equal(lb.body[0].score, 100);
    assert.equal(lb.body[0].name, 'bFerdb', 'name sanitized');
    assert.equal(lb.body[0].player, undefined, 'player hash is never published');
    assert.equal((await srv.api('GET', '/api/leaderboard?board=ranked:jdm')).body.length, 0);
  } finally { await srv.stop(); }
});

test('kit playlist maxes out at 100 too', async () => {
  const srv = await startServer();
  try {
    const { last, start } = await play(srv, { kind: 'ranked', playlist: 'kits' });
    assert.equal(start.roundKind, 'kit');
    assert.equal(last.body.score, 100);
  } finally { await srv.stop(); }
});

test('photo proxy: serves bytes, starts the clock on first serve, falls back when upstream is down', async () => {
  const calls = [];
  let up = true;
  const fetchImage = async url => {
    calls.push(url);
    if (!up) throw new Error('offline');
    if (url.includes('/thumb/') && url.includes('tiny')) return new Response('nope', { status: 400 });
    return new Response(Buffer.from('JPEGDATA'), { status: 200, headers: { 'content-type': 'image/jpeg', 'content-length': '8' } });
  };
  const srv = await startServer({ fetchImage });
  try {
    const { body } = await srv.api('POST', '/api/solo/start', { kind: 'ranked', playlist: 'world' });
    const s = srv.sessions.get(body.sessionId);
    const r = await srv.api('POST', '/api/solo/round', { sessionId: s.id, idx: 0 });
    assert.equal(s.servedAt, 0, 'clock waits for the photo');
    const img = await fetch(srv.base + r.body.img);
    assert.equal(img.status, 200);
    assert.equal(img.headers.get('content-type'), 'image/jpeg');
    assert.equal(await img.text(), 'JPEGDATA');
    assert.ok(s.servedAt > 0, 'clock started when the photo went out');
    assert.equal((await fetch(srv.base + '/api/img/notatoken')).status, 404);
    // Thumbnail refused (source smaller than 960px) -> original file.
    const tiny = 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/tiny.jpg/960px-tiny.jpg';
    const t = await fetch(srv.base + srv.images.issue(tiny));
    assert.equal(t.status, 200);
    assert.ok(calls.includes('https://upload.wikimedia.org/wikipedia/commons/a/ab/tiny.jpg'));
    // Upstream down: redirect to the direct URL so the game still works.
    up = false;
    const other = 'https://upload.wikimedia.org/wikipedia/commons/thumb/c/cd/other.jpg/960px-other.jpg';
    const red = await fetch(srv.base + srv.images.issue(other), { redirect: 'manual' });
    assert.equal(red.status, 302);
    assert.equal(red.headers.get('location'), other);
  } finally { await srv.stop(); }
});

test('reports: anyone can file, only the owner can read', async () => {
  const srv = await startServer({ adminToken: 's3cret-token' });
  try {
    assert.equal((await srv.api('POST', '/api/report', { type: 'bug', note: 'wrong car', car: { id: 'x', make: 'A' } })).status, 200);
    assert.equal((await srv.api('POST', '/api/report', { type: 'spam' })).status, 400);
    assert.equal((await srv.api('GET', '/api/reports')).status, 404);
    assert.equal((await srv.api('GET', '/api/reports?token=wrong')).status, 404);
    const ok = await srv.api('GET', '/api/reports?token=s3cret-token');
    assert.equal(ok.status, 200);
    assert.equal(ok.body[0].note, 'wrong car');
  } finally { await srv.stop(); }
});

test('reports: without a token only same-machine requests can read', async () => {
  const srv = await startServer({ adminToken: '' });
  try {
    assert.equal((await srv.api('GET', '/api/reports')).status, 200);
    assert.equal((await srv.api('GET', '/api/reports', null, { 'x-forwarded-for': '1.2.3.4' })).status, 404);
  } finally { await srv.stop(); }
});

test('meta exposes playlists and pool sizes, not answers; unknown api 404s', async () => {
  const srv = await startServer();
  try {
    const m = await srv.api('GET', '/api/meta');
    assert.equal(m.body.kits, CARS.filter(c => c.kit && !c.excluded).length);
    assert.deepEqual(m.body.playlists.map(p => p.id), ['world', 'modern', 'classic', 'jdm', 'euro', 'super', 'kits']);
    assert.ok(m.body.playlists.every(p => p.size >= 10));
    assert.equal(JSON.stringify(m.body).includes('upload.wikimedia'), false);
    assert.equal((await srv.api('GET', '/api/cars')).status, 404);
  } finally { await srv.stop(); }
});

test('index has an absolute og:image for link previews', async () => {
  const srv = await startServer();
  try {
    const res = await fetch(srv.base + '/');
    const html = await res.text();
    assert.match(html, new RegExp(`content="${srv.base}/og-card.png"`));
    assert.equal((await fetch(srv.base + '/manifest.webmanifest')).status, 200);
  } finally { await srv.stop(); }
});
