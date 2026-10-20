/*
 * Community Garage: photo submissions, moderation and photo delivery.
 *
 *   Upload -> automated checks -> moderation -> approval -> game pool
 *
 * Nothing a contributor uploads is shown to other players until a moderator
 * approves it. Originals are stored privately; players only ever receive
 * re-encoded copies with the metadata stripped and any blur applied.
 *
 * Every image keeps a provenance record (source, licence, evidence, who
 * contributed it) and every moderation action is written to the audit log.
 */
const express = require('express');
const crypto = require('crypto');
const fsp = require('fs/promises');
const path = require('path');
const sharp = require('sharp');
const Photos = require('./photos');

const LICENCE_VERSION = '0.1-draft';
const LICENCE_NAME = `VicCall Contributor Licence ${LICENCE_VERSION}`;
// Section 5 of the licence: each submission confirms all of these.
const DECLARATIONS = {
  tookIt: 'I took this photo myself and own all rights in it.',
  noConflict: 'No one else has an exclusive licence or other claim that conflicts with this licence.',
  realPhoto: 'It’s a real photograph, not AI-generated, and the car hasn’t been edited to look like something it isn’t.',
  honestDetails: 'The vehicle details are my honest best knowledge.',
  peopleConsent: 'Anyone recognisable agreed to be photographed, or I’ve asked for them to be blurred.',
  lawful: 'Taking and sharing it didn’t break the law or rules I agreed to.',
};
const STATUS_LABEL = {
  draft: 'Draft', pending: 'Pending review', needs_correction: 'Needs correction',
  approved: 'Approved', rejected: 'Rejected', removed: 'Removed',
};
const UPLOADS_PER_DAY = 20;
const MAX_OPEN = 25;          // drafts + pending + needs correction at once
const PUBLIC_ELIGIBILITY = ['casual', 'competitive'];
const ANON_CREDIT = 'Community photographer';

const newId = prefix => `${prefix}_${crypto.randomBytes(9).toString('base64url')}`;
const ID_RE = /^(img|sub)_[A-Za-z0-9_-]{8,20}$/;
const text = (v, max) => (v == null ? '' : String(v)).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const bool = v => v === true || v === 1 || v === '1' || v === 'true';
// Express 4 doesn't catch rejected promises: pass them to the error handler.
const safe = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const parseJson = (s, fallback) => { try { return s ? JSON.parse(s) : fallback; } catch { return fallback; } };

/* Files live under DATA_DIR/garage. Keys are built from validated ids only. */
function fileStore(root) {
  const abs = key => path.join(root, key);
  return {
    async put(key, buf) {
      const p = abs(key);
      await fsp.mkdir(path.dirname(p), { recursive: true });
      const tmp = `${p}.${process.pid}.tmp`;
      await fsp.writeFile(tmp, buf);
      await fsp.rename(tmp, p);
    },
    async get(key) { try { return await fsp.readFile(abs(key)); } catch { return null; } },
    async remove(key) { await fsp.rm(abs(key), { recursive: true, force: true }); },
    async exists(key) { try { await fsp.access(abs(key)); return true; } catch { return false; } },
  };
}

// Image processing is CPU-heavy: run at most two at a time, queue the rest.
function gate(max) {
  let active = 0;
  const queue = [];
  const next = () => { if (active < max && queue.length) { active++; queue.shift()(); } };
  return fn => new Promise((resolve, reject) => {
    queue.push(() => Promise.resolve().then(fn).then(resolve, reject).finally(() => { active--; next(); }));
    next();
  });
}

function createGarage({ db, auth, dataDir, limit, cars, index, VCScore }) {
  const store = fileStore(path.join(dataDir, 'garage'));
  const processing = gate(2);
  const router = express.Router();
  const now = () => Date.now();
  const thisYear = () => new Date().getUTCFullYear();
  const carsById = new Map(cars.map(c => [c.id, c]));

  router.use(auth.csrf);

  const contributor = auth.requireUser({ complete: true, verified: true, adult: true });
  const signedIn = auth.requireUser();
  const moderator = auth.requireUser({ role: 'moderator' });
  const admin = auth.requireUser({ role: 'admin' });

  // ---- helpers ----
  const creditFor = userId => {
    const u = userId && db.get('SELECT display_name, credit_anonymous, status FROM users WHERE id = ?', userId);
    if (!u || u.status === 'closed' || u.credit_anonymous || !u.display_name) return ANON_CREDIT;
    return u.display_name;
  };
  const acceptedLicence = userId => !!db.get('SELECT 1 FROM licence_acceptances WHERE user_id = ? AND version = ?', userId, LICENCE_VERSION);
  const vehicleOf = key => (key && index.ids.get(key)) || null;
  const vehicleLabel = v => v && [v.make, v.model, v.generation ? `(${v.generation})` : ''].filter(Boolean).join(' ');
  const photoUrl = (imageId, size = 'medium') => `/api/garage/photos/${imageId}/${size}`;
  const contributorsOf = imageId => db.all('SELECT user_id, relation FROM image_contributors WHERE image_id = ?', imageId);

  function viewSubmission(s, { forModerator = false } = {}) {
    const img = s.image_id ? db.get('SELECT * FROM images WHERE id = ?', s.image_id) : null;
    const out = {
      id: s.id, status: s.status, statusLabel: STATUS_LABEL[s.status], reason: s.reason || null,
      createdAt: s.created_at, updatedAt: s.updated_at,
      vehicle: { make: s.make, model: s.model, trim: s.trim, generation: s.generation, year: s.year },
      modified: !!s.modified, kit: s.kit, mods: s.mods,
      location: s.location_text, showLocation: !!s.show_location, event: s.event, notes: s.notes,
      promo: !!s.promo_opt_in, licenceVersion: s.licence_version,
      image: img && {
        id: img.id, width: img.width, height: img.height, moderation: img.moderation, eligibility: img.eligibility,
        preview: img.moderation === 'removed' || img.moderation === 'rejected' ? null : photoUrl(img.id),
        vehicle: img.vehicle_key ? { key: img.vehicle_key, label: vehicleLabel(vehicleOf(img.vehicle_key)), year: img.year } : null,
      },
      checks: parseJson(s.flags, []),
    };
    if (forModerator) {
      const u = db.get('SELECT id, display_name, status, created_at FROM users WHERE id = ?', s.user_id);
      out.contributor = u && { id: u.id, displayName: u.display_name, status: u.status, joined: u.created_at,
        approved: db.get(`SELECT COUNT(*) n FROM submissions WHERE user_id = ? AND status = 'approved'`, u.id).n,
        rejected: db.get(`SELECT COUNT(*) n FROM submissions WHERE user_id = ? AND status = 'rejected'`, u.id).n };
      out.declarations = parseJson(s.declarations, {});
      if (img) {
        out.image.flagged = !!img.flagged;
        out.image.takedown = img.takedown;
        out.image.difficulty = img.difficulty;
        out.image.licence = img.licence;
        out.image.original = `/api/garage/mod/original/${img.id}`;
        out.image.contributors = contributorsOf(img.id).map(c => ({ ...c, displayName: creditFor(c.user_id) }));
        out.image.blur = parseJson(img.restrictions, {}).blur || [];
      }
      if (s.duplicate_of) {
        const d = db.get('SELECT id, moderation, eligibility, contributor_id FROM images WHERE id = ?', s.duplicate_of);
        out.duplicateOf = d && { id: d.id, moderation: d.moderation, eligibility: d.eligibility,
          sameContributor: d.contributor_id === s.user_id, preview: d.moderation === 'removed' ? null : photoUrl(d.id, 'small') };
      }
    }
    return out;
  }

  // Delete the files and take an image out of delivery and selection.
  async function retireImage(imageId, { moderation, actorId, reason, keepOriginal = false }) {
    db.tx(() => {
      db.run(`UPDATE images SET moderation = ?, eligibility = 'removed', updated_at = ? WHERE id = ?`, moderation, now(), imageId);
      db.audit(actorId, `image.${moderation === 'rejected' ? 'reject' : 'remove'}`, 'image', imageId, { reason });
    });
    await store.remove(`web/${imageId}`);
    if (!keepOriginal) await store.remove(`originals/${imageId}`);
  }

  // Put everyone with a claim on any copy of this photo on every copy, so the
  // competitive exclusion covers duplicates whoever uploaded them.
  function linkDuplicates(imageIds) {
    const ids = [...new Set(imageIds)];
    const users = new Set();
    for (const id of ids) for (const c of contributorsOf(id)) users.add(c.user_id);
    const t = now();
    for (const id of ids) {
      for (const u of users) {
        db.run(`INSERT OR IGNORE INTO image_contributors (image_id, user_id, relation, created_at) VALUES (?, ?, 'duplicate', ?)`, id, u, t);
      }
    }
  }

  // Vehicles a submission's details could refer to, for the moderator.
  function suggestVehicles(s) {
    const answer = [s.make, s.model, s.trim, s.generation].filter(Boolean).join(' ');
    if (!answer) return [];
    const out = [];
    for (const id of index.ids.values()) {
      const car = carsById.get(id.cars[0]);
      if (!car) continue;
      const r = VCScore.scoreRound(car, { car: answer }, { index, ruleset: 'casual' });
      const model = r.res.find(x => x.label === 'Model');
      if (!model || !model.pts) continue;
      const yearFits = s.year && s.year >= id.lo - 1 && s.year <= id.hi + 1;
      out.push({ key: id.key, label: vehicleLabel(id), years: [id.lo, id.hi], score: model.pts + (yearFits ? 1 : 0), exact: model.verdict === 'hit' });
    }
    return out.sort((a, b) => b.score - a.score || a.label.localeCompare(b.label)).slice(0, 6);
  }

  function cleanDetails(b, { partial = false } = {}) {
    const d = {};
    const errors = [];
    const has = k => Object.prototype.hasOwnProperty.call(b, k);
    const want = k => !partial || has(k);
    if (want('make')) { d.make = text(b.make, 40); if (!d.make) errors.push('Enter the make.'); }
    if (want('model')) { d.model = text(b.model, 60); if (!d.model) errors.push('Enter the model.'); }
    if (want('trim')) d.trim = text(b.trim, 60) || null;
    if (want('generation')) d.generation = text(b.generation, 40) || null;
    if (want('year')) {
      if (b.year === '' || b.year == null) d.year = null;
      else {
        const y = Number(b.year);
        if (!Number.isInteger(y) || y < 1886 || y > thisYear() + 1) errors.push('Enter a model year between 1886 and next year, or leave it blank.');
        else d.year = y;
      }
    }
    if (want('modified')) d.modified = bool(b.modified) ? 1 : 0;
    if (want('kit')) d.kit = text(b.kit, 60) || null;
    if (want('mods')) d.mods = text(b.mods, 300) || null;
    if (want('location')) d.location_text = text(b.location, 80) || null;
    if (want('showLocation')) d.show_location = bool(b.showLocation) ? 1 : 0;
    if (want('event')) d.event = text(b.event, 80) || null;
    if (want('notes')) d.notes = text(b.notes, 500) || null;
    if (want('promo')) d.promo_opt_in = bool(b.promo) ? 1 : 0;
    return { d, errors };
  }

  // ---- public ----
  router.get('/licence', (req, res) => {
    res.json({ version: LICENCE_VERSION, name: LICENCE_NAME, draft: true, declarations: DECLARATIONS });
  });

  router.get('/me', signedIn, (req, res) => {
    const u = req.user;
    const blockers = [];
    if (!u.profile_complete) blockers.push('profile');
    if (!u.email_verified) blockers.push('verify');
    if (!u.adult) blockers.push('age');
    if (!acceptedLicence(u.id)) blockers.push('licence');
    const counts = Object.fromEntries(db.all('SELECT status, COUNT(*) n FROM submissions WHERE user_id = ? GROUP BY status', u.id).map(r => [r.status, r.n]));
    res.json({ licenceVersion: LICENCE_VERSION, licenceAccepted: acceptedLicence(u.id), canSubmit: blockers.length === 0, blockers, counts, limits: { perDay: UPLOADS_PER_DAY, open: MAX_OPEN } });
  });

  router.post('/licence', auth.requireUser({ complete: true }), (req, res) => {
    const b = req.body || {};
    if (b.version !== LICENCE_VERSION) return res.status(400).json({ error: 'That isn’t the current version of the licence. Reload and try again.' });
    if (!req.user.adult) return res.status(403).json({ error: 'You need to be 18 or over to submit photos', code: 'age' });
    if (!acceptedLicence(req.user.id)) {
      const id = newId('lic');
      db.run('INSERT INTO licence_acceptances (id, user_id, version, accepted_at) VALUES (?, ?, ?, ?)', id, req.user.id, LICENCE_VERSION, now());
      db.audit(req.user.id, 'licence.accept', 'user', req.user.id, { version: LICENCE_VERSION, acceptance: id });
    }
    res.json({ ok: true, version: LICENCE_VERSION });
  });

  // Players and visitors only ever get approved, in-use photos. The uploader
  // and moderators can also see photos still in review.
  router.get('/photos/:id/:size', limit(600, 60_000), safe(async (req, res) => {
    const { id, size } = req.params;
    if (!ID_RE.test(id) || !Photos.SIZES[size]) return res.status(404).json({ error: 'not found' });
    const img = db.get('SELECT id, moderation, eligibility, takedown, contributor_id FROM images WHERE id = ?', id);
    if (!img) return res.status(404).json({ error: 'not found' });
    const isPublic = img.moderation === 'approved' && PUBLIC_ELIGIBILITY.includes(img.eligibility) && img.takedown === 'none';
    if (!isPublic) {
      const u = auth.currentUser(req);
      const allowed = u && u.status === 'active' && img.moderation === 'pending' &&
        (u.id === img.contributor_id || u.role === 'moderator' || u.role === 'admin');
      const modSeesApproved = u && (u.role === 'moderator' || u.role === 'admin') && img.moderation === 'approved';
      if (!allowed && !modSeesApproved) return res.status(404).json({ error: 'not found' });
    }
    const buf = await store.get(`web/${id}/${size}.webp`);
    if (!buf) return res.status(404).json({ error: 'not found' });
    res.set('Cache-Control', isPublic ? 'public, max-age=300' : 'private, no-store');
    res.type('image/webp').send(buf);
  }));

  // ---- contributors ----
  router.post('/submissions', contributor, limit(60, 60 * 60_000), (req, res) => {
    const u = req.user;
    const b = req.body || {};
    if (!acceptedLicence(u.id)) return res.status(403).json({ error: 'Accept the contributor licence first', code: 'licence' });
    if (b.licenceVersion !== LICENCE_VERSION) return res.status(400).json({ error: 'The licence has changed. Reload and review it again.', code: 'licence' });
    const decl = b.declarations || {};
    const missing = Object.keys(DECLARATIONS).filter(k => decl[k] !== true);
    if (missing.length) return res.status(400).json({ error: 'Confirm every statement about the photo.', missing });
    const { d, errors } = cleanDetails(b);
    if (errors.length) return res.status(400).json({ error: errors[0], errors });
    const day = db.get('SELECT COUNT(*) n FROM submissions WHERE user_id = ? AND created_at > ?', u.id, now() - 24 * 60 * 60_000).n;
    if (day >= UPLOADS_PER_DAY) return res.status(429).json({ error: `You can submit up to ${UPLOADS_PER_DAY} photos a day. Try again tomorrow.` });
    const open = db.get(`SELECT COUNT(*) n FROM submissions WHERE user_id = ? AND status IN ('draft','pending','needs_correction')`, u.id).n;
    if (open >= MAX_OPEN) return res.status(429).json({ error: `You have ${open} photos waiting. Wait for some to be reviewed before adding more.` });
    const id = newId('sub');
    const t = now();
    db.run(`INSERT INTO submissions (id, user_id, status, make, model, trim, generation, year, modified, kit, mods, location_text, show_location,
              event, notes, promo_opt_in, licence_version, declarations, created_at, updated_at)
            VALUES (?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, u.id, d.make, d.model, d.trim, d.generation, d.year, d.modified, d.kit, d.mods, d.location_text, d.show_location,
    d.event, d.notes, d.promo_opt_in, LICENCE_VERSION, JSON.stringify({ ...Object.fromEntries(Object.keys(DECLARATIONS).map(k => [k, true])), at: t }), t, t);
    db.audit(u.id, 'submission.create', 'submission', id, null);
    res.status(201).json({ submission: viewSubmission(db.get('SELECT * FROM submissions WHERE id = ?', id)) });
  });

  const ownSubmission = (req, res) => {
    const s = ID_RE.test(req.params.id) && db.get('SELECT * FROM submissions WHERE id = ? AND user_id = ?', req.params.id, req.user.id);
    if (!s) { res.status(404).json({ error: 'not found' }); return null; }
    return s;
  };

  router.put('/submissions/:id/photo', contributor, limit(60, 60 * 60_000),
    express.raw({ type: () => true, limit: Photos.LIMITS.maxBytes + 1024 * 1024 }),
    safe(async (req, res) => {
      const u = req.user;
      const s = ownSubmission(req, res);
      if (!s) return;
      if (!['draft', 'needs_correction'].includes(s.status)) return res.status(409).json({ error: 'This submission can’t take a new photo now.' });
      const buf = req.body;
      const check = await processing(() => Photos.inspect(buf));
      if (!check.ok) return res.status(422).json({ error: check.error });

      // Duplicate and derivative detection against every photo on record.
      const matches = [];
      for (const other of db.all('SELECT id, sha256, fingerprints, moderation, contributor_id FROM images WHERE fingerprints IS NOT NULL')) {
        if (s.image_id && other.id === s.image_id) continue;
        const m = Photos.similar(check, { sha256: other.sha256, hashes: parseJson(other.fingerprints, {}) });
        if (m.match) matches.push({ id: other.id, moderation: other.moderation, contributor_id: other.contributor_id, ...m });
      }
      matches.sort((a, b) => a.distance - b.distance);
      // The same file again is refused; a similar shot (a crop, the next frame) goes to a moderator.
      const ownLive = matches.find(m => m.contributor_id === u.id && ['pending', 'approved'].includes(m.moderation) && m.full <= 4);
      if (ownLive) return res.status(409).json({ error: 'You’ve already submitted this photo.', duplicateOf: ownLive.id });

      const imageId = newId('img');
      const derived = await processing(() => Photos.derive(buf));
      await store.put(`originals/${imageId}`, buf);
      for (const [size, data] of Object.entries(derived)) await store.put(`web/${imageId}/${size}.webp`, data);

      const flags = [...check.flags];
      const best = matches[0];
      if (best) {
        flags.unshift({ code: 'duplicate', text: best.contributor_id === u.id
          ? `Matches a photo you submitted before (${best.how}).`
          : `Matches a photo from another contributor (${best.how}). Check who took it.` });
      }
      const flagged = flags.some(f => f.code === 'ai') ? 1 : 0;
      const t = now();
      const previous = s.image_id;
      db.tx(() => {
        db.run(`INSERT INTO images (id, source, source_ref, contributor_id, licence, licence_evidence, permission_at, commercial_ok,
                  attribution, restrictions, moderation, eligibility, flagged, sha256, dhash, dhash_center, fingerprints, width, height, year, created_at, updated_at)
                VALUES (?, 'community', ?, ?, ?, ?, ?, 1, NULL, ?, 'pending', 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        imageId, `upload:${s.id}`, u.id, LICENCE_NAME,
        JSON.stringify({ acceptance: db.get('SELECT id FROM licence_acceptances WHERE user_id = ? AND version = ? ORDER BY accepted_at LIMIT 1', u.id, LICENCE_VERSION).id, submission: s.id }),
        t, JSON.stringify({ promo: !!s.promo_opt_in }), flagged, check.sha256, check.hashes.full, check.hashes.c70, JSON.stringify(check.hashes),
        check.width, check.height, s.year, t, t);
        db.run(`INSERT INTO image_contributors (image_id, user_id, relation, created_at) VALUES (?, ?, 'uploader', ?)`, imageId, u.id, t);
        if (matches.length) linkDuplicates([imageId, ...matches.map(m => m.id)]);
        db.run(`UPDATE submissions SET image_id = ?, status = 'pending', flags = ?, duplicate_of = ?, reason = NULL, updated_at = ? WHERE id = ?`,
          imageId, JSON.stringify(flags), best ? best.id : null, t, s.id);
        db.audit(u.id, 'submission.photo', 'submission', s.id, { image: imageId, replaced: previous || undefined, flags: flags.map(f => f.code), measures: check.measures });
      });
      if (previous) await retireImage(previous, { moderation: 'rejected', actorId: u.id, reason: 'replaced by a new photo' });
      res.json({ submission: viewSubmission(db.get('SELECT * FROM submissions WHERE id = ?', s.id)), checks: flags });
    }));

  router.get('/submissions', signedIn, (req, res) => {
    const rows = db.all('SELECT * FROM submissions WHERE user_id = ? ORDER BY created_at DESC LIMIT 200', req.user.id);
    res.json({ submissions: rows.map(s => viewSubmission(s)) });
  });

  router.get('/submissions/:id', signedIn, (req, res) => {
    const s = ownSubmission(req, res);
    if (s) res.json({ submission: viewSubmission(s) });
  });

  // Edit details while a submission is a draft or needs correction; resubmit for review.
  router.patch('/submissions/:id', contributor, (req, res) => {
    const s = ownSubmission(req, res);
    if (!s) return;
    if (!['draft', 'needs_correction'].includes(s.status)) return res.status(409).json({ error: 'You can only edit a submission while it’s a draft or needs correction.' });
    const b = req.body || {};
    const { d, errors } = cleanDetails(b, { partial: true });
    if (errors.length) return res.status(400).json({ error: errors[0], errors });
    const sets = Object.keys(d).map(k => `${k} = ?`);
    const vals = Object.values(d);
    let status = s.status;
    if (b.resubmit) {
      if (!s.image_id) return res.status(400).json({ error: 'Add the photo first.' });
      status = 'pending';
    }
    db.tx(() => {
      db.run(`UPDATE submissions SET ${[...sets, 'status = ?', 'updated_at = ?'].join(', ')} WHERE id = ?`, ...vals, status, now(), s.id);
      if ('year' in d && s.image_id) db.run('UPDATE images SET year = ?, updated_at = ? WHERE id = ?', d.year, now(), s.image_id);
      if ('promo_opt_in' in d && s.image_id) {
        const r = parseJson(db.get('SELECT restrictions FROM images WHERE id = ?', s.image_id).restrictions, {});
        db.run('UPDATE images SET restrictions = ? WHERE id = ?', JSON.stringify({ ...r, promo: !!d.promo_opt_in }), s.image_id);
      }
      db.audit(req.user.id, b.resubmit ? 'submission.resubmit' : 'submission.edit', 'submission', s.id, { fields: Object.keys(d) });
    });
    res.json({ submission: viewSubmission(db.get('SELECT * FROM submissions WHERE id = ?', s.id)) });
  });

  // Withdraw or remove: takes the photo out of the game straight away.
  router.delete('/submissions/:id', signedIn, safe(async (req, res) => {
    const s = ownSubmission(req, res);
    if (!s) return;
    if (s.status === 'removed') return res.json({ submission: viewSubmission(s) });
    db.tx(() => {
      db.run(`UPDATE submissions SET status = 'removed', updated_at = ? WHERE id = ?`, now(), s.id);
      db.audit(req.user.id, 'submission.remove', 'submission', s.id, { by: 'contributor', was: s.status });
    });
    if (s.image_id) await retireImage(s.image_id, { moderation: 'removed', actorId: req.user.id, reason: 'removed by contributor' });
    res.json({ submission: viewSubmission(db.get('SELECT * FROM submissions WHERE id = ?', s.id)) });
  }));

  // Closing an account removes the person's photos the same way (licence §8).
  auth.onClose(userId => {
    const subs = db.all(`SELECT id, image_id, status FROM submissions WHERE user_id = ? AND status != 'removed'`, userId);
    db.tx(() => {
      for (const s of subs) {
        db.run(`UPDATE submissions SET status = 'removed', updated_at = ? WHERE id = ?`, now(), s.id);
        db.audit(userId, 'submission.remove', 'submission', s.id, { by: 'account closed', was: s.status });
      }
    });
    Promise.all(subs.filter(s => s.image_id).map(s => retireImage(s.image_id, { moderation: 'removed', actorId: userId, reason: 'account closed' })))
      .catch(e => console.error('[garage] removing photos for a closed account failed:', e));
  });

  // ---- moderation ----
  const mod = express.Router();
  mod.use(moderator);

  mod.get('/queue', (req, res) => {
    const status = STATUS_LABEL[req.query.status] ? req.query.status : 'pending';
    const n = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
    const order = status === 'pending' ? 'ASC' : 'DESC'; // oldest first for the review queue
    const rows = db.all(`SELECT * FROM submissions WHERE status = ? ORDER BY updated_at ${order} LIMIT ?`, status, n);
    const counts = Object.fromEntries(db.all('SELECT status, COUNT(*) n FROM submissions GROUP BY status').map(r => [r.status, r.n]));
    res.json({ status, counts, submissions: rows.map(s => viewSubmission(s, { forModerator: true })) });
  });

  mod.get('/submissions/:id', (req, res) => {
    const s = ID_RE.test(req.params.id) && db.get('SELECT * FROM submissions WHERE id = ?', req.params.id);
    if (!s) return res.status(404).json({ error: 'not found' });
    const view = viewSubmission(s, { forModerator: true });
    view.suggestions = suggestVehicles(s);
    view.history = db.all(`SELECT a.at, a.action, a.detail, u.display_name actor FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id
                           WHERE (a.entity = 'submission' AND a.entity_id = ?) OR (a.entity = 'image' AND a.entity_id = ?) ORDER BY a.id`, s.id, s.image_id || '')
      .map(r => ({ ...r, detail: parseJson(r.detail, null) }));
    res.json({ submission: view });
  });

  // Vehicle search for the moderator's "which car is this" field.
  mod.get('/vehicles', (req, res) => {
    const q = text(req.query.q, 80).toLowerCase();
    if (!q) return res.json({ vehicles: [] });
    const words = q.split(' ');
    const out = [];
    for (const id of index.ids.values()) {
      const hay = `${id.make} ${id.model} ${id.generation || ''} ${id.key}`.toLowerCase();
      if (words.every(w => hay.includes(w))) out.push({ key: id.key, label: vehicleLabel(id), years: [id.lo, id.hi] });
      if (out.length >= 20) break;
    }
    res.json({ vehicles: out });
  });

  function cleanBlur(list) {
    if (!Array.isArray(list)) return [];
    return list.slice(0, 20).map(r => ({ x: +r.x, y: +r.y, w: +r.w, h: +r.h }))
      .filter(r => [r.x, r.y, r.w, r.h].every(Number.isFinite) && r.x >= 0 && r.y >= 0 && r.w > 0 && r.h > 0 && r.x < 1 && r.y < 1 && r.w <= 1 && r.h <= 1)
      .map(r => ({ x: +r.x.toFixed(4), y: +r.y.toFixed(4), w: +Math.min(r.w, 1 - r.x).toFixed(4), h: +Math.min(r.h, 1 - r.y).toFixed(4) }));
  }

  mod.post('/submissions/:id/decision', safe(async (req, res) => {
    const s = ID_RE.test(req.params.id) && db.get('SELECT * FROM submissions WHERE id = ?', req.params.id);
    if (!s) return res.status(404).json({ error: 'not found' });
    const b = req.body || {};
    const action = b.action;
    const reason = text(b.reason, 500);
    if (!['approve', 'reject', 'needs_correction'].includes(action)) return res.status(400).json({ error: 'Choose approve, reject or needs correction.' });
    if (s.status !== 'pending' && !(action === 'reject' && s.status === 'needs_correction')) {
      return res.status(409).json({ error: `This submission is ${STATUS_LABEL[s.status].toLowerCase()}, not pending review.` });
    }
    if (!s.image_id) return res.status(409).json({ error: 'There’s no photo to review.' });
    const img = db.get('SELECT * FROM images WHERE id = ?', s.image_id);
    const actor = req.user.id;
    if (s.user_id === actor) return res.status(403).json({ error: 'You can’t review your own photo.' });

    if (action === 'reject' || action === 'needs_correction') {
      if (reason.length < 3) return res.status(400).json({ error: 'Give the contributor a reason.' });
      if (action === 'needs_correction') {
        db.tx(() => {
          db.run(`UPDATE submissions SET status = 'needs_correction', reason = ?, updated_at = ? WHERE id = ?`, reason, now(), s.id);
          db.audit(actor, 'submission.needs_correction', 'submission', s.id, { reason });
        });
      } else {
        db.tx(() => {
          db.run(`UPDATE submissions SET status = 'rejected', reason = ?, updated_at = ? WHERE id = ?`, reason, now(), s.id);
          db.audit(actor, 'submission.reject', 'submission', s.id, { reason });
        });
        await retireImage(img.id, { moderation: 'rejected', actorId: actor, reason });
      }
      return res.json({ submission: viewSubmission(db.get('SELECT * FROM submissions WHERE id = ?', s.id), { forModerator: true }) });
    }

    // Approve: the vehicle must be one the game can score.
    const vehicle = vehicleOf(b.vehicleKey);
    if (!vehicle) return res.status(400).json({ error: 'Choose the vehicle from the list.' });
    const year = b.year == null || b.year === '' ? s.year : Number(b.year);
    if (!Number.isInteger(year) || year < vehicle.lo - 1 || year > vehicle.hi + 1) {
      return res.status(400).json({ error: `Enter the model year (${vehicle.lo === vehicle.hi ? vehicle.lo : `${vehicle.lo}–${vehicle.hi}`} for this vehicle).` });
    }
    const difficulty = b.difficulty == null ? 3 : Number(b.difficulty);
    if (!Number.isInteger(difficulty) || difficulty < 1 || difficulty > 5) return res.status(400).json({ error: 'Difficulty is 1 to 5.' });
    const eligibility = b.eligibility || 'casual';
    if (!['casual', 'competitive', 'restricted'].includes(eligibility)) return res.status(400).json({ error: 'Eligibility is casual, competitive or restricted.' });
    if (eligibility === 'competitive' && (img.flagged || img.takedown !== 'none')) {
      return res.status(409).json({ error: 'A flagged or disputed photo can’t be used in competitive play.' });
    }
    if (s.duplicate_of && !b.confirmDuplicate) {
      const d = db.get('SELECT moderation FROM images WHERE id = ?', s.duplicate_of);
      if (d && ['approved', 'pending'].includes(d.moderation)) {
        return res.status(409).json({ error: 'This looks like a copy of another photo. Check it, then confirm to approve anyway.', code: 'duplicate' });
      }
    }
    const blur = cleanBlur(b.blur);
    const original = await store.get(`originals/${img.id}`);
    if (!original) return res.status(500).json({ error: 'The original file is missing.' });
    const derived = await processing(() => Photos.derive(original, { blur }));
    for (const [size, data] of Object.entries(derived)) await store.put(`web/${img.id}/${size}.webp`, data);
    const restrictions = { ...parseJson(img.restrictions, {}), blur };
    db.tx(() => {
      db.run(`UPDATE images SET moderation = 'approved', eligibility = ?, vehicle_key = ?, year = ?, difficulty = ?, restrictions = ?, updated_at = ? WHERE id = ?`,
        eligibility, vehicle.key, year, difficulty, JSON.stringify(restrictions), now(), img.id);
      db.run(`UPDATE submissions SET status = 'approved', reason = NULL, updated_at = ? WHERE id = ?`, now(), s.id);
      db.audit(actor, 'submission.approve', 'submission', s.id, { image: img.id, vehicle: vehicle.key, year, difficulty, eligibility, blur: blur.length, note: reason || undefined });
    });
    res.json({ submission: viewSubmission(db.get('SELECT * FROM submissions WHERE id = ?', s.id), { forModerator: true }) });
  }));

  // Change how an approved photo is used: eligibility, flag, difficulty, vehicle, year.
  mod.post('/images/:id/state', (req, res) => {
    const img = ID_RE.test(req.params.id) && db.get('SELECT * FROM images WHERE id = ?', req.params.id);
    if (!img) return res.status(404).json({ error: 'not found' });
    if (img.moderation !== 'approved') return res.status(409).json({ error: 'Only approved photos can be changed here.' });
    const b = req.body || {};
    const next = { eligibility: img.eligibility, flagged: img.flagged, difficulty: img.difficulty, vehicle_key: img.vehicle_key, year: img.year };
    if (b.eligibility !== undefined) {
      if (!['casual', 'competitive', 'restricted'].includes(b.eligibility)) return res.status(400).json({ error: 'Eligibility is casual, competitive or restricted.' });
      next.eligibility = b.eligibility;
    }
    if (b.flagged !== undefined) next.flagged = bool(b.flagged) ? 1 : 0;
    if (b.difficulty !== undefined) {
      const d = Number(b.difficulty);
      if (!Number.isInteger(d) || d < 1 || d > 5) return res.status(400).json({ error: 'Difficulty is 1 to 5.' });
      next.difficulty = d;
    }
    if (b.vehicleKey !== undefined) {
      if (!vehicleOf(b.vehicleKey)) return res.status(400).json({ error: 'Choose the vehicle from the list.' });
      next.vehicle_key = b.vehicleKey;
    }
    if (b.year !== undefined) {
      const v = vehicleOf(next.vehicle_key);
      const y = Number(b.year);
      if (!Number.isInteger(y) || (v && (y < v.lo - 1 || y > v.hi + 1))) return res.status(400).json({ error: 'That year doesn’t fit this vehicle.' });
      next.year = y;
    }
    // A flag (or an open dispute) always takes a photo out of competitive play.
    if (next.eligibility === 'competitive' && (next.flagged || img.takedown !== 'none')) {
      if (b.eligibility === 'competitive') return res.status(409).json({ error: 'A flagged or disputed photo can’t be used in competitive play.' });
      next.eligibility = 'casual';
    }
    db.tx(() => {
      db.run('UPDATE images SET eligibility = ?, flagged = ?, difficulty = ?, vehicle_key = ?, year = ?, updated_at = ? WHERE id = ?',
        next.eligibility, next.flagged, next.difficulty, next.vehicle_key, next.year, now(), img.id);
      db.audit(req.user.id, 'image.state', 'image', img.id, { from: { eligibility: img.eligibility, flagged: img.flagged, difficulty: img.difficulty, vehicle: img.vehicle_key, year: img.year }, to: next, reason: text(b.reason, 300) || undefined });
    });
    res.json({ image: { id: img.id, ...next, flagged: !!next.flagged } });
  });

  mod.post('/images/:id/remove', safe(async (req, res) => {
    const img = ID_RE.test(req.params.id) && db.get('SELECT * FROM images WHERE id = ?', req.params.id);
    if (!img) return res.status(404).json({ error: 'not found' });
    const reason = text((req.body || {}).reason, 500);
    if (reason.length < 3) return res.status(400).json({ error: 'Give a reason.' });
    if (img.moderation === 'removed') return res.json({ ok: true });
    db.tx(() => {
      for (const s of db.all(`SELECT id, status FROM submissions WHERE image_id = ? AND status != 'removed'`, img.id)) {
        db.run(`UPDATE submissions SET status = 'removed', reason = ?, updated_at = ? WHERE id = ?`, reason, now(), s.id);
        db.audit(req.user.id, 'submission.remove', 'submission', s.id, { by: 'moderator', was: s.status, reason });
      }
    });
    await retireImage(img.id, { moderation: 'removed', actorId: req.user.id, reason });
    res.json({ ok: true });
  }));

  // The untouched original, for moderators only (it may contain location data).
  mod.get('/original/:id', safe(async (req, res) => {
    if (!ID_RE.test(req.params.id)) return res.status(404).json({ error: 'not found' });
    const buf = await store.get(`originals/${req.params.id}`);
    if (!buf) return res.status(404).json({ error: 'not found' });
    const meta = await sharp(buf).metadata().catch(() => ({}));
    res.set('Cache-Control', 'private, no-store');
    res.set('Content-Security-Policy', "default-src 'none'");
    res.type(meta.format ? `image/${meta.format}` : 'application/octet-stream').send(buf);
  }));

  mod.get('/audit', (req, res) => {
    const n = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
    const rows = db.all(`SELECT a.id, a.at, a.action, a.entity, a.entity_id, a.detail, u.display_name actor
                         FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id ORDER BY a.id DESC LIMIT ?`, n);
    res.json({ entries: rows.map(r => ({ ...r, detail: parseJson(r.detail, null) })) });
  });

  router.use('/mod', mod);

  // ---- admin: moderators and submission rights ----
  router.get('/admin/users', admin, (req, res) => {
    const q = text(req.query.q, 80);
    const rows = q
      ? db.all(`SELECT id, display_name, email, role, status, created_at FROM users WHERE display_name LIKE ? OR email LIKE ? ORDER BY created_at DESC LIMIT 50`, `%${q}%`, `%${q}%`)
      : db.all('SELECT id, display_name, email, role, status, created_at FROM users ORDER BY created_at DESC LIMIT 50');
    res.json({ users: rows });
  });
  router.post('/admin/users/:id', admin, (req, res) => {
    const target = db.get('SELECT * FROM users WHERE id = ?', req.params.id);
    if (!target || target.status === 'closed') return res.status(404).json({ error: 'not found' });
    if (target.id === req.user.id) return res.status(400).json({ error: 'You can’t change your own role or status.' });
    const b = req.body || {};
    const role = b.role === undefined ? target.role : b.role;
    const status = b.status === undefined ? target.status : b.status;
    if (!['user', 'moderator', 'admin'].includes(role) || !['active', 'suspended'].includes(status)) return res.status(400).json({ error: 'Invalid role or status.' });
    db.tx(() => {
      db.run('UPDATE users SET role = ?, status = ?, updated_at = ? WHERE id = ?', role, status, now(), target.id);
      if (status === 'suspended') db.run('DELETE FROM sessions WHERE user_id = ?', target.id);
      db.audit(req.user.id, 'user.admin', 'user', target.id, { from: { role: target.role, status: target.status }, to: { role, status }, reason: text(b.reason, 300) || undefined });
    });
    res.json({ ok: true, role, status });
  });

  router.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Photos can be up to 15 MB.' });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Bad request' });
    console.error('[garage]', err);
    res.status(500).json({ error: 'Something went wrong. Try again.' });
  });

  return { router, store, LICENCE_VERSION, creditFor };
}

module.exports = { createGarage, LICENCE_VERSION, DECLARATIONS, STATUS_LABEL, ANON_CREDIT };
