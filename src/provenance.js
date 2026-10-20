/*
 * Provenance for the first-party photos (Wikimedia Commons).
 *
 * Every first-party photo is a file on Wikimedia Commons. This module asks the
 * Commons API what each file page states: the author, the licence and whether
 * attribution is required. The answers are kept in DATA_DIR/commons-meta.json
 * and shown with the photo after each round.
 *
 * What's recorded is what Commons states on the date it was fetched; it isn't
 * independent legal verification. Photos whose stated licence doesn't allow
 * this use (non-commercial, no-derivatives, missing) are listed for review.
 */
const fs = require('fs');
const path = require('path');
const { USER_AGENT } = require('./images');

const API = 'https://commons.wikimedia.org/w/api.php';
const BATCH = 50;
const FIELDS = 'Artist|Credit|LicenseShortName|LicenseUrl|AttributionRequired|UsageTerms|Copyrighted';

// Commons returns HTML in some fields ("<a href=…>Name</a>"); keep the text.
function plain(html) {
  return String(html || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ').trim().slice(0, 200);
}

/*
 * Is this licence fine for showing the photo, resized and cropped, in a game
 * that may make money?  'ok' | 'review' (no derivatives, unknown) | 'no' (non-commercial).
 */
function licenceUse(short) {
  const l = String(short || '').trim();
  if (!l) return 'review';
  if (/\bNC\b|non-?commercial/i.test(l)) return 'no';
  if (/\bND\b|no-?deriv/i.test(l)) return 'review';
  if (/^(CC0|Public domain|PD\b|PD-|CC BY(-SA)? \d|CC-BY(-SA)?-\d|GFDL|FAL|Attribution|Copyrighted free use)/i.test(l)) return 'ok';
  return 'review';
}

const pageUrl = file => `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(file.replace(/ /g, '_'))}`;

function createCommonsProvenance({ cars, dataDir, fetch: fetcher = (u, i) => fetch(u, i), db = null, log = true } = {}) {
  const file = path.join(dataDir, 'commons-meta.json');
  const live = cars.filter(c => !c.excluded && c.credit);
  let meta = {}, fetchedAt = 0;
  try { const saved = JSON.parse(fs.readFileSync(file, 'utf8')); meta = saved.files || {}; fetchedAt = saved.fetchedAt || 0; } catch {}

  async function fetchBatch(titles) {
    const params = new URLSearchParams({
      action: 'query', prop: 'imageinfo', iiprop: 'extmetadata|url', iiextmetadatafilter: FIELDS,
      titles: titles.map(t => `File:${t}`).join('|'), format: 'json', formatversion: '2', maxlag: '5',
    });
    const res = await fetcher(`${API}?${params}`, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' }, signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(`Commons API ${res.status}`);
    const body = await res.json();
    if (body.error) throw new Error(`Commons API: ${body.error.code || 'error'}`); // e.g. maxlag: try again later
    const q = body.query || {};
    const back = new Map((q.normalized || []).map(n => [n.to, n.from]));
    const out = {};
    for (const p of q.pages || []) {
      const asked = (back.get(p.title) || p.title).replace(/^File:/, '');
      if (p.missing || !p.imageinfo || !p.imageinfo[0]) { out[asked] = { status: 'missing' }; continue; }
      const m = p.imageinfo[0].extmetadata || {};
      const v = k => (m[k] && m[k].value) || '';
      const licence = plain(v('LicenseShortName')) || null;
      out[asked] = {
        status: 'ok',
        author: plain(v('Artist')) || null,
        credit: plain(v('Credit')) || null,
        licence,
        licenceUrl: plain(v('LicenseUrl')) || null,
        attributionRequired: v('AttributionRequired') === 'true' ? true : v('AttributionRequired') === 'false' ? false : null,
        use: licenceUse(licence),
        page: p.imageinfo[0].descriptionurl || pageUrl(asked),
      };
    }
    return out;
  }

  // Record the first-party photos in the Garage's images table too, so every
  // image the game shows has a provenance row in one place.
  function record(car, m, at, keyOf) {
    if (!db) return;
    const id = `commons:${car.id}`;
    const evidence = JSON.stringify({ page: m.page || pageUrl(car.credit), fetchedAt: at, statedBy: 'Wikimedia Commons file page', licenceUrl: m.licenceUrl || null });
    const commercial = m.use === 'ok' ? 1 : m.use === 'no' ? 0 : null;
    const attribution = [m.author, m.licence].filter(Boolean).join(', ') || null;
    const existing = db.get('SELECT id FROM images WHERE id = ?', id);
    if (existing) {
      db.run(`UPDATE images SET photographer = ?, licence = ?, licence_evidence = ?, commercial_ok = ?, attribution = ?, updated_at = ? WHERE id = ?`,
        m.author, m.licence || 'unverified', evidence, commercial, attribution, at, id);
    } else {
      db.run(`INSERT INTO images (id, source, source_ref, photographer, licence, licence_evidence, commercial_ok, attribution, moderation, eligibility,
                vehicle_key, year, created_at, updated_at) VALUES (?, 'commons', ?, ?, ?, ?, ?, ?, 'approved', ?, ?, ?, ?, ?)`,
      id, car.img, m.author, m.licence || 'unverified', evidence, commercial, attribution, m.use === 'no' ? 'restricted' : 'competitive',
      keyOf(car), car.year, at, at);
    }
  }

  /*
   * Fetch what Commons states for every first-party photo (50 files per
   * request). Returns { fetched, ok, review, no, missing, failed }.
   */
  async function refresh({ keyOf = () => null } = {}) {
    const at = Date.now();
    const files = [...new Set(live.map(c => c.credit))];
    const summary = { fetched: 0, ok: 0, review: 0, no: 0, missing: 0, failed: 0 };
    for (let i = 0; i < files.length; i += BATCH) {
      const titles = files.slice(i, i + BATCH);
      let got;
      try { got = await fetchBatch(titles); } catch (e) {
        summary.failed += titles.length;
        if (log) console.warn('[provenance] Commons lookup failed:', e.message);
        continue;
      }
      for (const t of titles) {
        const m = got[t] || { status: 'missing' };
        meta[t] = { ...m, fetchedAt: at };
        summary.fetched++;
        if (m.status === 'missing') summary.missing++;
        else summary[m.use]++;
      }
    }
    if (summary.fetched) {
      fetchedAt = at;
      const tmp = `${file}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify({ fetchedAt: at, files: meta }, null, 1));
      fs.renameSync(tmp, file);
      if (db) db.tx(() => { for (const c of live) if (meta[c.credit] && meta[c.credit].status === 'ok') record(c, meta[c.credit], at, keyOf); });
    }
    if (log) console.log(`[provenance] Commons: ${summary.ok} ok, ${summary.review} to review, ${summary.no} not usable, ${summary.missing} missing, ${summary.failed} failed`);
    return summary;
  }

  // Credit line for a first-party car: { author, licence, licenceUrl, page } or null if not fetched yet.
  function attributionFor(car) {
    const m = car && car.credit && meta[car.credit];
    if (!m || m.status !== 'ok') return null;
    return { author: m.author, licence: m.licence, licenceUrl: m.licenceUrl, page: m.page };
  }

  // Photos whose stated licence needs a decision.
  function needsReview() {
    return live.map(c => ({ car: c.id, file: c.credit, ...(meta[c.credit] || { status: 'unfetched' }) }))
      .filter(r => r.status !== 'ok' || r.use !== 'ok');
  }

  // Worth asking Commons again? (Nothing cached, files missing, or older than maxAgeMs.)
  const stale = (maxAgeMs = 7 * 24 * 60 * 60_000) => !fetchedAt || Date.now() - fetchedAt > maxAgeMs || live.some(c => !meta[c.credit]);

  return { refresh, attributionFor, needsReview, stale, get size() { return Object.keys(meta).length; } };
}

module.exports = { createCommonsProvenance, licenceUse, plain, pageUrl };
