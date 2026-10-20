/*
 * Competitive integrity: community photos and who may see them.
 *
 *   eligible = approved photos for the ruleset - photos any participant contributed
 *
 * These tests run real games (solo and party) against a server with a small
 * first-party pool, so community photos come up often, and check every photo
 * actually handed out.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { io: ioc } = require('socket.io-client');
const { startServer, agent } = require('./helpers');
const { createMailer } = require('../src/mailer');
const Pools = require('../src/pools');
const VCScore = require('../public/scoring.js');
const { LICENCE_VERSION, DECLARATIONS } = require('../src/garage');
const ALL_CARS = require('../src/cars.json');

// ---- a small car list: 12 first-party photos, and 6 cars that only have community photos ----
const FIRST_PARTY = ['toyota-supra-1994', 'mazda-rx-7-1993', 'nissan-gt-r-2009', 'honda-nsx-1991', 'mitsubishi-lancer-evolution-2003',
  'bmw-m3-2000', 'porsche-911-1974', 'volkswagen-golf-gti-1983', 'ford-mustang-1969', 'chevrolet-corvette-1963', 'dodge-charger-1970', 'ferrari-testarossa-1986'];
const COMMUNITY_ONLY = ['lamborghini-countach-1978', 'peugeot-205-gti-1986', 'renault-alpine-a110-1973', 'aston-martin-db5-1964', 'jaguar-e-type-1961', 'toyota-ae86-corolla-1985'];
const byId = id => { const c = ALL_CARS.find(x => x.id === id); assert.ok(c, id); return c; };
const CARS = [...FIRST_PARTY.map(byId), ...COMMUNITY_ONLY.map(id => ({ ...byId(id), excluded: true }))];
const VKEY = COMMUNITY_ONLY.map(id => VCScore.identityKey(byId(id)));
const YEAR = COMMUNITY_ONLY.map(id => byId(id).year);

async function photo(seed) {
  let s = seed * 7919 + 3;
  const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const grid = Buffer.alloc(12 * 8 * 3).map(() => rnd() * 255);
  const base = await sharp(grid, { raw: { width: 12, height: 8, channels: 3 } }).resize(1400, 900, { kernel: 'cubic' }).raw().toBuffer();
  for (let i = 0; i < base.length; i++) base[i] = Math.max(0, Math.min(255, base[i] + (rnd() - 0.5) * 30));
  return sharp(base, { raw: { width: 1400, height: 900, channels: 3 } }).jpeg({ quality: 88 }).withExif({ IFD0: { Make: 'TestCam' } }).toBuffer();
}

const iso = years => { const d = new Date(); d.setUTCFullYear(d.getUTCFullYear() - years); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); };
const allTrue = Object.fromEntries(Object.keys(DECLARATIONS).map(k => [k, true]));

async function world() {
  const mailer = createMailer({ apiKey: '', log: false });
  const srv = await startServer({ garage: true, cars: CARS, mailer, publicUrl: 'http://vc.test', adminEmails: 'boss@example.com' });
  async function user(name) {
    const a = agent(srv);
    const email = `${name.toLowerCase()}@example.com`;
    const r = await a.req('POST', '/api/auth/signup', { email, password: 'correct horse battery', displayName: name, birthDate: iso(30), acceptTerms: true });
    const token = /\?verify=([\w-]+)/.exec(mailer.outbox.filter(m => m.to === email).pop().text)[1];
    await a.req('POST', '/api/auth/verify', { token });
    await a.req('POST', '/api/garage/licence', { version: LICENCE_VERSION });
    a.id = r.body.user.id;
    a.name = name;
    return a;
  }
  const boss = await user('Boss');
  // Upload and (optionally) approve one photo of community car n.
  async function contribute(who, n, { eligibility = 'competitive', seed = n + 100, buf, approve = true, confirmDuplicate = false } = {}) {
    const c = await who.req('POST', '/api/garage/submissions', { make: 'x', model: 'y', year: YEAR[n], licenceVersion: LICENCE_VERSION, declarations: allTrue });
    const u = await who.raw('PUT', `/api/garage/submissions/${c.body.submission.id}/photo`, buf || await photo(seed));
    assert.equal(u.status, 200, JSON.stringify(u.body));
    const imageId = u.body.submission.image.id;
    if (approve) {
      const d = await boss.req('POST', `/api/garage/mod/submissions/${c.body.submission.id}/decision`,
        { action: 'approve', vehicleKey: VKEY[n], year: YEAR[n], eligibility, confirmDuplicate });
      assert.equal(d.status, 200, JSON.stringify(d.body));
    }
    return imageId;
  }
  return { srv, user, boss, contribute };
}

// Play a whole solo game; return every round's car and check each photo really goes out.
async function play(srv, a, body, { onRound } = {}) {
  const st = await a.req('POST', '/api/solo/start', body);
  assert.equal(st.status, 200, JSON.stringify(st.body));
  const sid = st.body.sessionId;
  const shown = [];
  for (let i = 0; i < 10; i++) {
    if (onRound) await onRound(i, srv.sessions.get(sid));
    const r = await a.req('POST', '/api/solo/round', { sessionId: sid, idx: i });
    assert.equal(r.status, 200);
    const car = srv.sessions.get(sid).queue[i];
    if (car.community) {
      const img = await a.req('GET', r.body.img);
      assert.equal(img.status, 200, 'community photo is delivered');
      assert.equal(img.headers.get('content-type'), 'image/webp');
    }
    shown.push(car);
    const g = await a.req('POST', '/api/solo/guess', { sessionId: sid, idx: i, car: '' });
    assert.equal(g.status, 200);
    if (car.community) assert.equal(g.body.answer.photo.source, 'community');
  }
  return shown;
}
const imagesIn = cars => cars.filter(c => c.community).map(c => c.imageId);

// ---------------------------------------------------------------------------
test('rules: the exclusion function, case by case', () => {
  const item = (o = {}) => ({ community: true, moderation: 'approved', eligibility: 'competitive', takedown: 'none', flagged: false, contributors: ['ann'], ...o });
  const comp = participants => ({ competitive: true, participants });
  const casual = participants => ({ competitive: false, participants });
  const ok = (it, ctx) => Pools.communityAllowed(it, ctx).ok;

  assert.equal(ok(item(), comp(['bob'])), true);
  assert.equal(ok(item(), comp(['ann'])), false, 'own photo');
  assert.equal(ok(item(), comp(['bob', 'ann', 'cleo'])), false, 'any participant’s photo');
  assert.equal(ok(item({ contributors: ['ann', 'bob'] }), comp(['bob'])), false, 'copy uploaded by a participant');
  assert.equal(ok(item(), comp(['bob', null])), false, 'anonymous participant: no community photos');
  assert.equal(ok(item(), comp([])), false, 'no participants known: fail closed');
  assert.equal(ok(item({ eligibility: 'casual' }), comp(['bob'])), false, 'casual-only');
  assert.equal(ok(item({ flagged: true }), comp(['bob'])), false, 'flagged');
  for (const m of ['pending', 'rejected', 'removed']) assert.equal(ok(item({ moderation: m }), casual(['bob'])), false, m);
  for (const e of ['pending', 'restricted', 'removed']) assert.equal(ok(item({ eligibility: e }), casual(['bob'])), false, e);
  assert.equal(ok(item({ takedown: 'disputed' }), casual(['bob'])), false, 'disputed');
  assert.equal(ok(null, casual([null])), false, 'missing record');

  assert.equal(ok(item({ eligibility: 'casual', flagged: true }), casual([null])), true, 'casual, anonymous player');
  assert.equal(ok(item(), casual(['ann'])), false, 'casual still skips your own');
  assert.equal(ok({ id: 'first-party' }, comp([null])), true, 'first-party photos are always fine');
});

test('rules: random rooms never contain a participant’s photo (10,000 cases)', () => {
  let s = 42;
  const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const users = ['a', 'b', 'c', 'd', 'e', 'f'];
  const pickSome = (n, extra = []) => [...users, ...extra].filter(() => rnd() < n);
  const items = Array.from({ length: 40 }, (_, i) => ({
    community: true, imageId: i, moderation: rnd() < 0.8 ? 'approved' : 'removed', takedown: rnd() < 0.95 ? 'none' : 'disputed',
    eligibility: ['casual', 'competitive', 'restricted'][Math.floor(rnd() * 3)], flagged: rnd() < 0.1, contributors: pickSome(0.25),
  }));
  let shownCompetitive = 0;
  for (let k = 0; k < 10_000; k++) {
    const participants = pickSome(0.3, rnd() < 0.2 ? [null] : []);
    const competitive = rnd() < 0.5;
    for (const it of Pools.eligible(items, { competitive, participants })) {
      assert.ok(!it.contributors.some(c => participants.includes(c)), 'no participant contributed it');
      assert.equal(it.moderation, 'approved');
      assert.equal(it.takedown, 'none');
      if (competitive) {
        assert.equal(it.eligibility, 'competitive');
        assert.ok(!it.flagged && !participants.includes(null));
        shownCompetitive++;
      }
    }
  }
  assert.ok(shownCompetitive > 1000, 'the rules still let photos through');
});

test('solo: your own photos never appear in your ranked or endless games, but others see them', async () => {
  const { srv, user, contribute } = await world();
  try {
    const ann = await user('Ann');
    const bob = await user('Bob');
    const annImgs = [await contribute(ann, 0), await contribute(ann, 1)];
    const bobImg = await contribute(bob, 2);
    const seenByAnn = new Set(), seenByBob = new Set();
    for (let g = 0; g < 25; g++) {
      imagesIn(await play(srv, ann, { kind: 'ranked', playlist: 'world' })).forEach(i => seenByAnn.add(i));
      imagesIn(await play(srv, bob, { kind: 'ranked', playlist: 'world' })).forEach(i => seenByBob.add(i));
    }
    for (const i of annImgs) assert.ok(!seenByAnn.has(i), 'Ann never gets her own photo');
    assert.ok(!seenByBob.has(bobImg), 'Bob never gets his own photo');
    assert.ok(annImgs.some(i => seenByBob.has(i)), 'Bob does get Ann’s photos');
    assert.ok(seenByAnn.has(bobImg), 'Ann does get Bob’s photo');

    // Endless draws from the same rules.
    const st = await ann.req('POST', '/api/solo/start', { kind: 'endless' });
    const pool = srv.sessions.get(st.body.sessionId).plan.pool;
    assert.ok(pool.some(c => c.imageId === bobImg));
    assert.ok(!pool.some(c => annImgs.includes(c.imageId)));
  } finally { await srv.stop(); }
});

test('solo: anonymous competitive games and the Daily Challenge use first-party photos only', async () => {
  const { srv, user, contribute } = await world();
  try {
    const ann = await user('Ann');
    const bob = await user('Bob');
    await contribute(ann, 0);
    await contribute(ann, 1, { eligibility: 'casual' });
    const anon = agent(srv);
    for (let g = 0; g < 15; g++) {
      assert.deepEqual(imagesIn(await play(srv, anon, { kind: 'ranked', playlist: 'world' })), [], 'anonymous ranked');
      assert.deepEqual(imagesIn(await play(srv, bob, { kind: 'daily' })), [], 'daily');
    }
    const st = await anon.req('POST', '/api/solo/start', { kind: 'endless' });
    assert.ok(!srv.sessions.get(st.body.sessionId).plan.pool.some(c => c.community), 'anonymous endless');

    // Casual play needs no account and does include community photos.
    const casualSeen = new Set();
    for (let g = 0; g < 15; g++) imagesIn(await play(srv, anon, { kind: 'free' })).forEach(i => casualSeen.add(i));
    assert.equal(casualSeen.size, 2, 'both approved photos turn up in anonymous Free Play');
  } finally { await srv.stop(); }
});

test('solo: casual-only, flagged and pending photos stay out of competitive games', async () => {
  const { srv, user, contribute, boss } = await world();
  try {
    const ann = await user('Ann');
    const bob = await user('Bob');
    const casualOnly = await contribute(ann, 0, { eligibility: 'casual' });
    const flagged = await contribute(ann, 1);
    await boss.req('POST', `/api/garage/mod/images/${flagged}/state`, { flagged: true });
    const pending = await contribute(ann, 2, { approve: false });
    const restricted = await contribute(ann, 3, { eligibility: 'restricted' });
    const fine = await contribute(ann, 4);
    const ranked = new Set(), free = new Set();
    for (let g = 0; g < 20; g++) {
      imagesIn(await play(srv, bob, { kind: 'ranked', playlist: 'world' })).forEach(i => ranked.add(i));
      imagesIn(await play(srv, bob, { kind: 'free' })).forEach(i => free.add(i));
    }
    assert.deepEqual([...ranked], [fine]);
    assert.ok(free.has(casualOnly) && free.has(flagged) && free.has(fine), 'casual play uses casual and flagged-for-competitive photos');
    assert.ok(!free.has(pending) && !free.has(restricted), 'never pending or restricted');
  } finally { await srv.stop(); }
});

test('duplicates: a copy uploaded by someone else keeps the original out of their games too', async () => {
  const { srv, user, contribute, boss } = await world();
  try {
    const ann = await user('Ann');
    const cleo = await user('Cleo');
    const bob = await user('Bob');
    const buf = await photo(500);
    const annImg = await contribute(ann, 0, { buf });
    // Cleo uploads a resized copy; a moderator turns it down, but the link stays.
    const c = await cleo.req('POST', '/api/garage/submissions', { make: 'x', model: 'y', licenceVersion: LICENCE_VERSION, declarations: allTrue });
    const up = await cleo.raw('PUT', `/api/garage/submissions/${c.body.submission.id}/photo`, await sharp(buf).resize(1250).jpeg({ quality: 70 }).toBuffer());
    assert.equal(up.body.checks[0].code, 'duplicate');
    await boss.req('POST', `/api/garage/mod/submissions/${c.body.submission.id}/decision`, { action: 'reject', reason: 'Copy of another contributor’s photo' });

    const seenByCleo = new Set(), seenByBob = new Set();
    for (let g = 0; g < 20; g++) {
      imagesIn(await play(srv, cleo, { kind: 'ranked', playlist: 'world' })).forEach(i => seenByCleo.add(i));
      imagesIn(await play(srv, bob, { kind: 'ranked', playlist: 'world' })).forEach(i => seenByBob.add(i));
    }
    assert.ok(!seenByCleo.has(annImg), 'Cleo had a copy of it, so she never gets it');
    assert.ok(seenByBob.has(annImg));
  } finally { await srv.stop(); }
});

// Start ranked games until one has a community photo after round 0; return it.
async function gameWithCommunityLater(srv, a) {
  for (let g = 0; g < 40; g++) {
    const st = await a.req('POST', '/api/solo/start', { kind: 'ranked', playlist: 'world' });
    const s = srv.sessions.get(st.body.sessionId);
    const k = s.queue.findIndex((c, i) => i > 0 && c.community);
    if (k > 0) return { sid: st.body.sessionId, s, k };
  }
  throw new Error('no game with a community photo');
}
async function playUpTo(a, sid, k) {
  for (let i = 0; i < k; i++) {
    await a.req('POST', '/api/solo/round', { sessionId: sid, idx: i });
    await a.req('POST', '/api/solo/guess', { sessionId: sid, idx: i, car: '' });
  }
}

test('mid-game: a photo removed or flagged before its round is replaced, and an issued link stops working', async () => {
  const { srv, user, contribute, boss } = await world();
  try {
    const ann = await user('Ann');
    const bob = await user('Bob');
    for (const n of [0, 1, 2, 3, 4, 5]) await contribute(ann, n);

    for (const action of ['remove', 'flag']) {
      const { sid, s, k } = await gameWithCommunityLater(srv, bob);
      const target = s.queue[k].imageId;
      await playUpTo(bob, sid, k);
      if (action === 'remove') await boss.req('POST', `/api/garage/mod/images/${target}/remove`, { reason: 'Copyright complaint' });
      else await boss.req('POST', `/api/garage/mod/images/${target}/state`, { flagged: true });
      const r = await bob.req('POST', '/api/solo/round', { sessionId: sid, idx: k });
      assert.equal(r.status, 200);
      assert.ok(!s.queue[k].community, `${action}: a first-party photo took its place`);
      assert.ok(FIRST_PARTY.includes(s.queue[k].id));
      assert.equal(new Set(s.queue.map(c => c.id)).size, 10, 'and it isn’t a repeat');
      assert.equal(s.swaps, 1);
      const g = await bob.req('POST', '/api/solo/guess', { sessionId: sid, idx: k, car: '' });
      assert.equal(g.body.answer.id, s.queue[k].id);
    }

    // A link handed out before removal stops working; the player gets a free skip.
    const { sid, s, k } = await gameWithCommunityLater(srv, bob);
    await playUpTo(bob, sid, k);
    const r = await bob.req('POST', '/api/solo/round', { sessionId: sid, idx: k });
    assert.ok(s.queue[k].community);
    await boss.req('POST', `/api/garage/mod/images/${s.queue[k].imageId}/remove`, { reason: 'Contributor asked' });
    assert.equal((await bob.req('GET', r.body.img)).status, 404);
    const g = await bob.req('POST', '/api/solo/guess', { sessionId: sid, idx: k, photoFailed: true });
    assert.equal(g.body.skipped, true);
  } finally { await srv.stop(); }
});

// ---- party rooms ----
function sock(srv, cookie) {
  const c = ioc(srv.base, { transports: ['websocket'], forceNew: true, reconnection: false, extraHeaders: cookie ? { cookie } : {} });
  return new Promise((res, rej) => { c.once('connect', () => res(c)); c.once('connect_error', rej); });
}
const emit = (c, ev, payload) => new Promise(res => c.emit(ev, payload, res));
const key = n => `integrity_${n}_${'x'.repeat(16)}`;

// Host a room with these players, play every round, return the cars shown.
async function partyGame(srv, ruleset, players, { beforeRound } = {}) {
  const socks = [];
  for (const p of players) socks.push(await sock(srv, p && p.cookie));
  const made = await emit(socks[0], 'party:create', { name: 'Host', key: key(0), playlist: 'world', ruleset });
  for (let i = 1; i < socks.length; i++) assert.ok((await emit(socks[i], 'party:join', { code: made.code, name: `P${i}`, key: key(i) })).ok);
  const room = srv.party.rooms.get(made.code);
  const shown = [];
  const nextRound = () => new Promise(res => socks[0].once('party:round', res));
  let round = nextRound();
  assert.ok((await emit(socks[0], 'party:start', {})).ok);
  for (let i = 0; i < 10; i++) {
    const r = await round;
    const car = room.queue[i];
    shown.push(car);
    if (car.community) assert.equal((await fetch(srv.base + r.img)).status, 200);
    if (i < 9 && beforeRound) await beforeRound(i + 1, room, socks);
    assert.ok((await emit(socks[0], 'party:reveal', {})).ok);
    if (i < 9) { round = nextRound(); assert.ok((await emit(socks[0], 'party:next', { idx: i })).ok); }
  }
  socks.forEach(s => s.close());
  return { shown, room, code: made.code };
}

test('party: competitive rooms exclude every participant’s photos; anonymous players mean first-party only', async () => {
  const { srv, user, contribute } = await world();
  try {
    const ann = await user('Ann');
    const bob = await user('Bob');
    const cleo = await user('Cleo');
    const annImgs = [await contribute(ann, 0), await contribute(ann, 1)];
    const bobImgs = [await contribute(bob, 2), await contribute(bob, 3)];
    const cleoImg = await contribute(cleo, 4);

    const annBob = new Set(), withAnon = new Set(), casualAnon = new Set();
    for (let g = 0; g < 12; g++) {
      imagesIn((await partyGame(srv, 'competitive', [ann, bob])).shown).forEach(i => annBob.add(i));
      imagesIn((await partyGame(srv, 'competitive', [cleo, null])).shown).forEach(i => withAnon.add(i));
      imagesIn((await partyGame(srv, 'casual', [ann, null])).shown).forEach(i => casualAnon.add(i));
    }
    for (const i of [...annImgs, ...bobImgs]) assert.ok(!annBob.has(i), 'no photo from Ann or Bob in their room');
    assert.ok(annBob.has(cleoImg), 'Cleo’s photo is used for them');
    assert.equal(withAnon.size, 0, 'an anonymous player in a competitive room: first-party only');
    for (const i of annImgs) assert.ok(!casualAnon.has(i), 'casual rooms still skip Ann’s own photos');
    assert.ok(bobImgs.some(i => casualAnon.has(i)), 'casual rooms with anonymous players use community photos');
  } finally { await srv.stop(); }
});

test('party: a player who rejoins as the photographer has their photos replaced from then on', async () => {
  const { srv, user, contribute } = await world();
  try {
    const ann = await user('Ann');
    const bob = await user('Bob');
    const dan = await user('Dan');
    const annImgs = [];
    for (const n of [0, 1, 2, 3, 4, 5]) annImgs.push(await contribute(ann, n, { seed: 900 + n }));
    const isAnns = c => c && c.community && annImgs.includes(c.imageId);
    let result = null;
    for (let g = 0; g < 20 && !result; g++) {
      let switchAt = -1, planned = null;
      const { shown } = await partyGame(srv, 'competitive', [bob, dan], {
        async beforeRound(idx, room, socks) {
          if (switchAt >= 0 || !isAnns(room.queue[idx])) return;
          // Before an Ann photo's round, Dan's seat comes back on a connection signed in as Ann.
          planned = room.queue[idx].imageId;
          const s2 = await sock(srv, ann.cookie);
          assert.ok((await emit(s2, 'party:resume', { code: room.code, key: key(1) })).ok);
          socks[1].close();
          socks[1] = s2;
          switchAt = idx;
        },
      });
      if (switchAt >= 0) result = { shown, switchAt, planned };
    }
    assert.ok(result, 'the test found an Ann photo to switch before');
    const { shown, switchAt, planned } = result;
    assert.ok(!shown.slice(switchAt).some(isAnns), 'no Ann photo after she joined');
    assert.ok(!shown.some(c => c.imageId === planned), 'the planned photo was replaced');
    assert.ok(!shown[switchAt].community, 'by a first-party photo');
  } finally { await srv.stop(); }
});
