/*
 * Community Garage stages 4-5: credit after rounds, profiles and badges,
 * reports and takedowns, counter-notices, provenance records.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { startServer, agent } = require('./helpers');
const { createMailer } = require('../src/mailer');
const { createCommonsProvenance, licenceUse, plain } = require('../src/provenance');
const VCScore = require('../public/scoring.js');
const { LICENCE_VERSION, DECLARATIONS, COUNTER_WINDOW_MS } = require('../src/garage');
const ALL_CARS = require('../src/cars.json');

const FIRST_PARTY = ['toyota-supra-1994', 'mazda-rx-7-1993', 'nissan-gt-r-2009', 'honda-nsx-1991', 'bmw-m3-2000', 'porsche-911-1974',
  'volkswagen-golf-gti-1983', 'ford-mustang-1969', 'chevrolet-corvette-1963', 'dodge-charger-1970', 'ferrari-testarossa-1986', 'mitsubishi-lancer-evolution-2003'];
const COMMUNITY_ONLY = ['lamborghini-countach-1978', 'peugeot-205-gti-1986', 'aston-martin-db5-1964', 'jaguar-e-type-1961'];
const byId = id => ALL_CARS.find(x => x.id === id);
const CARS = [...FIRST_PARTY.map(byId), ...COMMUNITY_ONLY.map(id => ({ ...byId(id), excluded: true }))];
const VKEY = COMMUNITY_ONLY.map(id => VCScore.identityKey(byId(id)));
const YEAR = COMMUNITY_ONLY.map(id => byId(id).year);
const allTrue = Object.fromEntries(Object.keys(DECLARATIONS).map(k => [k, true]));
const iso = years => { const d = new Date(); d.setUTCFullYear(d.getUTCFullYear() - years); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); };

async function photo(seed) {
  let s = seed * 6007 + 11;
  const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const grid = Buffer.alloc(12 * 8 * 3).map(() => rnd() * 255);
  const base = await sharp(grid, { raw: { width: 12, height: 8, channels: 3 } }).resize(1400, 900, { kernel: 'cubic' }).raw().toBuffer();
  for (let i = 0; i < base.length; i++) base[i] = Math.max(0, Math.min(255, base[i] + (rnd() - 0.5) * 30));
  return sharp(base, { raw: { width: 1400, height: 900, channels: 3 } }).jpeg({ quality: 88 }).withExif({ IFD0: { Make: 'TestCam' } }).toBuffer();
}

async function world(extra = {}) {
  const mailer = createMailer({ apiKey: '', log: false });
  const srv = await startServer({ garage: true, cars: CARS, mailer, publicUrl: 'http://vc.test', adminEmails: 'boss@example.com', log: false, ...extra });
  async function user(name, over = {}) {
    const a = agent(srv);
    const email = `${name.toLowerCase()}@example.com`;
    const r = await a.req('POST', '/api/auth/signup', { email, password: 'correct horse battery', displayName: name, birthDate: iso(30), acceptTerms: true });
    const token = /\?verify=([\w-]+)/.exec(mailer.outbox.filter(m => m.to === email).pop().text)[1];
    await a.req('POST', '/api/auth/verify', { token });
    await a.req('POST', '/api/garage/licence', { version: LICENCE_VERSION });
    if (over.anonymous) await a.req('POST', '/api/auth/profile', { creditAnonymous: true });
    a.id = r.body.user.id;
    return a;
  }
  const boss = await user('Boss');
  async function contribute(who, n, { eligibility = 'competitive', seed = n + 300, location, event, showLocation } = {}) {
    const c = await who.req('POST', '/api/garage/submissions', { make: 'x', model: 'y', year: YEAR[n], location, event, showLocation, licenceVersion: LICENCE_VERSION, declarations: allTrue });
    const u = await who.raw('PUT', `/api/garage/submissions/${c.body.submission.id}/photo`, await photo(seed));
    const d = await boss.req('POST', `/api/garage/mod/submissions/${c.body.submission.id}/decision`, { action: 'approve', vehicleKey: VKEY[n], year: YEAR[n], eligibility });
    assert.equal(d.status, 200, JSON.stringify(d.body));
    return { imageId: u.body.submission.image.id, submissionId: c.body.submission.id };
  }
  return { srv, user, boss, contribute };
}

async function findCommunityRound(srv, a, kind = 'free') {
  for (let g = 0; g < 30; g++) {
    const st = await a.req('POST', '/api/solo/start', { kind });
    const sid = st.body.sessionId;
    for (let i = 0; i < 10; i++) {
      await a.req('POST', '/api/solo/round', { sessionId: sid, idx: i });
      const car = srv.sessions.get(sid).queue[i];
      const g2 = await a.req('POST', '/api/solo/guess', { sessionId: sid, idx: i, car: '' });
      if (car.community) return g2.body.answer;
    }
  }
  throw new Error('no community round');
}

// ---------------------------------------------------------------------------
test('credit: the photographer is named after the round, or "Community photographer" if they chose that', async () => {
  const { srv, user, contribute } = await world();
  try {
    const ann = await user('Ann');
    const anon = agent(srv);
    await contribute(ann, 0);
    let a = await findCommunityRound(srv, anon);
    assert.deepEqual(a.photo, { source: 'community', by: 'Ann', profile: 'Ann' });
    assert.equal(a.credit, null);
    assert.equal(a.attribution, null);
    assert.match(a.id, /^community:img_/);

    await ann.req('POST', '/api/auth/profile', { creditAnonymous: true });
    srv.garage.invalidate();
    a = await findCommunityRound(srv, anon);
    assert.deepEqual(a.photo, { source: 'community', by: 'Community photographer', profile: null });
  } finally { await srv.stop(); }
});

test('profiles and badges come from approved photos only; location only if the photographer chose to show it', async () => {
  const { srv, user, contribute, boss } = await world();
  try {
    const ann = await user('Ann');
    assert.equal((await agent(srv).req('GET', '/api/garage/profiles/Ann')).status, 404, 'no approved photos yet');
    // A pending photo doesn't count.
    const c = await ann.req('POST', '/api/garage/submissions', { make: 'x', model: 'y', licenceVersion: LICENCE_VERSION, declarations: allTrue });
    await ann.raw('PUT', `/api/garage/submissions/${c.body.submission.id}/photo`, await photo(1));
    assert.equal((await agent(srv).req('GET', '/api/garage/profiles/Ann')).status, 404);

    await contribute(ann, 0, { location: 'Goodwood', event: 'Festival of Speed', showLocation: true });
    await contribute(ann, 1, { eligibility: 'casual', location: 'My street', showLocation: false });
    const p = (await agent(srv).req('GET', '/api/garage/profiles/ann')).body.profile;
    assert.equal(p.name, 'Ann');
    assert.equal(p.stats.approved, 2);
    assert.deepEqual(p.badges.map(b => b.id), ['first', 'competition']);
    assert.equal(p.photos.length, 2);
    const byLoc = Object.fromEntries(p.photos.map(x => [x.vehicle, x]));
    assert.equal(byLoc['Lamborghini Countach'].location, 'Goodwood');
    assert.equal(byLoc['Lamborghini Countach'].event, 'Festival of Speed');
    assert.equal(byLoc['Peugeot 205 GTI'].location, null, 'hidden location stays hidden');
    assert.equal((await agent(srv).req('GET', p.photos[0].small)).status, 200);
    assert.deepEqual((await ann.req('GET', '/api/garage/me')).body.badges.map(b => b.id), ['first', 'competition']);

    // Removed photos drop off the profile and the counts.
    await boss.req('POST', `/api/garage/mod/images/${p.photos[0].id}/remove`, { reason: 'test' });
    assert.equal((await agent(srv).req('GET', '/api/garage/profiles/Ann')).body.profile.stats.approved, 1);

    const zed = await user('Zed', { anonymous: true });
    await contribute(zed, 2);
    assert.equal((await agent(srv).req('GET', '/api/garage/profiles/Zed')).status, 404, 'anonymous contributors have no public profile');
  } finally { await srv.stop(); }
});

test('reports: anyone can report; copyright and privacy reports pull the photo at once, wrong-car reports pull it from competitive', async () => {
  const { srv, user, contribute, boss } = await world();
  try {
    const ann = await user('Ann');
    const anon = agent(srv);
    const a = await contribute(ann, 0);
    const b = await contribute(ann, 1);
    const target = id => `community:${id}`;
    const state = id => srv.db.get('SELECT takedown, flagged, eligibility FROM images WHERE id = ?', id);

    assert.equal((await anon.req('POST', '/api/garage/reports', { kind: 'nope', target: target(a.imageId) })).status, 400);
    assert.equal((await anon.req('POST', '/api/garage/reports', { kind: 'other', target: 'not-a-car' })).status, 400);
    assert.equal((await anon.req('POST', '/api/garage/reports', { kind: 'wrong_id', target: target(a.imageId) })).status, 400, 'needs a message');
    assert.equal((await anon.req('POST', '/api/garage/reports', { kind: 'other', target: 'toyota-supra-1994', message: 'Photo is a Supra A90' })).status, 201, 'first-party cars can be reported');

    assert.equal((await anon.req('POST', '/api/garage/reports', { kind: 'wrong_id', target: target(a.imageId), message: 'This is a Diablo' })).status, 201);
    assert.equal(state(a.imageId).flagged, 1);
    assert.equal(srv.garage.counts().competitive, 1, 'out of competitive play');
    assert.equal((await anon.req('GET', `/api/garage/photos/${a.imageId}/small`)).status, 200, 'still in casual play');

    assert.equal((await anon.req('POST', '/api/garage/reports', { kind: 'privacy', target: target(b.imageId), message: 'My number plate is readable' })).status, 201);
    assert.equal(state(b.imageId).takedown, 'disputed');
    assert.equal((await anon.req('GET', `/api/garage/photos/${b.imageId}/small`)).status, 404, 'out of everything while disputed');
    assert.equal(srv.garage.counts().casual, 1);

    // Moderator: dismiss the wrong-car report (it was right), fix the privacy one with a blur.
    const open = (await boss.req('GET', '/api/garage/mod/reports')).body;
    assert.equal(open.reports.length, 3);
    const wrong = open.reports.find(r => r.kind === 'wrong_id');
    const priv = open.reports.find(r => r.kind === 'privacy');
    assert.equal((await ann.req('POST', `/api/garage/mod/reports/${wrong.id}/resolve`, { action: 'dismiss', note: 'x' })).status, 403);
    assert.equal((await boss.req('POST', `/api/garage/mod/reports/${wrong.id}/resolve`, { action: 'dismiss' })).status, 400, 'note required');
    assert.equal((await boss.req('POST', `/api/garage/mod/reports/${wrong.id}/resolve`, { action: 'dismiss', note: 'It is a Countach' })).status, 200);
    assert.deepEqual({ ...state(a.imageId) }, { takedown: 'none', flagged: 0, eligibility: 'competitive' }, 'restored');
    assert.equal((await boss.req('POST', `/api/garage/mod/reports/${priv.id}/resolve`, { action: 'fix', note: 'Plate blurred', blur: [{ x: 0.4, y: 0.75, w: 0.2, h: 0.08 }] })).status, 200);
    assert.equal(state(b.imageId).takedown, 'none');
    assert.equal(srv.garage.counts().competitive, 2);
    assert.equal((await boss.req('POST', `/api/garage/mod/reports/${priv.id}/resolve`, { action: 'dismiss', note: 'again' })).status, 409);
  } finally { await srv.stop(); }
});

test('copyright: an upheld complaint removes the photo, keeps the original for a counter-notice, and two strikes end submissions', async () => {
  const { srv, user, contribute, boss } = await world();
  try {
    const ann = await user('Ann');
    const anon = agent(srv);
    const notice = id => ({ kind: 'copyright', target: `community:${id}`, copyright: { name: 'Pat Owner', email: 'pat@example.com', work: 'My photo at example.com/p/1', signature: 'Pat Owner', goodFaith: true, accurate: true } });
    const a = await contribute(ann, 0);
    const bad = notice(a.imageId);
    bad.copyright.accurate = false;
    assert.equal((await anon.req('POST', '/api/garage/reports', bad)).body.code, 'copyright', 'statements required');
    assert.equal((await anon.req('POST', '/api/garage/reports', notice(a.imageId))).status, 201);
    const rep = (await boss.req('GET', '/api/garage/mod/reports')).body.reports[0];
    assert.equal(rep.details.signature, 'Pat Owner');
    const up = await boss.req('POST', `/api/garage/mod/reports/${rep.id}/resolve`, { action: 'uphold', note: 'Owner showed the original' });
    assert.equal(up.status, 200);
    assert.equal(up.body.contributorBlocked, false);
    const img = srv.db.get('SELECT moderation, takedown, restrictions FROM images WHERE id = ?', a.imageId);
    assert.equal(img.moderation, 'removed');
    assert.equal(img.takedown, 'removed');
    assert.ok(fs.existsSync(path.join(srv.dataDir, 'garage', 'originals', a.imageId)), 'original kept for the counter-notice window');
    const mine = (await ann.req('GET', `/api/garage/submissions/${a.submissionId}`)).body.submission;
    assert.equal(mine.status, 'removed');
    assert.match(mine.reason, /counter-notice/);

    // Counter-notice, then reinstatement.
    assert.equal((await ann.req('POST', `/api/garage/submissions/${a.submissionId}/counter`, { name: 'Ann A', contact: '1 Road, Town; ann@example.com', statement: 'short', consent: true })).status, 400);
    const cn = await ann.req('POST', `/api/garage/submissions/${a.submissionId}/counter`, { name: 'Ann A', contact: '1 Road, Town; ann@example.com', statement: 'I took this photo myself at Goodwood in 2025 and the complaint is mistaken.', consent: true });
    assert.equal(cn.status, 201);
    assert.equal((await boss.req('GET', '/api/garage/mod/counter-notices')).body.notices[0].name, 'Ann A');
    assert.equal((await boss.req('POST', `/api/garage/mod/counter-notices/${cn.body.id}`, { status: 'forwarded' })).status, 200);
    assert.equal((await boss.req('POST', `/api/garage/mod/images/${a.imageId}/reinstate`, { reason: 'No court action within 14 business days' })).status, 200);
    assert.equal((await anon.req('GET', `/api/garage/photos/${a.imageId}/small`)).status, 200);
    assert.equal(srv.db.get('SELECT eligibility FROM images WHERE id = ?', a.imageId).eligibility, 'casual', 'back as casual-only');

    // A second upheld complaint: submission rights end.
    const b = await contribute(ann, 1);
    await anon.req('POST', '/api/garage/reports', notice(b.imageId));
    const rep2 = (await boss.req('GET', '/api/garage/mod/reports')).body.reports[0];
    assert.equal((await boss.req('POST', `/api/garage/mod/reports/${rep2.id}/resolve`, { action: 'uphold', note: 'Second complaint upheld' })).body.contributorBlocked, true);
    const blocked = await ann.req('POST', '/api/garage/submissions', { make: 'x', model: 'y', licenceVersion: LICENCE_VERSION, declarations: allTrue });
    assert.equal(blocked.body.code, 'blocked');
    assert.ok((await ann.req('GET', '/api/garage/me')).body.blockers.includes('blocked'));

    // After the window, the kept original is deleted.
    const r = JSON.parse(srv.db.get('SELECT restrictions FROM images WHERE id = ?', b.imageId).restrictions);
    srv.db.run('UPDATE images SET restrictions = ? WHERE id = ?', JSON.stringify({ ...r, purgeAfter: Date.now() - 1 }), b.imageId);
    assert.equal(await srv.garage.purgeExpired(), 1);
    assert.ok(!fs.existsSync(path.join(srv.dataDir, 'garage', 'originals', b.imageId)));
    assert.equal((await boss.req('POST', `/api/garage/mod/images/${b.imageId}/reinstate`, { reason: 'late' })).status, 410);
    assert.ok(COUNTER_WINDOW_MS >= 14 * 24 * 60 * 60_000);
  } finally { await srv.stop(); }
});

test('provenance: every community photo has a licence record moderators can read', async () => {
  const { srv, user, contribute, boss } = await world();
  try {
    const ann = await user('Ann');
    const { imageId } = await contribute(ann, 0);
    const p = (await boss.req('GET', `/api/garage/mod/images/${imageId}/provenance`)).body;
    assert.equal(p.image.source, 'community');
    assert.match(p.image.licence, /VicCall Contributor Licence 0\.1-draft/);
    assert.equal(p.image.acceptance.version, LICENCE_VERSION);
    assert.equal(p.submission.licenceVersion, LICENCE_VERSION);
    assert.equal(p.submission.declarations.tookIt, true);
    assert.deepEqual(p.contributors, [{ relation: 'uploader', credit: 'Ann' }]);
    assert.deepEqual(p.history.map(h => h.action), ['submission.create', 'submission.photo', 'submission.approve']);
    assert.equal((await ann.req('GET', `/api/garage/mod/images/${imageId}/provenance`)).status, 403);
  } finally { await srv.stop(); }
});

// ---- first-party photos: what Wikimedia Commons states ----
function fakeCommons(pages) {
  const calls = [];
  const fetch = async url => {
    const u = new URL(url);
    calls.push(u);
    const titles = u.searchParams.get('titles').split('|');
    return {
      ok: true,
      json: async () => ({
        query: {
          pages: titles.map(t => {
            const name = t.replace(/^File:/, '');
            const p = pages(name);
            if (!p) return { title: t, missing: true };
            return { title: t, imageinfo: [{ descriptionurl: `https://commons.wikimedia.org/wiki/${encodeURIComponent(t)}`, extmetadata: {
              Artist: { value: p.artist }, LicenseShortName: { value: p.licence }, LicenseUrl: { value: p.url || '' }, AttributionRequired: { value: 'true' },
            } }] };
          }),
        },
      }),
    };
  };
  return { fetch, calls };
}

test('provenance: licence checks and HTML clean-up', () => {
  assert.equal(licenceUse('CC BY-SA 4.0'), 'ok');
  assert.equal(licenceUse('CC BY 2.0'), 'ok');
  assert.equal(licenceUse('CC0'), 'ok');
  assert.equal(licenceUse('Public domain'), 'ok');
  assert.equal(licenceUse('CC BY-NC 2.0'), 'no');
  assert.equal(licenceUse('CC BY-ND 4.0'), 'review');
  assert.equal(licenceUse(''), 'review');
  assert.equal(licenceUse('Something odd'), 'review');
  assert.equal(plain('<a href="//x">Jane &amp; Co</a> (talk)'), 'Jane & Co (talk)');
});

test('provenance: first-party credits are fetched in batches, saved, shown after the round and recorded', async () => {
  const pages = name => (name.startsWith('Toyota') ? { artist: '<a href="/u/x">Kj</a>', licence: 'CC BY-SA 3.0', url: 'https://creativecommons.org/licenses/by-sa/3.0' }
    : name.startsWith('Mazda') ? { artist: 'Someone', licence: 'CC BY-NC 2.0' } : name.includes('Nissan GT-R') ? null : { artist: 'A. Photographer', licence: 'CC BY 2.0' });
  const { fetch, calls } = fakeCommons(pages);
  const { srv, boss } = await world({ fetchCommons: fetch });
  try {
    assert.equal(srv.provenance.stale(), true);
    const r = await boss.req('POST', '/api/garage/admin/provenance/refresh', {});
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(r.body, { fetched: 12, ok: 10, review: 0, no: 1, missing: 1, failed: 0 });
    assert.equal(calls.length, 1, 'one request for up to 50 files');
    assert.equal(calls[0].searchParams.get('iiprop'), 'extmetadata|url');
    assert.equal(srv.provenance.stale(), false);
    assert.ok(fs.existsSync(path.join(srv.dataDir, 'commons-meta.json')));

    const review = (await boss.req('GET', '/api/garage/admin/provenance/review')).body.photos;
    assert.deepEqual(review.map(x => x.car).sort(), ['mazda-rx-7-1993', 'nissan-gt-r-2009']);

    const row = srv.db.get(`SELECT * FROM images WHERE id = 'commons:toyota-supra-1994'`);
    assert.equal(row.source, 'commons');
    assert.equal(row.photographer, 'Kj');
    assert.equal(row.licence, 'CC BY-SA 3.0');
    assert.equal(row.commercial_ok, 1);
    assert.equal(JSON.parse(row.licence_evidence).statedBy, 'Wikimedia Commons file page');
    assert.equal(srv.db.get(`SELECT eligibility FROM images WHERE id = 'commons:mazda-rx-7-1993'`).eligibility, 'restricted');

    // The answer after a round carries the author and licence.
    const a = agent(srv);
    let found = null;
    for (let g = 0; g < 10 && !found; g++) {
      const st = await a.req('POST', '/api/solo/start', { kind: 'free' });
      for (let i = 0; i < 10 && !found; i++) {
        await a.req('POST', '/api/solo/round', { sessionId: st.body.sessionId, idx: i });
        const ans = (await a.req('POST', '/api/solo/guess', { sessionId: st.body.sessionId, idx: i, car: '' })).body.answer;
        if (ans.id === 'toyota-supra-1994') found = ans;
      }
    }
    assert.ok(found);
    assert.deepEqual(found.attribution, { author: 'Kj', licence: 'CC BY-SA 3.0', licenceUrl: 'https://creativecommons.org/licenses/by-sa/3.0', page: 'https://commons.wikimedia.org/wiki/File%3AToyota%20Supra%20mk4.jpg' });
  } finally { await srv.stop(); }
});

test('provenance: a failed lookup keeps what was saved before', async () => {
  const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'vc-prov-'));
  try {
    const cars = FIRST_PARTY.map(byId);
    const ok = fakeCommons(() => ({ artist: 'X', licence: 'CC BY 4.0' }));
    const p1 = createCommonsProvenance({ cars, dataDir: dir, fetch: ok.fetch, log: false });
    await p1.refresh();
    const down = async () => ({ ok: false, status: 503 });
    const p2 = createCommonsProvenance({ cars, dataDir: dir, fetch: down, log: false });
    assert.equal(p2.attributionFor(cars[0]).author, 'X', 'loaded from the saved file');
    const r = await p2.refresh();
    assert.equal(r.failed, 12);
    assert.equal(p2.attributionFor(cars[0]).author, 'X');
    const lagged = async () => ({ ok: true, json: async () => ({ error: { code: 'maxlag' } }) });
    const p3 = createCommonsProvenance({ cars, dataDir: dir, fetch: lagged, log: false });
    assert.equal((await p3.refresh()).failed, 12, 'an API error body is a failure, not "missing"');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
