/*
 * The artist playlist's track list (public/music/tracks.json).
 *
 * Every song must carry a record of the permission to use it: who gave it,
 * when, for what, and where the written proof is kept. `npm test` refuses a
 * list where any of that is missing, or a file that isn't there.
 */
const fs = require('fs');
const path = require('path');

const FILE_RE = /^music\/[a-z0-9][a-z0-9._-]*\.(mp3|m4a|ogg)$/;
const MAX_BYTES = 15 * 1024 * 1024;

function validateTracks(manifest, publicDir) {
  const errors = [];
  const list = manifest && Array.isArray(manifest.tracks) ? manifest.tracks : null;
  if (!list) return ['tracks.json needs a "tracks" list'];
  const ids = new Set();
  list.forEach((t, i) => {
    const at = `track ${i + 1}${t && t.id ? ` (${t.id})` : ''}`;
    const text = v => typeof v === 'string' && v.trim().length > 0;
    if (!t || typeof t !== 'object') return errors.push(`${at}: not an object`);
    if (!text(t.id) || !/^[a-z0-9-]+$/.test(t.id)) errors.push(`${at}: id must be lowercase letters, numbers and dashes`);
    else if (ids.has(t.id)) errors.push(`${at}: id used twice`);
    else ids.add(t.id);
    if (!text(t.title)) errors.push(`${at}: title missing`);
    if (!text(t.artist)) errors.push(`${at}: artist missing`);
    if (t.link !== undefined && !(text(t.link) && /^https:\/\//.test(t.link))) errors.push(`${at}: link must be an https:// address`);
    if (!text(t.file) || !FILE_RE.test(t.file)) errors.push(`${at}: file must look like music/artist-song.mp3 (mp3, m4a or ogg)`);
    else {
      const p = path.join(publicDir, t.file);
      if (!fs.existsSync(p)) errors.push(`${at}: ${t.file} not found in public/`);
      else if (fs.statSync(p).size > MAX_BYTES) errors.push(`${at}: ${t.file} is over 15 MB`);
    }
    const l = t.licence;
    if (!l || typeof l !== 'object') errors.push(`${at}: licence record missing`);
    else {
      if (!text(l.kind)) errors.push(`${at}: licence.kind missing (e.g. "written permission")`);
      if (!text(l.from)) errors.push(`${at}: licence.from missing (who gave permission, and that they own the recording and the song)`);
      if (!text(l.granted) || !/^\d{4}-\d{2}-\d{2}$/.test(l.granted)) errors.push(`${at}: licence.granted must be a date (YYYY-MM-DD)`);
      if (!text(l.scope)) errors.push(`${at}: licence.scope missing (what the permission covers)`);
      if (!text(l.evidence)) errors.push(`${at}: licence.evidence missing (where the written permission is kept)`);
    }
  });
  return errors;
}

module.exports = { validateTracks, FILE_RE, MAX_BYTES };
