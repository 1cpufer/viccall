/*
 * Play counter: daily totals only, owner-only, kept with the leaderboards.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { io: ioc } = require('socket.io-client');
const { startServer } = require('./helpers');
const { mergeMax, dayKey } = require('../src/stats');
const { fakeGitHub } = require('./fake-github');
const { bestAnswer, buildIndex } = require('../public/scoring.js');
const IDX = buildIndex(require('../src/cars.json'));

const today = () => dayKey(new Date(), 'America/Chicago');
const yesterday = () => dayKey(new Date(Date.now() - 36 * 60 * 60_000), 'America/Chicago');
const owner = { 'x-admin-token': 'owner-key-123' };
const statsOf = async srv => (await srv.api('GET', '/api/stats', null, owner)).body;

async function playRanked(srv, { post = true } = {}) {
  const st = await srv.api('POST', '/api/solo/start', { kind: 'ranked', playlist: 'world' });
  const s = srv.sessions.get(st.body.sessionId);
  for (let i = 0; i < 10; i++) {
    await srv.api('POST', '/api/solo/round', { sessionId: s.id, idx: i });
    await srv.api('POST', '/api/solo/guess', { sessionId: s.id, idx: i, car: bestAnswer(s.queue[i], IDX), year: String(s.queue[i].year) });
  }
  if (post) assert.equal((await srv.api('POST', '/api/scores', { sessionId: s.id, name: 'Ferd' })).status, 200);
}

test('merging a restored copy never counts twice', () => {
  assert.deepEqual(mergeMax({ a: 3, b: { x: 1 } }, { a: 2, b: { x: 4, y: 1 }, c: 5 }), { a: 3, b: { x: 4, y: 1 }, c: 5 });
});

test('visitors: new, came back, repeat visits; requests without the flag are not counted', async () => {
  const srv = await startServer({ adminToken: 'owner-key-123' });
  try {
    const first = await srv.api('GET', '/api/meta?seen=none');
    assert.equal(first.body.statsDay, today());
    await srv.api('GET', `/api/meta?seen=${today()}`);            // same browser again today
    await srv.api('GET', `/api/meta?seen=${yesterday()}`);        // a browser that was here before
    await srv.api('GET', '/api/meta');                            // a bot or an old page: not counted
    await srv.api('GET', '/api/meta?seen=<script>');              // junk: not counted
    const d = (await statsOf(srv)).days[0];
    assert.equal(d.day, today());
    assert.deepEqual({ visits: d.visits, visitors: d.visitors, newVisitors: d.newVisitors, returning: d.returning }, { visits: 3, visitors: 2, newVisitors: 1, returning: 1 });
  } finally { await srv.stop(); }
});

test('games: started, finished, cars answered and scores posted, by mode', async () => {
  const srv = await startServer({ adminToken: 'owner-key-123' });
  try {
    await playRanked(srv);
    await playRanked(srv, { post: false });
    await srv.api('POST', '/api/solo/start', { kind: 'free' });   // started, never finished
    const s = await statsOf(srv);
    const d = s.days[0];
    assert.equal(d.started, 3);
    assert.equal(d.finished, 2);
    assert.equal(d.rounds, 20);
    assert.equal(d.scoresPosted, 1);
    assert.deepEqual(d.byMode.started, { 'ranked:world': 2, free: 1 });
    assert.deepEqual(s.modes7, { 'ranked:world': 2, free: 1 });
    assert.equal(s.last7.started, 3);
  } finally { await srv.stop(); }
});

test('party games are counted with their player numbers', async () => {
  const srv = await startServer({ adminToken: 'owner-key-123', party: { roundMs: 300, competitiveMs: 300 } });
  const socks = [];
  try {
    const sock = () => new Promise((res, rej) => { const c = ioc(srv.base, { transports: ['websocket'], forceNew: true, reconnection: false }); socks.push(c); c.once('connect', () => res(c)); c.once('connect_error', rej); });
    const emit = (c, ev, p) => new Promise(r => c.emit(ev, p, r));
    const [a, b] = [await sock(), await sock()];
    const made = await emit(a, 'party:create', { name: 'Host', key: 'statskey_aaaaaaaaaaaaaaaa' });
    await emit(b, 'party:join', { code: made.code, name: 'Guest', key: 'statskey_bbbbbbbbbbbbbbbb' });
    assert.ok((await emit(a, 'party:start', {})).ok);
    for (let i = 0; i < 10; i++) {
      await emit(a, 'party:reveal', {});
      await emit(a, 'party:next', { idx: i });
    }
    const d = (await statsOf(srv)).days[0];
    assert.deepEqual({ rooms: d.partyRooms, games: d.partyGames, players: d.partyPlayers }, { rooms: 1, games: 1, players: 2 });
    assert.equal(srv.stats.summary().days[0].partyGames, 1);
  } finally { socks.forEach(s => s.close()); await srv.stop(); }
});

test('the numbers are owner-only', async () => {
  const srv = await startServer({ adminToken: 'owner-key-123' });
  try {
    assert.equal((await srv.api('GET', '/api/stats')).status, 404);
    assert.equal((await srv.api('GET', '/api/stats', null, { 'x-admin-token': 'wrong-key-1234' })).status, 404);
    assert.equal((await srv.api('GET', '/api/stats', null, owner)).status, 200);
  } finally { await srv.stop(); }
});

test('the counter is kept in the leaderboard gist and survives a restart', async () => {
  const gh = fakeGitHub();
  const a = await startServer({ adminToken: 'owner-key-123', scoresToken: 'tok_abc', fetchGithub: gh.fetch, log: false });
  try {
    await new Promise(r => setTimeout(r, 50));
    await a.api('GET', '/api/meta?seen=none');
    await playRanked(a);
    assert.equal(await a.backup.flush(), true);
    const g = [...gh.gists.values()][0];
    assert.ok(g.files['viccall-stats.json'], 'stats file in the same gist');
    assert.equal(gh.gists.size, 1);
  } finally { await a.stop(); }

  const b = await startServer({ adminToken: 'owner-key-123', scoresToken: 'tok_abc', fetchGithub: gh.fetch, log: false });
  try {
    await new Promise(r => setTimeout(r, 50));
    await b.api('GET', `/api/meta?seen=${today()}`);
    const d = (await statsOf(b)).days[0];
    assert.equal(d.visitors, 1, 'restored, not double counted');
    assert.equal(d.visits, 2);
    assert.equal(d.started, 1);
    assert.equal(d.scoresPosted, 1);
    assert.equal((await b.api('GET', '/api/leaderboard?board=ranked:world')).body.length, 1);
  } finally { await b.stop(); }
});
