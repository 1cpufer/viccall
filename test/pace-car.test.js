/*
 * Pace Car: one bot score per board, marked as a bot, scored by the real scorer.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('./helpers');
const PaceCar = require('../src/pace-car');
const Modes = require('../src/modes');
const VCScore = require('../public/scoring.js');
const CARS = require('../src/cars.json');
const IDX = VCScore.buildIndex(CARS);

test('it plays like a decent player: good, never perfect, and the same game replays the same', () => {
  const pct = [];
  for (let seed = 1; seed <= 40; seed++) {
    const r = PaceCar.play(CARS, IDX, { kind: 'ranked', playlist: 'world' }, PaceCar.rng(seed));
    assert.equal(r.board, 'ranked:world');
    assert.equal(r.rounds, 10);
    assert.equal(r.maxScore, 100);
    assert.ok(r.score >= 0 && r.score <= 100);
    assert.ok(r.timeMs >= 80_000 && r.timeMs <= 300_000, 'took 8 to 30 s a car');
    pct.push(r.score);
  }
  const avg = pct.reduce((a, b) => a + b, 0) / pct.length;
  assert.ok(avg > 35 && avg < 80, `average ${avg} of 100`);
  assert.ok(Math.max(...pct) < 100, 'never a perfect game in 40 tries');
  assert.deepEqual(PaceCar.play(CARS, IDX, { kind: 'daily' }, PaceCar.rng(7)), PaceCar.play(CARS, IDX, { kind: 'daily' }, PaceCar.rng(7)));
});

test('it plays today’s Daily Challenge, Body Kit rounds and Endless by their own rules', () => {
  const daily = PaceCar.play(CARS, IDX, { kind: 'daily' }, PaceCar.rng(3));
  assert.equal(daily.board, `daily:${Modes.utcDateKey()}`);
  const kits = PaceCar.play(CARS, IDX, { kind: 'ranked', playlist: 'kits' }, PaceCar.rng(3));
  assert.ok(kits.score > 0, 'kit rounds score through the tuner and car');
  const endless = PaceCar.play(CARS, IDX, { kind: 'endless' }, PaceCar.rng(3));
  assert.equal(endless.board, 'endless');
  assert.equal(endless.maxScore, endless.rounds * 10);
  assert.ok(endless.rounds >= 3, 'runs until three misses');
});

test('on the server: one bot score per board, marked as a bot, and not counted as a player', async () => {
  const srv = await startServer({ adminToken: 'owner-key-123' });
  try {
    const posted = srv.paceCar.run(PaceCar.rng(11));
    const boards = PaceCar.jobs().map(j => j.board);
    assert.deepEqual(posted, boards, 'daily, every ranked playlist, endless');
    assert.deepEqual(srv.paceCar.run(PaceCar.rng(12)), [], 'never twice on a board');

    const board = (await srv.api('GET', '/api/leaderboard?board=ranked:world')).body;
    assert.equal(board.length, 1);
    assert.equal(board[0].name, 'Pace Car');
    assert.equal(board[0].bot, true);

    // A real player's score sits beside it, unmarked.
    const st = await srv.api('POST', '/api/solo/start', { kind: 'ranked', playlist: 'world' });
    const s = srv.sessions.get(st.body.sessionId);
    for (let i = 0; i < 10; i++) {
      await srv.api('POST', '/api/solo/round', { sessionId: s.id, idx: i });
      await srv.api('POST', '/api/solo/guess', { sessionId: s.id, idx: i, car: VCScore.bestAnswer(s.queue[i], IDX), year: String(s.queue[i].year) });
    }
    assert.equal((await srv.api('POST', '/api/scores', { sessionId: s.id, name: 'Ferd' })).body.rank, 1, 'a perfect game beats the Pace Car');
    const both = (await srv.api('GET', '/api/leaderboard?board=ranked:world')).body;
    assert.deepEqual(both.map(r => [r.name, r.bot]), [['Ferd', false], ['Pace Car', true]]);

    // The play counter only counts the person.
    const stats = (await srv.api('GET', '/api/stats', null, { 'x-admin-token': 'owner-key-123' })).body;
    assert.equal(stats.days[0].started, 1);
    assert.equal(stats.days[0].scoresPosted, 1);
  } finally { await srv.stop(); }
});

test('after a restart it waits for the saved leaderboards before posting', async () => {
  const { fakeGitHub } = require('./fake-github');
  const gh = fakeGitHub();
  gh.state.down = true; // the restore can't finish yet
  const srv = await startServer({ scoresToken: 'tok_abc', fetchGithub: gh.fetch, log: false });
  try {
    await new Promise(r => setTimeout(r, 50));
    assert.equal(srv.backup.ready, false);
    assert.deepEqual(srv.paceCar.run(), [], 'nothing posted while the saved boards are missing');
  } finally { await srv.stop(); }
});
