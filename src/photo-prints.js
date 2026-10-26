/*
 * Fingerprints of the game's own photos (the Wikimedia Commons files in
 * cars.json), so the Garage can catch an upload of one of them: it's someone
 * else's photo, and one players may already have had in a round.
 *
 * src/photo-prints.json ships with the code; `node scripts/photo-prints.js`
 * rebuilds it on a computer that can reach Wikimedia. An entry counts only
 * while its credit matches the car's, so a changed photo is never judged by
 * the old one's fingerprints. In production the server fingerprints missing
 * photos itself and keeps them in DATA_DIR/photo-prints.json.
 *
 * Fingerprints are the same difference hashes used for community uploads
 * (src/photos.js): the whole frame plus likely crops.
 */
const fs = require('fs');
const path = require('path');
const Photos = require('./photos');
const { USER_AGENT } = require('./images');

const SHIPPED = path.join(__dirname, 'photo-prints.json');
// Bits of 64 that may differ. Measured on the 312 photos in October 2026: no
// two different game photos are closer than 11. Copies made from the full-size
// Commons original scored 0-3 (as-is, re-saved, brightened), 2-11 for a 90%
// crop and 3-10 for an 80% corner crop. So: refuse plain copies, show a
// moderator anything within 10. Heavy crops (65%: 8-16) and mirror images
// (18-31) get through; moderators and reports are the backstop.
const REFUSE_AT = 6;
const FLAG_AT = 10;

function readPrints(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; }
}
// One car per line, sorted, so a rebuilt file diffs cleanly.
function writePrints(file, prints) {
  const lines = Object.keys(prints).sort().map(id => `  ${JSON.stringify(id)}: ${JSON.stringify(prints[id])}`);
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `{\n${lines.join(',\n')}\n}\n`);
  fs.renameSync(tmp, file);
}

function createPhotoPrints({ cars, dataDir = null, shipped = SHIPPED, prints: given = null, fetch: fetcher = (u, i) => fetch(u, i), log = true } = {}) {
  const live = cars.filter(c => !c.excluded && c.img && c.credit);
  const saved = dataDir ? path.join(dataDir, 'photo-prints.json') : null;
  const prints = given ? { ...given } : { ...(shipped ? readPrints(shipped) : {}), ...(saved ? readPrints(saved) : {}) };
  const current = c => (prints[c.id] && prints[c.id].credit === c.credit ? prints[c.id] : null);
  const missing = () => live.filter(c => !current(c));

  /*
   * The first-party photo closest to an inspected upload, or null:
   * { car, distance, how, refuse } where refuse means it's plainly a copy.
   */
  function match(check) {
    let best = null;
    for (const c of live) {
      const p = current(c);
      if (!p) continue;
      const m = Photos.similar({ hashes: check.hashes }, { hashes: p.hashes }, FLAG_AT);
      if (m.match && (!best || m.distance < best.distance)) best = { car: c.id, distance: m.distance, how: m.how };
    }
    return best && { ...best, refuse: best.distance <= REFUSE_AT };
  }

  async function get(url) {
    for (let attempt = 0; ; attempt++) {
      const res = await fetcher(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'image/*' }, signal: AbortSignal.timeout(20_000) });
      if ((res.status === 429 || res.status >= 500) && attempt < 3) { await new Promise(r => setTimeout(r, 3000 * (attempt + 1))); continue; }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    }
  }

  // Fingerprint every photo that has none (or an out-of-date one), one at a time.
  async function fill({ save = saved, delayMs = 300 } = {}) {
    const todo = missing();
    let done = 0, failed = 0;
    for (const c of todo) {
      try {
        prints[c.id] = { credit: c.credit, hashes: await Photos.printsOf(await get(c.img)) };
        done++;
      } catch (e) {
        failed++;
        if (log) console.warn(`[prints] ${c.id}: ${e.message}`);
      }
      if (delayMs) await new Promise(r => setTimeout(r, delayMs));
    }
    if (done && save) writePrints(save, Object.fromEntries(live.filter(current).map(c => [c.id, prints[c.id]])));
    if (log && todo.length) console.log(`[prints] fingerprinted ${done} first-party photos${failed ? `, ${failed} failed` : ''}`);
    return { done, failed, missing: missing().length };
  }

  return { match, missing, fill, get size() { return live.filter(current).length; } };
}

module.exports = { createPhotoPrints, readPrints, writePrints, REFUSE_AT, FLAG_AT, SHIPPED };
