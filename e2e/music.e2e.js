// Browser run of the artist playlist. Starts its own server on port 3500 and stands in two
// short generated tones for songs (the real list starts empty until permissions arrive).
// Usage: node e2e/music.e2e.js
//
// Covers: the option staying hidden with no songs (and the setting falling back to Monaco),
// the option appearing with songs, playback and the now-playing credit, the menu toast,
// next song, moving on when a song ends, turning down during a round, and mute.
const { chromium } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createApp } = require('../src/server.js');

const PH = fs.readFileSync(path.join(__dirname, 'fixtures', 'stand-in-car.jpg'));
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'viccall-music-'));
const app = createApp({ dataDir, log: false, fetchImage: async () => new Response(PH, { status: 200, headers: { 'content-type': 'image/jpeg' } }) });
const base = 'http://localhost:3500';

// A mono 16-bit WAV of a sine tone.
function tone(freq, seconds, rate = 22050) {
  const n = Math.round(seconds * rate);
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8); buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.sin((2 * Math.PI * freq * i) / rate) * 9000), 44 + i * 2);
  return buf;
}
const SONGS = {
  tracks: [
    { id: 'one', title: 'First Gear', artist: 'Test Artist', link: 'https://example.com/test-artist', file: 'music/one.wav' },
    { id: 'two', title: 'Second Wind', artist: 'Other Artist', file: 'music/two.wav' },
  ],
};
const WAV = { 'one.wav': tone(440, 2.5), 'two.wav': tone(660, 2.5) };

const checks = [];
const errors = [];
const check = (cond, msg) => checks.push(`${cond ? 'PASS' : 'FAIL'} ${msg}`);
const debug = page => page.evaluate(() => window.VCAudio.debug());
const now = page => page.evaluate(() => window.VCAudio.nowPlaying());
const waitFor = async (page, fn, arg, ms = 6000) => { try { await page.waitForFunction(fn, arg, { timeout: ms }); return true; } catch { return false; } };

async function open(browser, withSongs) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.route(/upload\.wikimedia\.org/, r => r.fulfill({ status: 200, contentType: 'image/jpeg', body: PH }));
  if (withSongs) {
    await ctx.route(/\/music\/tracks\.json/, r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(SONGS) }));
    await ctx.route(/\/music\/(one|two)\.wav/, r => r.fulfill({ status: 200, contentType: 'audio/wav', body: WAV[r.request().url().split('/').pop()] }));
  }
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error' && !/status of 404/.test(m.text())) errors.push(`console: ${m.text()}`); });
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.waitForSelector('.tower-row');
  await page.evaluate(() => window.VCAudio.tracksReady);
  await page.mouse.click(5, 300); // a first gesture, so the browser lets audio start
  return { ctx, page };
}

(async () => {
  await new Promise(r => app.server.listen(3500, r));
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  try {
    // ---- no songs yet: the option is hidden, and a saved choice plays Monaco instead
    {
      const { ctx, page } = await open(browser, false);
      await page.click('[data-action="sound-settings"] >> visible=true');
      check(await page.isHidden('#sndPlaylistOpt'), 'no songs: the playlist option is hidden');
      await page.evaluate(() => window.VCAudio.set({ theme: 'playlist', muted: false, music: 60 }));
      await page.waitForTimeout(300);
      check((await debug(page)).theme === 'monaco', 'no songs: a saved playlist choice plays Monaco instead');
      check(await page.isHidden('#sndNow'), 'no songs: no now-playing line');
      await ctx.close();
    }

    // ---- with songs
    const { ctx, page } = await open(browser, true);
    await page.evaluate(() => window.VCAudio.set({ theme: 'monaco', muted: false, music: 60 }));
    await page.click('[data-action="sound-settings"] >> visible=true');
    check(await page.isVisible('#sndPlaylistOpt'), 'with songs: the playlist option appears');
    await page.click('#sndPlaylistOpt');
    check(await waitFor(page, () => { const d = window.VCAudio.debug(); return d.theme === 'playlist' && d.time > 0.3 && !d.paused; }), 'choosing it starts a song playing');
    const first = await now(page);
    check(first && ['First Gear', 'Second Wind'].includes(first.title), `now playing: ${first && first.title}`);
    check(await waitFor(page, t => document.getElementById('sndNowTitle').textContent === t, first.title), 'the sound settings credit the song');
    const byLink = await page.$('#sndNowBy a');
    check(first.title === 'First Gear' ? !!byLink && (await byLink.getAttribute('href')) === 'https://example.com/test-artist' : !byLink, 'the artist links to their page when there is one');
    await page.screenshot({ path: path.join(os.tmpdir(), 'viccall-music-dialog.png') });

    await page.click('#sndSkip');
    check(await waitFor(page, t => { const n = window.VCAudio.nowPlaying(); return n && n.title !== t; }, first.title), 'Next song moves on to the other song');
    const second = await now(page);
    await page.keyboard.press('Escape');
    check(await waitFor(page, () => /Now playing/.test(document.getElementById('toast').textContent)), 'a menu screen shows "Now playing" when a song starts');

    // Songs are 2.5 s: the next one starts on its own.
    check(await waitFor(page, t => { const n = window.VCAudio.nowPlaying(); return n && n.title !== t; }, second.title, 8000), 'when a song ends, the next one starts');

    // Turned down during a round, back up on the menu.
    check((await debug(page)).duck === 1, 'full volume on the menu');
    await page.evaluate(() => window.VicCall.startSolo({ kind: 'free', filters: {} }));
    await page.waitForSelector('#gImg.is-loaded');
    check(await waitFor(page, () => window.VCAudio.debug().duck === 0.5), 'turned down during a round');
    await page.evaluate(() => window.VicCall.show('home'));
    check(await waitFor(page, () => window.VCAudio.debug().duck === 1), 'back up after the round');

    // Mute stops it.
    await page.keyboard.press('m');
    check(await waitFor(page, () => window.VCAudio.debug().theme === null), 'mute stops the song');
    await ctx.close();
  } catch (e) {
    errors.push(`script: ${e.stack}`);
  } finally {
    await browser.close();
    app.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
  console.log(checks.join('\n'));
  console.log(`\n${checks.filter(c => c.startsWith('PASS')).length}/${checks.length} checks passed; page errors: ${errors.length}`);
  if (errors.length) console.log(errors.join('\n'));
  process.exit(checks.some(c => c.startsWith('FAIL')) || errors.length ? 1 : 0);
})();
