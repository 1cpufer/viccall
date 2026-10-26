/*
 * Leaderboards that survive restarts (a private gist on GitHub), and the
 * keep-awake pinger for free hosting.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startServer } = require('./helpers');
const { createScoresBackup, tidy, DESCRIPTION } = require('../src/scores-backup');
const { fakeGitHub } = require('./fake-github');
const { startKeepAwake } = require('../src/keep-awake');
const { bestAnswer, buildIndex } = require('../public/scoring.js');
const IDX = buildIndex(require('../src/cars.json'));

async function playRanked(srv, name) {
  const st = await srv.api('POST', '/api/solo/start', { kind: 'ranked', playlist: 'world' });
  const s = srv.sessions.get(st.body.sessionId);
  for (let i = 0; i < 10; i++) {
    await srv.api('POST', '/api/solo/round', { sessionId: s.id, idx: i });
    await srv.api('POST', '/api/solo/guess', { sessionId: s.id, idx: i, car: bestAnswer(s.queue[i], IDX), year: String(s.queue[i].year) });
  }
  const r = await srv.api('POST', '/api/scores', { sessionId: s.id, name });
  assert.equal(r.status, 200, JSON.stringify(r.body));
}

const day = n => new Date(Date.now() - n * 24 * 60 * 60_000).toISOString().slice(0, 10);
const entry = (id, board, score, ts = 1) => ({ id, board, score, maxScore: 100, timeMs: 1000, ts, name: id });

test('tidy: one copy of each score, top 100 per board, daily boards for 30 days', () => {
  const many = Array.from({ length: 130 }, (_, i) => entry(`w${i}`, 'ranked:world', i));
  const out = tidy([...many, entry('w5', 'ranked:world', 5), entry('d-old', `daily:${day(40)}`, 50), entry('d-new', `daily:${day(2)}`, 50)]);
  const world = out.filter(e => e.board === 'ranked:world');
  assert.equal(world.length, 100);
  assert.equal(world[0].score, 129, 'best first');
  assert.equal(new Set(out.map(e => e.id)).size, out.length, 'no duplicates');
  assert.ok(!out.some(e => e.id === 'd-old'), 'old daily dropped');
  assert.ok(out.some(e => e.id === 'd-new'));
});

test('leaderboards come back after a restart with a fresh disk', async () => {
  const gh = fakeGitHub();
  const a = await startServer({ scoresToken: 'tok_abc', fetchGithub: gh.fetch, log: false });
  try {
    await new Promise(r => setTimeout(r, 50)); // restore finds no gist yet
    await playRanked(a, 'Ferd');
    await playRanked(a, 'Ayo');
    assert.equal(await a.backup.flush(), true);
    const g = [...gh.gists.values()][0];
    assert.equal(g.description, DESCRIPTION);
    assert.equal(g.public, false, 'private gist');
    assert.deepEqual(gh.saved().map(e => e.name).sort(), ['Ayo', 'Ferd']);
  } finally { await a.stop(); }

  // A new server on an empty data folder, as after a deploy.
  const b = await startServer({ scoresToken: 'tok_abc', fetchGithub: gh.fetch, log: false });
  try {
    await new Promise(r => setTimeout(r, 50));
    assert.equal(b.backup.ready, true);
    const board = (await b.api('GET', '/api/leaderboard?board=ranked:world')).body;
    assert.deepEqual(board.map(e => e.name).sort(), ['Ayo', 'Ferd']);
    // New scores add to the saved ones.
    await playRanked(b, 'Cleo');
    await b.backup.flush();
    assert.equal(gh.saved().length, 3);
    assert.equal(gh.gists.size, 1, 'same gist reused, found by its description');
  } finally { await b.stop(); }
});

test('if GitHub is down at start-up, nothing is saved over the old leaderboards', async () => {
  const gh = fakeGitHub();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-bk-'));
  try {
    const file = path.join(dir, 'scores.json');
    fs.writeFileSync(file, JSON.stringify([entry('old', 'ranked:world', 90)]));
    const first = createScoresBackup({ file, token: 'tok_x', fetch: gh.fetch, log: false, saveDelayMs: 5 });
    await first.restore();
    assert.equal(await first.flush(), true);
    first.close();

    // Restart with an empty file while GitHub is unreachable.
    fs.writeFileSync(file, '[]');
    gh.state.down = true;
    const second = createScoresBackup({ file, token: 'tok_x', fetch: gh.fetch, log: false, saveDelayMs: 5, retryMs: 20 });
    assert.ok((await second.restore()).error);
    fs.writeFileSync(file, JSON.stringify([entry('new', 'ranked:world', 40)]));
    second.markDirty();
    assert.equal(await second.flush(), false, 'not saved before a successful restore');
    assert.deepEqual(gh.saved().map(e => e.id), ['old'], 'saved leaderboards untouched');

    // GitHub comes back: the retry restores and merges.
    gh.state.down = false;
    await new Promise(r => setTimeout(r, 80));
    assert.equal(second.ready, true);
    await second.flush();
    assert.deepEqual(gh.saved().map(e => e.id).sort(), ['new', 'old']);
    second.close();
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('without a token the backup is off and nothing is sent', async () => {
  const gh = fakeGitHub();
  const srv = await startServer({ scoresToken: '', fetchGithub: gh.fetch, log: false });
  try {
    await playRanked(srv, 'Local');
    assert.equal(srv.backup.enabled, false);
    assert.equal(await srv.backup.flush(), false);
    assert.equal(gh.calls.length, 0);
  } finally { await srv.stop(); }
});

test('keep-awake visits /api/health on a timer, and is off without an address', async () => {
  const seen = [];
  const k = startKeepAwake({ url: 'https://viccall.example/', intervalMs: 20, log: false, fetch: async u => { seen.push(u); return { ok: true, status: 200 }; } });
  await new Promise(r => setTimeout(r, 75));
  k.stop();
  assert.ok(seen.length >= 2);
  assert.ok(seen.every(u => u === 'https://viccall.example/api/health'));
  assert.equal(startKeepAwake({ url: '', log: false }).enabled, false);
});
