const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { validateTracks } = require('../src/music');

const PUBLIC = path.join(__dirname, '..', 'public');

test('the artist playlist only lists songs with a permission record and a file', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(PUBLIC, 'music', 'tracks.json'), 'utf8'));
  assert.deepEqual(validateTracks(manifest, PUBLIC), []);
});

test('the playlist check catches missing permission records, files and bad entries', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-music-'));
  try {
    fs.mkdirSync(path.join(dir, 'music'));
    fs.writeFileSync(path.join(dir, 'music', 'ok-song.mp3'), 'x');
    const good = {
      id: 'ok-song', title: 'Song', artist: 'Artist', link: 'https://example.com/artist', file: 'music/ok-song.mp3',
      licence: { kind: 'written permission', from: 'Artist (owns the recording and the song)', granted: '2026-11-02', scope: 'VicCall game, worldwide, until revoked', evidence: 'Signed form, Drive: VicCall/music/artist.pdf' },
    };
    assert.deepEqual(validateTracks({ tracks: [good] }, dir), []);
    const errs = validateTracks({ tracks: [
      good,
      { ...good },                                                    // same id
      { ...good, id: 'no-licence', licence: undefined },
      { ...good, id: 'no-proof', licence: { ...good.licence, evidence: '' } },
      { ...good, id: 'missing-file', file: 'music/nope.mp3' },
      { ...good, id: 'bad-file', file: '../secret.mp3' },
      { ...good, id: 'bad-link', link: 'javascript:alert(1)' },
    ] }, dir);
    const has = re => assert.ok(errs.some(e => re.test(e)), `expected an error matching ${re}: ${errs.join('; ')}`);
    has(/id used twice/);
    has(/no-licence.*licence record missing/);
    has(/no-proof.*licence.evidence missing/);
    has(/missing-file.*not found/);
    has(/bad-file.*file must look like/);
    has(/bad-link.*https/);
    assert.deepEqual(validateTracks({}, dir), ['tracks.json needs a "tracks" list']);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
