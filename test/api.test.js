const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('./helpers');
const { fullModel } = require('../public/scoring.js');
const CARS = require('../src/cars.json');

const byImg = img => CARS.find(c => c.img === img && !c.kit) || CARS.find(c => c.img === img);

async function playPerfect(srv, mode = 'worldwide') {
  const start = await srv.api('POST', '/api/solo/start', { mode });
  assert.equal(start.status, 200);
  const { sessionId, images } = start.body;
  assert.equal(images.length, 10);
  let last;
  for (let i = 0; i < 10; i++) {
    const car = byImg(images[i]);
    const guess = mode === 'kit' ? { kit: car.kit, make: car.make, model: fullModel(car) } : { make: car.make, model: fullModel(car), year: String(car.year) };
    last = await srv.api('POST', '/api/solo/guess', { sessionId, idx: i, ...guess });
    assert.equal(last.status, 200);
  }
  return { sessionId, last };
}

test('solo session: answers only revealed after guessing; perfect game = 100', async () => {
  const srv = await startServer();
  try {
    const start = await srv.api('POST', '/api/solo/start', { mode: 'japan' });
    assert.equal(JSON.stringify(start.body).includes('"make"'), false, 'no answers in start payload');
    const { last } = await playPerfect(srv, 'japan');
    assert.equal(last.body.score, 100);
    assert.equal(last.body.done, true);
    assert.ok(last.body.answer.make);
  } finally { await srv.stop(); }
});

test('solo session: replaying a round or skipping ahead is rejected', async () => {
  const srv = await startServer();
  try {
    const { body } = await srv.api('POST', '/api/solo/start', { mode: 'worldwide' });
    assert.equal((await srv.api('POST', '/api/solo/guess', { sessionId: body.sessionId, idx: 1, make: 'x' })).status, 409);
    assert.equal((await srv.api('POST', '/api/solo/guess', { sessionId: body.sessionId, idx: 0, make: 'x' })).status, 200);
    assert.equal((await srv.api('POST', '/api/solo/guess', { sessionId: body.sessionId, idx: 0, make: 'x' })).status, 409);
    assert.equal((await srv.api('POST', '/api/solo/guess', { sessionId: 'nope', idx: 0 })).status, 404);
    assert.equal((await srv.api('POST', '/api/solo/start', { mode: 'mars' })).status, 400);
  } finally { await srv.stop(); }
});

test('leaderboard only accepts finished server sessions, once', async () => {
  const srv = await startServer();
  try {
    const forged = await srv.api('POST', '/api/scores', { name: 'Cheater', mode: 'worldwide', score: 50, maxScore: 50 });
    assert.equal(forged.status, 400);
    const { body } = await srv.api('POST', '/api/solo/start', { mode: 'worldwide' });
    assert.equal((await srv.api('POST', '/api/scores', { sessionId: body.sessionId, name: 'Early' })).status, 400);
    const { sessionId } = await playPerfect(srv, 'worldwide');
    const saved = await srv.api('POST', '/api/scores', { sessionId, name: '<b>Ferd</b>' });
    assert.equal(saved.status, 200);
    assert.equal(saved.body.rank, 1);
    assert.equal((await srv.api('POST', '/api/scores', { sessionId, name: 'Again' })).status, 409);
    const lb = await srv.api('GET', '/api/leaderboard?mode=worldwide');
    assert.equal(lb.body.length, 1);
    assert.equal(lb.body[0].score, 100);
    assert.equal(lb.body[0].name, 'bFerdb', 'name sanitized');
  } finally { await srv.stop(); }
});

test('kit sessions max out at 100 too', async () => {
  const srv = await startServer();
  try {
    const { last } = await playPerfect(srv, 'kit');
    assert.equal(last.body.score, 100);
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

test('meta exposes pool sizes, not answers; unknown api 404s', async () => {
  const srv = await startServer();
  try {
    const m = await srv.api('GET', '/api/meta');
    assert.equal(m.body.modes.kit, CARS.filter(c => c.kit).length);
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
