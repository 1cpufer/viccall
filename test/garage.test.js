const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { startServer, agent } = require('./helpers');
const { createMailer } = require('../src/mailer');
const Photos = require('../src/photos');
const { LICENCE_VERSION, DECLARATIONS } = require('../src/garage');
const VCScore = require('../public/scoring.js');
const CARS = require('../src/cars.json');
const { createApp } = require('../src/server');
const { createPhotoPrints, readPrints, SHIPPED } = require('../src/photo-prints');

// ---- test photos: a random grid of tones plus grain, different for every seed ----
async function photo(seed, { w = 1600, h = 1000, quality = 90, exif } = {}) {
  let s = seed * 9973 + 1;
  const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const grid = Buffer.alloc(12 * 8 * 3).map(() => rnd() * 255);
  const base = await sharp(grid, { raw: { width: 12, height: 8, channels: 3 } }).resize(w, h, { kernel: 'cubic' }).raw().toBuffer();
  for (let i = 0; i < base.length; i++) base[i] = Math.max(0, Math.min(255, base[i] + (rnd() - 0.5) * 30));
  let img = sharp(base, { raw: { width: w, height: h, channels: 3 } }).jpeg({ quality });
  img = img.withExif(exif || { IFD0: { Make: 'TestCam', Model: 'One' } });
  return img.toBuffer();
}

// ---- accounts ----
const iso = years => { const d = new Date(); d.setUTCFullYear(d.getUTCFullYear() - years); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); };
async function garage(opts = {}) {
  const mailer = createMailer({ apiKey: '', log: false });
  const srv = await startServer({ garage: true, mailer, publicUrl: 'http://vc.test', adminEmails: 'boss@example.com', ...opts });
  async function user(name, { verified = true, age = 30, licence = true } = {}) {
    const a = agent(srv);
    const email = `${name.toLowerCase()}@example.com`;
    const r = await a.req('POST', '/api/auth/signup', { email, password: 'correct horse battery', displayName: name, birthDate: iso(age), acceptTerms: true });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    if (verified) {
      const mail = mailer.outbox.filter(m => m.to === email).pop();
      const token = /\?verify=([\w-]+)/.exec(mail.text)[1];
      assert.equal((await a.req('POST', '/api/auth/verify', { token })).status, 200);
    }
    if (licence && age >= 18) assert.equal((await a.req('POST', '/api/garage/licence', { version: LICENCE_VERSION })).status, 200);
    a.id = r.body.user.id;
    return a;
  }
  return { srv, mailer, user };
}
const allTrue = Object.fromEntries(Object.keys(DECLARATIONS).map(k => [k, true]));
const details = (over = {}) => ({ make: 'Porsche', model: '918 Spyder', year: 2013, location: 'Goodwood', licenceVersion: LICENCE_VERSION, declarations: allTrue, ...over });
async function submit(a, buf, over) {
  const c = await a.req('POST', '/api/garage/submissions', details(over));
  assert.equal(c.status, 201, JSON.stringify(c.body));
  const u = await a.raw('PUT', `/api/garage/submissions/${c.body.submission.id}/photo`, buf);
  return { id: c.body.submission.id, upload: u };
}
const approve = (mod, id, over = {}) => mod.req('POST', `/api/garage/mod/submissions/${id}/decision`, { action: 'approve', vehicleKey: 'porsche|918spyder|', year: 2013, difficulty: 3, ...over });

// ---------------------------------------------------------------------------
test('photo checks: hard limits reject, quality problems only raise flags', async () => {
  assert.match((await Photos.inspect(Buffer.from('not a photo'))).error, /isn’t a photo/);
  assert.match((await Photos.inspect(await photo(1, { w: 900, h: 600 }))).error, /at least 1200×700/);
  assert.match((await Photos.inspect(await sharp(await photo(1)).gif().toBuffer())).error, /JPEG, PNG or WebP/);
  const good = await photo(1);
  assert.match((await Photos.inspect(good.subarray(0, good.length >> 1))).error, /damaged/);

  const ok = await Photos.inspect(good);
  assert.ok(ok.ok);
  assert.deepEqual(ok.flags, []);
  assert.equal(ok.width, 1600);

  const blurry = await Photos.inspect(await sharp(good).blur(12).jpeg({ quality: 95 }).withExif({ IFD0: { Make: 'x' } }).toBuffer());
  assert.ok(blurry.ok, 'blur is a flag, not a rejection');
  assert.ok(blurry.flags.some(f => f.code === 'blurry'));
  const dark = await Photos.inspect(await sharp(good).linear(0.12, 0).jpeg({ quality: 95 }).toBuffer());
  assert.ok(dark.flags.some(f => f.code === 'dark'));
  assert.ok(dark.flags.some(f => f.code === 'no-camera-data'));
  const ai = await Photos.inspect(await photo(2, { exif: { IFD0: { Software: 'Midjourney v7' } } }));
  assert.ok(ai.flags.some(f => f.code === 'ai'));

  // Portrait photos stored sideways with an EXIF rotation are measured upright.
  const sideways = await sharp(await photo(3)).withMetadata({ orientation: 6 }).toBuffer();
  const r = await Photos.inspect(sideways);
  assert.deepEqual([r.width, r.height], [1000, 1600]);
});

test('public copies have no metadata, and blur covers the requested area', async () => {
  const gps = await photo(4, { exif: { IFD0: { Make: 'Canon' }, IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '51/1 30/1 0/1' } } });
  const check = await Photos.inspect(gps);
  assert.ok(check.flags.some(f => f.code === 'location'));
  const out = await Photos.derive(gps, { blur: [{ x: 0.25, y: 0.25, w: 0.5, h: 0.5 }] });
  for (const [size, buf] of Object.entries(out)) {
    const m = await sharp(buf).metadata();
    assert.equal(m.format, 'webp');
    assert.equal(m.exif, undefined, `${size} has no EXIF`);
    assert.equal(m.xmp, undefined);
    assert.ok(Math.max(m.width, m.height) <= Photos.SIZES[size]);
  }
  // Blurred centre has far less detail than the untouched corner.
  const { data, info } = await sharp(out.medium).greyscale().raw().toBuffer({ resolveWithObject: true });
  const detail = (x0, y0) => {
    let sum = 0, n = 0;
    for (let y = y0; y < y0 + 60; y++) for (let x = x0; x < x0 + 60; x++) { sum += Math.abs(data[y * info.width + x] - data[y * info.width + x + 1]); n++; }
    return sum / n;
  };
  assert.ok(detail(400, 250) * 3 < detail(20, 20), 'centre blurred');
});

test('duplicate detection: copies, resizes and crops match; different photos do not', async () => {
  const a = await Photos.inspect(await photo(10));
  const resized = await Photos.inspect(await sharp(await photo(10)).resize(1300).jpeg({ quality: 60 }).toBuffer());
  const cropped = await Photos.inspect(await sharp(await photo(10)).extract({ left: 160, top: 100, width: 1300, height: 800 }).toBuffer());
  const corner = await Photos.inspect(await sharp(await photo(10)).extract({ left: 0, top: 0, width: 1300, height: 800 }).toBuffer());
  const brighter = await Photos.inspect(await sharp(await photo(10)).modulate({ brightness: 1.15 }).jpeg().toBuffer());
  assert.equal(Photos.similar(a, await Photos.inspect(await photo(10))).how, 'identical file');
  assert.ok(Photos.similar(a, resized).match, 'resized and recompressed');
  assert.ok(Photos.similar(a, cropped).match, 'cropped');
  assert.ok(Photos.similar(cropped, a).match, 'either way round');
  assert.ok(Photos.similar(a, corner).match, 'cropped to a corner');
  assert.equal(Photos.similar(a, corner).how, 'cropped copy');
  assert.ok(Photos.similar(a, brighter).match, 'brightened');
  for (let seed = 11; seed < 21; seed++) {
    const other = await Photos.inspect(await photo(seed));
    assert.ok(!Photos.similar(a, other).match, `photo ${seed} is a different photo`);
  }
});

// ---------------------------------------------------------------------------
test('submitting needs a verified adult account, the licence and every declaration', async () => {
  const { srv, user } = await garage();
  try {
    const anon = agent(srv);
    assert.equal((await anon.req('POST', '/api/garage/submissions', details())).status, 401);

    const unverified = await user('Unverified', { verified: false, licence: false });
    assert.equal((await unverified.req('POST', '/api/garage/submissions', details())).body.code, 'verify');

    const teen = await user('Teen', { age: 15 });
    assert.equal((await teen.req('POST', '/api/garage/submissions', details())).body.code, 'age');
    assert.equal((await teen.req('POST', '/api/garage/licence', { version: LICENCE_VERSION })).status, 403);
    assert.deepEqual((await teen.req('GET', '/api/garage/me')).body.blockers, ['age', 'licence']);

    const noLicence = await user('Nolicence', { licence: false });
    assert.equal((await noLicence.req('POST', '/api/garage/submissions', details())).body.code, 'licence');
    assert.equal((await noLicence.req('POST', '/api/garage/licence', { version: '0.0' })).status, 400);

    const ok = await user('Ready');
    const me = (await ok.req('GET', '/api/garage/me')).body;
    assert.equal(me.canSubmit, true);
    const missing = await ok.req('POST', '/api/garage/submissions', details({ declarations: { ...allTrue, realPhoto: false } }));
    assert.equal(missing.status, 400);
    assert.deepEqual(missing.body.missing, ['realPhoto']);
    assert.equal((await ok.req('POST', '/api/garage/submissions', details({ make: '' }))).status, 400);
    assert.equal((await ok.req('POST', '/api/garage/submissions', details({ year: 1700 }))).status, 400);
    assert.equal((await ok.req('POST', '/api/garage/submissions', details({ licenceVersion: 'old' }))).body.code, 'licence');
    const made = await ok.req('POST', '/api/garage/submissions', details());
    assert.equal(made.status, 201);
    assert.equal(made.body.submission.status, 'draft');
  } finally { await srv.stop(); }
});

test('upload: bad files are refused, good ones wait for review and stay private', async () => {
  const { srv, user } = await garage();
  try {
    const ann = await user('Ann');
    const c = await ann.req('POST', '/api/garage/submissions', details());
    const id = c.body.submission.id;
    const small = await ann.raw('PUT', `/api/garage/submissions/${id}/photo`, await photo(1, { w: 800, h: 600 }));
    assert.equal(small.status, 422);
    assert.match(small.body.error, /at least/);
    const huge = await ann.raw('PUT', `/api/garage/submissions/${id}/photo`, Buffer.alloc(17 * 1024 * 1024, 1));
    assert.equal(huge.status, 413);
    assert.equal((await ann.req('GET', `/api/garage/submissions/${id}`)).body.submission.status, 'draft', 'still a draft');

    const up = await ann.raw('PUT', `/api/garage/submissions/${id}/photo`, await photo(30));
    assert.equal(up.status, 200, JSON.stringify(up.body));
    const sub = up.body.submission;
    assert.equal(sub.status, 'pending');
    assert.equal(sub.statusLabel, 'Pending review');
    const imageId = sub.image.id;

    // Not visible to anyone else until approved.
    assert.equal((await agent(srv).req('GET', `/api/garage/photos/${imageId}/medium`)).status, 404);
    const bob = await user('Bob');
    assert.equal((await bob.req('GET', `/api/garage/photos/${imageId}/medium`)).status, 404);
    assert.equal((await bob.req('GET', `/api/garage/submissions/${id}`)).status, 404, 'other people’s submissions are private');
    const own = await ann.req('GET', `/api/garage/photos/${imageId}/medium`);
    assert.equal(own.status, 200);
    assert.equal(own.headers.get('cache-control'), 'private, no-store');

    // The original is kept privately, never in the public folder.
    assert.ok(fs.existsSync(path.join(srv.dataDir, 'garage', 'originals', imageId)));
    assert.equal((await ann.req('GET', `/api/garage/mod/original/${imageId}`)).status, 403);

    // Provenance record.
    const img = srv.db.get('SELECT * FROM images WHERE id = ?', imageId);
    assert.equal(img.source, 'community');
    assert.equal(img.moderation, 'pending');
    assert.equal(img.eligibility, 'pending');
    assert.match(img.licence, /Contributor Licence/);
    assert.ok(JSON.parse(img.licence_evidence).acceptance);
    assert.deepEqual(srv.db.all('SELECT user_id, relation FROM image_contributors WHERE image_id = ?', imageId).map(r => ({ ...r })), [{ user_id: ann.id, relation: 'uploader' }]);
  } finally { await srv.stop(); }
});

test('moderation: approve with vehicle, year and blur; reasons required; audit trail kept', async () => {
  const { srv, user } = await garage();
  try {
    const boss = await user('Boss'); // admin via ADMIN_EMAILS
    const ann = await user('Ann');
    assert.equal((await ann.req('GET', '/api/garage/mod/queue')).status, 403, 'players can’t moderate');

    const { id, upload } = await submit(ann, await photo(40), { model: '918', trim: 'Spyder' });
    const imageId = upload.body.submission.image.id;
    const q = await boss.req('GET', '/api/garage/mod/queue');
    assert.equal(q.status, 200);
    assert.equal(q.body.submissions[0].id, id);
    assert.equal(q.body.submissions[0].contributor.displayName, 'Ann');
    const detail = (await boss.req('GET', `/api/garage/mod/submissions/${id}`)).body.submission;
    assert.equal(detail.suggestions[0].key, 'porsche|918spyder|', 'suggests the matching vehicle');
    assert.equal((await boss.req('GET', `/api/garage/mod/original/${imageId}`)).status, 200);

    assert.equal((await approve(boss, id, { vehicleKey: 'nope' })).status, 400);
    assert.equal((await approve(boss, id, { year: 1990 })).status, 400, 'year must fit the vehicle');
    assert.equal((await boss.req('POST', `/api/garage/mod/submissions/${id}/decision`, { action: 'reject' })).status, 400, 'reason required');
    const ok = await approve(boss, id, { eligibility: 'competitive', blur: [{ x: 0.4, y: 0.7, w: 0.2, h: 0.1 }, { x: 'bad' }] });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(ok.body.submission.status, 'approved');
    assert.deepEqual(ok.body.submission.image.blur, [{ x: 0.4, y: 0.7, w: 0.2, h: 0.1 }]);
    assert.equal(ok.body.submission.image.eligibility, 'competitive');
    assert.equal((await approve(boss, id)).status, 409, 'already decided');

    const pub = await agent(srv).req('GET', `/api/garage/photos/${imageId}/large`);
    assert.equal(pub.status, 200);
    assert.equal(pub.headers.get('content-type'), 'image/webp');
    assert.equal((await sharp(pub.buf).metadata()).exif, undefined);

    const actions = srv.db.all(`SELECT action FROM audit_log WHERE entity_id IN (?, ?) ORDER BY id`, id, imageId).map(r => r.action);
    assert.deepEqual(actions, ['submission.create', 'submission.photo', 'submission.approve']);
    const mine = (await ann.req('GET', '/api/garage/submissions')).body.submissions[0];
    assert.equal(mine.statusLabel, 'Approved');
    assert.equal(mine.image.vehicle.label, 'Porsche 918 Spyder');

    // Moderators can't approve their own photos.
    const own = await submit(boss, await photo(41));
    assert.equal((await approve(boss, own.id)).status, 403);
  } finally { await srv.stop(); }
});

test('needs correction and rejection reach the contributor; rejected files are deleted', async () => {
  const { srv, user } = await garage();
  try {
    const boss = await user('Boss');
    const ann = await user('Ann');
    const one = await submit(ann, await photo(50), { model: 'Spider' });
    const nc = await boss.req('POST', `/api/garage/mod/submissions/${one.id}/decision`, { action: 'needs_correction', reason: 'Is this the 918 Spyder? Check the model.' });
    assert.equal(nc.status, 200);
    let mine = (await ann.req('GET', `/api/garage/submissions/${one.id}`)).body.submission;
    assert.equal(mine.statusLabel, 'Needs correction');
    assert.match(mine.reason, /918/);
    const fixed = await ann.req('PATCH', `/api/garage/submissions/${one.id}`, { model: '918 Spyder', resubmit: true });
    assert.equal(fixed.status, 200);
    assert.equal(fixed.body.submission.status, 'pending');
    assert.equal(fixed.body.submission.vehicle.model, '918 Spyder');
    assert.equal((await ann.req('PATCH', `/api/garage/submissions/${one.id}`, { model: 'x' })).status, 409, 'no edits while in review');

    // A correction can also replace the photo: the old one is retired.
    const oldImage = fixed.body.submission.image.id;
    await boss.req('POST', `/api/garage/mod/submissions/${one.id}/decision`, { action: 'needs_correction', reason: 'Plate is readable, please crop or blur it.' });
    const swap = await ann.raw('PUT', `/api/garage/submissions/${one.id}/photo`, await photo(52));
    assert.equal(swap.status, 200);
    assert.equal(swap.body.submission.status, 'pending');
    assert.notEqual(swap.body.submission.image.id, oldImage);
    assert.equal(srv.db.get('SELECT moderation FROM images WHERE id = ?', oldImage).moderation, 'rejected');

    const two = await submit(ann, await photo(51));
    const imageId = two.upload.body.submission.image.id;
    const rej = await boss.req('POST', `/api/garage/mod/submissions/${two.id}/decision`, { action: 'reject', reason: 'The car is too small in the frame.' });
    assert.equal(rej.status, 200);
    mine = (await ann.req('GET', `/api/garage/submissions/${two.id}`)).body.submission;
    assert.equal(mine.statusLabel, 'Rejected');
    assert.equal(mine.reason, 'The car is too small in the frame.');
    assert.equal(mine.image.preview, null);
    assert.ok(!fs.existsSync(path.join(srv.dataDir, 'garage', 'originals', imageId)));
    assert.ok(!fs.existsSync(path.join(srv.dataDir, 'garage', 'web', imageId)));
    assert.equal(srv.db.get('SELECT eligibility FROM images WHERE id = ?', imageId).eligibility, 'removed');
  } finally { await srv.stop(); }
});

test('duplicates: same contributor refused, another contributor’s copy is flagged and both are linked', async () => {
  const { srv, user } = await garage();
  try {
    const boss = await user('Boss');
    const ann = await user('Ann');
    const bob = await user('Bob');
    const orig = await photo(60);
    const first = await submit(ann, orig);
    const firstImage = first.upload.body.submission.image.id;

    const again = await submit(ann, orig);
    assert.equal(again.upload.status, 409);
    assert.equal(again.upload.body.duplicateOf, firstImage);

    const copy = await sharp(orig).resize(1400).jpeg({ quality: 70 }).withExif({ IFD0: { Make: 'Other' } }).toBuffer();
    const second = await submit(bob, copy);
    assert.equal(second.upload.status, 200);
    assert.equal(second.upload.body.checks[0].code, 'duplicate');
    const secondImage = second.upload.body.submission.image.id;

    // Both photos now list both people, so neither appears in a competitive game with either of them.
    const who = id => srv.db.all('SELECT user_id FROM image_contributors WHERE image_id = ? ORDER BY user_id', id).map(r => r.user_id);
    assert.deepEqual(who(firstImage), [ann.id, bob.id].sort());
    assert.deepEqual(who(secondImage), [ann.id, bob.id].sort());

    const view = (await boss.req('GET', `/api/garage/mod/submissions/${second.id}`)).body.submission;
    assert.equal(view.duplicateOf.id, firstImage);
    assert.equal(view.duplicateOf.sameContributor, false);
    const blocked = await approve(boss, second.id);
    assert.equal(blocked.status, 409);
    assert.equal(blocked.body.code, 'duplicate');
    assert.equal((await approve(boss, second.id, { confirmDuplicate: true })).status, 200);
  } finally { await srv.stop(); }
});

test('removal takes a photo out of delivery straight away: contributor, moderator, closed account', async () => {
  const { srv, user } = await garage();
  try {
    const boss = await user('Boss');
    const ann = await user('Ann');
    const pubOk = async imageId => (await agent(srv).req('GET', `/api/garage/photos/${imageId}/small`)).status;

    const a = await submit(ann, await photo(70));
    const aImg = a.upload.body.submission.image.id;
    await approve(boss, a.id);
    assert.equal(await pubOk(aImg), 200);
    const del = await ann.req('DELETE', `/api/garage/submissions/${a.id}`);
    assert.equal(del.body.submission.statusLabel, 'Removed');
    assert.equal(await pubOk(aImg), 404);
    assert.equal(srv.db.get('SELECT eligibility FROM images WHERE id = ?', aImg).eligibility, 'removed');

    const b = await submit(ann, await photo(71));
    const bImg = b.upload.body.submission.image.id;
    await approve(boss, b.id);
    assert.equal((await boss.req('POST', `/api/garage/mod/images/${bImg}/remove`, {})).status, 400, 'reason required');
    assert.equal((await boss.req('POST', `/api/garage/mod/images/${bImg}/remove`, { reason: 'Copyright complaint upheld' })).status, 200);
    assert.equal(await pubOk(bImg), 404);
    assert.equal((await ann.req('GET', `/api/garage/submissions/${b.id}`)).body.submission.status, 'removed');

    const c = await submit(ann, await photo(72));
    const cImg = c.upload.body.submission.image.id;
    await approve(boss, c.id);
    const pending = await submit(ann, await photo(73));
    assert.equal((await ann.req('POST', '/api/auth/close', { confirm: 'close' })).status, 200);
    await new Promise(r => setTimeout(r, 100)); // file deletion runs after the response
    assert.equal(await pubOk(cImg), 404);
    assert.equal(srv.db.get('SELECT moderation FROM images WHERE id = ?', cImg).moderation, 'removed');
    assert.equal(srv.db.get('SELECT status FROM submissions WHERE id = ?', pending.id).status, 'removed');
    assert.ok(!fs.existsSync(path.join(srv.dataDir, 'garage', 'originals', cImg)));
    // The record stays, without the image, for disputes.
    assert.ok(srv.db.get('SELECT sha256 FROM images WHERE id = ?', cImg).sha256);
  } finally { await srv.stop(); }
});

test('competitive eligibility: flagged or AI-marked photos stay out of competitive play', async () => {
  const { srv, user } = await garage();
  try {
    const boss = await user('Boss');
    const ann = await user('Ann');
    const ai = await submit(ann, await photo(80, { exif: { IFD0: { Software: 'Adobe Firefly' } } }));
    assert.ok(ai.upload.body.checks.some(f => f.code === 'ai'));
    assert.equal((await approve(boss, ai.id, { eligibility: 'competitive' })).status, 409);
    assert.equal((await approve(boss, ai.id, { eligibility: 'casual' })).status, 200);

    const ok = await submit(ann, await photo(81));
    const img = ok.upload.body.submission.image.id;
    await approve(boss, ok.id, { eligibility: 'competitive' });
    const flag = await boss.req('POST', `/api/garage/mod/images/${img}/state`, { flagged: true, reason: 'Reported as edited' });
    assert.equal(flag.status, 200);
    assert.equal(flag.body.image.eligibility, 'casual', 'flagging drops it to casual');
    assert.equal((await boss.req('POST', `/api/garage/mod/images/${img}/state`, { eligibility: 'competitive' })).status, 409);
    assert.equal((await boss.req('POST', `/api/garage/mod/images/${img}/state`, { flagged: false, eligibility: 'competitive', difficulty: 5 })).body.image.difficulty, 5);
    assert.equal((await boss.req('POST', `/api/garage/mod/images/${img}/state`, { eligibility: 'restricted' })).status, 200);
    assert.equal((await agent(srv).req('GET', `/api/garage/photos/${img}/small`)).status, 404, 'restricted photos aren’t public');
    assert.equal((await boss.req('GET', '/api/garage/mod/audit')).body.entries[0].action, 'image.state');
  } finally { await srv.stop(); }
});

test('limits: submissions per day; admins appoint moderators and suspend contributors', async () => {
  const { srv, user } = await garage();
  try {
    const boss = await user('Boss');
    const ann = await user('Ann');
    for (let i = 0; i < 20; i++) assert.equal((await ann.req('POST', '/api/garage/submissions', details())).status, 201);
    assert.equal((await ann.req('POST', '/api/garage/submissions', details())).status, 429);

    const cleo = await user('Cleo');
    assert.equal((await cleo.req('GET', '/api/garage/mod/queue')).status, 403);
    assert.equal((await cleo.req('POST', `/api/garage/admin/users/${ann.id}`, { role: 'moderator' })).status, 403);
    assert.equal((await boss.req('POST', `/api/garage/admin/users/${cleo.id}`, { role: 'moderator' })).status, 200);
    assert.equal((await cleo.req('GET', '/api/garage/mod/queue')).status, 200);
    assert.equal((await cleo.req('GET', '/api/garage/admin/users')).status, 403, 'moderators aren’t admins');
    assert.equal((await boss.req('POST', `/api/garage/admin/users/${boss.id}`, { role: 'user' })).status, 400);

    assert.equal((await boss.req('POST', `/api/garage/admin/users/${ann.id}`, { status: 'suspended', reason: 'Repeated copyright complaints' })).status, 200);
    assert.equal((await ann.req('POST', '/api/garage/submissions', details())).status, 401, 'signed out');
  } finally { await srv.stop(); }
});

test('moderators add vehicles the game doesn’t have, without making any answer ambiguous', async () => {
  const { srv, user } = await garage();
  try {
    const boss = await user('Boss');
    const ann = await user('Ann');
    const add = (a, body) => a.req('POST', '/api/garage/mod/vehicles', { region: 'japan', yearFrom: 1986, yearTo: 1993, ...body });
    assert.equal((await add(ann, { make: 'Toyota', model: 'Supra', generation: 'A70' })).status, 403, 'players can’t add vehicles');
    assert.equal((await add(boss, { make: '', model: 'Supra' })).status, 400);
    assert.equal((await add(boss, { make: 'Toyota', model: 'Supra', generation: 'A70', yearFrom: 1995, yearTo: 1990 })).status, 400, 'years in order');
    assert.equal((await add(boss, { make: 'Toyota', model: 'Supra', generation: 'A70', region: 'mars' })).status, 400);

    // The same checks npm test runs on cars.json.
    const dup = await add(boss, { make: 'Porsche', model: '918 Spyder', yearFrom: 2013, yearTo: 2015, region: 'germany' });
    assert.equal(dup.status, 409);
    assert.match(dup.body.error, /already in the game/);
    assert.match((await add(boss, { make: 'Toyota', model: 'Supra' })).body.error, /would also fit/, '"Supra" alone is the A80 or A90 too');
    assert.match((await add(boss, { make: 'Porsche', model: 'Macan', modelAliases: '918', region: 'germany', yearFrom: 2014, yearTo: 2026 })).body.error,
      /take “Porsche 918” away from the Porsche 918 Spyder/, '"918" alone is the 918 Spyder today');
    assert.match((await add(boss, { make: 'Honda', model: 'Beat', generation: 'PP1', yearFrom: 1991, yearTo: 1996 })).body.error,
      /take “Honda Beat” away from the Honda Beat/, 'the existing Beat would lose its full-credit name');
    assert.equal((await add(boss, { make: 'Porsche', model: 'Macan', region: 'germany', yearFrom: 2014, yearTo: 2026 })).status, 201, 'without the borrowed name it’s fine');

    const ok = await add(boss, { make: 'Toyota', model: 'Supra', generation: 'A70', generationAliases: 'Mk3, MkIII' });
    assert.equal(ok.status, 201, JSON.stringify(ok.body));
    assert.deepEqual(ok.body.vehicle, { key: 'toyota|supra|a70', label: 'Toyota Supra (A70)', years: [1986, 1993], added: true });
    const found = (await boss.req('GET', '/api/garage/mod/vehicles?q=supra a70')).body.vehicles;
    assert.deepEqual(found.map(v => [v.key, v.added]), [['toyota|supra|a70', true]]);
    assert.ok(srv.db.get(`SELECT 1 FROM audit_log WHERE action = 'vehicle.create' AND entity_id = 'toyota|supra|a70'`));

    // A photo of it can be approved and played, and every mode reads answers about it.
    const { id } = await submit(ann, await photo(60), { make: 'Toyota', model: 'Supra', generation: 'Mk3', year: 1990 });
    const sub = (await boss.req('GET', `/api/garage/mod/submissions/${id}`)).body.submission;
    assert.equal(sub.suggestions[0].key, 'toyota|supra|a70', 'suggested from the contributor’s details');
    assert.equal((await approve(boss, id, { vehicleKey: 'toyota|supra|a70', year: 1990 })).status, 200);
    const item = srv.garage.roundItems().find(i => i.vkey === 'toyota|supra|a70');
    assert.ok(item, 'in the round pool');
    const pts = (car, answer, year = car.year) => VCScore.scoreRound(car, { car: answer, year: String(year) }, { index: srv.index, ruleset: 'competitive', kind: 'car' }).pts;
    assert.equal(pts(item, 'Toyota Supra Mk3'), 10);
    assert.equal(pts(item, 'Supra A70'), 10);
    assert.equal(pts(item, 'Toyota Supra'), 8, 'shared name: partial');
    const a80 = CARS.find(c => c.id === 'toyota-supra-1994');
    assert.equal(pts(a80, 'Toyota Supra A80'), 10, 'the A80 keeps its name');

    // Vehicles are kept: a restarted server knows them.
    const again = createApp({ dataDir: srv.dataDir, garage: true, adminToken: '', log: false, mailer: createMailer({ apiKey: '', log: false }) });
    try { assert.ok(again.index.ids.has('toyota|supra|a70')); } finally { again.close(); }
  } finally { await srv.stop(); }
});

test('decision emails reach the contributor, who can turn them off', async () => {
  const { srv, mailer, user } = await garage();
  try {
    const boss = await user('Boss');
    const ann = await user('Ann');
    const mailTo = who => mailer.outbox.filter(m => m.to === `${who}@example.com` && !/Confirm/.test(m.subject));
    const one = await submit(ann, await photo(80), { model: 'Spider' });
    await boss.req('POST', `/api/garage/mod/submissions/${one.id}/decision`, { action: 'needs_correction', reason: 'Is this the 918 Spyder?' });
    let m = mailTo('ann').pop();
    assert.equal(m.subject, 'Your VicCall photo needs a change');
    assert.match(m.text, /Is this the 918 Spyder\?/);
    assert.match(m.text, /http:\/\/vc\.test\/\?garage=mine/);
    assert.match(m.text, /turn these emails off/);

    await ann.req('PATCH', `/api/garage/submissions/${one.id}`, { model: '918 Spyder', resubmit: true });
    await approve(boss, one.id, { eligibility: 'competitive' });
    m = mailTo('ann').pop();
    assert.equal(m.subject, 'Your photo is in VicCall');
    assert.match(m.text, /Porsche 918 Spyder was approved/);
    assert.match(m.text, /every mode/);

    const imageId = srv.db.get('SELECT image_id FROM submissions WHERE id = ?', one.id).image_id;
    await boss.req('POST', `/api/garage/mod/images/${imageId}/remove`, { reason: 'The plate is readable.' });
    m = mailTo('ann').pop();
    assert.equal(m.subject, 'Your VicCall photo was removed');
    assert.match(m.text, /The plate is readable\./);
    assert.equal(mailTo('ann').length, 3);

    // Turned off: decisions still happen, no email.
    const off = await ann.req('POST', '/api/auth/profile', { notifyEmail: false });
    assert.equal(off.body.user.notifyEmail, false);
    const two = await submit(ann, await photo(81));
    assert.equal((await boss.req('POST', `/api/garage/mod/submissions/${two.id}/decision`, { action: 'reject', reason: 'Too small in the frame.' })).status, 200);
    assert.equal(mailTo('ann').length, 3);
  } finally { await srv.stop(); }
});

test('uploads of the game’s own photos: copies refused without naming the car, near matches go to the moderator', async () => {
  const gamePhoto = await photo(70);
  const car = CARS.find(c => c.id === 'porsche-918-spyder-2013');
  const prints = createPhotoPrints({ cars: CARS, prints: { [car.id]: { credit: car.credit, hashes: await Photos.printsOf(gamePhoto) } }, log: false });
  const { srv, user } = await garage({ photoPrints: prints });
  try {
    const boss = await user('Boss');
    const ann = await user('Ann');
    const crop = scale => {
      const w = Math.round(1600 * scale), h = Math.round(1000 * scale);
      return sharp(gamePhoto).extract({ left: Math.round((1600 - w) / 2), top: Math.round((1000 - h) / 2), width: w, height: h })
        .resize(1500).jpeg({ quality: 88 }).withExif({ IFD0: { Make: 'X' } }).toBuffer();
    };
    const resaved = await sharp(gamePhoto).resize(1400).jpeg({ quality: 70 }).withExif({ IFD0: { Make: 'X' } }).toBuffer();
    for (const copy of [gamePhoto, resaved, await crop(0.85)]) {
      const { upload } = await submit(ann, copy);
      assert.equal(upload.status, 409);
      assert.equal(upload.body.code, 'first_party');
      assert.doesNotMatch(upload.body.error, /Porsche|918/, 'never says which car it is');
    }
    assert.equal(srv.db.get(`SELECT COUNT(*) n FROM audit_log WHERE action = 'submission.first_party_copy'`).n, 3);

    // A heavier crop is close but not certain: accepted, and only the moderator sees why.
    const near = await submit(ann, await crop(0.8));
    assert.equal(near.upload.status, 200, JSON.stringify(near.upload.body));
    assert.ok(!near.upload.body.checks.some(c => c.code === 'first-party'));
    assert.ok(!(await ann.req('GET', `/api/garage/submissions/${near.id}`)).body.submission.checks.some(c => c.code === 'first-party'));
    const flag = (await boss.req('GET', `/api/garage/mod/submissions/${near.id}`)).body.submission.checks.find(c => c.code === 'first-party');
    assert.match(flag.text, /Porsche 918 Spyder/);

    const other = await submit(ann, await photo(71));
    assert.equal(other.upload.status, 200);
    assert.ok(!(await boss.req('GET', `/api/garage/mod/submissions/${other.id}`)).body.submission.checks.some(c => c.code === 'first-party'));
  } finally { await srv.stop(); }
});

test('first-party fingerprints: the shipped file is well formed, and changed photos are fingerprinted again', async () => {
  const ids = new Set(CARS.map(c => c.id));
  for (const [id, p] of Object.entries(readPrints(SHIPPED))) {
    assert.ok(ids.has(id), `${id} is a car`);
    assert.ok(typeof p.credit === 'string' && p.credit, `${id}.credit`);
    assert.deepEqual(Object.keys(p.hashes).sort(), ['bl', 'br', 'c70', 'c85', 'full', 'tl', 'tr'], `${id} hashes`);
    assert.ok(Object.values(p.hashes).every(h => /^[0-9a-f]{16}$/.test(h)), `${id} hash format`);
  }

  // An entry whose credit no longer matches the car's photo doesn't count, and fill() replaces it.
  const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'vc-prints-'));
  try {
    const cars = [{ id: 'a', make: 'A', model: 'One', img: 'https://x.test/a.jpg', credit: 'A new.jpg' }, { id: 'b', make: 'B', model: 'Two', img: 'https://x.test/b.jpg', credit: 'B.jpg' }];
    const [pa, pb] = [await photo(90), await photo(91)];
    const shipped = path.join(dir, 'shipped.json');
    fs.writeFileSync(shipped, JSON.stringify({ a: { credit: 'A old.jpg', hashes: await Photos.printsOf(pb) }, b: { credit: 'B.jpg', hashes: await Photos.printsOf(pb) } }));
    const asked = [];
    const fetch = async url => { asked.push(url); return new Response(url.endsWith('a.jpg') ? pa : pb, { headers: { 'content-type': 'image/jpeg' } }); };
    const prints = createPhotoPrints({ cars, dataDir: dir, shipped, fetch, log: false });
    assert.deepEqual(prints.missing().map(c => c.id), ['a']);
    assert.equal(prints.match({ hashes: await Photos.printsOf(pa) }), null, 'the old entry isn’t used');
    assert.deepEqual(await prints.fill({ delayMs: 0 }), { done: 1, failed: 0, missing: 0 });
    assert.deepEqual(asked, ['https://x.test/a.jpg']);
    assert.equal(prints.match({ hashes: await Photos.printsOf(pa) }).car, 'a');
    assert.equal(createPhotoPrints({ cars, dataDir: dir, shipped, fetch, log: false }).missing().length, 0, 'kept in DATA_DIR');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
